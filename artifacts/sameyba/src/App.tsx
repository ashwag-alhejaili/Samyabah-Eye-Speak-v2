import { useState, useRef, useCallback, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, useLocation, useRoute } from 'wouter';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import {
  Eye, Volume2, Smartphone, ChevronRight,
  HeartPulse, Utensils, Heart, Sparkles, Home as HomeIcon, Users,
  Droplets, UtensilsCrossed, BellOff,
} from 'lucide-react';

// ── Custom icon: Toilet (front-view, stroke-based) ────────────────────────────
function ToiletIcon({
  size = 24,
  color = 'currentColor',
  strokeWidth = 1.75,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Tank */}
      <rect x="6" y="2" width="12" height="6" rx="1.5" />
      {/* Bowl outer — wide at top, tapers toward base */}
      <path d="M4 8 h16 Q20.5 18 12 20 Q3.5 18 4 8 Z" />
      {/* Seat ring inside bowl */}
      <path d="M4 8 Q4 13.5 12 15 Q20 13.5 20 8" />
      {/* Pedestal */}
      <path d="M10 20 L9.5 23 h5 L15 20" />
    </svg>
  );
}

// ── Custom icon: Single Chair (front-view, stroke-based) ─────────────────────
function ChairIcon({
  size = 24,
  color = 'currentColor',
  strokeWidth = 1.75,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Back left post — runs full height */}
      <line x1="8" y1="2" x2="8" y2="20" />
      {/* Back right post — runs full height */}
      <line x1="16" y1="2" x2="16" y2="20" />
      {/* Top back rail */}
      <line x1="8" y1="2" x2="16" y2="2" />
      {/* Middle back rail */}
      <line x1="8" y1="8" x2="16" y2="8" />
      {/* Seat — slightly wider than back */}
      <line x1="5" y1="12" x2="19" y2="12" />
      {/* Front left leg */}
      <line x1="6" y1="12" x2="6" y2="20" />
      {/* Front right leg */}
      <line x1="18" y1="12" x2="18" y2="20" />
    </svg>
  );
}

// ── Custom icon: Reposition Patient (lying figure + curved rotation arrow) ────
function RepositionIcon({
  size = 24,
  color = 'currentColor',
  strokeWidth = 1.75,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Head */}
      <circle cx="18" cy="5.5" r="2.2" />
      {/* Body lying at a slight diagonal */}
      <path d="M16 7.5 L5 11" />
      {/* Legs — bent at knee */}
      <path d="M5 11 L3 14.5" />
      <path d="M5 11 L8 13" />
      {/* One arm raised */}
      <path d="M13 9 L14 7" />
      {/* Curved rotation arrow below body — indicates the repositioning motion */}
      <path d="M3 19 C2 15.5 4 12.5 8 11.5" />
      {/* Arrow head */}
      <path d="M6 10.5 L8 11.5 L7 13.5" />
    </svg>
  );
}

const queryClient = new QueryClient();

// ── useDwell — shared 2-second gaze-dwell hook ───────────────────────────────
// Drives a Framer Motion AnimationControls that any SVG circle can bind to.
// • start(): ring fills from current progress → 1 over 2 s (linear)
// • stop():  ring resets smoothly → 0 over 0.4 s (ease-out)
// • onUpdate: call this on the motion.circle so completion triggers onComplete
function useDwell(onComplete: () => void) {
  const controls  = useAnimation();
  const activeRef = useRef(false);
  const cbRef     = useRef(onComplete);
  cbRef.current   = onComplete;

  useEffect(() => () => { controls.stop(); }, [controls]);

  const start = useCallback(() => {
    activeRef.current = true;
    controls.start({
      pathLength: 1,
      opacity: 1,
      transition: {
        pathLength: { duration: 2, ease: 'linear' },
        opacity:    { duration: 0.15 },
      },
    });
  }, [controls]);

  const stop = useCallback(() => {
    activeRef.current = false;
    controls.start({
      pathLength: 0,
      opacity: 0,
      transition: {
        pathLength: { duration: 0.4, ease: 'easeOut' },
        opacity:    { duration: 0.2 },
      },
    });
  }, [controls]);

  // Attach to motion.circle via onUpdate to fire onComplete at the right moment
  const onUpdate = useCallback((latest: Record<string, number>) => {
    if (activeRef.current && (latest.pathLength ?? 0) >= 0.999) {
      activeRef.current = false; // prevent double-fire
      cbRef.current();
    }
  }, []);

  const handlers = {
    onMouseEnter: start,
    onMouseLeave: stop,
    onFocus:      start,
    onBlur:       stop,
  };

  return { controls, handlers, activeRef };
}

