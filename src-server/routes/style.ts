// @ts-nocheck — mechanical port of server.ts style routes; behavior frozen.
import type { Express } from "express";
import type { StylePack } from "../../src/types";
import {
  PRESET_STYLE_PACKS,
  STYLE_DIRECTOR_SYSTEM,
  STYLE_INFER_SYSTEM,
  STYLE_INFER_USER,
  localRewriteClipPrompt,
  normalizeInferredPack,
  styleContractForPrompt
} from "../../src/utils/stylePack";
import { extractOpenAiChatText } from "../../src/utils/openAiModels";
import { bibleContractForPrompt, normalizeVisualBible } from "../../src/utils/visualBible";
import { sanitizeBearerKey, sanitizeHttpUrl } from "../http";
import { resolveChatCompletionUrls } from "../llm/openai-compatible";
import { incomingStyleContract } from "../style-contract";
import { isUsableLlmApi } from "../llm/client-api";
import { generateStructured } from "../llm/gateway";
import { cleanAndParseJSON } from "../llm/parse";
import { errorMessage, requestBody, toLoose, toLooseList, type Loose } from "../loose";

async function gatewayChatFromRoute(opts: {
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
}) {
  const result = await generateStructured({
    stage: "style_rewrite",
    role: "drafter",
    clientLlmApi: { enabled: true, endpoint: opts.endpoint, apiKey: opts.apiKey, model: opts.model, provider: opts.provider },
    system: opts.system,
    user: opts.user,
    temperature: opts.temperature,
    timeoutMs: opts.timeoutMs,
    maxTokens: opts.maxTokens,
    json: opts.json
  });
  if (result.data == null && !result.text) {
    return { ok: false as const, error: result.reason, text: undefined, model: result.run.model, status: undefined as number | undefined };
  }
  const text = result.text || (typeof result.data === "string" ? result.data : JSON.stringify(result.data));
  return { ok: true as const, text, model: result.run.model, error: undefined, status: undefined as number | undefined };
}

const styleInferCache = new Map<string, { pack: StylePack; at: number }>();

/** 32×32 PNG — DashScope VL requires width/height ≥ 10px. A 1×1 probe is rejected. */
const STYLE_VISION_PROBE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGM40q1HU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULAMG19EwoycpYAAAAAElFTkSuQmCC";

function resolveStyleVisionEndpoint(endpoint: string): string {
  const raw = sanitizeHttpUrl(endpoint);
  if (!raw) return "https://dashscope.aliyuncs.com/compatible-mode/v1";
  if (/multimodal-generation|\/api\/v1\/services\//i.test(raw)) {
    return /dashscope-intl/i.test(raw)
      ? "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
      : "https://dashscope.aliyuncs.com/compatible-mode/v1";
  }
  return raw;
}

function extractChatMessageText(data: unknown): string {
  const message = data?.choices?.[0]?.message;
  const content =
    (typeof message?.content === "string" && message.content) ||
    (Array.isArray(message?.content)
      ? message.content.map((part: Loose) => part?.text || "").join("")
      : "") ||
    data?.choices?.[0]?.text ||
    data?.output_text ||
    "";
  const reasoning = typeof message?.reasoning_content === "string" ? message.reasoning_content : "";
  const text = String(content || "").trim() || String(reasoning || "").trim();
  return text;
}

function mapBailianVisionError(status?: number, raw?: string): string {
  const msg = String(raw || "");
  const lower = msg.toLowerCase();
  if (status === 401 || /invalidapikey|invalid api.?key|unauthorized|incorrect api key/.test(lower)) {
    return "Key 无效，请确认是百炼控制台（北京地域）复制的 sk- Key";
  }
  if (/arrearage|out_of_service|good standing|insufficient/.test(lower)) {
    return "百炼账号欠费或余额不足，请先在费用中心充值";
  }
  if (/product is not activated|not activated/.test(lower)) {
    return "尚未在百炼模型市场开通该模型，请开通 qwen3.7-plus 后再测";
  }
  if (/model not exist|does not exist/.test(lower)) {
    return "模型名无效：请用 qwen3.7-plus，并确认已在百炼模型市场开通";
  }
  if (/image length and width|too small|do not meet the model restrictions|image size is not supported/.test(lower)) {
    return "图片尺寸不符合百炼要求（宽高需 ≥ 10 像素）";
  }
  if (/enable_thinking must be set to false|only support stream/.test(lower)) {
    return "该模型非流式调用必须关闭思考模式";
  }
  if (status === 403) {
    return "无该模型权限，请在百炼控制台开通 qwen3.7-plus";
  }
  return msg || "连通性测试失败";
}

