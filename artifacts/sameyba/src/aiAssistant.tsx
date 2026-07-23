/**
 * aiAssistant.tsx — سَم يبه AI Assistant
 *
 * Rule-based Arabic AI that analyses recent patient requests
 * and suggests the most likely next needs.  No API key required.
 */

import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation } from 'wouter';

import type { PatientRequest } from './App';
import { useRequestStore } from './App';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface Chip {
  id:          string;
  emoji:       string;
  text:        string;
  /** Wouter path to navigate to after user picks this chip */
  path?:       string;
  /** AI follow-up text shown after user picks this chip */
  followUp:    string;
}

interface ChatMessage {
  id:           string;
  role:         'ai' | 'user';
  text:         string;
  chips?:       Chip[];
  /** Show this "go now" nav button once the user taps a chip */
  navPath?:     string;
  navLabel?:    string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule-based AI engine
// ─────────────────────────────────────────────────────────────────────────────

function recentItems(requests: PatientRequest[], hours = 24) {
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  return requests.filter(r => new Date(r.createdAt).getTime() > cutoff);
}

function countText(requests: PatientRequest[], keyword: string) {
  return requests.filter(r => r.requestText.includes(keyword)).length;
}

function hasText(requests: PatientRequest[], ...keywords: string[]) {
  return keywords.some(kw => requests.some(r => r.requestText.includes(kw)));
}

function hasCategory(requests: PatientRequest[], catId: string) {
  return requests.some(r => r.categoryId === catId);
}

interface AIResponse {
  greeting: string;
  chips:    Chip[];
}

function runRules(all: PatientRequest[]): AIResponse {
  const recent   = recentItems(all, 24);
  const last5    = [...all].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  ).slice(0, 5);

  // ── Rule 1: Pain ──────────────────────────────────────────────────────────
  if (hasText(last5, 'متألم', 'ألم')) {
    return {
      greeting: 'لاحظت أنك تشعر بألم 💙\nهل تحتاج إلى أحد هذه؟',
      chips: [
        {
          id: 'nurse',   emoji: '👩‍⚕️', text: 'نادِ الممرضة',
          path: '/communicate/health',
          followUp: 'سأفتح صفحة الصحة لك لطلب الممرضة مباشرةً.',
        },
        {
          id: 'call',    emoji: '📞', text: 'اتصل بمقدم الرعاية',
          path: '/communicate/social',
          followUp: 'سأفتح صفحة التواصل الاجتماعي.',
        },
        {
          id: 'repos',   emoji: '🧍', text: 'غيّر وضعيتي',
          path: '/communicate/health',
          followUp: 'يمكنك طلب تغيير الوضعية من صفحة الصحة.',
        },
      ],
    };
  }

  // ── Rule 2: Nausea ────────────────────────────────────────────────────────
  if (hasText(last5, 'غثيان')) {
    return {
      greeting: 'أرى أنك تشعر بغثيان.\nهل ترغب في:',
      chips: [
        {
          id: 'nurse',  emoji: '👩‍⚕️', text: 'نادِ الممرضة',
          path: '/communicate/health',
          followUp: 'سأنقلك لصفحة الصحة لطلب الممرضة.',
        },
        {
          id: 'water',  emoji: '💧', text: 'أريد ماءً',
          path: '/communicate/needs',
          followUp: 'يمكنك طلب الماء من صفحة الاحتياجات.',
        },
        {
          id: 'quiet',  emoji: '🤫', text: 'أريد هدوءًا',
          path: '/communicate/needs',
          followUp: 'سأفتح صفحة الاحتياجات لطلب الهدوء.',
        },
      ],
    };
  }

