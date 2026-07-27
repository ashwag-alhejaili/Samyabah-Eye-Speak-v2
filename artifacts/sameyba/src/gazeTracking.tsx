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

let faceLandmarkerPromise: Promise<FaceLandmarkerInstance> | null = null;
async function getFaceLandmarker(): Promise<FaceLandmarkerInstance> {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      const { FilesetResolver, FaceLandmarker } = await loadTasksVisionModule();
      const fileset = await FilesetResolver.forVisionTasks(
        TASKS_VISION_WASM_BASE,
      );
      const commonOptions = {
        baseOptions: {
          modelAssetPath: FACE_LANDMARKER_MODEL_URL,
          delegate: "GPU" as const,
        },
        runningMode: "VIDEO" as const,
        numFaces: 1,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
      };
      try {
        console.log("[Sameyba/Gaze] Creating FaceLandmarker (GPU delegate)...");
        return await FaceLandmarker.createFromOptions(fileset, commonOptions);
      } catch (gpuErr) {
        console.warn(
          "[Sameyba/Gaze] GPU delegate failed, retrying with CPU:",
          gpuErr,
        );
        return await FaceLandmarker.createFromOptions(fileset, {
          ...commonOptions,
          baseOptions: { ...commonOptions.baseOptions, delegate: "CPU" },
        });
      }
    })();
  }
  return faceLandmarkerPromise;
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
 *  there isn't enough data to fit reliably. */
function fitRidgeRegression(
  samples: number[][],
  targets: number[],
): number[] | null {
  const n = samples.length;
  if (n < 6) return null;
  const d = GAZE_FEATURE_COUNT;

  const xtx: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const xty: number[] = new Array(d).fill(0);

  for (let i = 0; i < n; i++) {
    const row = samples[i];
    const t = targets[i];
    for (let a = 0; a < d; a++) {
      xty[a] += row[a] * t;
      for (let b = 0; b < d; b++) {
        xtx[a][b] += row[a] * row[b];
      }
    }
  }

  // Regularize everything except the bias term (index 0), so the intercept
  // isn't artificially shrunk toward zero.
  for (let a = 1; a < d; a++) xtx[a][a] += RIDGE_LAMBDA;

  return solveLinearSystem(xtx, xty);
}

function dot(w: number[], x: number[]): number {
  let s = 0;
  for (let i = 0; i < w.length; i++) s += w[i] * x[i];
  return s;
}

// ── Outlier rejection tuning constants (v1.2, unchanged) ─────────────────────
/** A raw WebGazer sample jumping more than this (px) from the last accepted
 *  sample, within OUTLIER_MAX_DT_MS, is rejected as noise. */
