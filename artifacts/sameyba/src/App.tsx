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

// ─── Gaze-card sizing — adapts to the shorter viewport dimension ───
// Circle: min(220px, 27vh). SVG ring wraps 10px outside the circle on each side.
const CARD_PX = 220; // nominal; CSS clamp handles actual render size
const RING_R = 112;
const RING_CX = 120;
const RING_CY = 120;

const CARDS = [
  {
    id: 'needs',
    label: 'احتياجاتي',
    subtitle: 'ماء • قهوة • طعام',
    image: 'illus-needs.png',
    bg: 'linear-gradient(145deg, rgba(255,251,240,0.96) 0%, rgba(255,244,220,0.92) 100%)',
    ringColor: '#FF9F0A',
  },
  {
    id: 'health',
    label: 'صحتي',
    subtitle: 'سرير • دواء • مساعدة',
    image: 'illus-health.png',
    bg: 'linear-gradient(145deg, rgba(240,248,255,0.96) 0%, rgba(220,238,255,0.92) 100%)',
    ringColor: '#0A84FF',
  },
  {
    id: 'worship',
    label: 'عبادتي',
    subtitle: 'صلاة • وضوء • قرآن',
    image: 'illus-worship.png',
    bg: 'linear-gradient(145deg, rgba(242,255,245,0.96) 0%, rgba(220,248,230,0.92) 100%)',
    ringColor: '#34C759',
  },
  {
    id: 'feelings',
    label: 'مشاعري',
    subtitle: 'سعيد • هادئ • متألم',
    image: 'illus-feelings.png',
    bg: 'linear-gradient(145deg, rgba(255,244,248,0.96) 0%, rgba(255,228,238,0.92) 100%)',
    ringColor: '#FF375F',
  },
];

