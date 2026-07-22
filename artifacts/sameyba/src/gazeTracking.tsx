import {
  useState, useEffect, useRef, createContext, useContext, useCallback,
} from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

// ── WebGazer type declarations ─────────────────────────────────────────────────
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
      /** Mutable params object — includes faceMeshSolutionPath */
      params?: Record<string, unknown>;
    };
  }
}

// ── MediaPipe asset CDN redirect ───────────────────────────────────────────────
// WebGazer's default faceMeshSolutionPath is "./mediapipe/face_mesh" (relative),
// which resolves to the local dev server and returns HTML instead of JS/WASM.
// We intercept every fetch for those filenames and redirect to jsDelivr.
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
  window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
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
  console.log('[Sameyba/Gaze] fetch interceptor installed for MediaPipe assets');
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type PermissionState = 'idle' | 'requesting' | 'granted' | 'denied';

export type GazeContextShape = {
  gazeEnabled: boolean;
  gazePos: { x: number; y: number } | null;
  gazeTargetId: string | null;
  permissionState: PermissionState;
  requestCamera: () => void;
};

// ── Context ───────────────────────────────────────────────────────────────────
export const GazeContext = createContext<GazeContextShape>({
  gazeEnabled: false,
  gazePos: null,
  gazeTargetId: null,
  permissionState: 'idle',
  requestCamera: () => {},
});

export function useGazeContext() {
  return useContext(GazeContext);
}

// ── Helper: human-readable error reason ───────────────────────────────────────
type ErrorKind =
  | 'permission-denied'
  | 'no-camera'
  | 'camera-in-use'
  | 'aborted'
  | 'overconstrained'
  | 'security'
  | 'no-mediadevices'
  | 'webgazer-not-loaded'
  | 'webgazer-failed'
  | 'unknown';

interface GazeError {
  kind: ErrorKind;
  /** Short Arabic label shown in the banner */
  label: string;
  /** Extra detail (technical) */
  detail: string;
}

function classifyGetUserMediaError(err: unknown): GazeError {
  const e = err as DOMException;
  const name = e?.name ?? '';
  const msg  = e?.message ?? String(err);

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return { kind: 'permission-denied', label: 'تم رفض الكاميرا — يعمل التطبيق بالفأرة', detail: msg };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return { kind: 'no-camera', label: 'لم يتم العثور على كاميرا — تأكد من توصيل الكاميرا', detail: msg };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return { kind: 'camera-in-use', label: 'الكاميرا مستخدمة من تطبيق آخر — أغلقه ثم أعد المحاولة', detail: msg };
  }
  if (name === 'AbortError') {
    return { kind: 'aborted', label: 'تم إلغاء تشغيل الكاميرا — أعد المحاولة', detail: msg };
  }
  if (name === 'OverconstrainedError') {
    return { kind: 'overconstrained', label: 'مواصفات الكاميرا غير مدعومة — أعد المحاولة', detail: msg };
  }
  if (name === 'SecurityError') {
    return { kind: 'security', label: 'تم حظر الكاميرا بإعدادات الأمان', detail: msg };
  }
  return { kind: 'unknown', label: `خطأ في الكاميرا: ${name || msg}`, detail: msg };
}

