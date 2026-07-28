import {
  useState,
  useEffect,
  useRef,
  createContext,
  useContext,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

// ── MediaPipe Face Landmarker (Tasks Vision) types ────────────────────────────
// V3.0 — WebGazer + the legacy (deprecated) MediaPipe "Solutions" face_mesh
// runtime it depends on (see the fetch-patch hack this replaced) have been
// removed entirely. Landmarks now come from Google's actively-maintained
// MediaPipe Tasks Vision `FaceLandmarker`, loaded at runtime from jsDelivr —
// no npm dependency / build-step change required, mirroring how this file
// already pulled MediaPipe assets from a CDN before. The point-of-gaze
// estimate itself is a small custom ridge regression (see GazeEstimator
// below) trained directly from this app's existing 9-point calibration
// clicks — WebGazer's own internal regression is gone too.
type Mat4 = number[]; // 16 numbers, column-major, per MediaPipe convention

interface FaceLandmarkerResult {
  faceLandmarks: { x: number; y: number; z: number }[][];
  facialTransformationMatrixes?: { data: Mat4 }[];
}

interface FaceLandmarkerInstance {
  detectForVideo(
    video: HTMLVideoElement,
    timestampMs: number,
  ): FaceLandmarkerResult;
  close(): void;
}

interface TasksVisionModule {
  FilesetResolver: {
    forVisionTasks(wasmBaseUrl: string): Promise<unknown>;
  };
  FaceLandmarker: {
    createFromOptions(
      fileset: unknown,
      options: {
        baseOptions: { modelAssetPath: string; delegate: "GPU" | "CPU" };
        runningMode: "VIDEO";
        numFaces: number;
        outputFaceBlendshapes: boolean;
        outputFacialTransformationMatrixes: boolean;
      },
    ): Promise<FaceLandmarkerInstance>;
  };
}

// Pinned version — bundle (.mjs) and wasm runtime must match.
const TASKS_VISION_VERSION = "0.10.20";
const TASKS_VISION_BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/vision_bundle.mjs`;
const TASKS_VISION_WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VISION_VERSION}/wasm`;
const FACE_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// ── Performance tuning constants (V3.1 — perf rewrite) ────────────────────────
// V3.0 called detectForVideo (synchronous, blocking) on every single
// requestAnimationFrame tick with no cap and no de-duplication against the
// camera's actual frame rate. On a device where GPU-delegate inference costs
// 40-80ms/call, that leaves the main thread almost no room to paint, run
// React's re-render, or service the separate card-scoring rAF loop — which is
// exactly what "pauses, trails behind, jumps" looks like from the outside.
/** Target steady-state inference rate once the device's capability is known.
 *  24Hz is enough for a fixation-driven UI (not a twitch-reflex one) and
 *  leaves real main-thread headroom between calls. */
const TARGET_INFERENCE_INTERVAL_MS = 1000 / 24; // ~41.7ms
/** Adaptive backoff never goes slower than this — below ~8Hz the Card-Intent
 *  Engine's dwell/hysteresis timers stop feeling responsive regardless of
 *  smoothing quality. */
const MIN_INFERENCE_INTERVAL_MS = 1000 / 8; // 125ms
/** EMA smoothing factor for the rolling per-call latency estimate that
 *  drives the adaptive backoff/recovery below. */
const INFERENCE_LATENCY_EMA_ALPHA = 0.2;
/** If the rolling latency estimate exceeds this fraction of the current
 *  interval, back off (raise the interval) so calls stop queuing up behind
 *  each other and starving the rest of the main thread. */
const INFERENCE_BACKOFF_TRIGGER = 0.85;
/** If latency drops comfortably below this fraction of the current interval,
 *  recover back toward TARGET_INFERENCE_INTERVAL_MS. */
const INFERENCE_RECOVER_TRIGGER = 0.5;
/** Frames sampled when probing whether GPU or CPU delegate is actually
 *  faster on this device — see pickFasterDelegate below. */
const DELEGATE_PROBE_SAMPLES = 5;
/** A GPU delegate measuring at or below this ms/frame is left alone; only
 *  slower-than-this triggers a CPU probe (avoids paying for a second model
 *  instantiation on devices where GPU is already fine). */
const DELEGATE_PROBE_THRESHOLD_MS = 35;

// Module-level cache so the (fairly heavy) wasm + model download only ever
// happens once per page load, even across recalibration / remount.
let tasksVisionModulePromise: Promise<TasksVisionModule> | null = null;
function loadTasksVisionModule(): Promise<TasksVisionModule> {
  if (!tasksVisionModulePromise) {
    tasksVisionModulePromise = import(
      /* @vite-ignore */ TASKS_VISION_BUNDLE_URL
    ) as Promise<TasksVisionModule>;
  }
  return tasksVisionModulePromise;
}

// Fileset (wasm runtime) is cached separately from any particular
// FaceLandmarker instance — probing both delegates (pickFasterDelegate)
// must never re-download/re-parse the wasm twice.
let visionFilesetPromise: Promise<unknown> | null = null;
function loadVisionFileset(): Promise<unknown> {
  if (!visionFilesetPromise) {
    visionFilesetPromise = (async () => {
      const { FilesetResolver } = await loadTasksVisionModule();
      return FilesetResolver.forVisionTasks(TASKS_VISION_WASM_BASE);
    })();
  }
  return visionFilesetPromise;
}

async function createLandmarker(
  delegate: "GPU" | "CPU",
): Promise<FaceLandmarkerInstance> {
  const { FaceLandmarker } = await loadTasksVisionModule();
  const fileset = await loadVisionFileset();
  console.log(
    `[Sameyba/Gaze] Creating FaceLandmarker (${delegate} delegate)...`,
  );
  return FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL, delegate },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
  });
}

let faceLandmarkerPromise: Promise<FaceLandmarkerInstance> | null = null;
/** Fast-path loader used before a live video frame exists (permission-probe
 *  stage). Tries GPU, falls back to CPU only on a hard creation error —
 *  same behavior V3.0 had. Which delegate is actually *faster* on this
 *  device is answered empirically once real frames are flowing — see
 *  pickFasterDelegate, called from requestCamera right after the persistent
 *  stream attaches. */
function getFaceLandmarker(): Promise<FaceLandmarkerInstance> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      try {
        return await createLandmarker("GPU");
      } catch (gpuErr) {
        console.warn(
          "[Sameyba/Gaze] GPU delegate failed, retrying with CPU:",
          gpuErr,
        );
        return await createLandmarker("CPU");
      }
    })();
  }
  return faceLandmarkerPromise;
}

/** Runs a few throwaway detectForVideo calls, spaced one rAF apart so we're
 *  timing steady-state calls rather than two calls competing for the same
 *  GL/CPU resource back-to-back, and returns the median latency in ms.
 *  Results are discarded — this never feeds a real prediction. */
async function benchmarkLandmarker(
  landmarker: FaceLandmarkerInstance,
  video: HTMLVideoElement,
  samples: number,
): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    landmarker.detectForVideo(video, performance.now());
    times.push(performance.now() - t0);
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

/** Empirically picks whichever delegate is actually faster on this device,
 *  using the live camera feed. GPU is usually faster on desktop, but Tasks-
 *  Vision's GPU delegate has a known texture-readback stall on several
 *  mobile WebViews/Safari builds that can make it *slower* than the CPU
 *  (XNNPACK) delegate despite reporting a healthy WebGL2 context — this only
 *  trusts a measurement, never a static assumption. */
async function pickFasterDelegate(
  current: FaceLandmarkerInstance,
  video: HTMLVideoElement,
): Promise<{
  landmarker: FaceLandmarkerInstance;
  delegate: string;
  ms: number;
}> {
  const gpuMs = await benchmarkLandmarker(
    current,
    video,
    DELEGATE_PROBE_SAMPLES,
  );
  console.log(
    `[Sameyba/Gaze] Delegate benchmark — GPU: ${gpuMs.toFixed(1)}ms/frame (median of ${DELEGATE_PROBE_SAMPLES})`,
  );

  if (gpuMs <= DELEGATE_PROBE_THRESHOLD_MS) {
    return { landmarker: current, delegate: "GPU", ms: gpuMs };
  }

  try {
    const cpuLandmarker = await createLandmarker("CPU");
    const cpuMs = await benchmarkLandmarker(
      cpuLandmarker,
      video,
      DELEGATE_PROBE_SAMPLES,
    );
    console.log(
      `[Sameyba/Gaze] Delegate benchmark — CPU: ${cpuMs.toFixed(1)}ms/frame (median of ${DELEGATE_PROBE_SAMPLES})`,
    );

    if (cpuMs < gpuMs) {
      current.close();
      faceLandmarkerPromise = Promise.resolve(cpuLandmarker);
      console.log(
        `[Sameyba/Gaze] Switching to CPU delegate (${cpuMs.toFixed(1)}ms vs ${gpuMs.toFixed(1)}ms)`,
      );
      return { landmarker: cpuLandmarker, delegate: "CPU", ms: cpuMs };
    }

    cpuLandmarker.close();
  } catch (err) {
    console.warn(
      "[Sameyba/Gaze] CPU delegate probe failed, staying on GPU:",
      err,
    );
  }

  return { landmarker: current, delegate: "GPU", ms: gpuMs };
}

// ── Types ─────────────────────────────────────────────────────────────────────
export type PermissionState = "idle" | "requesting" | "granted" | "denied";
export type GazeStatus =
  | "idle"
  | "preparing"
  | "calibrating"
  | "verifying"
  | "ready"
  | "dwelling";

export type GazeContextShape = {
  gazeEnabled: boolean;
  gazePos: { x: number; y: number } | null;
  gazeTargetId: string | null;
  permissionState: PermissionState;
  requestCamera: () => void;
  /** true after the 9-point calibration completes */
  calibrated: boolean;
  /** current state of the gaze system */
  gazeStatus: GazeStatus;
  /** restart the 9-point calibration flow */
  recalibrate: () => void;
  /** close the calibration overlay without completing it */
  cancelCalibration: () => void;
};

// ── Context ───────────────────────────────────────────────────────────────────
export const GazeContext = createContext<GazeContextShape>({
  gazeEnabled: false,
  gazePos: null,
  gazeTargetId: null,
  permissionState: "idle",
  requestCamera: () => {},
  calibrated: false,
  gazeStatus: "idle",
  recalibrate: () => {},
  cancelCalibration: () => {},
});
export function useGazeContext() {
  return useContext(GazeContext);
}

// ── Error classification ───────────────────────────────────────────────────────
type ErrorKind =
  | "permission-denied"
  | "no-camera"
  | "camera-in-use"
  | "aborted"
  | "overconstrained"
  | "security"
  | "no-mediadevices"
  | "unknown";

function classifyGetUserMediaError(err: unknown): {
  kind: ErrorKind;
  label: string;
} {
  const e = err as DOMException;
  const name = e?.name ?? "";
  const msg = e?.message ?? String(err);
  if (name === "NotAllowedError" || name === "PermissionDeniedError")
    return {
      kind: "permission-denied",
      label: "تم رفض الكاميرا — يعمل التطبيق بالفأرة",
    };
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return { kind: "no-camera", label: "لم يتم العثور على كاميرا" };
  if (name === "NotReadableError" || name === "TrackStartError")
    return { kind: "camera-in-use", label: "الكاميرا مستخدمة من تطبيق آخر" };
  if (name === "AbortError")
    return { kind: "aborted", label: "تم إلغاء تشغيل الكاميرا" };
  if (name === "OverconstrainedError")
    return { kind: "overconstrained", label: "مواصفات الكاميرا غير مدعومة" };
  if (name === "SecurityError")
    return { kind: "security", label: "تم حظر الكاميرا بإعدادات الأمان" };
  return { kind: "unknown", label: `خطأ في الكاميرا: ${name || msg}` };
}
// ── Gaze smoothing tuning constants ───────────────────────────────────────────
/** One Euro Filter: minimum cutoff (Hz). Lower = smoother when gaze is nearly still. */
const ONE_EURO_MIN_CUTOFF = 1.0;
/** One Euro Filter: speed coefficient (beta). Higher = less lag during fast movement. */
const ONE_EURO_BETA = 0.3;
/** One Euro Filter: cutoff (Hz) used to smooth the internal velocity estimate. */
const ONE_EURO_DERIVATIVE_CUTOFF = 1.0;

// ── One Euro Filter ───────────────────────────────────────────────────────────
class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;

  constructor(minCutoff: number, beta: number, dCutoff: number) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  private static smoothingFactor(cutoffHz: number, dtSec: number): number {
    const tau = 1 / (2 * Math.PI * cutoffHz);
    return 1 / (1 + tau / dtSec);
  }

  private static lowPass(alpha: number, x: number, xPrev: number): number {
    return alpha * x + (1 - alpha) * xPrev;
  }

  reset() {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  filter(x: number, tMs: number): number {
    if (this.tPrev === null || this.xPrev === null) {
      this.tPrev = tMs;
      this.xPrev = x;
      this.dxPrev = 0;
      return x;
    }

    const dtSec = Math.max((tMs - this.tPrev) / 1000, 1 / 120);

    const dx = (x - this.xPrev) / dtSec;

    const derivativeAlpha = OneEuroFilter.smoothingFactor(this.dCutoff, dtSec);

    const filteredVelocity = OneEuroFilter.lowPass(
      derivativeAlpha,
      dx,
      this.dxPrev,
    );

    const cutoff = this.minCutoff + this.beta * Math.abs(filteredVelocity);

    const alpha = OneEuroFilter.smoothingFactor(cutoff, dtSec);

    const filteredValue = OneEuroFilter.lowPass(alpha, x, this.xPrev);

    this.tPrev = tMs;
    this.xPrev = filteredValue;
    this.dxPrev = filteredVelocity;

    return filteredValue;
  }
}
// ── Gaze estimator (V3.0) — replaces WebGazer's built-in ridge regression ────
// WebGazer regresses screen position directly from raw eye-patch pixels,
// which is why head movement and lighting could shift a prediction sideways
// (see the V2.1 horizontal-bias notes below — that was a symptom of exactly
// this). Instead of raw pixels, this estimator regresses from a small set of
// *geometric* features computed from MediaPipe's iris + eyelid landmarks and
// its head-pose transformation matrix — each feature is head-pose-normalized
// by construction, which is the property that should make adjacent-card
// discrimination more reliable, not just a differently-tuned version of the
// same problem.
//
// Standard MediaPipe Face Mesh / iris landmark indices (478-point model):
const LM = {
  rightEyeOuter: 33,
  rightEyeInner: 133,
  rightEyeTop: 159,
  rightEyeBottom: 145,
  rightIrisCenter: 468,
  leftEyeOuter: 263,
  leftEyeInner: 362,
  leftEyeTop: 386,
  leftEyeBottom: 374,
  leftIrisCenter: 473,
};

/** Number of features fed to the regression, including the bias/intercept
 *  term (always 1) as feature 0. */
const GAZE_FEATURE_COUNT = 9;

/** Ridge regularization strength. Kept relatively high on purpose — the
 *  calibration set is small (9 points × 2 clicks = 18 samples) and this
 *  keeps the fit from chasing single-frame landmark noise. */
const RIDGE_LAMBDA = 4.0;

type FaceLandmark = { x: number; y: number; z: number };

/** Decompose a MediaPipe facial transformation matrix (column-major 4x4)
 *  into yaw/pitch (radians) — the two head-pose angles that matter for
 *  on-screen gaze; roll is left out since it barely affects point-of-regard. */
function yawPitchFromMatrix(m: Mat4): { yaw: number; pitch: number } {
  // Column-major: m[0],m[1],m[2] = column 0 (rotated X axis), etc.
  const r20 = m[2],
    r21 = m[6],
    r22 = m[10];
  const yaw = Math.atan2(-r20, Math.sqrt(m[0] * m[0] + m[4] * m[4]));
  const pitch = Math.atan2(r21, r22);
  return { yaw, pitch };
}

/** Extracts a fixed-length, head-pose-aware feature vector from one frame's
 *  landmarks. Returns null if the eyes can't be confidently located (e.g. a
 *  blink, or a landmark set that doesn't look like a real face this frame). */