// ── DwellRingCircle — shared circular progress ring ──────────────────────────
// Always circular. Parent positions it via className/style.
// `active` shows/hides the faint track circle.
function DwellRingCircle({
  ringColor,
  glowColor,
  active,
  controls,
  onUpdate,
}: {
  ringColor: string;
  glowColor: string;
  active: boolean;
  controls: ReturnType<typeof useAnimation>;
  onUpdate: (latest: Record<string, number>) => void;
}) {
  return (
    <svg
      viewBox="0 0 240 240"
      aria-hidden
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        transform: 'rotate(-90deg)',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 10,
        filter: active ? `drop-shadow(0 0 6px ${glowColor})` : 'none',
        transition: 'filter 0.18s ease-out',
      }}
    >
      {/* Faint track — shows full circle path */}
      <circle
        cx={120} cy={120} r={112}
        fill="none"
        stroke={ringColor}
        strokeWidth={2.5}
        style={{
          opacity: active ? 0.18 : 0,
          transition: 'opacity 0.18s ease-out',
        }}
      />
      {/* Animated fill arc */}
      <motion.circle
        cx={120} cy={120} r={112}
        fill="none"
        stroke={ringColor}
        strokeWidth={4}
        strokeLinecap="round"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={controls}
        onUpdate={onUpdate}
      />
    </svg>
  );
}

// ── Animation variants ───────────────────────────────────────────────────────
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1, delayChildren: 0.1 } },
};
const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } },
};

// ── Data ─────────────────────────────────────────────────────────────────────
type CategoryItem = {
  id: string;
  label: string;
  emoji: string;
  /** Optional icon component — when present, renders instead of the emoji */
  Icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
};
type Category = {
  id: string;
  label: string;
  emoji: string;
  path: string;
  image: string | null;
  bg: string;
  ringColor: string;
  glowColor: string;
  floatDuration: number;
  imgScale: number;
  imgPosition: string;
  Icon: React.ComponentType<{ style?: React.CSSProperties; width?: number; height?: number; strokeWidth?: number }>;
  items: CategoryItem[];
};

