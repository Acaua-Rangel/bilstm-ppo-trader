import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { consumeGoogleCallback } from '../auth/googleOAuth';
import { Loader2 } from 'lucide-react';

export const AuthCallback = () => {
  const navigate = useNavigate();
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    (async () => {
      try {
        const { idToken, returnTo } = consumeGoogleCallback();
        await loginWithGoogle(idToken);
        navigate(returnTo, { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Falha no callback do Google.');
      }
    })();
  }, [loginWithGoogle, navigate]);

  return (
    <div className="min-h-screen pt-32 pb-20 px-6 flex flex-col items-center">
      {error ? (
        <div className="glass-card p-8 max-w-md text-center">
          <h2 className="text-xl font-bold text-red-400 mb-2">Erro ao autenticar</h2>
          <p className="text-white/70 text-sm mb-6">{error}</p>
          <button
            onClick={() => navigate('/', { replace: true })}
            className="py-2 px-6 rounded-xl bg-primary text-background font-bold hover:bg-primary/90"
          >
            Voltar
          </button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 mt-20">
          <Loader2 className="text-primary animate-spin" size={32} />
          <p className="text-white/70">Concluindo login…</p>
        </div>
      )}
    </div>
  );
};