const OUTLIER_MAX_JUMP_PX = 200;
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
// ── Adaptive vertical bias correction tuning (v1.4) ──────────────────────────
/** localStorage key used to persist the learned vertical bias across sessions. */
const VBIAS_STORAGE_KEY = "sameyba_gaze_vbias_px";
// ── Adaptive horizontal bias correction tuning (V2.1) ────────────────────────
// V2.0's verification sweep already visits a "left" (10%) and "right" (90%)
// target — but only ever recorded their Y samples. Every other axis-specific
// number below (settle window, min samples, MAD outlier threshold, minimum
// valid targets, clamp) is identical to the vertical scheme by design: this
// is the same estimator, run on the other axis, not a new algorithm.
/** localStorage key used to persist the learned horizontal bias across sessions. */
const HBIAS_STORAGE_KEY = "sameyba_gaze_hbias_px";
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
  /** Calibration training set — one entry per recorded click. */
  const trainingFeaturesRef = useRef<number[][]>([]);
  const trainingTargetXRef = useRef<number[]>([]);
  const trainingTargetYRef = useRef<number[]>([]);
  /** Fitted regression weights. Null until calibration completes. */
  const weightsXRef = useRef<number[] | null>(null);
  const weightsYRef = useRef<number[] | null>(null);

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

  // ── RAF loop ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!gazeEnabled) return;
    let running = true;

    function loop() {
      if (!running) return;

      const raw = rawRef.current;
      if (raw != null) {
        // 1. Validate: reject NaN or off-screen coords
        const vw = window.innerWidth,
          vh = window.innerHeight;
        if (
          !isNaN(raw.x) &&
          !isNaN(raw.y) &&
          raw.x >= 0 &&
          raw.x <= vw &&
          raw.y >= 0 &&
          raw.y <= vh
        ) {
          // 2. Exponential moving average (0.70 old + 0.30 raw — responsive)
          // 2. One Euro Filter — replaces EMA smoothing
          const now_ms = performance.now();
          // 2a. Outlier rejection (v1.2) — ignore a raw WebGazer sample that
          //     jumps further than OUTLIER_MAX_JUMP_PX within OUTLIER_MAX_DT_MS
          //     of the last accepted raw sample.
          const lastAcceptedRaw = lastAcceptedRawRef.current;

          if (lastAcceptedRaw !== null) {
            const dtMs = now_ms - lastAcceptedRaw.ts;

            const jumpPx = Math.hypot(
              raw.x - lastAcceptedRaw.x,
              raw.y - lastAcceptedRaw.y,
            );

            if (dtMs <= OUTLIER_MAX_DT_MS && jumpPx > OUTLIER_MAX_JUMP_PX) {
              requestAnimationFrame(loop);
              return;
            }
          }

          lastAcceptedRawRef.current = {
            x: raw.x,
            y: raw.y,
            ts: now_ms,
          };

          const oneEuroX = filterXRef.current.filter(raw.x, now_ms);
          const oneEuroY = filterYRef.current.filter(raw.y, now_ms);

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
          // (e.g. CalibrationVerification).
          setVisualCursorPos({ x: cursorX, y: cursorY });

          // Diagnostic / calibration / bias-estimation coordinate — the
          // direct filtered value, not the cursor's extra visual smoothing.
          setGazePos({ x: gazeX, y: gazeY });

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
          const gazeCardEls =
            document.querySelectorAll<HTMLElement>("[data-gaze-id]");

          let instantHitId: string | null = null;
          let bestDist = Infinity;

          gazeCardEls.forEach((el) => {
            const id = el.dataset.gazeId;
            if (!id) return;

            const rect = el.getBoundingClientRect();
            const dx = Math.max(rect.left - gazeX, 0, gazeX - rect.right);
            const dy = Math.max(rect.top - gazeY, 0, gazeY - rect.bottom);
            const dist = Math.hypot(dx, dy);

            if (dist < bestDist) {
              bestDist = dist;
              instantHitId = id;
            }
          });

          if (bestDist > CARD_NEAR_CUTOFF_PX) {
            instantHitId = null;
          }

          if (instantHitId !== gazeHoverRef.current) {
            gazeHoverRef.current = instantHitId;
            setGazeHoverId(instantHitId);
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
          gazeCardEls.forEach((el) => {
            const id = el.dataset.gazeId;
            if (id) idsToUpdate.add(id);
          });

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

      setPermissionState("granted");

      // 5. Start the continuous detection loop — runs for the whole session
      //    (independent of gazeEnabled/calibrated), feeding rawRef.current
      //    from the fitted regression once one exists, and latestFeaturesRef
      //    always (used both for warm-up detection and calibration clicks).
      detectionActiveRef.current = true;
      const detectLoop = () => {
        if (!detectionActiveRef.current) return;
        const v = videoElRef.current;
        const fl = faceLandmarkerRef.current;
        if (v && fl && v.readyState >= 2) {
          const result = fl.detectForVideo(v, performance.now());
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
              rawRef.current = { x: dot(wx, features), y: dot(wy, features) };
            }
          }
        }
        requestAnimationFrame(detectLoop);
      };
      requestAnimationFrame(detectLoop);

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
        const wx = fitRidgeRegression(
          trainingFeaturesRef.current,
          trainingTargetXRef.current,
        );
        const wy = fitRidgeRegression(
          trainingFeaturesRef.current,
          trainingTargetYRef.current,
        );
        weightsXRef.current = wx;
        weightsYRef.current = wy;
        console.log(
          `[Sameyba/Gaze] Calibration complete ✓ — regression fit from ${trainingFeaturesRef.current.length} samples`,
          wx && wy ? "" : "(fit failed — too few valid samples)",
        );
        setCalSuccess(true);
        setTimeout(() => {
          setCalibrating(false);
          // Reset all prediction data so calibration coords don't bleed into normal use
          rawRef.current = null;
          resetGazeFilters();
          verifyTargetSamplesRef.current = VERIFY_TARGETS.map(() => []);
          verifyTargetXSamplesRef.current = VERIFY_TARGETS.map(() => []);
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
  "ASHWAG TEST V3.0 — MediaPipe FaceLandmarker + custom ridge-regression gaze estimator (Card-Intent Engine unchanged)",
);
