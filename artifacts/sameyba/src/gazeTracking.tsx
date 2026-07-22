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
    };
  }
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

// ── GazeProvider ──────────────────────────────────────────────────────────────
export function GazeProvider({ children }: { children: React.ReactNode }) {
  const [permissionState, setPermissionState] = useState<PermissionState>('idle');
  const [gazeEnabled, setGazeEnabled]         = useState(false);
  const [gazePos, setGazePos]                 = useState<{ x: number; y: number } | null>(null);
  const [gazeTargetId, setGazeTargetId]       = useState<string | null>(null);

  const rawRef         = useRef<{ x: number; y: number } | null>(null);
  const smoothRef      = useRef<{ x: number; y: number } | null>(null);
  const gazeTargetRef  = useRef<string | null>(null);
  const gazePosRef     = useRef<{ x: number; y: number } | null>(null);

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

        // Update cursor via direct DOM style to avoid React re-render on every frame
        const cursorEl = document.getElementById('sameyba-gaze-cursor');
        if (cursorEl) {
          cursorEl.style.transform = `translate(${x - 14}px, ${y - 14}px)`;
          cursorEl.style.opacity = '1';
        }

        gazePosRef.current = { x, y };
        setGazePos({ x, y });

        // Hit-test — find the deepest element with data-gaze-id
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

  // Request camera permission and start WebGazer
  const requestCamera = useCallback(async () => {
    if (permissionState === 'requesting' || permissionState === 'granted') return;
    setPermissionState('requesting');

    // Wait up to 10 s for the CDN script to load
    let attempts = 0;
    while (!window.webgazer && attempts < 100) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    if (!window.webgazer) {
      setPermissionState('denied');
      return;
    }

    try {
      // Non-null assertion safe: we checked window.webgazer above
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const wg = window.webgazer!;
      // Avoid method chaining — return types include undefined and break the chain
      wg.setGazeListener((data) => {
        if (data) rawRef.current = { x: data.x, y: data.y };
      });
      wg.showVideoPreview(false);
      wg.showPredictionPoints(false);
      wg.showFaceOverlay?.(false);
      wg.showFaceFeedbackBox?.(false);

      await wg.begin();
      setPermissionState('granted');
      setGazeEnabled(true);
    } catch {
      setPermissionState('denied');
    }
  }, [permissionState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gazeEnabled) { try { window.webgazer?.end(); } catch {} }
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
            top: 0,
            left: 0,
            width: 28,
            height: 28,
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
      {createPortal(<CameraPermissionBanner permissionState={permissionState} requestCamera={requestCamera} />, document.body)}
    </GazeContext.Provider>
  );
}

// ── CameraPermissionBanner ────────────────────────────────────────────────────
function CameraPermissionBanner({
  permissionState,
  requestCamera,
}: {
  permissionState: PermissionState;
  requestCamera: () => void;
}) {
  const visible = permissionState !== 'granted';

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
          }}
        >
          {/* Eye icon SVG (no lucide dependency here) */}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ color: '#007AFF', flexShrink: 0 }}>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>

          <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1C1C1E' }}>
            {permissionState === 'denied'
              ? 'تم رفض الكاميرا — يعمل التطبيق بالفأرة'
              : permissionState === 'requesting'
              ? 'جارٍ تفعيل تتبع العيون…'
              : 'فعّل تتبع العيون بالكاميرا'}
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
