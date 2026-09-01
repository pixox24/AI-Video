import { CustomImageApiConfig, ImageRetryConfig } from '../types';
import { isImageApiReady, resolveImageApi, resolveImageRetry } from './presets';
import {
  backoffMs,
  classifyImageError,
  ImageErrorKind,
  shouldAutoRetry,
  shouldUseBackup,
  sleep
} from './imageGenerateRetry';

export interface VisualGenerateBody {
  prompt: string;
  visualStyle?: string;
  styleRender?: string;
  aspectRatio?: string;
  seed?: number;
  characterRef?: { url: string; name: string } | undefined;
}

export interface VisualGenerateResult {
  imageUrl: string;
  source?: string;
  usedBackup: boolean;
  attempts: number;
}

export async function postVisualGenerate(
  body: VisualGenerateBody,
  api: CustomImageApiConfig,
  signal?: AbortSignal
): Promise<{ imageUrl: string; source?: string }> {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), 360000);
  const onAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch('/api/visual/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...body,
        customApi: resolveImageApi(api)
      }),
      signal: timeoutController.signal
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.imageUrl) {
      throw new Error(data?.diagnosis || data?.error || `HTTP ${res.status}: 生图接口未返回有效画面`);
    }
    return { imageUrl: data.imageUrl, source: data.source };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      if (signal?.aborted) {
        throw Object.assign(new Error('已停止'), { name: 'AbortError' });
      }
      throw new Error('等待超时：供应商后台可能已出图，但接口未在时限内返回。请重试。');
    }
    throw err;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function generateImageWithRetry(
  body: VisualGenerateBody,
  options: {
    primary: CustomImageApiConfig | undefined;
    backup?: CustomImageApiConfig | undefined;
    retry?: ImageRetryConfig | null;
    signal?: AbortSignal;
    onAttempt?: (info: { attempt: number; max: number; usingBackup: boolean; kind?: ImageErrorKind }) => void;
  }
): Promise<VisualGenerateResult> {
  const retry = resolveImageRetry(options.retry);
  const primary = resolveImageApi(options.primary);
  if (!isImageApiReady(primary)) {
    throw new Error('请先在设置里配置生图供应商和 API Key');
  }

  const maxRetries = retry.enabled ? retry.maxRetries : 0;
  let lastError: unknown;
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (options.signal?.aborted) throw Object.assign(new Error('已停止'), { name: 'AbortError' });
    attempts = attempt + 1;
    if (attempt > 0) {
      options.onAttempt?.({ attempt, max: maxRetries, usingBackup: false });
      const kind = classifyImageError(lastError, options.signal?.aborted);
      await sleep(backoffMs(attempt, kind), options.signal);
    }
    try {
      const result = await postVisualGenerate(body, primary, options.signal);
      return { ...result, usedBackup: false, attempts };
    } catch (err) {
      lastError = err;
      const kind = classifyImageError(err, options.signal?.aborted);
      if (!shouldAutoRetry(kind, attempt, maxRetries)) break;
    }
  }

  const backup = resolveImageApi(options.backup);
  const lastKind = classifyImageError(lastError, options.signal?.aborted);
  if (
    retry.useBackup
    && isImageApiReady(backup)
    && shouldUseBackup(lastKind)
    && lastKind !== 'policy'
    && lastKind !== 'abort'
    && !options.signal?.aborted
  ) {
    options.onAttempt?.({ attempt: attempts, max: maxRetries, usingBackup: true, kind: lastKind });
    try {
      const result = await postVisualGenerate(body, backup, options.signal);
      return { ...result, usedBackup: true, attempts: attempts + 1 };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || '生图失败'));
}
