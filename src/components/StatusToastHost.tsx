import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { StatusToast, hideStatusToast, subscribeStatusToast } from '../utils/statusToast';

const TONE_DOT: Record<StatusToast['tone'], string> = {
  info: 'text-zinc-200',
  ok: 'text-emerald-300',
  warn: 'text-amber-300',
  error: 'text-rose-300',
  progress: 'text-amber-300'
};

export const StatusToastHost: React.FC = () => {
  const [toast, setToast] = useState<StatusToast | null>(null);

  useEffect(() => subscribeStatusToast(setToast), []);

  if (!toast) return null;

  const Icon =
    toast.tone === 'ok' ? CheckCircle2
      : toast.tone === 'error' ? AlertCircle
        : toast.tone === 'progress' ? Loader2
          : Info;

  return (
    <div
      id="status-toast-host"
      className="pointer-events-none fixed top-4 left-1/2 -translate-x-1/2 z-[80] w-[min(560px,calc(100vw-7rem))]"
    >
      <div className="pointer-events-auto mx-auto flex items-center gap-2.5 rounded-2xl border border-white/12 bg-zinc-950/55 px-4 py-2.5 text-[13px] text-zinc-100 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <Icon className={`w-4 h-4 flex-shrink-0 ${TONE_DOT[toast.tone]} ${toast.tone === 'progress' ? 'animate-spin' : ''}`} />
        <span className="min-w-0 flex-1 leading-snug">{toast.text}</span>
        {toast.actionLabel && toast.onAction && (
          <button
            type="button"
            onClick={() => {
              const run = toast.onAction;
              hideStatusToast(toast.id);
              run?.();
            }}
            className="flex-shrink-0 px-2.5 py-1 rounded-lg text-[12px] font-medium bg-amber-500 text-black cursor-pointer"
          >
            {toast.actionLabel}
          </button>
        )}
      </div>
    </div>
  );
};