function extractGazeFeatures(
  landmarks: FaceLandmark[],
  transform: Mat4 | null,
): number[] | null {
  if (!landmarks || landmarks.length < 478) return null;

  const rEyeL = landmarks[LM.rightEyeOuter];
  const rEyeR = landmarks[LM.rightEyeInner];
  const rEyeT = landmarks[LM.rightEyeTop];
  const rEyeB = landmarks[LM.rightEyeBottom];
  const rIris = landmarks[LM.rightIrisCenter];
  const lEyeL = landmarks[LM.leftEyeInner];
  const lEyeR = landmarks[LM.leftEyeOuter];
  const lEyeT = landmarks[LM.leftEyeTop];
  const lEyeB = landmarks[LM.leftEyeBottom];
  const lIris = landmarks[LM.leftIrisCenter];

  const rWidth = Math.hypot(rEyeR.x - rEyeL.x, rEyeR.y - rEyeL.y);
  const rHeight = Math.hypot(rEyeB.x - rEyeT.x, rEyeB.y - rEyeT.y);
  const lWidth = Math.hypot(lEyeR.x - lEyeL.x, lEyeR.y - lEyeL.y);
  const lHeight = Math.hypot(lEyeB.x - lEyeT.x, lEyeB.y - lEyeT.y);

  if (rWidth < 1e-4 || lWidth < 1e-4 || rHeight < 1e-4 || lHeight < 1e-4) {
    return null; // degenerate geometry (eyes closed / bad detection this frame)
  }

  // Normalized iris position within each eye's box: 0..1 on each axis.
  const rNormX = (rIris.x - Math.min(rEyeL.x, rEyeR.x)) / rWidth;
  const rNormY = (rIris.y - Math.min(rEyeT.y, rEyeB.y)) / rHeight;
  const lNormX = (lIris.x - Math.min(lEyeL.x, lEyeR.x)) / lWidth;
  const lNormY = (lIris.y - Math.min(lEyeT.y, lEyeB.y)) / lHeight;

  const { yaw, pitch } = transform
    ? yawPitchFromMatrix(transform)
    : { yaw: 0, pitch: 0 };

  // Head center in normalized image coordinates — lets the regression
  // partially compensate for the user shifting side-to-side without
  // rotating (yaw alone doesn't capture lateral translation).
  const headCenterX = (rIris.x + lIris.x) / 2;
  const headCenterY = (rIris.y + lIris.y) / 2;

  return [
    1, // bias / intercept
    rNormX,
    rNormY,
    lNormX,
    lNormY,
    yaw,
    pitch,
    headCenterX,
    headCenterY,
  ];
}

/** Solves (A + λI)w = b for w via Gauss-Jordan elimination with partial
 *  pivoting. `a` is mutated in place; small, fixed-size (≤9×9) systems only —
 *  no external linear-algebra dependency needed. */
function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const aug = a.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivotRow][col])) pivotRow = r;
    }
    [aug[col], aug[pivotRow]] = [aug[pivotRow], aug[col]];

    const pivot = aug[col][col];
    if (Math.abs(pivot) < 1e-10) continue; // singular-ish; leave weight at 0

    for (let k = col; k <= n; k++) aug[col][k] /= pivot;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) aug[r][k] -= factor * aug[col][k];
    }
  }

  return aug.map((row) => row[n]);
}

/** Fits w such that X·w ≈ y via ridge regression. `samples` is n×d (d =
 *  GAZE_FEATURE_COUNT, feature 0 is always the bias term). Returns null if
 *  there isn't enough data to fit reliably.
 *
 * ── ROOT CAUSE OF "cursor fixed near center after calibration" (V3.1.1) ──
 * This is where the freeze actually came from. It is NOT a wiring bug —
 * rawRef.current, latestFeaturesRef, the detect loop, and the cursor RAF
 * loop are all fine (see the DIAG instrumentation elsewhere in this file,
 * which was already built to catch exactly this and was pointing right at
 * it: "non-bias weight magnitude ~0 ⇒ regression is ~ignoring eye-geometry
 * features and just predicting the mean click position").
 *
 * The bug is a feature-scale / regularization mismatch. RIDGE_LAMBDA (4.0)
 * was carried over from when this estimator worked on much larger raw
 * pixel-scale inputs. The current geometric features are all tiny by
 * comparison — rNormX/rNormY/lNormX/lNormY are O(0.1), yaw/pitch are
 * radians O(0.1–0.4), headCenterX/Y are O(1) in normalized image space —
 * so across ~18 calibration samples, each feature's own sum-of-squares in
 * the normal equations (xtx[a][a]) is typically well under 1. Adding
 * RIDGE_LAMBDA=4.0 on top of that doesn't gently regularize — it swamps
 * the signal outright, so every non-bias weight solves out to ~0 and the
 * fitted model degenerates to "predict the mean training-click position",
 * i.e. a constant point near screen center that doesn't move with gaze.
 * That also explains why it looks like a hard freeze rather than noisy/
 * inaccurate tracking: the weights are non-null (fitRidgeRegression isn't
 * returning null, dot() isn't reading stale data), they're just constant.
 *
 * Fix: standardize each non-bias feature (zero mean, unit variance) before
 * fitting, so RIDGE_LAMBDA applies the same *relative* shrinkage to every
 * feature regardless of its native units, then convert the fitted
 * standardized-space weights back into original-feature-space weights so
 * dot(w, features) at inference time (which always uses raw, unstandardized
 * features — see runInference) keeps working unchanged. */
function fitRidgeRegression(
  samples: number[][],
  targets: number[],
  featureCount: number = GAZE_FEATURE_COUNT,
  ridgeLambda: number = RIDGE_LAMBDA,
  stdFloors?: number[],
): number[] | null {
  const n = samples.length;
  if (n < 6) return null;
  const d = featureCount;

  // 1. Standardize features 1..d-1 (feature 0 is the constant bias term and
  //    is left untouched). A near-constant column (std ~0 — e.g.
  //    headCenterX/Y when the user's head barely moved during calibration)
  //    is left unscaled (std treated as 1) rather than dividing by ~0; its
  //    fitted weight will simply solve out near 0 on its own, which is the
  //    correct outcome for a feature that carries no information.
  //
  //    `stdFloors` (V3.4, Y model only — see Y_FEATURE_STD_FLOORS below and the Y fit at calibration-completion time) is
  //    a stricter version of that same idea. Falling back to std=1 only
  //    protects against a column that is *exactly* constant; a column with
  //    a small but nonzero std (e.g. headCenterY moving a tiny amount as
  //    the user's head drifts slightly during calibration, even though
  //    they never rotated it) still gets divided by that small real std,
  //    which is exactly what was blowing its unstandardized weight up to
  //    tens of thousands (see the V3.4 note). When the caller supplies a
  //    floor per non-bias feature, the std used for standardization is
  //    never allowed below it — capping how large the corresponding
  //    unstandardized weight can possibly come out, without touching any
  //    feature whose real std already clears the floor. X never passes
  //    this argument, so its fit is unchanged.
  const means = new Array(d).fill(0);
  const stds = new Array(d).fill(1);
  for (let a = 1; a < d; a++) {
    let m = 0;
    for (let i = 0; i < n; i++) m += samples[i][a];
    m /= n;
    let variance = 0;
    for (let i = 0; i < n; i++) variance += (samples[i][a] - m) ** 2;
    variance /= n;
    const s = Math.sqrt(variance);
    means[a] = m;
    if (stdFloors) {
      const floor = stdFloors[a - 1] ?? 1e-8;
      stds[a] = Math.max(s, floor);
    } else {
      stds[a] = s > 1e-8 ? s : 1;
    }
  }

  const standardized: number[][] = samples.map((row) => {
    const z = new Array(d);
    z[0] = 1;
    for (let a = 1; a < d; a++) z[a] = (row[a] - means[a]) / stds[a];
    return z;
  });

  const xtx: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const xty: number[] = new Array(d).fill(0);

  for (let i = 0; i < n; i++) {
    const row = standardized[i];
    const t = targets[i];
    for (let a = 0; a < d; a++) {
      xty[a] += row[a] * t;
      for (let b = 0; b < d; b++) {
        xtx[a][b] += row[a] * row[b];
      }
    }
  }

  // Regularize everything except the bias term (index 0), so the intercept
  // isn't artificially shrunk toward zero. Now that every non-bias feature
  // has unit variance, this shrinkage is fair/comparable across all of
  // them instead of disproportionately erasing whichever features happen
  // to have small natural units.
  for (let a = 1; a < d; a++) xtx[a][a] += ridgeLambda;

  const wStd = solveLinearSystem(xtx, xty);

  // 2. Map the standardized-space weights back to original feature space:
  //    z_a = (x_a - mean_a) / std_a, so
  //    ŷ = wStd[0] + Σ wStd[a]·z_a
  //      = (wStd[0] − Σ wStd[a]·mean_a/std_a) + Σ (wStd[a]/std_a)·x_a
  const w = new Array(d).fill(0);
  let biasAdjustment = 0;
  for (let a = 1; a < d; a++) {
    w[a] = wStd[a] / stds[a];
    biasAdjustment += wStd[a] * (means[a] / stds[a]);
  }
  w[0] = wStd[0] - biasAdjustment;

  return w;
}

function dot(w: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * x[i];
  return s;
}

// ── Dedicated vertical (Y) gaze model (V3.2) ──────────────────────────────────
// ── ROOT CAUSE OF "cursor dragged downward, Y range compressed" (V3.2) ──
// The V3.1.1 standardization fix made X and Y share one 9-feature ridge
// model with one RIDGE_LAMBDA, and it was right to do that for X — the
// horizontal-bias notes above confirm X now tracks correctly across its
// full range. But the two axes are not actually symmetric, and forcing
// them through the same model is what produced this bug:
//
//  1. Orientation: rNormY/lNormY are NOT flipped. Both are computed as
//     (iris.y − min(eyeTop.y, eyeBottom.y)) / eyeHeight in MediaPipe's
//     image space, where y grows downward. Looking up moves the iris
//     toward eyeTop ⇒ rNormY → 0; looking down moves it toward eyeBottom
//     ⇒ rNormY → 1 — the same direction screen-Y grows in. Verified against
//     this run's own verify-sweep log: mean raw Y for the top target (71)
//     was 482.0, for the bottom target (641) was 557.5 — 482 < 557.5, so
//     the *direction* of the mapping is correct. The problem is scale, not
//     sign.
//
//  2. Dynamic range: the iris can only travel within the eyelid aperture,
//     which is a much smaller physical range vertically than horizontally
//     (eyelids clip iris-Y far more than the eye corners clip iris-X). This
//     run's own between-target variance log shows rNormY (3.354e-3) is the
//     same order of magnitude as rNormX (4.131e-3) — so the *feature
//     extractor* is not broken — but that comparable *feature*-space
//     variance still has to explain a much larger *pixel*-space spread once
//     you account for how little of a real person's vertical eye rotation
//     range 9 calibration clicks actually sample. The needed regression
//     slope for Y is intrinsically larger and intrinsically noisier than
//     for X, for a fixed calibration set.
//
//  3/4. Cross-axis leakage + regularization: because X and Y were fit from
//     the *same* 9-feature vector, the Y fit was free to put real weight on
//     X-only features. This run's own fitted-weight log shows exactly that:
//     wy's lNormX weight was −477.1 — a horizontal iris feature getting a
//     large vertical-prediction weight — which is pure calibration-noise
//     overfitting, not signal (lNormX has no physical reason to predict Y).
//     With only 9 independent calibration locations (18 clicks, 2 near-
//     duplicates each) feeding an 8-dimensional non-bias fit, the system is
//     barely more constrained than parameters, so ridge is fighting real
//     overfitting risk on both axes — but only Y's own signal (rNormY/
//     lNormY) is small enough that this cross-talk and noise can swamp it.
//
//  5. The 9-point averaging itself (2 clicks/point, features averaged from
//     a ≤6-frame rolling buffer at click time) was confirmed NOT to be the
//     problem — this run logged "18/18 unique feature vectors", so the
//     extractor is not collapsing distinct fixations into duplicate
//     samples. It's the ridge fit's *behavior* on those 18 real samples
//     that's wrong for Y, not the samples themselves.
//
//  6/7. Fix: give Y its own dedicated model instead of trying to patch the
//     shared one:
//       a) YSubFeatures fits from only the four features with a physical
//          reason to predict vertical gaze — bias, rNormY, lNormY, pitch,
//          headCenterY — dropping rNormX/lNormX/yaw/headCenterX entirely so
//          they can no longer soak up calibration noise as spurious
//          "vertical" signal (fixes #3/#4).
//       b) RIDGE_LAMBDA_Y regularizes that smaller, cleaner feature set on
//          its own terms rather than reusing X's lambda by coincidence.
//       c) Critically, an explicit *affine* (scale + offset) recalibration
//          stage is fit on top of the ridge output, directly against the
//          9 calibration targets' true screen Y. A ridge fit systematically
//          shrinks its own output range (that's what regularization does by
//          construction) — no purely *additive* correction can undo a
//          *scale* error, which is exactly why the existing runtime
//          verticalBiasRef (median-of-residuals, additive-only, see
//          estimateAxisBias above) could not fix this: it was already doing
//          its job correctly, on top of a model whose output range was
//          wrong to begin with. The affine stage restores the correct
//          scale *before* that runtime bias correction ever runs, so
//          verticalBiasRef goes back to correcting what it was designed
//          for — small residual drift — instead of trying to stretch a
//          ~75px raw spread across a ~570px target range with a ±160px
//          clamp (see VBIAS_CLAMP_PX) that was never going to be enough.
//     This is the standard "regularize, then recalibrate" pattern: ridge
//     keeps the underlying fit stable against per-click noise, and the
//     affine stage restores the dynamic range and corrects the offset that
//     stability costs — both learned straight from this user's own 9-point
//     calibration, so it adapts per-session rather than assuming a fixed
//     compression factor.

/** Indices into the full 9-element extractGazeFeatures() vector that are
 *  physically relevant to *vertical* gaze: bias, rNormY, lNormY, pitch,
 *  headCenterY. Deliberately excludes rNormX/lNormX/yaw/headCenterX — see
 *  the V3.2 note above for why leaving those in was letting the Y model
 *  fit noise on irrelevant horizontal features. */
const Y_FEATURE_INDICES = [0, 2, 4, 6, 8] as const;

/** Feature count for the dedicated Y model (bias + 4 vertical features). */
const GAZE_FEATURE_COUNT_Y = Y_FEATURE_INDICES.length;

/** Ridge regularization strength for the dedicated Y model. Applied to a
 *  smaller (5-feature) standardized space than RIDGE_LAMBDA/X's 9, on
 *  purpose — see the V3.2 note above: Y's real signal (rNormY/lNormY) is
 *  naturally smaller and noisier than X's, so this is intentionally
 *  heavier than RIDGE_LAMBDA per remaining feature. The dynamic range this
 *  costs is restored afterward by the affine recalibration stage below,
 *  not by loosening this. */
const RIDGE_LAMBDA_Y = 6.0;

/** Projects a full 9-element extractGazeFeatures() vector down to the
 *  5-element vertical-only subset (see Y_FEATURE_INDICES) used to fit and
 *  evaluate the dedicated Y model. Used identically at calibration-fit time
 *  and at every-frame inference time so the two never drift apart. */
function extractYSubFeatures(fullFeatures: number[]): number[] {
  return Y_FEATURE_INDICES.map((i) => fullFeatures[i]);
}

/** Human-readable names for the Y-only feature subset, in the same order as
 *  Y_FEATURE_INDICES (bias, rNormY, lNormY, pitch, headCenterY) — hardcoded
 *  rather than derived from GAZE_FEATURE_NAMES below to avoid a load-order
 *  dependency; wy is 5-wide now, not 9-wide, so it needs its own labels
 *  anyway. Diagnostics-only. */
const Y_FEATURE_NAMES = ["bias", "rNormY", "lNormY", "pitch", "headCenterY"];

/** V3.4 — per-feature standardization std floors for the dedicated Y model
 *  (aligned to Y_FEATURE_NAMES.slice(1), i.e. one entry per non-bias Y
 *  feature: rNormY, lNormY, pitch, headCenterY). See the V3.4 note above
 *  the Y fit at calibration-completion time for the full diagnosis; the short version: this
 *  run's own fitted-weight log shows wy's headCenterY weight came out to
 *  67641.7 — twenty times larger than rNormY's own weight (3427.1) — even
 *  though headCenterY has, at best, a weak physical link to vertical gaze.
 *  That happened because headCenterY barely moved across the 9 calibration
 *  targets (the user was moving their eyes, not their head), so its
 *  standardization std was tiny; dividing by that tiny std to get back to
 *  raw-feature-space is what turned an unremarkable standardized weight
 *  into a huge one, which then amplified ordinary frame-to-frame head
 *  jitter at inference time into wild, often off-screen predictions —
 *  exactly what this run's raw=(-2433.5, -1361.9) / (1128.3, -99.8) style
 *  diagnostic lines show, and exactly why the verify-sweep cursor looked
 *  "compressed near center": those wild predictions were mostly landing
 *  outside the viewport and getting silently dropped by the raw-sample
 *  gate (see the V3.4 note in the RAF loop below), starving the One Euro
 *  filter of real signal and leaving it stuck on stale, roughly-central
 *  values.
 *
 *  Flooring each feature's std at a physically-motivated minimum bounds how
 *  large its raw-space weight can come out, without touching a feature
 *  whose real calibration-time variation already clears the floor. rNormY/
 *  lNormY get a low floor (0.015) because they're the actual iris-position
 *  signal and a real vertical eye movement easily produces more spread
 *  than that (this run's own between-target variance for rNormY was
 *  3.354e-3, i.e. std ≈ 0.058 — well clear of 0.015, so the floor is a
 *  no-op for a calibration that's actually working). pitch and headCenterY
 *  get a deliberately higher floor (0.05) — per the explicit "feature
 *  selection so pitch/headCenterY cannot overpower iris-Y" requirement —
 *  because they are exactly the two features with, at best, a secondary/
 *  compensatory role for vertical gaze, and are the two known to have
 *  produced near-constant (hence dangerous-to-standardize) calibration
 *  columns for a user who kept their head reasonably still. */
