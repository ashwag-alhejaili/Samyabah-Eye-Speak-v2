/**
 * caregiverDashboard.tsx — Redesigned Caregiver Monitoring Panel
 *
 * Apple-inspired Arabic RTL dashboard. All existing audio/notification logic
 * is preserved. New: stats bar, activity timeline, emergency/pending/done
 * sections, patient-side confirmation via BroadcastChannel.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'wouter';
import { ChevronRight } from 'lucide-react';

import { useRequestStore, useProfile, type PatientRequest } from './App';
import { useCaregiverNotification } from './caregiverNotification';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
// CAREGIVER_AUDIO_KEY lives in caregiverNotification.tsx
const PATIENT_NOTIFY_CHANNEL = 'sameyba_patient_notify';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
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
// AmbientBackground
// ─────────────────────────────────────────────────────────────────────────────
function AmbientBg() {
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
      <div style={{ position: 'absolute', top: '-15%', right: '-10%', width: '50vw', height: '50vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,220,140,0.22) 0%, transparent 68%)', filter: 'blur(60px)' }} />
      <div style={{ position: 'absolute', bottom: '-18%', left: '-8%',  width: '48vw', height: '48vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(190,200,255,0.18) 0%, transparent 68%)', filter: 'blur(68px)' }} />
      <div style={{ position: 'absolute', top: '30%',   left: '35%',   width: '38vw', height: '38vw', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,240,210,0.12) 0%, transparent 70%)', filter: 'blur(74px)' }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StatCard
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, accent }: { icon: string; label: string; value: string; accent: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      style={{
        flex: 1, minWidth: 0,
        background: 'rgba(255,255,255,0.78)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: '18px',
        border: '1.5px solid rgba(0,0,0,0.06)',
        boxShadow: '0 2px 16px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.9)',
        padding: '16px 18px',
        display: 'flex', flexDirection: 'column' as const, gap: '6px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
        <span style={{ fontSize: '1.1rem' }}>{icon}</span>
        <span style={{ fontSize: '0.73rem', fontWeight: 600, color: '#8E8E93', letterSpacing: '0.01em' }}>{label}</span>
      </div>
      <p style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: accent, lineHeight: 1.2 }}>
        {value}
      </p>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StatsBar
// ─────────────────────────────────────────────────────────────────────────────
function StatsBar({ requests }: { requests: PatientRequest[] }) {
  const ts = todayStart();
  const today = requests.filter(r => new Date(r.createdAt).getTime() >= ts);

  const lastReq = [...requests].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )[0];

  const catCounts: Record<string, { count: number; label: string }> = {};
  for (const r of today) {
    if (!catCounts[r.categoryId]) catCounts[r.categoryId] = { count: 0, label: r.categoryLabel };
    catCounts[r.categoryId].count++;
  }
  const topCat = Object.values(catCounts).sort((a, b) => b.count - a.count)[0];

  return (
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' as const }}>
      <StatCard icon="📊" label="طلبات اليوم"  value={`${today.length}`}                    accent="#0A84FF" />
      <StatCard icon="🕒" label="آخر نشاط"    value={lastReq ? formatRelativeTime(lastReq.createdAt) : 'لا يوجد'} accent="#5E5CE6" />
      <StatCard icon="🏆" label="الأكثر طلبًا" value={topCat?.label ?? 'لا يوجد'}             accent="#FF9500" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Section header
// ─────────────────────────────────────────────────────────────────────────────
function SectionHeader({
  emoji, title, count, color, flash,
}: { emoji: string; title: string; count: number; color: string; flash?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
      <span style={{ fontSize: '1.1rem' }}>{emoji}</span>
      <h2 style={{ fontWeight: 700, fontSize: '1rem', color: '#1C1C1E', margin: 0 }}>{title}</h2>
      <AnimatePresence>
        {count > 0 && (
          <motion.span
            key="badge"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={flash ? {
              scale: [1, 1.3, 1, 1.3, 1],
              opacity: 1,
              backgroundColor: [color, '#FF6900', color, '#FF6900', color],
            } : { scale: 1, opacity: 1, backgroundColor: color }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={flash ? { duration: 1.6 } : { duration: 0.22 }}
            style={{
              borderRadius: '999px', padding: '2px 10px',
              fontSize: '0.73rem', fontWeight: 700, color: '#fff',
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
// RequestCard — redesigned (emergency + normal pending)
// ─────────────────────────────────────────────────────────────────────────────
function RequestCard({
  req, onComplete, onReject, highlight,
}: {
  req:        PatientRequest;
  onComplete: (id: string) => void;
  onReject:   (id: string) => void;
  highlight?: boolean;
}) {
  const urgent = req.priority === 'urgent';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      style={{
        background: highlight
          ? 'linear-gradient(135deg, rgba(255,255,255,0.96) 0%, rgba(255,248,240,0.95) 100%)'
          : urgent
          ? 'linear-gradient(135deg, rgba(255,255,255,0.90) 0%, rgba(255,245,245,0.88) 100%)'
          : 'rgba(255,255,255,0.82)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderRadius: highlight ? '24px' : '20px',
        border: urgent
          ? '1.5px solid rgba(255,59,48,0.28)'
          : '1.5px solid rgba(0,0,0,0.07)',
        boxShadow: highlight
          ? '0 8px 40px rgba(255,149,0,0.14), 0 2px 12px rgba(0,0,0,0.06)'
          : urgent
          ? '0 4px 28px rgba(255,59,48,0.12), 0 1px 6px rgba(0,0,0,0.05)'
          : '0 2px 20px rgba(0,0,0,0.06)',
        padding: highlight ? '24px' : '18px',
        display: 'flex', flexDirection: 'column' as const, gap: '14px',
        position: 'relative' as const,
        overflow: 'hidden' as const,
      }}
    >
      {/* Urgent pulse ring */}
      {urgent && (
        <motion.div
          animate={{ opacity: [0.35, 0.08, 0.35] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{
            position: 'absolute', inset: 0, borderRadius: 'inherit',
            border: '2.5px solid rgba(255,59,48,0.45)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Top row: badges + time */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' as const }}>
          <span style={{
            background: urgent ? 'rgba(255,59,48,0.10)' : 'rgba(10,132,255,0.09)',
            color: urgent ? '#FF3B30' : '#0A84FF',
            borderRadius: '999px', padding: '3px 11px',
            fontSize: '0.73rem', fontWeight: 700,
          }}>
            {urgent ? '🚨 عاجل' : '⏳ معلّق'}
          </span>
          <span style={{
            background: 'rgba(142,142,147,0.10)', color: '#6E6E73',
            borderRadius: '999px', padding: '3px 10px',
            fontSize: '0.73rem', fontWeight: 600,
          }}>
            {req.categoryLabel}
          </span>
        </div>
        <span style={{ color: '#AEAEB2', fontSize: '0.76rem', whiteSpace: 'nowrap' as const, flexShrink: 0 }}>
          🕒 {formatRelativeTime(req.createdAt)}
        </span>
      </div>

      {/* Patient name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{
          width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
          background: urgent ? 'rgba(255,59,48,0.09)' : 'rgba(10,132,255,0.08)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1rem',
        }}>
          👤
        </div>
        <div>
          <p style={{ fontWeight: 700, fontSize: '0.96rem', color: '#0A0A0A', margin: 0 }}>{req.patientName}</p>
          <p style={{ color: '#8E8E93', fontSize: '0.75rem', margin: '1px 0 0 0' }}>{formatClockTime(req.createdAt)}</p>
        </div>
      </div>

      {/* Request bubble */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '13px 16px', borderRadius: '14px',
        background: urgent
          ? 'linear-gradient(135deg, rgba(255,59,48,0.07) 0%, rgba(255,59,48,0.04) 100%)'
          : 'linear-gradient(135deg, rgba(10,132,255,0.07) 0%, rgba(10,132,255,0.04) 100%)',
        border: urgent ? '1px solid rgba(255,59,48,0.12)' : '1px solid rgba(10,132,255,0.10)',
      }}>
        <span style={{ fontSize: '1.5rem', lineHeight: 1, flexShrink: 0 }}>{req.requestEmoji}</span>
        <span style={{ fontWeight: 700, color: urgent ? '#FF3B30' : '#0A84FF', fontSize: '0.97rem', lineHeight: 1.35 }}>
          {req.requestText}
        </span>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <motion.button
          whileHover={{ scale: 1.03, boxShadow: '0 6px 22px rgba(52,199,89,0.38)' }}
          whileTap={{ scale: 0.96 }}
          onClick={() => onComplete(req.id)}
          style={{
            flex: 1, padding: '13px 8px', borderRadius: '13px',
            background: 'linear-gradient(135deg, #34C759 0%, #2DB14E 100%)',
            color: '#fff', fontWeight: 700, fontSize: '0.92rem',
            border: 'none', cursor: 'pointer',
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            boxShadow: '0 3px 16px rgba(52,199,89,0.32)',
            letterSpacing: '0.01em',
          }}
        >
          ✅ تم التنفيذ
        </motion.button>
        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.96 }}
          onClick={() => onReject(req.id)}
          style={{
            flex: 1, padding: '13px 8px', borderRadius: '13px',
            background: 'rgba(255,59,48,0.07)',
            color: '#FF3B30', fontWeight: 700, fontSize: '0.92rem',
            border: '1.5px solid rgba(255,59,48,0.18)', cursor: 'pointer',
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
          }}
        >
          ❌ رفض
        </motion.button>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HistoryCard — redesigned (compact)
