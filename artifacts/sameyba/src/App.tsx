import { useState, useRef, useCallback } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Eye, Volume2, Smartphone, ChevronRight } from 'lucide-react';

const queryClient = new QueryClient();

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] } }
};

function Home() {
  const [, navigate] = useLocation();

  return (
    <div 
      className="min-h-[100dvh] w-full flex flex-col md:flex-row bg-[#FAFAFA] overflow-x-hidden"
      dir="rtl"
      style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}
    >
      {/* Right Column (Hero Image) / Top on mobile */}
      <motion.div 
        className="w-full md:w-[55%] relative h-[55vw] md:h-[100dvh] p-4 md:p-0 md:py-6 md:pl-6 shrink-0"
        initial={{ opacity: 0, scale: 1.02 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        <div className="relative w-full h-full rounded-2xl md:rounded-none md:rounded-l-[24px] overflow-hidden shadow-sm">
          <img 
            src={import.meta.env.BASE_URL + 'hero.png'} 
            alt="سَم يبه - التواصل بالنظر" 
            className="w-full h-full object-cover"
          />
          {/* Subtle blending gradient for desktop left edge */}
          <div className="hidden md:block absolute top-0 left-0 bottom-0 w-32 bg-gradient-to-r from-[#FAFAFA] via-[#FAFAFA]/40 to-transparent pointer-events-none" />
        </div>
      </motion.div>

      {/* Left Column (Content) / Bottom on mobile */}
      <motion.div 
        className="w-full md:w-[45%] flex flex-col px-6 py-10 md:px-16 lg:px-24 flex-1"
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="flex flex-col h-full max-w-lg w-full mx-auto md:mx-0">
          
          <div className="flex-1 flex flex-col justify-center space-y-12">
            
            {/* Header */}
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

            {/* Feature Icons */}
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

            {/* CTA */}
            <motion.div variants={itemVariants} className="pt-4">
              <motion.button
                onClick={() => navigate('/communicate')}
                whileHover={{ 
                  scale: 1.05,
                  boxShadow: '0 8px 36px rgba(10,132,255,0.45)'
                }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                initial={{ boxShadow: '0 4px 24px rgba(10,132,255,0.30)' }}
                className="bg-[#0A84FF] text-white text-[1.1rem] font-semibold rounded-full min-w-[200px] w-fit flex items-center justify-center"
                style={{ 
                  padding: '18px 52px',
                  border: 'none',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                ابدأ التواصل
              </motion.button>
            </motion.div>
            
          </div>

          {/* Bottom Caption */}
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

const CARDS = [
  {
    id: 'needs',
    label: 'احتياجاتي',
    image: 'illus-needs.png',
    // warm amber-cream glass
    bg: 'linear-gradient(148deg, rgba(255,253,245,0.97) 0%, rgba(255,246,222,0.94) 55%, rgba(255,234,180,0.88) 100%)',
    ringColor: '#FF9F0A',
    glowColor: 'rgba(255,159,10,0.55)',
    floatDuration: 3.8,
  },
  {
    id: 'health',
    label: 'صحتي',
    image: 'illus-health.png',
    // cool sky-blue glass
    bg: 'linear-gradient(148deg, rgba(245,250,255,0.97) 0%, rgba(225,242,255,0.94) 55%, rgba(195,228,255,0.88) 100%)',
    ringColor: '#0A84FF',
    glowColor: 'rgba(10,132,255,0.55)',
    floatDuration: 4.2,
  },
  {
    id: 'worship',
    label: 'عبادتي',
    image: 'illus-worship.png',
    // sage-green glass
    bg: 'linear-gradient(148deg, rgba(245,255,248,0.97) 0%, rgba(222,248,230,0.94) 55%, rgba(190,238,208,0.88) 100%)',
    ringColor: '#34C759',
    glowColor: 'rgba(52,199,89,0.55)',
    floatDuration: 3.5,
  },
  {
    id: 'feelings',
    label: 'مشاعري',
    image: 'illus-feelings.png',
    // rose glass
    bg: 'linear-gradient(148deg, rgba(255,246,250,0.97) 0%, rgba(255,230,240,0.94) 55%, rgba(255,210,228,0.88) 100%)',
    ringColor: '#FF375F',
    glowColor: 'rgba(255,55,95,0.55)',
    floatDuration: 4.0,
  },
];

function GazeCard({ card, index }: { card: typeof CARDS[0]; index: number }) {
  const [gazing, setGazing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entranceDelay = index * 0.1;
  // Each card floats at a different phase so they don't all move in sync
  const floatDelay = index * 0.9;

  const startGaze = useCallback(() => {
    setGazing(true);
    timerRef.current = setTimeout(() => {
      // placeholder — real eye-tracking fires this after 2 s dwell
    }, 2000);
  }, []);

  const stopGaze = useCallback(() => {
    setGazing(false);
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  return (
    // Outer: entrance animation (opacity + scale, no y conflict)
    <motion.div
      className="flex flex-col items-center"
      style={{ gap: 'clamp(14px, 2vh, 22px)' }}
      initial={{ opacity: 0, scale: 0.86 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, delay: entranceDelay, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Inner: continuous floating breath — independent from entrance y */}
      <motion.div
        className="flex flex-col items-center"
        style={{ gap: 'clamp(14px, 2vh, 22px)' }}
        animate={{ y: [0, -10, 0] }}
        transition={{
          duration: card.floatDuration,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: floatDelay,
        }}
      >
        {/* Ring + bubble sized via CSS min() */}
        <div
          className="relative flex items-center justify-center"
          style={{ width: 'min(220px, 24.5vh)', aspectRatio: '1' }}
        >
          {/* SVG gaze-progress ring */}
          <svg
            viewBox="0 0 240 240"
            className="absolute pointer-events-none"
            style={{
              inset: '-5%',
              width: '110%',
              height: '110%',
              transform: 'rotate(-90deg)',
              // glow only while gazing
              filter: gazing ? `drop-shadow(0 0 7px ${card.glowColor})` : 'none',
              transition: 'filter 0.3s ease',
            }}
          >
            {/* Faint track */}
            <circle cx={120} cy={120} r={112}
              fill="none" stroke={card.ringColor} strokeWidth={3}
              opacity={gazing ? 0.18 : 0}
              style={{ transition: 'opacity 0.25s' }}
            />
            {/* Animated fill */}
            <motion.circle cx={120} cy={120} r={112}
              fill="none" stroke={card.ringColor}
              strokeWidth={4.5} strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={gazing
                ? { pathLength: 1, opacity: 1 }
                : { pathLength: 0, opacity: 0 }}
              transition={{
                pathLength: { duration: 2, ease: 'linear' },
                opacity: { duration: 0.15 },
              }}
            />
          </svg>

          {/* Frosted-glass circular bubble */}
          <motion.div
            className="relative overflow-hidden flex items-center justify-center"
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: card.bg,
              backdropFilter: 'blur(28px) saturate(160%)',
              WebkitBackdropFilter: 'blur(28px) saturate(160%)',
              border: '1.5px solid rgba(255,255,255,0.90)',
              boxShadow: [
                '0 22px 56px rgba(0,0,0,0.11)',
                '0 6px 18px rgba(0,0,0,0.07)',
                '0 1px 3px rgba(0,0,0,0.04)',
                'inset 0 2px 0 rgba(255,255,255,0.80)',
                'inset 0 -1px 0 rgba(0,0,0,0.04)',
              ].join(', '),
              cursor: 'none',
            }}
            animate={gazing ? { scale: 1.09 } : { scale: 1 }}
            transition={{ type: 'spring', stiffness: 170, damping: 17 }}
            onMouseEnter={startGaze}
            onMouseLeave={stopGaze}
            onFocus={startGaze}
            onBlur={stopGaze}
            data-gaze-target="true"
            data-gaze-id={card.id}
            data-gaze-label={card.label}
            id={`gaze-card-${card.id}`}
            role="button"
            tabIndex={0}
            aria-label={card.label}
          >
            {/* Specular light reflection — top arc */}
            <div
              aria-hidden
              style={{
                position: 'absolute',
                top: 0, left: 0, right: 0,
                height: '46%',
                borderRadius: '50% 50% 0 0 / 100% 100% 0 0',
                background: 'linear-gradient(180deg, rgba(255,255,255,0.52) 0%, transparent 100%)',
                pointerEvents: 'none',
              }}
            />
            <img
              src={import.meta.env.BASE_URL + card.image}
              alt={card.label}
              style={{ width: '82%', height: '82%', objectFit: 'contain', position: 'relative', zIndex: 1 }}
              draggable={false}
            />
          </motion.div>
        </div>

        {/* Label — large, no subtitle */}
        <span
          className="font-bold text-[#1C1C1E]"
          style={{
            fontSize: 'clamp(1.05rem, 1.5vw, 1.4rem)',
            letterSpacing: '0.01em',
            textShadow: '0 1px 3px rgba(255,255,255,0.8)',
          }}
        >
          {card.label}
        </span>
      </motion.div>
    </motion.div>
  );
}

function CommunicationScreen() {
  const [, navigate] = useLocation();

  return (
    <div
      className="h-[100dvh] overflow-hidden flex flex-col relative"
      dir="rtl"
      style={{
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        background: 'linear-gradient(160deg, #FFFDF7 0%, #F8F8FC 50%, #F2F2F8 100%)',
      }}
    >
      {/* ── AMBIENT LIGHT BLOBS ── */}
      {/* Each blob is a large soft radial gradient — no patterns, no distractions */}
      <div aria-hidden style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
      }}>
        {/* Top-right warm glow */}
        <div style={{
          position: 'absolute', top: '-18%', right: '-12%',
          width: '55vw', height: '55vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,220,140,0.38) 0%, transparent 68%)',
          filter: 'blur(48px)',
        }} />
        {/* Bottom-left cool lavender */}
        <div style={{
          position: 'absolute', bottom: '-20%', left: '-10%',
          width: '52vw', height: '52vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(190,200,255,0.28) 0%, transparent 68%)',
          filter: 'blur(56px)',
        }} />
        {/* Center subtle cream */}
        <div style={{
          position: 'absolute', top: '25%', left: '30%',
          width: '40vw', height: '40vw',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,240,210,0.20) 0%, transparent 70%)',
          filter: 'blur(60px)',
        }} />
      </div>

      {/* ── HEADER ── */}
      <motion.div
        className="flex-none relative z-10 flex items-center justify-center px-6 pt-6 pb-3"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Emergency — absolute right side (RTL: insetInlineStart) */}
        <motion.button
          whileTap={{ scale: 0.92 }}
          // Gentle continuous pulse every few seconds
          animate={{
            boxShadow: [
              '0 4px 18px rgba(255,59,48,0.42), 0 1px 4px rgba(255,59,48,0.22)',
              '0 6px 28px rgba(255,59,48,0.68), 0 2px 8px rgba(255,59,48,0.38)',
              '0 4px 18px rgba(255,59,48,0.42), 0 1px 4px rgba(255,59,48,0.22)',
            ],
          }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute text-white font-bold rounded-full flex items-center gap-2"
          style={{
            insetInlineStart: '24px',
            background: 'linear-gradient(135deg, #FF3B30 0%, #FF6B35 100%)',
            padding: '13px 24px',
            fontSize: '1rem',
          }}
          aria-label="طوارئ"
        >
          <span role="img" aria-hidden>🚨</span>
          <span>طوارئ</span>
        </motion.button>

        {/* Title — centered */}
        <div className="flex flex-col items-center text-center gap-[6px] pointer-events-none">
          <h1
            className="font-bold text-[#0A0A0A] leading-tight tracking-tight"
            style={{ fontSize: 'clamp(1.55rem, 2.3vw, 2.1rem)' }}
          >
            ماذا تحتاج؟
          </h1>
          <p className="font-normal text-[#AEAEB2] flex items-center gap-[5px]"
            style={{ fontSize: 'clamp(0.74rem, 0.95vw, 0.84rem)' }}>
            <Eye className="w-[10px] h-[10px] shrink-0"
              style={{ animation: 'gaze-blink 2.5s ease-in-out infinite' }} />
            انظر إلى الخيار لمدة ثانيتين للاختيار
          </p>
        </div>

        {/* Back — absolute left side (RTL: insetInlineEnd) */}
        <motion.button
          onClick={() => navigate('/')}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 360, damping: 20 }}
          className="absolute flex items-center justify-center"
          style={{
            insetInlineEnd: '24px',
            width: '48px', height: '48px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.80)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            boxShadow: '0 2px 14px rgba(0,0,0,0.09), inset 0 1px 0 rgba(255,255,255,0.90)',
            border: '1px solid rgba(255,255,255,0.92)',
          }}
          aria-label="رجوع"
        >
          <ChevronRight className="w-5 h-5 text-[#3C3C43]" strokeWidth={2} />
        </motion.button>
      </motion.div>

      {/* ── CARDS — centered 2×2 floating circles ── */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-6 pb-6">
        <div
          className="grid grid-cols-2"
          style={{ gap: 'clamp(32px, 5vw, 60px)' }}
        >
          {CARDS.map((card, i) => (
            <GazeCard key={card.id} card={card} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/communicate" component={CommunicationScreen} />
          <Route component={() => (
            <div className="min-h-[100dvh] flex items-center justify-center text-center p-8 bg-[#FAFAFA] text-[#0A0A0A]" dir="rtl" style={{fontFamily: "'IBM Plex Sans Arabic', sans-serif"}}>
              الصفحة غير موجودة
            </div>
          )} />
        </Switch>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
