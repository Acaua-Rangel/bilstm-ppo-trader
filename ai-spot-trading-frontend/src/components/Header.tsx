import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { startGoogleLogin } from '../auth/googleOAuth';
import { UserMenu } from './UserMenu';
import gsap from 'gsap';
import { LayoutDashboard, LogIn } from 'lucide-react';

export const Header = () => {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const headerRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    if (headerRef.current) {
      gsap.fromTo(
        headerRef.current,
        { y: -100, opacity: 0 },
        { y: 0, opacity: 1, duration: 1, ease: 'power3.out', delay: 0.5 }
      );
    }
  }, []);

  const handleAuthAction = () => {
    if (isAuthenticated) {
      navigate('/dashboard');
    } else {
      startGoogleLogin('/dashboard');
    }
  };

  return (
    <header
      ref={headerRef}
      className={`fixed top-0 left-0 w-full z-50 transition-all duration-300 ${
        scrolled
          ? 'bg-background/40 backdrop-blur-xl backdrop-saturate-150'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 group">
          <svg width="40" height="30" viewBox="0 0 106 76" fill="none" xmlns="http://www.w3.org/2000/svg" className="transform group-hover:scale-110 transition-transform">
            <path
              d="M26.4818 74C31.3653 38.8875 33.2531 -24.9829 47.969 14.4152C61.7465 51.301 69.5188 87.0269 54.6811 68.3235C22.8868 28.2457 -68.3957 27.8893 104 27.8893"
              stroke="#71C829"
              strokeWidth="6"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-xl font-bold tracking-wider uppercase text-white group-hover:text-primary transition-colors">
            Apex Vision
          </span>
          <span className="ml-1 px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase rounded-full bg-primary/15 text-primary border border-primary/30 leading-none">
            Beta
          </span>
        </Link>

        <nav className="flex items-center gap-4">
          {isAuthenticated && user && (
            <div className="animated-border-btn" onClick={handleAuthAction}>
              <div className="btn-inner">
                <LayoutDashboard size={18} className="text-primary" />
                <span className="font-semibold text-white">Dashboard</span>
              </div>
            </div>
          )}

          {isAuthenticated ? (
            <UserMenu />
          ) : (
            <div className="animated-border-btn" onClick={handleAuthAction}>
              <div className="btn-inner">
                <span className="font-semibold text-white">Entrar com Google</span>
                <LogIn size={18} className="text-binance" />
              </div>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
};
