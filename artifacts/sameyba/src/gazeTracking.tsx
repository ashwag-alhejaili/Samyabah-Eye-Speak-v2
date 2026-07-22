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
export type GazeStatus = 'idle' | 'calibrating' | 'ready' | 'dwelling';

export type GazeContextShape = {
  gazeEnabled:     boolean;
  gazePos:         { x: number; y: number } | null;
  gazeTargetId:    string | null;
  permissionState: PermissionState;
  requestCamera:   () => void;
  calibrated:      boolean;
  gazeStatus:      GazeStatus;
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

// ── Calibration geometry ──────────────────────────────────────────────────────
/** 9-point grid as [colFraction, rowFraction] */
const CAL_POINTS: [number, number][] = [
  [0.10, 0.12], [0.50, 0.12], [0.90, 0.12],
  [0.10, 0.50], [0.50, 0.50], [0.90, 0.50],
  [0.10, 0.88], [0.50, 0.88], [0.90, 0.88],
];

/** Gaze must stay within this radius (px) of the calibration point */
const CAL_RADIUS_PX = 60;
/** Gaze must stay on point for this long (ms) before the point is recorded */
const CAL_HOLD_MS   = 1000;
/** If no gaze data arrives within this time (ms), offer touch/click fallback */
const CAL_FALLBACK_TIMEOUT_MS = 3000;

/** SVG ring geometry */
const RING_R = 42;   // px — ring radius inside the 100×100 SVG
const RING_C = 2 * Math.PI * RING_R; // circumference ≈ 263.9

// ── Post-calibration gaze constants ───────────────────────────────────────────
const EMA_ALPHA      = 0.15;  // weight on raw sample
const JUMP_THRESHOLD = 180;   // px — discard raw jumps larger than this
const STAB_RADIUS    = 70;    // px — stability zone radius
const STAB_MS        = 1200;  // ms — lock time before dwell fires

// ── GazeProvider ──────────────────────────────────────────────────────────────
export function GazeProvider({ children }: { children: React.ReactNode }) {
  // Permission / lifecycle
  const [permissionState, setPermissionState] = useState<PermissionState>('idle');
  const [errorLabel, setErrorLabel]           = useState<string | null>(null);
  // Gaze output
  const [gazeEnabled,  setGazeEnabled]  = useState(false);
  const [gazePos,      setGazePos]      = useState<{ x: number; y: number } | null>(null);
  const [gazeTargetId, setGazeTargetId] = useState<string | null>(null);
  const [gazeHoverId,  setGazeHoverId]  = useState<string | null>(null);
  // Calibration phase
  const [calibrating, setCalibrating]  = useState(false);
  const [calibrated,  setCalibrated]   = useState(false);

  // Refs
  const rawRef        = useRef<{ x: number; y: number } | null>(null);
  const smoothRef     = useRef<{ x: number; y: number } | null>(null);
  const gazeTargetRef = useRef<string | null>(null);
  const gazeHoverRef  = useRef<string | null>(null);
  const stabCenterRef = useRef<{ x: number; y: number } | null>(null);
  const stabStartRef  = useRef<number>(0);
  const calibratingRef = useRef(false);
  calibratingRef.current = calibrating;

  // ── Post-calibration RAF loop ─────────────────────────────────────────────────
  useEffect(() => {
    if (!gazeEnabled) return;
    let running = true;

    function loop(now: number) {
      if (!running) return;
      const raw = rawRef.current;
      if (raw != null) {
        const vw = window.innerWidth, vh = window.innerHeight;
        if (!isNaN(raw.x) && !isNaN(raw.y) && raw.x >= 0 && raw.x <= vw && raw.y >= 0 && raw.y <= vh) {
          const prev = smoothRef.current;
          const dist = prev ? Math.hypot(raw.x - prev.x, raw.y - prev.y) : 0;
          if (!prev || dist <= JUMP_THRESHOLD) {
            smoothRef.current = !prev
              ? { x: raw.x, y: raw.y }
              : { x: prev.x * (1 - EMA_ALPHA) + raw.x * EMA_ALPHA,
                  y: prev.y * (1 - EMA_ALPHA) + raw.y * EMA_ALPHA };

            const { x, y } = smoothRef.current;

            // Cursor
            const cursorEl = document.getElementById('sameyba-gaze-cursor');
            if (cursorEl) {
              cursorEl.style.transform = `translate3d(${x - 14}px, ${y - 14}px, 0)`;
              cursorEl.style.opacity   = '1';
            }
            setGazePos({ x, y });

            // Pre-stability hover
            const hoverEl = document.elementFromPoint(x, y);
            const hovTgt  = hoverEl?.closest('[data-gaze-id]') as HTMLElement | null;
            const hovId   = hovTgt?.dataset.gazeId ?? null;
            if (hovId !== gazeHoverRef.current) {
              gazeHoverRef.current = hovId;
              setGazeHoverId(hovId);
            }

            // Stability → gazeTargetId
            const sc = stabCenterRef.current;
            const dFromCenter = sc ? Math.hypot(x - sc.x, y - sc.y) : Infinity;
            if (!sc || dFromCenter > STAB_RADIUS) {
              stabCenterRef.current = { x, y };
              stabStartRef.current  = now;
              if (gazeTargetRef.current !== null) { gazeTargetRef.current = null; setGazeTargetId(null); }
            } else if (now - stabStartRef.current >= STAB_MS) {
              const stEl  = document.elementFromPoint(sc.x, sc.y);
              const stTgt = stEl?.closest('[data-gaze-id]') as HTMLElement | null;
              const stId  = stTgt?.dataset.gazeId ?? null;
              if (stId !== gazeTargetRef.current) { gazeTargetRef.current = stId; setGazeTargetId(stId); }
            }
          }
        }
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    return () => { running = false; };
  }, [gazeEnabled]);

  // ── Calibration complete callback ─────────────────────────────────────────────
  const handleCalDone = useCallback(() => {
    setCalibrating(false);
    setCalibrated(true);
    setGazeEnabled(true);
    stabCenterRef.current = null;
    stabStartRef.current  = 0;
    console.log('[Sameyba/Gaze] Calibration complete — gaze enabled ✓');
  }, []);

  // ── requestCamera ─────────────────────────────────────────────────────────────
  const requestCamera = useCallback(async () => {
    if (permissionState === 'requesting' || permissionState === 'granted') return;
    setPermissionState('requesting');
    setErrorLabel(null);

    console.group('[Sameyba/Gaze] Camera initialisation');
    console.log('navigator.mediaDevices   :', navigator.mediaDevices ?? 'UNDEFINED');
    console.log('getUserMedia available   :', typeof navigator.mediaDevices?.getUserMedia);
    console.log('window.webgazer at start :', window.webgazer ? 'loaded' : 'not yet');
    console.log('location.protocol        :', location.protocol);

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      console.error('[Sameyba/Gaze] navigator.mediaDevices not available');
      console.groupEnd();
      setErrorLabel('المتصفح لا يدعم الوصول إلى الكاميرا');
      setPermissionState('denied');
      return;
    }

    let probeStream: MediaStream | null = null;
    try {
      probeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      console.log('[Sameyba/Gaze] getUserMedia ✓', probeStream.id);
    } catch (err) {
      const { kind, label } = classifyGetUserMediaError(err);
      console.error('[Sameyba/Gaze] getUserMedia ✗', kind, err);
      console.groupEnd();
      setErrorLabel(kind === 'permission-denied' ? null : label);
      setPermissionState('denied');
      return;
    }

    let attempts = 0;
    while (!window.webgazer && attempts < 100) {
      await new Promise<void>(r => setTimeout(r, 100));
      attempts++;
    }
    console.log('[Sameyba/Gaze] webgazer:', window.webgazer ? '✓' : '✗ NOT loaded', `(${attempts * 100} ms)`);

    if (!window.webgazer) {
      probeStream.getTracks().forEach(t => t.stop());
      console.error('[Sameyba/Gaze] WebGazer missing after 10 s');
      console.groupEnd();
      setErrorLabel('تم تشغيل الكاميرا ولكن تعذر تحميل نظام تتبع العين');
      setPermissionState('denied');
      return;
    }

    probeStream.getTracks().forEach(t => t.stop());
    await new Promise<void>(r => setTimeout(r, 250));

    try {
      const wg = window.webgazer!;
      if (wg.params) {
        wg.params.faceMeshSolutionPath = MEDIAPIPE_CDN;
        console.log(`[Sameyba/Gaze] faceMeshSolutionPath → "${MEDIAPIPE_CDN}"`);
      }
      installMediaPipeFetchPatch();

      wg.setGazeListener((data) => {
        if (data) rawRef.current = { x: data.x, y: data.y };
      });
      wg.showVideoPreview(false);
      wg.showPredictionPoints(false);
      wg.showFaceOverlay?.(false);
      wg.showFaceFeedbackBox?.(false);

      console.log('[Sameyba/Gaze] wg.begin()...');
      await wg.begin();
      console.log('[Sameyba/Gaze] wg.begin() ✓');

      setPermissionState('granted');
      setCalibrating(true);
      console.log('[Sameyba/Gaze] Calibration phase started');
    } catch (err) {
      const e = err as Error;
      console.error('[Sameyba/Gaze] wg.begin() ✗', e?.name, e?.message, err);
      setErrorLabel(`تم تشغيل الكاميرا ولكن تعذر تشغيل تتبع العين. (${e?.name}: ${e?.message})`);
      setPermissionState('denied');
    }
    console.groupEnd();
  }, [permissionState]);

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (gazeEnabled) { try { window.webgazer?.end(); } catch { /* ignore */ } }
    };
  }, [gazeEnabled]);

  // ── Derived status ────────────────────────────────────────────────────────────
  const gazeStatus: GazeStatus = calibrating
    ? 'calibrating'
    : !calibrated
    ? 'idle'
    : gazeTargetId !== null
    ? 'dwelling'
    : 'ready';

  return (
    <GazeContext.Provider value={{
      gazeEnabled, gazePos, gazeTargetId, permissionState,
      requestCamera, calibrated, gazeStatus,
    }}>
      {children}

      {/* Gaze cursor */}
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
            display: gazeEnabled ? 'block' : 'none',
            transition: 'opacity 0.15s',
          }}
        />,
        document.body,
      )}

      {/* Calibration overlay */}
      {createPortal(
        <AnimatePresence>
          {calibrating && (
            <CalibrationOverlay rawRef={rawRef} onDone={handleCalDone} />
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
// All calibration state lives here; GazeProvider only provides rawRef + onDone.
function CalibrationOverlay({
  rawRef,
  onDone,
}: {
  rawRef: React.MutableRefObject<{ x: number; y: number } | null>;
  onDone: () => void;
}) {
  const [step,    setStep]    = useState(0);
  const [success, setSuccess] = useState(false);
  // fallback = true when gaze data never arrived within CAL_FALLBACK_TIMEOUT_MS
  const [fallback, setFallback] = useState(false);

  // Refs used inside the rAF loop (avoid stale closure captures)
  const stepRef      = useRef(0);
  stepRef.current    = step;
  const successRef   = useRef(false);
  successRef.current = success;
  const fallbackRef  = useRef(false);
  fallbackRef.current = fallback;

  const holdStartRef  = useRef<number | null>(null);
  const gazeSeenRef   = useRef(false);
  const doneCalledRef = useRef(false);
  // Ref to the SVG progress arc — updated directly from rAF for zero-lag visuals
  const ringRef = useRef<SVGCircleElement | null>(null);

  // Helper: record a point and advance (or finish)
  const advanceStep = useCallback((completedStep: number) => {
    const [cf, rf] = CAL_POINTS[completedStep];
    const px = Math.round(cf * window.innerWidth);
    const py = Math.round(rf * window.innerHeight);
    window.webgazer?.recordScreenPosition?.(px, py, 'click');
    console.log(`[Sameyba/Gaze] Cal ${completedStep + 1}/9 recorded at (${px},${py})`);

    const next = completedStep + 1;
    if (next >= CAL_POINTS.length) {
      successRef.current = true;
      setSuccess(true);
      if (!doneCalledRef.current) {
        doneCalledRef.current = true;
        setTimeout(onDone, 1800);
      }
    } else {
      stepRef.current = next; // immediate — so the next rAF frame uses the new step
      setStep(next);
    }
    holdStartRef.current = null;
  }, [onDone]);

  // ── rAF loop — gaze-hold detection ───────────────────────────────────────────
  // Re-runs only when fallback changes (loop stops in fallback mode).
  useEffect(() => {
    if (fallback) return;

    let rafId: number;

    // After CAL_FALLBACK_TIMEOUT_MS with no gaze, offer touch fallback
    const fbTimer = setTimeout(() => {
      if (!gazeSeenRef.current && !successRef.current) {
        console.warn('[Sameyba/Gaze] No gaze data — switching to touch fallback');
        setFallback(true);
        fallbackRef.current = true;
      }
    }, CAL_FALLBACK_TIMEOUT_MS);

    function loop(now: number) {
      if (successRef.current || fallbackRef.current) return;

      const raw = rawRef.current;
      const [cf, rf] = CAL_POINTS[stepRef.current];
      const cx = cf * window.innerWidth;
      const cy = rf * window.innerHeight;

      if (raw && !isNaN(raw.x) && !isNaN(raw.y)) {
        gazeSeenRef.current = true;
        const dist = Math.hypot(raw.x - cx, raw.y - cy);

        if (dist <= CAL_RADIUS_PX) {
          // Gaze inside radius — accumulate hold time
          if (holdStartRef.current === null) holdStartRef.current = now;
          const held     = now - holdStartRef.current;
          const progress = Math.min(held / CAL_HOLD_MS, 1);

          // Update ring arc directly (no React state → no re-render)
          if (ringRef.current) {
            ringRef.current.style.strokeDashoffset = String(RING_C * (1 - progress));
            ringRef.current.style.opacity = '1';
          }

          if (held >= CAL_HOLD_MS) {
            // Hold complete — record & advance
            if (ringRef.current) {
              ringRef.current.style.strokeDashoffset = String(RING_C);
              ringRef.current.style.opacity = '0';
            }
            advanceStep(stepRef.current);
          }
        } else {
          // Gaze left radius — reset hold
          holdStartRef.current = null;
          if (ringRef.current) {
            ringRef.current.style.strokeDashoffset = String(RING_C);
            ringRef.current.style.opacity = '0';
          }
        }
      }

      rafId = requestAnimationFrame(loop);
    }

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(fbTimer);
    };
  }, [rawRef, fallback, advanceStep]);

  // ── Fallback: single click per point ─────────────────────────────────────────
  const handleFallbackClick = useCallback(() => {
    if (!fallbackRef.current || successRef.current) return;
    advanceStep(stepRef.current);
  }, [advanceStep]);

  // ── Render ────────────────────────────────────────────────────────────────────
  const totalDots  = CAL_POINTS.length;
  const pctDone    = Math.round((step / totalDots) * 100);

  return (
    <motion.div
      key="cal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000000,
        background: 'rgba(5, 5, 20, 0.93)',
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
            {/* ── Header ── */}
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0,
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: '28px 24px 0',
            }}>
              {/* Mode badge */}
              {fallback && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={{
                    marginBottom: 10, padding: '4px 14px', borderRadius: 999,
                    background: 'rgba(255,149,0,0.18)',
                    border: '1px solid rgba(255,149,0,0.45)',
                    fontSize: '0.78rem', fontWeight: 700,
                    color: 'rgba(255,149,0,0.95)',
                  }}
                >
                  وضع المعايرة باللمس
                </motion.div>
              )}

              <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>
                {fallback ? 'اضغط على النقطة المضيئة' : 'ثبّت نظرك على النقطة'}
              </p>
              <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.50)', margin: '0 0 16px' }}>
                النقطة {step + 1} من 9
              </p>

              {/* Progress bar */}
              <div style={{
                width: 200, height: 4, borderRadius: 999,
                background: 'rgba(255,255,255,0.10)', overflow: 'hidden',
              }}>
                <motion.div
                  animate={{ width: `${pctDone}%` }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  style={{
                    height: '100%', borderRadius: 999,
                    background: fallback
                      ? 'linear-gradient(90deg, #FF9500, #FFCC00)'
                      : 'linear-gradient(90deg, #007AFF, #34C759)',
                  }}
                />
              </div>
            </div>

            {/* ── Calibration dots ── */}
            {CAL_POINTS.map(([cf, rf], i) => {
              const isActive   = i === step;
              const isComplete = i < step;
              return (
                <div
                  key={i}
                  onClick={isActive && fallback ? handleFallbackClick : undefined}
                  style={{
                    position: 'absolute',
                    left: `${cf * 100}%`,
                    top:  `${rf * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    cursor: isActive && fallback ? 'pointer' : 'default',
                    zIndex: isActive ? 2 : 1,
                  }}
                >
                  {isActive ? (
                    // Wrapper has key={step} so the ring ref reattaches on step change
                    <ActiveCalPoint key={step} ringRef={ringRef} fallback={fallback} />
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

// ── ActiveCalPoint ────────────────────────────────────────────────────────────
// Pulsing dot + SVG progress ring. Ring is driven entirely via DOM ref from rAF.
function ActiveCalPoint({
  ringRef,
  fallback,
}: {
  ringRef: React.MutableRefObject<SVGCircleElement | null>;
  fallback: boolean;
}) {
  const dotColor = fallback
    ? 'radial-gradient(circle, rgba(255,149,0,0.95) 0%, rgba(255,149,0,0.55) 100%)'
    : 'radial-gradient(circle, rgba(0,122,255,0.95) 0%, rgba(0,122,255,0.55) 100%)';
  const glowColor = fallback
    ? '0 0 24px rgba(255,149,0,0.65)'
    : '0 0 24px rgba(0,122,255,0.65)';
  const pulseColor = fallback
    ? 'rgba(255,149,0,0.45)'
    : 'rgba(0,122,255,0.45)';
  const ringColor = fallback ? '#FF9500' : '#007AFF';

  return (
    <div style={{ position: 'relative', width: 52, height: 52 }}>
      {/* SVG ring — 100×100 centred over the dot */}
      <svg
        width={100} height={100}
        style={{
          position: 'absolute',
          top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        {/* Background track */}
        <circle
          cx={50} cy={50} r={RING_R}
          fill="none"
          stroke="rgba(255,255,255,0.10)"
          strokeWidth={3.5}
        />
        {/* Progress arc — updated via ringRef in rAF loop */}
        <circle
          ref={ringRef}
          cx={50} cy={50} r={RING_R}
          fill="none"
          stroke={ringColor}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={String(RING_C)}
          strokeDashoffset={String(RING_C)}
          style={{
            transform: 'rotate(-90deg)',
            transformOrigin: '50px 50px',
            opacity: 0,
            transition: 'none',
          }}
        />
      </svg>

      {/* Outer pulse ring */}
      <motion.div
        animate={{ scale: [1, 1.65, 1], opacity: [0.55, 0, 0.55] }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          position: 'absolute', inset: -10, borderRadius: '50%',
          border: `2px solid ${pulseColor}`,
          pointerEvents: 'none',
        }}
      />

      {/* Dot */}
      <motion.div
        animate={{ scale: [1, 1.07, 1] }}
        transition={{ duration: 1.0, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          width: '100%', height: '100%', borderRadius: '50%',
          background: dotColor,
          border: '2.5px solid rgba(255,255,255,0.85)',
          boxShadow: glowColor,
        }}
      />
    </div>
  );
}

// ── CompleteCalPoint ──────────────────────────────────────────────────────────
function CompleteCalPoint() {
  return (
    <motion.div
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      style={{
        width: 26, height: 26, borderRadius: '50%',
        background: 'rgba(52,199,89,0.22)',
        border: '2px solid rgba(52,199,89,0.70)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.8rem', color: 'rgba(52,199,89,0.9)',
        fontWeight: 700,
      }}
    >
      ✓
    </motion.div>
  );
}

// ── FutureCalPoint ────────────────────────────────────────────────────────────
function FutureCalPoint() {
  return (
    <div style={{
      width: 20, height: 20, borderRadius: '50%',
      background: 'rgba(255,255,255,0.07)',
      border: '1.5px solid rgba(255,255,255,0.15)',
    }} />
  );
}

// ── GazeStatusIndicator ───────────────────────────────────────────────────────
function GazeStatusIndicator({
  hovering, dwellActive,
}: {
  hovering: boolean;
  dwellActive: boolean;
}) {
  const label = dwellActive || hovering ? 'ثبّت نظرك للاختيار' : 'تتبع العين جاهز';
  const color = dwellActive ? '#34C759' : hovering ? '#007AFF' : 'rgba(255,255,255,0.55)';

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
        display: 'flex', alignItems: 'center', gap: 8, padding: '7px 18px',
        borderRadius: 999,
        background: 'rgba(15,15,25,0.76)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.10)',
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        direction: 'rtl', pointerEvents: 'none',
      }}
    >
      <motion.div
        animate={{ opacity: dwellActive ? [1, 0.4, 1] : 1 }}
        transition={{ duration: 0.85, repeat: dwellActive ? Infinity : 0 }}
        style={{
          width: 7, height: 7, borderRadius: '50%',
          background: color, flexShrink: 0,
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