const CATEGORIES: Category[] = [
  {
    id: 'health',
    label: 'الصحة',
    emoji: '❤️',
    path: '/communicate/health',
    image: 'user-health.png',
    bg: 'linear-gradient(160deg, rgba(255,255,255,0.92) 0%, rgba(242,249,255,0.86) 60%, rgba(212,235,255,0.75) 100%)',
    ringColor: '#0A84FF',
    glowColor: 'rgba(10,132,255,0.40)',
    floatDuration: 4.2,
    imgScale: 1.60,
    imgPosition: 'center 42%',
    Icon: HeartPulse,
    items: [
      { id: 'pain',      label: 'أشعر بألم',           emoji: '😣' },
      { id: 'medicine',  label: 'أحتاج دواء',           emoji: '💊' },
      { id: 'dizzy',     label: 'أشعر بدوخة',           emoji: '😵' },
      { id: 'breathe',   label: 'صعوبة في التنفس',      emoji: '😮‍💨' },
      { id: 'doctor',    label: 'أريد طبيباً',           emoji: '👨‍⚕️' },
      { id: 'notwell',   label: 'لست بخير',             emoji: '🤒' },
    ],
  },
  {
    id: 'needs',
    label: 'احتياجاتي',
    emoji: '🍽️',
    path: '/communicate/needs',
    image: 'user-needs.png',
    bg: 'linear-gradient(160deg, rgba(255,255,255,0.92) 0%, rgba(255,252,240,0.86) 60%, rgba(255,243,205,0.75) 100%)',
    ringColor: '#FF9F0A',
    glowColor: 'rgba(255,159,10,0.40)',
    floatDuration: 3.8,
    imgScale: 1.45,
    imgPosition: 'center center',
    Icon: Utensils,
    items: [
      { id: 'water',    label: 'أريد ماء',         emoji: '💧', Icon: Droplets },
      { id: 'food',     label: 'أريد طعامًا',      emoji: '🍽️', Icon: UtensilsCrossed },
      { id: 'bathroom', label: 'أريد الحمام',      emoji: '🚻', Icon: ToiletIcon },
      { id: 'sit',      label: 'أريد الجلوس',      emoji: '🪑', Icon: ChairIcon },
      { id: 'quiet',    label: 'أريد هدوءً',       emoji: '🤫', Icon: BellOff },
      { id: 'position', label: 'غيّر وضعيتي',     emoji: '🧍', Icon: RepositionIcon },
    ],
  },
  {
    id: 'worship',
    label: 'العبادة',
    emoji: '🕌',
    path: '/communicate/worship',
    image: 'user-worship.png',
    bg: 'linear-gradient(160deg, rgba(255,255,255,0.92) 0%, rgba(242,255,247,0.86) 60%, rgba(212,243,224,0.75) 100%)',
    ringColor: '#34C759',
    glowColor: 'rgba(52,199,89,0.40)',
    floatDuration: 3.5,
    imgScale: 1.40,
    imgPosition: 'center 55%',
    Icon: Sparkles,
    items: [
      { id: 'pray',        label: 'أريد أن أصلي',       emoji: '🙏' },
      { id: 'wudu',        label: 'أريد الوضوء',         emoji: '🚿' },
      { id: 'quran',       label: 'أريد القرآن',         emoji: '📖' },
      { id: 'dua',         label: 'أريد الدعاء',         emoji: '🤲' },
      { id: 'prayertime',  label: 'وقت الصلاة',          emoji: '🕐' },
      { id: 'qibla',       label: 'اتجاه القبلة',        emoji: '🧭' },
    ],
  },
  {
    id: 'room',
    label: 'البيئة والغرفة',
    emoji: '🛏️',
    path: '/communicate/room',
    image: 'care-health-v2.png',
    bg: 'linear-gradient(160deg, rgba(255,255,255,0.92) 0%, rgba(245,245,255,0.86) 60%, rgba(230,225,255,0.75) 100%)',
    ringColor: '#AF52DE',
    glowColor: 'rgba(175,82,222,0.40)',
    floatDuration: 4.5,
    imgScale: 1.45,
    imgPosition: 'center 35%',
    Icon: HomeIcon,
    items: [
      { id: 'curtains_open',  label: 'افتح الستائر',      emoji: '🌤️' },
      { id: 'curtains_close', label: 'أغلق الستائر',      emoji: '🌙' },
      { id: 'cooler',         label: 'أريد برودة أكثر',   emoji: '❄️' },
      { id: 'warmer',         label: 'أريد دفئاً أكثر',   emoji: '🔥' },
      { id: 'light_up',       label: 'أنر الغرفة',        emoji: '💡' },
      { id: 'light_down',     label: 'خفف الإضاءة',       emoji: '🌑' },
    ],
  },
  {
    id: 'feelings',
    label: 'مشاعري',
    emoji: '😊',
    path: '/communicate/feelings',
    image: 'user-feelings.png',
    bg: 'linear-gradient(160deg, rgba(255,255,255,0.92) 0%, rgba(255,245,250,0.86) 60%, rgba(255,222,237,0.75) 100%)',
    ringColor: '#FF375F',
    glowColor: 'rgba(255,55,95,0.40)',
    floatDuration: 4.0,
    imgScale: 1.10,
    imgPosition: 'center 38%',
    Icon: Heart,
    items: [
      { id: 'okay',    label: 'أنا بخير',               emoji: '😊' },
      { id: 'anxious', label: 'أشعر بالقلق',            emoji: '😰' },
      { id: 'lonely',  label: 'أشعر بالوحدة',           emoji: '🥺' },
      { id: 'someone', label: 'أريد أحداً بجانبي',      emoji: '🤗' },
      { id: 'scared',  label: 'أنا خائف',               emoji: '😨' },
      { id: 'calm',    label: 'أريد الهدوء',            emoji: '🧘' },
    ],
  },
  {
    id: 'social',
    label: 'التواصل',
    emoji: '👨‍👩‍👧‍👦',
    path: '/communicate/social',
    image: 'care-feelings-v2.png',
    bg: 'linear-gradient(160deg, rgba(255,255,255,0.92) 0%, rgba(255,248,242,0.86) 60%, rgba(255,232,215,0.75) 100%)',
    ringColor: '#FF6B35',
    glowColor: 'rgba(255,107,53,0.40)',
    floatDuration: 3.6,
    imgScale: 1.45,
    imgPosition: 'center 30%',
    Icon: Users,
    items: [
      { id: 'family',      label: 'اتصل بأسرتي',              emoji: '👨‍👩‍👧‍👦' },
      { id: 'nurse',       label: 'اتصل بالممرضة',            emoji: '👩‍⚕️' },
      { id: 'doctor_talk', label: 'أريد التحدث مع طبيبي',    emoji: '🩺' },
      { id: 'yes',         label: 'نعم',                       emoji: '✅' },
      { id: 'no',          label: 'لا',                        emoji: '❌' },
      { id: 'thanks',      label: 'شكراً',                     emoji: '🙏' },
    ],
  },
];

