import { useState, useRef, useCallback, useEffect, createContext, useContext } from 'react';
import { GazeContext, GazeProvider, useGazeContext } from './gazeTracking';
import { AIAssistantButton } from './aiAssistant';
import { CaregiverDashboard } from './caregiverDashboard';
import { CaregiverNotificationProvider } from './caregiverNotification';
import { createPortal } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, useLocation, useRoute } from 'wouter';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import {
  Eye, Volume2, Smartphone, ChevronRight,
  HeartPulse, Utensils, Heart, Sparkles, Home as HomeIcon, Users,
  Droplets, UtensilsCrossed, BellOff,
  Cross, Footprints, Stethoscope,
  Lightbulb, LightbulbOff, Tv,
  Smile, Frown, Annoyed, HeartHandshake,
  BookOpen,
  MessageCircle, Video,
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

// ── Custom icon: Shower (pipe arm + nozzle head + falling streams) ────────────
function ShowerIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Pipe: vertical then elbow to horizontal */}
      <path d="M4 2 L4 7 Q4 9.5 6.5 9.5 L20 9.5" />
      {/* Shower head nozzle (rounded rect) */}
      <rect x="6" y="9.5" width="14" height="3.5" rx="1.2" />
      {/* Water streams angled slightly */}
      <line x1="8"  y1="13" x2="7.5"  y2="18" />
      <line x1="11" y1="13" x2="10.5" y2="18" />
      <line x1="14" y1="13" x2="13.5" y2="18" />
      <line x1="17" y1="13" x2="16.5" y2="18" />
      <line x1="20" y1="13" x2="19.5" y2="18" />
    </svg>
  );
}

// ── Custom icon: Nausea (stomach pouch with wavy inner lines) ─────────────────
function NauseaIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Stomach outline — rounded pouch shape */}
      <path d="M9 3 Q4 3 4 8 L4 15 Q4 21 12 21 Q20 21 20 15 L20 9 Q20 5 16.5 4 Q13 3 9 3 Z" />
      {/* Wave lines inside indicating discomfort */}
      <path d="M8 10.5 Q9.5 9 11 10.5 Q12.5 12 14 10.5" />
      <path d="M8 14.5 Q9.5 13 11 14.5 Q12.5 16 14 14.5" />
    </svg>
  );
}

// ── Custom icon: Help Stand (two figures — patient rising, helper supporting) ─
function HelpStandIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* ── Patient (left) — leaning forward, mid-rise ── */}
      <circle cx="6" cy="4.5" r="2" />
      {/* Torso: angled forward as if rising */}
      <path d="M6 6.5 L4.5 12" />
      {/* Legs: one pushing off floor, one bent */}
      <path d="M4.5 12 L3 17" />
      <path d="M4.5 12 L7 16" />
      {/* Patient arm reaching up to helper's hand */}
      <path d="M5.5 8.5 L13 7" />

      {/* ── Helper (right) — standing upright, arm extended ── */}
      <circle cx="19" cy="3.5" r="2" />
      {/* Torso: straight */}
      <path d="M19 5.5 L19 14" />
      {/* Legs */}
      <path d="M19 14 L17 20" />
      <path d="M19 14 L21 20" />
      {/* Helper arm reaching down to patient */}
      <path d="M19 7.5 L13 7" />
    </svg>
  );
}

// ── Custom icon: Hospital Bed — raise (upward arrow on right) ────────────────
function BedUpIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Bed frame / mattress */}
      <rect x="1" y="12" width="17" height="4" rx="1" />
      {/* Head post */}
      <path d="M1 12 L1 9" />
      {/* Pillow */}
      <rect x="2" y="9" width="5" height="3" rx="0.8" />
      {/* Legs */}
      <line x1="3"  y1="16" x2="3"  y2="20" />
      <line x1="16" y1="16" x2="16" y2="20" />
      {/* Up arrow */}
      <line x1="21" y1="19" x2="21" y2="8" />
      <polyline points="19,10 21,8 23,10" />
    </svg>
  );
}

// ── Custom icon: Hospital Bed — lower (downward arrow on right) ───────────────
function BedDownIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Same bed */}
      <rect x="1" y="12" width="17" height="4" rx="1" />
      <path d="M1 12 L1 9" />
      <rect x="2" y="9" width="5" height="3" rx="0.8" />
      <line x1="3"  y1="16" x2="3"  y2="20" />
      <line x1="16" y1="16" x2="16" y2="20" />
      {/* Down arrow */}
      <line x1="21" y1="8" x2="21" y2="19" />
      <polyline points="19,17 21,19 23,17" />
    </svg>
  );
}

// ── Custom icon: Television — off (screen with diagonal slash) ────────────────
function TvOffIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* TV cabinet */}
      <rect x="2" y="4" width="20" height="14" rx="2" />
      {/* Stand base */}
      <line x1="10" y1="18" x2="10" y2="21" />
      <line x1="14" y1="18" x2="14" y2="21" />
      <line x1="8"  y1="21" x2="16" y2="21" />
      {/* Power-off slash */}
      <line x1="6" y1="7" x2="18" y2="17" />
    </svg>
  );
}

// ── Custom icon: Worried face (raised inner brows + wavy mouth) ───────────────
function WorriedFaceIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Face circle */}
      <circle cx="12" cy="12" r="10" />
      {/* Worried eyebrows — inner corners pulled up */}
      <path d="M7.5 8.5 Q9 7 10.5 8.5" />
      <path d="M13.5 8.5 Q15 7 16.5 8.5" />
      {/* Eyes */}
      <circle cx="9.5" cy="11.5" r="1" fill={color} stroke="none" />
      <circle cx="14.5" cy="11.5" r="1" fill={color} stroke="none" />
      {/* Worried mouth — wavy, showing unease */}
      <path d="M9 16 Q10.5 14.5 12 16 Q13.5 17.5 15 16" />
    </svg>
  );
}

// ── Custom icon: Tired face (heavy droopy lids + subdued frown) ───────────────
function TiredFaceIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Face circle */}
      <circle cx="12" cy="12" r="10" />
      {/* Left eye: arched top lid + flat bottom (heavy-lidded) */}
      <path d="M8 11.5 Q9.5 9.5 11 11.5" />
      <line x1="8" y1="11.5" x2="11" y2="11.5" />
      {/* Right eye: same */}
      <path d="M13 11.5 Q14.5 9.5 16 11.5" />
      <line x1="13" y1="11.5" x2="16" y2="11.5" />
      {/* Tired mouth — gentle downward curve */}
      <path d="M9.5 16 Q12 14.5 14.5 16" />
    </svg>
  );
}

// ── Custom icon: Wudu — cupped hands with water streams ──────────────────────
function WuduIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Water streams falling from above */}
      <line x1="9"  y1="2" x2="8.5"  y2="7" />
      <line x1="12" y1="1" x2="12"   y2="6" />
      <line x1="15" y1="2" x2="15.5" y2="7" />
      {/* Left cupped hand */}
      <path d="M5 17 Q5 14 7 13 L10 12 L10 17" />
      {/* Right cupped hand */}
      <path d="M19 17 Q19 14 17 13 L14 12 L14 17" />
      {/* Cup base joining both hands */}
      <path d="M10 17 Q12 19.5 14 17" />
    </svg>
  );
}

// ── Custom icon: Praying Person — standing figure, palms raised (du'a) ────────
function PrayingPersonIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Head */}
      <circle cx="12" cy="4" r="2.2" />
      {/* Torso */}
      <path d="M12 6.2 L12 14" />
      {/* Left arm — raised, palm open and facing up */}
      <path d="M12 9 L7 6.5" />
      <path d="M7 6.5 Q6 6 5.5 5" />
      {/* Right arm — raised, palm open and facing up */}
      <path d="M12 9 L17 6.5" />
      <path d="M17 6.5 Q18 6 18.5 5" />
      {/* Legs */}
      <path d="M12 14 L10 21" />
      <path d="M12 14 L14 21" />
    </svg>
  );
}

// ── Custom icon: Prayer Beads — loop with bead dots and tassel ────────────────
function PrayerBeadsIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  // Bead positions on a circle of radius 8 centered at (12, 12)
  // Angles at 0°,51°,103°,154°,206°,257°,309° (7 beads, leaving gap at top-left for tassel)
  const r = 8;
  const cx = 12, cy = 12;
  const angles = [0, 51, 103, 154, 206, 257, 309].map(a => (a * Math.PI) / 180);
  const beads = angles.map(a => ({
    x: +(cx + r * Math.sin(a)).toFixed(2),
    y: +(cy - r * Math.cos(a)).toFixed(2),
  }));
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* String loop (almost-full circle, gap at top) */}
      <path d="M12 4 Q20 4 20 12 Q20 20 12 20 Q4 20 4 12 Q4 5.5 9.5 4.2" />
      {/* Tassel / counter bead hanging from gap */}
      <line x1="10" y1="4" x2="9"   y2="2" />
      <circle cx="9" cy="1.5" r="1" fill={color} stroke="none" />
      {/* Bead dots on the string */}
      {beads.map((b, i) => (
        <circle key={i} cx={b.x} cy={b.y} r={1.3} fill={color} stroke="none" />
      ))}
    </svg>
  );
}

// ── Custom icon: Help Pray — kneeling person + standing helper ────────────────
function HelpPrayIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* ── Person being helped to pray (left) — kneeling, bowing forward ── */}
      <circle cx="6" cy="6" r="2" />
      {/* Body bowing forward */}
      <path d="M6 8 L5 11 L10 13" />
      {/* Kneeling legs on ground */}
      <path d="M5 11 L4 14" />
      <path d="M5 11 L7 13.5" />

      {/* ── Helper (right) — standing, arm extended to person's shoulder ── */}
      <circle cx="19" cy="4" r="2" />
      <path d="M19 6 L19 15" />
      <path d="M19 15 L17 21" />
      <path d="M19 15 L21 21" />
      {/* Arm reaching across to the praying person */}
      <path d="M19 9 L10 12" />
    </svg>
  );
}

