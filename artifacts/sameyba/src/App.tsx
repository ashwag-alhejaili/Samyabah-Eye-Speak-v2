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
    subtitle: 'ماء • قهوة • طعام',
    image: 'scene-needs.jpg',
    bg: 'linear-gradient(160deg, #FFFAF0 0%, #FFF3DC 60%, #FFE8B4 100%)',
    imgBg: 'rgba(255, 220, 140, 0.25)',
    glow: 'rgba(255, 180, 50, 0.50)',
    titleColor: '#6B3A00',
    subtitleColor: '#A0620A',
  },
  {
    id: 'health',
    label: 'صحتي',
    subtitle: 'سرير • دواء • مساعدة',
    image: 'scene-health.jpg',
    bg: 'linear-gradient(160deg, #F0F8FF 0%, #DCF0FF 60%, #C0E2FF 100%)',
    imgBg: 'rgba(150, 210, 255, 0.25)',
    glow: 'rgba(30, 140, 255, 0.45)',
    titleColor: '#003A6B',
    subtitleColor: '#1060A0',
  },
  {
    id: 'worship',
    label: 'عبادتي',
    subtitle: 'صلاة • وضوء • قرآن',
    image: 'scene-worship.jpg',
    bg: 'linear-gradient(160deg, #FFFBF0 0%, #F5ECD7 60%, #EDD9B0 100%)',
    imgBg: 'rgba(220, 175, 90, 0.20)',
    glow: 'rgba(180, 130, 40, 0.50)',
    titleColor: '#4A2E00',
    subtitleColor: '#7A5010',
  },
  {
    id: 'feelings',
    label: 'مشاعري',
    subtitle: 'سعيد • متعب • متألم',
    image: 'scene-feelings.jpg',
    bg: 'linear-gradient(160deg, #FFF5F5 0%, #FFE4E4 60%, #FFD0D0 100%)',
    imgBg: 'rgba(255, 160, 160, 0.20)',
    glow: 'rgba(220, 60, 60, 0.42)',
    titleColor: '#6B0000',
    subtitleColor: '#A02020',
  },
];

function CommunicationScreen() {
  const [, navigate] = useLocation();

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
        className="flex-none grid items-center px-5 pt-5 pb-2"
        style={{ gridTemplateColumns: '1fr auto 1fr' }}
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Emergency — right side (first col in RTL grid) */}
        <div className="flex justify-start">
          <motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.93 }}
            className="text-white font-bold text-[1rem] rounded-full flex items-center gap-2 shrink-0"
            style={{
              background: 'linear-gradient(135deg, #FF3B30 0%, #FF6B35 100%)',
              padding: '12px 24px',
              boxShadow: '0 4px 20px rgba(255,59,48,0.48), 0 1px 4px rgba(255,59,48,0.28)',
            }}
            aria-label="طوارئ"
          >
            <span role="img" aria-hidden>🚨</span>
            <span>طوارئ</span>
          </motion.button>
        </div>

        {/* Title — center */}
        <div className="flex flex-col items-center text-center gap-[3px]">
          <h1 className="text-[1.65rem] font-bold text-[#0A0A0A] leading-tight tracking-tight">
            ماذا تحتاج؟
          </h1>
          <p className="text-[0.76rem] font-normal text-[#8E8E93] flex items-center gap-[5px]">
            <Eye className="w-[10px] h-[10px] shrink-0" style={{ animation: 'gaze-blink 2.5s ease-in-out infinite' }} />
            انظر إلى الخيار لمدة ثانيتين للاختيار
          </p>
        </div>

        {/* Back button — left side (last col in RTL grid) */}
        <div className="flex justify-end">
          <motion.button
            onClick={() => navigate('/')}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 350, damping: 20 }}
            className="w-11 h-11 rounded-full flex items-center justify-center"
            style={{
              background: 'rgba(255,255,255,0.72)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.10)',
              border: '1px solid rgba(255,255,255,0.90)',
            }}
            aria-label="رجوع"
          >
            {/* ChevronRight points left visually in RTL = back */}
            <ChevronRight className="w-5 h-5 text-[#3C3C43]" strokeWidth={2} />
          </motion.button>
        </div>
      </motion.div>

      {/* ── CARDS GRID ── */}
      <motion.div
        className="flex-1 grid grid-cols-2 grid-rows-2 gap-4 px-4 pb-4 min-h-0"
        variants={commContainerVariants}
        initial="hidden"
        animate="visible"
      >
        {CARDS.map((card) => (
          <motion.div
            key={card.id}
            variants={commCardVariants}
            whileHover={{
              scale: 1.022,
              boxShadow: `0 0 0 2.5px ${card.glow}, 0 14px 40px rgba(0,0,0,0.14)`,
            }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
            className="flex flex-col overflow-hidden cursor-pointer"
            style={{
              borderRadius: '32px',
              background: card.bg,
              boxShadow: '0 6px 24px rgba(0,0,0,0.09), 0 1px 4px rgba(0,0,0,0.05)',
            }}
            data-gaze-target="true"
            data-gaze-id={card.id}
            data-gaze-label={card.label}
            id={`gaze-card-${card.id}`}
            aria-label={card.label}
            role="button"
            tabIndex={0}
          >
            {/* Image area — top 55%, with inner padding so it floats inside the card */}
            <div
              className="flex-none flex items-center justify-center overflow-hidden"
              style={{
                height: '55%',
                padding: '16px 16px 8px',
              }}
            >
              <div
                className="w-full h-full rounded-[22px] overflow-hidden"
                style={{ background: card.imgBg }}
              >
                <img
                  src={import.meta.env.BASE_URL + card.image}
                  alt={card.label}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Text area — bottom 45%, generous white-ish space */}
            <div
              className="flex-1 flex flex-col items-center justify-center text-center gap-1 px-4 pb-5"
            >
              <span
                className="font-bold leading-tight"
                style={{
                  fontSize: 'clamp(1.15rem, 2vw, 1.55rem)',
                  color: card.titleColor,
                  letterSpacing: '0.01em',
                }}
              >
                {card.label}
              </span>
              <span
                className="font-normal leading-snug"
                style={{
                  fontSize: 'clamp(0.72rem, 1.1vw, 0.88rem)',
                  color: card.subtitleColor,
                  opacity: 0.85,
                }}
              >
                {card.subtitle}
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
