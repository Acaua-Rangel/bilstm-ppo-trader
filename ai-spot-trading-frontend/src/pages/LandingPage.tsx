import { useLayoutEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { useAuth } from '../context/AuthContext';
import { startGoogleLogin } from '../auth/googleOAuth';
import { NeuralNetworkDemo } from '../components/NeuralNetworkDemo';
import {
  Activity,
  TrendingUp,
  ShieldCheck,
  Zap,
  Brain,
  LineChart,
  Sparkles,
  ArrowRight,
  Pause,
  ShoppingCart,
  TrendingDown,
  Eye,
} from 'lucide-react';

export const LandingPage = () => {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const heroRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.hero-text',
        { y: 40, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.9, stagger: 0.15, ease: 'power3.out', delay: 0.3 },
      );
    }, heroRef);
    return () => ctx.revert();
  }, []);

  const handleCTA = () => {
    if (isAuthenticated) navigate('/dashboard');
    else startGoogleLogin('/dashboard');
  };

  return (
    <div ref={heroRef} className="min-h-screen pb-32">
      {/* ─── HERO ─────────────────────────────────────────────────────────────── */}
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-6xl mx-auto flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/20 bg-primary/5 mb-8 hero-text">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-sm font-medium text-white/80">BiLSTM · PPO · v1.0 Beta</span>
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold text-white mb-6 leading-[1.05] hero-text max-w-4xl">
            Trading com IA, ao alcance{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-300">
              de qualquer um
            </span>
          </h1>

          <p className="text-lg text-white/60 mb-10 max-w-2xl hero-text leading-relaxed">
            O Apex Vision automatiza decisões de Spot Trading na Binance usando uma rede neural
            treinada para detectar tendências reais — sem você precisar acompanhar o gráfico 24h por dia.
          </p>

          <div className="hero-text mb-4">
            <div className="cta-btn cursor-pointer" onClick={handleCTA}>
              <div className="cta-btn-inner text-lg px-8 py-4">
                <span className="font-bold text-white uppercase tracking-wide">
                  {isAuthenticated ? 'Abrir Dashboard' : 'Começar agora'}
                </span>
                <ArrowRight className="text-white" />
              </div>
            </div>
          </div>
          <p className="text-xs text-white/40 hero-text">
            Grátis durante o beta. Suas chaves Binance ficam criptografadas no nosso servidor.
          </p>
        </div>
      </section>

      {/* ─── MISSÃO ───────────────────────────────────────────────────────────── */}
      <section className="px-6 py-20">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 mb-6">
              <Sparkles size={14} className="text-primary" />
              <span className="text-xs font-semibold uppercase tracking-widest text-white/70">Missão</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-6 leading-tight">
              Democratizar o trading quantitativo com IA
            </h2>
            <div className="space-y-4 text-white/70 leading-relaxed">
              <p>
                Quem opera nas corretoras hoje compete contra fundos com modelos sofisticados, mesas de trading
                e infraestrutura que rodam 24 horas por dia. O investidor pessoa física entra nessa guerra com
                desvantagem estrutural.
              </p>
              <p>
                <strong className="text-white">O Apex Vision encurta essa distância.</strong> Você usa o mesmo
                tipo de modelo que grandes players — Deep Learning treinado em milhões de candles, com decisões
                disparadas automaticamente — sem precisar de PhD, sem precisar olhar para tela.
              </p>
              <p>
                E você nunca entrega seus fundos para a gente. Tudo opera dentro da SUA Binance, via API key
                que você mesmo cria com permissões mínimas (só trade Spot, sem saque).
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Pillar icon={<Brain size={22} />} title="Modelo aberto" body="Arquitetura CNN-BiLSTM-MHA + PPO. Treinada em dados públicos da Binance — você sabe o que está usando." />
            <Pillar icon={<ShieldCheck size={22} />} title="Não-custodial" body="Fundos ficam na Binance. Chaves criptografadas em AES-256. Sem permissão de saque." />
            <Pillar icon={<Zap size={22} />} title="Zero taxa" body="Otimizado para o par BTC/FDUSD aproveitando a promoção zero-fee da Binance." />
            <Pillar icon={<Eye size={22} />} title="Transparente" body="Cada decisão do bot vira um registro com timestamp e ADX. Você vê tudo no dashboard." />
          </div>
        </div>
      </section>

      {/* ─── COMO FUNCIONA ────────────────────────────────────────────────────── */}
      <section className="px-6 py-20 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <header className="text-center mb-14 max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-white/10 bg-white/5 mb-6">
              <Brain size={14} className="text-primary" />
              <span className="text-xs font-semibold uppercase tracking-widest text-white/70">Como funciona</span>
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 leading-tight">
              Duas entradas. Uma rede neural. Três decisões possíveis.
            </h2>
            <p className="text-white/60 leading-relaxed">
              A cada candle fechado, o Apex Vision pega o gráfico recente do preço e o indicador
              ADX, alimenta uma rede neural profunda, e decide entre <strong className="text-white">comprar</strong>,{' '}
              <strong className="text-white">não operar</strong> ou <strong className="text-white">vender</strong>.
            </p>
          </header>

          {/* DEMO 3D */}
          <NeuralNetworkDemo />

          {/* Cards explicando inputs + outputs */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
            <InputCard
              icon={<LineChart className="text-primary" size={22} />}
              label="Gráfico do preço"
              title="128 candles de histórico"
              body="O modelo recebe a janela mais recente de preços (open/high/low/close) e calcula 19 features técnicas — EMAs, RSI, MACD, Bollinger, VWAP, OBV, decomposição wavelet."
            />
            <InputCard
              icon={<Activity className="text-binance" size={22} />}
              label="Índice ADX"
              title="Average Directional Index"
              body="Mede a FORÇA de uma tendência (não a direção). Vai de 0 a 100. Treinamos o modelo para só operar com ADX ≥ 20 — abaixo disso o mercado está lateral e qualquer entrada é roleta."
            />
            <InputCard
              icon={<Brain className="text-primary" size={22} />}
              label="Rede neural"
              title="CNN-BiLSTM-MHA"
              body="Camadas convolucionais detectam padrões locais, BiLSTM captura dependências de longo prazo, atenção multi-head pondera o que importa. PPO (Reinforcement Learning) refina a política de decisão."
            />
          </div>

          {/* Outputs */}
          <div className="mt-8">
            <p className="text-center text-xs uppercase tracking-widest text-white/40 mb-4">Decisão final</p>
            <div className="grid grid-cols-3 gap-4">
              <OutputCard icon={<ShoppingCart size={20} />} label="BUY" color="primary" body="Tendência de alta confirmada. Compra a mercado." />
              <OutputCard icon={<Pause size={20} />} label="HOLD" color="neutral" body="Sem sinal claro ou ADX < 20. Não opera neste ciclo." />
              <OutputCard icon={<TrendingDown size={20} />} label="SELL" color="red" body="Reversão detectada. Fecha posição comprada." />
            </div>
          </div>
        </div>
      </section>

      {/* ─── O QUE É O ADX (deep-dive) ────────────────────────────────────────── */}
      <section className="px-6 py-20">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-2xl border border-binance/20 bg-binance/5 p-8 md:p-12">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-xl bg-binance/15 flex items-center justify-center shrink-0">
                <Activity className="text-binance" size={24} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-binance/80 mb-1">Sobre o indicador</p>
                <h3 className="text-2xl font-bold text-white">Por que o ADX importa tanto</h3>
              </div>
            </div>
            <div className="space-y-3 text-white/70 leading-relaxed">
              <p>
                O <strong className="text-white">Average Directional Index</strong> é um dos indicadores mais
                respeitados em trading porque ele responde a uma pergunta diferente da maioria: não tenta dizer
                se o preço vai subir ou cair — ele mede se o mercado tem <em>direção</em>.
              </p>
              <p>
                <strong className="text-white">Abaixo de 20</strong> o ativo está lateralizado: ruído puro,
                qualquer entrada é aposta. <strong className="text-white">Acima de 25</strong>, existe uma
                tendência real acontecendo. O modelo do Apex foi treinado para operar especificamente nesse regime.
              </p>
              <p className="text-binance/90 text-sm">
                Você consegue ver o ADX em tempo real no dashboard, com a linha do limiar 20 marcada — exatamente
                como o modelo enxerga.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── CTA FINAL ────────────────────────────────────────────────────────── */}
      <section className="px-6 py-20">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl md:text-5xl font-bold text-white mb-6 leading-tight">
            Pronto para deixar a IA <span className="text-primary">operar por você</span>?
          </h2>
          <p className="text-white/60 mb-10 max-w-xl mx-auto">
            Login com Google em 1 clique. Conecta sua Binance pelo nosso tutorial passo-a-passo.
            Começa em modo Paper Trading (capital fictício) — só vira capital real quando você decidir.
          </p>
          <div className="inline-block">
            <div className="cta-btn cursor-pointer" onClick={handleCTA}>
              <div className="cta-btn-inner text-lg px-8 py-4">
                <span className="font-bold text-white uppercase tracking-wide">
                  {isAuthenticated ? 'Abrir Dashboard' : 'Entrar com Google'}
                </span>
                <TrendingUp className="text-white" />
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

const Pillar = ({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) => (
  <div className="p-5 rounded-2xl border border-white/5 bg-white/[0.02] hover:border-primary/30 transition-colors">
    <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-3">
      {icon}
    </div>
    <h4 className="font-bold text-white mb-1.5">{title}</h4>
    <p className="text-sm text-white/55 leading-relaxed">{body}</p>
  </div>
);

const InputCard = ({
  icon,
  label,
  title,
  body,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  body: string;
}) => (
  <div className="p-6 rounded-2xl border border-white/5 bg-white/[0.02]">
    <div className="flex items-center gap-2 mb-3">
      {icon}
      <span className="text-[10px] uppercase tracking-widest text-white/40">{label}</span>
    </div>
    <h4 className="font-bold text-white mb-2">{title}</h4>
    <p className="text-sm text-white/60 leading-relaxed">{body}</p>
  </div>
);

const OutputCard = ({
  icon,
  label,
  color,
  body,
}: {
  icon: React.ReactNode;
  label: string;
  color: 'primary' | 'neutral' | 'red';
  body: string;
}) => {
  const palette = {
    primary: 'border-primary/30 bg-primary/5 text-primary',
    neutral: 'border-white/15 bg-white/5 text-white/70',
    red: 'border-red-500/30 bg-red-500/5 text-red-400',
  }[color];

  return (
    <div className={`p-5 rounded-2xl border ${palette} text-center`}>
      <div className="flex items-center justify-center gap-2 mb-2 font-bold text-lg">
        {icon}
        {label}
      </div>
      <p className="text-xs text-white/60 leading-relaxed">{body}</p>
    </div>
  );
};