// ── Shared: Ambient background blobs ─────────────────────────────────────────
function AmbientBackground() {
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', top: '-18%', right: '-12%',
        width: '55vw', height: '55vw', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,220,140,0.28) 0%, transparent 68%)',
        filter: 'blur(56px)',
      }} />
      <div style={{
        position: 'absolute', bottom: '-20%', left: '-10%',
        width: '52vw', height: '52vw', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(190,200,255,0.20) 0%, transparent 68%)',
        filter: 'blur(64px)',
      }} />
      <div style={{
        position: 'absolute', top: '25%', left: '30%',
        width: '40vw', height: '40vw', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(255,240,210,0.14) 0%, transparent 70%)',
        filter: 'blur(70px)',
      }} />
    </div>
  );
}

// ── Shared: Emergency button (always visible, always pulsing) ─────────────────
function EmergencyButton() {
  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      animate={{
        boxShadow: [
          '0 6px 24px rgba(255,59,48,0.48), 0 2px 8px rgba(255,59,48,0.24)',
          '0 10px 36px rgba(255,59,48,0.70), 0 3px 10px rgba(255,59,48,0.38)',
          '0 6px 24px rgba(255,59,48,0.48), 0 2px 8px rgba(255,59,48,0.24)',
        ],
      }}
      transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      className="absolute text-white font-semibold rounded-full flex items-center gap-[7px]"
      style={{
        insetInlineStart: '24px',
        background: 'rgba(255,48,36,0.92)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid rgba(255,110,100,0.30)',
        padding: '11px 20px',
        fontSize: '0.92rem',
        cursor: 'pointer',
        zIndex: 20,
      }}
      aria-label="طوارئ"
    >
      <span role="img" aria-hidden>🚨</span>
      <span>طوارئ</span>
    </motion.button>
  );
}

// ── Shared: Large back button (pill with text) ────────────────────────────────
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className="absolute flex items-center gap-[7px] font-semibold"
      style={{
        insetInlineEnd: '24px',
        height: '48px',
        padding: '0 22px',
        borderRadius: '999px',
        background: 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        boxShadow: '0 4px 18px rgba(0,0,0,0.10), inset 0 1px 0 rgba(255,255,255,1)',
        border: '1px solid rgba(255,255,255,0.95)',
        fontSize: '0.95rem',
        color: '#3C3C43',
        cursor: 'pointer',
        zIndex: 20,
      }}
      aria-label="رجوع"
    >
      <ChevronRight className="w-5 h-5 text-[#3C3C43]" strokeWidth={2} />
      <span>رجوع</span>
    </motion.button>
  );
}