// ─────────────────────────────────────────────────────────────────────────────
function HistoryCard({ req }: { req: PatientRequest }) {
  const done      = req.status === 'done';
  const actionISO = done ? req.completedAt : req.rejectedAt;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.16 } }}
      transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
      style={{
        background: 'rgba(255,255,255,0.60)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderRadius: '14px',
        border: done ? '1.5px solid rgba(52,199,89,0.16)' : '1.5px solid rgba(255,59,48,0.14)',
        boxShadow: '0 1px 12px rgba(0,0,0,0.04)',
        padding: '13px 16px',
        display: 'flex', alignItems: 'center', gap: '12px',
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
        background: done ? 'rgba(52,199,89,0.10)' : 'rgba(255,59,48,0.08)',
        border: done ? '1.5px solid rgba(52,199,89,0.22)' : '1.5px solid rgba(255,59,48,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.95rem',
      }}>
        {done ? '✅' : '❌'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' as const }}>
          <p style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1C1C1E', margin: 0 }}>{req.patientName}</p>
          <span style={{
            fontSize: '0.70rem', fontWeight: 700,
            color: done ? '#34C759' : '#FF3B30',
            background: done ? 'rgba(52,199,89,0.09)' : 'rgba(255,59,48,0.09)',
            borderRadius: '999px', padding: '1px 8px',
          }}>
            {done ? 'تم التنفيذ' : 'مرفوض'}
          </span>
        </div>
        <p style={{ color: '#6E6E73', fontSize: '0.80rem', margin: '2px 0 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
          {req.requestEmoji} {req.requestText}
        </p>
        <p style={{ color: '#AEAEB2', fontSize: '0.72rem', margin: '2px 0 0 0' }}>
          طُلب {formatRelativeTime(req.createdAt)}
          {actionISO && ` · ${done ? 'نُفِّذ' : 'رُفض'} ${formatRelativeTime(actionISO)}`}
        </p>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ActivityTimeline
// ─────────────────────────────────────────────────────────────────────────────
function ActivityTimeline({ requests }: { requests: PatientRequest[] }) {
  const sorted = [...requests]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 20);

  if (sorted.length === 0) {
    return (
      <div style={{
        padding: '32px 20px', textAlign: 'center' as const,
        color: '#AEAEB2', fontSize: '0.88rem',
        background: 'rgba(255,255,255,0.5)',
        backdropFilter: 'blur(20px)',
        borderRadius: '18px',
        border: '1.5px solid rgba(0,0,0,0.06)',
      }}>
        لا يوجد نشاط بعد
      </div>
    );
  }

  return (
    <div style={{
      background: 'rgba(255,255,255,0.72)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderRadius: '20px',
      border: '1.5px solid rgba(0,0,0,0.06)',
      boxShadow: '0 2px 20px rgba(0,0,0,0.06)',
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
          : '#0A84FF';

        return (
          <motion.div
            key={req.id}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.24, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
            style={{
              display: 'flex', gap: '12px', alignItems: 'stretch',
              paddingBottom: i < sorted.length - 1 ? '14px' : 0,
            }}
          >
            {/* Timeline line + dot */}
            <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'center', width: 14, flexShrink: 0 }}>
              <div style={{
                width: 10, height: 10, borderRadius: '50%',
                background: dotColor,
                flexShrink: 0, marginTop: '4px',
                boxShadow: `0 0 0 2px rgba(255,255,255,1), 0 0 0 3.5px ${dotColor}40`,
              }} />
              {i < sorted.length - 1 && (
                <div style={{
                  flex: 1, width: 1.5, background: 'rgba(0,0,0,0.08)',
                  marginTop: '4px',
                }} />
              )}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1C1C1E' }}>
                    {req.requestEmoji} {req.requestText}
                  </span>
                  <p style={{ margin: '2px 0 0 0', fontSize: '0.74rem', color: '#8E8E93' }}>
                    {req.patientName} · {req.categoryLabel}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end', gap: '3px', flexShrink: 0 }}>
                  <span style={{ fontSize: '0.71rem', color: '#AEAEB2', whiteSpace: 'nowrap' as const }}>
                    {formatClockTime(req.createdAt)}
                  </span>
                  <span style={{
                    fontSize: '0.67rem', fontWeight: 700,
                    color: req.status === 'done' ? '#34C759' : req.status === 'rejected' ? '#FF3B30' : dotColor,
                    background: req.status === 'done'
                      ? 'rgba(52,199,89,0.09)'
                      : req.status === 'rejected'
                      ? 'rgba(255,59,48,0.09)'
                      : 'rgba(10,132,255,0.09)',
                    borderRadius: '999px', padding: '1px 7px',
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
// CaregiverDashboard
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
  // badgeNotifiedIds: tracks which request IDs have already triggered a badge flash/title
  const badgeNotifiedIds = useRef<Set<string>>(new Set(requests.map(r => r.id)));
  // seenAtMount: used for the "N جديد" header badge (requests present at mount are NOT "new")
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

  // Badge flash + tab title — audio is handled entirely by CaregiverNotificationProvider
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

  // ── Derived request lists ──────────────────────────────────────────────────
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

  // Count new (arrived after mount) unread pending requests
  const newCount  = allPending.filter(r => !seenAtMount.current.has(r.id)).length;

  // Latest pending request (for highlight card)
  const latestPending = allPending[0] ?? null;

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleComplete = useCallback((id: string) => {
    completeRequest(id);
    // Notify patient screen across tabs
    try {
      const bc = new BroadcastChannel(PATIENT_NOTIFY_CHANNEL);
      bc.postMessage({ type: 'caregiver_completed' });
      bc.close();
    } catch { /* BroadcastChannel not available */ }
    // Toast
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
        background: 'linear-gradient(170deg, #FEFEFE 0%, #F8F8FD 40%, #F2F2F9 100%)',
        position: 'relative',
      }}
    >
      <AmbientBg />

      {/* ── Debug strip (temporary) ─────────────────────────────────────── */}
      <div style={{
        position: 'relative', zIndex: 20,
        display: 'flex', gap: '20px', padding: '5px 24px',
        background: 'rgba(0,0,0,0.035)', borderBottom: '1px solid rgba(0,0,0,0.06)',
        fontSize: '0.70rem', fontFamily: 'monospace', color: '#6E6E73',
        direction: 'ltr', flexWrap: 'wrap',
      }}>
        <span>Provider: <strong style={{ color: audioDebug.providerMounted ? '#34C759' : '#FF3B30' }}>{audioDebug.providerMounted ? 'mounted' : 'unmounted'}</strong></span>
        <span>AudioContext: <strong>{audioDebug.ctxState}</strong></span>
        <span>Session Ready: <strong style={{ color: audioDebug.sessionReady ? '#34C759' : '#FF3B30' }}>{audioDebug.sessionReady ? 'true' : 'false'}</strong></span>
        <span>Queue: <strong>{audioDebug.pendingQueueIds.length > 0 ? audioDebug.pendingQueueIds.join(', ') : '—'}</strong></span>
        <span>Last Played: <strong>{audioDebug.lastPlayedId}</strong></span>
        <span>Last Error: <strong>{audioDebug.lastAudioError}</strong></span>
      </div>

      {/* ── Audio banner / success strip ────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {audioJustActivated ? (
          <motion.div
            key="audio-success"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.28 }}
            style={{
              position: 'relative', zIndex: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: '8px', padding: '11px 24px',
              background: 'linear-gradient(135deg, rgba(52,199,89,0.14) 0%, rgba(52,199,89,0.07) 100%)',
              borderBottom: '1px solid rgba(52,199,89,0.28)',
            }}
          >
            <span>✅</span>
            <span style={{ fontWeight: 600, fontSize: '0.92rem', color: '#1A6E34' }}>
              تم تفعيل صوت التنبيهات
            </span>
          </motion.div>
        ) : !audioSessionReady ? (
          <motion.div
            key="audio-banner"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'relative', zIndex: 20,
              display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 24px',
              background: 'linear-gradient(135deg, rgba(255,159,10,0.18) 0%, rgba(255,204,0,0.12) 100%)',
              backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
              borderBottom: '1px solid rgba(255,159,10,0.25)',
              flexWrap: 'wrap',
            }}
          >
            <motion.span
              animate={{ scale: [1, 1.18, 1] }}
              transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
              style={{ fontSize: '1.1rem', flexShrink: 0 }}
            >
              🔊
            </motion.span>
            <span style={{ fontWeight: 600, fontSize: '0.90rem', color: '#92600A', flexShrink: 0 }}>
              يلزم تفعيل الصوت في كل جلسة
            </span>
            {audioError && (
              <span style={{ fontSize: '0.78rem', color: '#C0392B', fontWeight: 500 }}>
                {audioError}
              </span>
            )}
            <button
              onClick={handleActivateAudio}
              disabled={audioActivating}
              style={{
                marginRight: 'auto',
                padding: '8px 18px', borderRadius: '999px',
                background: audioActivating ? 'rgba(146,96,10,0.15)' : '#FF9500',
                color: audioActivating ? '#92600A' : '#fff',
                border: 'none', cursor: audioActivating ? 'default' : 'pointer',
                fontWeight: 700, fontSize: '0.84rem',
                fontFamily: "'IBM Plex Sans Arabic', sans-serif",
                transition: 'background 0.18s',
                flexShrink: 0,
              }}
            >
              {audioActivating ? 'جارٍ التفعيل…' : '🔊 تفعيل واختبار الصوت'}
            </button>

            {/* Optional: browser notification permission */}
            {notifPermission === 'default' && (
              <button
                onClick={handleRequestNotifPermission}
                style={{
                  padding: '8px 14px', borderRadius: '999px',
                  background: 'rgba(10,132,255,0.10)',
                  color: '#0A84FF', border: '1px solid rgba(10,132,255,0.22)',
                  cursor: 'pointer', fontWeight: 600, fontSize: '0.80rem',
                  fontFamily: "'IBM Plex Sans Arabic', sans-serif",
                  flexShrink: 0,
                }}
              >
                🔔 تفعيل الإشعارات
              </button>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'relative', zIndex: 10,
          maxWidth: '1180px', width: '100%', margin: '0 auto',
          padding: '28px 24px 0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' as const }}>
          {/* Patient info block */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            style={{
              background: 'rgba(255,255,255,0.82)',
              backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
              borderRadius: '20px',
              border: '1.5px solid rgba(0,0,0,0.07)',
              boxShadow: '0 4px 24px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)',
              padding: '18px 22px',
              display: 'flex', alignItems: 'center', gap: '16px',
              flex: 1, minWidth: 0,
            }}
          >
            {/* Avatar */}
            <div style={{
              width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #0A84FF 0%, #5E5CE6 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.5rem',
              boxShadow: '0 4px 16px rgba(10,132,255,0.28)',
            }}>
              👤
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' as const }}>
                <h1 style={{ margin: 0, fontSize: 'clamp(1.1rem, 2vw, 1.4rem)', fontWeight: 800, color: '#0A0A0A' }}>
                  {profile.patientName}
                </h1>
                {/* Live status chip */}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  background: allPending.length > 0
                    ? 'rgba(255,59,48,0.10)' : 'rgba(52,199,89,0.10)',
                  color: allPending.length > 0 ? '#FF3B30' : '#34C759',
                  borderRadius: '999px', padding: '3px 11px',
                  fontSize: '0.75rem', fontWeight: 700,
                  border: allPending.length > 0
                    ? '1px solid rgba(255,59,48,0.22)' : '1px solid rgba(52,199,89,0.22)',
                }}>
                  <motion.span
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.4, repeat: Infinity }}
                    style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: allPending.length > 0 ? '#FF3B30' : '#34C759',
                      display: 'inline-block',
                    }}
                  />
                  {allPending.length > 0 ? `${allPending.length} طلب نشط` : 'مستقر'}
                </span>
                {/* Unread badge */}
                <AnimatePresence>
                  {newCount > 0 && (
                    <motion.span
                      key="new-badge"
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.5, opacity: 0 }}
                      style={{
                        background: '#FF3B30', color: '#fff',
                        borderRadius: '999px', padding: '2px 9px',
                        fontSize: '0.70rem', fontWeight: 800,
                        boxShadow: '0 2px 10px rgba(255,59,48,0.35)',
                      }}
                    >
                      {newCount} جديد
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.80rem', color: '#8E8E93' }}>
                مقدم الرعاية: <strong style={{ color: '#3C3C43' }}>{profile.caregiverName}</strong>
              </p>
            </div>
          </motion.div>

          {/* Back button */}
          <motion.button
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.08 }}
            whileHover={{ scale: 1.04 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => navigate('/')}
            style={{
              display: 'flex', alignItems: 'center', gap: '4px',
              padding: '12px 22px', borderRadius: '999px',
              background: 'rgba(255,255,255,0.82)',
              backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
              border: '1.5px solid rgba(0,0,0,0.08)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
              cursor: 'pointer', color: '#0A0A0A', fontWeight: 600,
              fontSize: '0.9rem', fontFamily: "'IBM Plex Sans Arabic', sans-serif",
              flexShrink: 0,
            }}
          >
            الرئيسية <ChevronRight size={15} strokeWidth={2.5} />
          </motion.button>
        </div>

        {/* ── Stats bar ──────────────────────────────────────────────────── */}
        <div style={{ marginTop: '16px' }}>
          <StatsBar requests={requests} />
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div
        style={{
          position: 'relative', zIndex: 10,
          maxWidth: '1180px', width: '100%', margin: '0 auto',
          padding: '20px 24px 80px',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)',
          gap: '20px',
        }}
        className="dashboard-grid"
      >
        {/* ── Left column: request sections ──────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

          {/* Latest request highlight */}
          <AnimatePresence>
            {latestPending && (
              <motion.section
                key="latest"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3 }}
              >
                <SectionHeader emoji="⚡" title="آخر طلب وارد" count={0} color="#FF9500" />
                <RequestCard req={latestPending} onComplete={handleComplete} onReject={handleReject} highlight />
              </motion.section>
            )}
          </AnimatePresence>

          {/* Emergency */}
          <AnimatePresence>
            {emergency.length > 0 && (
              <motion.section
                key="emergency"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <SectionHeader emoji="🚨" title="طلبات طارئة" count={emergency.length} color="#FF3B30" flash={badgeFlash} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <AnimatePresence mode="popLayout">
                    {emergency.map(req => (
                      <RequestCard key={req.id} req={req} onComplete={handleComplete} onReject={handleReject} />
                    ))}
                  </AnimatePresence>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Pending */}
          <section>
            <SectionHeader emoji="⏳" title="طلبات معلّقة" count={pending.length} color="#0A84FF" flash={badgeFlash && emergency.length === 0} />
            <AnimatePresence mode="popLayout">
              {pending.length === 0 && emergency.length === 0 ? (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  style={{
                    background: 'rgba(255,255,255,0.65)',
                    backdropFilter: 'blur(20px)',
                    borderRadius: '18px',
                    border: '1.5px solid rgba(0,0,0,0.06)',
                    padding: '44px 24px',
                    textAlign: 'center' as const,
                    color: '#AEAEB2', fontSize: '0.95rem',
                  }}
                >
                  ✓ لا توجد طلبات معلّقة حاليًا
                </motion.div>
              ) : pending.length === 0 ? null : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <AnimatePresence mode="popLayout">
                    {pending.map(req => (
                      <RequestCard key={req.id} req={req} onComplete={handleComplete} onReject={handleReject} />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </AnimatePresence>
          </section>

          {/* Completed */}
          <AnimatePresence>
            {done.length > 0 && (
              <motion.section
                key="done"
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <SectionHeader emoji="✅" title="الطلبات المنجزة" count={done.length} color="#34C759" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  <AnimatePresence mode="popLayout">
                    {done.map(req => <HistoryCard key={req.id} req={req} />)}
                  </AnimatePresence>
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Rejected */}
          <AnimatePresence>
            {rejected.length > 0 && (
              <motion.section
                key="rejected"
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <SectionHeader emoji="❌" title="الطلبات المرفوضة" count={rejected.length} color="#FF3B30" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                  <AnimatePresence mode="popLayout">
                    {rejected.map(req => <HistoryCard key={req.id} req={req} />)}
                  </AnimatePresence>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        {/* ── Right column: Activity Timeline ────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <SectionHeader emoji="📋" title="سجل النشاط" count={0} color="#5E5CE6" />
            <ActivityTimeline requests={requests} />
          </div>
        </div>
      </div>

      {/* ── Completion toast ────────────────────────────────────────────────── */}
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
              padding: '14px 30px', borderRadius: '999px',
              background: 'linear-gradient(135deg, rgba(52,199,89,0.13) 0%, rgba(255,255,255,0.92) 100%)',
              backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
              border: '1.5px solid rgba(52,199,89,0.38)',
              boxShadow: '0 8px 32px rgba(52,199,89,0.22)',
              whiteSpace: 'nowrap' as const,
              fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            }}
          >
            <span style={{ fontWeight: 700, color: '#2DB14E', fontSize: '0.96rem' }}>{toastText}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Responsive grid style ──────────────────────────────────────────── */}
      <style>{`
        @media (max-width: 768px) {
          .dashboard-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
