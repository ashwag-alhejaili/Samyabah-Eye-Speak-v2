/**
 * caregiverNotification.tsx
 *
 * CaregiverNotificationProvider — mounts ONCE above the router so it survives
 * internal navigation. Owns AudioContext, session-ready state, pending sound
 * queue, and request-detection logic. CaregiverDashboard consumes the context.
 */

import {
  createContext, useContext, useRef, useState, useEffect, useCallback,
  type ReactNode,
} from 'react';
import { useRequestStore, type PatientRequest } from './App';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
export const CAREGIVER_AUDIO_KEY = 'sameyba_caregiver_audio_v2';

// ─────────────────────────────────────────────────────────────────────────────
// Chime functions (module-level; no state)
// ─────────────────────────────────────────────────────────────────────────────
export function playChime(ctx: AudioContext) {
  const now  = ctx.currentTime;
  const tone = (freq: number, start: number, dur: number, peak: number) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + start);
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(peak, now + start + 0.015);
    gain.gain.setValueAtTime(peak, now + start + Math.max(dur - 0.03, 0.02));
    gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
    osc.start(now + start);
    osc.stop(now  + start + dur + 0.01);
  };
  tone(880,  0.01, 0.18, 0.28);  // 880 Hz for 180 ms
  tone(1175, 0.22, 0.22, 0.24);  // 1175 Hz for 220 ms
}

export function playEmergencyChime(ctx: AudioContext) {
  const now   = ctx.currentTime;
  const burst = (start: number) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(660, now + start);
    osc.frequency.setValueAtTime(990, now + start + 0.08);
    gain.gain.setValueAtTime(0, now + start);
    gain.gain.linearRampToValueAtTime(0.50, now + start + 0.012);
    gain.gain.setValueAtTime(0.50, now + start + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.24);
    osc.start(now + start);
    osc.stop(now  + start + 0.26);
  };
  burst(0.00);
  burst(0.30);
  burst(0.60);
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface SoundQueueItem {
  id:          string;
  priority:    PatientRequest['priority'];
  patientName: string;
  requestText: string;
}

export interface CaregiverNotificationDebug {
  providerMounted: boolean;
  ctxState:        string;
  sessionReady:    boolean;
  pendingQueueIds: string[];
  lastPlayedId:    string;
  lastAudioError:  string;
}

export interface CaregiverNotificationCtx {
  // Audio activation (required per session)
  audioSessionReady:    boolean;
  audioJustActivated:   boolean;
  audioActivating:      boolean;
  audioError:           string | null;
  handleActivateAudio:  () => Promise<void>;

  // Notification permission (opt-in via explicit button)
  notifPermission:              NotificationPermission | 'unavailable';
  handleRequestNotifPermission: () => Promise<void>;

  // Debug values (temporary strip in dashboard)
  audioDebug: CaregiverNotificationDebug;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────
const CaregiverNotificationContext =
  createContext<CaregiverNotificationCtx | null>(null);

export function useCaregiverNotification(): CaregiverNotificationCtx {
  const ctx = useContext(CaregiverNotificationContext);
  if (!ctx) throw new Error(
    'useCaregiverNotification must be used inside CaregiverNotificationProvider',
  );
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────
export function CaregiverNotificationProvider({ children }: { children: ReactNode }) {
  const { requests } = useRequestStore();

  // ── Audio refs (survive renders; never reset on navigation) ───────────────
  const audioCtxRef          = useRef<AudioContext | null>(null);
  const audioSessionReadyRef = useRef(false);

  // ── Notification tracking ─────────────────────────────────────────────────
  // acknowledgedIds: IDs we've already processed (browser-notified or queued).
  //   Initialized at mount so existing requests never trigger sounds on first render.
  const acknowledgedIds   = useRef<Set<string>>(new Set(requests.map(r => r.id)));
  // pendingSoundQueue: requests that arrived while ctx was not running.
  //   Only removed after chime is actually scheduled on a running ctx.
  const pendingSoundQueue = useRef<SoundQueueItem[]>([]);

  // ── React state ───────────────────────────────────────────────────────────
  const [audioSessionReady,  setAudioSessionReady]  = useState(false);
  const [audioJustActivated, setAudioJustActivated] = useState(false);
  const [audioActivating,    setAudioActivating]    = useState(false);
  const [audioError,         setAudioError]         = useState<string | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unavailable'>(
    () => (typeof Notification !== 'undefined' ? Notification.permission : 'unavailable'),
  );
  const [audioDebug, setAudioDebug] = useState<CaregiverNotificationDebug>({
    providerMounted: true,
    ctxState:        'none',
    sessionReady:    false,
    pendingQueueIds: [],
    lastPlayedId:    '—',
    lastAudioError:  '—',
  });

  // ── Drain pending queue when ctx is running ───────────────────────────────
  const drainQueue = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state !== 'running') return;
    if (pendingSoundQueue.current.length === 0) return;

    // Urgent items first
    const sorted = [...pendingSoundQueue.current].sort((a, b) =>
      a.priority === 'urgent' && b.priority !== 'urgent' ? -1 : 1,
    );
    pendingSoundQueue.current = [];