// ── Custom icon: Prayer Rug — rectangle with mihrab arch inside ───────────────
function PrayerRugIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Rug outer border */}
      <rect x="2" y="3" width="20" height="18" rx="1.5" />
      {/* Fringe at top */}
      <line x1="5"  y1="3" x2="5"  y2="1" />
      <line x1="9"  y1="3" x2="9"  y2="1" />
      <line x1="12" y1="3" x2="12" y2="1" />
      <line x1="15" y1="3" x2="15" y2="1" />
      <line x1="19" y1="3" x2="19" y2="1" />
      {/* Mihrab arch (prayer direction marker) */}
      <path d="M7 19 L7 13 Q7 9 12 9 Q17 9 17 13 L17 19" />
      {/* Inner arch detail */}
      <path d="M9 19 L9 14 Q9 11 12 11 Q15 11 15 14 L15 19" />
    </svg>
  );
}

// ── Custom icon: Call Son — smartphone + male stick figure ────────────────────
function SonCallIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Smartphone */}
      <rect x="1" y="5" width="8" height="14" rx="1.5" />
      <line x1="3" y1="17" x2="7" y2="17" />
      {/* Male person (right half) */}
      <circle cx="18" cy="6.5" r="2.3" />
      {/* Body */}
      <path d="M18 8.8 L18 16" />
      {/* Arms */}
      <path d="M18 11 L15.5 13 M18 11 L20.5 13" />
      {/* Legs */}
      <path d="M18 16 L16 21 M18 16 L20 21" />
    </svg>
  );
}

// ── Custom icon: Call Daughter — smartphone + female figure with dress ─────────
function DaughterCallIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Smartphone */}
      <rect x="1" y="5" width="8" height="14" rx="1.5" />
      <line x1="3" y1="17" x2="7" y2="17" />
      {/* Female person (right half) */}
      <circle cx="18" cy="6.5" r="2.3" />
      {/* Torso */}
      <path d="M18 8.8 L18 13" />
      {/* Arms */}
      <path d="M18 10.5 L15.5 12.5 M18 10.5 L20.5 12.5" />
      {/* A-line dress / skirt — flares from waist to hem */}
      <path d="M15 13 L18 13 L21 13" />
      <path d="M15 13 L13.5 21 M21 13 L22.5 21" />
      <line x1="13.5" y1="21" x2="22.5" y2="21" />
    </svg>
  );
}

// ── Custom icon: Call Friend — smartphone + figure with open welcoming arms ───
function FriendCallIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Smartphone */}
      <rect x="1" y="5" width="8" height="14" rx="1.5" />
      <line x1="3" y1="17" x2="7" y2="17" />
      {/* Friend person (right half) — arms spread open wide in welcoming gesture */}
      <circle cx="18" cy="6.5" r="2.3" />
      {/* Body */}
      <path d="M18 8.8 L18 16" />
      {/* Wide-open arms (welcoming / waving) */}
      <path d="M18 10.5 L14.5 8.5" />
      <path d="M18 10.5 L21.5 8.5" />
      {/* Legs */}
      <path d="M18 16 L16 21 M18 16 L20 21" />
    </svg>
  );
}

// ── Custom icon: Companionship — two seated figures side by side ──────────────
function CompanionshipIcon({
  size = 24, color = 'currentColor', strokeWidth = 1.75,
}: { size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* Person 1 (left) — seated */}
      <circle cx="7" cy="4" r="2" />
      {/* Torso */}
      <path d="M7 6 L7 11" />
      {/* Thigh — horizontal, pointing right */}
      <path d="M7 11 L11 11" />
      {/* Shin — hanging down */}
      <path d="M11 11 L11 16" />

      {/* Person 2 (right) — seated, mirrored */}
      <circle cx="17" cy="4" r="2" />
      {/* Torso */}
      <path d="M17 6 L17 11" />
      {/* Thigh — pointing left (toward person 1) */}
      <path d="M17 11 L13 11" />
      {/* Shin — hanging down */}
      <path d="M13 11 L13 16" />

      {/* Shared seat / bench between them */}
      <line x1="4" y1="16" x2="20" y2="16" />

      {/* Small heart between them — connection */}
      <path d="M11.5 8 Q12 7 12.5 8 Q13 9 12 10 Q11 9 11.5 8 Z" />
    </svg>
  );
}

const queryClient = new QueryClient();

// ── useDwell — shared gaze-dwell hook ────────────────────────────────────────
// Drives a Framer Motion AnimationControls that any SVG circle can bind to.
// • start(): ring fills from current progress → 1 (linear, duration depends on source)
// • stop():  ring resets smoothly → 0 over 0.4 s (ease-out)
// • onUpdate: call this on the motion.circle so completion triggers onComplete
// • gazeId: when provided, eye tracking auto-triggers start/stop for this element
function useDwell(onComplete: () => void, gazeId?: string) {
  const controls  = useAnimation();
  const activeRef = useRef(false);
  const firedRef  = useRef(false); // latched per hover cycle; reset only by start()
  const cbRef     = useRef(onComplete);
  cbRef.current   = onComplete;

  const { gazeEnabled, gazeTargetId, calibrated } = useGazeContext();
  // True when camera is on, calibration complete, AND this element is being gazed at
  const isGazeActive = gazeEnabled && calibrated && !!gazeId && gazeTargetId === gazeId;

  useEffect(() => () => { controls.stop(); }, [controls]);

  const start = useCallback((fromGaze = false) => {
    activeRef.current = true;
    firedRef.current  = false; // new hover cycle — arm the trigger
    controls.start({
      pathLength: 1,
      opacity: 1,
      transition: {
        // Gaze dwell = 2 s, mouse dwell = 1 s
        pathLength: { duration: fromGaze ? 2 : 1, ease: 'linear' },
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

  // Eye-tracking: start/stop based on gaze position (only after calibration)
  useEffect(() => {
    if (!gazeEnabled || !calibrated || !gazeId) return;
    if (gazeTargetId === gazeId) {
      start(true);
    } else {
      stop();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gazeTargetId, gazeEnabled, calibrated, gazeId]);

  // onUpdate fires every animation frame; both guards must pass to complete once.
  // firedRef prevents a re-render from re-arming activeRef between frames.
  const onUpdate = useCallback((latest: Record<string, number>) => {
    if (activeRef.current && !firedRef.current && (latest.pathLength ?? 0) >= 0.999) {
      activeRef.current = false;
      firedRef.current  = true; // latch — survives re-renders until next start()
      cbRef.current();
    }
  }, []);

  const handlers = {
    // When gaze is active and calibrated, mouse hover doesn't drive dwell (gaze takes over)
    onMouseEnter: (gazeEnabled && calibrated) ? (() => {}) : (() => start(false)),
    onMouseLeave: (gazeEnabled && calibrated) ? (() => {}) : stop,
    onFocus:      () => start(false),
    onBlur:       stop,
  };

  return { controls, handlers, onUpdate, isGazeActive };
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
  visible: { y: 0, opacity: 1, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] } },
};

// ── Data ─────────────────────────────────────────────────────────────────────
type CategoryItem = {
  id: string;
  label: string;
  emoji: string;
  /** Optional icon component — when present, renders instead of the emoji */
  Icon?: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  /** Optional photo — when present, renders instead of Icon/emoji */
  image?: string;
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
      { id: 'pain',     label: 'متألم',               emoji: '🤒',  image: 'health-pain.jpg' },
      { id: 'nausea',   label: 'غثيان',              emoji: '🤢',  image: 'health-nausea.jpg' },
      { id: 'nurse',    label: 'نادِ الممرضة',        emoji: '👩‍⚕️', image: 'health-caregiver.png' },
      { id: 'standup',  label: 'ساعدني على الوقوف',  emoji: '🪑',  image: 'health-standup.png' },
      { id: 'walk',     label: 'أريد المشي قليلًا',  emoji: '🚶',  image: 'health-walk.jpg' },
      { id: 'position', label: 'غيّر وضعيتي',        emoji: '🧍',  image: 'needs-reposition.jpg' },
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
      { id: 'water',    label: 'أريد ماء',         emoji: '💧', image: 'needs-water.png' },
      { id: 'food',     label: 'أريد طعامًا',      emoji: '🍽️', image: 'needs-food.jpg' },
      { id: 'bathroom', label: 'أريد الحمام',      emoji: '🚻', image: 'needs-toilet.jpg' },
      { id: 'sit',      label: 'أريد الجلوس',      emoji: '🪑', image: 'needs-chair.jpg' },
      { id: 'quiet',    label: 'أريد هدوءً',       emoji: '🤫', image: 'needs-quiet.png' },
      { id: 'shower',   label: 'أريد الاستحمام',   emoji: '🛁', image: 'health-shower.jpg' },
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
      { id: 'quran',    label: 'أريد قرآن',            emoji: '📖', Icon: BookOpen,         image: 'quran.png' },
      { id: 'wudu',     label: 'أريد الوضوء',             emoji: '🚿', Icon: WuduIcon,          image: 'wudu.png' },
      { id: 'pray',     label: 'أذهب للمسجد',             emoji: '🙏', Icon: PrayingPersonIcon, image: 'prayer.png' },
      { id: 'beads',    label: 'أريد السبحة',             emoji: '📿', Icon: PrayerBeadsIcon,   image: 'tasbeeh.png' },
      { id: 'helppray', label: 'ساعدني على الصلاة',       emoji: '🤲', Icon: HelpPrayIcon,      image: 'prayer-help.png' },
      { id: 'rug',      label: 'أريد سجادة',  emoji: '🕌', Icon: PrayerRugIcon,     image: 'prayer-mat.png' },
    ],
  },
  {
    id: 'room',
    label: 'البيئة والغرفة',
    emoji: '🛏️',
    path: '/communicate/room',
    image: 'environment-room.png',
    bg: 'linear-gradient(160deg, rgba(255,255,255,0.92) 0%, rgba(245,245,255,0.86) 60%, rgba(230,225,255,0.75) 100%)',
    ringColor: '#AF52DE',
    glowColor: 'rgba(175,82,222,0.40)',
    floatDuration: 4.5,
    imgScale: 1.0,
    imgPosition: 'center center',
    Icon: HomeIcon,
    items: [
      { id: 'bed_up',    label: 'ارفع السرير',        emoji: '🛏️', image: 'room-bed-up.png' },
      { id: 'bed_down',  label: 'أنزل السرير',        emoji: '🛏️', image: 'room-bed-down.png' },
      { id: 'light_on',  label: 'شغّل النور',         emoji: '💡', image: 'room-light-on.png' },
      { id: 'light_off', label: 'أطفئ النور',         emoji: '🌑', image: 'room-light-off.png' },
      { id: 'tv_on',     label: 'شغّل التلفزيون',     emoji: '📺', image: 'room-tv-on.png' },
      { id: 'tv_off',    label: 'أطفئ التلفزيون',     emoji: '📺', image: 'room-tv-off.png' },
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
      { id: 'happy',   label: 'سعيد',    emoji: '😊', Icon: Smile,           image: 'happy.png' },
      { id: 'sad',     label: 'حزين',    emoji: '😢', Icon: Frown,           image: 'sad.png' },
      { id: 'miss',    label: 'أحبكم',   emoji: '❤️', Icon: HeartHandshake,  image: 'love-family.png' },
      { id: 'tired',   label: 'نعسان',    emoji: '😴', Icon: TiredFaceIcon,   image: 'sleepy.png' },
    ],
  },
  {
    id: 'social',
    label: 'التواصل',
    emoji: '👨‍👩‍👧‍👦',
    path: '/communicate/social',
    image: 'communication.png',
    bg: 'linear-gradient(160deg, rgba(255,255,255,0.92) 0%, rgba(255,248,242,0.86) 60%, rgba(255,232,215,0.75) 100%)',
    ringColor: '#FF6B35',
    glowColor: 'rgba(255,107,53,0.40)',
    floatDuration: 3.6,
    imgScale: 1.0,
    imgPosition: 'center center',
    Icon: Users,
    items: [
      { id: 'call_son',      label: 'اتصل بابني',            emoji: '📞', Icon: SonCallIcon,        image: 'call-son.png' },
      { id: 'call_daughter', label: 'اتصل بابنتي',           emoji: '📞', Icon: DaughterCallIcon,   image: 'call-daughter.png' },
      { id: 'call_friend',   label: 'أريد أصحابي',           emoji: '📞', Icon: FriendCallIcon,     image: 'friends.png' },
      { id: 'message',       label: 'أرسل رسالة لعيالي',     emoji: '💬', Icon: MessageCircle,      image: 'send-message.png' },
      { id: 'video',         label: 'مكالمة فيديو',           emoji: '📹', Icon: Video,              image: 'video-call.png' },
      { id: 'companion',     label: 'نادِ أحدًا يجلس معي',  emoji: '🤝', Icon: CompanionshipIcon,  image: 'sit-with-me.png' },
    ],
  },
];

// ── Request store (localStorage-backed, shared between patient & dashboard) ───

// ── Profile (onboarding, localStorage) ───────────────────────────────────────
const PROFILE_KEY = 'sameyba_profile_v1';

interface ProfileData {
  patientName:   string;
  caregiverName:  string;
  caregiverPhone: string;
}

function loadProfile(): ProfileData | null {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null') as ProfileData | null; }
  catch { return null; }
}

function saveProfile(data: ProfileData): void {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(data)); } catch { /* quota */ }
}

