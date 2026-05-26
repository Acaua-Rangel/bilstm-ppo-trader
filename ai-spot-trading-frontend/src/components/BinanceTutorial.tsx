import { useState } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, ShieldCheck, AlertTriangle } from 'lucide-react';

const steps = [
  {
    title: 'Entre no painel de API da Binance',
    body: (
      <p>
        Acesse{' '}
        <a
          href="https://www.binance.com/en/my/settings/api-management"
          target="_blank"
          rel="noreferrer"
          className="text-primary underline inline-flex items-center gap-1"
        >
          binance.com/my/settings/api-management
          <ExternalLink size={14} />
        </a>{' '}
        já logado na sua conta Binance.
      </p>
    ),
  },
  {
    title: 'Clique em "Create API"',
    body: (
      <p>
        Escolha a opção <strong>System generated</strong> (HMAC). Dê um rótulo, ex:{' '}
        <code className="px-2 py-0.5 rounded bg-white/10">ai-spot-trader</code>. Confirme com 2FA + e-mail.
      </p>
    ),
  },
  {
    title: 'Edite as permissões da chave',
    body: (
      <div className="space-y-2">
        <p>Em "Edit restrictions" deixe APENAS:</p>
        <ul className="list-disc list-inside text-white/80 space-y-1">
          <li>✅ <strong>Enable Reading</strong></li>
          <li>✅ <strong>Enable Spot &amp; Margin Trading</strong></li>
          <li>❌ <strong>NÃO marque</strong> "Enable Withdrawals"</li>
          <li>❌ <strong>NÃO marque</strong> "Enable Futures"</li>
        </ul>
      </div>
    ),
  },
  {
    title: 'Restrinja por IP (recomendado)',
    body: (
      <p>
        Em <strong>"Restrict access to trusted IPs only"</strong>, adicione o IP do servidor onde o trader rodará. Sem isso a
        Binance bloqueia ordens automatizadas após 90 dias.
      </p>
    ),
  },
  {
    title: 'Copie API Key e Secret Key',
    body: (
      <p>
        A <strong>Secret Key só aparece UMA vez</strong>. Copie as duas e cole no formulário ao lado. Após salvar elas são
        criptografadas com AES-256 no nosso banco.
      </p>
    ),
  },
];

export const BinanceTutorial = () => {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="glass-card p-6 lg:p-8">
      <div className="flex items-start gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-binance/10 flex items-center justify-center shrink-0">
          <ShieldCheck className="text-binance" size={20} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Como criar sua API Key na Binance</h2>
          <p className="text-white/60 text-sm mt-1">5 passos rápidos — leva 2 minutos</p>
        </div>
      </div>

      <div className="space-y-2">
        {steps.map((step, idx) => {
          const isOpen = open === idx;
          return (
            <div key={idx} className="border border-white/10 rounded-xl overflow-hidden">
              <button
                onClick={() => setOpen(isOpen ? null : idx)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors"
              >
                <span className="flex items-center gap-3">
                  <span className="w-7 h-7 rounded-full bg-primary/10 text-primary text-sm font-bold flex items-center justify-center">
                    {idx + 1}
                  </span>
                  <span className="font-semibold text-white">{step.title}</span>
                </span>
                {isOpen ? <ChevronUp size={18} className="text-white/60" /> : <ChevronDown size={18} className="text-white/60" />}
              </button>
              {isOpen && (
                <div className="px-4 pb-4 pt-1 text-white/70 text-sm border-t border-white/5">
                  {step.body}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 flex gap-3">
        <AlertTriangle className="text-amber-400 shrink-0 mt-0.5" size={18} />
        <div className="text-sm text-amber-100/90">
          <strong>Importante:</strong> jamais habilite saques (Withdrawals) nem Futures nessa chave. Se vazar, o atacante só
          consegue operar Spot — seus fundos não saem da Binance.
        </div>
      </div>
    </div>
  );
};