// ── GazeCard ─────────────────────────────────────────────────────────────────
function GazeCard({ card, onClick }: {
  card: Category;
  index: number;
  onClick: () => void;
}) {
  const [active, setActive] = useState(false);
  const { controls, handlers, activeRef } = useDwell(onClick);

  const augmented = {
    onMouseEnter: () => { setActive(true);  handlers.onMouseEnter(); },
    onMouseLeave: () => { setActive(false); handlers.onMouseLeave(); },
    onFocus:      () => { setActive(true);  handlers.onFocus(); },
    onBlur:       () => { setActive(false); handlers.onBlur(); },
  };

  const restShadow = [
    '0 0 0 0px rgba(0,0,0,0)',
    '0 6px 20px rgba(0,0,0,0.08)',
    '0 16px 48px rgba(0,0,0,0.09)',
    'inset 0 2px 0 rgba(255,255,255,1)',
    'inset 0 0 48px rgba(255,255,255,0.65)',
  ].join(', ');

  const focusShadow = [
    `0 0 0 2.5px ${card.glowColor.replace('0.40', '0.50')}`,
    `0 0 22px ${card.glowColor.replace('0.40', '0.30')}`,
    `0 0 48px ${card.glowColor.replace('0.40', '0.14')}`,
    `0 14px 44px rgba(20,30,60,0.13)`,
    'inset 0 2px 0 rgba(255,255,255,1)',
    'inset 0 0 48px rgba(255,255,255,0.65)',
  ].join(', ');

  // Keep activeRef in sync so useDwell's onUpdate fires correctly
  activeRef.current = active;

  return (
    <div className="flex flex-col items-center" style={{ gap: 'clamp(10px, 1.5vh, 18px)' }}>

      {/* Ring + bubble */}
      <div
        className="relative flex items-center justify-center"
        style={{ width: 'min(160px, 17.5vh)', aspectRatio: '1' }}
      >
        {/* Dwell ring — sits just outside the bubble (110%) */}
        <div style={{ position: 'absolute', inset: '-5%', width: '110%', height: '110%', pointerEvents: 'none' }}>
          <DwellRingCircle
            ringColor={card.ringColor}
            glowColor={card.glowColor}
            active={active}
            controls={controls}
            onUpdate={(latest) => {
              if (activeRef.current && (latest.pathLength ?? 0) >= 0.999) {
                activeRef.current = false;
                onClick();
              }
            }}
          />
        </div>

        {/* Apple-glass circular bubble */}
        <motion.div
          className="relative overflow-hidden flex items-center justify-center"
          style={{
            width: '100%', height: '100%',
            borderRadius: '50%',
            background: card.bg,
            backdropFilter: 'blur(48px) saturate(210%)',
            WebkitBackdropFilter: 'blur(48px) saturate(210%)',
            border: '1px solid rgba(255,255,255,0.96)',
            cursor: 'pointer',
            zIndex: 1,
          }}
          animate={{
            scale:     active ? 1.03 : 1,
            boxShadow: active ? focusShadow : restShadow,
          }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          {...augmented}
          data-gaze-target="true"
          data-gaze-id={card.id}
          data-gaze-label={card.label}
          id={`gaze-card-${card.id}`}
          role="button"
          tabIndex={0}
          aria-label={card.label}
        >
          {/* Specular highlight */}
          <div aria-hidden style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: '42%',
            borderRadius: '50% 50% 0 0 / 100% 100% 0 0',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.68) 0%, transparent 100%)',
            pointerEvents: 'none', zIndex: 3,
          }} />

          {card.image ? (
            <img
              src={import.meta.env.BASE_URL + card.image}
              alt={card.label}
              style={{
                position: 'absolute', inset: 0,
                width: '100%', height: '100%',
                objectFit: 'cover',
                objectPosition: card.imgPosition,
                transform: `scale(${card.imgScale})`,
                transformOrigin: 'center center',
                zIndex: 1,
              }}
              draggable={false}
            />
          ) : (
            <span style={{
              fontSize: 'clamp(2.2rem, 4.5vh, 3.2rem)',
              zIndex: 2, lineHeight: 1, userSelect: 'none',
            }} aria-hidden>
              {card.emoji}
            </span>
          )}
        </motion.div>
      </div>

      {/* Label pill */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '7px', height: '44px', padding: '0 15px',
          borderRadius: '999px',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: '1px solid rgba(255,255,255,0.95)',
          boxShadow: active
            ? `0 6px 22px ${card.glowColor}, 0 2px 6px rgba(0,0,0,0.05), inset 0 1.5px 0 rgba(255,255,255,1)`
            : '0 4px 18px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.05), inset 0 1.5px 0 rgba(255,255,255,1)',
          transition: 'box-shadow 0.18s ease-out',
        }}
      >
        <span className="font-bold text-[#1C1C1E]" style={{
          fontSize: 'clamp(0.82rem, 1.05vw, 1.05rem)',
          letterSpacing: '0.01em', lineHeight: 1,
          whiteSpace: 'nowrap',
        }}>
          {card.label}
        </span>
        <card.Icon style={{ color: card.ringColor, flexShrink: 0 }} width={15} height={15} strokeWidth={1.75} />
      </div>
    </div>
  );
}

