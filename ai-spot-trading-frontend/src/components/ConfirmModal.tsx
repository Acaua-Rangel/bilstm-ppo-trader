import { useEffect } from 'react';
import { AlertTriangle, X } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal = ({
  open,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger,
  onConfirm,
  onCancel,
}: Props) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-background/95 backdrop-blur-2xl p-6 shadow-2xl">
        <button
          onClick={onCancel}
          className="absolute top-3 right-3 text-white/40 hover:text-white p-1 rounded-lg hover:bg-white/5"
        >
          <X size={18} />
        </button>

        <div className="flex items-start gap-4 mb-4">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
              danger ? 'bg-amber-500/10 text-amber-400' : 'bg-primary/10 text-primary'
            }`}
          >
            <AlertTriangle size={20} />
          </div>
          <h3 className="text-lg font-bold text-white pt-1">{title}</h3>
        </div>

        <div className="text-sm text-white/70 leading-relaxed mb-6">{message}</div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/5 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 rounded-xl font-bold transition-colors ${
              danger
                ? 'bg-amber-500 text-background hover:bg-amber-400'
                : 'bg-primary text-background hover:bg-primary/90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
