export interface GeminiNativeChatOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
}

export interface GeminiNativeResult {
  ok: boolean;
  text?: string;
  model?: string;
  error?: string;
  status?: number;
}

function sanitizeHttpUrl(raw: string): string {
  let value = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
  if (value && !/^https?:\/\//i.test(value)) value = `https://${value}`;
  return value.replace(/\/+$/, '');
}

function sanitizeApiKey(raw: string): string {
  const value = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
  return value.replace(/^bearer\s+/i, '').trim();
}

function normalizeModel(raw: string): string {
  return String(raw || '').trim().replace(/^models\//i, '');
}

function baseGeminiEndpoint(endpoint: string): string {
  return sanitizeHttpUrl(endpoint)
    .replace(/\/models\/[^/]+:generateContent$/i, '')
    .replace(/\/models$/i, '');
}

export function resolveGeminiGenerateContentUrl(endpoint: string, model: string): string {
  const base = baseGeminiEndpoint(endpoint);
  const normalizedModel = normalizeModel(model);
  if (!base || !normalizedModel) return '';
  if (/:generateContent$/i.test(sanitizeHttpUrl(endpoint))) return sanitizeHttpUrl(endpoint);
  return `${base}/models/${encodeURIComponent(normalizedModel)}:generateContent`;
}

export function resolveGeminiModelsUrl(endpoint: string): string {
  const base = baseGeminiEndpoint(endpoint);
  return base ? `${base}/models` : '';
}

export function buildGeminiRequestBody(options: Pick<GeminiNativeChatOptions, 'system' | 'user' | 'temperature' | 'json' | 'maxTokens'>, includeJsonMime = true) {
  const generationConfig: Record<string, unknown> = {
    temperature: options.temperature ?? 0.7
  };
  if (options.maxTokens) generationConfig.maxOutputTokens = options.maxTokens;
  if (options.json && includeJsonMime) generationConfig.responseMimeType = 'application/json';

  return {
    systemInstruction: {
      parts: [{ text: options.system }]
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: options.user }]
      }
    ],
    generationConfig
  };
}

export function extractGeminiText(data: any): string {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim();
}

export function parseGeminiModelsPayload(data: unknown): string[] {
  const models = Array.isArray((data as any)?.models) ? (data as any).models : [];
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of models) {
    const methods = Array.isArray(item?.supportedGenerationMethods)
      ? item.supportedGenerationMethods
      : [];
    if (methods.length > 0 && !methods.includes('generateContent')) continue;
    const id = normalizeModel(typeof item === 'string' ? item : item?.name || item?.id || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function responseError(status: number, rawText: string, data: any): string {
  return String(
    data?.error?.message ||
    data?.message ||
    rawText.slice(0, 400) ||
    `HTTP ${status}`
  ).trim();
}

function networkError(error: any): { message: string; status: number } {
  if (error?.name === 'AbortError') return { message: '请求超时', status: 504 };
  const code = String(error?.cause?.code || error?.code || '').trim();
  if (code) return { message: `连接服务商失败（${code}）`, status: 502 };
  return { message: error?.message || '网络异常', status: 502 };
}

export async function callGeminiNativeChat(options: GeminiNativeChatOptions): Promise<GeminiNativeResult> {
  const apiKey = sanitizeApiKey(options.apiKey);
  const model = normalizeModel(options.model);
  const url = resolveGeminiGenerateContentUrl(options.endpoint, model);
  if (!url) return { ok: false, error: '请输入 Gemini 接口地址和模型' };
  if (!apiKey) return { ok: false, error: '请输入 API Key' };

  const bodies = [
    buildGeminiRequestBody(options),
    ...(options.json ? [buildGeminiRequestBody(options, false)] : [])
  ];
  let lastError = '请求失败';
  let lastStatus: number | undefined;

  for (const body of bodies) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 60000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const rawText = await response.text();
      let data: any = null;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = null;
      }

      if (!response.ok) {
        lastStatus = response.status;
        lastError = responseError(response.status, rawText, data);
        if (response.status !== 400 && response.status !== 422) break;
        continue;
      }

      const text = extractGeminiText(data);
      if (text) return { ok: true, text, model, status: response.status };
      lastError = 'Gemini 未返回有效文本';
      break;
    } catch (error: any) {
      const failure = networkError(error);
      lastError = failure.message;
      lastStatus = failure.status;
      break;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return { ok: false, error: lastError, status: lastStatus };
}

export async function fetchGeminiNativeModelList(endpoint: string, apiKey: string): Promise<{
  ok: true;
  models: string[];
  modelUrlUsed: string;
} | {
  ok: false;
  error: string;
  status: number;
}> {
  const url = resolveGeminiModelsUrl(endpoint);
  const key = sanitizeApiKey(apiKey);
  if (!url) return { ok: false, error: '请输入 Gemini 接口地址', status: 400 };
  if (!key) return { ok: false, error: '请输入 API Key', status: 400 };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-goog-api-key': key
      },
      signal: controller.signal
    });
    const rawText = await response.text();
    let data: any = null;
    try {
      data = JSON.parse(rawText);
    } catch {
      data = null;
    }
    if (!response.ok) {
      return { ok: false, error: responseError(response.status, rawText, data), status: response.status };
    }
    return { ok: true, models: parseGeminiModelsPayload(data), modelUrlUsed: url };
  } catch (error: any) {
    const failure = networkError(error);
    return { ok: false, error: failure.message, status: failure.status };
  } finally {
    clearTimeout(timeoutId);
  }
}
