import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import type { ExchangeAccountResponse } from '../api/client';
import { ConfirmModal } from '../components/ConfirmModal';
import { TradingChart } from '../components/TradingChart';
import { Wallet, ChevronDown, Power, Play, Lock, FlaskConical, TrendingUp, Pencil, Check, X as XIcon, Loader2 } from 'lucide-react';

type Mode = 'paper' | 'invest';

export const Dashboard = () => {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  const [account, setAccount] = useState<ExchangeAccountResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [confirmInvest, setConfirmInvest] = useState(false);
  const [investBalance, setInvestBalance] = useState('0');
  const [noKeyModal, setNoKeyModal] = useState(false);
  const [togglingActive, setTogglingActive] = useState(false);

  const [editingBalance, setEditingBalance] = useState(false);
  const [balanceDraft, setBalanceDraft] = useState('0');
  const [savingBalance, setSavingBalance] = useState(false);

  const isActive = account?.isActive ?? false;

  const fetchAccount = useCallback(async () => {
    try {
      const list = await api.listExchangeAccounts();
      setAccount(list[0] ?? null);
    } catch {
      setAccount(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccount();
  }, [fetchAccount]);

  const mode: Mode = account?.isPaperTrading === false ? 'invest' : 'paper';

  const switchToInvest = async () => {
    if (!account) return;
    const parsed = Number(investBalance);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setSavingMode(true);
    try {
      const updated = await api.updateExchangeAccount(account.id, {
        allocatedBalance: parsed,
        isPaperTrading: false,
        isActive: account.isActive,
      });
      setAccount(updated);
      await refresh();
    } finally {
      setSavingMode(false);
      setConfirmInvest(false);
    }
  };

  const saveBalance = async () => {
    if (!account) return;
    const parsed = Number(balanceDraft);
    if (!Number.isFinite(parsed) || parsed < 0) return;
    setSavingBalance(true);
    try {
      const updated = await api.updateExchangeAccount(account.id, {
        allocatedBalance: parsed,
        isPaperTrading: account.isPaperTrading,
        isActive: account.isActive,
      });
      setAccount(updated);
    } finally {
      setSavingBalance(false);
      setEditingBalance(false);
    }
  };

  const startEditingBalance = () => {
    if (!account) return;
    setBalanceDraft(String(account.allocatedBalance));
    setEditingBalance(true);
  };

  const openInvestModal = () => {
    setInvestBalance(String(account?.allocatedBalance ?? 0));
    setConfirmInvest(true);
  };

  const toggleActive = async () => {
    if (!account || togglingActive) return;
    setTogglingActive(true);
    try {
      const updated = await api.updateExchangeAccount(account.id, {
        allocatedBalance: account.allocatedBalance,
        isPaperTrading: account.isPaperTrading,
        isActive: !account.isActive,
      });
      setAccount(updated);
    } finally {
      setTogglingActive(false);
    }
  };

  const switchToPaper = async () => {
    if (!account) return;
    setSavingMode(true);
    try {
      const updated = await api.updateExchangeAccount(account.id, {
        allocatedBalance: account.allocatedBalance,
        isPaperTrading: true,
        isActive: account.isActive,
      });
      setAccount(updated);
      await refresh();
    } finally {
      setSavingMode(false);
    }
  };

  const handleSelectMode = (target: Mode) => {
    if (target === mode || savingMode) return;
    if (target === 'invest') {
      if (!account || !account.apiKeyMasked) {
        setNoKeyModal(true);
        return;
      }
      openInvestModal();
    } else {
      switchToPaper();
    }
  };

  return (
    <div className="min-h-screen pt-32 pb-20 px-6">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Painel de Controle</h1>
            <p className="text-white/60 mt-1 text-sm">
              Olá, {user?.name ?? 'trader'}. Modo atual:{' '}
              <span className={mode === 'invest' ? 'text-primary font-semibold' : 'text-amber-300 font-semibold'}>
                {mode === 'invest' ? 'Invest (capital real)' : 'Paper Trading (capital fictício)'}
              </span>
            </p>
          </div>

          <ModeToggle mode={mode} onSelect={handleSelectMode} disabled={loading || savingMode} />
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="glass-card p-6">
            <div className="flex justify-between items-center mb-4">
              <span className="text-white/60 font-medium">
                Saldo {mode === 'paper' ? '(Paper)' : '(Invest)'}
              </span>
              <Wallet className="text-primary" size={20} />
            </div>

            {editingBalance ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 font-mono">$</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    autoFocus
                    value={balanceDraft}
                    onChange={(e) => setBalanceDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveBalance();
                      if (e.key === 'Escape') setEditingBalance(false);
                    }}
                    disabled={savingBalance}
                    className="w-full pl-7 pr-2 py-2 rounded-lg bg-white/5 border border-primary/40 text-white font-mono tabular-nums text-2xl outline-none focus:border-primary"
                  />
                </div>
                <button
                  onClick={saveBalance}
                  disabled={savingBalance}
                  title="Salvar"
                  className="p-2 rounded-lg bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50"
                >
                  {savingBalance ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                </button>
                <button
                  onClick={() => setEditingBalance(false)}
                  disabled={savingBalance}
                  title="Cancelar"
                  className="p-2 rounded-lg bg-white/5 text-white/60 hover:bg-white/10 disabled:opacity-50"
                >
                  <XIcon size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-baseline gap-2 group">
                <h2 className="text-3xl font-bold text-white font-mono tabular-nums">
                  ${(account?.allocatedBalance ?? 0).toFixed(2)}
                </h2>
                <button
                  onClick={startEditingBalance}
                  disabled={!account}
                  title={account ? 'Editar saldo' : 'Cadastre a conta primeiro'}
                  className="text-white/30 hover:text-primary transition-colors p-1 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Pencil size={14} />
                </button>
              </div>
            )}

            <p className="text-sm text-white/40 mt-2">
              {mode === 'paper' ? 'Simulado em FDUSD' : 'Capital alocado real em FDUSD'}
            </p>
          </div>

          <div className="glass-card p-6">
            <div className="flex justify-between items-center mb-4">
              <span className="text-white/60 font-medium">Status do Robô</span>
              <ActivityIndicator active={isActive} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-4 leading-none">
              {isActive ? 'Online e Analisando' : 'Pausado'}
            </h2>
            <button
              onClick={toggleActive}
              disabled={!account || togglingActive}
              title={account ? undefined : 'Cadastre a conta primeiro'}
              className={`w-full py-2 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                isActive
                  ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30'
                  : 'bg-primary/20 text-primary hover:bg-primary/30'
              }`}
            >
              {togglingActive ? (
                <><Loader2 size={18} className="animate-spin" /> Salvando…</>
              ) : isActive ? (
                <><Power size={18} /> Pausar Bot</>
              ) : (
                <><Play size={18} /> Iniciar Bot</>
              )}
            </button>
          </div>

          <div className="glass-card p-6">
            <div className="flex justify-between items-center mb-4">
              <span className="text-white/60 font-medium">Par de Trading</span>
              <Lock className="text-white/40" size={18} />
            </div>
            <button
              type="button"
              disabled
              title="Disponível em breve"
              className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-white/10 bg-white/5 text-left cursor-not-allowed opacity-70"
            >
              <span className="text-xl font-bold text-white tracking-widest font-mono">BTC / FDUSD</span>
              <ChevronDown size={18} className="text-white/40" />
            </button>
            <p className="text-xs text-amber-300/80 mt-3 leading-snug">
              Beta: a seleção de outros pares ainda será implementada. Por ora o bot opera apenas BTC/FDUSD (zero taxa Binance).
            </p>
          </div>
        </div>

        <TradingChart hours={24} interval="3m" symbol="BTCFDUSD" />
      </div>

      <ConfirmModal
        open={confirmInvest}
        title="Ativar modo Invest (capital real)?"
        message={
          <div className="space-y-3">
            <p>
              A partir de agora o bot enviará <strong>ordens reais</strong> à Binance usando suas API keys cadastradas.
              Defina o capital que será alocado:
            </p>
            <div>
              <label className="block text-xs font-medium text-white/60 mb-1.5">Capital alocado (FDUSD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 font-mono">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={investBalance}
                  onChange={(e) => setInvestBalance(e.target.value)}
                  className="w-full pl-7 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white font-mono tabular-nums outline-none focus:border-primary"
                />
              </div>
            </div>
            <p className="text-amber-300/80 text-xs">
              Você pode voltar para Paper Trading a qualquer momento.
            </p>
          </div>
        }
        confirmLabel={savingMode ? 'Ativando…' : 'Ativar Invest'}
        cancelLabel="Cancelar"
        danger
        onConfirm={switchToInvest}
        onCancel={() => setConfirmInvest(false)}
      />

      <ConfirmModal
        open={noKeyModal}
        title="Cadastre suas API keys"
        message={
          <p>
            Para operar no modo Invest com capital real, você precisa primeiro cadastrar as chaves de API da Binance.
            Vamos te levar para o tutorial e o formulário.
          </p>
        }
        confirmLabel="Cadastrar agora"
        cancelLabel="Agora não"
        onConfirm={() => navigate('/onboarding/api-keys')}
        onCancel={() => setNoKeyModal(false)}
      />
    </div>
  );
};

interface ModeToggleProps {
  mode: Mode;
  onSelect: (m: Mode) => void;
  disabled?: boolean;
}

const ModeToggle = ({ mode, onSelect, disabled }: ModeToggleProps) => (
  <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
    <ToggleOption
      active={mode === 'paper'}
      onClick={() => onSelect('paper')}
      disabled={disabled}
      icon={<FlaskConical size={14} />}
      label="Paper"
      color="amber"
    />
    <ToggleOption
      active={mode === 'invest'}
      onClick={() => onSelect('invest')}
      disabled={disabled}
      icon={<TrendingUp size={14} />}
      label="Invest"
      color="primary"
    />
  </div>
);

interface ToggleOptionProps {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
  color: 'amber' | 'primary';
}

const ToggleOption = ({ active, onClick, disabled, icon, label, color }: ToggleOptionProps) => {
  const activeClass =
    color === 'amber'
      ? 'bg-amber-500 text-background'
      : 'bg-primary text-background';
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-4 py-1.5 rounded-full text-sm font-semibold flex items-center gap-1.5 transition-colors leading-none ${
        active ? activeClass : 'text-white/60 hover:text-white'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {icon} {label}
    </button>
  );
};

const ActivityIndicator = ({ active }: { active: boolean }) => (
  <div className="relative flex h-3 w-3">
    {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>}
    <span className={`relative inline-flex rounded-full h-3 w-3 ${active ? 'bg-primary' : 'bg-gray-500'}`}></span>
  </div>
);
