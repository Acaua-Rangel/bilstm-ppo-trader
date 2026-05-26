import { useLayoutEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import gsap from 'gsap';
import { LayoutDashboard, LogIn, LogOut } from 'lucide-react';

export const Header = () => {
  const { isAuthenticated, user, logout } = useAuth();
  const navigate = useNavigate();
  const headerRef = useRef<HTMLElement>(null);

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
      navigate(user?.hasExchangeAccount ? '/dashboard' : '/onboarding/api-keys');
    } else {
      navigate('/login');
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <header
      ref={headerRef}
      className="fixed top-0 left-0 w-full z-50 glass-card rounded-none border-t-0 border-x-0 bg-background/80"
    >
      <div className="container mx-auto px-6 h-20 flex items-center justify-between">
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
        </Link>

        <nav className="flex items-center gap-4">
          {isAuthenticated && user && (
            <div className="hidden sm:flex items-center gap-3">
              {user.avatarUrl && (
                <img src={user.avatarUrl} alt="" className="w-8 h-8 rounded-full" referrerPolicy="no-referrer" />
              )}
              <span className="text-white/80 text-sm">{user.name ?? user.email}</span>
              <button
                onClick={handleLogout}
                className="text-white/60 hover:text-white transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <LogOut size={16} /> Sair
              </button>
            </div>
          )}

          <div className="animated-border-btn" onClick={handleAuthAction}>
            <div className="btn-inner">
              {isAuthenticated ? (
                <>
                  <LayoutDashboard size={18} className="text-primary" />
                  <span className="font-semibold text-white">Dashboard</span>
                </>
              ) : (
                <>
                  <LogIn size={18} className="text-binance" />
                  <span className="font-semibold text-white">Entrar com Google</span>
                </>
              )}
            </div>
          </div>
        </nav>
      </div>
    </header>
  );
};
