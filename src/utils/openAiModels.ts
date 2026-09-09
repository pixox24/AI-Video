/** OpenAI-compatible /v1/models helpers for LLM and image providers. */

export function sanitizeOpenAiEndpoint(raw: string): string {
  let val = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (val && !val.startsWith('http://') && !val.startsWith('https://')) val = 'https://' + val;
  return val.replace(/\/+$/, '');
}

const BAILIAN_BEIJING = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const BAILIAN_INTL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const BAILIAN_US = 'https://dashscope-us.aliyuncs.com/compatible-mode/v1';

/** Normalize 百炼 / DashScope chat base to OpenAI-compatible /compatible-mode/v1. */
export function resolveBailianLlmEndpoint(raw: string): string {
  const val = sanitizeOpenAiEndpoint(raw);
  if (!val) return BAILIAN_BEIJING;
  const withoutChat = val.replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
  if (/\/compatible-mode\/v1$/i.test(withoutChat)) return withoutChat;
  if (/\/compatible-mode$/i.test(withoutChat)) return `${withoutChat}/v1`;
  if (/dashscope-intl/i.test(val)) return BAILIAN_INTL;
  if (/dashscope-us/i.test(val)) return BAILIAN_US;
  if (/dashscope/i.test(val)) return BAILIAN_BEIJING;
  try {
    const url = new URL(val);
    if (/\.maas\.aliyuncs\.com$/i.test(url.hostname)) {
      return `${url.protocol}//${url.hostname}/compatible-mode/v1`;
    }
  } catch {
    // ignore
  }
  return withoutChat;
}

export function extractOpenAiChatText(data: unknown): string {
  const payload = data as any;
  const message = payload?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (
        typeof part === 'string'
          ? part
          : String(part?.text || part?.content || part?.value || '')
      ))
      .join('');
    if (joined.trim()) return joined.trim();
  }
  if (content && typeof content === 'object') {
    if (typeof (content as any).text === 'string' && (content as any).text.trim()) {
      return String((content as any).text).trim();
    }
    try {
      const encoded = JSON.stringify(content);
      if (encoded && encoded !== '{}' && encoded !== 'null') return encoded;
    } catch {
      // ignore
    }
  }
  const reasoning = message?.reasoning_content || message?.reasoning;
  if (typeof reasoning === 'string' && reasoning.trim() && /[{[]/.test(reasoning)) {
    return reasoning.trim();
  }
  const fallback = payload?.choices?.[0]?.text || payload?.output_text || '';
  return typeof fallback === 'string' ? fallback.trim() : '';
}

export function sanitizeOpenAiApiKey(raw: string): string {
  let val = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (val.toLowerCase().startsWith('bearer ')) val = val.slice(7).trim();
  return val;
}

export function resolveOpenAiModelsUrls(endpoint: string): string[] {
  const rawEndpoint = sanitizeOpenAiEndpoint(endpoint);
  if (!rawEndpoint) return [];

  let baseUrl = rawEndpoint
    .replace(/\/images\/generations.*$/i, '')
    .replace(/\/chat\/completions.*$/i, '')
    .replace(/\/+$/, '');
  if (/\/v1$/i.test(baseUrl)) {
    baseUrl = baseUrl.replace(/\/v1$/i, '');
  }

  const urls = [
    `${baseUrl}/v1/models`,
    `${baseUrl}/models`,
    `${rawEndpoint}/models`
  ];
  return Array.from(new Set(urls.filter(Boolean)));
}

export function parseOpenAiModelsPayload(data: unknown): string[] {
  let rawList: unknown[] = [];
  if (Array.isArray((data as any)?.data)) {
    rawList = (data as any).data;
  } else if (Array.isArray((data as any)?.models)) {
    rawList = (data as any).models;
  } else if (Array.isArray(data)) {
    rawList = data;
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of rawList) {
    const id = typeof item === 'string'
      ? item
      : String((item as any)?.id || (item as any)?.name || (item as any)?.model || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

const NON_CHAT_KEYWORDS = [
  'embedding', 'embed', 'rerank', 'whisper', 'tts', 'audio', 'speech',
  'transcribe', 'realtime', 'moderation',
  'dall-e', 'dalle', 'flux', 'stable-diffusion', 'midjourney',
  'kolors', 'recraft', 'ideogram', 'cogview', 'imagen',
  'kling', 'runway', 'sora', 'luma', 'veo', 'wanx', 'wan2',
  'cosyvoice', 'paraformer', 'sambert', 'fun-asr',
  'image', 'video'
];

export function isLikelyChatModel(id: string): boolean {
  const lower = String(id || '').toLowerCase();
  if (!lower) return false;
  return !NON_CHAT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function classifyLlmChatModels(ids: string[]): {
  chatModels: string[];
  skipped: string[];
} {
  const chatModels: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    if (isLikelyChatModel(id)) chatModels.push(id);
    else skipped.push(id);
  }
  return {
    chatModels: chatModels.length > 0 ? chatModels : [...ids],
    skipped: chatModels.length > 0 ? skipped : []
  };
}

export async function fetchOpenAiCompatibleModelList(endpoint: string, apiKey: string): Promise<{
  ok: true;
  models: string[];
  modelUrlUsed: string;
} | {
  ok: false;
  error: string;
  status: number;
}> {
  const cleanApiKey = sanitizeOpenAiApiKey(apiKey);
  const candidateUrls = resolveOpenAiModelsUrls(endpoint);
  if (candidateUrls.length === 0) {
    return { ok: false, error: '请输入 API 接口地址', status: 400 };
  }
  let lastError = '';
  let lastStatus = 500;
  for (const modelUrl of candidateUrls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(modelUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cleanApiKey}`,
          Accept: 'application/json'
        },
        signal: controller.signal
      });
      if (response.ok) {
        const data = await response.json();
        return {
          ok: true,
          models: parseOpenAiModelsPayload(data),
          modelUrlUsed: modelUrl
        };
      }
      lastStatus = response.status;
      const errBody = await response.text();
      lastError = `[HTTP ${response.status}] ${String(errBody || '').slice(0, 400) || '获取模型列表失败'}`;
    } catch (err: any) {
      lastError = err?.name === 'AbortError' ? '请求超时' : (err?.message || '请求超时或网络异常');
    } finally {
      clearTimeout(timeoutId);
    }
  }
  return { ok: false, error: lastError || '无法从端点获取模型列表', status: lastStatus };
}