// Animated circular card with gaze-progress ring.
// Size is fully responsive: the circle is min(220px, 24.5vh) so two rows + labels
// always fit within the viewport without scrolling.
function GazeCard({ card, delay }: { card: typeof CARDS[0]; delay: number }) {
  const [gazing, setGazing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // The circle is driven by CSS min() — the SVG uses a fixed viewBox and
  // width="100%" so it scales identically to the wrapper.
  // viewBox: 240×240, circle at (120,120) r=112, ring wrapper = 240×240
  // circle card = 220×220 centred in the viewBox
  return (
    <motion.div
      className="flex flex-col items-center"
      style={{ gap: 'clamp(12px, 1.8vh, 20px)' }}
      initial={{ opacity: 0, scale: 0.88, y: 22 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.65, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Ring + bubble — sized via CSS min() */}
      <div
        className="relative flex items-center justify-center"
        style={{ width: 'min(220px, 24.5vh)', aspectRatio: '1' }}
      >
        {/* SVG ring sits 4.5% outside the circle on each side, same CSS size */}
        <svg
          viewBox="0 0 240 240"
          className="absolute pointer-events-none"
          style={{
            inset: '-4.5%',
            width: '109%',
            height: '109%',
            transform: 'rotate(-90deg)',
          }}
        >
          <circle cx={120} cy={120} r={112} fill="none" stroke={card.ringColor}
            strokeWidth={3.5} opacity={gazing ? 0.14 : 0}
            style={{ transition: 'opacity 0.2s' }} />
          <motion.circle cx={120} cy={120} r={112} fill="none"
            stroke={card.ringColor} strokeWidth={3.5} strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={gazing ? { pathLength: 1, opacity: 1 } : { pathLength: 0, opacity: 0 }}
            transition={{ pathLength: { duration: 2, ease: 'linear' }, opacity: { duration: 0.15 } }}
          />
        </svg>

        {/* Circular bubble */}
        <motion.div
          className="relative flex items-center justify-center overflow-hidden"
          style={{
            width: '100%',
            height: '100%',
            borderRadius: '50%',
            background: card.bg,
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1.5px solid rgba(255,255,255,0.85)',
            boxShadow: '0 16px 44px rgba(0,0,0,0.09), 0 3px 10px rgba(0,0,0,0.06), inset 0 1.5px 0 rgba(255,255,255,0.70)',
            cursor: 'none',
          }}
          animate={gazing ? { scale: 1.08 } : { scale: 1 }}
          transition={{ type: 'spring', stiffness: 180, damping: 18 }}
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
          <img
            src={import.meta.env.BASE_URL + card.image}
            alt={card.label}
            style={{ width: '76%', height: '76%', objectFit: 'contain' }}
            draggable={false}
          />
        </motion.div>
      </div>

      {/* Label beneath bubble */}
      <div className="flex flex-col items-center text-center" style={{ gap: '4px' }}>
        <span className="font-bold text-[#1C1C1E]"
          style={{ fontSize: 'clamp(0.95rem, 1.4vw, 1.3rem)', letterSpacing: '0.01em' }}>
          {card.label}
        </span>
        <span className="font-normal text-[#AEAEB2]"
          style={{ fontSize: 'clamp(0.68rem, 0.9vw, 0.82rem)' }}>
          {card.subtitle}
        </span>
      </div>
    </motion.div>
  );
}

function CommunicationScreen() {
  const [, navigate] = useLocation();

  return (
    <div
      className="h-[100dvh] overflow-hidden flex flex-col"
      dir="rtl"
      style={{
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        background: 'radial-gradient(ellipse at 50% 20%, #FFF8EE 0%, #F5F5FA 55%, #EEEEF6 100%)',
      }}
    >
      {/* ── HEADER ── */}
      <motion.div
        className="flex-none relative flex items-center justify-center px-6 pt-6 pb-3"
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Emergency — absolute top-right */}
        <motion.button
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          className="absolute text-white font-bold text-[1rem] rounded-full flex items-center gap-2"
          style={{
            insetInlineStart: '24px', // RTL: left → right side visually
            background: 'linear-gradient(135deg, #FF3B30 0%, #FF6B35 100%)',
            padding: '12px 22px',
            boxShadow: '0 4px 20px rgba(255,59,48,0.48), 0 1px 4px rgba(255,59,48,0.25)',
          }}
          aria-label="طوارئ"
        >
          <span role="img" aria-hidden>🚨</span>
          <span>طوارئ</span>
        </motion.button>

        {/* Title — center */}
        <div className="flex flex-col items-center text-center gap-1 pointer-events-none">
          <h1
            className="font-bold text-[#0A0A0A] leading-tight tracking-tight"
            style={{ fontSize: 'clamp(1.5rem, 2.2vw, 2rem)' }}
          >
            ماذا تحتاج؟
          </h1>
          <p className="text-[0.78rem] font-normal text-[#AEAEB2] flex items-center gap-[5px]">
            <Eye className="w-[10px] h-[10px] shrink-0" style={{ animation: 'gaze-blink 2.5s ease-in-out infinite' }} />
            انظر إلى الخيار لمدة ثانيتين للاختيار
          </p>
        </div>

        {/* Back — absolute top-left */}
        <motion.button
          onClick={() => navigate('/')}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 360, damping: 20 }}
          className="absolute flex items-center justify-center"
          style={{
            insetInlineEnd: '24px', // RTL: right → left side visually
            width: '46px',
            height: '46px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.78)',
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.09)',
            border: '1px solid rgba(255,255,255,0.92)',
          }}
          aria-label="رجوع"
        >
          <ChevronRight className="w-5 h-5 text-[#3C3C43]" strokeWidth={2} />
        </motion.button>
      </motion.div>

      {/* ── CARDS — centered 2×2 grid of floating circles ── */}
      <div className="flex-1 flex items-center justify-center px-6 pb-6">
        <div
          className="grid grid-cols-2"
          style={{ gap: 'clamp(28px, 4vw, 52px)' }}
        >
          {CARDS.map((card, i) => (
            <GazeCard key={card.id} card={card} delay={i * 0.1} />
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
