import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { motion } from 'framer-motion';

const queryClient = new QueryClient();

function Home() {
  return (
    <div 
      className="h-[100svh] w-full flex flex-col items-center justify-between bg-white relative overflow-hidden px-6 py-12"
      dir="rtl"
      style={{ fontFamily: "'IBM Plex Sans Arabic', sans-serif" }}
    >
      {/* Subtle background ambient gradient */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'radial-gradient(circle at 50% 50%, rgba(10,132,255,0.03) 0%, rgba(255,255,255,0) 70%)'
      }} />

      {/* Top - Logo & Subtitle */}
      <div className="flex flex-col items-center space-y-4 mt-4 sm:mt-8 relative z-10 text-center">
        <h1 className="text-5xl md:text-[3.5rem] font-bold text-[#111] tracking-tight leading-none">
          سَم يبه
        </h1>
        <p className="text-lg md:text-[1.2rem] text-[#444] font-medium tracking-[0.03em] max-w-md mx-auto">
          التواصل بالنظر... عندما تعجز الكلمات
        </p>
      </div>

      {/* Center - Illustration */}
      <div className="flex-1 w-full flex items-center justify-center relative z-10 py-6 min-h-[40vh]">
        <img 
          src={import.meta.env.BASE_URL + 'illustration.png'} 
          alt="سَم يبه - التواصل بالنظر" 
          className="w-full max-w-[420px] max-h-full object-contain rounded-2xl"
          style={{ 
            filter: 'drop-shadow(0 16px 48px rgba(0,0,0,0.10))' 
          }}
        />
      </div>

      {/* Below Illustration - CTA Button & Caption */}
      <div className="flex flex-col items-center space-y-6 mb-4 sm:mb-8 relative z-10 w-full">
        <motion.button
          whileHover={{ 
            scale: 1.04,
            boxShadow: '0 12px 40px rgba(10,132,255,0.38)'
          }}
          whileTap={{ scale: 0.98 }}
          initial={{ boxShadow: '0 8px 32px rgba(10,132,255,0.25)' }}
          className="text-white font-semibold text-lg md:text-xl rounded-full cursor-pointer outline-none border-none"
          style={{ 
            minWidth: '220px',
            padding: '16px 48px',
            background: 'linear-gradient(135deg, #0A84FF 0%, #34AADC 100%)',
          }}
        >
          ابدأ التواصل
        </motion.button>

        <p 
          className="text-[#999999] text-center"
          dir="ltr"
          style={{ 
            fontFamily: "'Inter', sans-serif",
            fontSize: '13px',
            letterSpacing: '0.01em'
          }}
        >
          Designed to help stroke survivors communicate using eye gaze.
        </p>
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
          <Route component={() => (
            <div className="h-[100svh] flex items-center justify-center text-center p-8 bg-white text-gray-900" dir="rtl" style={{fontFamily: "'IBM Plex Sans Arabic', sans-serif"}}>
              الصفحة غير موجودة
            </div>
          )} />
        </Switch>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