const ProfileContext = createContext<ProfileData>({
  patientName:   'المريض',
  caregiverName:  'مقدم الرعاية',
  caregiverPhone: '',
});

const ProfileUpdateContext = createContext<(data: ProfileData) => void>(() => {});

export function useProfile() { return useContext(ProfileContext); }
function useUpdateProfile() { return useContext(ProfileUpdateContext); }

// ─────────────────────────────────────────────────────────────────────────────
const STORE_KEY           = 'sameyba_requests_v1';
const CAREGIVER_AUDIO_KEY = 'sameyba_caregiver_audio_v2';
const URGENT_LABELS  = ['متألم', 'غثيان', 'أريد الحمام', 'نادِ الممرضة', 'طلب مساعدة عاجلة'];

function isUrgent(label: string): boolean {
  return URGENT_LABELS.some(kw => label.includes(kw) || kw.includes(label));
}

export interface PatientRequest {
  id:            string;
  patientName:   string;
  requestText:   string;
  requestEmoji:  string;
  categoryId:    string;
  categoryLabel: string;
  createdAt:     string;   // ISO
  priority:      'urgent' | 'normal';
  status:        'pending' | 'done' | 'rejected';
  completedAt?:  string;   // ISO
  rejectedAt?:   string;   // ISO
}

interface RequestStoreShape {
  requests:        PatientRequest[];
  // Callers may pre-generate `id` so the store can reject duplicates idempotently.
  addRequest:      (data: Omit<PatientRequest, 'createdAt' | 'status'>) => void;
  completeRequest: (id: string) => void;
  rejectRequest:   (id: string) => void;
}

const RequestContext = createContext<RequestStoreShape | null>(null);

function loadRequests(): PatientRequest[] {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as PatientRequest[]; }
  catch { return []; }
}
function saveRequests(reqs: PatientRequest[]): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(reqs)); } catch { /* quota */ }
}

const BC_CHANNEL = 'sameyba_requests_sync';