// ── ItemCard — static at rest; identical dwell ring + glow on focus ───────────
function ItemCard({ item, ringColor, glowColor, onSelect, selected }: {
  item: CategoryItem;
  ringColor: string;
  glowColor: string;
  onSelect: (id: string) => void;
  selected: boolean;
  index: number;
}) {
  const [active, setActive] = useState(false);
  const { controls, handlers, activeRef } = useDwell(() => onSelect(item.id));

  const augmented = {
    onMouseEnter: () => { setActive(true);  handlers.onMouseEnter(); },
    onMouseLeave: () => { setActive(false); handlers.onMouseLeave(); },
    onFocus:      () => { setActive(true);  handlers.onFocus(); },
    onBlur:       () => { setActive(false); handlers.onBlur(); },
  };

  // Keep activeRef in sync so useDwell's onUpdate fires correctly
  activeRef.current = active;

  const restShadow = selected
    ? [
        `0 0 0 3px ${glowColor.replace('0.40', '0.12')}`,
        `0 8px 32px ${glowColor.replace('0.40', '0.18')}`,
        'inset 0 1.5px 0 rgba(255,255,255,1)',
      ].join(', ')
    : [
        '0 4px 18px rgba(0,0,0,0.08)',
        '0 1px 4px rgba(0,0,0,0.04)',
        'inset 0 1.5px 0 rgba(255,255,255,1)',
      ].join(', ');

  const focusShadow = [
    `0 0 0 2px ${glowColor.replace('0.40', '0.35')}`,
    `0 0 20px ${glowColor.replace('0.40', '0.22')}`,
    `0 8px 32px ${glowColor.replace('0.40', '0.15')}`,
    'inset 0 1.5px 0 rgba(255,255,255,1)',
  ].join(', ');

  return (
    <button
      onClick={() => onSelect(item.id)}
      {...augmented}
      style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: '10px',
        padding: 'clamp(14px, 2.2vh, 22px) 10px',
        borderRadius: '20px',
        background: selected
          ? `linear-gradient(160deg, rgba(255,255,255,0.96) 0%, ${glowColor.replace('0.40', '0.10')} 100%)`
          : 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: selected
          ? `1.5px solid ${glowColor.replace('0.40', '0.45')}`
          : '1px solid rgba(255,255,255,0.95)',
        boxShadow: (active && !selected) ? focusShadow : restShadow,
        cursor: 'pointer',
        minHeight: 'clamp(88px, 12vh, 124px)',
        width: '100%',
        transition: 'background 0.18s ease-out, border 0.18s ease-out, box-shadow 0.18s ease-out',
      }}
      aria-label={item.label}
      aria-pressed={selected}
    >
      {/*
        Dwell ring — same circular ring as GazeCard, centered on the card.
        Sized to match the card's min-height so it reads as a focus reticle.
      */}
      <div style={{
        position: 'absolute',
        top: '50%', left: '50%',
        width: 'clamp(72px, 11vh, 96px)',
        height: 'clamp(72px, 11vh, 96px)',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      }}>
        <DwellRingCircle
          ringColor={ringColor}
          glowColor={glowColor}
          active={active}
          controls={controls}
          onUpdate={(latest) => {
            if (activeRef.current && (latest.pathLength ?? 0) >= 0.999) {
              activeRef.current = false;
              onSelect(item.id);
            }
          }}
        />
      </div>

      {item.Icon ? (
        <item.Icon
          size={44}
          color={selected ? ringColor : '#3C3C43'}
          strokeWidth={1.5}
        />
      ) : (
        <span style={{ fontSize: 'clamp(1.9rem, 3.2vh, 2.6rem)', lineHeight: 1 }}>
          {item.emoji}
        </span>
      )}
      <span style={{
        fontSize: 'clamp(0.82rem, 1.1vw, 1rem)',
        fontWeight: 700,
        color: selected ? ringColor : '#1C1C1E',
        textAlign: 'center',
        lineHeight: 1.3,
        transition: 'color 0.18s ease-out',
      }}>
        {item.label}
      </span>
    </button>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────────
