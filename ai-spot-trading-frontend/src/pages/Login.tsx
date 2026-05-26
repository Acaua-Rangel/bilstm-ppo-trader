import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { ShieldCheck, KeyRound, Bot } from 'lucide-react';

export const Login = () => {
  const navigate = useNavigate();
  const { loginWithGoogle } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleCredential = async (idToken: string) => {
    setError(null);
    setBusy(true);
    try {
      await loginWithGoogle(idToken);
      navigate('/onboarding/api-keys');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao autenticar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen pt-32 pb-20 px-6">
      <div className="container mx-auto max-w-xl">
        <div className="glass-card p-10">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
              <Bot className="text-primary" size={32} />
            </div>
            <h1 className="text-3xl font-bold text-white mb-3">Bem-vindo ao Apex Vision</h1>
            <p className="text-white/60">
              Faça login com sua conta Google. Depois você conecta sua API da Binance.
            </p>
          </div>

          <div className="mb-8">
            <GoogleSignInButton onCredential={handleCredential} onError={setError} />
            {busy && <p className="text-center text-white/60 mt-4 text-sm">Autenticando…</p>}
            {error && (
              <p className="text-center text-red-400 mt-4 text-sm bg-red-500/10 rounded-lg p-3 border border-red-500/20">
                {error}
              </p>
            )}
          </div>

          <div className="space-y-3 text-sm text-white/60 border-t border-white/10 pt-6">
            <div className="flex gap-3">
              <ShieldCheck size={18} className="text-primary shrink-0 mt-0.5" />
              <span>Suas chaves da Binance são criptografadas com AES-256 antes de salvar.</span>
            </div>
            <div className="flex gap-3">
              <KeyRound size={18} className="text-primary shrink-0 mt-0.5" />
              <span>Você cria a API key na sua conta Binance e cola aqui — não pedimos sua senha.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