const Y_FEATURE_STD_FLOORS = [0.015, 0.015, 0.05, 0.05];

/** Safety clamp on a single fitted Y-affine scale — see fitYAffine below. */
const Y_AFFINE_MIN_SCALE = 0.5;
const Y_AFFINE_MAX_SCALE = 6;
/** Safety clamp on a *composed* Y-affine scale (calibration-fit stage
 *  composed with the verification refit — see composeAffine and
 *  refitVerticalAffineFromVerification below). Wider than the single-stage
 *  bound above since two legitimate corrections chained together can
 *  reasonably multiply out to a bit more than either alone, but still
 *  bounded so a degenerate verification sweep can't produce a runaway
 *  multiplier on top of an already-corrected model. */
const Y_AFFINE_COMPOSED_MIN_SCALE = 0.3;
const Y_AFFINE_COMPOSED_MAX_SCALE = 10;

/** scale/offset applied as: correctedY = rawModelY * scale + offset. */
interface AffineParams {
  scale: number;
  offset: number;
}

const IDENTITY_AFFINE: AffineParams = { scale: 1, offset: 0 };

/** Ridge regression shrinks its own output range by construction — that's
 *  the point of regularizing — so a model tuned to survive noisy 9-point
 *  calibration data will *always* under-predict the true spread unless
 *  something restores it afterward. This fits that restoration directly:
 *  ordinary least-squares scale + offset mapping the ridge model's own
 *  in-sample predictions on the calibration set onto the true clicked
 *  screen-Y values, i.e. the 1-D regression correctedY ≈ scale·rawModelY +
 *  offset. Clamped to a sane range so a degenerate calibration (e.g. near-
 *  zero variance in rawModelY) can't produce a wild multiplier — falls back
 *  to identity (no-op) in that case, same as "no affine correction learned
 *  yet" before the first calibration completes. */
function fitYAffine(rawModelY: number[], trueY: number[]): AffineParams {
  const n = rawModelY.length;
  if (n < 3) return IDENTITY_AFFINE;

  let meanRaw = 0,
    meanTrue = 0;
  for (let i = 0; i < n; i++) {
    meanRaw += rawModelY[i] / n;
    meanTrue += trueY[i] / n;
  }

  let cov = 0,
    varRaw = 0;
  for (let i = 0; i < n; i++) {
    const dr = rawModelY[i] - meanRaw;
    const dt = trueY[i] - meanTrue;
    cov += dr * dt;
    varRaw += dr * dr;
  }

  if (varRaw < 1e-6) return IDENTITY_AFFINE; // rawModelY has ~no spread to rescale

  let scale = cov / varRaw;

  // Safety clamp — the point of this stage is to *restore* range a ridge
  // fit compressed (scale > 1 is expected and normal here), not to let a
  // pathological 9-point calibration produce an unbounded multiplier that
  // would amplify ordinary per-frame jitter into huge cursor swings.
  scale = Math.max(Y_AFFINE_MIN_SCALE, Math.min(Y_AFFINE_MAX_SCALE, scale));

  const offset = meanTrue - scale * meanRaw;

  if (!Number.isFinite(scale) || !Number.isFinite(offset)) {
    return IDENTITY_AFFINE;
  }

  return { scale, offset };
}

/** V3.4 — composes two affine corrections applied in sequence:
 *  result(raw) = outer.scale * (inner.scale * raw + inner.offset) + outer.offset.
 *  Needed because the verification-sweep refit (see
 *  refitVerticalAffineFromVerification below) is fit against samples that
 *  already passed through the *existing* (calibration-click-based) affine
 *  once — so the freshly-fit scale/offset has to be layered on top of it,
 *  not swap in for it, or the composition would silently undo the first
 *  correction instead of refining it. Clamped to
 *  Y_AFFINE_COMPOSED_MIN/MAX_SCALE for the same reason fitYAffine clamps
 *  its own single-stage output. */
function composeAffine(inner: AffineParams, outer: AffineParams): AffineParams {
  let scale = outer.scale * inner.scale;
  let offset = outer.scale * inner.offset + outer.offset;

  if (!Number.isFinite(scale) || !Number.isFinite(offset)) {
    return inner;
  }

  scale = Math.max(
    Y_AFFINE_COMPOSED_MIN_SCALE,
    Math.min(Y_AFFINE_COMPOSED_MAX_SCALE, scale),
  );

  return { scale, offset };
}

/** V3.4 — groups per-click calibration training arrays into one averaged
 *  sample per physical calibration target, instead of fitting from all
 *  CAL_POINTS.length × clicksPerPoint clicks independently. Clicks are
 *  recorded in target-major order (see handleCalClick below: every click
 *  for target p is pushed before target p+1's first click), so this is a
 *  straightforward chunked average — exactly the "calibration-target
 *  aggregation rather than treating all 18 clicks independently"
 *  requested for the Y fix. Averaging the (typically 2) noisy single-
 *  fixation clicks recorded for the same on-screen target before fitting
 *  gives the regression 9 largely-independent points instead of 18 samples
 *  that arrive in noisy, highly-correlated pairs, which is exactly the
 *  kind of small-sample noise a ridge fit is most likely to overfit to
 *  (see the wy lNormX cross-talk this file's own earlier diagnostics
 *  already caught). Falls back to the raw per-click arrays unchanged if
 *  the click count doesn't evenly divide by clicksPerPoint (e.g. a click
 *  was skipped mid-calibration because no face was detected that frame —
 *  see the "no face detected this frame, sample skipped" warning in
 *  handleCalClick) rather than silently mis-grouping clicks across target
 *  boundaries. */
function aggregateByCalibrationTarget(
  features: number[][],
  targetsY: number[],
  clicksPerPoint: number,
): { features: number[][]; targets: number[] } {
  const n = features.length;
  if (clicksPerPoint <= 1 || n === 0 || n % clicksPerPoint !== 0) {
    return { features, targets: targetsY };
  }

  const d = features[0].length;
  const aggFeatures: number[][] = [];
  const aggTargets: number[] = [];

  for (let start = 0; start < n; start += clicksPerPoint) {
    const group = features.slice(start, start + clicksPerPoint);
    const mean = new Array(d).fill(0);
    group.forEach((f) => {
      for (let i = 0; i < d; i++) mean[i] += f[i] / group.length;
    });
    mean[0] = 1; // bias term stays exact, not averaged noise
    aggFeatures.push(mean);
    // The true clicked position is identical, by construction, for every
    // click recorded at the same physical target — any one of them is the
    // group's target value.
    aggTargets.push(targetsY[start]);
  }

  return { features: aggFeatures, targets: aggTargets };
}

// ── DIAGNOSTICS (V3.1 instrumentation) ────────────────────────────────────────
// Pure investigation instrumentation for the "prediction collapses toward
// screen center" report — nothing below this point changes the estimator,
// smoothing, scoring, or calibration flow. Everything here only reads
// existing refs/values and writes to console.
/** Human-readable labels for extractGazeFeatures' return vector, in order —
 *  used purely to make diagnostic console output legible. */
const GAZE_FEATURE_NAMES = [
  "bias",
  "rNormX",
  "rNormY",
  "lNormX",
  "lNormY",
  "yaw",
  "pitch",
  "headCenterX",
  "headCenterY",
];

/** Per-dimension variance across a set of feature vectors (population
 *  variance — fine for diagnostic purposes on tiny n). Returns an all-zero
 *  vector for n=0 so callers don't need to special-case it. */
function diagFeatureVariance(vectors: number[][]): number[] {
  const d = GAZE_FEATURE_COUNT;
  const n = vectors.length;
  if (n === 0) return new Array(d).fill(0);
  const mean = new Array(d).fill(0);
  vectors.forEach((v) => {
    for (let i = 0; i < d; i++) mean[i] += v[i] / n;
  });
  const variance = new Array(d).fill(0);
  vectors.forEach((v) => {
    for (let i = 0; i < d; i++) variance[i] += (v[i] - mean[i]) ** 2 / n;
  });
  return variance;
}

/** Deterministic string key for a feature vector, rounded to 6dp, so
 *  "unique feature vectors" counting isn't defeated by float noise far past
 *  any resolution that matters for gaze estimation. */
function diagFeatureKey(v: number[]): string {
  return v.map((x) => x.toFixed(6)).join(",");
}

/** Formats a per-dimension diagnostic vector (variance, mean, etc.) as a
 *  {featureName: value} object for readable console.log output, using
 *  GAZE_FEATURE_NAMES for labels. */
function diagLabelVector(
  values: number[],
  fmt: (n: number) => string = (n) => n.toExponential(3),
): Record<string, string> {
  return Object.fromEntries(
    GAZE_FEATURE_NAMES.map((name, i) => [name, fmt(values[i] ?? NaN)]),
  );
}

// ── Outlier rejection tuning constants (v1.2) ─────────────────────────────────
/** A sample jumping more than this (px) from the last accepted sample,
 *  within OUTLIER_MAX_DT_MS, is rejected as noise.
 *
 *  V3.4 — raised from 200 to 500. At ~24Hz steady-state inference
 *  (TARGET_INFERENCE_INTERVAL_MS ≈ 42ms/frame), a genuine saccade between
 *  two verification targets — top-to-bottom is ~570px vertically on a
 *  typical viewport — can easily land within OUTLIER_MAX_DT_MS of the
 *  previous accepted sample. 200px was rejecting exactly the large,
 *  legitimate jumps a working vertical model needs to make to actually
 *  reach the top/bottom targets, on top of the Y-model weight-blowup bug
 *  (see Y_FEATURE_STD_FLOORS) that this rejection was quietly masking the
 *  worst symptoms of. 500px still rejects a genuinely nonsensical single-
 *  frame jump (most of a screen diagonal) while allowing real full-range
 *  eye movement through. */
const OUTLIER_MAX_JUMP_PX = 500;
/** Outlier check only applies within this time window (ms) since the last
 *  accepted sample — prevents rejecting legitimate slow drift over time. */
const OUTLIER_MAX_DT_MS = 150;
// ── Card-Intent Engine tuning (V2 — replaces the v1.6-v1.8 stability lock,
// pre-lock median, padded hit-region, and rolling-vote pipeline) ─────────────
// Rebuilt from scratch around card-level intent rather than pixel-perfect
// cursor accuracy. Every [data-gaze-id] element carries its own continuous
// confidence score in [0,1]. Each frame, the card nearest the filtered gaze
// point (see CARD_NEAR_CUTOFF_PX) has its score pulled toward 1 with time
// constant CARD_SCORE_RISE_MS; every other card's score decays toward 0 with
// time constant CARD_SCORE_FALL_MS. gazeTargetId is derived from these scores
// with hysteresis (see CARD_ENTER_THRESHOLD / CARD_EXIT_THRESHOLD /
// CARD_CONFIDENCE_MARGIN below) — there is no frozen cursor position and no
// fixed-size sample window to fill before a decision can be made.
//
// V2.1: the "nearest card wins" geometry above was never the bug — it always
// gives the correct answer for the point it's handed. The remaining
// neighboring-card errors ("الصحة" → "احتياجاتي", "أريد ماء" → "أريد الحمام")
// came from the point itself being systematically off to one side, because
// V2.0 only ever corrected the *vertical* axis (see VBIAS_* below): the X
// coordinate went into the nearest-card lookup completely raw. WebGazer's
// regression can carry a horizontal offset just as easily as a vertical one
// (webcam not centered under the screen, asymmetric lighting on one iris,
// a head pose that isn't quite frontal), and a raw X offset shifts the gaze
// point across the true midpoint of a horizontal (or diagonal) gap between
// two cards well before it clears CARD_NEAR_CUTOFF_PX — so the "wrong"
// neighbor looks, geometrically, like the nearest card. The verification
// sweep already visits a "left" (10%) and "right" (90%) target for exactly
// this kind of measurement; V2.0 just never recorded their X samples. V2.1
// adds that missing half of the estimator (see HBIAS_* below) and applies it
// to gazeX the same way biasCorrectedY already applied to gazeY — no change
// to the scoring/hysteresis logic itself, because it was never the problem.
/** Maximum distance (px) from a card's actual bounding rect that the gaze
 *  point may sit and still count as "on" that card. This is intentionally
 *  small and uniform (not gap-aware / per-neighbor) — because assignment is
 *  by *nearest* rect rather than containment inside an enlarged rect, two
 *  adjacent cards can never contest the same point: whichever card is
 *  closer wins, even when the real gap between cards is only ~10px. */
const CARD_NEAR_CUTOFF_PX = 36;
/** Time constant (ms) for a card's confidence score rising toward 1 while it
 *  is continuously the nearest card to the gaze point. Reaching the entry
 *  threshold from zero takes roughly 200-350ms of steady fixation. */
const CARD_SCORE_RISE_MS = 220;
/** Time constant (ms) for a card's confidence score decaying toward 0 while
 *  it is NOT the nearest card (including frames where no card is near the
 *  point at all, e.g. a blink or a saccade in flight). Slightly slower than
 *  the rise constant so a couple of noisy frames glancing off the current
 *  card don't erase its accumulated confidence, while a genuine, sustained
 *  look elsewhere still decays it out of contention promptly. */
const CARD_SCORE_FALL_MS = 260;
/** A card must reach this confidence score to become the new gazeTargetId. */
const CARD_ENTER_THRESHOLD = 0.62;
/** The current gazeTargetId keeps its status as long as its own score stays
 *  at or above this (lower) threshold, even while another card's score is
 *  rising. This hysteresis gap is what keeps gazeTargetId stable frame-to-
 *  frame despite ordinary micro-saccade jitter flipping the *instantaneous*
 *  nearest card constantly during real fixation. */
const CARD_EXIT_THRESHOLD = 0.35;
/** Minimum lead a challenger must hold over the current target's score
 *  before it is allowed to take over — prevents a near-tie between two
 *  adjacent cards from flipping the selection on ordinary sample noise. */
const CARD_CONFIDENCE_MARGIN = 0.12;
// ── Card-scoring loop perf tuning (V3.1) ──────────────────────────────────────
/** How often (ms) the [data-gaze-id] bounding-rect cache is refreshed.
 *  getBoundingClientRect forces a synchronous layout; V3.0 re-queried and
 *  re-measured every card on every single rAF tick (~60x/sec) even though
 *  cards don't move at 60Hz. Refreshing on this fixed low-rate timer instead
 *  (plus immediately on resize) keeps the per-frame cost of the card-scoring
 *  loop to plain arithmetic over cached rects. */
const CARD_RECT_REFRESH_MS = 150;
/** Minimum gap (ms) between setGazePos/setVisualCursorPos React state
 *  updates. The visible cursor dot itself is moved every processed frame via
 *  direct DOM style mutation (no re-render); these two setState calls only
 *  feed React-rendered consumers (CalibrationVerification, context value)
 *  and firing them at full frame rate was forcing a React re-render —
 *  including framer-motion's diff — up to 60x/sec for no visible benefit. */
const REACT_CURSOR_STATE_INTERVAL_MS = 33; // ~30Hz
// ── Adaptive vertical bias correction tuning (v1.4) ──────────────────────────
/** Engine-version suffix on the persisted bias keys. V3.0 switched the whole
 *  estimator from WebGazer's raw-pixel regression to this geometric-feature
 *  ridge regression — a "vertical bias in px" learned under one model has no
 *  guaranteed relationship to the other. Versioning the key means a browser
 *  that still has an old WebGazer-era value sitting in localStorage simply
 *  never sees it again, instead of silently applying it as a huge (and, per
 *  the V3.0 console log, exactly this: -53.2px / +21.2px) starting offset. */
const GAZE_BIAS_ENGINE_VERSION = "flm1";
/** Old, unversioned keys from the WebGazer-based engine. Purged (not just
 *  ignored) on load so they can't be mistaken for current data later. */
const LEGACY_BIAS_STORAGE_KEYS = [
  "sameyba_gaze_vbias_px",
  "sameyba_gaze_hbias_px",
];
/** localStorage key used to persist the learned vertical bias across sessions. */
const VBIAS_STORAGE_KEY = `sameyba_gaze_vbias_px_${GAZE_BIAS_ENGINE_VERSION}`;
// ── Adaptive horizontal bias correction tuning (V2.1) ────────────────────────
// V2.0's verification sweep already visits a "left" (10%) and "right" (90%)
// target — but only ever recorded their Y samples. Every other axis-specific
// number below (settle window, min samples, MAD outlier threshold, minimum
// valid targets, clamp) is identical to the vertical scheme by design: this
// is the same estimator, run on the other axis, not a new algorithm.
/** localStorage key used to persist the learned horizontal bias across sessions. */
const HBIAS_STORAGE_KEY = `sameyba_gaze_hbias_px_${GAZE_BIAS_ENGINE_VERSION}`;
/** How long each VERIFY_TARGETS entry stays highlighted / active (ms). */
const VERIFY_DWELL_MS = 1500;
/** Samples collected within this window (ms) after a target becomes active
 *  are discarded — the eye is still saccading in from the previous target. */