function RequestStoreProvider({ children }: { children: React.ReactNode }) {
  const [requests, setRequests] = useState<PatientRequest[]>(loadRequests);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Single effect — opens the channel AND wires listeners in one cleanup scope.
  // Merging them prevents the two-effect ordering hazard where the listener
  // effect reads channelRef.current before the channel-open effect has run.
  useEffect(() => {
    const ch = typeof BroadcastChannel !== 'undefined'
      ? new BroadcastChannel(BC_CHANNEL)
      : null;
    channelRef.current = ch;

    function syncFromStorage() {
      // Replace state from localStorage (source of truth).
      // This only runs in *other* tabs — never in the tab that wrote.
      setRequests(loadRequests());
    }

    if (ch) {
      ch.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'update') syncFromStorage();
      };
    }

    // storage event fires in every tab except the one that called setItem
    function onStorage(e: StorageEvent) {
      if (e.key === STORE_KEY) syncFromStorage();
    }
    window.addEventListener('storage', onStorage);

    return () => {
      ch?.close();
      channelRef.current = null;
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  // All three mutators follow the same safe pattern:
  //   1. Read current truth from localStorage (avoids stale-closure state)
  //   2. Compute next array (pure)
  //   3. Persist + broadcast (side effect, outside any state updater)
  //   4. setRequests (just schedules a re-render)
  // Nothing touches a state updater function beyond returning the next value.

  const addRequest = useCallback((data: Omit<PatientRequest, 'createdAt' | 'status'>) => {
    const current = loadRequests();
    if (current.some(r => r.id === data.id)) return; // idempotent by UUID
    const req: PatientRequest = {
      ...data,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    const next = [req, ...current];
    saveRequests(next);
    channelRef.current?.postMessage({ type: 'update' });
    setRequests(next);
  }, []);

  const completeRequest = useCallback((id: string) => {
    const current = loadRequests();
    const next = current.map(r =>
      r.id === id ? { ...r, status: 'done' as const, completedAt: new Date().toISOString() } : r,
    );
    saveRequests(next);
    channelRef.current?.postMessage({ type: 'update' });
    setRequests(next);
  }, []);

  const rejectRequest = useCallback((id: string) => {
    const current = loadRequests();
    const next = current.map(r =>
      r.id === id ? { ...r, status: 'rejected' as const, rejectedAt: new Date().toISOString() } : r,
    );
    saveRequests(next);
    channelRef.current?.postMessage({ type: 'update' });
    setRequests(next);
  }, []);

  return (
    <RequestContext.Provider value={{ requests, addRequest, completeRequest, rejectRequest }}>
      {children}
    </RequestContext.Provider>
  );
}

export function useRequestStore(): RequestStoreShape {
  const ctx = useContext(RequestContext);
  if (!ctx) throw new Error('useRequestStore must be used inside RequestStoreProvider');
  return ctx;
}

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

// ── Emergency dialog — animated step-by-step simulation ──────────────────────
function EmergencyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { caregiverName, caregiverPhone } = useProfile();
  const [step, setStep] = useState(0);
  // Stable portal container — created once after mount, removed on unmount.
  // Using useState initializer avoids the "document is not defined" SSR pitfall
  // and gives createPortal a real DOM node rather than document.body directly.
  const [portalEl] = useState<HTMLDivElement>(() => {
    const el = document.createElement('div');
    el.setAttribute('data-emergency-portal', '1');
    document.body.appendChild(el);
    return el;
  });
  useEffect(() => () => { document.body.removeChild(portalEl); }, [portalEl]);

  useEffect(() => {
    if (!open) { setStep(0); return; }
    setStep(1);
    const t1 = setTimeout(() => setStep(2), 1000);
    const t2 = setTimeout(() => setStep(3), 2000);
    const t3 = setTimeout(() => onClose(),  5000); // 2000 ms sequence + 3000 ms hold
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="emergency-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: 'easeInOut' }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.82 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.90 }}
            transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
            dir="rtl"
            style={{
              background: 'rgba(24,24,26,0.97)',
              backdropFilter: 'blur(36px)',
              WebkitBackdropFilter: 'blur(36px)',
              borderRadius: '28px',
              padding: '44px 48px 40px',
              textAlign: 'center',
              boxShadow: [
                '0 48px 120px rgba(0,0,0,0.50)',
                '0 0 0 1px rgba(255,255,255,0.07)',
                '0 0 0 4px rgba(255,48,36,0.18)',
              ].join(', '),
              maxWidth: '390px',
              width: '88vw',
              fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            }}
          >
            {/* Pulsing red beacon */}
            <div style={{ position: 'relative', width: '64px', height: '64px', margin: '0 auto 28px' }}>
              <motion.div
                animate={{ scale: [1, 1.55, 1], opacity: [0.55, 0, 0.55] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  position: 'absolute', inset: 0,
                  borderRadius: '50%',
                  background: 'rgba(255,48,36,0.35)',
                }}
              />
              <div style={{
                position: 'absolute', inset: '10px',
                borderRadius: '50%',
                background: 'linear-gradient(145deg, #FF3B30, #FF1A0F)',
                boxShadow: '0 6px 24px rgba(255,48,36,0.60)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.45rem',
              }}>
                🚨
              </div>
            </div>

            {/* Step 1 — sending alert */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                gap: '10px', padding: '11px 20px', borderRadius: '14px',
                background: 'rgba(255,48,36,0.14)',
                border: '1px solid rgba(255,48,36,0.28)',
              }}>
                <span style={{ fontSize: '1.15rem', flexShrink: 0 }}>🚨</span>
                <span style={{ color: '#FF6B63', fontWeight: 700, fontSize: 'clamp(0.84rem, 1.05vw, 0.96rem)', lineHeight: 1.4 }}>
                  جاري إرسال تنبيه الطوارئ...
                </span>
              </div>

              {/* Step 2 — caregiver notified + info card */}
              <AnimatePresence>
                {step >= 2 && (
                  <motion.div
                    key="step2"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                    style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
                  >
                    {/* Notified row */}
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: '10px', padding: '11px 20px', borderRadius: '14px',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}>
                      <span style={{ fontSize: '1.15rem', flexShrink: 0 }}>✅</span>
                      <span style={{ color: 'rgba(255,255,255,0.88)', fontWeight: 600, fontSize: 'clamp(0.84rem, 1.05vw, 0.96rem)', lineHeight: 1.4 }}>
                        تم إشعار مقدم الرعاية
                      </span>
                    </div>
                    {/* Caregiver info card */}
                    <div style={{
                      borderRadius: '12px',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      padding: '12px 18px',
                      display: 'flex', flexDirection: 'column', gap: '6px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1rem' }}>👤</span>
                        <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 'clamp(0.80rem, 1vw, 0.90rem)', fontWeight: 500 }}>
                          {caregiverName}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '1rem' }}>📞</span>
                        <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 'clamp(0.80rem, 1vw, 0.90rem)', fontWeight: 500, direction: 'ltr' }}>
                          {caregiverPhone}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Step 3 — final confirmation + green checkmark */}
              <AnimatePresence>
                {step >= 3 && (
                  <motion.div
                    key="step3"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}
                  >
                    <div style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      gap: '10px', padding: '11px 20px', borderRadius: '14px',
                      width: '100%',
                      background: 'rgba(48,209,88,0.12)',
                      border: '1px solid rgba(48,209,88,0.28)',
                    }}>
                      <span style={{ fontSize: '1.15rem', flexShrink: 0 }}>✅</span>
                      <span style={{ color: '#4CD964', fontWeight: 700, fontSize: 'clamp(0.84rem, 1.05vw, 0.96rem)', lineHeight: 1.4 }}>
                        تم إرسال التنبيه بنجاح
                      </span>
                    </div>
                    <motion.div
                      initial={{ opacity: 0, scale: 0.5 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
                    >
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: '52px', height: '52px', borderRadius: '50%',
                        background: 'linear-gradient(145deg, #30D158, #25A244)',
                        boxShadow: '0 8px 28px rgba(48,209,88,0.45)',
                        fontSize: '1.55rem',
                      }}>
                        ✓
                      </div>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ── Shared: Emergency button (always visible, always pulsing) ─────────────────
