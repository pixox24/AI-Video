export type ImageErrorKind =
  | 'retry'
  | 'ratelimit'
  | 'timeout'
  | 'abort'
  | 'config'
  | 'policy'
  | 'unsupported'
  | 'fatal';

export function classifyImageError(err: unknown, userAborted = false): ImageErrorKind {
  if (userAborted) return 'abort';
  const raw = err instanceof Error ? `${err.name} ${err.message}` : String(err || '');
  const msg = raw.toLowerCase();
  if (err instanceof DOMException && err.name === 'AbortError' && userAborted) return 'abort';
  if (/已停止|operation aborted by user/.test(msg)) return 'abort';
  if (/等待超时|timed out|timeout/.test(msg) || (err instanceof DOMException && err.name === 'AbortError')) {
    return 'timeout';
  }
  if (/429|rate limit|too many|限流|quota|频率/.test(msg)) return 'ratelimit';
  if (/content.?policy|safety|nsfw|违规|moderation|敏感/.test(msg)) return 'policy';
  if (/401|403|invalid api|api key|密钥|未配置|请先填写|请先在设置|unauthorized/.test(msg)) return 'config';
  if (/不支持.*image|unsupported.*image|image_url/.test(msg)) return 'unsupported';
  if (/5\d\d|502|503|504|network|econn|fetch failed|连接|网关/.test(msg)) return 'retry';
  return 'retry';
}

export function shouldAutoRetry(kind: ImageErrorKind, attempt: number, maxRetries: number): boolean {
  if (maxRetries <= 0) return false;
  if (kind === 'abort' || kind === 'config' || kind === 'policy' || kind === 'fatal') return false;
  if (kind === 'timeout') return attempt < 1;
  return attempt < maxRetries;
}

export function shouldUseBackup(kind: ImageErrorKind): boolean {
  return kind === 'retry' || kind === 'timeout' || kind === 'ratelimit' || kind === 'unsupported' || kind === 'config';
}

export function backoffMs(attempt: number, kind: ImageErrorKind): number {
  const base = attempt <= 1 ? 1000 : attempt === 2 ? 3000 : 8000;
  const jitter = Math.floor(Math.random() * 400);
  return (kind === 'ratelimit' ? base * 2 : base) + jitter;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Object.assign(new DOMException('已停止', 'AbortError'), { code: 'abort' }));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(Object.assign(new DOMException('已停止', 'AbortError'), { code: 'abort' }));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