  // ── Rule 3: Repeated water → suggest food / medication ───────────────────
  if (countText(recent, 'ماء') >= 2 || countText(recent, 'اشرب') >= 2) {
    return {
      greeting: 'طلبت الماء عدة مرات مؤخرًا.\nهل ترغب أيضًا في الطعام أو الدواء؟',
      chips: [
        {
          id: 'food',  emoji: '🍽️', text: 'الطعام',
          path: '/communicate/needs',
          followUp: 'سأفتح صفحة الاحتياجات لطلب الطعام.',
        },
        {
          id: 'med',   emoji: '💊', text: 'الدواء',
          path: '/communicate/health',
          followUp: 'يمكنك طلب الدواء عبر صفحة الصحة.',
        },
        {
          id: 'repos', emoji: '🧍', text: 'تغيير الوضعية',
          path: '/communicate/health',
          followUp: 'سأفتح صفحة الصحة لتغيير وضعيتك.',
        },
      ],
    };
  }

  // ── Rule 4: Food → suggest water + comfort ────────────────────────────────
  if (hasText(last5, 'طعام', 'أكل', 'أريد الأكل')) {
    return {
      greeting: 'طلبت الطعام مؤخرًا.\nهل تحتاج أيضًا إلى:',
      chips: [
        {
          id: 'water',  emoji: '💧', text: 'ماء / مشروب',
          path: '/communicate/needs',
          followUp: 'سأفتح الاحتياجات لطلب الماء.',
        },
        {
          id: 'chair',  emoji: '🪑', text: 'الجلوس على كرسي',
          path: '/communicate/needs',
          followUp: 'يمكنك طلب كرسي الجلوس من صفحة الاحتياجات.',
        },
        {
          id: 'nurse',  emoji: '👩‍⚕️', text: 'نادِ الممرضة',
          path: '/communicate/health',
          followUp: 'سأفتح صفحة الصحة.',
        },
      ],
    };
  }

  // ── Rule 5: Bathroom ─────────────────────────────────────────────────────
  if (hasText(last5, 'حمام', 'الحمام')) {
    return {
      greeting: 'لاحظت أنك طلبت مساعدة في الحمام.\nهل تحتاج أيضًا إلى:',
      chips: [
        {
          id: 'nurse',   emoji: '👩‍⚕️', text: 'نادِ الممرضة',
          path: '/communicate/health',
          followUp: 'سأنقلك لصفحة الصحة.',
        },
        {
          id: 'standup', emoji: '🪑', text: 'ساعدني على الوقوف',
          path: '/communicate/health',
          followUp: 'يمكنك طلب المساعدة على الوقوف من صفحة الصحة.',
        },
        {
          id: 'repos',   emoji: '🧍', text: 'غيّر وضعيتي',
          path: '/communicate/health',
          followUp: 'سأفتح صفحة الصحة لتغيير الوضعية.',
        },
      ],
    };
  }

  // ── Rule 6: Sad / worried → suggest family call ──────────────────────────
  if (hasText(last5, 'حزن', 'حزين', 'قلق', 'خائف', 'وحيد')) {
    return {
      greeting: 'أنت لست وحدك 💚\nهل ترغب في:',
      chips: [
        {
          id: 'son',    emoji: '👦', text: 'اتصل بالابن',
          path: '/communicate/social',
          followUp: 'سأفتح صفحة التواصل الاجتماعي.',
        },
        {
          id: 'daughter', emoji: '👧', text: 'اتصل بالابنة',
          path: '/communicate/social',
          followUp: 'سأفتح صفحة التواصل.',
        },
        {
          id: 'sit',    emoji: '🤝', text: 'اجلس معي',
          path: '/communicate/social',
          followUp: 'يمكنك طلب الجلوس معك من صفحة التواصل.',
        },
      ],
    };
  }

  // ── Rule 7: Tired / sleepy → suggest room comfort ────────────────────────
  if (hasText(last5, 'متعب', 'نعسان', 'تعب', 'أريد النوم')) {
    return {
      greeting: 'يبدو أنك تشعر بالتعب.\nهل تريد:',
      chips: [
        {
          id: 'light-off', emoji: '💡', text: 'أطفئ الضوء',
          path: '/communicate/room',
          followUp: 'يمكنك التحكم في الإضاءة من صفحة الغرفة.',
        },
        {
          id: 'bed-down',  emoji: '🛏️', text: 'خفّض السرير',
          path: '/communicate/room',
          followUp: 'سأفتح صفحة الغرفة للتحكم في السرير.',
        },
        {
          id: 'quiet',     emoji: '🤫', text: 'هدوء',
          path: '/communicate/needs',
          followUp: 'سأفتح صفحة الاحتياجات لطلب الهدوء.',
        },
      ],
    };
  }

