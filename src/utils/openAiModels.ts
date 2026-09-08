/** OpenAI-compatible /v1/models helpers for LLM and image providers. */

export function sanitizeOpenAiEndpoint(raw: string): string {
  let val = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (val && !val.startsWith('http://') && !val.startsWith('https://')) val = 'https://' + val;
  return val.replace(/\/+$/, '');
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
  'kling', 'runway', 'sora', 'luma', 'veo', 'wanx',
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
