import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { BinanceTutorial } from '../components/BinanceTutorial';
import { KeyRound, Eye, EyeOff, Loader2 } from 'lucide-react';

export const ConnectBinance = () => {
  const navigate = useNavigate();
  const { refresh, user } = useAuth();

  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [binanceUid, setBinanceUid] = useState('');
  const [allocatedBalance, setAllocatedBalance] = useState('100');
  const [isPaperTrading, setIsPaperTrading] = useState(true);
  const [showSecret, setShowSecret] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.createExchangeAccount({
        apiKey: apiKey.trim(),
        apiSecret: apiSecret.trim(),
        binanceUid: binanceUid.trim() || undefined,
        allocatedBalance: Number(allocatedBalance),
        isPaperTrading,
      });
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar API key.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen pt-32 pb-20 px-6">
      <div className="container mx-auto max-w-6xl">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-white">Conecte sua conta Binance</h1>
          <p className="text-white/60 mt-2">
            Olá {user?.name ?? user?.email}! Para o bot operar, precisamos das suas API keys da Binance.
            Suas chaves ficam criptografadas e podem ser revogadas a qualquer momento pelo painel da Binance.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <BinanceTutorial />

          <div className="glass-card p-6 lg:p-8">
            <div className="flex items-start gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <KeyRound className="text-primary" size={20} />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Minhas credenciais Binance</h2>
                <p className="text-white/60 text-sm mt-1">Os dados são criptografados antes de salvar.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              <Field label="API Key">
                <input
                  type="text"
                  required
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="cole sua API key"
                  className="form-input"
                  autoComplete="off"
                />
              </Field>

              <Field label="Secret Key">
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    required
                    value={apiSecret}
                    onChange={(e) => setApiSecret(e.target.value)}
                    placeholder="cole sua secret key"
                    className="form-input pr-10"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white"
                  >
                    {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </Field>

              <Field label="Binance UID (opcional)">
                <input
                  type="text"
                  value={binanceUid}
                  onChange={(e) => setBinanceUid(e.target.value)}
                  placeholder="ex: 123456789"
                  className="form-input"
                />
              </Field>

              <Field label="Capital alocado (USDT)">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={allocatedBalance}
                  onChange={(e) => setAllocatedBalance(e.target.value)}
                  className="form-input"
                />
              </Field>

              <label className="flex items-start gap-3 p-4 rounded-xl border border-white/10 cursor-pointer hover:bg-white/5 transition-colors">
                <input
                  type="checkbox"
                  checked={isPaperTrading}
                  onChange={(e) => setIsPaperTrading(e.target.checked)}
                  className="mt-1"
                />
                <div>
                  <div className="font-semibold text-white">Paper Trading</div>
                  <div className="text-sm text-white/60">
                    Simulado. Recomendado para os primeiros dias — nenhuma ordem real é enviada à Binance.
                  </div>
                </div>
              </label>

              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 rounded-lg p-3 border border-red-500/20">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 rounded-xl bg-primary text-background font-bold flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {submitting && <Loader2 size={18} className="animate-spin" />}
                {submitting ? 'Salvando…' : 'Conectar e ir para o Dashboard'}
              </button>
            </form>
          </div>
        </div>
      </div>

      <style>{`
        .form-input {
          width: 100%;
          padding: 0.75rem 1rem;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 0.75rem;
          color: white;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
          font-size: 0.9rem;
          outline: none;
          transition: border-color .2s;
        }
        .form-input:focus { border-color: rgb(113 200 41); }
      `}</style>
    </div>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="block text-sm font-medium text-white/70 mb-2">{label}</label>
    {children}
  </div>
);
