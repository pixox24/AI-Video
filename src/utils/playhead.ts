type PlayheadListener = (time: number) => void;

let playheadTime = 0;
const listeners = new Set<PlayheadListener>();

export function getPlayhead(): number {
  return playheadTime;
}

export function setPlayhead(time: number) {
  const next = Number.isFinite(time) ? Math.max(0, time) : 0;
  playheadTime = next;
  listeners.forEach((listener) => {
    try {
      listener(next);
    } catch {
      // ignore subscriber errors
    }
  });
}

export function subscribePlayhead(listener: PlayheadListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
