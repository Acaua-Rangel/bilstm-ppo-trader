import { useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { useAuth } from '../context/AuthContext';
import { Activity, TrendingUp, ShieldCheck, Zap } from 'lucide-react';

export const LandingPage = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const heroRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(".hero-text", 
        { y: 50, opacity: 0 }, 
        { y: 0, opacity: 1, duration: 1, stagger: 0.2, ease: "power3.out", delay: 0.5 }
      );
      
      gsap.fromTo(".feature-card",
        { y: 50, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, stagger: 0.2, ease: "power3.out", scrollTrigger: ".feature-card", delay: 1 }
      );
    }, heroRef);

    return () => ctx.revert();
  }, []);

  const handleCTA = () => {
    if (isAuthenticated) {
      navigate('/dashboard');
    } else {
      navigate('/login');
    }
  };

  return (
    <div className="min-h-screen pt-32 pb-20 px-6">
      <div ref={heroRef} className="container mx-auto flex flex-col items-center text-center">
        
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card mb-8 hero-text">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
          <span className="text-sm font-medium text-white/80">BiLSTM AI Model v1.0 Online</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-6 leading-tight hero-text max-w-4xl">
          Automate your Spot Trading with <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-300">
            Deep Learning
          </span>
        </h1>

        <p className="text-lg text-white/60 mb-10 max-w-2xl hero-text leading-relaxed">
          Connect your Binance account securely. Our BiLSTM-PPO neural network analyzes the BTC/FDUSD pair 24/7, catching trends and executing trades automatically with zero-fee advantages.
        </p>

        <div className="hero-text mb-20">
            <div className="animated-border-btn" onClick={handleCTA}>
              <div className="btn-inner text-lg px-8 py-4">
                <span className="font-bold text-white uppercase tracking-wide">
                  {isAuthenticated ? "Enter Dashboard" : "Start Trading Now"}
                </span>
                <TrendingUp className="text-primary ml-2" />
              </div>
            </div>
        </div>

        <div ref={cardsRef} className="grid grid-cols-1 md:grid-cols-3 gap-8 w-full max-w-5xl">
          <div className="glass-card p-8 text-left feature-card hover:-translate-y-2 transition-transform duration-500">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
              <Activity className="text-primary" size={24} />
            </div>
            <h3 className="text-xl font-bold text-white mb-3">AI Powered</h3>
            <p className="text-white/60">Utilizes Bidirectional LSTM and Proximal Policy Optimization to predict market movements.</p>
          </div>

          <div className="glass-card p-8 text-left feature-card hover:-translate-y-2 transition-transform duration-500">
            <div className="w-12 h-12 rounded-xl bg-binance/10 flex items-center justify-center mb-6">
              <Zap className="text-binance" size={24} />
            </div>
            <h3 className="text-xl font-bold text-white mb-3">Zero Fees</h3>
            <p className="text-white/60">Optimized strictly for the BTC/FDUSD pair to take advantage of Binance's zero-fee promotion.</p>
          </div>

          <div className="glass-card p-8 text-left feature-card hover:-translate-y-2 transition-transform duration-500">
            <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mb-6">
              <ShieldCheck className="text-primary" size={24} />
            </div>
            <h3 className="text-xl font-bold text-white mb-3">100% Secure</h3>
            <p className="text-white/60">Non-custodial. Funds stay in your Binance account via encrypted Fast API keys.</p>
          </div>
        </div>

      </div>
    </div>
  );
};