  // ── Rule 8: Worship activity → suggest time-related worship ──────────────
  if (hasCategory(recent, 'worship') && recent.length > 0) {
    return {
      greeting: 'ما شاء الله 🤲\nهل تحتاج إلى:',
      chips: [
        {
          id: 'prayer',   emoji: '🕌', text: 'المساعدة في الصلاة',
          path: '/communicate/worship',
          followUp: 'سأفتح صفحة العبادة.',
        },
        {
          id: 'quran',    emoji: '📖', text: 'القرآن الكريم',
          path: '/communicate/worship',
          followUp: 'يمكنك طلب المصحف من صفحة العبادة.',
        },
        {
          id: 'wudu',     emoji: '💧', text: 'الوضوء',
          path: '/communicate/worship',
          followUp: 'سأفتح صفحة العبادة لطلب الوضوء.',
        },
      ],
    };
  }

  // ── Rule 9: Active history but no specific pattern ────────────────────────
  if (recent.length >= 3) {
    // Find dominant category
    const catCounts: Record<string, number> = {};
    for (const r of recent) catCounts[r.categoryId] = (catCounts[r.categoryId] ?? 0) + 1;
    const topCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

    const catSuggestions: Record<string, AIResponse> = {
      health: {
        greeting: 'لاحظت اهتمامك بصحتك اليوم.\nهل تحتاج إلى:',
        chips: [
          { id: 'nurse',   emoji: '👩‍⚕️', text: 'نادِ الممرضة',      path: '/communicate/health', followUp: 'سأفتح صفحة الصحة.' },
          { id: 'water',   emoji: '💧',   text: 'ماء',                path: '/communicate/needs',  followUp: 'سأفتح صفحة الاحتياجات.' },
          { id: 'repos',   emoji: '🧍',   text: 'تغيير الوضعية',      path: '/communicate/health', followUp: 'يمكنك طلب تغيير الوضعية.' },
        ],
      },
      needs: {
        greeting: 'هل تحتاج إلى شيء الآن؟',
        chips: [
          { id: 'water',  emoji: '💧',  text: 'ماء',          path: '/communicate/needs',  followUp: 'سأفتح صفحة الاحتياجات.' },
          { id: 'food',   emoji: '🍽️', text: 'طعام',          path: '/communicate/needs',  followUp: 'سأفتح صفحة الاحتياجات.' },
          { id: 'quiet',  emoji: '🤫',  text: 'هدوء',          path: '/communicate/needs',  followUp: 'سأفتح صفحة الاحتياجات.' },
        ],
      },
    };

    if (topCat && catSuggestions[topCat]) return catSuggestions[topCat];
  }