// ── GazeProvider ──────────────────────────────────────────────────────────────
export function GazeProvider({ children }: { children: React.ReactNode }) {
  const [permissionState, setPermissionState] = useState<PermissionState>('idle');
  const [gazeEnabled, setGazeEnabled]         = useState(false);
  const [gazePos, setGazePos]                 = useState<{ x: number; y: number } | null>(null);
  const [gazeTargetId, setGazeTargetId]       = useState<string | null>(null);
  const [errorLabel, setErrorLabel]           = useState<string | null>(null);

  const rawRef        = useRef<{ x: number; y: number } | null>(null);
  const smoothRef     = useRef<{ x: number; y: number } | null>(null);
  const gazeTargetRef = useRef<string | null>(null);
  const gazePosRef    = useRef<{ x: number; y: number } | null>(null);

  // RAF loop — runs only when gazeEnabled
  useEffect(() => {
    if (!gazeEnabled) return;
    let running = true;

    function loop() {
      if (!running) return;
      if (rawRef.current) {
        if (!smoothRef.current) {
          smoothRef.current = { ...rawRef.current };
        } else {
          smoothRef.current.x += (rawRef.current.x - smoothRef.current.x) * 0.14;
          smoothRef.current.y += (rawRef.current.y - smoothRef.current.y) * 0.14;
        }
        const { x, y } = smoothRef.current;

        const cursorEl = document.getElementById('sameyba-gaze-cursor');
        if (cursorEl) {
          cursorEl.style.transform = `translate(${x - 14}px, ${y - 14}px)`;
          cursorEl.style.opacity   = '1';
        }

        gazePosRef.current = { x, y };
        setGazePos({ x, y });

        const el     = document.elementFromPoint(x, y);
        const target = el?.closest('[data-gaze-id]') as HTMLElement | null;
        const id     = target?.dataset.gazeId ?? null;
        if (id !== gazeTargetRef.current) {
          gazeTargetRef.current = id;
          setGazeTargetId(id);
        }
      }
      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
    return () => { running = false; };
  }, [gazeEnabled]);

  // ── Request camera permission and start WebGazer ────────────────────────────
  const requestCamera = useCallback(async () => {
    if (permissionState === 'requesting' || permissionState === 'granted') return;
    setPermissionState('requesting');
    setErrorLabel(null);

    // ── 0. Environment diagnostics ──────────────────────────────────────────
    console.group('[Sameyba/Gaze] Camera initialisation started');
    console.log('navigator.mediaDevices       :', navigator.mediaDevices ?? 'UNDEFINED');
    console.log('getUserMedia available       :', typeof navigator.mediaDevices?.getUserMedia);
    console.log('window.webgazer at start     :', window.webgazer ? 'loaded' : 'not yet loaded');
    console.log('location.protocol            :', location.protocol);
    console.log('userAgent                    :', navigator.userAgent);

    // ── 1. Check mediaDevices API support ───────────────────────────────────
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      const label = 'المتصفح لا يدعم الوصول إلى الكاميرا — جرّب Chrome أو Safari الحديث';
      console.error('[Sameyba/Gaze] navigator.mediaDevices not available');
      console.groupEnd();
      setErrorLabel(label);
      setPermissionState('denied');
      return;
    }

    // ── 2. Probe getUserMedia to verify permission ───────────────────────────
    //    This isolates camera permission errors from WebGazer init errors.
    let probeStream: MediaStream | null = null;
    try {
      console.log('[Sameyba/Gaze] Probing getUserMedia({ video: true })...');
      probeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      console.log('[Sameyba/Gaze] getUserMedia ✓  stream id:', probeStream.id,
        '| tracks:', probeStream.getTracks().map(t => `${t.kind}:${t.readyState}`).join(', '));
    } catch (err: unknown) {
      const gaze = classifyGetUserMediaError(err);
      console.error('[Sameyba/Gaze] getUserMedia ✗  kind:', gaze.kind, '| detail:', gaze.detail, err);
      console.groupEnd();
      // Only set errorLabel for non-permission-denied errors;
      // the banner already has a fixed label for the denied state.
      setErrorLabel(gaze.kind === 'permission-denied' ? null : gaze.label);
      setPermissionState('denied');
      return;
    }

    // ── 3. Check WebGazer CDN script (wait up to 10 s) ──────────────────────
    let attempts = 0;
    while (!window.webgazer && attempts < 100) {
      await new Promise<void>(r => setTimeout(r, 100));
      attempts++;
    }
    console.log('[Sameyba/Gaze] webgazer script:', window.webgazer ? '✓ loaded' : '✗ NOT loaded',
      `(waited ${attempts * 100} ms)`);

    if (!window.webgazer) {
      // Camera works fine — WebGazer CDN didn't load
      probeStream.getTracks().forEach(t => t.stop());
      const label = 'تم تشغيل الكاميرا ولكن تعذر تحميل نظام تتبع العين — تحقق من اتصال الإنترنت';
      console.error('[Sameyba/Gaze] WebGazer script missing after 10 s');
      console.groupEnd();
      setErrorLabel(label);
      setPermissionState('denied');
      return;
    }

    // ── 4. Release probe stream — WebGazer will open its own ────────────────
    probeStream.getTracks().forEach(t => t.stop());
    console.log('[Sameyba/Gaze] Probe stream stopped; pausing 250 ms before wg.begin()...');
    await new Promise<void>(r => setTimeout(r, 250));

    // ── 5. Initialise WebGazer ───────────────────────────────────────────────
    try {
      const wg = window.webgazer!;

      // ── 5a. Override the default relative MediaPipe asset path ─────────────
      // WebGazer ships with faceMeshSolutionPath:"./mediapipe/face_mesh".
      // That relative URL resolves to the local dev server → returns HTML → crash.
      // Setting it to the jsDelivr CDN fixes asset loading on every platform.
      if (wg.params) {
        const oldPath = wg.params.faceMeshSolutionPath;
        wg.params.faceMeshSolutionPath = MEDIAPIPE_CDN;
        console.log(
          `[Sameyba/Gaze] params.faceMeshSolutionPath: "${String(oldPath)}" → "${MEDIAPIPE_CDN}"`,
        );
      } else {
        console.warn('[Sameyba/Gaze] wg.params not found — relying on fetch interceptor only');
      }

      // ── 5b. Install fetch interceptor as a safety net ──────────────────────
      // Catches any face_mesh asset URLs that still slip through with wrong origin.
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
      console.log('[Sameyba/Gaze] wg.begin() ✓  resolved with:', result);

      setPermissionState('granted');
      setGazeEnabled(true);
      console.log('[Sameyba/Gaze] Eye tracking active ✓');
    } catch (err: unknown) {
      const e = err as Error;
      // At this point getUserMedia succeeded, so this is a WebGazer-internal failure.
      const label = `تم تشغيل الكاميرا ولكن تعذر تشغيل تتبع العين. (${e?.name ?? ''}: ${e?.message ?? String(err)})`;
      console.error('[Sameyba/Gaze] wg.begin() ✗ ', e?.name, e?.message, err);
      setErrorLabel(label);
      setPermissionState('denied');
    }

    console.groupEnd();
  }, [permissionState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gazeEnabled) { try { window.webgazer?.end(); } catch { /* ignore */ } }
    };
  }, [gazeEnabled]);

  return (
    <GazeContext.Provider value={{ gazeEnabled, gazePos, gazeTargetId, permissionState, requestCamera }}>
      {children}

      {/* Gaze cursor — direct DOM transform for zero-lag updates */}
      {createPortal(
        <div
          id="sameyba-gaze-cursor"
          aria-hidden
          style={{
            position: 'fixed',
            top: 0, left: 0,
            width: 28, height: 28,
            borderRadius: '50%',
            background: 'rgba(0,122,255,0.22)',
            border: '2.5px solid rgba(0,122,255,0.80)',
            boxShadow: '0 0 14px rgba(0,122,255,0.50), 0 0 28px rgba(0,122,255,0.20)',
            pointerEvents: 'none',
            zIndex: 999998,
            opacity: 0,
            willChange: 'transform',
            display: gazeEnabled ? 'block' : 'none',
          }}
        />,
        document.body,
      )}

      {/* Camera permission / status banner */}
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

// ── CameraPermissionBanner ────────────────────────────────────────────────────
function CameraPermissionBanner({
  permissionState,
  errorLabel,
  requestCamera,
}: {
  permissionState: PermissionState;
  errorLabel: string | null;
  requestCamera: () => void;
}) {
  const visible = permissionState !== 'granted';

  // Compose the display label
  const displayLabel =
    permissionState === 'denied'
      // Use specific error if available, fall back to generic "denied" text
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
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 16px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            boxShadow:
              '0 8px 32px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,1)',
            border: '1px solid rgba(255,255,255,0.95)',
            direction: 'rtl',
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            whiteSpace: 'nowrap',
            maxWidth: 'min(92vw, 640px)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {/* Eye icon */}
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
            <button
              onClick={requestCamera}
              style={{
                padding: '5px 14px',
                borderRadius: 999,
                background: '#007AFF',
                color: 'white',
                border: 'none',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: "'IBM Plex Sans Arabic', sans-serif",
                flexShrink: 0,
              }}
            >
              تفعيل
            </button>
          )}

          {permissionState === 'denied' && (
            <button
              onClick={requestCamera}
              style={{
                padding: '5px 14px',
                borderRadius: 999,
                background: '#FF3B30',
                color: 'white',
                border: 'none',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                fontFamily: "'IBM Plex Sans Arabic', sans-serif",
                flexShrink: 0,
              }}
            >
              إعادة المحاولة
            </button>
          )}

          {permissionState === 'requesting' && (
            <div style={{
              width: 16, height: 16,
              borderRadius: '50%',
              border: '2px solid rgba(0,122,255,0.25)',
              borderTopColor: '#007AFF',
              animation: 'sameyba-spin 0.75s linear infinite',
              flexShrink: 0,
            }} />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