async function callBailianVisionJson(opts: {
  endpoint: string;
  apiKey: string;
  model: string;
  system: string;
  text: string;
  imageDataUrl?: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; text?: string; error?: string; status?: number }> {
  const urls = resolveChatCompletionUrls(resolveStyleVisionEndpoint(opts.endpoint));
  const apiKey = sanitizeBearerKey(opts.apiKey);
  const model = (opts.model || "").trim() || "qwen3.7-plus";
  const imageDataUrl = String(opts.imageDataUrl || "").trim();
  let lastError = "请求失败";
  let lastStatus: number | undefined;

  const userContent: unknown = imageDataUrl
    ? [
        { type: "image_url", image_url: { url: imageDataUrl } },
        { type: "text", text: opts.text }
      ]
    : opts.text;

  const baseMessages = [
    { role: "system", content: opts.system },
    { role: "user", content: userContent }
  ];

  for (const url of urls) {
    const bodies: Record<string, unknown>[] = [
      {
        model,
        temperature: 0.2,
        stream: false,
        enable_thinking: false,
        response_format: { type: "json_object" },
        messages: baseMessages
      },
      {
        model,
        temperature: 0.2,
        stream: false,
        enable_thinking: false,
        messages: baseMessages
      }
    ];

    for (const body of bodies) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs || 90000);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const rawText = await response.text();
        let data: unknown = null;
        try {
          data = JSON.parse(rawText);
        } catch {
          data = null;
        }
        if (!response.ok) {
          lastStatus = response.status;
          lastError =
            toLoose(toLoose(data).error).message ||
            data?.message ||
            rawText.slice(0, 400) ||
            `HTTP ${response.status}`;
          continue;
        }
        const text = extractChatMessageText(data);
        if (text) {
          return { ok: true, text, status: response.status };
        }
        lastError = "模型未返回有效文本";
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        lastError = (err instanceof Error ? err.name : '') === "AbortError" ? "请求超时" : errorMessage(err) || "网络异常";
      }
    }
  }

  return { ok: false, error: lastError, status: lastStatus };
}