const VERIFY_SETTLE_MS = 300;
/** Minimum (post-settle) samples a single target needs before its residual
 *  is trusted at all. */
const VBIAS_MIN_SAMPLES_PER_TARGET = 10;
/** MAD multiplier for per-target outlier rejection. */
const VBIAS_MAD_K = 3;
/** Minimum number of valid targets required. */
const VBIAS_MIN_VALID_TARGETS = 3;
/** Safety clamp on the learned vertical correction. */
const VBIAS_CLAMP_PX = 160;
// ── Calibration constants ─────────────────────────────────────────────────────
/** 9-point grid as [col%, row%] fractions of the viewport */
const CAL_POINTS: [number, number][] = [
  [0.1, 0.12],
  [0.5, 0.12],
  [0.9, 0.12],
  [0.1, 0.5],
  [0.5, 0.5],
  [0.9, 0.5],
  [0.1, 0.88],
  [0.5, 0.88],
  [0.9, 0.88],
];
const CLICKS_PER_POINT = 2;

// ── GazeProvider ──────────────────────────────────────────────────────────────
export function GazeProvider({ children }: { children: React.ReactNode }) {
  // Permission / lifecycle
  const [permissionState, setPermissionState] =
    useState<PermissionState>("idle");
  const [errorLabel, setErrorLabel] = useState<string | null>(null);
  // Gaze output
  const [gazeEnabled, setGazeEnabled] = useState(false);
  const [gazePos, setGazePos] = useState<{ x: number; y: number } | null>(null);
  /** v1.5.1 — visual-lock-adjusted cursor position, for React-rendered
   * cursors such as CalibrationVerification only. */
  const [visualCursorPos, setVisualCursorPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [gazeTargetId, setGazeTargetId] = useState<string | null>(null);
  const [gazeHoverId, setGazeHoverId] = useState<string | null>(null); // pre-stability hover
  // Calibration
  const [calibrating, setCalibrating] = useState(false);
  const [calibrated, setCalibrated] = useState(false);
  const [calStep, setCalStep] = useState(0); // 0-8
  const [calClicks, setCalClicks] = useState(0); // 0-1
  const [calSuccess, setCalSuccess] = useState(false);
  const [preparingGaze, setPreparingGaze] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // Refs — used inside rAF to avoid stale closures
  const rawRef = useRef<{ x: number; y: number } | null>(null);
  /** Last raw WebGazer sample accepted (post outlier-rejection) — v1.2. */
  const lastAcceptedRawRef = useRef<{
    x: number;
    y: number;
    ts: number;
  } | null>(null);

  /** Card-Intent Engine (V2) — per-card confidence score in [0,1], keyed by
   * data-gaze-id. Rebuilt from scratch each frame's nearest-card lookup;
   * never frozen, never reads a locked cursor position. See the tuning
   * constants above and the scoring loop at the RAF site below. */
  const cardScoresRef = useRef<Map<string, number>>(new Map());

  /** Timestamp (ms) of the previous processed frame, used to compute a real
   * elapsed-time delta for the exponential rise/decay — makes the engine's
   * behavior independent of the browser's actual sampling rate. */
  const lastScoreTsRef = useRef<number | null>(null);

  /** Lightweight EMA purely for the visible cursor dot's on-screen motion.
   * Deliberately separate from anything selection reads — the cursor is an
   * approximate indicator only and must never gate a decision. */
  const cursorSmoothRef = useRef<{ x: number; y: number } | null>(null);

  const filterXRef = useRef(
    new OneEuroFilter(
      ONE_EURO_MIN_CUTOFF,
      ONE_EURO_BETA,
      ONE_EURO_DERIVATIVE_CUTOFF,
    ),
  );

  const filterYRef = useRef(
    new OneEuroFilter(
      ONE_EURO_MIN_CUTOFF,
      ONE_EURO_BETA,
      ONE_EURO_DERIVATIVE_CUTOFF,
    ),
  );
  const gazeTargetRef = useRef<string | null>(null);
  const gazeHoverRef = useRef<string | null>(null);

  /** V3.1 — cache of [data-gaze-id] element bounding rects, refreshed at a
   *  fixed low rate (CARD_RECT_REFRESH_MS) instead of every rAF tick.
   *  getBoundingClientRect forces a synchronous layout; doing that for every
   *  card 60x/sec was pure main-thread cost the scoring logic doesn't need —
   *  cards don't move at 60Hz. */
  const cardRectsCacheRef = useRef<{ id: string; rect: DOMRect }[]>([]);
  const cardRectsCacheTsRef = useRef(0);
  /** V3.1 — throttle for the setGazePos/setVisualCursorPos React state
   *  mirrors. The visible cursor dot moves every processed frame via direct
   *  DOM style mutation (see cursorEl below), independent of React; these
   *  two setState calls only feed React-rendered consumers and don't need
   *  to force a re-render at full frame rate. */
  const lastReactCursorStateTsRef = useRef(0);

  // ── V3.0 — MediaPipe FaceLandmarker camera/detection state ─────────────────
  /** Hidden <video> element the FaceLandmarker reads frames from. Created
   *  once and kept for the component's lifetime. */
  const videoElRef = useRef<HTMLVideoElement | null>(null);
  /** The getUserMedia stream backing videoElRef, so it can be stopped on
   *  unmount / cleanup. */
  const streamRef = useRef<MediaStream | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarkerInstance | null>(null);
  /** Set false to stop the detection rAF loop (unmount / cleanup only — it
   *  otherwise runs for the whole session, independent of gazeEnabled). */
  const detectionActiveRef = useRef(false);
  /** Most recent per-frame feature vector, or null when no face/eyes were
   *  confidently found this frame. */
  const latestFeaturesRef = useRef<number[] | null>(null);
  /** Small rolling buffer of recent feature vectors, averaged at the moment
   *  of a calibration click to reduce single-frame landmark jitter — the
   *  geometric-feature analogue of what WebGazer's own click-time sampling
   *  did implicitly. */
  const recentFeaturesRef = useRef<number[][]>([]);
  /** Count of frames with a confidently-detected face since warm-up started;
   *  used only to gate the "camera + model are actually working" check. */
  const warmupDetectionCountRef = useRef(0);
  /** V3.1 — adaptive inference cadence. Current minimum gap (ms) enforced
   *  between detectForVideo calls; starts at TARGET_INFERENCE_INTERVAL_MS
   *  and is adjusted up/down by the EMA latency check in requestCamera. */
  const inferenceIntervalMsRef = useRef(TARGET_INFERENCE_INTERVAL_MS);
  /** Timestamp (ms) of the last inference call actually run. */
  const lastInferenceTsRef = useRef(0);
  /** Rolling EMA (ms) of real detectForVideo call latency; null until the
   *  first benchmark/call. Drives the adaptive backoff above. */
  const inferenceLatencyEmaRef = useRef<number | null>(null);
  /** Calibration training set — one entry per recorded click. */
  const trainingFeaturesRef = useRef<number[][]>([]);
  const trainingTargetXRef = useRef<number[]>([]);
  const trainingTargetYRef = useRef<number[]>([]);
  /** Fitted regression weights. Null until calibration completes.
   *  weightsYRef holds the *dedicated* Y model's weights (see
   *  GAZE_FEATURE_COUNT_Y / Y_FEATURE_INDICES above) — 5 elements, not 9 —
   *  and must always be evaluated against extractYSubFeatures(features),
   *  never the full 9-element feature vector. */
  const weightsXRef = useRef<number[] | null>(null);
  const weightsYRef = useRef<number[] | null>(null);
  /** Learned scale+offset (V3.2) restoring the dedicated Y model's output
   *  range/offset — see fitYAffine above for why this is a scale+offset
   *  fit, not just an offset. Identity (no-op) until calibration completes. */
  const yAffineRef = useRef<AffineParams>(IDENTITY_AFFINE);

  // ── DIAGNOSTICS-ONLY refs (V3.1 instrumentation) ────────────────────────────
  /** Tracks rawRef.current frame-to-frame to answer "does the prediction
   *  actually move" independent of any downstream filtering/bias/scoring. */
  const diagRawFrameRef = useRef<{
    last: { x: number; y: number } | null;
    unchangedStreak: number;
    maxUnchangedStreak: number;
    totalFrames: number;
    unchangedFrames: number;
    lastSummaryLogTs: number;
  }>({
    last: null,
    unchangedStreak: 0,
    maxUnchangedStreak: 0,
    totalFrames: 0,
    unchangedFrames: 0,
    lastSummaryLogTs: 0,
  });
  /** Throttle for the per-frame "instantaneous nearest card" diagnostic log. */
  const diagNearestCardLastLogTsRef = useRef(0);
  /** Raw (pre One-Euro-filter) predicted x/y samples collected per
   *  verification target — separate from verifyTargetSamplesRef/
   *  verifyTargetXSamplesRef above, which store the *filtered* oneEuro
   *  values used for bias estimation. This diagnostic bucket exists purely
   *  to see what the regression itself output before any smoothing/bias
   *  correction touches it. */
  const diagVerifyRawXSamplesRef = useRef<number[][]>(
    VERIFY_TARGETS.map(() => []),
  );
  const diagVerifyRawYSamplesRef = useRef<number[][]>(
    VERIFY_TARGETS.map(() => []),
  );
  /** Running min/max of raw predicted x/y across the whole verification
   *  sweep (reset each time a new sweep starts). */
  const diagVerifyMinMaxRef = useRef<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }>({ minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
  /** Throttle for the per-verification-target raw-prediction console log. */
  const diagVerifyLogLastTsRef = useRef(0);

  const resetGazeFilters = useCallback(() => {
    filterXRef.current.reset();
    filterYRef.current.reset();

    lastAcceptedRawRef.current = null;
    // Card-Intent Engine (V2) — clear all accumulated card confidence and
    // the frame-delta clock, so stale evidence from before a recalibration
    // or reset can't bleed into the next session. Refs AND their mirrored
    // React state are cleared together so nothing (e.g. a stale dwell ring
    // in App.tsx) can render against a leftover non-null id for even one
    // frame before the RAF loop resumes.
    cardScoresRef.current.clear();
    lastScoreTsRef.current = null;
    cursorSmoothRef.current = null;
    gazeTargetRef.current = null;
    gazeHoverRef.current = null;
    setGazeTargetId(null);
    setGazeHoverId(null);
  }, []);
  // ── Adaptive vertical bias correction (v1.4) ──────────────────────────────
  /** Index (0-4) of the VERIFY_TARGETS entry currently highlighted / being
   * looked at, or null when no verification sweep is in progress. */
  const [verifyStep, setVerifyStep] = useState<number | null>(null);

  /** Mirrors verifyStep inside the rAF loop. */
  const verifyStepRef = useRef<number | null>(null);

  /** Timestamp of when the current verifyStep began. */
  const verifyStepStartTsRef = useRef<number>(0);

  useEffect(() => {
    verifyStepRef.current = verifyStep;
    verifyStepStartTsRef.current = performance.now();
  }, [verifyStep]);

  /** One predicted-Y sample bucket per verification target. */
  const verifyTargetSamplesRef = useRef<number[][]>(
    VERIFY_TARGETS.map(() => []),
  );
  /** One predicted-X sample bucket per verification target (V2.1) — same
   *  sweep, same targets, collected in parallel with the Y buckets above. */
  const verifyTargetXSamplesRef = useRef<number[][]>(
    VERIFY_TARGETS.map(() => []),
  );
  // Drive the sequential sweep across VERIFY_TARGETS while verification is open.
  useEffect(() => {
    if (!verifying) {
      setVerifyStep(null);
      return;
    }

    setVerifyStep(0);

    const interval = setInterval(() => {
      setVerifyStep((prev) => {
        if (prev === null) return prev;

        const next = prev + 1;
        return next < VERIFY_TARGETS.length ? next : null;
      });
    }, VERIFY_DWELL_MS);

    return () => clearInterval(interval);
  }, [verifying]);

  /** Learned vertical bias in pixels.
   * correctedY = predictedY - verticalBiasRef.current */
  const verticalBiasRef = useRef<number>(0);
  /** Learned horizontal bias in pixels (V2.1).
   * correctedX = predictedX - horizontalBiasRef.current */
  const horizontalBiasRef = useRef<number>(0);

  // Load the previously learned biases when the app opens.
  useEffect(() => {
    // V3.1 — discard any bias value left over from the old WebGazer-based
    // engine before reading the (versioned) current keys. See
    // GAZE_BIAS_ENGINE_VERSION above for why these aren't just "unused" —
    // if left in place they'd sit there indefinitely as a trap for any
    // future key-naming change.
    LEGACY_BIAS_STORAGE_KEYS.forEach((legacyKey) => {
      try {
        if (localStorage.getItem(legacyKey) !== null) {
          console.log(
            `[Sameyba/Gaze] Discarding stale pre-V3 bias key: ${legacyKey}`,
          );
          localStorage.removeItem(legacyKey);
        }
      } catch {
        // localStorage unavailable — nothing to purge.
      }
    });

    try {
      const stored = localStorage.getItem(VBIAS_STORAGE_KEY);
      const parsed = stored !== null ? parseFloat(stored) : NaN;

      if (!Number.isNaN(parsed)) {
        verticalBiasRef.current = Math.max(
          -VBIAS_CLAMP_PX,
          Math.min(VBIAS_CLAMP_PX, parsed),
        );

        console.log(
          `[Sameyba/Gaze] Loaded persisted vertical bias: ${verticalBiasRef.current.toFixed(1)}px`,
        );
      }
    } catch {
      // localStorage unavailable — use zero bias.
    }

    try {
      const storedH = localStorage.getItem(HBIAS_STORAGE_KEY);
      const parsedH = storedH !== null ? parseFloat(storedH) : NaN;

      if (!Number.isNaN(parsedH)) {
        horizontalBiasRef.current = Math.max(
          -VBIAS_CLAMP_PX,
          Math.min(VBIAS_CLAMP_PX, parsedH),
        );

        console.log(
          `[Sameyba/Gaze] Loaded persisted horizontal bias: ${horizontalBiasRef.current.toFixed(1)}px`,
        );
      }
    } catch {
      // localStorage unavailable — use zero bias.
    }
  }, []);

  const median = (arr: number[]): number => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);

    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  /** Shared per-axis bias estimator (V2.1). Both the vertical estimate (v1.4,
   *  unchanged in behavior) and the new horizontal estimate run this exact
   *  same procedure against their own sample buckets — median-of-cleaned-
   *  means per target, MAD outlier rejection per target, then a median-of-
   *  residuals combine across targets. Keeping this as one function means
   *  X and Y can never silently drift into different correction logic. */
  const estimateAxisBias = useCallback(
    (
      samplesPerTarget: number[][],
      expectedOf: (targetIdx: number) => number,
      axisLabel: "Vertical" | "Horizontal",
      storageKey: string,
      biasRef: React.MutableRefObject<number>,
    ) => {
      const perTargetResiduals: number[] = [];

      VERIFY_TARGETS.forEach((_target, i) => {
        const samples = samplesPerTarget[i];

        if (samples.length < VBIAS_MIN_SAMPLES_PER_TARGET) {
          return;
        }

        const targetMedian = median(samples);
        const absDevs = samples.map((v) => Math.abs(v - targetMedian));
        const mad = median(absDevs);
        const scaledMad = mad * 1.4826;

        const cleaned =
          scaledMad === 0
            ? samples
            : samples.filter(
                (v) => Math.abs(v - targetMedian) <= VBIAS_MAD_K * scaledMad,
              );

        if (cleaned.length < VBIAS_MIN_SAMPLES_PER_TARGET) {
          return;
        }

        const meanCleaned =
          cleaned.reduce((sum, v) => sum + v, 0) / cleaned.length;

        const expected = expectedOf(i);
        const residual = meanCleaned - expected;

        perTargetResiduals.push(residual);
      });

      if (perTargetResiduals.length < VBIAS_MIN_VALID_TARGETS) {
        console.log(
          `[Sameyba/Gaze] ${axisLabel} bias estimate skipped — only ${perTargetResiduals.length} valid targets`,
        );
        return;
      }

      const rawBias = median(perTargetResiduals);

      const clampedBias = Math.max(
        -VBIAS_CLAMP_PX,
        Math.min(VBIAS_CLAMP_PX, rawBias),
      );

      biasRef.current = clampedBias;

      try {
        localStorage.setItem(storageKey, String(clampedBias));
      } catch {
        // Bias still applies during this session.
      }

      console.log(
        `[Sameyba/Gaze] ${axisLabel} bias updated: ${clampedBias.toFixed(1)}px`,
      );
    },
    [],
  );

  /** Runs the vertical estimate (v1.4 behavior, unchanged) followed by the
   *  new horizontal estimate (V2.1) — both read from the same verification
   *  sweep, so this always replaces the old vertical-only call site. */
  const estimateAndApplyBiasCorrections = useCallback(() => {
    estimateAxisBias(
      verifyTargetSamplesRef.current,
      (i) => window.innerHeight * VERIFY_TARGETS[i].yFrac,
      "Vertical",
      VBIAS_STORAGE_KEY,
      verticalBiasRef,
    );
    estimateAxisBias(
      verifyTargetXSamplesRef.current,
      (i) => window.innerWidth * VERIFY_TARGETS[i].xFrac,
      "Horizontal",
      HBIAS_STORAGE_KEY,
      horizontalBiasRef,
    );
  }, [estimateAxisBias]);

  /** V3.4 — refits the Y affine (scale+offset) a second time, directly
   *  against the actual top/center/bottom verification measurements, as
   *  explicitly requested: "a post-regression affine calibration for Y
   *  using scale + offset, derived from top/center/bottom verification
   *  data." The affine set when calibration finished (see the fitYAffine
   *  call above) is only ever a first draft — it has to exist before the
   *  verification screen can show a moving cursor at all, but it's fit
   *  from noisy single-fixation clicks. This refit uses the much cleaner
   *  signal already collected while the user held a steady gaze on each of
   *  VERIFY_TARGETS' center/top/bottom entries for VERIFY_DWELL_MS each
   *  (verifyTargetSamplesRef — the same One-Euro-filtered samples
   *  estimateAxisBias above reads from the same sweep, so this never
   *  requires a second/separate verification pass).
   *
   *  verifyTargetSamplesRef already reflects the *current* yAffineRef
   *  having been applied once (it's collected downstream of runInference's
   *  `rawModelY * scale + offset`), so the freshly-fit scale/offset here is
   *  layered on top of the existing affine via composeAffine rather than
   *  replacing it outright — see composeAffine's own doc comment for why
   *  that composition is what keeps this mathematically correct relative
   *  to the underlying (unaffine'd) ridge output. */
  const refitVerticalAffineFromVerification = useCallback(() => {
    // center=0, top=1, bottom=2 — see VERIFY_TARGETS below. left/right
    // (3, 4) are horizontal-only and irrelevant to the Y affine.
    const VERTICAL_VERIFY_TARGET_INDICES = [0, 1, 2];
    const pooledRawY: number[] = [];
    const pooledTrueY: number[] = [];

    VERTICAL_VERIFY_TARGET_INDICES.forEach((i) => {
      const samples = verifyTargetSamplesRef.current[i];
      if (samples.length < VBIAS_MIN_SAMPLES_PER_TARGET) return;

      // Same median + MAD outlier cleaning estimateAxisBias uses, so a
      // stray blink or a saccade-in-flight frame can't skew the fit.
      const targetMedian = median(samples);
      const absDevs = samples.map((v) => Math.abs(v - targetMedian));
      const mad = median(absDevs);
      const scaledMad = mad * 1.4826;
      const cleaned =
        scaledMad === 0
          ? samples
          : samples.filter(
              (v) => Math.abs(v - targetMedian) <= VBIAS_MAD_K * scaledMad,
            );
      if (cleaned.length < VBIAS_MIN_SAMPLES_PER_TARGET) return;

      const expected = window.innerHeight * VERIFY_TARGETS[i].yFrac;
      cleaned.forEach((v) => {
        pooledRawY.push(v);
        pooledTrueY.push(expected);
      });
    });

    if (pooledRawY.length < VBIAS_MIN_SAMPLES_PER_TARGET) {
      console.log(
        "[Sameyba/Gaze] Y-affine verification refit skipped — not enough clean center/top/bottom samples",
      );
      return;
    }

    const refit = fitYAffine(pooledRawY, pooledTrueY);
    const composed = composeAffine(yAffineRef.current, refit);
    yAffineRef.current = composed;

    console.log(
      `[Sameyba/Gaze] Y-affine refit from verification — scale=${composed.scale.toFixed(3)}, offset=${composed.offset.toFixed(1)}px` +
        ` (from ${pooledRawY.length} pooled center/top/bottom samples)`,
    );
  }, []);

  // ── RAF loop ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gazeEnabled) return;
    let running = true;

    // V3.1 — invalidate the card-rect cache immediately on resize/orientation
    // change rather than waiting up to CARD_RECT_REFRESH_MS for the next
    // timed refresh; layout can genuinely change at that moment.
    const invalidateCardRects = () => {
      cardRectsCacheTsRef.current = 0;
    };
    window.addEventListener("resize", invalidateCardRects);
    window.addEventListener("orientationchange", invalidateCardRects);

    function loop() {
      if (!running) return;

      const raw = rawRef.current;

      // ── DIAGNOSTICS (V3.1 instrumentation) — does rawRef.current (the
      // *unfiltered* regression output) actually change frame-to-frame, or
      // is the regression itself outputting a near-constant value? This is
      // checked before any of the validation/filtering/bias-correction
      // below runs, so it isolates the estimator from everything
      // downstream of it. ─────────────────────────────────────────────────
      if (raw != null) {
        const rd = diagRawFrameRef.current;
        rd.totalFrames++;
        const nowDiag = performance.now();
        if (rd.last !== null && rd.last.x === raw.x && rd.last.y === raw.y) {
          rd.unchangedStreak++;
          rd.unchangedFrames++;
          rd.maxUnchangedStreak = Math.max(
            rd.maxUnchangedStreak,
            rd.unchangedStreak,
          );
          if (rd.unchangedStreak === 15) {
            console.warn(
              `[Sameyba/Gaze][DIAG] rawRef.current has been IDENTICAL for ${rd.unchangedStreak} consecutive processed frames: (${raw.x.toFixed(2)}, ${raw.y.toFixed(2)}) — the regression is not producing a new prediction even though inference is still running.`,
            );
          }
        } else {
          rd.unchangedStreak = 0;
        }
        rd.last = { x: raw.x, y: raw.y };
        if (nowDiag - rd.lastSummaryLogTs > 3000) {
          rd.lastSummaryLogTs = nowDiag;
          console.log(
            `[Sameyba/Gaze][DIAG] rawRef.current change stats — ${rd.unchangedFrames}/${rd.totalFrames} frames unchanged since last frame (${((rd.unchangedFrames / rd.totalFrames) * 100).toFixed(0)}%), longest identical streak: ${rd.maxUnchangedStreak}, current raw=(${raw.x.toFixed(1)}, ${raw.y.toFixed(1)})`,
          );
        }
      }

      if (raw != null) {
        // 1. Validate: reject NaN/non-finite, but CLAMP (don't drop) an
        //    out-of-viewport prediction.
        //
        //    V3.4 — this used to hard-reject the entire frame whenever
        //    raw.x/raw.y fell outside [0,vw]/[0,vh], which sounds like
        //    harmless input validation but was actually a major
        //    contributor to "cursor moves the right direction but never
        //    reaches the target": once the Y-model weight blow-up (see the
        //    V3.4 notes around Y_FEATURE_STD_FLOORS and
        //    the Y-model weight blow-up) is fixed, a real look at a near-edge
        //    target (the top or bottom verify point especially) can still
        //    legitimately land a fraction of a pixel past 0 or vh before
        //    the One Euro filter finishes settling — and rejecting that
        //    frame outright doesn't just ignore one sample, it means
        //    filterXRef/filterYRef never even see it, so the filter stays
        //    stuck on whatever stale, closer-to-center value it last
        //    accepted. That reads exactly like "compressed vertical range"
        //    from the outside, even after the underlying model is healthy.
        //    Clamping into a generously padded viewport box keeps a
        //    genuinely nonsensical (e.g. off-by-a-screen-width) prediction
        //    from ever reaching the filter, while letting real near-edge
        //    gaze through as the *edge* value instead of nothing at all.
        const vw = window.innerWidth,
          vh = window.innerHeight;
        const CLAMP_MARGIN_PX = 150;
        if (
          !isNaN(raw.x) &&
          !isNaN(raw.y) &&
          Number.isFinite(raw.x) &&
          Number.isFinite(raw.y)
        ) {
          const clampedX = Math.min(
            vw + CLAMP_MARGIN_PX,
            Math.max(-CLAMP_MARGIN_PX, raw.x),
          );
          const clampedY = Math.min(
            vh + CLAMP_MARGIN_PX,
            Math.max(-CLAMP_MARGIN_PX, raw.y),
          );

          // 2. Exponential moving average (0.70 old + 0.30 raw — responsive)
          // 2. One Euro Filter — replaces EMA smoothing
          const now_ms = performance.now();
          // 2a. Outlier rejection (v1.2) — ignore a sample that jumps
          //     further than OUTLIER_MAX_JUMP_PX within OUTLIER_MAX_DT_MS of
          //     the last accepted sample. V3.4 — checked against the
          //     *clamped* point (a real saccade between verification
          //     targets can legitimately cover several hundred px within a
          //     couple of ~42ms inference frames; see OUTLIER_MAX_JUMP_PX's
          //     own updated comment for why that threshold was raised
          //     alongside this).
          const lastAcceptedRaw = lastAcceptedRawRef.current;

          if (lastAcceptedRaw !== null) {
            const dtMs = now_ms - lastAcceptedRaw.ts;

            const jumpPx = Math.hypot(
              clampedX - lastAcceptedRaw.x,
              clampedY - lastAcceptedRaw.y,
            );

            if (dtMs <= OUTLIER_MAX_DT_MS && jumpPx > OUTLIER_MAX_JUMP_PX) {
              requestAnimationFrame(loop);
              return;
            }
          }

          lastAcceptedRawRef.current = {
            x: clampedX,
            y: clampedY,
            ts: now_ms,
          };

          const oneEuroX = filterXRef.current.filter(clampedX, now_ms);
          const oneEuroY = filterYRef.current.filter(clampedY, now_ms);

          // 2b. Adaptive vertical bias correction (v1.4)
          const biasCorrectedY = oneEuroY - verticalBiasRef.current;

          // Collect raw One Euro Y samples for the currently active verification target.
          const activeVerifyStep = verifyStepRef.current;

          if (activeVerifyStep !== null) {
            const sinceStepStart = now_ms - verifyStepStartTsRef.current;

            if (sinceStepStart >= VERIFY_SETTLE_MS) {
              verifyTargetSamplesRef.current[activeVerifyStep].push(oneEuroY);
              // V2.1 — collect the matching X sample. The verification
              // sweep already visits a "left" (10%) and "right" (90%)
              // target for exactly this purpose; V2.0 computed them but
              // never recorded the X value, so no horizontal correction
              // was ever learned.
              verifyTargetXSamplesRef.current[activeVerifyStep].push(oneEuroX);

              // ── DIAGNOSTICS (V3.1 instrumentation) — 4. raw predicted
              // x/y (pre-filter) during every verification target, and
              // 5. running min/max of raw predicted x/y across the sweep.
              diagVerifyRawXSamplesRef.current[activeVerifyStep].push(raw.x);
              diagVerifyRawYSamplesRef.current[activeVerifyStep].push(raw.y);
              const mm = diagVerifyMinMaxRef.current;
              mm.minX = Math.min(mm.minX, raw.x);
              mm.maxX = Math.max(mm.maxX, raw.x);
              mm.minY = Math.min(mm.minY, raw.y);
              mm.maxY = Math.max(mm.maxY, raw.y);
              if (now_ms - diagVerifyLogLastTsRef.current > 200) {
                diagVerifyLogLastTsRef.current = now_ms;
                const t = VERIFY_TARGETS[activeVerifyStep];
                console.log(
                  `[Sameyba/Gaze][DIAG] verify target ${activeVerifyStep} [${(t.xFrac * 100).toFixed(0)}%,${(t.yFrac * 100).toFixed(0)}%] rawPredicted=(${raw.x.toFixed(1)}, ${raw.y.toFixed(1)}) oneEuro=(${oneEuroX.toFixed(1)}, ${oneEuroY.toFixed(1)})`,
                );
              }
            }
          }

          // 2b'. Adaptive horizontal bias correction (V2.1) — same
          // treatment as the vertical correction above, using the bias
          // learned from the verification sweep's X residuals.
          const biasCorrectedX = oneEuroX - horizontalBiasRef.current;

          // 2c. Card-Intent Engine (V2) — everything from here down replaces
          // the old pre-lock median filter, unified stability lock, padded
          // hit-region containment test, and rolling-window vote. There is
          // no frozen cursor position anywhere in this pipeline: the point
          // used for card scoring is the One-Euro-filtered, bias-corrected
          // sample computed above (gazeX/gazeY), fresh every frame.
          const gazeX = biasCorrectedX;
          const gazeY = biasCorrectedY;

          // 3. Visible cursor — a small, separate EMA purely so the dot on
          // screen doesn't look jittery. This smoothed value is NEVER read
          // by the card-scoring logic below; the cursor stays an
          // approximate indicator only and does not control selection.
          const CURSOR_VISUAL_ALPHA = 0.35;
          const prevCursor = cursorSmoothRef.current;
          const cursorX = prevCursor
            ? prevCursor.x + (gazeX - prevCursor.x) * CURSOR_VISUAL_ALPHA
            : gazeX;
          const cursorY = prevCursor
            ? prevCursor.y + (gazeY - prevCursor.y) * CURSOR_VISUAL_ALPHA
            : gazeY;
          cursorSmoothRef.current = { x: cursorX, y: cursorY };

          const cursorEl = document.getElementById("sameyba-gaze-cursor");
          if (cursorEl) {
            cursorEl.style.transform = `translate3d(${cursorX - 14}px, ${cursorY - 14}px, 0)`;
            cursorEl.style.opacity = "1";
          }

          // Mirror the visual cursor position for React-rendered cursors
          // (e.g. CalibrationVerification) — throttled (V3.1). The dot
          // itself already moved above via direct DOM mutation; this is
          // purely so React-rendered consumers stay reasonably in sync
          // without forcing a re-render on every single processed frame.
          if (
            now_ms - lastReactCursorStateTsRef.current >=
            REACT_CURSOR_STATE_INTERVAL_MS
          ) {
            lastReactCursorStateTsRef.current = now_ms;
            setVisualCursorPos({ x: cursorX, y: cursorY });
            // Diagnostic / calibration / bias-estimation coordinate — the
            // direct filtered value, not the cursor's extra visual smoothing.
            setGazePos({ x: gazeX, y: gazeY });
          }

          // 4. Nearest-card lookup — replaces the padded/gap-aware hit-
          // region containment test. For every [data-gaze-id] element,
          // compute the distance from the gaze point to that element's
          // actual bounding rect (0 when the point is already inside it),
          // and assign the point to whichever card is closest, as long as
          // it's within CARD_NEAR_CUTOFF_PX. Because assignment is always
          // by a single nearest rect rather than containment inside
          // separately-enlarged rects, two adjacent cards can never both
          // claim the same point — the boundary between them is always the
          // true midpoint of the gap, however small that gap is.
          //
          // V3.1 — the rects themselves come from a low-rate cache
          // (refreshCardRects, called at most every CARD_RECT_REFRESH_MS)
          // instead of a fresh querySelectorAll + getBoundingClientRect
          // (forced synchronous layout) on every single processed frame.
          // Cards don't move at 60Hz; the cache does.
          if (now_ms - cardRectsCacheTsRef.current >= CARD_RECT_REFRESH_MS) {
            cardRectsCacheTsRef.current = now_ms;
            const els =
              document.querySelectorAll<HTMLElement>("[data-gaze-id]");
            const next: { id: string; rect: DOMRect }[] = [];
            els.forEach((el) => {
              const id = el.dataset.gazeId;
              if (id) next.push({ id, rect: el.getBoundingClientRect() });
            });
            cardRectsCacheRef.current = next;
          }
          const cardRects = cardRectsCacheRef.current;

          let instantHitId: string | null = null;
          let bestDist = Infinity;

          for (const { id, rect } of cardRects) {
            const dx = Math.max(rect.left - gazeX, 0, gazeX - rect.right);
            const dy = Math.max(rect.top - gazeY, 0, gazeY - rect.bottom);
            const dist = Math.hypot(dx, dy);

            if (dist < bestDist) {
              bestDist = dist;
              instantHitId = id;
            }
          }

          if (bestDist > CARD_NEAR_CUTOFF_PX) {
            instantHitId = null;
          }

          if (instantHitId !== gazeHoverRef.current) {
            gazeHoverRef.current = instantHitId;
            setGazeHoverId(instantHitId);
          }

          // ── DIAGNOSTICS (V3.1 instrumentation) — 7. instantaneous
          // nearest card, if any, throttled so it stays readable in the
          // console instead of firing every processed frame. ─────────────
          if (now_ms - diagNearestCardLastLogTsRef.current > 500) {
            diagNearestCardLastLogTsRef.current = now_ms;
            console.log(
              `[Sameyba/Gaze][DIAG] instantaneous nearest card: ${instantHitId ?? "(none within cutoff)"}` +
                ` dist=${bestDist === Infinity ? "n/a" : bestDist.toFixed(1) + "px"}` +
                ` gaze=(${gazeX.toFixed(1)}, ${gazeY.toFixed(1)})`,
            );
          }

          // 5. Per-card confidence accumulator — replaces the fixed-size
          // rolling-window vote. Every card's score moves toward 1 (if it's
          // instantHitId this frame) or toward 0 (otherwise) using the real
          // elapsed time since the previous frame, so behavior is the same
          // whether the webcam delivers 15 or 60 samples per second.
          const prevScoreTs = lastScoreTsRef.current;
          const dtMs =
            prevScoreTs !== null ? Math.max(now_ms - prevScoreTs, 0) : 16;
          lastScoreTsRef.current = now_ms;

          const scores = cardScoresRef.current;

          // Age every card currently tracked, plus any card visible this
          // frame that isn't in the map yet (starts implicitly at 0).
          const idsToUpdate = new Set<string>(scores.keys());
          for (const { id } of cardRects) {
            idsToUpdate.add(id);
          }

          idsToUpdate.forEach((id) => {
            const prev = scores.get(id) ?? 0;
            const next =
              id === instantHitId
                ? prev + (1 - prev) * (1 - Math.exp(-dtMs / CARD_SCORE_RISE_MS))
                : prev * Math.exp(-dtMs / CARD_SCORE_FALL_MS);

            // Drop near-zero entries so the map doesn't grow unbounded over
            // a long session that visits many different cards over time.
            if (next < 0.001) {
              scores.delete(id);
            } else {
              scores.set(id, next);
            }
          });

          // Find the top two scores across all tracked cards.
          let leaderId: string | null = null;
          let leaderScore = 0;
          let runnerUpScore = 0;
          scores.forEach((score, id) => {
            if (score > leaderScore) {
              runnerUpScore = leaderScore;
              leaderScore = score;
              leaderId = id;
            } else if (score > runnerUpScore) {
              runnerUpScore = score;
            }
          });

          // Decide gazeTargetId with hysteresis: entering a target requires
          // clearing CARD_ENTER_THRESHOLD with a clear lead (CARD_CONFIDENCE_
          // MARGIN) over the next-best competitor; a target already held
          // keeps it merely by staying above the lower CARD_EXIT_THRESHOLD.
          // This is what keeps gazeTargetId stable despite ordinary micro-
          // saccade jitter flipping instantHitId frame to frame during real
          // fixation, while still letting a genuine, sustained move to a
          // different (possibly adjacent) card take over promptly.
          const priorTarget = gazeTargetRef.current;
          const priorScore =
            priorTarget !== null ? (scores.get(priorTarget) ?? 0) : 0;

          let newTargetId: string | null = priorTarget;

          if (priorTarget === null) {
            if (
              leaderId !== null &&
              leaderScore >= CARD_ENTER_THRESHOLD &&
              leaderScore - runnerUpScore >= CARD_CONFIDENCE_MARGIN
            ) {
              newTargetId = leaderId;
            }
          } else if (priorScore < CARD_EXIT_THRESHOLD) {
            // Current target has decayed out of contention — hand off to a
            // qualifying leader if there is one, otherwise release to null.
            newTargetId =
              leaderId !== null &&
              leaderId !== priorTarget &&
              leaderScore >= CARD_ENTER_THRESHOLD
                ? leaderId
                : null;
          } else if (
            leaderId !== null &&
            leaderId !== priorTarget &&
            leaderScore >= CARD_ENTER_THRESHOLD &&
            leaderScore - priorScore >= CARD_CONFIDENCE_MARGIN
          ) {
            // A different card has decisively overtaken the still-active
            // current target — switch.
            newTargetId = leaderId;
          }

          if (newTargetId !== gazeTargetRef.current) {
            gazeTargetRef.current = newTargetId;
            setGazeTargetId(newTargetId);
          }
        }
      }

      requestAnimationFrame(loop);
    }

    requestAnimationFrame(loop);
    return () => {
      running = false;
      window.removeEventListener("resize", invalidateCardRects);
      window.removeEventListener("orientationchange", invalidateCardRects);
    };
  }, [gazeEnabled]);

  // ── requestCamera ─────────────────────────────────────────────────────────────
  const requestCamera = useCallback(async () => {
    if (permissionState === "requesting" || permissionState === "granted")
      return;
    setPermissionState("requesting");
    setErrorLabel(null);

    console.group("[Sameyba/Gaze] Camera initialisation started");
    console.log(
      "navigator.mediaDevices    :",
      navigator.mediaDevices ?? "UNDEFINED",
    );
    console.log(
      "getUserMedia available    :",
      typeof navigator.mediaDevices?.getUserMedia,
    );
    console.log("location.protocol         :", location.protocol);

    // 1. Check mediaDevices support
    if (
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      console.error("[Sameyba/Gaze] navigator.mediaDevices not available");
      console.groupEnd();
      setErrorLabel("المتصفح لا يدعم الوصول إلى الكاميرا");
      setPermissionState("denied");
      return;
    }

    // 2. Probe getUserMedia — isolates permission errors from WebGazer
    let probeStream: MediaStream | null = null;
    try {
      console.log("[Sameyba/Gaze] Probing getUserMedia...");
      probeStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      console.log(
        "[Sameyba/Gaze] getUserMedia ✓ stream:",
        probeStream.id,
        "| tracks:",
        probeStream
          .getTracks()
          .map((t) => `${t.kind}:${t.readyState}`)
          .join(", "),
      );
    } catch (err) {
      const { kind, label } = classifyGetUserMediaError(err);
      console.error("[Sameyba/Gaze] getUserMedia ✗", kind, err);
      console.groupEnd();
      setErrorLabel(kind === "permission-denied" ? null : label);
      setPermissionState("denied");
      return;
    }

    // 3. Load the MediaPipe FaceLandmarker (wasm runtime + .task model, both
    //    from CDN — see loadTasksVisionModule/getFaceLandmarker above).
    console.log("[Sameyba/Gaze] Loading MediaPipe FaceLandmarker...");
    let landmarker: FaceLandmarkerInstance;
    try {
      landmarker = await getFaceLandmarker();
      console.log("[Sameyba/Gaze] FaceLandmarker ✓ ready");
    } catch (err) {
      probeStream.getTracks().forEach((t) => t.stop());
      console.error("[Sameyba/Gaze] FaceLandmarker load ✗", err);
      console.groupEnd();
      setErrorLabel("تم تشغيل الكاميرا ولكن تعذر تحميل نموذج تتبع العين");
      setPermissionState("denied");
      return;
    }
    faceLandmarkerRef.current = landmarker;

    // 4. Release the probe stream and open our own persistent stream, bound
    //    to a hidden <video> element the FaceLandmarker reads frames from.
    probeStream.getTracks().forEach((t) => t.stop());
    console.log("[Sameyba/Gaze] Probe stream released; pausing 250 ms...");
    await new Promise<void>((r) => setTimeout(r, 250));

    try {
      console.log("[Sameyba/Gaze] Opening persistent camera stream...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          // V3.1 — cap the requested capture rate. Front cameras on many
          // phones default to 60fps; inference only ever runs at a fraction
          // of that (see TARGET_INFERENCE_INTERVAL_MS), so asking for 60fps
          // just adds decode overhead with no upside.
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });
      streamRef.current = stream;

      let video = videoElRef.current;
      if (!video) {
        video = document.createElement("video");
        video.playsInline = true;
        video.muted = true;
        video.autoplay = true;
        // Kept in the DOM (off-screen, invisible) rather than display:none —
        // some browsers throttle/pause frame decoding for display:none video.
        video.style.position = "fixed";
        video.style.top = "0";
        video.style.left = "0";
        video.style.width = "2px";
        video.style.height = "2px";
        video.style.opacity = "0";
        video.style.pointerEvents = "none";
        document.body.appendChild(video);
        videoElRef.current = video;
      }
      video.srcObject = stream;
      await video.play();
      await new Promise<void>((resolve) => {
        if (video!.readyState >= 2) return resolve();
        video!.onloadeddata = () => resolve();
      });
      console.log("[Sameyba/Gaze] Camera stream ✓ attached to video element");

      // 4a. V3.1 — with real frames now flowing, empirically check whether
      // the GPU delegate created above is actually the fast choice on this
      // specific device, and swap to CPU if not. A working WebGL2 context
      // (as this device's console log confirms) says nothing about whether
      // Tasks-Vision's GPU delegate is fast *in this browser* — several
      // mobile WebViews/Safari builds report a healthy GPU context but pay a
      // large per-call texture-readback cost that makes CPU (XNNPACK) faster
      // in practice. A few hundred ms measuring here beats guessing.
      try {
        const picked = await pickFasterDelegate(landmarker, video);
        landmarker = picked.landmarker;
        faceLandmarkerRef.current = landmarker;
        inferenceLatencyEmaRef.current = picked.ms;
        console.log(
          `[Sameyba/Gaze] Using ${picked.delegate} delegate (${picked.ms.toFixed(1)}ms/frame baseline)`,
        );
      } catch (err) {
        console.warn(
          "[Sameyba/Gaze] Delegate benchmark failed, continuing with GPU:",
          err,
        );
      }

      setPermissionState("granted");

      // 5. Start the detection loop — runs for the whole session
      //    (independent of gazeEnabled/calibrated), feeding rawRef.current
      //    from the fitted regression once one exists, and latestFeaturesRef
      //    always (used both for warm-up detection and calibration clicks).
      //
      // V3.1 replaces V3.0's uncapped per-rAF loop with three changes aimed
      // at the same root cause — detectForVideo is synchronous and blocks
      // the main thread for its full duration, and calling it as often as
      // the display refreshes left no headroom between calls for React,
      // layout, or paint, which is what produced the trailing/pausing/
      // jumping cursor on this device:
      //   a) Gate on requestVideoFrameCallback where available, so a
      //      genuinely new decoded camera frame — not just a new display
      //      refresh — is required before inference runs again. On a
      //      high-refresh-rate phone display with a 30fps camera this alone
      //      removes a large share of calls that were previously
      //      reprocessing an unchanged frame for zero benefit.
      //   b) A minimum-interval throttle (TARGET_INFERENCE_INTERVAL_MS) on
      //      top of that, decoupling inference rate from camera/display
      //      rate entirely.
      //   c) An adaptive backoff: a rolling EMA of each call's real latency
      //      widens the interval automatically if this device can't keep up
      //      at the target rate, and recovers toward target if there's
      //      headroom — so the loop self-tunes per device instead of
      //      assuming one fixed rate fits all.
      detectionActiveRef.current = true;
      inferenceIntervalMsRef.current = TARGET_INFERENCE_INTERVAL_MS;
      lastInferenceTsRef.current = 0;

      const runInference = (
        v: HTMLVideoElement,
        fl: FaceLandmarkerInstance,
      ) => {
        const t0 = performance.now();
        const result = fl.detectForVideo(v, t0);
        const elapsed = performance.now() - t0;

        // Adaptive interval: EMA of call latency drives the interval up
        // (back off) when the device is struggling, or back down toward
        // target when there's headroom. Different trigger fractions for
        // backoff vs. recovery (hysteresis) keep this from oscillating
        // frame to frame.
        const prevEma = inferenceLatencyEmaRef.current;
        const ema =
          prevEma === null
            ? elapsed
            : prevEma + (elapsed - prevEma) * INFERENCE_LATENCY_EMA_ALPHA;
        inferenceLatencyEmaRef.current = ema;

        const interval = inferenceIntervalMsRef.current;
        if (ema > interval * INFERENCE_BACKOFF_TRIGGER) {
          inferenceIntervalMsRef.current = Math.min(
            MIN_INFERENCE_INTERVAL_MS,
            Math.max(interval * 1.25, ema / INFERENCE_BACKOFF_TRIGGER),
          );
        } else if (
          ema < interval * INFERENCE_RECOVER_TRIGGER &&
          interval > TARGET_INFERENCE_INTERVAL_MS
        ) {
          inferenceIntervalMsRef.current = Math.max(
            TARGET_INFERENCE_INTERVAL_MS,
            interval * 0.9,
          );
        }

        const lm = result.faceLandmarks?.[0] ?? null;
        const transform =
          result.facialTransformationMatrixes?.[0]?.data ?? null;
        const features = lm ? extractGazeFeatures(lm, transform) : null;

        latestFeaturesRef.current = features;
        if (features) {
          warmupDetectionCountRef.current++;
          const buf = recentFeaturesRef.current;
          buf.push(features);
          if (buf.length > 6) buf.shift();

          const wx = weightsXRef.current;
          const wy = weightsYRef.current;
          if (wx && wy) {
            // Map back from FaceLandmarker's normalized-image-space
            // features to screen pixels — the regression was trained
            // directly against clientX/clientY, so this is just w·features.
            // X: unchanged, full 9-feature model. Y: dedicated 5-feature
            // model (see GAZE_FEATURE_COUNT_Y above) followed by the
            // learned affine (scale+offset) recalibration — see fitYAffine
            // above for why an affine stage, not just an offset, is needed.
            const rawModelY = dot(wy, extractYSubFeatures(features));
            const { scale, offset } = yAffineRef.current;
            rawRef.current = {
              x: dot(wx, features),
              y: rawModelY * scale + offset,
            };
          }
        }
      };

      const maybeRunInference = () => {
        if (!detectionActiveRef.current) return;
        const v = videoElRef.current;
        const fl = faceLandmarkerRef.current;
        if (v && fl && v.readyState >= 2) {
          const now = performance.now();
          if (
            now - lastInferenceTsRef.current >=
            inferenceIntervalMsRef.current
          ) {
            lastInferenceTsRef.current = now;
            runInference(v, fl);
          }
        }
      };

      type VideoWithFrameCallback = HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
      };
      const vfcVideo = video as VideoWithFrameCallback;

      if (typeof vfcVideo.requestVideoFrameCallback === "function") {
        // Only fires once per genuinely new decoded frame — see (a) above.
        const onVideoFrame = () => {
          if (!detectionActiveRef.current) return;
          maybeRunInference();
          vfcVideo.requestVideoFrameCallback!(onVideoFrame);
        };
        vfcVideo.requestVideoFrameCallback(onVideoFrame);
      } else {
        // Fallback for browsers without rVFC — still throttled by the same
        // interval check inside maybeRunInference, just polled via rAF.
        const detectLoop = () => {
          if (!detectionActiveRef.current) return;
          maybeRunInference();
          requestAnimationFrame(detectLoop);
        };
        requestAnimationFrame(detectLoop);
      }

      // 5a. Wait for ≥10 frames with a confidently-detected face before
      //     calibrating — the direct equivalent of WebGazer's old warm-up
      //     wait, just counting landmark detections instead of predictions
      //     (there's nothing to "predict" yet — no regression has been
      //     fitted until calibration completes).
      setPreparingGaze(true);
      console.log("[Sameyba/Gaze] Waiting for 10 warm-up samples...");
      warmupDetectionCountRef.current = 0;
      await new Promise<void>((resolve) => {
        const start = performance.now();
        const check = () => {
          if (
            warmupDetectionCountRef.current >= 10 ||
            performance.now() - start > 5000
          ) {
            resolve();
            return;
          }
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });

      // 5b. Discard warm-up data so it doesn't corrupt the regression model.
      console.log(
        "[Sameyba/Gaze] Warm-up done — clearing data before calibration",
      );
      trainingFeaturesRef.current = [];
      trainingTargetXRef.current = [];
      trainingTargetYRef.current = [];
      weightsXRef.current = null;
      weightsYRef.current = null;
      yAffineRef.current = IDENTITY_AFFINE;
      rawRef.current = null;
      resetGazeFilters();
      setPreparingGaze(false);

      // 5c. Show instruction card; launch calibration only when user confirms.
      pendingCalibrationRef.current = () => {
        setCalibrating(true);
        setCalStep(0);
        setCalClicks(0);
        setCalSuccess(false);
        console.log("[Sameyba/Gaze] Calibration started");
      };
      setInstructing(true);
    } catch (err) {
      const e = err as Error;
      console.error(
        "[Sameyba/Gaze] camera/detection setup ✗",
        e?.name,
        e?.message,
        err,
      );
      setErrorLabel(
        `تم تشغيل الكاميرا ولكن تعذر تشغيل تتبع العين. (${e?.name}: ${e?.message})`,
      );
      setPermissionState("denied");
    }

    console.groupEnd();
  }, [permissionState]);

  // ── Instruction card state ────────────────────────────────────────────────────
  const [instructing, setInstructing] = useState(false);
  const pendingCalibrationRef = useRef<(() => void) | null>(null);

  // ── Calibration click handler ──────────────────────du�──────────────────────────
  const handleCalClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();

      // Record the ACTUAL pixel the user clicked — not a recomputed centre —
      // against the averaged feature vector from the last few frames (V3.0:
      // replaces webgazer.recordScreenPosition; see GazeEstimator above).
      const buf = recentFeaturesRef.current;
      if (buf.length > 0) {
        const d = GAZE_FEATURE_COUNT;
        const avg = new Array(d).fill(0);
        buf.forEach((f) => {
          for (let i = 0; i < d; i++) avg[i] += f[i] / buf.length;
        });
        avg[0] = 1; // keep the bias term exact
        trainingFeaturesRef.current.push(avg);
        trainingTargetXRef.current.push(e.clientX);
        trainingTargetYRef.current.push(e.clientY);
        console.log(
          `[Sameyba/Gaze] Cal ${calStep + 1}/9 click ${calClicks + 1}/${CLICKS_PER_POINT}` +
            ` at (${e.clientX}, ${e.clientY})`,
        );
      } else {
        console.warn(
          `[Sameyba/Gaze] Cal ${calStep + 1}/9 click ${calClicks + 1}/${CLICKS_PER_POINT}` +
            ` — no face detected this frame, sample skipped`,
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
        // All 9 points done — fit the regression from the 18 collected
        // samples, show success, then open verification screen.

        // ── DIAGNOSTICS (V3.1 instrumentation) — run BEFORE fitting, purely
        // observational, changes nothing about the fit itself. ─────────────
        {
          const allFeatures = trainingFeaturesRef.current;
          console.group("[Sameyba/Gaze][DIAG] Calibration feature diagnostics");

          // 1. Feature-vector variance for each calibration target (the
          //    CLICKS_PER_POINT samples recorded at that point).
          const perTargetMeans: number[][] = [];
          CAL_POINTS.forEach((pt, p) => {
            const group = allFeatures.slice(
              p * CLICKS_PER_POINT,
              p * CLICKS_PER_POINT + CLICKS_PER_POINT,
            );
            const variance = diagFeatureVariance(group);
            const d = GAZE_FEATURE_COUNT;
            const mean = new Array(d).fill(0);
            group.forEach((v: number[]) => {
              for (let i = 0; i < d; i++) mean[i] += v[i] / (group.length || 1);
            });
            perTargetMeans.push(mean);
            console.log(
              `  target ${p} @ [${pt[0]}, ${pt[1]}] — ${group.length} samples, variance:`,
              diagLabelVector(variance),
            );
          });

          // Between-target variance of the per-target means — the feature
          // extractor is "working" only if this is large relative to the
          // within-target (above) variance. If between ≈ within, the
          // features aren't distinguishing calibration targets at all.
          const betweenTargetVariance = diagFeatureVariance(perTargetMeans);
          console.log(
            "  between-target variance (of per-target means):",
            diagLabelVector(betweenTargetVariance),
          );

          // 2. Number of unique calibration feature vectors (rounded 6dp)
          //    out of the total collected — catches a frozen/stale feature
          //    extractor even before looking at variance magnitudes.
          const uniqueKeys = new Set(allFeatures.map(diagFeatureKey));
          console.log(
            `  unique feature vectors: ${uniqueKeys.size} / ${allFeatures.length} total samples`,
          );
          if (uniqueKeys.size <= CAL_POINTS.length) {
            console.warn(
              `  ⚠ only ${uniqueKeys.size} unique feature vector(s) across ${allFeatures.length} clicks spanning ${CAL_POINTS.length} distinct screen targets — the feature extractor is producing near-identical (or literally identical) output regardless of where the user looked. This alone would explain a regression that predicts close to a single fixed point.`,
            );
          }
          console.groupEnd();
        }

        const wx = fitRidgeRegression(
          trainingFeaturesRef.current,
          trainingTargetXRef.current,
        );
        // V3.2 — Y gets its own dedicated model: the vertical-only feature
        // subset (see Y_FEATURE_INDICES) and its own ridge lambda
        // (RIDGE_LAMBDA_Y), instead of reusing the full 9-feature X-tuned
        // fit. See the "Dedicated vertical (Y) gaze model" note above for
        // why this run's own diagnostics (wy's large lNormX weight) point
        // straight at this as the fix.
        //
        // V3.4 — two more changes on top of V3.2, neither of which touches
        // X: (1) fit from 9 calibration-target-aggregated samples instead
        // of 18 individual clicks (see aggregateByCalibrationTarget), and
        // (2) pass Y_FEATURE_STD_FLOORS so a feature that barely moved
        // during calibration (headCenterY, sometimes pitch) gets its
        // standardization std floored instead of blown up into a huge
        // raw-space weight — see the Y_FEATURE_STD_FLOORS note above for
        // why that, not the feature subset itself, was the actual source
        // of the wild/off-screen raw predictions.
        const yTrainingFeaturesPerClick =
          trainingFeaturesRef.current.map(extractYSubFeatures);
        const { features: yAggFeatures, targets: yAggTargets } =
          aggregateByCalibrationTarget(
            yTrainingFeaturesPerClick,
            trainingTargetYRef.current,
            CLICKS_PER_POINT,
          );
        const wy = fitRidgeRegression(
          yAggFeatures,
          yAggTargets,
          GAZE_FEATURE_COUNT_Y,
          RIDGE_LAMBDA_Y,
          Y_FEATURE_STD_FLOORS,
        );
        weightsXRef.current = wx;
        weightsYRef.current = wy;

        // V3.2 — fit the Y affine (scale+offset) recalibration directly
        // against this calibration set: rawModelY[i] = wy·yFeatures[i],
        // regressed onto the true clicked/target screen-Y. See fitYAffine
        // above for why this — not another additive-only correction — is
        // what actually fixes a compressed range. Falls back to identity
        // (no-op) if wy failed to fit. This is deliberately still just the
        // *first-draft* affine: it has to exist before the verification
        // screen can show a moving cursor at all, but it's fit from the
        // same (now target-aggregated, but still just 9-point) calibration
        // clicks as wy itself. It gets refined again, using the actual
        // top/center/bottom verification measurements, once verification
        // completes — see refitVerticalAffineFromVerification below.
        if (wy) {
          const rawModelYOnTrainingSet = yAggFeatures.map((f) => dot(wy, f));
          yAffineRef.current = fitYAffine(rawModelYOnTrainingSet, yAggTargets);
        } else {
          yAffineRef.current = IDENTITY_AFFINE;
        }

        console.log(
          `[Sameyba/Gaze] Calibration complete ✓ — regression fit from ${trainingFeaturesRef.current.length} samples`,
          wx && wy ? "" : "(fit failed — too few valid samples)",
        );

        // 3. The fitted X and Y ridge-regression weights themselves. wy is
        // now the dedicated 5-feature vertical model — labeled with
        // Y_FEATURE_NAMES, not the full 9-feature GAZE_FEATURE_NAMES.
        console.log(
          "[Sameyba/Gaze][DIAG] Fitted weights — wx:",
          wx ? diagLabelVector(wx, (n) => n.toFixed(4)) : null,
        );
        console.log(
          "[Sameyba/Gaze][DIAG] Fitted weights — wy (dedicated Y model):",
          wy
            ? Object.fromEntries(
                Y_FEATURE_NAMES.map((name, i) => [name, wy[i].toFixed(4)]),
              )
            : null,
        );
        console.log(
          `[Sameyba/Gaze][DIAG] Y affine recalibration — scale=${yAffineRef.current.scale.toFixed(3)}, offset=${yAffineRef.current.offset.toFixed(1)}px` +
            (yAffineRef.current.scale === 1 && yAffineRef.current.offset === 0
              ? " (identity — fit skipped or degenerate)"
              : ""),
        );
        if (wx && wy) {
          // A weight vector that's ~all-zero outside the bias term means
          // the regression learned to ignore the eye-geometry features
          // entirely and just predict (roughly) the mean click position —
          // exactly "fixed near screen center" behavior.
          const nonBiasMagX = Math.hypot(...wx.slice(1));
          const nonBiasMagY = Math.hypot(...wy.slice(1));
          console.log(
            `[Sameyba/Gaze][DIAG] non-bias weight magnitude — |wx[1:]|=${nonBiasMagX.toFixed(4)}, |wy[1:]|=${nonBiasMagY.toFixed(4)} (near-zero ⇒ regression is ~ignoring eye-geometry features and just predicting the mean click position)`,
          );
        }

        setCalSuccess(true);
        setTimeout(() => {
          setCalibrating(false);
          // Reset all prediction data so calibration coords don't bleed into normal use
          rawRef.current = null;
          resetGazeFilters();
          verifyTargetSamplesRef.current = VERIFY_TARGETS.map(() => []);
          verifyTargetXSamplesRef.current = VERIFY_TARGETS.map(() => []);
          // DIAGNOSTICS — fresh raw-sample buckets + min/max for this sweep.
          diagVerifyRawXSamplesRef.current = VERIFY_TARGETS.map(() => []);
          diagVerifyRawYSamplesRef.current = VERIFY_TARGETS.map(() => []);
          diagVerifyMinMaxRef.current = {
            minX: Infinity,
            maxX: -Infinity,
            minY: Infinity,
            maxY: -Infinity,
          };
          // Enable gaze so cursor moves during verification
          setGazeEnabled(true);
          setVerifying(true);
        }, 1800);
      }
    },
    [calStep, calClicks],
  );

  // ── recalibrate ───────────────────────────────────────────────────────────────
  const recalibrate = useCallback(() => {
    if (permissionState !== "granted") return;
    setGazeEnabled(false);
    setCalibrated(false);
    setVerifying(false);
    setCalSuccess(false);
    resetGazeFilters();
    rawRef.current = null;
    trainingFeaturesRef.current = [];
    trainingTargetXRef.current = [];
    trainingTargetYRef.current = [];
    weightsXRef.current = null;
    weightsYRef.current = null;
    yAffineRef.current = IDENTITY_AFFINE;
    setCalStep(0);
    setCalClicks(0);
    // Show instruction card; actual calibration starts on confirmation.
    pendingCalibrationRef.current = () => {
      setCalibrating(true);
    };
    setInstructing(true);
    console.log("[Sameyba/Gaze] Recalibration: showing instructions");
  }, [permissionState]);

  // ── cancelCalibration ─────────────────────────────────────────────────────────
  const cancelCalibration = useCallback(() => {
    setCalibrating(false);
    setVerifying(false);
    setCalSuccess(false);
    setCalStep(0);
    setCalClicks(0);
    setInstructing(false);
    pendingCalibrationRef.current = null;
  }, []);

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  // Stops the camera stream and detection loop on unmount. Deliberately NOT
  // scoped to gazeEnabled — the detection loop runs for the whole session
  // (see requestCamera above) independent of that flag, so it must be torn
  // down independently too. The FaceLandmarker instance itself is left open
  // (module-level singleton) so a remount doesn't re-download the model.
  useEffect(() => {
    return () => {
      detectionActiveRef.current = false;
      try {
        streamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      const v = videoElRef.current;
      if (v) {
        try {
          v.srcObject = null;
          v.remove();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  // ── Derived status ────────────────────────────────────────────────────────────
  const gazeStatus: GazeStatus = preparingGaze
    ? "preparing"
    : calibrating
      ? "calibrating"
      : verifying
        ? "verifying"
        : !calibrated
          ? "idle"
          : gazeTargetId !== null
            ? "dwelling"
            : "ready";

  return (
    <GazeContext.Provider
      value={{
        gazeEnabled,
        gazePos,
        gazeTargetId,
        permissionState,
        requestCamera,
        calibrated,
        gazeStatus,
        recalibrate,
        cancelCalibration,
      }}
    >
      {children}

      {/* Gaze cursor — hidden during verification (dedicated red dot used instead) */}
      {createPortal(
        <div
          id="sameyba-gaze-cursor"
          aria-hidden
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "rgba(94,126,53,0.22)",
            border: "2.5px solid rgba(94,126,53,0.80)",
            boxShadow:
              "0 0 14px rgba(94,126,53,0.50), 0 0 28px rgba(94,126,53,0.20)",
            pointerEvents: "none",
            zIndex: 999998,
            opacity: 0,
            willChange: "transform",
            display: gazeEnabled && !verifying ? "block" : "none",
            transition: "opacity 0.15s",
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

      {/* Calibration instruction card */}
      {createPortal(
        <AnimatePresence>
          {instructing && (
            <CalibrationInstructionCard
              onBegin={() => {
                setInstructing(false);
                pendingCalibrationRef.current?.();
                pendingCalibrationRef.current = null;
              }}
              onCancel={() => {
                setInstructing(false);
                pendingCalibrationRef.current = null;
              }}
            />
          )}
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
              onCancel={cancelCalibration}
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
              visualPos={visualCursorPos}
              verifyStep={verifyStep}
              onConfirm={() => {
                // ── DIAGNOSTICS (V3.1 instrumentation) — evaluate the raw
                // (pre-filter, pre-bias-correction) verification-sweep
                // predictions before the existing bias estimator runs.
                // Purely observational; does not change what
                // estimateAndApplyBiasCorrections() below does. ────────────
                {
                  const mm = diagVerifyMinMaxRef.current;
                  console.group(
                    "[Sameyba/Gaze][DIAG] Verification sweep summary",
                  );
                  console.log(
                    `  raw predicted x range: [${mm.minX === Infinity ? "n/a" : mm.minX.toFixed(1)}, ${mm.maxX === -Infinity ? "n/a" : mm.maxX.toFixed(1)}] px (spread ${mm.maxX === -Infinity ? "n/a" : (mm.maxX - mm.minX).toFixed(1)}px)`,
                  );
                  console.log(
                    `  raw predicted y range: [${mm.minY === Infinity ? "n/a" : mm.minY.toFixed(1)}, ${mm.maxY === -Infinity ? "n/a" : mm.maxY.toFixed(1)}] px (spread ${mm.maxY === -Infinity ? "n/a" : (mm.maxY - mm.minY).toFixed(1)}px)`,
                  );
                  VERIFY_TARGETS.forEach((t, i) => {
                    const rxs = diagVerifyRawXSamplesRef.current[i];
                    const rys = diagVerifyRawYSamplesRef.current[i];
                    const expX = window.innerWidth * t.xFrac;
                    const expY = window.innerHeight * t.yFrac;
                    if (rxs.length === 0) {
                      console.log(
                        `  target ${i} [${(t.xFrac * 100).toFixed(0)}%,${(t.yFrac * 100).toFixed(0)}%] — no post-settle samples collected`,
                      );
                      return;
                    }
                    const meanX =
                      rxs.reduce((s: number, v: number) => s + v, 0) /
                      rxs.length;
                    const meanY =
                      rys.reduce((s: number, v: number) => s + v, 0) /
                      rys.length;
                    console.log(
                      `  target ${i} [${(t.xFrac * 100).toFixed(0)}%,${(t.yFrac * 100).toFixed(0)}%] expected=(${expX.toFixed(0)},${expY.toFixed(0)}) meanRawPredicted=(${meanX.toFixed(1)},${meanY.toFixed(1)}) n=${rxs.length}`,
                    );
                  });
                  const rawDiagFrame = diagRawFrameRef.current;
                  console.log(
                    `  rawRef.current unchanged-frame-to-frame: ${rawDiagFrame.unchangedFrames}/${rawDiagFrame.totalFrames} frames identical to the previous frame (longest identical streak: ${rawDiagFrame.maxUnchangedStreak})`,
                  );
                  console.groupEnd();
                }

                // V3.4 — tighten the Y affine against the actual
                // top/center/bottom verification measurements before the
                // (small, additive-only) residual bias estimate below runs
                // on top of it — see refitVerticalAffineFromVerification.
                refitVerticalAffineFromVerification();
                estimateAndApplyBiasCorrections();
                verifyTargetSamplesRef.current = VERIFY_TARGETS.map(() => []);
                verifyTargetXSamplesRef.current = VERIFY_TARGETS.map(() => []);
                setCalibrated(true);
                setVerifying(false);
              }}
              onRecalibrate={recalibrate}
              onCancel={cancelCalibration}
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

// ── CalibrationInstructionCard ────────────────────────────────────────────────
function CalibrationInstructionCard({
  onBegin,
  onCancel,
}: {
  onBegin: () => void;
  onCancel?: () => void;
}) {
  return (
    <motion.div
      key="cal-instructions"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000000,
        background: "rgba(5, 5, 20, 0.94)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        direction: "rtl",
        padding: "24px",
      }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 28 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 8 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        style={{
          background: "rgba(255,255,255,0.055)",
          border: "1px solid rgba(255,255,255,0.13)",
          borderRadius: 28,
          padding: "44px 40px 36px",
          maxWidth: 440,
          width: "100%",
          textAlign: "center",
        }}
      >
        {/* Illustration — face → camera */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            marginBottom: 28,
          }}
        >
          <span style={{ fontSize: "2.6rem", lineHeight: 1 }}>👤</span>
          <motion.div
            animate={{ x: [0, -7, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            style={{ display: "flex", alignItems: "center" }}
          >
            <svg width="32" height="16" viewBox="0 0 32 16" fill="none">
              <path
                d="M2 8 H26 M20 2 L28 8 L20 14"
                stroke="rgba(255,255,255,0.45)"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.div>
          <span style={{ fontSize: "2.6rem", lineHeight: 1 }}>📷</span>
        </div>

        {/* Title */}
        <h2
          style={{
            fontSize: "1.45rem",
            fontWeight: 800,
            color: "#fff",
            margin: "0 0 24px",
            letterSpacing: "-0.025em",
            lineHeight: 1.25,
          }}
        >
          تهيئة تتبع العين
        </h2>

        {/* Instruction bullets */}
        <div
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            borderRadius: 16,
            padding: "20px 22px",
            textAlign: "right",
            marginBottom: 32,
          }}
        >
          <p
            style={{
              fontSize: "0.88rem",
              fontWeight: 700,
              color: "rgba(255,255,255,0.65)",
              margin: "0 0 14px",
            }}
          >
            للحصول على أفضل دقة:
          </p>
          {[
            "انظر مباشرة إلى كل نقطة.",
            "اضغط على النقطة مع الاستمرار في النظر إليها.",
            "حافظ على ثبات رأسك قدر الإمكان.",
            "تأكد من وجود إضاءة جيدة على وجهك.",
          ].map((tip, i, arr) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                marginBottom: i < arr.length - 1 ? 10 : 0,
              }}
            >
              <span
                style={{
                  color: "#7BA043",
                  fontSize: "0.55rem",
                  marginTop: 5,
                  flexShrink: 0,
                  lineHeight: 1,
                }}
              >
                ●
              </span>
              <span
                style={{
                  fontSize: "0.875rem",
                  color: "rgba(255,255,255,0.58)",
                  lineHeight: 1.55,
                }}
              >
                {tip}
              </span>
            </div>
          ))}
        </div>

        {/* Begin button */}
        <motion.button
          onClick={onBegin}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 340, damping: 22 }}
          style={{
            width: "100%",
            padding: "17px 0",
            borderRadius: 999,
            background: "linear-gradient(135deg, #5E7E35 0%, #7BA043 100%)",
            border: "none",
            color: "#fff",
            fontSize: "1.05rem",
            fontWeight: 800,
            cursor: "pointer",
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            letterSpacing: "-0.015em",
            boxShadow: "0 6px 24px rgba(94,126,53,0.45)",
            marginBottom: onCancel ? 12 : 0,
          }}
        >
          ابدأ التهيئة ✓
        </motion.button>

        {onCancel && (
          <button
            onClick={onCancel}
            style={{
              width: "100%",
              padding: "13px 0",
              borderRadius: 999,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "rgba(255,255,255,0.42)",
              fontSize: "0.90rem",
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            }}
          >
            إلغاء
          </button>
        )}
      </motion.div>
    </motion.div>
  );
}

// ── CalibrationOverlay ────────────────────────────────────────────────────────
function CalibrationOverlay({
  step,
  clicks,
  success,
  onPointClick,
  onCancel,
}: {
  step: number;
  clicks: number;
  success: boolean;
  onPointClick: (e: React.MouseEvent) => void;
  onCancel?: () => void;
}) {
  const total = CAL_POINTS.length * CLICKS_PER_POINT;
  const done = step * CLICKS_PER_POINT + clicks;
  const pct = Math.round((done / total) * 100);

  return (
    <motion.div
      key="cal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000000,
        background: "rgba(5, 5, 20, 0.92)",
        backdropFilter: "blur(6px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        direction: "rtl",
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
            style={{ textAlign: "center" }}
          >
            <motion.div
              initial={{ scale: 0.5 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              style={{
                width: 96,
                height: 96,
                borderRadius: "50%",
                margin: "0 auto 28px",
                background: "rgba(52,199,89,0.15)",
                border: "3px solid rgba(52,199,89,0.60)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "2.8rem",
              }}
            >
              ✅
            </motion.div>
            <p
              style={{
                fontSize: "1.35rem",
                fontWeight: 700,
                color: "#fff",
                margin: "0 0 12px",
              }}
            >
              ✅ تمت تهيئة تتبع العين بنجاح
            </p>
            <p
              style={{
                fontSize: "0.92rem",
                color: "rgba(255,255,255,0.55)",
                margin: 0,
              }}
            >
              سنجري اختباراً سريعاً للتأكد من جودة التتبع.
            </p>
          </motion.div>
        ) : (
          /* ── Calibration points ── */
          <motion.div
            key="points"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: "absolute", inset: 0 }}
          >
            {/* Header */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                padding: "32px 24px 0",
              }}
            >
              <p
                style={{
                  fontSize: "1.1rem",
                  fontWeight: 700,
                  color: "#fff",
                  margin: "0 0 8px",
                }}
              >
                تهيئة تتبع العين
              </p>
              <p
                style={{
                  fontSize: "0.88rem",
                  color: "rgba(255,255,255,0.55)",
                  margin: "0 0 4px",
                }}
              >
                انظر مباشرة إلى النقطة ثم اضغط عليها دون تحريك رأسك
              </p>
              <p
                style={{
                  fontSize: "0.80rem",
                  color: "rgba(255,255,255,0.35)",
                  margin: "0 0 18px",
                }}
              >
                النقطة {step + 1} من {CAL_POINTS.length}
              </p>
              {/* Progress bar */}
              <div
                style={{
                  width: 220,
                  height: 5,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.12)",
                  overflow: "hidden",
                }}
              >
                <motion.div
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.3 }}
                  style={{
                    height: "100%",
                    borderRadius: 999,
                    background: "linear-gradient(90deg, #5E7E35, #7BA043)",
                  }}
                />
              </div>
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "rgba(255,255,255,0.35)",
                  margin: "8px 0 0",
                }}
              >
                {pct}% مكتمل
              </p>
            </div>

            {/* Calibration dots */}
            {CAL_POINTS.map(([cf, rf], i) => {
              const isActive = i === step;
              const isComplete = i < step;
              const x = `${cf * 100}%`;
              const y = `${rf * 100}%`;
              return (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: x,
                    top: y,
                    transform: "translate(-50%, -50%)",
                    cursor: isActive ? "pointer" : "default",
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

      {/* Cancel button — hidden during success animation */}
      {!success && onCancel && (
        <div
          style={{
            position: "absolute",
            bottom: "6%",
            left: 0,
            right: 0,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <button
            onClick={onCancel}
            style={{
              padding: "14px 40px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.07)",
              border: "1.5px solid rgba(255,255,255,0.22)",
              color: "rgba(255,255,255,0.75)",
              fontSize: "1rem",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "'IBM Plex Sans Arabic', sans-serif",
              letterSpacing: "-0.01em",
            }}
          >
            ✕ إلغاء والرجوع
          </button>
        </div>
      )}
    </motion.div>
  );
}

function ActiveCalPoint({
  clicks,
  onTap,
}: {
  clicks: number;
  onTap: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      onClick={onTap}
      style={{ position: "relative", width: 64, height: 64, cursor: "pointer" }}
    >
      {/* Outer pulse ring */}
      <motion.div
        animate={{ scale: [1, 1.55, 1], opacity: [0.6, 0, 0.6] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute",
          inset: -12,
          borderRadius: "50%",
          border: "2.5px solid rgba(94,126,53,0.5)",
        }}
      />
      {/* Inner circle */}
      <motion.div
        animate={{ scale: [1, 1.08, 1] }}
        transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
        style={{
          width: "100%",
          height: "100%",
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(94,126,53,0.9) 0%, rgba(94,126,53,0.5) 100%)",
          border: "2.5px solid rgba(255,255,255,0.8)",
          boxShadow: "0 0 24px rgba(94,126,53,0.6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Click counter dots */}
        <div style={{ display: "flex", gap: 5 }}>
          {Array.from({ length: CLICKS_PER_POINT }).map((_, k) => (
            <div
              key={k}
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: k < clicks ? "#fff" : "rgba(255,255,255,0.35)",
                transition: "background 0.2s",
              }}
            />
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
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "rgba(52,199,89,0.25)",
        border: "2px solid rgba(52,199,89,0.70)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "0.85rem",
      }}
    >
      ✓
    </motion.div>
  );
}

function FutureCalPoint() {
  return (
    <div
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        background: "rgba(255,255,255,0.08)",
        border: "1.5px solid rgba(255,255,255,0.18)",
      }}
    />
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
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000001,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 20px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.13), inset 0 1px 0 rgba(255,255,255,1)",
        border: "1px solid rgba(255,255,255,0.95)",
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        direction: "rtl",
        whiteSpace: "nowrap",
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: "2px solid rgba(94,126,53,0.25)",
          borderTopColor: "#5E7E35",
          animation: "sameyba-spin 0.75s linear infinite",
          flexShrink: 0,
        }}
      />
      <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "#1C1C1E" }}>
        جاري تجهيز تتبع العين…
      </span>
    </motion.div>
  );
}