    let lastId = '—';
    for (const item of sorted) {
      if (item.priority === 'urgent') playEmergencyChime(ctx);
      else playChime(ctx);
      lastId = item.id;
    }

    setAudioDebug(d => ({
      ...d,
      ctxState:        ctx.state,
      pendingQueueIds: [],
      lastPlayedId:    lastId,
    }));
  }, []);

  // ── New-request detection ─────────────────────────────────────────────────
  useEffect(() => {
    const fresh = requests.filter(
      r => r.status === 'pending' && !acknowledgedIds.current.has(r.id),
    );
    if (fresh.length === 0) return;

    for (const req of fresh) {
      acknowledgedIds.current.add(req.id);

      // Browser notification when tab is hidden and permission granted
      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted' &&
        document.hidden
      ) {
        new Notification('طلب جديد', {
          body: `${req.patientName} — ${req.requestText}`,
          dir: 'rtl', lang: 'ar',
        });
      }

      const ctx = audioCtxRef.current;
      if (audioSessionReadyRef.current && ctx && ctx.state === 'running') {
        // Chime scheduled now — considered audibly notified immediately
        if (req.priority === 'urgent') playEmergencyChime(ctx);
        else playChime(ctx);
        setAudioDebug(d => ({
          ...d, ctxState: ctx.state, lastPlayedId: req.id,
        }));
      } else {
        // Context not running (tab hidden, suspended, or not yet activated) —
        // park in queue; do NOT discard
        pendingSoundQueue.current.push({
          id:          req.id,
          priority:    req.priority,
          patientName: req.patientName,
          requestText: req.requestText,
        });
        setAudioDebug(d => ({
          ...d,
          pendingQueueIds: pendingSoundQueue.current.map(i => i.id),
        }));
      }
    }
  }, [requests]);

  // ── Visibilitychange / focus ──────────────────────────────────────────────
  useEffect(() => {
    const onFocus = async () => {
      if (document.hidden) return; // only act when page becomes visible
      const ctx = audioCtxRef.current;
      if (!ctx || !audioSessionReadyRef.current) return;

      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
          setAudioDebug(d => ({ ...d, ctxState: audioCtxRef.current?.state ?? 'none' }));
          drainQueue();
        } catch {
          // Resume failed — require a new activation gesture
          audioSessionReadyRef.current = false;
          setAudioSessionReady(false);
          setAudioDebug(d => ({
            ...d,
            ctxState:     audioCtxRef.current?.state ?? 'none',
            sessionReady: false,
          }));
        }
      } else if (ctx.state === 'running') {
        drainQueue();
      }
    };

    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [drainQueue]);

  // ── Activation handler (must be called from a direct click) ──────────────
  const handleActivateAudio = useCallback(async () => {
    setAudioActivating(true);
    setAudioError(null);

    // Create AudioContext SYNCHRONOUSLY before first await to satisfy autoplay policy
    const Ctor = window.AudioContext
      ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) {
      setAudioError('المتصفح لا يدعم Web Audio API');
      setAudioActivating(false);
      return;
    }
    let ctx = audioCtxRef.current;
    if (!ctx || ctx.state === 'closed') {
      ctx = new Ctor();
      audioCtxRef.current = ctx;
    }

    try {
      await ctx.resume();
      if (ctx.state !== 'running') {
        throw new Error(`حالة AudioContext: ${ctx.state}`);
      }

      // Play audible two-tone test chime
      playChime(ctx);
      setAudioDebug(d => ({ ...d, ctxState: ctx!.state, lastPlayedId: 'test-chime' }));

      // Wait for chime to finish (~650 ms)
      await new Promise<void>(r => setTimeout(r, 650));

      if (ctx.state !== 'running') {
        throw new Error('توقف السياق أثناء تشغيل النغمة');
      }

      // ✓ Success
      localStorage.setItem(CAREGIVER_AUDIO_KEY, 'true');
      audioSessionReadyRef.current = true;
      setAudioSessionReady(true);
      setAudioJustActivated(true);
      setAudioDebug(d => ({ ...d, ctxState: ctx!.state, sessionReady: true }));
      setTimeout(() => setAudioJustActivated(false), 3500);

      // Drain any requests that arrived before activation
      drainQueue();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAudioError(`فشل التفعيل: ${msg}`);
      setAudioDebug(d => ({
        ...d,
        ctxState:       ctx?.state ?? 'none',
        lastAudioError: msg,
      }));
      // Keep button visible — do NOT mark session ready
    } finally {
      setAudioActivating(false);
    }
  }, [drainQueue]);

  // ── Notification permission ───────────────────────────────────────────────
  const handleRequestNotifPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  const value: CaregiverNotificationCtx = {
    audioSessionReady,
    audioJustActivated,
    audioActivating,
    audioError,
    handleActivateAudio,
    notifPermission,
    handleRequestNotifPermission,
    audioDebug,
  };

  return (
    <CaregiverNotificationContext.Provider value={value}>
      {children}
    </CaregiverNotificationContext.Provider>
  );
}