  // ── Default: no history ───────────────────────────────────────────────────
  return {
    greeting: 'أهلًا وسهلًا! 😊\nأنا هنا لمساعدتك. كيف تشعر الآن؟',
    chips: [
      {
        id: 'health',   emoji: '❤️',  text: 'أحتاج مساعدة طبية',
        path: '/communicate/health',
        followUp: 'سأفتح صفحة الصحة لك.',
      },
      {
        id: 'needs',    emoji: '🍽️', text: 'أحتاج شيئًا ما',
        path: '/communicate/needs',
        followUp: 'سأفتح صفحة الاحتياجات.',
      },
      {
        id: 'feelings', emoji: '💚',  text: 'أريد التعبير عن مشاعري',
        path: '/communicate/feelings',
        followUp: 'سأفتح صفحة المشاعر.',
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: make a unique ID
// ─────────────────────────────────────────────────────────────────────────────
let _uid = 0;
function uid() { return `ai-${Date.now()}-${++_uid}`; }

// ─────────────────────────────────────────────────────────────────────────────
// ChatBubble component
// ─────────────────────────────────────────────────────────────────────────────
function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isAI = msg.role === 'ai';
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      style={{
        display: 'flex',
        justifyContent: isAI ? 'flex-start' : 'flex-end',
        width: '100%',
        marginBottom: 4,
      }}
    >
      {isAI && (
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'linear-gradient(135deg, #5E7E35 0%, #4F6C2D 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.85rem', flexShrink: 0, marginLeft: 8, alignSelf: 'flex-end',
          boxShadow: '0 2px 8px rgba(94,126,53,0.30)',
        }}>
          🤖
        </div>
      )}
      <div style={{
        maxWidth: '78%',
        padding: '11px 15px',
        borderRadius: isAI
          ? '20px 20px 6px 20px'  // AI: flat on bottom-left (start side in RTL)
          : '20px 6px 20px 20px', // User: flat on bottom-right (end side in RTL)
        background: isAI
          ? 'rgba(245,247,242,0.97)'
          : 'linear-gradient(135deg, #5E7E35 0%, #4F6C2D 100%)',
        color: isAI ? '#1C1C1E' : '#fff',
        boxShadow: isAI
          ? '0 2px 12px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.8)'
          : '0 4px 16px rgba(94,126,53,0.32)',
        fontSize: '0.9rem',
        lineHeight: 1.55,
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        fontWeight: 500,
        whiteSpace: 'pre-line',
        direction: 'rtl',
        border: isAI ? '1px solid rgba(94,126,53,0.12)' : 'none',
      }}>
        {msg.text}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SuggestionChips
// ─────────────────────────────────────────────────────────────────────────────
function SuggestionChips({
  chips,
  onPick,
  disabled,
}: {
  chips: Chip[];
  onPick: (chip: Chip) => void;
  disabled: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        padding: '4px 0 8px 0',
        justifyContent: 'flex-start',
        direction: 'rtl',
      }}
    >
      {chips.map(chip => (
        <motion.button
          key={chip.id}
          onClick={() => !disabled && onPick(chip)}
          disabled={disabled}
          whileHover={disabled ? {} : { scale: 1.04, y: -1 }}
          whileTap={disabled ? {} : { scale: 0.96 }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px',
            borderRadius: 999,
            background: disabled
              ? 'rgba(240,240,245,0.6)'
              : 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: disabled
              ? '1px solid rgba(0,0,0,0.06)'
              : '1px solid rgba(94,126,53,0.28)',
            boxShadow: disabled
              ? 'none'
              : '0 2px 10px rgba(94,126,53,0.12), inset 0 1px 0 rgba(255,255,255,1)',
            cursor: disabled ? 'default' : 'pointer',
            fontSize: '0.85rem',
            fontWeight: 600,
            color: disabled ? '#AEAEB2' : '#4F6C2D',
            fontFamily: "'IBM Plex Sans Arabic', sans-serif",
            transition: 'background 0.15s, border 0.15s, color 0.15s',
            direction: 'rtl',
          }}
        >
          <span style={{ fontSize: '1.05rem' }}>{chip.emoji}</span>
          <span>{chip.text}</span>
        </motion.button>
      ))}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NavButton — "go to this screen" after follow-up
// ─────────────────────────────────────────────────────────────────────────────
function NavButton({ label, path, onNavigate }: { label: string; path: string; onNavigate: (p: string) => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
      style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 6 }}
    >
      <motion.button
        onClick={() => onNavigate(path)}
        whileHover={{ scale: 1.03, boxShadow: '0 6px 22px rgba(94,126,53,0.42)' }}
        whileTap={{ scale: 0.97 }}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 20px',
          borderRadius: 999,
          background: 'linear-gradient(135deg, #5E7E35 0%, #4F6C2D 100%)',
          color: 'white',
          border: 'none',
          fontSize: '0.9rem',
          fontWeight: 700,
          fontFamily: "'IBM Plex Sans Arabic', sans-serif",
          cursor: 'pointer',
          boxShadow: '0 4px 18px rgba(94,126,53,0.34)',
          direction: 'rtl',
        }}
      >
        <span>{label}</span>
        <span style={{ fontSize: '1rem' }}>←</span>
      </motion.button>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AIAssistantModal
