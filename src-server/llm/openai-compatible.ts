import { callGeminiNativeChat } from "../../src/utils/geminiNative";
import {
  extractOpenAiChatText,
  resolveBailianLlmEndpoint
} from "../../src/utils/openAiModels";
import { errorMessage, toLoose } from "../loose";
import { sanitizeBearerKey, sanitizeHttpUrl } from "../http";
import type { ChatCallResult } from "./types";

export function resolveChatCompletionUrls(endpoint: string): string[] {
  const raw = sanitizeHttpUrl(endpoint);
  if (!raw) return [];
  if (/\/chat\/completions$/i.test(raw)) return [raw];
  const urls = [`${raw}/chat/completions`];
  if (!raw.endsWith("/v1")) {
    urls.push(`${raw}/v1/chat/completions`);
  }
  return urls;
}

function readHttpErrorText(data: unknown, rawText: string): string {
  if (data && typeof data === "object") {
    const rec = toLoose(data);
    const nested = rec.error;
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const msg = toLoose(nested).message;
      if (typeof msg === "string" && msg) return msg.slice(0, 400);
    }
    if (typeof rec.message === "string" && rec.message) return rec.message.slice(0, 400);
  }
  return String(rawText || "").slice(0, 400);
}

export async function callOpenAiCompatibleChat(opts: {
  endpoint: string;
  apiKey: string;
  model: string;
  provider?: string;
  system: string;
  user: string;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<ChatCallResult> {
  if (String(opts.provider || "").toLowerCase() === "gemini") {
    return callGeminiNativeChat(opts);
  }
  const provider = String(opts.provider || "").toLowerCase();
  const endpoint = provider === "bailian" ? resolveBailianLlmEndpoint(opts.endpoint) : opts.endpoint;
  const urls = resolveChatCompletionUrls(endpoint);
  const apiKey = sanitizeBearerKey(opts.apiKey);
  const model = (opts.model || "").trim()
    || (provider === "deepseek" ? "deepseek-v4-flash" : "")
    || (provider === "bailian" ? "qwen-plus" : "");
  if (!model) {
    return { ok: false, error: "请填写模型" };
  }
  let lastError = "请求失败";
  let lastStatus: number | undefined;
  const requestedTokens = Number(opts.maxTokens) > 0 ? Math.round(Number(opts.maxTokens)) : 0;

  for (const url of urls) {
    let useJson = Boolean(opts.json);
    let tokenMode: "max_tokens" | "max_completion_tokens" | "none" = requestedTokens ? "max_tokens" : "none";
    let tokenLimit = requestedTokens ? Math.min(requestedTokens, 8192) : 0;

    for (let round = 0; round < 5; round += 1) {
      const body: Record<string, unknown> = {
        model,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user }
        ],
        temperature: opts.temperature ?? 0.7,
        stream: false
      };
      if (useJson) body.response_format = { type: "json_object" };
      if (tokenMode === "max_tokens" && tokenLimit) body.max_tokens = tokenLimit;
      if (tokenMode === "max_completion_tokens" && tokenLimit) body.max_completion_tokens = tokenLimit;
      if (provider === "deepseek") body.thinking = { type: "disabled" };
      if (provider === "bailian" || /dashscope/i.test(String(opts.endpoint || "") + url)) {
        body.enable_thinking = false;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs || 60000);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json"
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        const rawText = await response.text();
        clearTimeout(timeoutId);
        let data: unknown = null;
        try {
          data = JSON.parse(rawText);
        } catch {
          data = null;
        }
        const errorText = readHttpErrorText(data, rawText);
        const errorLower = errorText.toLowerCase();

        if (!response.ok) {
          lastStatus = response.status;
          lastError = errorText || `HTTP ${response.status}`;
          if (response.status === 400 || response.status === 422) {
            if (useJson && /response_format|json_object|json mode|json_schema/.test(errorLower)) {
              useJson = false;
              continue;
            }
            if (tokenMode === "max_tokens" && /max_tokens|unknown parameter|unsupported/.test(errorLower)) {
              tokenMode = "max_completion_tokens";
              continue;
            }
            if (tokenMode !== "none" && /max_tokens|max_completion|context length|too large|too many tokens/.test(errorLower)) {
              if (tokenLimit > 4096) {
                tokenLimit = 4096;
                continue;
              }
              tokenMode = "none";
              continue;
            }
          }
          break;
        }

        const text = extractOpenAiChatText(data);
        if (text) {
          return { ok: true, text, model, error: undefined, status: undefined };
        }
        lastError = "模型未返回有效文本";
        if (useJson) {
          useJson = false;
          continue;
        }
        break;
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        const name = err instanceof Error ? err.name : "";
        lastError = name === "AbortError" ? "请求超时" : errorMessage(err, "网络异常");
        break;
      }
    }
  }

  return { ok: false, error: lastError, status: lastStatus };
}
