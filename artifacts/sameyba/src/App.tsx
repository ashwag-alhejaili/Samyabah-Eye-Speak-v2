import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Eye, Volume2, Smartphone, Settings } from 'lucide-react';

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

const commContainerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.2 }
  }
};

const commCardVariants = {
  hidden: { scale: 0.94, opacity: 0, y: 12 },
  visible: { scale: 1, opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] } }
};

const CARDS = [
  {
    id: 'needs',
    label: 'احتياجاتي',
    image: 'scene-needs.jpg',
    bg: 'linear-gradient(145deg, #FFF3DC, #FFE8B4)',
    glow: 'rgba(255, 180, 50, 0.45)',
    overlay: 'linear-gradient(to top, rgba(160,90,10,0.82) 0%, rgba(160,90,10,0.3) 50%, transparent 100%)',
  },
  {
    id: 'health',
    label: 'صحتي',
    image: 'scene-health.jpg',
    bg: 'linear-gradient(145deg, #DCF0FF, #C0E2FF)',
    glow: 'rgba(30, 140, 255, 0.40)',
    overlay: 'linear-gradient(to top, rgba(10,60,120,0.82) 0%, rgba(10,60,120,0.3) 50%, transparent 100%)',
  },
  {
    id: 'worship',
    label: 'عبادتي',
    image: 'scene-worship.jpg',
    bg: 'linear-gradient(145deg, #F5ECD7, #EDD9B0)',
    glow: 'rgba(180, 130, 40, 0.45)',
    overlay: 'linear-gradient(to top, rgba(90,55,10,0.82) 0%, rgba(90,55,10,0.3) 50%, transparent 100%)',
  },
  {
    id: 'feelings',
    label: 'مشاعري',
    image: 'scene-feelings.jpg',
    bg: 'linear-gradient(145deg, #FFE4E4, #FFD0D0)',
    glow: 'rgba(220, 60, 60, 0.38)',
    overlay: 'linear-gradient(to top, rgba(120,20,20,0.82) 0%, rgba(120,20,20,0.3) 50%, transparent 100%)',
  },
];

function CommunicationScreen() {
  return (
    <div
      className="h-[100dvh] overflow-hidden flex flex-col"
      dir="rtl"
      style={{
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        background: 'linear-gradient(160deg, #F2F2F7 0%, #E8E8EF 100%)',
      }}
    >
      {/* ── HEADER ── */}
      <motion.div
        className="flex-none grid items-center px-5 pt-5 pb-3"
        style={{ gridTemplateColumns: '1fr auto 1fr' }}
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Emergency — right side (first col in RTL) */}
        <div className="flex justify-start">
          <motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.93 }}
            className="text-white font-bold text-[1.05rem] rounded-full flex items-center gap-2 shrink-0"
            style={{
              background: 'linear-gradient(135deg, #FF3B30 0%, #FF6B35 100%)',
              padding: '13px 26px',
              boxShadow: '0 4px 24px rgba(255,59,48,0.50), 0 1px 4px rgba(255,59,48,0.30)',
            }}
            aria-label="طوارئ"
          >
            <span role="img" aria-hidden>🚨</span>
            <span>طوارئ</span>
          </motion.button>
        </div>

        {/* Title — center */}
        <div className="flex flex-col items-center text-center gap-[2px]">
          <h1 className="text-[1.75rem] font-bold text-[#0A0A0A] leading-tight tracking-tight">
            ماذا تحتاج؟
          </h1>
          <p className="text-[0.78rem] font-normal text-[#8E8E93] flex items-center gap-1">
            <Eye className="w-[11px] h-[11px] shrink-0" style={{ animation: 'gaze-blink 2.5s ease-in-out infinite' }} />
            انظر إلى الخيار لمدة ثانيتين للاختيار
          </p>
        </div>

        {/* Settings — left side (last col in RTL) */}
        <div className="flex justify-end">
          <motion.button
            whileHover={{ scale: 1.08, rotate: 30 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 350, damping: 20 }}
            className="w-11 h-11 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(255,255,255,0.70)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
              border: '1px solid rgba(255,255,255,0.90)',
            }}
            aria-label="الإعدادات"
          >
            <Settings className="w-5 h-5 text-[#3C3C43]" strokeWidth={1.8} />
          </motion.button>
        </div>
      </motion.div>

      {/* ── CARDS GRID ── */}
      <motion.div
        className="flex-1 grid grid-cols-2 grid-rows-2 gap-3 px-3 pb-3 min-h-0"
        variants={commContainerVariants}
        initial="hidden"
        animate="visible"
      >
        {CARDS.map((card) => (
          <motion.div
            key={card.id}
            variants={commCardVariants}
            whileHover={{
              scale: 1.025,
              boxShadow: `0 0 0 3px ${card.glow}, 0 16px 48px rgba(0,0,0,0.18)`,
            }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="relative overflow-hidden cursor-pointer"
            style={{
              borderRadius: '32px',
              background: card.bg,
              boxShadow: '0 4px 20px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
            }}
            data-gaze-target="true"
            data-gaze-id={card.id}
            data-gaze-label={card.label}
            id={`gaze-card-${card.id}`}
            aria-label={card.label}
            role="button"
            tabIndex={0}
          >
            {/* Scene image — full bleed */}
            <img
              src={import.meta.env.BASE_URL + card.image}
              alt={card.label}
              className="absolute inset-0 w-full h-full object-cover"
              style={{ borderRadius: '32px' }}
            />

            {/* Bottom gradient overlay */}
            <div
              className="absolute inset-0"
              style={{
                background: card.overlay,
                borderRadius: '32px',
              }}
            />

            {/* Card label */}
            <div className="absolute bottom-0 inset-x-0 pb-5 flex items-end justify-center">
              <span
                className="text-white font-bold drop-shadow-lg"
                style={{
                  fontSize: 'clamp(1.2rem, 2.2vw, 1.6rem)',
                  textShadow: '0 2px 12px rgba(0,0,0,0.50)',
                  letterSpacing: '0.01em',
                }}
              >
                {card.label}
              </span>
            </div>
          </motion.div>
        ))}
      </motion.div>
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