function EmergencyButton() {
  const [open, setOpen] = useState(false);
  const [mouseActive, setMouseActive] = useState(false);
  const { addRequest } = useRequestStore();
  const { patientName } = useProfile();

  const { controls, handlers, onUpdate, isGazeActive } = useDwell(() => {
    // Create the emergency request in the shared store so it broadcasts to
    // the Caregiver Dashboard via BroadcastChannel + storage-event sync.
    addRequest({
      id:            `emergency-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      patientName,
      requestText:   'طوارئ',
      requestEmoji:  '🚨',
      categoryId:    'emergency',
      categoryLabel: 'طوارئ',
      priority:      'urgent',
    });
    setOpen(true);
  }, 'emergency');

  const active = isGazeActive || mouseActive;

  const augmented = {
    onMouseEnter: () => { setMouseActive(true);  handlers.onMouseEnter(); },
    onMouseLeave: () => { setMouseActive(false); handlers.onMouseLeave(); },
    onFocus:      () => { setMouseActive(true);  handlers.onFocus(); },
    onBlur:       () => { setMouseActive(false); handlers.onBlur(); },
  };

  return (
    <>
      <motion.button
        {...augmented}
        data-gaze-id="emergency"
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
        {/* Dwell ring — centered on the button */}
        <div style={{
          position: 'absolute',
          top: '50%', left: '50%',
          width: 'clamp(72px, 11vh, 96px)',
          height: 'clamp(72px, 11vh, 96px)',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
        }}>
          <DwellRingCircle
            ringColor="#007AFF"
            glowColor="rgba(0,122,255,0.40)"
            active={active}
            controls={controls}
            onUpdate={onUpdate}
          />
        </div>

        <span role="img" aria-hidden>🚨</span>
        <span>طوارئ</span>
      </motion.button>
      <EmergencyDialog open={open} onClose={() => setOpen(false)} />
    </>
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
  const [mouseActive, setMouseActive] = useState(false);
  const { controls, handlers, onUpdate, isGazeActive } = useDwell(onClick, card.id);
  const active = isGazeActive || mouseActive;

  const augmented = {
    onMouseEnter: () => { setMouseActive(true);  handlers.onMouseEnter(); },
    onMouseLeave: () => { setMouseActive(false); handlers.onMouseLeave(); },
    onFocus:      () => { setMouseActive(true);  handlers.onFocus(); },
    onBlur:       () => { setMouseActive(false); handlers.onBlur(); },
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
            onUpdate={onUpdate}
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
  const [mouseActive, setMouseActive] = useState(false);
  const { controls, handlers, onUpdate, isGazeActive } = useDwell(() => onSelect(item.id), `item-${item.id}`);
  const active = isGazeActive || mouseActive;

  const augmented = {
    onMouseEnter: () => { setMouseActive(true);  handlers.onMouseEnter(); },
    onMouseLeave: () => { setMouseActive(false); handlers.onMouseLeave(); },
    onFocus:      () => { setMouseActive(true);  handlers.onFocus(); },
    onBlur:       () => { setMouseActive(false); handlers.onBlur(); },
  };

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
    '0 0 0 3px rgba(0,122,255,0.50)',
    '0 0 24px rgba(0,122,255,0.32)',
    '0 8px 32px rgba(0,122,255,0.16)',
    'inset 0 1.5px 0 rgba(255,255,255,1)',
  ].join(', ');

  return (
    <button
      onClick={() => onSelect(item.id)}
      data-gaze-id={`item-${item.id}`}
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
          ringColor="#007AFF"
          glowColor="rgba(0,122,255,0.40)"
          active={active}
          controls={controls}
          onUpdate={onUpdate}
        />
      </div>

      {item.image ? (
        <img
          src={import.meta.env.BASE_URL + item.image}
          alt={item.label}
          style={{
            width: 'calc(100% - 4px)',
            height: 'clamp(80px, 11vh, 102px)',
            objectFit: 'cover',
            objectPosition: 'center center',
            borderRadius: '12px',
            display: 'block',
            flexShrink: 0,
            imageRendering: 'auto',
          }}
        />
      ) : item.Icon ? (
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

// ── SuccessDialog — shown after dwell selection, auto-closes after 2 s ────────
function SuccessDialog({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="success-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(0,0,0,0.28)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.82 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.88 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            dir="rtl"
            style={{
              background: 'rgba(255,255,255,0.96)',
              backdropFilter: 'blur(28px)',
              WebkitBackdropFilter: 'blur(28px)',
              borderRadius: '24px',
              padding: '40px 48px',
              textAlign: 'center',
              boxShadow: [
                '0 32px 80px rgba(0,0,0,0.18)',
                '0 8px 24px rgba(0,0,0,0.10)',
                '0 0 0 1px rgba(255,255,255,0.8)',
              ].join(', '),
              maxWidth: '360px',
              width: '88vw',
              fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            }}
          >
            <div style={{ fontSize: '3rem', lineHeight: 1, marginBottom: '16px' }}>👁️</div>
            <p style={{
              fontSize: 'clamp(1.05rem, 1.4vw, 1.25rem)',
              fontWeight: 700,
              color: '#0A0A0A',
              marginBottom: '12px',
              lineHeight: 1.4,
            }}>
              تم التعرف على النظرة
            </p>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              background: 'linear-gradient(135deg, rgba(52,199,89,0.10) 0%, rgba(52,199,89,0.05) 100%)',
              border: '1.5px solid rgba(52,199,89,0.35)',
              borderRadius: '999px',
              padding: '9px 20px',
            }}>
              <span style={{ fontSize: '1.1rem' }}>✅</span>
              <span style={{
                fontSize: 'clamp(0.84rem, 1.05vw, 0.98rem)',
                fontWeight: 600,
                color: '#1C7A3A',
              }}>
                تم إرسال الطلب إلى مقدم الرعاية
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Home ──────────────────────────────────────────────────────────────────────
function Home() {
  const [, navigate] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const menuItems: {
    icon: string;
    label: string;
    sublabel?: string;
    action?: () => void;
    badge?: string;
    disabled?: boolean;
  }[] = [
    {
      icon: '👨‍⚕️',
      label: 'لوحة المشرف',
      action: () => { setMenuOpen(false); navigate('/dashboard'); },
    },
    {
      icon: '🎯',
      label: 'إعادة المعايرة',
      action: () => { setMenuOpen(false); navigate('/settings'); },
    },
    {
      icon: '🔊',
      label: 'اختبار الصوت',
      action: () => { setMenuOpen(false); navigate('/settings'); },
    },
    {
      icon: '🌐',
      label: 'اللغة',
      sublabel: 'العربية ✓  ·  English (Coming Soon)',
      disabled: true,
    },
    {
      icon: '✏️',
      label: 'تعديل بيانات المريض',
      action: () => { setMenuOpen(false); navigate('/settings'); },
    },
  ];

  return (
    <div
      className="relative min-h-[100dvh] w-full flex flex-col md:flex-row bg-[#FAFAFA] overflow-x-hidden"
      dir="rtl"
      style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}
    >
      {/* ── Transparent overlay — closes menu on outside click ── */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            key="settings-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ position: 'fixed', inset: 0, zIndex: 29 }}
            onClick={() => setMenuOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* ── Settings button — upper corner (RTL: visual left) ── */}
      <motion.button
        onClick={() => setMenuOpen(v => !v)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.93 }}
        transition={{ type: 'spring', stiffness: 300, damping: 22 }}
        aria-label="الإعدادات"
        aria-expanded={menuOpen}
        style={{
          position: 'absolute',
          top: '20px',
          insetInlineEnd: '20px',
          zIndex: 31,
          display: 'flex', alignItems: 'center', gap: '6px',
          height: '40px',
          padding: '0 16px',
          borderRadius: '999px',
          background: menuOpen
            ? 'rgba(94,126,53,0.10)'
            : 'rgba(255,255,255,0.78)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          border: menuOpen
            ? '1px solid rgba(94,126,53,0.40)'
            : '1px solid rgba(94,126,53,0.28)',
          boxShadow: '0 2px 12px rgba(94,126,53,0.10), inset 0 1px 0 rgba(255,255,255,0.9)',
          cursor: 'pointer',
          fontSize: '0.82rem',
          fontWeight: 600,
          color: '#4F6C2D',
          fontFamily: "'IBM Plex Sans Arabic', sans-serif",
          transition: 'background 0.18s, border-color 0.18s',
        }}
      >
        <motion.span
          animate={{ rotate: menuOpen ? 60 : 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          style={{ fontSize: '0.92rem', display: 'inline-block' }}
        >
          ⚙️
        </motion.span>
        <span>الإعدادات</span>
      </motion.button>

      {/* ── Settings popup menu ── */}
      <AnimatePresence>
        {menuOpen && (
          <motion.div
            key="settings-menu"
            initial={{ opacity: 0, scale: 0.90, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.90, y: -10 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            style={{
              position: 'absolute',
              top: '68px',
              insetInlineEnd: '20px',
              zIndex: 31,
              width: '230px',
              background: 'rgba(255,255,255,0.94)',
              backdropFilter: 'blur(40px) saturate(200%)',
              WebkitBackdropFilter: 'blur(40px) saturate(200%)',
              borderRadius: '20px',
              border: '1.5px solid rgba(94,126,53,0.18)',
              boxShadow:
                '0 20px 56px rgba(0,0,0,0.11), 0 4px 16px rgba(94,126,53,0.10), inset 0 1px 0 rgba(255,255,255,1)',
              overflow: 'hidden',
              fontFamily: "'IBM Plex Sans Arabic', sans-serif",
              direction: 'rtl',
            }}
          >
            {/* Thin olive top-accent */}
            <div style={{
              height: '3px',
              background: 'linear-gradient(90deg, #5E7E35, #7BA043, #C9A84C)',
            }} />

            {menuItems.map((item, i) => (
              <motion.button
                key={item.label}
                onClick={item.disabled ? undefined : item.action}
                disabled={item.disabled}
                whileHover={item.disabled ? {} : {
                  background: 'rgba(94,126,53,0.08)',
                }}
                whileTap={item.disabled ? {} : { scale: 0.98 }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  padding: '13px 18px',
                  background: 'transparent',
                  border: 'none',
                  borderTop: i === 0 ? 'none' : '1px solid rgba(0,0,0,0.05)',
                  cursor: item.disabled ? 'default' : 'pointer',
                  textAlign: 'right',
                  opacity: item.disabled ? 0.42 : 1,
                  fontFamily: "'IBM Plex Sans Arabic', sans-serif",
                }}
              >
                <span style={{ fontSize: '1.15rem', flexShrink: 0, lineHeight: 1 }}>
                  {item.icon}
                </span>
                <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{
                    fontSize: '0.9rem',
                    fontWeight: 600,
                    color: '#1C1C1E',
                    letterSpacing: '-0.01em',
                  }}>
                    {item.label}
                  </span>
                  {item.sublabel && (
                    <span style={{
                      fontSize: '0.72rem',
                      fontWeight: 500,
                      color: '#AEAEB2',
                      letterSpacing: '0.01em',
                    }}>
                      {item.sublabel}
                    </span>
                  )}
                </span>
                {item.badge && (
                  <span style={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    color: '#5E7E35',
                    background: 'rgba(94,126,53,0.10)',
                    padding: '2px 8px',
                    borderRadius: '999px',
                    border: '1px solid rgba(94,126,53,0.20)',
                    letterSpacing: '0.03em',
                    flexShrink: 0,
                  }}>
                    {item.badge}
                  </span>
                )}
                {!item.disabled && !item.badge && (
                  <span style={{
                    fontSize: '0.8rem',
                    color: '#AEAEB2',
                    flexShrink: 0,
                  }}>
                    ←
                  </span>
                )}
              </motion.button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
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
                <Eye className="w-5 h-5 text-[#5E7E35] shrink-0" strokeWidth={2.5} />
                <span className="text-[0.95rem] font-medium text-[#1C1C1E]">يتواصل بالنظر فقط</span>
              </div>
              <div className="flex items-center gap-4">
                <Volume2 className="w-5 h-5 text-[#5E7E35] shrink-0" strokeWidth={2.5} />
                <span className="text-[0.95rem] font-medium text-[#1C1C1E]">يحوّل النظر إلى كلام</span>
              </div>
              <div className="flex items-center gap-4">
                <Smartphone className="w-5 h-5 text-[#5E7E35] shrink-0" strokeWidth={2.5} />
                <span className="text-[0.95rem] font-medium text-[#1C1C1E]">يرسل الطلب لمقدم الرعاية</span>
              </div>
            </motion.div>

            <motion.div variants={itemVariants} className="pt-4 flex flex-col gap-3">
              <motion.button
                onClick={() => navigate('/communicate')}
                whileHover={{ scale: 1.05, boxShadow: '0 8px 36px rgba(94,126,53,0.45)' }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                initial={{ boxShadow: '0 4px 24px rgba(94,126,53,0.30)' }}
                className="text-white text-[1.1rem] font-semibold rounded-full min-w-[200px] w-fit flex items-center justify-center"
                style={{ padding: '18px 52px', border: 'none', outline: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #5E7E35 0%, #4A6828 100%)' }}
              >
                ابدأ التواصل
              </motion.button>
            </motion.div>
            {/* Floating AI assistant — position: fixed, renders above page content */}
            <AIAssistantButton />

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
  const { patientName } = useProfile();
  const [, params] = useRoute<{ categoryId: string }>('/communicate/:categoryId');
  const [, navigate] = useLocation();
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [showDialog, setShowDialog] = useState(false);
  const dialogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { addRequest } = useRequestStore();
  // Ref-based lock: prevents a click event that arrives within 1 s of a
  // successful selection (dwell or click) from submitting a duplicate request.
  // Using a ref avoids stale-closure issues — the check always reads live.
  const selectionLockedUntilRef = useRef(0);

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
    // Drop any call that arrives within the 1-second lock window after the
    // last successful submission — covers the dwell-then-click race and rapid
    // double-clicks equally.
    if (Date.now() < selectionLockedUntilRef.current) return;

    // Toggling an already-selected card off → no new request
    if (selectedItem === id) { setSelectedItem(null); return; }

    const item = category.items.find(i => i.id === id);
    if (item) {
      selectionLockedUntilRef.current = Date.now() + 1000;
      // Generate the ID here, once, so the store can deduplicate on replay
      const reqId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      addRequest({
        id:            reqId,
        patientName:   patientName,
        requestText:   item.label,
        requestEmoji:  item.emoji,
        categoryId:    category.id,
        categoryLabel: category.label,
        priority:      isUrgent(item.label) ? 'urgent' : 'normal',
      });
      // Show success dialog, auto-close after 2 s
      if (dialogTimerRef.current) clearTimeout(dialogTimerRef.current);
      setShowDialog(true);
      dialogTimerRef.current = setTimeout(() => setShowDialog(false), 2000);
    }
    setSelectedItem(id);
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

      {/* Items grid — 2 cols for ≤4 items, 3 cols otherwise */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-8 pb-4">
        <div
          className={`grid ${category.items.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'}`}
          style={{
            gap: 'clamp(10px, 1.8vw, 18px)',
            maxWidth: category.items.length <= 4 ? '580px' : '860px',
          }}
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

      <SuccessDialog visible={showDialog} />
    </div>
  );
}

// ── Caregiver Dashboard ───────────────────────────────────────────────────────

// ── Settings ──────────────────────────────────────────────────────────────────
function SettingsPage() {
  const profile      = useProfile();
  const updateProfile = useUpdateProfile();
  const [, navigate] = useLocation();

  const [patientName,    setPatientName]    = useState(profile.patientName);
  const [caregiverName,  setCaregiverName]  = useState(profile.caregiverName);
  const [caregiverPhone, setCaregiverPhone] = useState(profile.caregiverPhone);
  const [errors,  setErrors]  = useState<Record<string, string>>({});
  const [saved,   setSaved]   = useState(false);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!patientName.trim())    e.patientName    = 'يرجى إدخال اسم المستخدم';
    if (!caregiverName.trim())  e.caregiverName  = 'يرجى إدخال اسم مقدم الرعاية';
    if (!caregiverPhone.trim()) e.caregiverPhone = 'يرجى إدخال رقم الجوال';
    return e;
  };

  const handleSave = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaved(true);
    updateProfile({
      patientName:   patientName.trim(),
      caregiverName: caregiverName.trim(),
      caregiverPhone: caregiverPhone.trim(),
    });
    setTimeout(() => navigate('/'), 1100);
  };

  const clearError = (key: string) =>
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });

  const fieldBox: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '7px' };
  const labelStyle: React.CSSProperties = {
    fontSize: '0.93rem', fontWeight: 600, color: '#3A3A3C',
    display: 'flex', alignItems: 'center', gap: '6px',
  };
  const inputStyle = (hasError: boolean): React.CSSProperties => ({
    width: '100%', boxSizing: 'border-box',
    background: hasError ? 'rgba(255,59,48,0.05)' : 'rgba(255,255,255,0.72)',
    border: `1.5px solid ${hasError ? 'rgba(255,59,48,0.45)' : 'rgba(0,0,0,0.09)'}`,
    borderRadius: '14px',
    padding: '15px 18px',
    fontSize: '1.08rem',
    fontFamily: "'IBM Plex Sans Arabic', sans-serif",
    color: '#1C1C1E',
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    WebkitAppearance: 'none',
    direction: 'rtl',
  });
  const errorStyle: React.CSSProperties = {
    fontSize: '0.80rem', color: '#FF3B30', fontWeight: 500,
    display: 'flex', alignItems: 'center', gap: '4px', margin: 0,
  };

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100dvh', width: '100%',
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        background: 'linear-gradient(145deg, #FAFAF5 0%, #F5F7EE 35%, #EEF3E4 65%, #F2F6EC 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* Ambient blobs */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: '-12%', right: '-8%',
          width: 'clamp(260px,40vw,520px)', height: 'clamp(260px,40vw,520px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(94,126,53,0.13) 0%, transparent 70%)',
          filter: 'blur(48px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-10%', left: '-6%',
          width: 'clamp(200px,32vw,420px)', height: 'clamp(200px,32vw,420px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(94,126,53,0.08) 0%, transparent 70%)',
          filter: 'blur(48px)',
        }} />
      </div>

      {/* Glass card */}
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: 'relative', zIndex: 1,
          width: '100%', maxWidth: '520px',
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'blur(40px) saturate(200%)',
          WebkitBackdropFilter: 'blur(40px) saturate(200%)',
          borderRadius: '28px',
          border: '1.5px solid rgba(255,255,255,0.95)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.11), 0 8px 24px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,1)',
          padding: 'clamp(28px,5vw,48px)',
          overflow: 'hidden',
        }}
      >
        {/* Header row — back button + title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
          <motion.button
            onClick={() => navigate('/')}
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.93 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            aria-label="رجوع"
            style={{
              flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '36px', height: '36px', borderRadius: '50%',
              background: 'rgba(0,0,0,0.06)',
              border: '1px solid rgba(0,0,0,0.07)',
              cursor: 'pointer',
              fontSize: '1rem',
            }}
          >
            ←
          </motion.button>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <h1 style={{
              fontSize: 'clamp(1.25rem,3vw,1.55rem)',
              fontWeight: 800, color: '#1C1C1E', margin: 0,
              letterSpacing: '-0.02em', lineHeight: 1.2,
            }}>
              ⚙️ الإعدادات
            </h1>
            <p style={{
              fontSize: '0.83rem', color: '#6E6E73', fontWeight: 500,
              margin: '4px 0 0', lineHeight: 1.4,
            }}>
              تعديل بيانات المريض ومقدم الرعاية
            </p>
          </div>
          {/* Spacer to balance the back button */}
          <div style={{ width: '36px', flexShrink: 0 }} />
        </div>

        {/* Divider */}
        <div style={{
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.08), transparent)',
          marginBottom: '28px',
        }} />

        {/* Form */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>

          {/* Patient name */}
          <div style={fieldBox}>
            <label style={labelStyle}>
              <span>👤</span><span>اسم المستخدم</span>
            </label>
            <input
              type="text"
              placeholder="مثال: محمد"
              value={patientName}
              onChange={e => { setPatientName(e.target.value); clearError('patientName'); }}
              style={inputStyle(!!errors.patientName)}
              onFocus={e => { e.currentTarget.style.borderColor = '#5E7E35'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(94,126,53,0.15)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = errors.patientName ? 'rgba(255,59,48,0.45)' : 'rgba(0,0,0,0.09)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <AnimatePresence>
              {errors.patientName && (
                <motion.p key="e-pn"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }} style={errorStyle}
                >
                  <span>⚠️</span> {errors.patientName}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Caregiver name */}
          <div style={fieldBox}>
            <label style={labelStyle}>
              <span>👤</span><span>اسم مقدم الرعاية</span>
            </label>
            <input
              type="text"
              placeholder="مثال: سارة الأحمد"
              value={caregiverName}
              onChange={e => { setCaregiverName(e.target.value); clearError('caregiverName'); }}
              style={inputStyle(!!errors.caregiverName)}
              onFocus={e => { e.currentTarget.style.borderColor = '#5E7E35'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(94,126,53,0.15)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = errors.caregiverName ? 'rgba(255,59,48,0.45)' : 'rgba(0,0,0,0.09)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <AnimatePresence>
              {errors.caregiverName && (
                <motion.p key="e-cn"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }} style={errorStyle}
                >
                  <span>⚠️</span> {errors.caregiverName}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Caregiver phone */}
          <div style={fieldBox}>
            <label style={labelStyle}>
              <span>📞</span><span>رقم جوال مقدم الرعاية</span>
            </label>
            <input
              type="tel"
              placeholder="05XXXXXXXX"
              value={caregiverPhone}
              onChange={e => { setCaregiverPhone(e.target.value); clearError('caregiverPhone'); }}
              style={{ ...inputStyle(!!errors.caregiverPhone), direction: 'ltr', textAlign: 'right' }}
              onFocus={e => { e.currentTarget.style.borderColor = '#5E7E35'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(94,126,53,0.15)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = errors.caregiverPhone ? 'rgba(255,59,48,0.45)' : 'rgba(0,0,0,0.09)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <AnimatePresence>
              {errors.caregiverPhone && (
                <motion.p key="e-cp"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }} style={errorStyle}
                >
                  <span>⚠️</span> {errors.caregiverPhone}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Save button */}
        <motion.button
          onClick={handleSave}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          style={{
            marginTop: '32px',
            width: '100%',
            background: 'linear-gradient(145deg, #5E7E35, #4F6C2D)',
            color: '#fff',
            border: 'none',
            borderRadius: '16px',
            padding: '17px',
            fontSize: '1.08rem',
            fontWeight: 700,
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            cursor: 'pointer',
            boxShadow: '0 8px 28px rgba(94,126,53,0.38)',
            letterSpacing: '0.01em',
          }}
        >
          حفظ التغييرات
        </motion.button>

        {/* Success overlay */}
        <AnimatePresence>
          {saved && (
            <motion.div
              key="saved"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.28 }}
              style={{
                position: 'absolute', inset: 0,
                background: 'rgba(255,255,255,0.92)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                borderRadius: '28px',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: '16px',
              }}
            >
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.42, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  width: '64px', height: '64px', borderRadius: '50%',
                  background: 'linear-gradient(145deg, #30D158, #25A244)',
                  boxShadow: '0 10px 32px rgba(48,209,88,0.40)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '1.7rem', color: '#fff',
                }}
              >
                ✓
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.2 }}
                style={{
                  margin: 0, fontSize: '1.08rem', fontWeight: 700, color: '#1C1C1E',
                  fontFamily: "'IBM Plex Sans Arabic', sans-serif",
                }}
              >
                ✅ تم حفظ التغييرات بنجاح
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ── Onboarding ────────────────────────────────────────────────────────────────
// ── Welcome Screen ────────────────────────────────────────────────────────────
function WelcomeScreen({ onStart }: { onStart: () => void }) {
  const [pressed, setPressed] = useState(false);

  const handleStart = () => {
    setPressed(true);
    setTimeout(onStart, 420);
  };

  const features: { icon: string; label: string }[] = [
    { icon: '👁️', label: 'تتبع العين' },
    { icon: '🔒', label: 'خصوصية تامة' },
    { icon: '❤️', label: 'تواصل بسهولة' },
  ];

  return (
    <motion.div
      key="welcome"
      dir="rtl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
      style={{
        minHeight: '100dvh', width: '100%',
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        background: 'linear-gradient(145deg, #FAFAF5 0%, #F5F7EE 35%, #EEF3E4 65%, #F2F6EC 100%)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* Ambient blobs — identical to OnboardingPage */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', top: '-12%', right: '-8%',
          width: 'clamp(260px, 40vw, 520px)', height: 'clamp(260px, 40vw, 520px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(94,126,53,0.13) 0%, transparent 70%)',
          filter: 'blur(48px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-10%', left: '-6%',
          width: 'clamp(200px, 32vw, 420px)', height: 'clamp(200px, 32vw, 420px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(94,126,53,0.08) 0%, transparent 70%)',
          filter: 'blur(48px)',
        }} />
        <div style={{
          position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 'clamp(300px, 50vw, 600px)', height: 'clamp(300px, 50vw, 600px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(94,126,53,0.10) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }} />
        {/* Extra warm blob top-left for depth */}
        <div style={{
          position: 'absolute', top: '10%', left: '-5%',
          width: 'clamp(180px, 28vw, 360px)', height: 'clamp(180px, 28vw, 360px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,190,100,0.07) 0%, transparent 70%)',
          filter: 'blur(40px)',
        }} />
      </div>

      {/* Glass card */}
      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: 'relative', zIndex: 1,
          width: '100%', maxWidth: '480px',
          background: 'rgba(255,255,255,0.84)',
          backdropFilter: 'blur(40px) saturate(200%)',
          WebkitBackdropFilter: 'blur(40px) saturate(200%)',
          borderRadius: '32px',
          border: '1.5px solid rgba(255,255,255,0.95)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.11), 0 8px 24px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,1)',
          padding: 'clamp(32px, 6vw, 52px) clamp(24px, 5vw, 44px)',
          overflow: 'hidden',
          textAlign: 'center',
        }}
      >
        {/* Top accent bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: '4px',
          background: 'linear-gradient(90deg, #5E7E35, #7BA043, #A8C070, #7BA043, #5E7E35)',
          backgroundSize: '200% 100%',
        }} />

        {/* Logo */}
        <motion.div
          initial={{ scale: 0.72, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: '32px' }}
        >
          <img
            src={import.meta.env.BASE_URL + 'sameyba-logo.png'}
            alt="سَم يبه"
            style={{ height: '112px', width: 'auto', display: 'block', margin: '0 auto' }}
          />
        </motion.div>

        {/* Title */}
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.22, ease: [0.22, 1, 0.36, 1] }}
          style={{
            fontSize: 'clamp(1.65rem, 4.2vw, 2.1rem)',
            fontWeight: 800, color: '#1C1C1E',
            margin: '0 0 22px', lineHeight: 1.2, letterSpacing: '-0.02em',
          }}
        >
          مرحبًا بك في تطبيق سم يبه
        </motion.h1>

        {/* Divider */}
        <motion.div
          initial={{ scaleX: 0, opacity: 0 }}
          animate={{ scaleX: 1, opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.28 }}
          style={{
            height: '2px', width: '48px', margin: '0 auto 24px',
            background: 'linear-gradient(90deg, #5E7E35, #A8C070)',
            borderRadius: '999px',
          }}
        />

        {/* Description */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.32, ease: [0.22, 1, 0.36, 1] }}
          style={{
            background: 'rgba(94,126,53,0.06)',
            borderRadius: '16px',
            padding: '18px 20px',
            marginBottom: '28px',
            border: '1px solid rgba(94,126,53,0.12)',
          }}
        >
          <p style={{
            fontSize: 'clamp(0.88rem, 2.2vw, 0.97rem)',
            color: '#3A3A3C', fontWeight: 500,
            margin: '0 0 12px', lineHeight: 1.7,
          }}>
            يساعدك تطبيق سم يبه على التعبير عن احتياجاتك والتواصل بسهولة مع عائلتك أو مقدم الرعاية باستخدام حركة العين، إذا كنت غير قادر على الكلام.
          </p>
          <p style={{
            fontSize: 'clamp(0.82rem, 2vw, 0.90rem)',
            color: '#6E6E73', fontWeight: 400,
            margin: 0, lineHeight: 1.65,
            display: 'flex', alignItems: 'flex-start', gap: '7px',
          }}>
            <span style={{ flexShrink: 0, marginTop: '1px' }}>🔒</span>
            <span><strong style={{ color: '#3A3A3C', fontWeight: 600 }}>خصوصيتك محفوظة —</strong> تُستخدم الكاميرا فقط لتتبع حركة العين أثناء استخدام التطبيق، ولا يتم حفظ أو تسجيل أي صور أو مقاطع فيديو.</span>
          </p>
        </motion.div>

        {/* Feature pills */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.40, ease: [0.22, 1, 0.36, 1] }}
          style={{
            display: 'flex', justifyContent: 'center',
            gap: '10px', flexWrap: 'wrap',
            marginBottom: '36px',
          }}
        >
          {features.map((f, i) => (
            <motion.div
              key={f.label}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.38, delay: 0.46 + i * 0.07, ease: [0.22, 1, 0.36, 1] }}
              style={{
                display: 'flex', alignItems: 'center', gap: '7px',
                padding: '10px 18px',
                borderRadius: '999px',
                background: 'rgba(255,255,255,0.90)',
                border: '1.5px solid rgba(94,126,53,0.20)',
                boxShadow: '0 2px 12px rgba(94,126,53,0.10)',
              }}
            >
              <span style={{ fontSize: '1.15rem', lineHeight: 1 }}>{f.icon}</span>
              <span style={{
                fontSize: '0.88rem', fontWeight: 600,
                color: '#2D4A1E', letterSpacing: '-0.01em',
              }}>
                {f.label}
              </span>
            </motion.div>
          ))}
        </motion.div>

        {/* CTA button */}
        <motion.button
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.58, ease: [0.22, 1, 0.36, 1] }}
          whileTap={{ scale: 0.97 }}
          onClick={handleStart}
          disabled={pressed}
          style={{
            width: '100%',
            padding: '18px 24px',
            borderRadius: '18px',
            border: 'none',
            background: pressed
              ? 'rgba(94,126,53,0.55)'
              : 'linear-gradient(135deg, #5E7E35 0%, #4A6828 100%)',
            color: '#FFFFFF',
            fontSize: 'clamp(1.05rem, 2.5vw, 1.18rem)',
            fontWeight: 700,
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            cursor: pressed ? 'default' : 'pointer',
            letterSpacing: '-0.01em',
            boxShadow: pressed
              ? 'none'
              : '0 8px 28px rgba(94,126,53,0.38), 0 2px 8px rgba(94,126,53,0.22)',
            transition: 'background 0.25s, box-shadow 0.25s',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
          }}
        >
          {pressed ? (
            <>
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 0.7, ease: 'linear', repeat: Infinity }}
                style={{ display: 'inline-block', fontSize: '1.1rem' }}
              >
                ⏳
              </motion.span>
              <span>جارٍ التحميل…</span>
            </>
          ) : (
            <>
              <span>ابدأ</span>
              <span style={{ fontSize: '1.1rem' }}>←</span>
            </>
          )}
        </motion.button>

        {/* Bottom hint */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.72 }}
          style={{
            fontSize: '0.78rem', color: '#AEAEB2',
            margin: '18px 0 0', fontWeight: 400,
          }}
        >
          مصمم لخدمة المرضى وأسرهم · يعمل دون الحاجة إلى اتصال دائم بالإنترنت
        </motion.p>
      </motion.div>
    </motion.div>
  );
}

