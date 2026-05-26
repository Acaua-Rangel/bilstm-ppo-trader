import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Wallet, CheckCircle, Power, Play } from 'lucide-react';

export const Dashboard = () => {
  const { user } = useAuth();
  const [balance, setBalance] = useState(1000.0);
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    console.log("Fetching data for UID:", user?.binanceUid);
  }, [user]);

  return (
    <div className="min-h-screen pt-32 pb-20 px-6">
      <div className="container mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold text-white mb-8">Painel de Controle</h1>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="glass-card p-6">
            <div className="flex justify-between items-center mb-4">
              <span className="text-white/60 font-medium">Saldo (Paper Trading)</span>
              <Wallet className="text-primary" size={20} />
            </div>
            <h2 className="text-3xl font-bold text-white">${balance.toFixed(2)}</h2>
            <p className="text-sm text-white/40 mt-2">Simulado em USDT</p>
          </div>

          <div className="glass-card p-6">
            <div className="flex justify-between items-center mb-4">
              <span className="text-white/60 font-medium">Status do Robô</span>
              <ActivityIndicator active={isActive} />
            </div>
            <h2 className="text-2xl font-bold text-white mb-4">
              {isActive ? "Online e Analisando" : "Pausado"}
            </h2>
            <button 
              onClick={() => setIsActive(!isActive)}
              className={`w-full py-2 rounded-lg font-bold flex items-center justify-center gap-2 transition-colors ${
                isActive ? 'bg-red-500/20 text-red-500 hover:bg-red-500/30' : 'bg-primary/20 text-primary hover:bg-primary/30'
              }`}
            >
              {isActive ? <><Power size={18} /> Pausar Bot</> : <><Play size={18} /> Iniciar Bot</>}
            </button>
          </div>

          <div className="glass-card p-6">
            <div className="flex justify-between items-center mb-4">
              <span className="text-white/60 font-medium">Par</span>
              <CheckCircle className="text-primary" size={20} />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-widest">BTC / FDUSD</h2>
            <p className="text-sm text-primary/80 mt-2">Zero Taxa Binance</p>
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-6 border-b border-white/10 pb-4">Histórico de Operações</h3>
          <div className="text-center py-10 text-white/40">
            Nenhuma operação recente encontrada. O modelo BiLSTM-PPO irá operar no próximo candle de 15m se identificar uma oportunidade.
          </div>
        </div>
      </div>
    </div>
  );
};

const ActivityIndicator = ({ active }: { active: boolean }) => {
  return (
    <div className="relative flex h-3 w-3">
      {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${active ? 'bg-primary' : 'bg-gray-500'}`}></span>
    </div>
  );
};
