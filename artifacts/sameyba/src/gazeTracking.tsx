import {
  useState, useEffect, useRef, createContext, useContext, useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

// ── WebGazer type declarations ────────────────────────────────────────────────
declare global {
  interface Window {
    webgazer?: {
      setGazeListener(
        cb: (data: { x: number; y: number } | null, elapsed: number) => void,
      ): Window['webgazer'];
      begin(): Promise<unknown>;
      end(): void;
      showVideoPreview(show: boolean): Window['webgazer'];
      showPredictionPoints(show: boolean): Window['webgazer'];
      showFaceOverlay?(show: boolean): Window['webgazer'];
      showFaceFeedbackBox?(show: boolean): Window['webgazer'];
      setPause(pause: boolean): Window['webgazer'];
      clearData(): Window['webgazer'];
      recordScreenPosition?(x: number, y: number, type: 'click' | 'move'): void;
      params?: Record<string, unknown>;
    };
  }
}

// ── MediaPipe CDN redirect ────────────────────────────────────────────────────
// WebGazer's default faceMeshSolutionPath is "./mediapipe/face_mesh" — a
// relative path that resolves to the local dev server and returns HTML.
const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh';
const FACE_MESH_FILENAMES = new Set([
  'face_mesh_solution_packed_assets_loader.js',
  'face_mesh_solution_simd_wasm_bin.js',
  'face_mesh_solution_wasm_bin.js',
  'face_mesh_solution_simd_wasm_bin.wasm',
  'face_mesh_solution_wasm_bin.wasm',
  'face_mesh_solution_packed_assets.data',
  'face_mesh.binarypb',
]);
let fetchPatched = false;
function installMediaPipeFetchPatch() {
  if (fetchPatched) return;
  fetchPatched = true;
  const _orig = window.fetch.bind(window);
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const raw =
      typeof input === 'string' ? input
      : input instanceof URL    ? input.href
      : (input as Request).url;
    const filename = raw.split('/').pop()?.split('?')[0] ?? '';
    if (FACE_MESH_FILENAMES.has(filename) && !raw.startsWith(MEDIAPIPE_CDN)) {
      const cdnUrl = `${MEDIAPIPE_CDN}/${filename}`;
      console.log(`[Sameyba/Gaze] 🔀 fetch redirect: ${raw} → ${cdnUrl}`);
      return _orig(cdnUrl, init);
    }
    return _orig(input, init);
  };
  console.log('[Sameyba/Gaze] fetch interceptor installed');
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type PermissionState = 'idle' | 'requesting' | 'granted' | 'denied';
export type GazeStatus = 'idle' | 'preparing' | 'calibrating' | 'verifying' | 'ready' | 'dwelling';

export type GazeContextShape = {
  gazeEnabled:     boolean;
  gazePos:         { x: number; y: number } | null;
  gazeTargetId:    string | null;
  permissionState: PermissionState;
  requestCamera:   () => void;
  /** true after the 9-point calibration completes */
  calibrated:      boolean;
  /** current state of the gaze system */
  gazeStatus:      GazeStatus;
  /** restart the 9-point calibration flow */
  recalibrate:     () => void;
};

// ── Context ───────────────────────────────────────────────────────────────────
export const GazeContext = createContext<GazeContextShape>({
  gazeEnabled:     false,
  gazePos:         null,
  gazeTargetId:    null,
  permissionState: 'idle',
  requestCamera:   () => {},
  calibrated:      false,
  gazeStatus:      'idle',
  recalibrate:     () => {},
});
export function useGazeContext() { return useContext(GazeContext); }

// ── Error classification ───────────────────────────────────────────────────────
type ErrorKind =
  | 'permission-denied' | 'no-camera' | 'camera-in-use' | 'aborted'
  | 'overconstrained'   | 'security'  | 'no-mediadevices' | 'unknown';

function classifyGetUserMediaError(err: unknown): { kind: ErrorKind; label: string } {
  const e = err as DOMException;
  const name = e?.name ?? '';
  const msg  = e?.message ?? String(err);
  if (name === 'NotAllowedError'    || name === 'PermissionDeniedError') return { kind: 'permission-denied', label: 'تم رفض الكاميرا — يعمل التطبيق بالفأرة' };
  if (name === 'NotFoundError'      || name === 'DevicesNotFoundError')  return { kind: 'no-camera',         label: 'لم يتم العثور على كاميرا' };
  if (name === 'NotReadableError'   || name === 'TrackStartError')       return { kind: 'camera-in-use',     label: 'الكاميرا مستخدمة من تطبيق آخر' };
  if (name === 'AbortError')                                             return { kind: 'aborted',           label: 'تم إلغاء تشغيل الكاميرا' };
  if (name === 'OverconstrainedError')                                   return { kind: 'overconstrained',   label: 'مواصفات الكاميرا غير مدعومة' };
  if (name === 'SecurityError')                                          return { kind: 'security',          label: 'تم حظر الكاميرا بإعدادات الأمان' };
  return { kind: 'unknown', label: `خطأ في الكاميرا: ${name || msg}` };
}

// ── Calibration constants ─────────────────────────────────────────────────────
/** 9-point grid as [col%, row%] fractions of the viewport */
const CAL_POINTS: [number, number][] = [
  [0.10, 0.12], [0.50, 0.12], [0.90, 0.12],
  [0.10, 0.50], [0.50, 0.50], [0.90, 0.50],
  [0.10, 0.88], [0.50, 0.88], [0.90, 0.88],
];
const CLICKS_PER_POINT = 2;

// ── Filter / smoothing constants ──────────────────────────────────────────────
/** 0.30 weight on raw → responsive but still smooth */
const EMA_ALPHA             = 0.30;
/** Rolling window for dwell-vote sampling */
const DWELL_WINDOW_MS       = 2000;
/** Fraction of window samples that must be on the same card */
const DWELL_THRESHOLD       = 0.70;
/** Gaps shorter than this (ms) are forgiven — counts as still on card */
const DEPARTURE_TOLERANCE_MS = 200;
/** Minimum window age (ms) before a vote can fire — avoids false positives */
const DWELL_MIN_WINDOW_MS   = 600;

// ── GazeProvider ──────────────────────────────────────────────────────────────
export function GazeProvider({ children }: { children: React.ReactNode }) {
  // Permission / lifecycle
  const [permissionState, setPermissionState] = useState<PermissionState>('idle');
  const [errorLabel, setErrorLabel]           = useState<string | null>(null);
  // Gaze output
  const [gazeEnabled,   setGazeEnabled]   = useState(false);
  const [gazePos,       setGazePos]       = useState<{ x: number; y: number } | null>(null);
  const [gazeTargetId,  setGazeTargetId]  = useState<string | null>(null);
  const [gazeHoverId,   setGazeHoverId]   = useState<string | null>(null); // pre-stability hover
  // Calibration
  const [calibrating,   setCalibrating]   = useState(false);
  const [calibrated,    setCalibrated]    = useState(false);
  const [calStep,       setCalStep]       = useState(0);   // 0-8
  const [calClicks,     setCalClicks]     = useState(0);   // 0-1
  const [calSuccess,    setCalSuccess]    = useState(false);
  const [preparingGaze, setPreparingGaze] = useState(false);
  const [verifying,     setVerifying]     = useState(false);

  // Refs — used inside rAF to avoid stale closures
  const rawRef          = useRef<{ x: number; y: number } | null>(null);
  const smoothRef       = useRef<{ x: number; y: number } | null>(null);
  const gazeTargetRef   = useRef<string | null>(null);
  const gazeHoverRef    = useRef<string | null>(null);
  // Sample buffer for dwell voting
  type GazeSample = { id: string | null; ts: number };
  const sampleBufRef    = useRef<GazeSample[]>([]);

  // ── RAF loop ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gazeEnabled) return;
    let running = true;

    function loop() {
      if (!running) return;

      const raw = rawRef.current;
      if (raw != null) {
        // 1. Validate: reject NaN or off-screen coords
        const vw = window.innerWidth, vh = window.innerHeight;
        if (
          !isNaN(raw.x) && !isNaN(raw.y) &&
          raw.x >= 0 && raw.x <= vw && raw.y >= 0 && raw.y <= vh
        ) {
          // 2. Exponential moving average (0.70 old + 0.30 raw — responsive)
          const prev = smoothRef.current;
          if (!prev) {
            smoothRef.current = { x: raw.x, y: raw.y };
          } else {
            smoothRef.current = {
              x: prev.x * (1 - EMA_ALPHA) + raw.x * EMA_ALPHA,
              y: prev.y * (1 - EMA_ALPHA) + raw.y * EMA_ALPHA,
            };
          }

          const { x, y } = smoothRef.current;

          // 3. Move cursor immediately — no stability lock
          const cursorEl = document.getElementById('sameyba-gaze-cursor');
          if (cursorEl) {
            cursorEl.style.transform = `translate3d(${x - 14}px, ${y - 14}px, 0)`;
            cursorEl.style.opacity   = '1';
          }

          setGazePos({ x, y });

          // 4. Hit-test every frame → immediate hover indicator
          const hoverEl = document.elementFromPoint(x, y);
          const hovTgt  = hoverEl?.closest('[data-gaze-id]') as HTMLElement | null;
          const hitId   = hovTgt?.dataset.gazeId ?? null;
          if (hitId !== gazeHoverRef.current) {
            gazeHoverRef.current = hitId;
            setGazeHoverId(hitId);
          }

          // 5. Sample-based dwell voting
          //    Rolling 2s window; 70% of samples must be on the same card.
          //    Gaps < 200ms are forgiven (departure tolerance).
          const now_ms = performance.now();
          const buf = sampleBufRef.current;
          buf.push({ id: hitId, ts: now_ms });

          // Prune entries older than DWELL_WINDOW_MS
          const cutoff = now_ms - DWELL_WINDOW_MS;
          let pruneIdx = 0;
          while (pruneIdx < buf.length && buf[pruneIdx].ts < cutoff) pruneIdx++;
          if (pruneIdx > 0) buf.splice(0, pruneIdx);

          // Only vote after the window has accumulated enough data
          const windowAge = buf.length > 0 ? now_ms - buf[0].ts : 0;
          if (windowAge >= DWELL_MIN_WINDOW_MS) {
            // Apply departure tolerance: nulls within 200ms after a non-null
            // inherit that id (brief glances away are forgiven)
            const counts: Record<string, number> = {};
            let lastNonNull: { id: string; ts: number } | null = null;
            for (const s of buf) {
              if (s.id !== null) {
                counts[s.id] = (counts[s.id] ?? 0) + 1;
                lastNonNull = { id: s.id, ts: s.ts };
              } else if (
                lastNonNull &&
                s.ts - lastNonNull.ts <= DEPARTURE_TOLERANCE_MS
              ) {
                counts[lastNonNull.id] = (counts[lastNonNull.id] ?? 0) + 1;
              }
            }

            const total = buf.length;
            let newTargetId: string | null = null;
            for (const [id, count] of Object.entries(counts)) {
              if (count / total >= DWELL_THRESHOLD) {
                newTargetId = id;
                break;
              }
            }

            if (newTargetId !== gazeTargetRef.current) {
              gazeTargetRef.current = newTargetId;
              setGazeTargetId(newTargetId);
            }
          }
        }
      }

      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
    return () => { running = false; };
  }, [gazeEnabled]);

  // ── requestCamera ─────────────────────────────────────────────────────────────
  const requestCamera = useCallback(async () => {
    if (permissionState === 'requesting' || permissionState === 'granted') return;
    setPermissionState('requesting');
    setErrorLabel(null);

    console.group('[Sameyba/Gaze] Camera initialisation started');
    console.log('navigator.mediaDevices    :', navigator.mediaDevices ?? 'UNDEFINED');
    console.log('getUserMedia available    :', typeof navigator.mediaDevices?.getUserMedia);
    console.log('window.webgazer at start  :', window.webgazer ? 'loaded' : 'not yet loaded');
    console.log('location.protocol         :', location.protocol);

    // 1. Check mediaDevices support
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      console.error('[Sameyba/Gaze] navigator.mediaDevices not available');
      console.groupEnd();
      setErrorLabel('المتصفح لا يدعم الوصول إلى الكاميرا');
      setPermissionState('denied');
      return;
    }

    // 2. Probe getUserMedia — isolates permission errors from WebGazer
    let probeStream: MediaStream | null = null;
    try {
      console.log('[Sameyba/Gaze] Probing getUserMedia...');
      probeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      console.log('[Sameyba/Gaze] getUserMedia ✓ stream:', probeStream.id,
        '| tracks:', probeStream.getTracks().map(t => `${t.kind}:${t.readyState}`).join(', '));
    } catch (err) {
      const { kind, label } = classifyGetUserMediaError(err);
      console.error('[Sameyba/Gaze] getUserMedia ✗', kind, err);
      console.groupEnd();
      setErrorLabel(kind === 'permission-denied' ? null : label);
      setPermissionState('denied');
      return;
    }

    // 3. Wait for WebGazer CDN script (up to 10 s)
    let attempts = 0;
    while (!window.webgazer && attempts < 100) {
      await new Promise<void>(r => setTimeout(r, 100));
      attempts++;
    }
    console.log('[Sameyba/Gaze] webgazer:', window.webgazer ? '✓ loaded' : '✗ NOT loaded',
      `(${attempts * 100} ms wait)`);

    if (!window.webgazer) {
      probeStream.getTracks().forEach(t => t.stop());
      console.error('[Sameyba/Gaze] WebGazer script missing after 10 s');
      console.groupEnd();
      setErrorLabel('تم تشغيل الكاميرا ولكن تعذر تحميل نظام تتبع العين');
      setPermissionState('denied');
      return;
    }

    // 4. Release probe stream — WebGazer opens its own
    probeStream.getTracks().forEach(t => t.stop());
    console.log('[Sameyba/Gaze] Probe stream released; pausing 250 ms...');
    await new Promise<void>(r => setTimeout(r, 250));

    // 5. Initialise WebGazer
    try {
      const wg = window.webgazer!;

      // Override the default relative MediaPipe asset path
      if (wg.params) {
        const old = wg.params.faceMeshSolutionPath;
        wg.params.faceMeshSolutionPath = MEDIAPIPE_CDN;
        console.log(`[Sameyba/Gaze] faceMeshSolutionPath: "${String(old)}" → "${MEDIAPIPE_CDN}"`);
      } else {
        console.warn('[Sameyba/Gaze] wg.params missing — relying on fetch interceptor');
      }
      installMediaPipeFetchPatch();

      wg.setGazeListener((data) => {
        if (data) rawRef.current = { x: data.x, y: data.y };
      });
      wg.showVideoPreview(false);
      wg.showPredictionPoints(false);
      wg.showFaceOverlay?.(false);
      wg.showFaceFeedbackBox?.(false);

      console.log('[Sameyba/Gaze] Calling wg.begin()...');
      const result = await wg.begin();
      console.log('[Sameyba/Gaze] wg.begin() ✓ result:', result);

      setPermissionState('granted');

      // 5a. Wait for ≥10 non-null gaze predictions before calibrating.
      //     This warms up MediaPipe's face-mesh so calibration dots get real data.
      setPreparingGaze(true);
      console.log('[Sameyba/Gaze] Waiting for 10 warm-up samples...');
      await new Promise<void>((resolve) => {
        let resolved = false;
        let count = 0;
        const done = () => {
          if (!resolved) {
            resolved = true;
            // Restore the permanent gaze listener
            wg.setGazeListener((d) => {
              if (d) rawRef.current = { x: d.x, y: d.y };
            });
            resolve();
          }
        };
        wg.setGazeListener((data) => {
          if (data) {
            rawRef.current = { x: data.x, y: data.y };
            count++;
            if (count >= 10) done();
          }
        });
        setTimeout(done, 5000); // 5 s fallback
      });

      // 5b. Discard warm-up data so it doesn't corrupt the regression model.
      console.log('[Sameyba/Gaze] Warm-up done — clearing data before calibration');
      wg.clearData?.();
      rawRef.current    = null;
      smoothRef.current = null;
      sampleBufRef.current = [];
      setPreparingGaze(false);

      // 5c. Launch calibration
      setCalibrating(true);
      setCalStep(0);
      setCalClicks(0);
      setCalSuccess(false);
      console.log('[Sameyba/Gaze] Calibration started');
    } catch (err) {
      const e = err as Error;
      console.error('[Sameyba/Gaze] wg.begin() ✗', e?.name, e?.message, err);
      setErrorLabel(`تم تشغيل الكاميرا ولكن تعذر تشغيل تتبع العين. (${e?.name}: ${e?.message})`);
      setPermissionState('denied');
    }

    console.groupEnd();
  }, [permissionState]);

  // ── Calibration click handler ─────────────────────────────────────────────────
  const handleCalClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();

    // Record the ACTUAL pixel the user clicked — not a recomputed centre.
    if (window.webgazer?.recordScreenPosition) {
      window.webgazer.recordScreenPosition(e.clientX, e.clientY, 'click');
      console.log(
        `[Sameyba/Gaze] Cal ${calStep + 1}/9 click ${calClicks + 1}/${CLICKS_PER_POINT}` +
        ` at (${e.clientX}, ${e.clientY})`,
      );
    }

    const nextClicks = calClicks + 1;
    if (nextClicks < CLICKS_PER_POINT) {
      setCalClicks(nextClicks);
      return;
    }

    // Point complete
    const nextStep = calStep + 1;
    if (nextStep < CAL_POINTS.length) {
      setCalStep(nextStep);
      setCalClicks(0);
    } else {
      // All 9 points done — show success, then open verification screen
      console.log('[Sameyba/Gaze] Calibration complete ✓');
      setCalSuccess(true);
      setTimeout(() => {
        setCalibrating(false);
        // Reset all prediction data so calibration coords don't bleed into normal use
        rawRef.current       = null;
        smoothRef.current    = null;
        sampleBufRef.current = [];
        // Enable gaze so cursor moves during verification
        setGazeEnabled(true);
        setVerifying(true);
      }, 1800);
    }
  }, [calStep, calClicks]);

  // ── recalibrate ───────────────────────────────────────────────────────────────
  const recalibrate = useCallback(() => {
    if (permissionState !== 'granted') return;
    setGazeEnabled(false);
    setCalibrated(false);
    setVerifying(false);
    setCalSuccess(false);
    sampleBufRef.current = [];
    smoothRef.current    = null;
    rawRef.current       = null;
    window.webgazer?.clearData();
    setCalStep(0);
    setCalClicks(0);
    setCalibrating(true);
    console.log('[Sameyba/Gaze] Recalibration started');
  }, [permissionState]);

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (gazeEnabled) { try { window.webgazer?.end(); } catch { /* ignore */ } }
    };
  }, [gazeEnabled]);

  // ── Derived status ────────────────────────────────────────────────────────────
  const gazeStatus: GazeStatus = preparingGaze
    ? 'preparing'
    : calibrating
    ? 'calibrating'
    : verifying
    ? 'verifying'
    : !calibrated
    ? 'idle'
    : gazeTargetId !== null
    ? 'dwelling'
    : 'ready';

  return (
    <GazeContext.Provider value={{
      gazeEnabled, gazePos, gazeTargetId, permissionState,
      requestCamera, calibrated, gazeStatus, recalibrate,
    }}>
      {children}

      {/* Gaze cursor — hidden during verification (dedicated red dot used instead) */}
      {createPortal(
        <div
          id="sameyba-gaze-cursor"
          aria-hidden
          style={{
            position: 'fixed', top: 0, left: 0,
            width: 28, height: 28, borderRadius: '50%',
            background: 'rgba(0,122,255,0.22)',
            border: '2.5px solid rgba(0,122,255,0.80)',
            boxShadow: '0 0 14px rgba(0,122,255,0.50), 0 0 28px rgba(0,122,255,0.20)',
            pointerEvents: 'none', zIndex: 999998, opacity: 0,
            willChange: 'transform',
            display: (gazeEnabled && !verifying) ? 'block' : 'none',
            transition: 'opacity 0.15s',
          }}
        />,
        document.body,
      )}

      {/* "Preparing gaze" banner */}
      {createPortal(
        <AnimatePresence>
          {preparingGaze && <GazePreparingOverlay />}
        </AnimatePresence>,
        document.body,
      )}

      {/* Calibration overlay */}
      {createPortal(
        <AnimatePresence>
          {calibrating && (
            <CalibrationOverlay
              step={calStep}
              clicks={calClicks}
              success={calSuccess}
              onPointClick={handleCalClick}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Calibration verification screen */}
      {createPortal(
        <AnimatePresence>
          {verifying && (
            <CalibrationVerification
              gazePos={gazePos}
              onConfirm={() => {
                sampleBufRef.current = [];
                setCalibrated(true);
                setVerifying(false);
              }}
              onRecalibrate={recalibrate}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Gaze status indicator */}
      {createPortal(
        <AnimatePresence>
          {gazeEnabled && calibrated && (
            <GazeStatusIndicator
              hovering={gazeHoverId !== null}
              dwellActive={gazeTargetId !== null}
              onRecalibrate={recalibrate}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}

      {/* Camera permission banner */}
      {createPortal(
        <CameraPermissionBanner
          permissionState={permissionState}
          errorLabel={errorLabel}
          requestCamera={requestCamera}
        />,
        document.body,
      )}
    </GazeContext.Provider>
  );
}

// ── CalibrationOverlay ────────────────────────────────────────────────────────
function CalibrationOverlay({
  step, clicks, success, onPointClick,
}: {
  step: number;
  clicks: number;
  success: boolean;
  onPointClick: (e: React.MouseEvent) => void;
}) {
  const total   = CAL_POINTS.length * CLICKS_PER_POINT;
  const done    = step * CLICKS_PER_POINT + clicks;
  const pct     = Math.round((done / total) * 100);

  return (
    <motion.div
      key="cal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000000,
        background: 'rgba(5, 5, 20, 0.92)',
        backdropFilter: 'blur(6px)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        direction: 'rtl',
      }}
    >
      <AnimatePresence mode="wait">
        {success ? (
          /* ── Success state ── */
          <motion.div
            key="success"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            style={{ textAlign: 'center' }}
          >
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              style={{
                width: 96, height: 96, borderRadius: '50%', margin: '0 auto 28px',
                background: 'rgba(52,199,89,0.15)',
                border: '3px solid rgba(52,199,89,0.60)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '2.8rem',
              }}
            >
              ✅
            </motion.div>
            <p style={{ fontSize: '1.35rem', fontWeight: 700, color: '#fff', margin: '0 0 12px' }}>
              تمت معايرة تتبع العين بنجاح
            </p>
            <p style={{ fontSize: '0.92rem', color: 'rgba(255,255,255,0.55)', margin: 0 }}>
              جاري تفعيل تتبع العيون…
            </p>
          </motion.div>
        ) : (
          /* ── Calibration points ── */
          <motion.div
            key="points"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'absolute', inset: 0 }}
          >
            {/* Header */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', padding: '32px 24px 0',
            }}>
              <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>
                معايرة تتبع العين
              </p>
              <p style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.55)', margin: '0 0 4px' }}>
                انظر مباشرة إلى النقطة ثم اضغط عليها مرتين دون تحريك رأسك
              </p>
              <p style={{ fontSize: '0.80rem', color: 'rgba(255,255,255,0.35)', margin: '0 0 18px' }}>
                النقطة {step + 1} من {CAL_POINTS.length}
              </p>
              {/* Progress bar */}
              <div style={{
                width: 220, height: 5, borderRadius: 999,
                background: 'rgba(255,255,255,0.12)', overflow: 'hidden',
              }}>
                <motion.div
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.3 }}
                  style={{
                    height: '100%', borderRadius: 999,
                    background: 'linear-gradient(90deg, #007AFF, #34C759)',
                  }}
                />
              </div>
              <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', margin: '8px 0 0' }}>
                {pct}% مكتمل
              </p>
            </div>

            {/* Calibration dots */}
            {CAL_POINTS.map(([cf, rf], i) => {
              const isActive    = i === step;
              const isComplete  = i < step;
              const x = `${cf * 100}%`;
              const y = `${rf * 100}%`;
              return (
                <div
                  key={i}
                  style={{
                    position: 'absolute',
                    left: x, top: y,
                    transform: 'translate(-50%, -50%)',
                    cursor: isActive ? 'pointer' : 'default',
                    zIndex: 2,
                  }}
                >
                  {isActive ? (
                    <ActiveCalPoint clicks={clicks} onTap={onPointClick} />
                  ) : isComplete ? (
                    <CompleteCalPoint />
                  ) : (
                    <FutureCalPoint />
                  )}
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function ActiveCalPoint({ clicks, onTap }: { clicks: number; onTap: (e: React.MouseEvent) => void }) {
  return (
    <div
      onClick={onTap}
      style={{ position: 'relative', width: 64, height: 64, cursor: 'pointer' }}
    >
      {/* Outer pulse ring */}
      <motion.div
        animate={{ scale: [1, 1.55, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute', inset: -12,
          borderRadius: '50%',
          border: '2.5px solid rgba(0,122,255,0.5)',
        }}
      />
      {/* Inner circle */}
      <motion.div
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          width: '100%', height: '100%', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,122,255,0.9) 0%, rgba(0,122,255,0.5) 100%)',
          border: '2.5px solid rgba(255,255,255,0.8)',
          boxShadow: '0 0 24px rgba(0,122,255,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {/* Click counter dots */}
        <div style={{ display: 'flex', gap: 5 }}>
          {Array.from({ length: CLICKS_PER_POINT }).map((_, k) => (
            <div key={k} style={{
              width: 8, height: 8, borderRadius: '50%',
              background: k < clicks ? '#fff' : 'rgba(255,255,255,0.35)',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>
      </motion.div>
    </div>
  );
}

function CompleteCalPoint() {
  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      style={{
        width: 28, height: 28, borderRadius: '50%',
        background: 'rgba(52,199,89,0.25)',
        border: '2px solid rgba(52,199,89,0.70)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.85rem',
      }}
    >
      ✓
    </motion.div>
  );
}

function FutureCalPoint() {
  return (
    <div style={{
      width: 22, height: 22, borderRadius: '50%',
      background: 'rgba(255,255,255,0.08)',
      border: '1.5px solid rgba(255,255,255,0.18)',
    }} />
  );
}

// ── GazePreparingOverlay ──────────────────────────────────────────────────────
function GazePreparingOverlay() {
  return (
    <motion.div
      key="gaze-preparing"
      initial={{ opacity: 0, y: -60 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -60 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
        zIndex: 1000001,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 20px', borderRadius: 999,
        background: 'rgba(255,255,255,0.92)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.13), inset 0 1px 0 rgba(255,255,255,1)',
        border: '1px solid rgba(255,255,255,0.95)',
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        direction: 'rtl',
        whiteSpace: 'nowrap',
      }}
    >
      <div style={{
        width: 16, height: 16, borderRadius: '50%',
        border: '2px solid rgba(0,122,255,0.25)', borderTopColor: '#007AFF',
        animation: 'sameyba-spin 0.75s linear infinite', flexShrink: 0,
      }} />
      <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1C1C1E' }}>
        جاري تجهيز تتبع العين…
      </span>
    </motion.div>
  );
}

// ── CalibrationVerification ───────────────────────────────────────────────────
const VERIFY_TARGETS = [
  { id: 'center', label: 'المركز', x: '50%', y: '50%' },
  { id: 'top',    label: 'الأعلى', x: '50%', y: '10%' },
  { id: 'bottom', label: 'الأسفل', x: '50%', y: '90%' },
  { id: 'left',   label: 'اليسار', x: '10%', y: '50%' },
  { id: 'right',  label: 'اليمين', x: '90%', y: '50%' },
] as const;

function CalibrationVerification({
  gazePos, onConfirm, onRecalibrate,
}: {
  gazePos: { x: number; y: number } | null;
  onConfirm: () => void;
  onRecalibrate: () => void;
}) {
  return (
    <motion.div
      key="cal-verify"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000000,
        background: 'rgba(5, 5, 20, 0.92)',
        backdropFilter: 'blur(6px)',
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        direction: 'rtl',
      }}
    >
      {/* Header */}
      <div style={{
        position: 'absolute', top: '5%', left: 0, right: 0,
        textAlign: 'center',
      }}>
        <p style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fff', margin: '0 0 8px' }}>
          تحقق من المعايرة
        </p>
        <p style={{ fontSize: '0.88rem', color: 'rgba(255,255,255,0.55)', margin: 0 }}>
          انظر إلى كل نقطة — هل يتبعها المؤشر الأحمر؟
        </p>
      </div>

      {/* Test targets */}
      {VERIFY_TARGETS.map(t => (
        <div
          key={t.id}
          style={{
            position: 'absolute',
            left: t.x, top: t.y,
            transform: 'translate(-50%, -50%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          }}
        >
          <div style={{
            width: 46, height: 46, borderRadius: '50%',
            background: 'rgba(255,255,255,0.06)',
            border: '2px solid rgba(255,255,255,0.40)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: '50%',
              background: 'rgba(255,255,255,0.85)',
            }} />
          </div>
          <span style={{
            fontSize: '0.72rem', color: 'rgba(255,255,255,0.40)',
            fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            {t.label}
          </span>
        </div>
      ))}

      {/* Live gaze dot (red) */}
      {gazePos && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0,
            width: 22, height: 22, borderRadius: '50%',
            background: 'rgba(255, 55, 55, 0.55)',
            border: '2.5px solid rgba(255, 55, 55, 1)',
            pointerEvents: 'none',
            zIndex: 1000002,
            transform: `translate3d(${gazePos.x - 11}px, ${gazePos.y - 11}px, 0)`,
            willChange: 'transform',
            boxShadow: '0 0 10px rgba(255,55,55,0.6)',
          }}
        />
      )}

      {/* Action buttons */}
      <div style={{
        position: 'absolute', bottom: '8%', left: 0, right: 0,
        display: 'flex', justifyContent: 'center', gap: 12,
      }}>
        <button
          onClick={onRecalibrate}
          style={{
            padding: '12px 28px', borderRadius: 999,
            background: 'rgba(255,255,255,0.08)',
            border: '1.5px solid rgba(255,255,255,0.25)',
            color: 'rgba(255,255,255,0.80)',
            fontSize: '0.95rem', fontWeight: 700,
            cursor: 'pointer',
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
          }}
        >
          إعادة المعايرة
        </button>
        <button
          onClick={onConfirm}
          style={{
            padding: '12px 32px', borderRadius: 999,
            background: '#34C759', border: 'none',
            color: '#fff', fontSize: '0.95rem', fontWeight: 700,
            cursor: 'pointer',
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
          }}
        >
          المعايرة جيدة ✓
        </button>
      </div>
    </motion.div>
  );
}

// ── GazeStatusIndicator ───────────────────────────────────────────────────────
function GazeStatusIndicator({
  hovering, dwellActive, onRecalibrate,
}: {
  hovering: boolean;
  dwellActive: boolean;
  onRecalibrate: () => void;
}) {
  const label = dwellActive || hovering
    ? 'ثبّت نظرك للاختيار'
    : 'تتبع العين جاهز';
  const color = dwellActive ? '#34C759' : hovering ? '#007AFF' : 'rgba(255,255,255,0.65)';

  return (
    <motion.div
      key="gaze-status"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
        zIndex: 999997,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 10px 7px 18px',
        borderRadius: 999,
        background: 'rgba(15,15,25,0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.10)',
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        direction: 'rtl',
        pointerEvents: 'auto',
      }}
    >
      {/* Status dot */}
      <motion.div
        animate={{ opacity: dwellActive ? [1, 0.4, 1] : 1 }}
        transition={{ duration: 0.8, repeat: dwellActive ? Infinity : 0 }}
        style={{
          width: 7, height: 7, borderRadius: '50%',
          background: color,
          flexShrink: 0,
          boxShadow: `0 0 6px ${color}`,
        }}
      />
      <motion.span
        key={label}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        style={{ fontSize: '0.80rem', fontWeight: 600, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}
      >
        {label}
      </motion.span>

      {/* Recalibrate button */}
      <button
        onClick={onRecalibrate}
        title="إعادة المعايرة"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '4px 10px',
          borderRadius: 999,
          background: 'rgba(255,255,255,0.10)',
          border: '1px solid rgba(255,255,255,0.16)',
          color: 'rgba(255,255,255,0.70)',
          fontSize: '0.74rem', fontWeight: 600,
          cursor: 'pointer',
          fontFamily: "'IBM Plex Sans Arabic', sans-serif",
          flexShrink: 0,
          transition: 'background 0.15s, color 0.15s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.18)';
          (e.currentTarget as HTMLButtonElement).style.color = '#fff';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.10)';
          (e.currentTarget as HTMLButtonElement).style.color = 'rgba(255,255,255,0.70)';
        }}
      >
        {/* Refresh icon */}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
        </svg>
        معايرة
      </button>
    </motion.div>
  );
}

// ── CameraPermissionBanner ────────────────────────────────────────────────────
function CameraPermissionBanner({
  permissionState, errorLabel, requestCamera,
}: {
  permissionState: PermissionState;
  errorLabel: string | null;
  requestCamera: () => void;
}) {
  const visible = permissionState !== 'granted';

  const displayLabel =
    permissionState === 'denied'
      ? (errorLabel ?? 'تم رفض الكاميرا — يعمل التطبيق بالفأرة')
      : permissionState === 'requesting'
      ? 'جارٍ تفعيل تتبع العيون…'
      : 'فعّل تتبع العيون بالكاميرا';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="gaze-banner"
          initial={{ opacity: 0, y: -60 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -60 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)',
            zIndex: 999999, display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 16px', borderRadius: 999,
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,1)',
            border: '1px solid rgba(255,255,255,0.95)',
            direction: 'rtl', fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            whiteSpace: 'nowrap', maxWidth: 'min(92vw, 600px)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ color: permissionState === 'denied' ? '#FF3B30' : '#007AFF', flexShrink: 0 }}>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>

          <span style={{
            fontSize: '0.88rem', fontWeight: 600,
            color: permissionState === 'denied' ? '#C0392B' : '#1C1C1E',
            overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {displayLabel}
          </span>

          {permissionState === 'idle' && (
            <button onClick={requestCamera} style={{
              padding: '5px 14px', borderRadius: 999, background: '#007AFF',
              color: 'white', border: 'none', fontSize: '0.82rem', fontWeight: 700,
              cursor: 'pointer', fontFamily: "'IBM Plex Sans Arabic', sans-serif", flexShrink: 0,
            }}>
              تفعيل
            </button>
          )}
          {permissionState === 'denied' && (
            <button onClick={requestCamera} style={{
              padding: '5px 14px', borderRadius: 999, background: '#FF3B30',
              color: 'white', border: 'none', fontSize: '0.82rem', fontWeight: 700,
              cursor: 'pointer', fontFamily: "'IBM Plex Sans Arabic', sans-serif", flexShrink: 0,
            }}>
              إعادة المحاولة
            </button>
          )}
          {permissionState === 'requesting' && (
            <div style={{
              width: 16, height: 16, borderRadius: '50%',
              border: '2px solid rgba(0,122,255,0.25)', borderTopColor: '#007AFF',
              animation: 'sameyba-spin 0.75s linear infinite', flexShrink: 0,
            }} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
