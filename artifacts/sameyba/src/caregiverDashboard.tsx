/**
 * caregiverDashboard.tsx — Premium Healthcare Dashboard
 *
 * Sameybah brand-aligned, Apple-inspired Arabic RTL dashboard.
 * ALL existing audio / notification / sync logic is preserved verbatim.
 * Only the visual layer has been redesigned.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'wouter';
import { ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';

import { useRequestStore, useProfile, type PatientRequest } from './App';
import { useCaregiverNotification } from './caregiverNotification';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const PATIENT_NOTIFY_CHANNEL = 'sameyba_patient_notify';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers  (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
function formatRelativeTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 10)  return 'الآن';
  if (s < 60)  return `قبل ${s} ثانية`;
  const m = Math.floor(s / 60);
  if (m === 1) return 'قبل دقيقة';
  if (m === 2) return 'قبل دقيقتين';
  if (m < 11)  return `قبل ${m} دقائق`;
  if (m < 60)  return `قبل ${m} دقيقة`;
  const h = Math.floor(m / 60);
  if (h === 1) return 'قبل ساعة';
  if (h === 2) return 'قبل ساعتين';
  return `قبل ${h} ساعات`;
}

function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' });
}

function todayStart(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// ─────────────────────────────────────────────────────────────────────────────
// AmbientBg  (blue blob removed → olive / gold)
// ─────────────────────────────────────────────────────────────────────────────
function AmbientBg() {
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
      <div style={{ position: 'absolute', top: '-12%', right: '-8%',  width: '55vw', height: '55vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(201,168,76,0.14) 0%, transparent 68%)',  filter: 'blur(72px)' }} />
      <div style={{ position: 'absolute', bottom: '-16%', left: '-6%', width: '50vw', height: '50vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(94,126,53,0.12) 0%, transparent 68%)',  filter: 'blur(80px)' }} />
      <div style={{ position: 'absolute', top: '35%',   left: '30%',  width: '40vw', height: '40vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(123,160,67,0.08) 0%, transparent 70%)', filter: 'blur(88px)' }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EmptyState
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      style={{
        display: 'flex', flexDirection: 'column' as const,
        alignItems: 'center', justifyContent: 'center',
        gap: '16px', padding: '56px 32px',
        background: 'rgba(255,255,255,0.68)',
        backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
        borderRadius: '24px',
        border: '1.5px solid rgba(232,226,213,0.9)',
        boxShadow: '0 2px 24px rgba(0,0,0,0.04)',
        textAlign: 'center' as const,
      }}
    >
      {/* Subtle SVG illustration */}
      <svg width="72" height="72" viewBox="0 0 72 72" fill="none" aria-hidden>
        <circle cx="36" cy="36" r="36" fill="rgba(94,126,53,0.07)" />
        <circle cx="36" cy="36" r="26" fill="rgba(94,126,53,0.08)" />
        <path d="M24 36h24M36 24v24" stroke="#7BA043" strokeWidth="2.5" strokeLinecap="round" opacity="0.45" />
        <circle cx="36" cy="36" r="6" fill="rgba(94,126,53,0.18)" />
        <circle cx="36" cy="36" r="2.5" fill="#7BA043" opacity="0.6" />
      </svg>
      <div>
        <p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: '#3A3A3C' }}>لا توجد طلبات حالياً</p>
        <p style={{ margin: '6px 0 0', fontSize: '0.83rem', color: '#AEAEB2', lineHeight: 1.5 }}>
          ستظهر طلبات المريض هنا فور إرسالها
        </p>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SummaryCard
// ─────────────────────────────────────────────────────────────────────────────
function SummaryCard({
  icon, label, value, accent, bg, delay = 0,
}: {
  icon: string; label: string; value: string | number;
  accent: string; bg: string; delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, delay, ease: [0.22, 1, 0.36, 1] }}
      style={{
        flex: 1, minWidth: 0,
        background: 'rgba(255,255,255,0.88)',
        backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
        borderRadius: '20px',
        border: '1.5px solid rgba(232,226,213,0.85)',
        boxShadow: '0 2px 18px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,1)',
        padding: '18px 16px 16px',
        display: 'flex', flexDirection: 'column' as const, gap: '10px',
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: '12px',
        background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.25rem',
      }}>
        {icon}
      </div>
      <div>
        <p style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: accent, lineHeight: 1 }}>{value}</p>
        <p style={{ margin: '4px 0 0', fontSize: '0.73rem', fontWeight: 600, color: '#8E8E93', letterSpacing: '0.01em' }}>{label}</p>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SectionHeader  (unchanged logic, refined style)
// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({
  emoji, title, count, color, flash,
}: { emoji: string; title: string; count: number; color: string; flash?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
      <span style={{ fontSize: '1rem' }}>{emoji}</span>
      <h2 style={{ fontWeight: 700, fontSize: '0.97rem', color: '#1C1C1E', margin: 0, letterSpacing: '-0.01em' }}>{title}</h2>
      <AnimatePresence>
        {count > 0 && (
          <motion.span
            key="badge"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={flash
              ? { scale: [1, 1.28, 1, 1.28, 1], opacity: 1, backgroundColor: [color, '#FF6900', color, '#FF6900', color] }
              : { scale: 1, opacity: 1, backgroundColor: color }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={flash ? { duration: 1.6 } : { duration: 0.22 }}
            style={{
              borderRadius: '999px', padding: '2px 9px',
              fontSize: '0.72rem', fontWeight: 700, color: '#fff',
              display: 'inline-block',
            }}
          >
            {count}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RequestCard  (same logic, premium redesign)
// ─────────────────────────────────────────────────────────────────────────────
function RequestCard({
  req, onComplete, onReject, isNew = false,
}: {
  req:        PatientRequest;
  onComplete: (id: string) => void;
  onReject:   (id: string) => void;
  isNew?:     boolean;
}) {
  const urgent = req.priority === 'urgent';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
      transition={{ duration: 0.30, ease: [0.22, 1, 0.36, 1] }}
      style={{
        background: urgent
          ? 'linear-gradient(135deg, #fff 0%, rgba(255,248,248,0.98) 100%)'
          : 'rgba(255,255,255,0.90)',
        backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
        borderRadius: '22px',
        border: urgent
          ? '1.5px solid rgba(255,59,48,0.30)'
          : '1.5px solid rgba(232,226,213,0.85)',
        boxShadow: urgent
          ? '0 6px 32px rgba(255,59,48,0.10), 0 1px 6px rgba(0,0,0,0.04)'
          : '0 3px 24px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,1)',
        padding: '20px',
        display: 'flex', flexDirection: 'column' as const, gap: '14px',
        position: 'relative' as const,
        overflow: 'hidden' as const,
      }}
    >
      {/* Pulse ring for NEW emergency requests */}
      {urgent && isNew && (
        <motion.div
          animate={{ opacity: [0.5, 0.08, 0.5], scale: [1, 1.02, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute', inset: 0, borderRadius: 'inherit',
            border: '2.5px solid rgba(255,59,48,0.55)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Accent stripe */}
      <div style={{
        position: 'absolute', top: 0, right: 0,
        width: 4, height: '100%', borderRadius: '0 22px 22px 0',
        background: urgent
          ? 'linear-gradient(180deg, #FF3B30 0%, rgba(255,59,48,0.4) 100%)'
          : 'linear-gradient(180deg, #5E7E35 0%, rgba(94,126,53,0.3) 100%)',
      }} />

      {/* Top row: priority + time */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' as const }}>
          <span style={{
            background: urgent ? 'rgba(255,59,48,0.10)' : 'rgba(94,126,53,0.09)',
            color: urgent ? '#FF3B30' : '#5E7E35',
            borderRadius: '999px', padding: '3px 11px',
            fontSize: '0.71rem', fontWeight: 700,
            border: urgent ? '1px solid rgba(255,59,48,0.18)' : '1px solid rgba(94,126,53,0.16)',
          }}>
            {urgent ? '🚨 عاجل' : '⏳ معلّق'}
          </span>
          <span style={{
            background: 'rgba(142,142,147,0.09)', color: '#6E6E73',
            borderRadius: '999px', padding: '3px 10px',
            fontSize: '0.71rem', fontWeight: 600,
            border: '1px solid rgba(142,142,147,0.14)',
          }}>
            {req.categoryLabel}
          </span>
        </div>
        <span style={{ color: '#AEAEB2', fontSize: '0.73rem', whiteSpace: 'nowrap' as const, flexShrink: 0, fontFeatureSettings: '"tnum"' }}>
          🕒 {formatRelativeTime(req.createdAt)}
        </span>
      </div>

      {/* Patient row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: urgent
            ? 'linear-gradient(135deg, rgba(255,59,48,0.14) 0%, rgba(255,59,48,0.06) 100%)'
            : 'linear-gradient(135deg, rgba(94,126,53,0.14) 0%, rgba(94,126,53,0.06) 100%)',
          border: urgent ? '1.5px solid rgba(255,59,48,0.22)' : '1.5px solid rgba(94,126,53,0.20)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1rem',
        }}>
          👤
        </div>
        <div>
          <p style={{ fontWeight: 700, fontSize: '0.93rem', color: '#1C1C1E', margin: 0 }}>{req.patientName}</p>
          <p style={{ color: '#AEAEB2', fontSize: '0.73rem', margin: '1px 0 0' }}>{formatClockTime(req.createdAt)}</p>
        </div>
      </div>

      {/* Request bubble */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '14px 16px', borderRadius: '16px',
        background: urgent
          ? 'linear-gradient(135deg, rgba(255,59,48,0.06) 0%, rgba(255,59,48,0.03) 100%)'
          : 'linear-gradient(135deg, rgba(94,126,53,0.07) 0%, rgba(94,126,53,0.03) 100%)',
        border: urgent ? '1px solid rgba(255,59,48,0.12)' : '1px solid rgba(94,126,53,0.10)',
      }}>
        <span style={{ fontSize: '1.6rem', lineHeight: 1, flexShrink: 0 }}>{req.requestEmoji}</span>
        <span style={{ fontWeight: 700, color: urgent ? '#FF3B30' : '#3A5C1E', fontSize: '0.96rem', lineHeight: 1.4 }}>
          {req.requestText}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <motion.button
          whileHover={{ scale: 1.03, boxShadow: '0 8px 24px rgba(52,199,89,0.40)' }}
          whileTap={{ scale: 0.96 }}
          onClick={() => onComplete(req.id)}
          style={{
            flex: 1, padding: '13px 8px', borderRadius: '14px',
            background: 'linear-gradient(135deg, #3DBF6E 0%, #2BAF5A 100%)',
            color: '#fff', fontWeight: 700, fontSize: '0.9rem',
            border: 'none', cursor: 'pointer',
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            boxShadow: '0 4px 18px rgba(52,199,89,0.30)',
            letterSpacing: '0.01em',
          }}
        >
          ✅ تم التنفيذ
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.03, background: 'rgba(255,59,48,0.12)' }}
          whileTap={{ scale: 0.96 }}
          onClick={() => onReject(req.id)}
          style={{
            flex: 1, padding: '13px 8px', borderRadius: '14px',
            background: 'rgba(255,59,48,0.07)',
            color: '#FF3B30', fontWeight: 700, fontSize: '0.9rem',
            border: '1.5px solid rgba(255,59,48,0.20)', cursor: 'pointer',
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            transition: 'background 0.15s',
          }}
        >
          ❌ رفض
        </motion.button>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HistoryCard  (unchanged logic, refined)
// ─────────────────────────────────────────────────────────────────────────────
function HistoryCard({ req }: { req: PatientRequest }) {
  const done      = req.status === 'done';
  const actionISO = done ? req.completedAt : req.rejectedAt;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.16 } }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      style={{
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderRadius: '16px',
        border: done ? '1.5px solid rgba(52,199,89,0.18)' : '1.5px solid rgba(255,59,48,0.14)',
        boxShadow: '0 1px 10px rgba(0,0,0,0.04)',
        padding: '13px 16px',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}
    >
      <div style={{
        width: 34, height: 34, borderRadius: '10px', flexShrink: 0,
        background: done ? 'rgba(52,199,89,0.10)' : 'rgba(255,59,48,0.08)',
        border: done ? '1.5px solid rgba(52,199,89,0.20)' : '1.5px solid rgba(255,59,48,0.16)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.95rem',
      }}>
        {done ? '✅' : '❌'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' as const }}>
          <p style={{ fontWeight: 700, fontSize: '0.86rem', color: '#1C1C1E', margin: 0 }}>{req.patientName}</p>
          <span style={{
            fontSize: '0.68rem', fontWeight: 700,
            color: done ? '#34C759' : '#FF3B30',
            background: done ? 'rgba(52,199,89,0.09)' : 'rgba(255,59,48,0.09)',
            borderRadius: '999px', padding: '1px 7px',
          }}>
            {done ? 'تم التنفيذ' : 'مرفوض'}
          </span>
        </div>
        <p style={{ color: '#6E6E73', fontSize: '0.78rem', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
          {req.requestEmoji} {req.requestText}
        </p>
        <p style={{ color: '#AEAEB2', fontSize: '0.71rem', margin: '2px 0 0' }}>
          طُلب {formatRelativeTime(req.createdAt)}
          {actionISO && ` · ${done ? 'نُفِّذ' : 'رُفض'} ${formatRelativeTime(actionISO)}`}
        </p>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CollapsibleSection  (new — wraps done/rejected)
// ─────────────────────────────────────────────────────────────────────────────
function CollapsibleSection({
  emoji, title, count, color, children, defaultOpen = false,
}: {
  emoji: string; title: string; count: number;
  color: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (count === 0) return null;

  return (
    <section>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          width: '100%', background: 'none', border: 'none',
          cursor: 'pointer', padding: '0 0 12px',
          fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        }}
      >
        <span style={{ fontSize: '1rem' }}>{emoji}</span>
        <span style={{ fontWeight: 700, fontSize: '0.97rem', color: '#1C1C1E', flex: 1, textAlign: 'right' as const }}>{title}</span>
        <span style={{
          background: color, color: '#fff',
          borderRadius: '999px', padding: '2px 9px',
          fontSize: '0.72rem', fontWeight: 700,
        }}>
          {count}
        </span>
        <span style={{ color: '#AEAEB2', display: 'flex', alignItems: 'center' }}>
          {open ? <ChevronUp size={16} strokeWidth={2} /> : <ChevronDown size={16} strokeWidth={2} />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.30, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '9px', paddingBottom: '4px' }}>
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ActivityTimeline  (unchanged logic, refined style)
// ─────────────────────────────────────────────────────────────────────────────
function ActivityTimeline({ requests }: { requests: PatientRequest[] }) {
  const sorted = [...requests]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);

  if (sorted.length === 0) {
    return (
      <div style={{
        padding: '28px 20px', textAlign: 'center' as const,
        color: '#AEAEB2', fontSize: '0.85rem',
        background: 'rgba(255,255,255,0.55)',
        borderRadius: '18px', border: '1.5px solid rgba(232,226,213,0.8)',
      }}>
        لا يوجد نشاط بعد
      </div>
    );
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.80)',
      backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
      borderRadius: '20px',
      border: '1.5px solid rgba(232,226,213,0.85)',
      boxShadow: '0 2px 18px rgba(0,0,0,0.05)',
      padding: '18px 20px',
      display: 'flex', flexDirection: 'column' as const, gap: 0,
    }}>
      {sorted.map((req, i) => {
        const dotColor = req.status === 'done'
          ? '#34C759'
          : req.status === 'rejected'
          ? '#FF3B30'
          : req.priority === 'urgent'
          ? '#FF3B30'
          : '#5E7E35';

        return (
          <motion.div
            key={req.id}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
            style={{
              display: 'flex', gap: '12px', alignItems: 'stretch',
              paddingBottom: i < sorted.length - 1 ? '14px' : 0,
            }}
          >
            {/* Dot + line */}
            <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', width: 14, flexShrink: 0 }}>
              <div style={{
                width: 9, height: 9, borderRadius: '50%',
                background: dotColor, flexShrink: 0, marginTop: '5px',
                boxShadow: `0 0 0 2px rgba(255,255,255,1), 0 0 0 3.5px ${dotColor}40`,
              }} />
              {i < sorted.length - 1 && (
                <div style={{ flex: 1, width: 1.5, background: 'rgba(232,226,213,0.9)', marginTop: '4px' }} />
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '0.86rem', fontWeight: 600, color: '#1C1C1E' }}>
                    {req.requestEmoji} {req.requestText}
                  </span>
                  <p style={{ margin: '2px 0 0', fontSize: '0.73rem', color: '#8E8E93' }}>
                    {req.patientName} · {req.categoryLabel}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '3px', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.70rem', color: '#AEAEB2', whiteSpace: 'nowrap' as const }}>
                    {formatClockTime(req.createdAt)}
                  </span>
                  <span style={{
                    fontSize: '0.66rem', fontWeight: 700,
                    color: req.status === 'done' ? '#34C759' : req.status === 'rejected' ? '#FF3B30' : dotColor,
                    background: req.status === 'done'
                      ? 'rgba(52,199,89,0.09)'
                      : req.status === 'rejected'
                      ? 'rgba(255,59,48,0.09)'
                      : 'rgba(94,126,53,0.09)',
                    borderRadius: '999px', padding: '1px 6px',
                  }}>
                    {req.status === 'done' ? 'منجز' : req.status === 'rejected' ? 'مرفوض' : req.priority === 'urgent' ? 'عاجل' : 'معلّق'}
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CaregiverDashboard  — main export
// ALL state, effects, and logic are preserved exactly.
// ─────────────────────────────────────────────────────────────────────────────
export function CaregiverDashboard() {
  const [, navigate]   = useLocation();
  const { requests, completeRequest, rejectRequest } = useRequestStore();
  const profile        = useProfile();
  const [toastVisible, setToastVisible]     = useState(false);
  const [toastText,    setToastText]        = useState('تم تنفيذ الطلب');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setTick]    = useState(0);

  // ── Audio / notifications — owned by CaregiverNotificationProvider ─────────
  const {
    audioSessionReady,
    audioJustActivated,
    audioActivating,
    audioError,
    handleActivateAudio,
    notifPermission,
    handleRequestNotifPermission,
    audioDebug,
  } = useCaregiverNotification();

  // ── Badge flash ────────────────────────────────────────────────────────────
  const [badgeFlash, setBadgeFlash] = useState(false);
  const flashTimer       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const badgeNotifiedIds = useRef<Set<string>>(new Set(requests.map(r => r.id)));
  const seenAtMount      = useRef<Set<string>>(new Set(requests.map(r => r.id)));

  useEffect(() => {
    const prev = document.title;
    document.title = 'سَم يبه — لوحة مقدم الرعاية';
    return () => { document.title = prev; };
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) {
        document.title = 'سَم يبه — لوحة مقدم الرعاية';
        if (flashTimer.current) clearTimeout(flashTimer.current);
        setBadgeFlash(false);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  useEffect(() => {
    const fresh = requests.filter(
      r => r.status === 'pending' && !badgeNotifiedIds.current.has(r.id),
    );
    if (fresh.length === 0) return;
    fresh.forEach(req => { badgeNotifiedIds.current.add(req.id); });
    if (document.hidden) document.title = '🔔 طلب جديد';
    setBadgeFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setBadgeFlash(false), 4000);
  }, [requests]);

  useEffect(() => {
    const iv = setInterval(() => setTick(n => n + 1), 10_000);
    return () => clearInterval(iv);
  }, []);

  // ── Derived lists  (unchanged) ─────────────────────────────────────────────
  const allPending = [...requests.filter(r => r.status === 'pending')].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'urgent' ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  const emergency = allPending.filter(r => r.priority === 'urgent');
  const pending   = allPending.filter(r => r.priority !== 'urgent');
  const done      = [...requests.filter(r => r.status === 'done')]
    .sort((a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime());
  const rejected  = [...requests.filter(r => r.status === 'rejected')]
    .sort((a, b) => new Date(b.rejectedAt!).getTime() - new Date(a.rejectedAt!).getTime());

  const newCount  = allPending.filter(r => !seenAtMount.current.has(r.id)).length;

  // New emergency IDs (arrived after mount) — gets pulse animation
  const newEmergencyIds = new Set(
    emergency.filter(r => !seenAtMount.current.has(r.id)).map(r => r.id)
  );

  // ── Stats ──────────────────────────────────────────────────────────────────
  const ts      = todayStart();
  const todayAll = requests.filter(r => new Date(r.createdAt).getTime() >= ts);

  // Online status: patient is "online" if last activity within 30 min
  const lastActivity = [...requests].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];
  const isOnline = lastActivity
    ? (Date.now() - new Date(lastActivity.createdAt).getTime()) < 30 * 60 * 1000
    : false;

  // ── Actions  (unchanged) ───────────────────────────────────────────────────
  const handleComplete = useCallback((id: string) => {
    completeRequest(id);
    try {
      const bc = new BroadcastChannel(PATIENT_NOTIFY_CHANNEL);
      bc.postMessage({ type: 'caregiver_completed' });
      bc.close();
    } catch { /* BroadcastChannel not available */ }
    setToastText('تم تنفيذ الطلب ✅');
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastVisible(true);
    toastTimer.current = setTimeout(() => setToastVisible(false), 2800);
  }, [completeRequest]);

  const handleReject = useCallback((id: string) => {
    rejectRequest(id);
  }, [rejectRequest]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      dir="rtl"
      style={{
        minHeight: '100dvh',
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        background: 'linear-gradient(160deg, #FAFAF5 0%, #F5F2EC 50%, #F0EDE5 100%)',
        position: 'relative',
      }}
    >
      <AmbientBg />

      {/* ── Debug strip ──────────────────────────────────────────────────── */}
      <div style={{
        position: 'relative', zIndex: 20,
        display: 'flex', gap: '18px', padding: '4px 20px',
        background: 'rgba(0,0,0,0.025)', borderBottom: '1px solid rgba(232,226,213,0.7)',
        fontSize: '0.67rem', fontFamily: 'monospace', color: '#8E8E93',
        direction: 'ltr', flexWrap: 'wrap',
        overflowX: 'auto',
      }}>
        <span>Provider: <strong style={{ color: audioDebug.providerMounted ? '#34C759' : '#FF3B30' }}>{audioDebug.providerMounted ? 'mounted' : 'unmounted'}</strong></span>
        <span>AudioContext: <strong>{audioDebug.ctxState}</strong></span>
        <span>Session Ready: <strong style={{ color: audioDebug.sessionReady ? '#34C759' : '#FF3B30' }}>{audioDebug.sessionReady ? 'true' : 'false'}</strong></span>
        <span>Queue: <strong>{audioDebug.pendingQueueIds.length > 0 ? audioDebug.pendingQueueIds.join(', ') : '—'}</strong></span>
        <span>Last Played: <strong>{audioDebug.lastPlayedId}</strong></span>
        <span>Last Error: <strong>{audioDebug.lastAudioError}</strong></span>
      </div>

      {/* ── Audio activation banner ───────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {audioJustActivated ? (
          <motion.div
            key="audio-success"
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.28 }}
            style={{
              position: 'relative', zIndex: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '8px', padding: '11px 24px',
              background: 'linear-gradient(135deg, rgba(52,199,89,0.12) 0%, rgba(52,199,89,0.06) 100%)',
              borderBottom: '1px solid rgba(52,199,89,0.25)',
            }}
          >
            <span>✅</span>
            <span style={{ fontWeight: 600, fontSize: '0.90rem', color: '#1A6E34' }}>تم تفعيل صوت التنبيهات</span>
          </motion.div>
        ) : !audioSessionReady ? (
          <motion.div
            key="audio-banner"
            initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'relative', zIndex: 20,
              display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 20px',
              background: 'linear-gradient(135deg, rgba(255,159,10,0.16) 0%, rgba(255,204,0,0.10) 100%)',
              backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
              borderBottom: '1px solid rgba(255,159,10,0.22)',
              flexWrap: 'wrap',
            }}
          >
            <motion.span
              animate={{ scale: [1, 1.18, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              style={{ fontSize: '1.05rem', flexShrink: 0 }}
            >
              🔊
            </motion.span>
            <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#92600A', flexShrink: 0 }}>
              يلزم تفعيل الصوت في كل جلسة
            </span>
            {audioError && (
              <span style={{ fontSize: '0.76rem', color: '#C0392B', fontWeight: 500 }}>{audioError}</span>
            )}
            <button
              onClick={handleActivateAudio}
              disabled={audioActivating}
              style={{
                marginRight: 'auto',
                padding: '7px 16px', borderRadius: '999px',
                background: audioActivating ? 'rgba(146,96,10,0.12)' : '#C9A84C',
                color: audioActivating ? '#92600A' : '#fff',
                border: 'none', cursor: audioActivating ? 'default' : 'pointer',
                fontWeight: 700, fontSize: '0.82rem',
                fontFamily: "'IBM Plex Sans Arabic', sans-serif",
                transition: 'background 0.18s', flexShrink: 0,
              }}
            >
              {audioActivating ? 'جارٍ التفعيل…' : '🔊 تفعيل واختبار الصوت'}
            </button>
            {notifPermission === 'default' && (
              <button
                onClick={handleRequestNotifPermission}
                style={{
                  padding: '7px 14px', borderRadius: '999px',
                  background: 'rgba(94,126,53,0.10)', color: '#5E7E35',
                  border: '1px solid rgba(94,126,53,0.22)',
                  cursor: 'pointer', fontWeight: 600, fontSize: '0.78rem',
                  fontFamily: "'IBM Plex Sans Arabic', sans-serif", flexShrink: 0,
                }}
              >
                🔔 تفعيل الإشعارات
              </button>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ════════════════════════════════════════════════════════════════════
          HEADER
          ════════════════════════════════════════════════════════════════ */}
      <div style={{
        position: 'relative', zIndex: 10,
        maxWidth: '1200px', width: '100%', margin: '0 auto',
        padding: '24px 20px 0',
      }}>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          style={{
            background: 'rgba(255,255,255,0.90)',
            backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)',
            borderRadius: '24px',
            border: '1.5px solid rgba(232,226,213,0.9)',
            boxShadow: '0 4px 32px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,1)',
            padding: '20px 22px',
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', gap: '16px',
            flexWrap: 'wrap' as const,
          }}
        >
          {/* Left: avatar + info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1, minWidth: 0 }}>
            {/* Avatar with green ring */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <div style={{
                width: 60, height: 60, borderRadius: '50%',
                background: 'linear-gradient(135deg, #5E7E35 0%, #7BA043 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.75rem',
                boxShadow: '0 4px 18px rgba(94,126,53,0.30)',
                border: '3px solid rgba(255,255,255,0.95)',
                outline: '2.5px solid rgba(94,126,53,0.22)',
              }}>
                👤
              </div>
              {/* Online dot */}
              <motion.div
                animate={isOnline ? { scale: [1, 1.3, 1], opacity: [1, 0.6, 1] } : {}}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                style={{
                  position: 'absolute', bottom: 2, left: 2,
                  width: 13, height: 13, borderRadius: '50%',
                  background: isOnline ? '#34C759' : '#C7C7CC',
                  border: '2px solid #fff',
                  boxShadow: isOnline ? '0 0 0 2px rgba(52,199,89,0.25)' : 'none',
                }}
              />
            </div>

            {/* Patient name + status */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const }}>
                <h1 style={{ margin: 0, fontSize: 'clamp(1.05rem, 2.5vw, 1.35rem)', fontWeight: 800, color: '#1C1C1E', letterSpacing: '-0.02em' }}>
                  {profile.patientName}
                </h1>
                {/* Online/offline label */}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  background: isOnline ? 'rgba(52,199,89,0.10)' : 'rgba(174,174,178,0.12)',
                  color: isOnline ? '#1E8E3E' : '#8E8E93',
                  borderRadius: '999px', padding: '3px 10px',
                  fontSize: '0.72rem', fontWeight: 700,
                  border: isOnline ? '1px solid rgba(52,199,89,0.22)' : '1px solid rgba(174,174,178,0.22)',
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: isOnline ? '#34C759' : '#C7C7CC',
                    display: 'inline-block',
                  }} />
                  {isOnline ? 'متصل الآن' : 'غير متصل'}
                </span>
                {/* New requests badge */}
                <AnimatePresence>
                  {newCount > 0 && (
                    <motion.span
                      key="new-badge"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      style={{
                        background: '#FF3B30', color: '#fff',
                        borderRadius: '999px', padding: '2px 8px',
                        fontSize: '0.68rem', fontWeight: 800,
                        boxShadow: '0 2px 10px rgba(255,59,48,0.35)',
                      }}
                    >
                      {newCount} جديد
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginTop: '5px', flexWrap: 'wrap' as const }}>
                <span style={{ fontSize: '0.78rem', color: '#8E8E93' }}>
                  مقدم الرعاية: <strong style={{ color: '#3C3C43' }}>{profile.caregiverName}</strong>
                </span>
                {lastActivity && (
                  <span style={{ fontSize: '0.76rem', color: '#AEAEB2' }}>
                    آخر نشاط: {formatRelativeTime(lastActivity.createdAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: back button */}
          <motion.button
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => navigate('/')}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '10px 18px', borderRadius: '999px',
              background: 'rgba(94,126,53,0.08)',
              border: '1.5px solid rgba(94,126,53,0.18)',
              boxShadow: '0 2px 10px rgba(94,126,53,0.08)',
              cursor: 'pointer', color: '#4A6629', fontWeight: 700,
              fontSize: '0.86rem', fontFamily: "'IBM Plex Sans Arabic', sans-serif",
              flexShrink: 0,
            }}
          >
            الرئيسية <ChevronRight size={14} strokeWidth={2.5} />
          </motion.button>
        </motion.div>

        {/* ════════════════════════════════════════════════════════════════
            SUMMARY CARDS
            ════════════════════════════════════════════════════════════ */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px',
          marginTop: '16px',
        }}
          className="summary-grid"
        >
          <SummaryCard
            icon="📨" label="الطلبات اليوم"
            value={todayAll.length}
            accent="#5E7E35" bg="rgba(94,126,53,0.09)"
            delay={0.05}
          />
          <SummaryCard
            icon="⏳" label="الطلبات المعلقة"
            value={pending.length}
            accent="#C9A84C" bg="rgba(201,168,76,0.10)"
            delay={0.10}
          />
          <SummaryCard
            icon="🚨" label="طلبات الطوارئ"
            value={emergency.length}
            accent={emergency.length > 0 ? '#FF3B30' : '#8E8E93'}
            bg={emergency.length > 0 ? 'rgba(255,59,48,0.08)' : 'rgba(142,142,147,0.08)'}
            delay={0.15}
          />
          <SummaryCard
            icon="✅" label="الطلبات المنجزة"
            value={done.length}
            accent="#34C759" bg="rgba(52,199,89,0.09)"
            delay={0.20}
          />
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          MAIN CONTENT
          ════════════════════════════════════════════════════════════════ */}
      <div
        style={{
          position: 'relative', zIndex: 10,
          maxWidth: '1200px', width: '100%', margin: '0 auto',
          padding: '20px 20px 80px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)',
          gap: '20px',
          alignItems: 'start',
        }}
        className="dashboard-grid"
      >
        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '28px' }}>

          {/* ── EMERGENCY ────────────────────────────────────────────────── */}
          <AnimatePresence>
            {emergency.length > 0 && (
              <motion.section
                key="emergency"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.32 }}
              >
                {/* Emergency zone container */}
                <div style={{
                  background: 'linear-gradient(135deg, rgba(255,59,48,0.06) 0%, rgba(255,255,255,0.95) 100%)',
                  border: '1.5px solid rgba(255,59,48,0.22)',
                  borderRadius: '24px',
                  padding: '18px 18px 14px',
                  boxShadow: '0 4px 28px rgba(255,59,48,0.08)',
                }}>
                  <SectionHeader emoji="🚨" title="طلبات طارئة" count={emergency.length} color="#FF3B30" flash={badgeFlash} />
                  <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '14px' }}>
                    <AnimatePresence mode="popLayout">
                      {emergency.map(req => (
                        <RequestCard
                          key={req.id}
                          req={req}
                          onComplete={handleComplete}
                          onReject={handleReject}
                          isNew={newEmergencyIds.has(req.id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* ── PENDING ───────────────────────────────────────────────────── */}
          <section>
            <SectionHeader
              emoji="⏳"
              title="الطلبات المعلقة"
              count={pending.length}
              color="#5E7E35"
              flash={badgeFlash && emergency.length === 0}
            />
            <AnimatePresence mode="popLayout">
              {allPending.length === 0 ? (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <EmptyState />
                </motion.div>
              ) : pending.length === 0 ? null : (
                <div style={{ display: 'flex', flexDirection: 'column' as const, gap: '14px' }}>
                  <AnimatePresence mode="popLayout">
                    {pending.map(req => (
                      <RequestCard
                        key={req.id}
                        req={req}
                        onComplete={handleComplete}
                        onReject={handleReject}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </AnimatePresence>
          </section>

          {/* ── COMPLETED (collapsible, collapsed by default) ─────────────── */}
          <CollapsibleSection
            emoji="✅"
            title="الطلبات المنجزة"
            count={done.length}
            color="#34C759"
          >
            <AnimatePresence mode="popLayout">
              {done.map(req => <HistoryCard key={req.id} req={req} />)}
            </AnimatePresence>
          </CollapsibleSection>

          {/* ── REJECTED (collapsible, collapsed by default) ──────────────── */}
          <CollapsibleSection
            emoji="❌"
            title="الطلبات المرفوضة"
            count={rejected.length}
            color="#FF3B30"
          >
            <AnimatePresence mode="popLayout">
              {rejected.map(req => <HistoryCard key={req.id} req={req} />)}
            </AnimatePresence>
          </CollapsibleSection>

        </div>

        {/* ── Right column: Activity Timeline ─────────────────────────────── */}
        <div style={{ position: 'sticky', top: '20px' }}>
          <SectionHeader emoji="🕐" title="آخر النشاط" count={0} color="#7BA043" />
          <ActivityTimeline requests={requests} />
        </div>
      </div>

      {/* ── Completion toast ──────────────────────────────────────────────── */}
      <AnimatePresence>
        {toastVisible && (
          <motion.div
            key="done-toast"
            initial={{ opacity: 0, y: 48, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 48 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'fixed', bottom: '32px', left: '50%', transform: 'translateX(-50%)',
              zIndex: 200,
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '14px 28px', borderRadius: '999px',
              background: 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
              border: '1.5px solid rgba(52,199,89,0.35)',
              boxShadow: '0 8px 36px rgba(52,199,89,0.20), 0 2px 12px rgba(0,0,0,0.06)',
              whiteSpace: 'nowrap' as const,
              fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            }}
          >
            <span style={{ fontWeight: 700, color: '#1E8E3E', fontSize: '0.94rem' }}>{toastText}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Responsive grid styles ────────────────────────────────────────── */}
      <style>{`
        @media (max-width: 768px) {
          .dashboard-grid  { grid-template-columns: 1fr !important; }
          .summary-grid    { grid-template-columns: repeat(2, 1fr) !important; }
        }
        @media (max-width: 400px) {
          .summary-grid    { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