function OnboardingPage({ onComplete }: { onComplete: (data: ProfileData) => void }) {
  const [patientName,   setPatientName]   = useState('');
  const [caregiverName, setCaregiverName] = useState('');
  const [caregiverPhone, setCaregiverPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved,  setSaved]  = useState(false);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!patientName.trim())    e.patientName    = 'يرجى إدخال اسم المستخدم';
    if (!caregiverName.trim())  e.caregiverName  = 'يرجى إدخال اسم مقدم الرعاية';
    if (!caregiverPhone.trim()) e.caregiverPhone = 'يرجى إدخال رقم الجوال';
    return e;
  };

  const handleSave = () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaved(true);
    setTimeout(() => {
      onComplete({
        patientName:   patientName.trim(),
        caregiverName: caregiverName.trim(),
        caregiverPhone: caregiverPhone.trim(),
      });
    }, 1200);
  };

  const clearError = (key: string) =>
    setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });

  // Shared field style
  const fieldBox: React.CSSProperties = {
    display: 'flex', flexDirection: 'column', gap: '7px',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '0.93rem', fontWeight: 600, color: '#3A3A3C',
    display: 'flex', alignItems: 'center', gap: '6px',
  };
  const inputStyle = (hasError: boolean): React.CSSProperties => ({
    width: '100%', boxSizing: 'border-box',
    background: hasError ? 'rgba(255,59,48,0.05)' : 'rgba(255,255,255,0.72)',
    border: `1.5px solid ${hasError ? 'rgba(255,59,48,0.45)' : 'rgba(0,0,0,0.09)'}`,
    borderRadius: '14px',
    padding: '15px 18px',
    fontSize: '1.08rem',
    fontFamily: "'IBM Plex Sans Arabic', sans-serif",
    color: '#1C1C1E',
    outline: 'none',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    WebkitAppearance: 'none',
    direction: 'rtl',
  });
  const errorStyle: React.CSSProperties = {
    fontSize: '0.80rem', color: '#FF3B30', fontWeight: 500,
    display: 'flex', alignItems: 'center', gap: '4px',
  };

  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100dvh', width: '100%',
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        background: 'linear-gradient(145deg, #FAFAF5 0%, #F5F7EE 35%, #EEF3E4 65%, #F2F6EC 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px 16px',
        position: 'relative', overflow: 'hidden',
      }}
    >
      {/* Ambient blobs */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: '-12%', right: '-8%',
          width: 'clamp(260px, 40vw, 520px)', height: 'clamp(260px, 40vw, 520px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(94,126,53,0.13) 0%, transparent 70%)',
          filter: 'blur(48px)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-10%', left: '-6%',
          width: 'clamp(200px, 32vw, 420px)', height: 'clamp(200px, 32vw, 420px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(94,126,53,0.08) 0%, transparent 70%)',
          filter: 'blur(48px)',
        }} />
        <div style={{
          position: 'absolute', top: '40%', left: '50%', transform: 'translate(-50%,-50%)',
          width: 'clamp(300px, 50vw, 600px)', height: 'clamp(300px, 50vw, 600px)',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(94,126,53,0.10) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }} />
      </div>

      {/* Glass card */}
      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: 'relative', zIndex: 1,
          width: '100%', maxWidth: '520px',
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'blur(40px) saturate(200%)',
          WebkitBackdropFilter: 'blur(40px) saturate(200%)',
          borderRadius: '28px',
          border: '1.5px solid rgba(255,255,255,0.95)',
          boxShadow: '0 32px 80px rgba(0,0,0,0.11), 0 8px 24px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,1)',
          padding: 'clamp(28px, 5vw, 48px)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          {/* Icon badge */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.45, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            style={{ marginBottom: '20px' }}
          >
            <img
              src={import.meta.env.BASE_URL + 'sameyba-logo.png'}
              alt="سَم يبه"
              style={{ height: '104px', width: 'auto', display: 'block', margin: '0 auto' }}
            />
          </motion.div>

          <h1 style={{
            fontSize: 'clamp(1.45rem, 3.5vw, 1.85rem)',
            fontWeight: 800, color: '#1C1C1E', margin: '0 0 10px',
            letterSpacing: '-0.02em', lineHeight: 1.2,
          }}>
            تسجيل بيانات المريض
          </h1>
          <p style={{
            fontSize: 'clamp(0.88rem, 2vw, 0.98rem)',
            color: '#6E6E73', fontWeight: 500, margin: 0, lineHeight: 1.5,
          }}>
            أدخل البيانات مرة واحدة لتفعيل التطبيق.
          </p>
        </div>

        {/* Divider */}
        <div style={{
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(0,0,0,0.08), transparent)',
          marginBottom: '32px',
        }} />

        {/* Form fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '22px' }}>

          {/* Patient name */}
          <div style={fieldBox}>
            <label style={labelStyle}>
              <span>👤</span>
              <span>اسم المستخدم</span>
            </label>
            <input
              type="text"
              placeholder="مثال: محمد"
              value={patientName}
              onChange={e => { setPatientName(e.target.value); clearError('patientName'); }}
              style={inputStyle(!!errors.patientName)}
              onFocus={e => { e.currentTarget.style.borderColor = '#5E7E35'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(94,126,53,0.15)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = errors.patientName ? 'rgba(255,59,48,0.45)' : 'rgba(0,0,0,0.09)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <AnimatePresence>
              {errors.patientName && (
                <motion.p key="err-pn"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }} style={{ ...errorStyle, margin: 0 }}
                >
                  <span>⚠️</span> {errors.patientName}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Caregiver name */}
          <div style={fieldBox}>
            <label style={labelStyle}>
              <span>👤</span>
              <span>اسم مقدم الرعاية</span>
            </label>
            <input
              type="text"
              placeholder="مثال: سارة الأحمد"
              value={caregiverName}
              onChange={e => { setCaregiverName(e.target.value); clearError('caregiverName'); }}
              style={inputStyle(!!errors.caregiverName)}
              onFocus={e => { e.currentTarget.style.borderColor = '#5E7E35'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(94,126,53,0.15)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = errors.caregiverName ? 'rgba(255,59,48,0.45)' : 'rgba(0,0,0,0.09)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <AnimatePresence>
              {errors.caregiverName && (
                <motion.p key="err-cn"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }} style={{ ...errorStyle, margin: 0 }}
                >
                  <span>⚠️</span> {errors.caregiverName}
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Caregiver phone */}
          <div style={fieldBox}>
            <label style={labelStyle}>
              <span>📞</span>
              <span>رقم جوال مقدم الرعاية</span>
            </label>
            <input
              type="tel"
              placeholder="05XXXXXXXX"
              value={caregiverPhone}
              onChange={e => { setCaregiverPhone(e.target.value); clearError('caregiverPhone'); }}
              style={{ ...inputStyle(!!errors.caregiverPhone), direction: 'ltr', textAlign: 'right' }}
              onFocus={e => { e.currentTarget.style.borderColor = '#5E7E35'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(94,126,53,0.15)'; }}
              onBlur={e => { e.currentTarget.style.borderColor = errors.caregiverPhone ? 'rgba(255,59,48,0.45)' : 'rgba(0,0,0,0.09)'; e.currentTarget.style.boxShadow = 'none'; }}
            />
            <AnimatePresence>
              {errors.caregiverPhone && (
                <motion.p key="err-cp"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2 }} style={{ ...errorStyle, margin: 0 }}
                >
                  <span>⚠️</span> {errors.caregiverPhone}
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Save button */}
        <motion.button
          onClick={handleSave}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 300, damping: 22 }}
          style={{
            marginTop: '32px',
            width: '100%',
            background: 'linear-gradient(145deg, #5E7E35, #4F6C2D)',
            color: '#fff',
            border: 'none',
            borderRadius: '16px',
            padding: '17px',
            fontSize: '1.08rem',
            fontWeight: 700,
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            cursor: 'pointer',
            boxShadow: '0 8px 28px rgba(94,126,53,0.38)',
            letterSpacing: '0.01em',
          }}
        >
          حفظ وبدء الاستخدام
        </motion.button>

        {/* Success overlay */}
        <AnimatePresence>
          {saved && (
            <motion.div
              key="success"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              style={{
                position: 'absolute', inset: 0,
                background: 'rgba(255,255,255,0.92)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                borderRadius: '28px',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: '18px',
              }}
            >
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.45, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  width: '72px', height: '72px', borderRadius: '50%',
                  background: 'linear-gradient(145deg, #30D158, #25A244)',
                  boxShadow: '0 12px 36px rgba(48,209,88,0.42)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '2rem',
                }}
              >
                ✓
              </motion.div>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.38, delay: 0.25 }}
                style={{
                  margin: 0, fontSize: '1.12rem', fontWeight: 700, color: '#1C1C1E',
                  fontFamily: "'IBM Plex Sans Arabic', sans-serif",
                }}
              >
                ✅ تم حفظ البيانات بنجاح
              </motion.p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// ── Profile gate ──────────────────────────────────────────────────────────────