// ─────────────────────────────────────────────────────────────────────────────
function AIAssistantModal({
  open,
  onClose,
}: {
  open:    boolean;
  onClose: () => void;
}) {
  const [, navigate] = useLocation();
  const { requests }   = useRequestStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chipsUsed, setChipsUsed] = useState<Set<string>>(new Set());
  const [pendingNav, setPendingNav] = useState<{ path: string; label: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Build initial greeting when modal opens
  useEffect(() => {
    if (!open) { setMessages([]); setChipsUsed(new Set()); setPendingNav(null); return; }

    // Small delay so the sheet animation completes first
    const t = setTimeout(() => {
      const { greeting, chips } = runRules(requests);
      setMessages([
        {
          id:    uid(),
          role:  'ai',
          text:  greeting,
          chips,
        },
      ]);
    }, 320);
    return () => clearTimeout(t);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  function handleChipPick(chip: Chip) {
    setChipsUsed(prev => new Set([...prev, chip.id]));

    // User message
    const userMsg: ChatMessage = {
      id:   uid(),
      role: 'user',
      text: `${chip.emoji} ${chip.text}`,
    };

    // AI follow-up (delayed for natural feel)
    const followMsg: ChatMessage = {
      id:   uid(),
      role: 'ai',
      text: chip.followUp,
    };

    setMessages(prev => [...prev, userMsg]);

    setTimeout(() => {
      setMessages(prev => [...prev, followMsg]);
      if (chip.path) {
        setPendingNav({ path: chip.path, label: 'اذهب الآن' });
      }
    }, 550);
  }

  function handleNavigate(path: string) {
    onClose();
    setTimeout(() => navigate(path), 220);
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="ai-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
            onClick={onClose}
            style={{
              position: 'fixed', inset: 0,
              background: 'rgba(0,0,0,0.32)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
              zIndex: 99990,
            }}
          />

          {/* Sheet */}
          <motion.div
            key="ai-sheet"
            initial={{ y: '100%', opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 38 }}
            style={{
              position: 'fixed',
              bottom: 0, left: 0, right: 0,
              height: '74vh',
              maxHeight: 600,
              borderRadius: '28px 28px 0 0',
              background: 'rgba(250,250,252,0.97)',
              backdropFilter: 'blur(40px) saturate(200%)',
              WebkitBackdropFilter: 'blur(40px) saturate(200%)',
              boxShadow: '0 -8px 48px rgba(0,0,0,0.14), 0 -1px 0 rgba(255,255,255,0.6)',
              zIndex: 99991,
              display: 'flex',
              flexDirection: 'column',
              direction: 'rtl',
              fontFamily: "'IBM Plex Sans Arabic', sans-serif",
              overflow: 'hidden',
            }}
          >
            {/* Olive green header — full-width branded strip */}
            <div style={{
              background: 'linear-gradient(135deg, #5E7E35 0%, #4A6828 100%)',
              borderRadius: '28px 28px 0 0',
              padding: '14px 20px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexShrink: 0,
            }}>
              {/* Handle bar — white tint on the green strip */}
              <div style={{
                position: 'absolute',
                top: 10, left: '50%', transform: 'translateX(-50%)',
                width: 36, height: 4, borderRadius: 2,
                background: 'rgba(255,255,255,0.35)',
              }} />

              {/* AI icon circle */}
              <div style={{
                width: 42, height: 42, borderRadius: '50%',
                background: 'rgba(255,255,255,0.15)',
                border: '1.5px solid rgba(201,168,76,0.55)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '1.25rem',
                flexShrink: 0,
                boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
              }}>
                🤖
              </div>

              <div style={{ flex: 1 }}>
                <p style={{
                  margin: 0, fontSize: '1rem', fontWeight: 700, color: '#ffffff',
                  letterSpacing: '0.01em',
                }}>
                  المساعد الذكي
                </p>
                <p style={{
                  margin: 0, fontSize: '0.73rem', color: '#C9A84C', fontWeight: 600,
                  letterSpacing: '0.02em',
                }}>
                  مساعد ذكي لاحتياجاتك
                </p>
              </div>

              {/* Close button */}
              <motion.button
                onClick={onClose}
                whileHover={{ scale: 1.10, background: 'rgba(255,255,255,0.22)' }}
                whileTap={{ scale: 0.92 }}
                style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: 'rgba(255,255,255,0.12)',
                  border: '1px solid rgba(255,255,255,0.22)',
                  cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.85rem', color: 'rgba(255,255,255,0.90)',
                  flexShrink: 0,
                }}
                aria-label="إغلاق"
              >
                ✕
              </motion.button>
            </div>

            {/* Messages area */}
            <div
              ref={scrollRef}
              style={{
                flex: 1, overflowY: 'auto',
                padding: '16px 18px 8px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                scrollbarWidth: 'none',
              }}
            >
              <AnimatePresence initial={false}>
                {messages.map((msg, i) => (
                  <div key={msg.id}>
                    <ChatBubble msg={msg} />
                    {/* Chips after the latest AI message only */}
                    {msg.role === 'ai' && msg.chips && i === messages.length - 1 && (
                      <SuggestionChips
                        chips={msg.chips}
                        onPick={handleChipPick}
                        disabled={chipsUsed.size > 0}
                      />
                    )}
                  </div>
                ))}
              </AnimatePresence>

              {/* Navigation button appears after follow-up */}
              {pendingNav && messages.length > 1 && (
                <NavButton
                  label={pendingNav.label}
                  path={pendingNav.path}
                  onNavigate={handleNavigate}
                />
              )}
            </div>

            {/* Footer hint */}
            <div style={{
              padding: '10px 20px 20px',
              borderTop: '1px solid rgba(94,126,53,0.10)',
              textAlign: 'center',
            }}>
              <p style={{
                margin: 0, fontSize: '0.74rem',
                color: '#7BA043', fontWeight: 500,
              }}>
                اضغط على اقتراح للحصول على مساعدة فورية
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AIAssistantButton — floating circular button fixed to the bottom-left corner
// ─────────────────────────────────────────────────────────────────────────────
export function AIAssistantButton() {
  const [open, setOpen]         = useState(false);
  // Badge starts true — signals there's an AI suggestion available.
  // Cleared as soon as the caregiver opens the panel once.
  const [hasUnread, setHasUnread] = useState(true);

  const handleOpen = () => {
    setOpen(true);
    setHasUnread(false);
  };

  return (
    <>
      {/* Fixed floating trigger */}
      <motion.button
        onClick={handleOpen}
        aria-label="المساعد الذكي"
        /* Subtle continuous float */
        animate={{ y: [0, -7, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        whileHover={{ scale: 1.10 }}
        whileTap={{ scale: 0.93 }}
        style={{
          position: 'fixed',
          bottom: 28,
          left: 28,
          zIndex: 90,
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'linear-gradient(145deg, #5E7E35 0%, #4A6828 100%)',
          border: '1.5px solid rgba(201,168,76,0.40)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.75rem',
          boxShadow: '0 8px 28px rgba(94,126,53,0.45), 0 2px 8px rgba(0,0,0,0.14)',
          /* Hardware-accelerate the float so it never flickers */
          willChange: 'transform',
        }}
      >
        🤖
        {/* Unread badge */}
        {hasUnread && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            style={{
              position: 'absolute',
              top: 4,
              right: 4,
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#FF3B30',
              border: '2px solid #fff',
              boxShadow: '0 1px 4px rgba(255,59,48,0.55)',
              pointerEvents: 'none',
            }}
          />
        )}
      </motion.button>

      <AIAssistantModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