export function registerStyleRoutes(app: Express): void {
app.post("/api/style/vision-test", async (req, res) => {
  const visionApi = req.body?.visionApi || {};
  const endpoint = String(visionApi.endpoint || "").trim();
  const apiKey = String(visionApi.apiKey || "").trim();
  const model = String(visionApi.model || "qwen3.7-plus").trim();
  if (!apiKey) {
    return res.status(400).json({ ok: false, error: "请先填写百炼 API Key" });
  }
  const started = Date.now();

  // 1) Text ping first: tells Key / 欠费 / 未开通 apart from vision-specific errors.
  const textResult = await callBailianVisionJson({
    endpoint,
    apiKey,
    model,
    system: "只输出合法 JSON。",
    text: '只回复 JSON：{"ok":true}',
    timeoutMs: 25000
  });
  if (!textResult.ok) {
    const status = textResult.status && textResult.status >= 400 ? textResult.status : 502;
    const error = mapBailianVisionError(textResult.status, textResult.error);
    console.warn(`[Style Vision Test] text fail model=${model} status=${textResult.status || "-"}`);
    return res.status(status).json({ ok: false, error, stage: "text", latencyMs: Date.now() - started });
  }

  // 2) Vision ping with a legal-size probe (wide/height 32px). 1×1 is rejected by DashScope.
  const visionResult = await callBailianVisionJson({
    endpoint,
    apiKey,
    model,
    system: "只输出合法 JSON。",
    text: '看图后只回复 JSON：{"ok":true}',
    imageDataUrl: STYLE_VISION_PROBE_PNG,
    timeoutMs: 30000
  });
  if (!visionResult.ok) {
    const status = visionResult.status && visionResult.status >= 400 ? visionResult.status : 502;
    const mapped = mapBailianVisionError(visionResult.status, visionResult.error);
    const error = `Key 可用，但看图失败：${mapped}`;
    console.warn(`[Style Vision Test] vision fail model=${model} status=${visionResult.status || "-"}`);
    return res.status(status).json({ ok: false, error, stage: "vision", latencyMs: Date.now() - started });
  }

  return res.json({ ok: true, model, latencyMs: Date.now() - started });
});

app.post("/api/style/infer", async (req, res) => {
  const { imageDataUrl, imageHash, visionApi } = requestBody(req.body as unknown);
  const endpoint = String(visionApi?.endpoint || "").trim();
  const apiKey = String(visionApi?.apiKey || "").trim();
  const model = String(visionApi?.model || "qwen3.7-plus").trim();
  const dataUrl = String(imageDataUrl || "").trim();
  const hash = String(imageHash || "").trim();

  if (!apiKey) {
    return res.status(400).json({ ok: false, error: "请先填写百炼 API Key" });
  }
  if (!dataUrl.startsWith("data:image/")) {
    return res.status(400).json({ ok: false, error: "请上传图片" });
  }

  const cached = hash ? styleInferCache.get(hash) : undefined;
  if (cached?.pack) {
    console.log(`[Style Infer] cache hit ${hash.slice(0, 8)} model=${model}`);
    return res.json({ ok: true, pack: cached.pack, cached: true });
  }

  const started = Date.now();
  const result = await callBailianVisionJson({
    endpoint,
    apiKey,
    model,
    system: STYLE_INFER_SYSTEM,
    text: STYLE_INFER_USER,
    imageDataUrl: dataUrl,
    timeoutMs: 90000
  });

  if (!result.ok || !result.text) {
    const status = result.status && result.status >= 400 ? result.status : 502;
    const error = mapBailianVisionError(result.status, result.error || "风格反推失败");
    console.warn(`[Style Infer] fail model=${model} ${Date.now() - started}ms`);
    return res.status(status).json({ ok: false, error });
  }

  const parsed = cleanAndParseJSON(result.text);
  const pack = normalizeInferredPack(parsed, hash || `tmp${Date.now()}`);
  if (!pack) {
    return res.status(422).json({ ok: false, error: "反推结果不完整，请换图或重试" });
  }

  if (hash) styleInferCache.set(hash, { pack, at: Date.now() });
  console.log(`[Style Infer] ok model=${model} ${Date.now() - started}ms`);
  return res.json({ ok: true, pack, cached: false });
});

app.post("/api/style/rewrite-shots", async (req, res) => {
  const { clips, stylePack, llmApi, visualBible } = requestBody(req.body as unknown);
  const pack = stylePack && typeof stylePack === "object" ? (stylePack as StylePack) : PRESET_STYLE_PACKS.cinematic;
  const list = Array.isArray(clips) ? clips : [];
  if (list.length === 0) {
    return res.status(400).json({ ok: false, error: "没有可重写的分镜" });
  }

  const fallback = () =>
    list.map((clip: Loose) => {
      const rewritten = localRewriteClipPrompt(clip, pack);
      return {
        id: String(clip.id),
        chineseVisualPrompt: rewritten.chineseVisualPrompt,
        setting: "",
        subject: rewritten.chineseVisualPrompt,
        action: ""
      };
    });

  const shotLines = list
    .map((clip: Loose, index: number) => {
      return `${index + 1}. id=${clip.id}\n口播：${clip.narration || clip.voSlice || ""}\n现有画面：${clip.chineseVisualPrompt || ""}`;
    })
    .join("\n\n");

  const prompt = `${styleContractForPrompt(pack)}

请把下面每一镜改写成看得见的画面节拍。不要写生图英文长 prompt，不要把风格 DNA、参考图里的人或街道写进节拍。
每一镜只要：setting（在哪）、subject（看见谁/什么）、action（在干什么）。chineseVisualPrompt 用中文把三要素连成一句。
口播是台词，不是画面：把「别等到眼睛干涩」写成「黑暗里一双盯着手机的干涩眼睛」，不要抄口播原句。
第一镜/钩子镜的 action 必须是未完成的可见前兆，不要只写张嘴或情绪词。setting 不要把世界观说明书再写一遍。
若上文是风格基因：只在心里记住画法，节拍里不要出现厚涂/色板/参考图物体。若有画面圣经：叙事型同一角色同一空间；说明型不要编主角。不要改口播。
${bibleContractForPrompt(normalizeVisualBible(visualBible))}
${shotLines}

只输出 JSON：{"shots":[{"id":string,"setting":string,"subject":string,"action":string,"chineseVisualPrompt":string}]}`;

  try {
    if (isUsableLlmApi(llmApi)) {
      const llmResult = await gatewayChatFromRoute({
        endpoint: String(llmApi.endpoint),
        apiKey: String(llmApi.apiKey),
        model: String(llmApi.model || "deepseek-v4-flash"),
        provider: llmApi.provider,
        system: STYLE_DIRECTOR_SYSTEM,
        user: prompt,
        temperature: 0.4,
        json: true,
        timeoutMs: 90000
      });
      if (llmResult.ok && llmResult.text) {
        const parsed = cleanAndParseJSON(llmResult.text);
        if (Array.isArray(parsed?.shots) && parsed.shots.length > 0) {
          const byId = new Map<string, Loose>(parsed.shots.map((item: Loose) => [String(item.id), item]));
          return res.json({
            ok: true,
            shots: list.map((clip: Loose) => {
              const hit = byId.get(String(clip.id));
              if (hit?.subject || hit?.setting || hit?.chineseVisualPrompt) {
                return {
                  id: String(clip.id),
                  setting: String(hit.setting || ""),
                  subject: String(hit.subject || ""),
                  action: String(hit.action || ""),
                  chineseVisualPrompt: String(hit.chineseVisualPrompt || [hit.setting, hit.subject, hit.action].filter(Boolean).join("。"))
                };
              }
              const rewritten = localRewriteClipPrompt(clip, pack);
              return { id: String(clip.id), chineseVisualPrompt: rewritten.chineseVisualPrompt, setting: "", subject: rewritten.chineseVisualPrompt, action: "" };
            })
          });
        }
      }
    }
  } catch (error: unknown) {
    console.warn("[Style Rewrite] fallback:", errorMessage(error));
  }

  return res.json({ ok: true, shots: fallback(), fallback: true });
});
}
