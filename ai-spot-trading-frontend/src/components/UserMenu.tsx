import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ChevronDown, KeyRound, LogOut } from 'lucide-react';

export const UserMenu = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;

  const goManageKeys = () => {
    setOpen(false);
    navigate('/onboarding/api-keys');
  };

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/');
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2 py-1 rounded-full hover:bg-white/5 transition-colors"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="w-8 h-8 rounded-full"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold">
            {(user.name ?? user.email ?? '?').charAt(0).toUpperCase()}
          </div>
        )}
        <span className="hidden sm:inline text-white/80 text-sm leading-none">{user.name ?? user.email}</span>
        <ChevronDown size={14} className={`text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 p-2 z-50 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-2xl backdrop-saturate-150 shadow-[0_8px_32px_rgba(0,0,0,0.5)]">
          <div className="px-3 py-3 border-b border-white/10 space-y-1">
            <div className="font-semibold text-white text-sm truncate leading-none">{user.name ?? 'Usuário'}</div>
            <div className="text-white/50 text-xs truncate leading-none">{user.email}</div>
          </div>

          <div className="py-1">
            <MenuItem icon={<KeyRound size={16} />} label="Gerenciar API keys" onClick={goManageKeys} />
            <MenuItem
              icon={<LogOut size={16} />}
              label="Sair"
              onClick={handleLogout}
              danger
            />
          </div>
        </div>
      )}
    </div>
  );
};

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

const MenuItem = ({ icon, label, onClick, danger }: MenuItemProps) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm leading-none transition-colors ${
      danger ? 'text-red-400 hover:bg-red-500/10' : 'text-white/80 hover:bg-white/5 hover:text-white'
    }`}
  >
    <span className={danger ? 'text-red-400' : 'text-white/50'}>{icon}</span>
    {label}
  </button>
);