// ── CalibrationVerification ───────────────────────────────────────────────────
const VERIFY_TARGETS = [
  { id: "center", label: "الوسط", x: "50%", y: "50%", xFrac: 0.5, yFrac: 0.5 },
  { id: "top", label: "الأعلى", x: "50%", y: "10%", xFrac: 0.5, yFrac: 0.1 },
  { id: "bottom", label: "الأسفل", x: "50%", y: "90%", xFrac: 0.5, yFrac: 0.9 },
  { id: "left", label: "اليسار", x: "10%", y: "50%", xFrac: 0.1, yFrac: 0.5 },
  { id: "right", label: "اليمين", x: "90%", y: "50%", xFrac: 0.9, yFrac: 0.5 },
] as const;

function CalibrationVerification({
  gazePos,
  visualPos,
  verifyStep,
  onConfirm,
  onRecalibrate,
  onCancel,
}: {
  gazePos: { x: number; y: number } | null;
  visualPos: { x: number; y: number } | null;
  verifyStep: number | null;
  onConfirm: () => void;
  onRecalibrate: () => void;
  onCancel?: () => void;
}) {
  return (
    <motion.div
      key="cal-verify"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000000,
        background: "rgba(5, 5, 20, 0.92)",
        backdropFilter: "blur(6px)",
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        direction: "rtl",
      }}
    >
      {/* Header */}
      <div
        style={{
          position: "absolute",
          top: "5%",
          left: 0,
          right: 0,
          textAlign: "center",
        }}
      >
        <p
          style={{
            fontSize: "1.1rem",
            fontWeight: 700,
            color: "#fff",
            margin: "0 0 8px",
          }}
        >
          التحقق من جودة التتبع
        </p>
        <p
          style={{
            fontSize: "0.88rem",
            color: "rgba(255,255,255,0.55)",
            margin: 0,
          }}
        >
          انظر إلى كل نقطة — هل يتابعها المؤشر الأخضر؟
        </p>
      </div>

      {/* Test targets */}
      {VERIFY_TARGETS.map((t, i) => {
        const isActive = verifyStep === i;

        return (
          <div
            key={t.id}
            style={{
              position: "absolute",
              left: t.x,
              top: t.y,
              transform: "translate(-50%, -50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                width: isActive ? 58 : 46,
                height: isActive ? 58 : 46,
                background: isActive
                  ? "rgba(94,126,53,0.18)"
                  : "rgba(255,255,255,0.06)",
                border: isActive
                  ? "3px solid #7BA043"
                  : "2px solid rgba(255,255,255,0.40)",
                boxShadow: isActive ? "0 0 20px rgba(123,160,67,0.55)" : "none",
                transition: "all .25s ease",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: isActive ? 14 : 10,
                  height: isActive ? 14 : 10,
                  background: isActive ? "#fff" : "rgba(255,255,255,0.85)",
                  transition: "all .25s ease",
                  borderRadius: "50%",
                }}
              />
            </div>
            <span
              style={{
                fontSize: isActive ? "0.80rem" : "0.72rem",
                color: isActive ? "#fff" : "rgba(255,255,255,0.40)",
                fontWeight: isActive ? 800 : 600,
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
            </span>
          </div>
        );
      })}

      {/* Live gaze cursor (green) */}
      {visualPos && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "rgba(94,126,53,0.55)",
            border: "2.5px solid #7BA043",
            pointerEvents: "none",
            zIndex: 1000002,
            transform: `translate3d(${visualPos.x - 12}px, ${visualPos.y - 12}px, 0)`,
            willChange: "transform",
            boxShadow: "0 0 12px rgba(94,126,53,0.65)",
          }}
        />
      )}

      {/* Action buttons */}
      <div
        style={{
          position: "absolute",
          bottom: "8%",
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
          gap: 12,
        }}
      >
        {onCancel && (
          <button
            onClick={onCancel}
            style={{
              padding: "12px 28px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.04)",
              border: "1.5px solid rgba(255,255,255,0.14)",
              color: "rgba(255,255,255,0.55)",
              fontSize: "0.95rem",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            }}
          >
            إلغاء والرجوع
          </button>
        )}
        <button
          onClick={onRecalibrate}
          style={{
            padding: "12px 28px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
            border: "1.5px solid rgba(255,255,255,0.25)",
            color: "rgba(255,255,255,0.80)",
            fontSize: "0.95rem",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
          }}
        >
          🔄 إعادة التهيئة
        </button>
        <button
          onClick={onConfirm}
          style={{
            padding: "12px 32px",
            borderRadius: 999,
            background: "linear-gradient(135deg, #5E7E35, #7BA043)",
            border: "none",
            color: "#fff",
            fontSize: "0.95rem",
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            boxShadow: "0 4px 16px rgba(94,126,53,0.35)",
          }}
        >
          ✅ المتابعة
        </button>
      </div>
    </motion.div>
  );
}

