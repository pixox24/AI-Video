export type StatusTone = 'info' | 'ok' | 'warn' | 'error' | 'progress';

export interface StatusToast {
  id: string;
  text: string;
  tone: StatusTone;
  sticky?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}

type Listener = (toast: StatusToast | null) => void;

const listeners = new Set<Listener>();
let current: StatusToast | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  listeners.forEach((listener) => {
    try {
      listener(current);
    } catch {
      // ignore subscriber errors
    }
  });
}

export function showStatusToast(
  text: string,
  opts?: {
    tone?: StatusTone;
    durationMs?: number;
    id?: string;
    actionLabel?: string;
    onAction?: () => void;
  }
) {
  const tone = opts?.tone || 'info';
  const sticky = opts?.durationMs === 0 || tone === 'progress';
  const duration = opts?.durationMs ?? (opts?.actionLabel ? 8000 : tone === 'error' ? 4200 : 2400);

  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  current = {
    id: opts?.id || `toast-${Date.now()}`,
    text,
    tone,
    sticky,
    actionLabel: opts?.actionLabel,
    onAction: opts?.onAction
  };
  emit();

  if (!sticky) {
    hideTimer = setTimeout(() => {
      current = null;
      hideTimer = null;
      emit();
    }, duration);
  }
}

export function hideStatusToast(id?: string) {
  if (id && current?.id !== id) return;
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  current = null;
  emit();
}

export function subscribeStatusToast(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => {
    listeners.delete(listener);
  };
}
