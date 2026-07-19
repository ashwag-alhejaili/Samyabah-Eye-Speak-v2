import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { motion } from 'framer-motion';
import { Eye, Volume2, Smartphone } from 'lucide-react';

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
    transition: { staggerChildren: 0.08, delayChildren: 0.1 }
  }
};

const commCardVariants = {
  hidden: { scale: 0.94, opacity: 0 },
  visible: { scale: 1, opacity: 1, transition: { duration: 0.4 } }
};

function CommunicationScreen() {
  return (
    <div 
      className="h-[100dvh] overflow-hidden bg-[#FAFAFA] flex flex-col text-[#0A0A0A]"
      dir="rtl"
      style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}
    >
      {/* ZONE 1 */}
      <div className="flex-none py-10 flex justify-center">
        <motion.h1 
          initial={{ y: -10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="text-[2.2rem] font-bold text-[#0A0A0A]"
        >
          ماذا تحتاج؟
        </motion.h1>
      </div>

      {/* ZONE 2 */}
      <motion.div 
        className="flex-1 px-4"
        variants={commContainerVariants}
        initial="hidden"
        animate="visible"
      >
        <div className="grid grid-cols-2 grid-rows-2 gap-4 h-full">
          {/* Card 1: Needs */}
          <motion.div
            variants={commCardVariants}
            whileHover={{ scale: 1.02, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="gaze-card bg-white rounded-[28px] flex flex-col items-center justify-center gap-4 cursor-pointer"
            style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}
            data-gaze-target="true"
            data-gaze-id="needs"
            data-gaze-label="احتياجاتي"
            id="gaze-card-needs"
            aria-label="احتياجاتي"
          >
            <span className="text-[5.5rem] leading-none">🥤</span>
            <span className="text-[1.4rem] font-bold text-[#1C1C1E]">احتياجاتي</span>
          </motion.div>

          {/* Card 2: Health */}
          <motion.div
            variants={commCardVariants}
            whileHover={{ scale: 1.02, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="gaze-card bg-white rounded-[28px] flex flex-col items-center justify-center gap-4 cursor-pointer"
            style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}
            data-gaze-target="true"
            data-gaze-id="health"
            data-gaze-label="صحتي"
            id="gaze-card-health"
            aria-label="صحتي"
          >
            <span className="text-[5.5rem] leading-none">🩺</span>
            <span className="text-[1.4rem] font-bold text-[#1C1C1E]">صحتي</span>
          </motion.div>

          {/* Card 3: Worship */}
          <motion.div
            variants={commCardVariants}
            whileHover={{ scale: 1.02, boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="gaze-card bg-white rounded-[28px] flex flex-col items-center justify-center gap-4 cursor-pointer"
            style={{ boxShadow: '0 2px 16px rgba(0,0,0,0.07)' }}
            data-gaze-target="true"
            data-gaze-id="worship"
            data-gaze-label="عبادتي"
            id="gaze-card-worship"
            aria-label="عبادتي"
          >
            <span className="text-[5.5rem] leading-none">🕌</span>
            <span className="text-[1.4rem] font-bold text-[#1C1C1E]">عبادتي</span>
          </motion.div>

          {/* Card 4: Emergency */}
          <motion.div
            variants={commCardVariants}
            whileHover={{ scale: 1.02, boxShadow: '0 8px 24px rgba(255,59,48,0.18)' }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 20 }}
            className="gaze-card bg-white rounded-[28px] flex flex-col items-center justify-center gap-4 cursor-pointer"
            style={{ boxShadow: '0 2px 20px rgba(255,59,48,0.12)' }}
            data-gaze-target="true"
            data-gaze-id="emergency"
            data-gaze-label="طوارئ"
            id="gaze-card-emergency"
            aria-label="طوارئ"
          >
            <span className="text-[5.5rem] leading-none">🚨</span>
            <span className="text-[1.4rem] font-bold text-[#1C1C1E]">طوارئ</span>
          </motion.div>
        </div>
      </motion.div>

      {/* ZONE 3 */}
      <motion.div 
        className="flex-none py-6 flex items-center justify-center gap-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.45 }}
      >
        <Eye className="w-[14px] h-[14px] text-[#AEAEB2]" style={{ animation: 'gaze-blink 2.5s ease-in-out infinite' }} />
        <span className="text-[0.88rem] text-[#AEAEB2]">
          انظر إلى الخيار لمدة ثانيتين للاختيار.
        </span>
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