function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<ProfileData | null>(loadProfile);
  const [showWelcome, setShowWelcome] = useState(true);

  const handleSave = (data: ProfileData) => {
    saveProfile(data);
    setProfile(data);
  };

  if (!profile) {
    return (
      <AnimatePresence mode="wait">
        {showWelcome ? (
          <WelcomeScreen key="welcome" onStart={() => setShowWelcome(false)} />
        ) : (
          <motion.div
            key="onboarding"
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
          >
            <OnboardingPage onComplete={handleSave} />
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <ProfileContext.Provider value={profile}>
      <ProfileUpdateContext.Provider value={handleSave}>
        {children}
      </ProfileUpdateContext.Provider>
    </ProfileContext.Provider>
  );
}

// ── Patient-side completion notification ──────────────────────────────────────
const PATIENT_NOTIFY_CHANNEL = 'sameyba_patient_notify';

function PatientConfirmationOverlay() {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(PATIENT_NOTIFY_CHANNEL);
      bc.onmessage = (e: MessageEvent) => {
        if (e.data?.type === 'caregiver_completed') {
          setVisible(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setVisible(false), 4500);
        }
      };
    } catch { /* BroadcastChannel not supported */ }
    return () => { bc?.close(); };
  }, []);

  return createPortal(
    <AnimatePresence>
      {visible && (
        <motion.div
          key="patient-confirm"
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          style={{
            position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
            zIndex: 99999,
            display: 'flex', alignItems: 'center', gap: '10px',
            padding: '14px 28px', borderRadius: '999px',
            background: 'linear-gradient(135deg, rgba(52,199,89,0.15) 0%, rgba(255,255,255,0.96) 100%)',
            backdropFilter: 'blur(28px)',
            WebkitBackdropFilter: 'blur(28px)',
            border: '1.5px solid rgba(52,199,89,0.42)',
            boxShadow: '0 8px 36px rgba(52,199,89,0.22), 0 2px 12px rgba(0,0,0,0.08)',
            whiteSpace: 'nowrap' as const,
            direction: 'rtl',
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
          }}
        >
          <motion.span
            initial={{ scale: 0.5 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            style={{ fontSize: '1.2rem' }}
          >
            ✅
          </motion.span>
          <span style={{ fontWeight: 700, fontSize: '0.96rem', color: '#1A6E34' }}>
            تم استلام طلبك وسيتم تنفيذه
          </span>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ── Router ────────────────────────────────────────────────────────────────────
function App() {
  return (
    <GazeProvider>
    <QueryClientProvider client={queryClient}>
      <ProfileProvider>
        <RequestStoreProvider>
          <CaregiverNotificationProvider>
          {/* Patient-side confirmation overlay — listens for caregiver completions */}
          <PatientConfirmationOverlay />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/settings" component={SettingsPage} />
              <Route path="/communicate" component={CommunicationScreen} />
              <Route path="/communicate/:categoryId" component={CategoryPage} />
              <Route path="/dashboard" component={CaregiverDashboard} />
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
          </CaregiverNotificationProvider>
        </RequestStoreProvider>
      </ProfileProvider>
    </QueryClientProvider>
    </GazeProvider>
  );
}

export default App;