function Home() {
  const [, navigate] = useLocation();

  return (
    <div
      className="min-h-[100dvh] w-full flex flex-col md:flex-row bg-[#FAFAFA] overflow-x-hidden"
      dir="rtl"
      style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}
    >
      {/* Right Column (Hero Image) */}
      <motion.div
        className="w-full md:w-[55%] relative h-[55vw] md:h-[100dvh] p-4 md:p-0 md:py-6 md:pl-6 shrink-0"
        initial={{ opacity: 0, scale: 1.02 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        <div className="relative w-full h-full rounded-2xl md:rounded-none md:rounded-l-[24px] overflow-hidden shadow-sm">
          <img
            src={import.meta.env.BASE_URL + 'hero.png'}
            alt="سَم يبه - التواصل بالنظر"
            className="w-full h-full object-cover"
          />
          <div className="hidden md:block absolute top-0 left-0 bottom-0 w-32 bg-gradient-to-r from-[#FAFAFA] via-[#FAFAFA]/40 to-transparent pointer-events-none" />
        </div>
      </motion.div>

      {/* Left Column (Content) */}
      <motion.div
        className="w-full md:w-[45%] flex flex-col px-6 py-10 md:px-16 lg:px-24 flex-1"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="flex flex-col h-full max-w-lg w-full mx-auto md:mx-0">
          <div className="flex-1 flex flex-col justify-center space-y-12">

            <motion.div variants={itemVariants} className="space-y-4">
              <h1 className="text-[3.2rem] md:text-[3.8rem] lg:text-[4rem] font-bold text-[#0A0A0A] tracking-tight leading-[1.1]">
                سَم يبه
              </h1>
              <p className="text-[1.3rem] md:text-[1.5rem] lg:text-[1.6rem] font-medium text-[#1C1C1E] leading-[1.4]">
                التواصل بالنظر... عندما تعجز الكلمات
              </p>
              <p className="text-[0.95rem] md:text-[1rem] font-normal text-[#6E6E73] leading-[1.7] max-w-md">
                لأن فقدان القدرة على الكلام لا يعني فقدان القدرة على التعبير.
              </p>
            </motion.div>

            <motion.div variants={itemVariants} className="space-y-5">
              <div className="flex items-center gap-4">
                <Eye className="w-5 h-5 text-[#0A84FF] shrink-0" strokeWidth={2.5} />
                <span className="text-[0.95rem] font-medium text-[#1C1C1E]">يتواصل بالنظر فقط</span>
              </div>
              <div className="flex items-center gap-4">
                <Volume2 className="w-5 h-5 text-[#0A84FF] shrink-0" strokeWidth={2.5} />
                <span className="text-[0.95rem] font-medium text-[#1C1C1E]">يحوّل النظر إلى كلام</span>
              </div>
              <div className="flex items-center gap-4">
                <Smartphone className="w-5 h-5 text-[#0A84FF] shrink-0" strokeWidth={2.5} />
                <span className="text-[0.95rem] font-medium text-[#1C1C1E]">يرسل الطلب لمقدم الرعاية</span>
              </div>
            </motion.div>

            <motion.div variants={itemVariants} className="pt-4">
              <motion.button
                onClick={() => navigate('/communicate')}
                whileHover={{ scale: 1.05, boxShadow: '0 8px 36px rgba(10,132,255,0.45)' }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                initial={{ boxShadow: '0 4px 24px rgba(10,132,255,0.30)' }}
                className="bg-[#0A84FF] text-white text-[1.1rem] font-semibold rounded-full min-w-[200px] w-fit flex items-center justify-center"
                style={{ padding: '18px 52px', border: 'none', outline: 'none', cursor: 'pointer' }}
              >
                ابدأ التواصل
              </motion.button>
            </motion.div>

          </div>

          <motion.div variants={itemVariants} className="mt-12 md:mt-0 md:pt-12 pb-4 border-t border-transparent">
            <p className="text-[#AEAEB2] text-[0.82rem] font-normal leading-relaxed text-right max-w-sm">
              مصمم لمساعدة مرضى الجلطات وفاقدي القدرة على الكلام للتواصل بسهولة وكرامة.
            </p>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

// ── CommunicationScreen — 6-category main menu ────────────────────────────────
function CommunicationScreen() {
  const [, navigate] = useLocation();

  return (
    <div
      className="h-[100dvh] overflow-hidden flex flex-col relative"
      dir="rtl"
      style={{
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        background: 'linear-gradient(170deg, #FEFEFE 0%, #F8F8FD 40%, #F2F2F9 100%)',
      }}
    >
      <AmbientBackground />

      {/* Header */}
      <motion.div
        className="flex-none relative z-10 flex items-center justify-center px-6 pt-6 pb-3"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        <EmergencyButton />
        <div className="flex flex-col items-center text-center gap-[8px] pointer-events-none">
          <h1
            className="font-bold text-[#0A0A0A] leading-tight tracking-tight"
            style={{ fontSize: 'clamp(1.7rem, 2.6vw, 2.4rem)' }}
          >
            بماذا أستطيع مساعدتك؟
          </h1>
          <p style={{ fontSize: 'clamp(0.78rem, 1vw, 0.88rem)', color: '#6E6E73' }}>
            اختر فئة
          </p>
        </div>
        <BackButton onClick={() => navigate('/')} />
      </motion.div>

      {/* 2 × 3 category grid */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-6 pb-6">
        <div
          className="grid grid-cols-2"
          style={{
            columnGap: 'clamp(28px, 6vw, 80px)',
            rowGap: 'clamp(8px, 1.6vh, 20px)',
          }}
        >
          {CATEGORIES.map((cat, i) => (
            <GazeCard
              key={cat.id}
              card={cat}
              index={i}
              onClick={() => navigate(cat.path)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── CategoryPage — shared layout for all 6 category pages ────────────────────
function CategoryPage() {
  const [, params] = useRoute<{ categoryId: string }>('/communicate/:categoryId');
  const [, navigate] = useLocation();
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  const category = CATEGORIES.find(c => c.id === params?.categoryId);

  if (!category) {
    return (
      <div
        className="min-h-[100dvh] flex items-center justify-center"
        dir="rtl"
        style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif", background: 'linear-gradient(170deg, #FEFEFE 0%, #F8F8FD 40%, #F2F2F9 100%)' }}
      >
        <p style={{ color: '#6E6E73' }}>الصفحة غير موجودة</p>
      </div>
    );
  }

  const handleSelect = (id: string) => {
    setSelectedItem(prev => (prev === id ? null : id));
  };

  return (
    <div
      className="h-[100dvh] overflow-hidden flex flex-col relative"
      dir="rtl"
      style={{
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        background: 'linear-gradient(170deg, #FEFEFE 0%, #F8F8FD 40%, #F2F2F9 100%)',
      }}
    >
      <AmbientBackground />

      {/* Category-tinted ambient blob at top */}
      <div aria-hidden style={{
        position: 'absolute',
        top: 0, left: '50%', transform: 'translateX(-50%)',
        width: '70vw', height: '45vh',
        borderRadius: '50%',
        background: `radial-gradient(circle, ${category.glowColor.replace('0.40', '0.10')} 0%, transparent 70%)`,
        filter: 'blur(52px)',
        pointerEvents: 'none',
      }} />

      {/* Header */}
      <motion.div
        className="flex-none relative z-10 flex items-center justify-center px-6 pt-6 pb-3"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      >
        <EmergencyButton />

        <div className="flex flex-col items-center text-center gap-[5px] pointer-events-none">
          <span style={{ fontSize: 'clamp(1.5rem, 2.4vw, 2rem)', lineHeight: 1 }} aria-hidden>
            {category.emoji}
          </span>
          <h1
            className="font-bold text-[#0A0A0A] leading-tight tracking-tight"
            style={{ fontSize: 'clamp(1.45rem, 2.1vw, 1.9rem)' }}
          >
            {category.label}
          </h1>
        </div>

        <BackButton onClick={() => navigate('/communicate')} />
      </motion.div>

      {/* Items 3 × 2 grid */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-8 pb-4">
        <div
          className="grid grid-cols-3 w-full"
          style={{ gap: 'clamp(10px, 1.8vw, 18px)', maxWidth: '860px' }}
        >
          {category.items.map((item, i) => (
            <ItemCard
              key={item.id}
              item={item}
              ringColor={category.ringColor}
              glowColor={category.glowColor}
              onSelect={handleSelect}
              selected={selectedItem === item.id}
              index={i}
            />
          ))}
        </div>
      </div>

      {/* Selection confirmation bar — slides up when an item is picked */}
      <AnimatePresence>
        {selectedItem && (() => {
          const picked = category.items.find(i => i.id === selectedItem);
          return picked ? (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, y: 36 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 36 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex-none relative z-10 flex items-center justify-center pb-5 px-6"
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                padding: '13px 26px', borderRadius: '999px',
                background: `linear-gradient(135deg, ${category.glowColor.replace('0.40', '0.12')} 0%, rgba(255,255,255,0.7) 100%)`,
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: `1.5px solid ${category.glowColor.replace('0.40', '0.35')}`,
                boxShadow: `0 8px 32px ${category.glowColor.replace('0.40', '0.18')}`,
              }}>
                <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>{picked.emoji}</span>
                <span style={{ fontWeight: 700, color: category.ringColor, fontSize: 'clamp(0.88rem, 1.1vw, 1rem)' }}>
                  {picked.label}
                </span>
                <span style={{ color: '#6E6E73', fontSize: 'clamp(0.76rem, 0.9vw, 0.86rem)' }}>
                  — تم إرسال الطلب
                </span>
              </div>
            </motion.div>
          ) : null;
        })()}
      </AnimatePresence>
    </div>
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/communicate" component={CommunicationScreen} />
          <Route path="/communicate/:categoryId" component={CategoryPage} />
          <Route component={() => (
            <div
              className="min-h-[100dvh] flex items-center justify-center text-center p-8 bg-[#FAFAFA] text-[#0A0A0A]"
              dir="rtl"
              style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}
            >
              الصفحة غير موجودة
            </div>
          )} />
        </Switch>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