// ── GazeStatusIndicator ───────────────────────────────────────────────────────
function GazeStatusIndicator({
  hovering,
  dwellActive,
  onRecalibrate,
}: {
  hovering: boolean;
  dwellActive: boolean;
  onRecalibrate: () => void;
}) {
  const label =
    dwellActive || hovering ? "ثبّت نظرك للاختيار" : "تتبع العين جاهز";
  const color = dwellActive
    ? "#34C759"
    : hovering
      ? "#7BA043"
      : "rgba(255,255,255,0.65)";

  return (
    <motion.div
      key="gaze-status"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      style={{
        position: "fixed",
        bottom: 20,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 999997,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "7px 10px 7px 18px",
        borderRadius: 999,
        background: "rgba(15,15,25,0.75)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(255,255,255,0.10)",
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        direction: "rtl",
        pointerEvents: "auto",
      }}
    >
      {/* Status dot */}
      <motion.div
        animate={{ opacity: dwellActive ? [1, 0.4, 1] : 1 }}
        transition={{ duration: 0.8, repeat: dwellActive ? Infinity : 0 }}
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
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
        style={{
          fontSize: "0.80rem",
          fontWeight: 600,
          color: "rgba(255,255,255,0.85)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </motion.span>

      {/* Recalibrate button */}
      <button
        onClick={onRecalibrate}
        title="إعادة التهيئة"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "4px 10px",
          borderRadius: 999,
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.16)",
          color: "rgba(255,255,255,0.70)",
          fontSize: "0.74rem",
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "'IBM Plex Sans Arabic', sans-serif",
          flexShrink: 0,
          transition: "background 0.15s, color 0.15s",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(255,255,255,0.18)";
          (e.currentTarget as HTMLButtonElement).style.color = "#fff";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.background =
            "rgba(255,255,255,0.10)";
          (e.currentTarget as HTMLButtonElement).style.color =
            "rgba(255,255,255,0.70)";
        }}
      >
        {/* Refresh icon */}
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 .49-3.5" />
        </svg>
        تهيئة
      </button>
    </motion.div>
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
  const visible = permissionState !== "granted";

  const displayLabel =
    permissionState === "denied"
      ? (errorLabel ?? "تم رفض الكاميرا — يعمل التطبيق بالفأرة")
      : permissionState === "requesting"
        ? "جارٍ تفعيل تتبع العيون…"
        : "فعّل تتبع العيون بالكاميرا";

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
            position: "fixed",
            top: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999999,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            boxShadow:
              "0 8px 32px rgba(0,0,0,0.13), 0 2px 8px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,1)",
            border: "1px solid rgba(255,255,255,0.95)",
            direction: "rtl",
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            whiteSpace: "nowrap",
            maxWidth: "min(92vw, 600px)",
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              color: permissionState === "denied" ? "#FF3B30" : "#5E7E35",
              flexShrink: 0,
            }}
          >
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>

          <span
            style={{
              fontSize: "0.88rem",
              fontWeight: 600,
              color: permissionState === "denied" ? "#C0392B" : "#1C1C1E",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {displayLabel}
          </span>

          {permissionState === "idle" && (
            <button
              onClick={requestCamera}
              style={{
                padding: "5px 14px",
                borderRadius: 999,
                background: "#5E7E35",
                color: "white",
                border: "none",
                fontSize: "0.82rem",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "'IBM Plex Sans Arabic', sans-serif",
                flexShrink: 0,
              }}
            >
              تفعيل
            </button>
          )}
          {permissionState === "denied" && (
            <button
              onClick={requestCamera}
              style={{
                padding: "5px 14px",
                borderRadius: 999,
                background: "#FF3B30",
                color: "white",
                border: "none",
                fontSize: "0.82rem",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "'IBM Plex Sans Arabic', sans-serif",
                flexShrink: 0,
              }}
            >
              إعادة المحاولة
            </button>
          )}
          {permissionState === "requesting" && (
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                border: "2px solid rgba(94,126,53,0.25)",
                borderTopColor: "#5E7E35",
                animation: "sameyba-spin 0.75s linear infinite",
                flexShrink: 0,
              }}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
console.log(
  "ASHWAG TEST V3.5 — MediaPipe FaceLandmarker (rVFC-gated, adaptive-cadence, benchmarked delegate) + custom ridge-regression gaze estimator: dedicated Y model with per-feature std-floor regularization (fixes headCenterY/pitch weight blow-up), 9-point calibration-target-aggregated fit, two-stage Y affine (calibration draft + verification-measured refit), clamped (not dropped) out-of-viewport raw samples, widened jump-outlier gate (Card-Intent Engine unchanged, DOM rect cache + throttled React state)",
);
