// @ts-nocheck — mechanical port of server.ts audio routes; behavior frozen.
import type { Express } from "express";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import {
  bailianTtsConcurrency,
  inferTargetModelFromVoiceId,
  isQwenAudioFlashModel,
  isQwenAudioPlusModel,
  isQwenAudioTtsModel,
  isCosyVoiceModel,
  qwenAudioLanguageHints,
  qwenAudioSampleRate,
  resolveBailianTtsEndpoint,
  resolveBailianVoiceDesignEndpoint,
  resolveTtsVoiceId
} from "../../src/utils/ttsCatalog";
import fs from "fs";
import path from "path";
import { joinClipsForTts as joinClipsForTtsShared, utterancesFromClips } from "../../src/utils/narrationTrack";
import { errorMessage, isLoose, requestBody, toLoose, type Loose } from "../loose";
import { generatedDir } from "../paths";
import { materializeClientAudioUrl, materializeClientImageUrl } from "../media";
import { sanitizeBearerKey, sanitizeHttpUrl } from "../http";

function withSentenceEnd(text: string): string {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  return /[。！？.!?…]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function joinClipNarrations(clips: unknown): string {
  return (Array.isArray(clips) ? clips : [])
    .map((clip) => withSentenceEnd(String(toLoose(clip).narration || "")))
    .filter(Boolean)
    .join("");
}

function joinClipsForTts(clips: unknown): string {
  return joinClipsForTtsShared(Array.isArray(clips) ? clips : []);
}

// 5. Alibaba Cloud Bailian (DashScope) Qwen-TTS synthesis helper
type ClientTtsApi = {
  enabled?: boolean;
  provider?: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  voice?: string;
};

function isUsableBailianTts(ttsApi: unknown): ttsApi is ClientTtsApi {
  if (!isLoose(ttsApi) || ttsApi.provider !== "bailian" || ttsApi.enabled === false) return false;
  return Boolean(typeof ttsApi.apiKey === "string" && ttsApi.apiKey.trim().length > 0);
}

async function callBailianTts(opts: {
  endpoint: string;
  apiKey: string;
  model?: string;
  voice?: string;
  text: string;
  rate?: number;
  timeoutMs?: number;
}): Promise<{ ok: boolean; audioUrl?: string; error?: string; status?: number }> {
  const apiKey = sanitizeBearerKey(opts.apiKey);
  const model = (opts.model || "").trim() || "qwen-audio-3.0-tts-flash";
  const voice = (opts.voice || "").trim() || (isQwenAudioTtsModel(model) ? "longanfengyue" : isCosyVoiceModel(model) ? "longxiaochun" : "Cherry");
  const text = String(opts.text || "").trim();
  const endpoint = resolveBailianTtsEndpoint(opts.endpoint, model);
  // Audio 3.0 uses the audio-specific payload; CosyVoice keeps the SpeechSynthesizer payload.
  const audio30 = isQwenAudioTtsModel(model);
  const timeoutMs =
    opts.timeoutMs || (isQwenAudioPlusModel(model) ? 180000 : audio30 ? 120000 : 60000);

  const input: Record<string, unknown> = audio30
    ? {
        text,
        voice,
        format: "wav",
        sample_rate: qwenAudioSampleRate(model),
        language_hints: qwenAudioLanguageHints(text)
      }
    : {
        text,
        voice,
        language_type: /[\u4e00-\u9fa5]/.test(text) ? "Chinese" : "Auto"
      };

  if (audio30 && typeof opts.rate === "number" && Number.isFinite(opts.rate) && opts.rate !== 1) {
    input.rate = Math.min(2, Math.max(0.5, opts.rate));
  }

  const maxAttempts = 4;
  let lastError = "百炼 TTS 合成失败";
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        },
        body: JSON.stringify({ model, input }),
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

      const errorText = String(data?.message || data?.code || rawText.slice(0, 400) || `HTTP ${response.status}`);
      const rateLimited =
        response.status === 429 ||
        /rate limit exceeded|throttl|too many requests|request rate increased/i.test(errorText);

      if (rateLimited && attempt < maxAttempts) {
        const waitMs = 800 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      if (!response.ok) {
        lastStatus = response.status;
        lastError = errorText;
        return { ok: false, status: response.status, error: errorText };
      }

      const audio = data?.output?.audio;
      if (data?.code && String(data.code) !== "Success" && !audio?.url && !(typeof audio?.data === "string" && audio.data.length > 200)) {
        lastStatus = response.status;
        lastError = data?.message || data?.code || "百炼 TTS 返回错误";
        if (rateLimited && attempt < maxAttempts) continue;
        return { ok: false, status: response.status, error: lastError };
      }

      if (audio?.data && typeof audio.data === "string" && audio.data.length > 200) {
        return { ok: true, audioUrl: `data:audio/wav;base64,${audio.data}` };
      }

      const audioUrl = typeof audio?.url === "string" ? audio.url : "";
      if (audioUrl) {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 30000);
          const audioRes = await fetch(audioUrl, { signal: ctrl.signal });
          clearTimeout(t);
          if (audioRes.ok) {
            const arrayBuffer = await audioRes.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const contentType = audioRes.headers.get("content-type") || "audio/wav";
            return { ok: true, audioUrl: `data:${contentType};base64,${buffer.toString("base64")}` };
          }
        } catch (downloadErr: unknown) {
          console.warn("[Bailian TTS] Audio download failed:", errorMessage(downloadErr));
        }
      }

      lastStatus = response.status;
      lastError = "未在响应中解析到音频";
      return { ok: false, status: response.status, error: lastError };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      lastError = (err instanceof Error ? err.name : '') === "AbortError" ? "请求超时" : errorMessage(err) || "网络异常";
      if (attempt < maxAttempts && (err instanceof Error ? err.name : '') !== "AbortError") {
        const waitMs = 800 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      return { ok: false, error: lastError };
    }
  }

  return { ok: false, status: lastStatus, error: lastError };
}

const EDGE_VOICE_MAP: Record<string, string> = {
  "magnetic-male": "zh-CN-YunxiNeural",
  "warm-female": "zh-CN-XiaoxiaoNeural",
  "tech-anchor": "zh-CN-YunyangNeural",
  "documentary-male": "zh-CN-YunjianNeural",
  "mystery-noir": "zh-CN-YunxiNeural",
  "vibrant-creator": "zh-CN-XiaoyiNeural",
  "bilingual-en": "en-US-ChristopherNeural",
  "bilingual-female": "en-US-JennyNeural"
};

function resolveBailianVoice(character?: string, fallback?: string, model?: string): string {
  return resolveTtsVoiceId(character || fallback, {
    enabled: true,
    provider: "bailian",
    endpoint: "",
    apiKey: "x",
    model: model || "qwen-audio-3.0-tts-flash",
    voice: fallback || ""
  });
}

type EdgeWordMark = { text: string; start: number; end: number };

function parseEdgeWordMarks(raw: string): EdgeWordMark[] {
  const words: EdgeWordMark[] = [];
  const ingest = (payload: unknown) => {
    const metas = payload?.Metadata || payload?.metadata || [];
    if (!Array.isArray(metas)) return;
    for (const meta of metas) {
      if (meta?.Type !== "WordBoundary" || !meta.Data) continue;
      const offset = Number(meta.Data.Offset) / 10_000_000;
      const duration = Number(meta.Data.Duration) / 10_000_000;
      const text = String(meta.Data.text?.Text || meta.Data.Text || "").trim();
      if (!text || !Number.isFinite(offset)) continue;
      words.push({
        text,
        start: Math.max(0, offset),
        end: Math.max(offset, offset + (Number.isFinite(duration) ? duration : 0))
      });
    }
  };
  const trimmed = String(raw || "").trim();
  if (!trimmed) return words;
  try {
    ingest(JSON.parse(trimmed));
  } catch {
    const blobs = trimmed.match(/\{[\s\S]*?\}(?=\{|$)/g) || [];
    for (const blob of blobs) {
      try {
        ingest(JSON.parse(blob));
      } catch {
        // ignore malformed metadata chunk
      }
    }
  }
  return words;
}

function synthesizeEdgeTts(
  text: string,
  character: string,
  rate: number
): Promise<{ audioUrl: string; words: EdgeWordMark[] }> {
  return new Promise(async (resolve, reject) => {
    let settled = false;
    const finish = (err: Error | null, payload?: { audioUrl: string; words: EdgeWordMark[] }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(payload as { audioUrl: string; words: EdgeWordMark[] });
    };
    const timer = setTimeout(() => finish(new Error("Edge TTS 超时")), 120000);

    try {
      const targetVoice = EDGE_VOICE_MAP[character] || "zh-CN-YunxiNeural";
      const ratePercent = Math.round((rate - 1.0) * 100);
      const rateStr = `${ratePercent >= 0 ? "+" : ""}${ratePercent}%`;
      const tts = new MsEdgeTTS();
      await tts.setMetadata(targetVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
        wordBoundaryEnabled: true,
        sentenceBoundaryEnabled: true
      });
      const { audioStream, metadataStream } = tts.toStream(
        text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
        {
        rate: rateStr,
        pitch: character === "mystery-noir" ? "-5Hz" : "+0Hz"
      });
      const chunks: Buffer[] = [];
      const metaChunks: Buffer[] = [];
      let audioDone = false;
      let metaDone = !metadataStream;
      const maybeFinish = () => {
        if (!audioDone || !metaDone) return;
        const audioBuffer = Buffer.concat(chunks);
        const words = parseEdgeWordMarks(Buffer.concat(metaChunks).toString("utf8"));
        finish(null, {
          audioUrl: `data:audio/mp3;base64,${audioBuffer.toString("base64")}`,
          words
        });
      };
      audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
      metadataStream?.on("data", (chunk: Buffer | string) => {
        metaChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
      });
      metadataStream?.on("end", () => {
        metaDone = true;
        maybeFinish();
      });
      metadataStream?.on("close", () => {
        metaDone = true;
        maybeFinish();
      });
      audioStream.on("end", () => {
        audioDone = true;
        if (!metaDone) {
          setTimeout(() => {
            metaDone = true;
            maybeFinish();
          }, 800);
        }
        maybeFinish();
      });
      audioStream.on("error", (streamErr: unknown) => {
        finish(new Error(errorMessage(streamErr) || "Edge TTS synthesis stream failed"));
      });
    } catch (err: unknown) {
      finish(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

async function synthesizeNarrationAudio(opts: {
  text: string;
  character?: string;
  rate?: number;
  ttsApi?: unknown;
}): Promise<
  | { ok: true; audioUrl: string; voice: string; format: string; provider: string; words?: EdgeWordMark[] }
  | { ok: false; error: string; status?: number }
> {
  const text = opts.text.trim();
  const character = opts.character || "magnetic-male";
  const rate = typeof opts.rate === "number" ? opts.rate : 1.0;

  if (isUsableBailianTts(opts.ttsApi)) {
    const model = String(opts.ttsApi.model || "qwen-audio-3.0-tts-flash");
    const voice = resolveBailianVoice(character, opts.ttsApi.voice, model);
    const result = await callBailianTts({
      endpoint: String(opts.ttsApi.endpoint),
      apiKey: String(opts.ttsApi.apiKey),
      model,
      voice,
      text,
      rate
    });
    if (result.ok && result.audioUrl) {
      return {
        ok: true,
        audioUrl: result.audioUrl,
        voice,
        format: "wav",
        provider: "bailian"
      };
    }
    return { ok: false, error: result.error || "百炼 TTS 合成失败", status: result.status };
  }

  try {
    const edge = await synthesizeEdgeTts(text, character, rate);
    return {
      ok: true,
      audioUrl: edge.audioUrl,
      voice: EDGE_VOICE_MAP[character] || "zh-CN-YunxiNeural",
      format: "mp3",
      provider: "edge",
      words: edge.words
    };
  } catch (err: unknown) {
    return { ok: false, error: errorMessage(err) || "Edge TTS 合成失败" };
  }
}


export function registerAudioRoutes(app: Express): void {
app.post("/api/audio/tts", async (req, res) => {
  try {
    const { text, character = "magnetic-male", rate = 1.0, ttsApi } = requestBody(req.body as unknown);

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    const result = await synthesizeNarrationAudio({
      text: text.trim(),
      character,
      rate,
      ttsApi
    });

    if (result.ok !== true) {
      return res.status(result.status && result.status >= 400 ? result.status : 500).json({
        error: result.error,
        provider: isUsableBailianTts(ttsApi) ? "bailian" : "edge"
      });
    }

    return res.json({
      audioUrl: materializeClientAudioUrl(result.audioUrl),
      voice: result.voice,
      requestedVoice: String(character || '').trim(),
      resolvedVoice: result.voice,
      format: result.format,
      character,
      provider: result.provider,
      words: Array.isArray(result.words) ? result.words : []
    });
  } catch (err: unknown) {
    console.error("TTS endpoint error:", err);
    res.status(500).json({ error: err.message || "Failed to generate TTS audio" });
  }
});

app.post("/api/audio/tts-full", async (req, res) => {
  try {
    const { clips, character = "magnetic-male", rate = 1.0, ttsApi } = requestBody(req.body as unknown);
    const joined = String(req.body?.text || "").trim() || joinClipsForTts(clips) || joinClipNarrations(clips);
    if (!joined) {
      return res.status(400).json({ error: "没有可合成的旁白文案" });
    }

    const result = await synthesizeNarrationAudio({
      text: joined,
      character,
      rate,
      ttsApi
    });

    if (result.ok !== true) {
      return res.status(result.status && result.status >= 400 ? result.status : 500).json({
        error: result.error || "整段旁白合成失败"
      });
    }

    return res.json({
      audioUrl: materializeClientAudioUrl(result.audioUrl),
      voice: result.voice,
      requestedVoice: String(character || '').trim(),
      resolvedVoice: result.voice,
      format: result.format,
      character,
      provider: result.provider,
      textLength: joined.length
    });
  } catch (err: unknown) {
    console.error("Full narration TTS error:", err);
    res.status(500).json({ error: err.message || "整段旁白合成失败" });
  }
});

app.post("/api/audio/store", (req, res) => {
  const audioUrl = materializeClientAudioUrl(String(req.body?.audioUrl || ""));
  if (!audioUrl) {
    return res.status(400).json({ error: "没有可保存的音频" });
  }
  return res.json({ audioUrl });
});

app.post("/api/image-store", (req, res) => {
  const imageUrl = materializeClientImageUrl(String(req.body?.imageUrl || ""));
  if (!imageUrl) {
    return res.status(400).json({ error: "没有可保存的图片" });
  }
  return res.json({ imageUrl });
});

app.post("/api/audio/tts-utterances", async (req, res) => {
  try {
    const { character = "magnetic-male", rate = 1.0, ttsApi, clips } = requestBody(req.body as unknown);
    const rawUtterances = Array.isArray(req.body?.utterances) ? req.body.utterances : [];
    const texts: string[] = rawUtterances
      .map((item: Loose) => String(item?.text || item || "").trim())
      .filter(Boolean);
    const fromClips = texts.length > 0
      ? texts
      : utterancesFromClips(Array.isArray(clips) ? clips : []).map((item) => item.text);
    if (fromClips.length === 0) {
      return res.status(400).json({ error: "没有可合成的旁白文案" });
    }

    const segments: { text: string; audioUrl: string; words: EdgeWordMark[] }[] = new Array(fromClips.length);
    const concurrency = isUsableBailianTts(ttsApi) ? bailianTtsConcurrency(ttsApi) : 2;
    let cursor = 0;
    let firstError: { error: string; status?: number } | null = null;
    const worker = async () => {
      while (cursor < fromClips.length && !firstError) {
        const index = cursor++;
        const text = fromClips[index];
        const result = await synthesizeNarrationAudio({
          text,
          character,
          rate,
          ttsApi
        });
        if (result.ok !== true) {
          firstError = { error: result.error || `旁白句合成失败：${text.slice(0, 18)}`, status: result.status };
          return;
        }
        segments[index] = {
          text,
          audioUrl: materializeClientAudioUrl(result.audioUrl),
          words: Array.isArray(result.words) ? result.words : []
        };
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, fromClips.length) }, () => worker()));
    if (firstError) {
      return res.status(firstError.status && firstError.status >= 400 ? firstError.status : 500).json({
        error: firstError.error
      });
    }

    return res.json({
      segments,
      character,
      requestedVoice: String(character || '').trim(),
      resolvedVoice: isUsableBailianTts(ttsApi)
        ? resolveBailianVoice(character, ttsApi?.voice, String(ttsApi?.model || ''))
        : undefined,
      provider: isUsableBailianTts(ttsApi) ? "bailian" : "edge",
      count: segments.length
    });
  } catch (err: unknown) {
    console.error("Utterance TTS error:", err);
    res.status(500).json({ error: err.message || "按句旁白合成失败" });
  }
});

// 6.1 Test Custom TTS provider (Bailian Qwen-TTS)
app.post("/api/audio/tts/test", async (req, res) => {
  const startTime = Date.now();
  const { endpoint, apiKey, model = "qwen-audio-3.0-tts-flash", voice } = requestBody(req.body as unknown);
  const resolvedModel = String(model || "qwen-audio-3.0-tts-flash");
  const resolvedVoice = resolveBailianVoice(
    String(voice || ""),
    undefined,
    resolvedModel
  );

  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return res.status(400).json({ ok: false, error: "请输入 API Key" });
  }

  try {
    const result = await callBailianTts({
      endpoint: String(endpoint || ""),
      apiKey: String(apiKey),
      model: resolvedModel,
      voice: resolvedVoice,
      text: "这是阿里云百炼语音合成的测试音色，正在为你实时试听。"
    });
    const latencyMs = Date.now() - startTime;

    if (result.ok && result.audioUrl) {
      return res.json({
        ok: true,
        latencyMs,
        model: resolvedModel,
        voice: resolvedVoice,
        requestedVoice: String(voice || '').trim(),
        resolvedVoice,
        audioUrl: result.audioUrl
      });
    }

    return res.status(result.status && result.status >= 400 ? result.status : 400).json({
      ok: false,
      latencyMs,
      error: result.error
    });
  } catch (err: unknown) {
    return res.status(500).json({
      ok: false,
      latencyMs: Date.now() - startTime,
      error: errorMessage(err) || "百炼 TTS 测试请求失败"
    });
  }
});

function countVoiceDesignChars(text: string): number {
  let n = 0;
  for (const ch of String(text || "")) {
    n += /[\u4e00-\u9fff]/.test(ch) ? 2 : 1;
  }
  return n;
}

function sanitizeVoicePrefix(raw: string): string {
  const ascii = String(raw || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10);
  if (ascii.length >= 3) return ascii.toLowerCase();
  return `v${Date.now().toString(36).replace(/[^a-z0-9]/gi, "").slice(-8)}`.slice(0, 10);
}

function normalizeEnrollmentStatus(raw?: string | null): "deploying" | "ok" | "undeployed" {
  const value = String(raw || "").trim().toUpperCase();
  if (value === "OK") return "ok";
  if (value === "UNDEPLOYED") return "undeployed";
  return "deploying";
}

function isVoiceDesignTargetModel(model: string): boolean {
  return isQwenAudioPlusModel(model) || isQwenAudioFlashModel(model);
}

async function callBailianVoiceEnrollment(opts: {
  endpoint?: string;
  apiKey: string;
  input: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }> {
  const apiKey = sanitizeBearerKey(opts.apiKey);
  const endpoint = resolveBailianVoiceDesignEndpoint(opts.endpoint);
  const timeoutMs = opts.timeoutMs || 120000;
  const maxAttempts = 4;
  let lastError = "声音设计请求失败";
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json"
        },
        body: JSON.stringify({
          model: "voice-enrollment",
          input: opts.input
        }),
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
      const errorText = String(data?.message || data?.code || rawText.slice(0, 400) || `HTTP ${response.status}`);
      const rateLimited =
        response.status === 429 ||
        /rate limit exceeded|throttl|too many requests|request rate increased/i.test(errorText);
      if (rateLimited && attempt < maxAttempts) {
        const waitMs = 800 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }
      if (!response.ok) {
        lastStatus = response.status;
        lastError = errorText;
        return { ok: false, status: response.status, data, error: errorText };
      }
      return { ok: true, status: response.status, data };
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      lastError = (err instanceof Error ? err.name : '') === "AbortError" ? "请求超时" : errorMessage(err) || "网络异常";
      lastStatus = undefined;
      if (attempt < maxAttempts && (err instanceof Error ? err.name : '') !== "AbortError") {
        await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** (attempt - 1)));
        continue;
      }
      return { ok: false, status: lastStatus, error: lastError };
    }
  }
  return { ok: false, status: lastStatus, error: lastError };
}

app.post("/api/audio/voice-design/create", async (req, res) => {
  const { endpoint, apiKey, model, voicePrompt, previewText, prefix, language } = requestBody(req.body as unknown);
  const resolvedModel = String(model || "").trim();
  const prompt = String(voicePrompt || "").trim();
  const preview = String(previewText || "").trim();

  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return res.status(400).json({ ok: false, error: "请输入 API Key" });
  }
  if (!isVoiceDesignTargetModel(resolvedModel)) {
    return res.status(400).json({ ok: false, error: "声音设计只支持 qwen-audio-3.0-tts-plus 或 qwen-audio-3.0-tts-flash" });
  }
  if (!prompt) {
    return res.status(400).json({ ok: false, error: "请填写声音描述" });
  }
  if (countVoiceDesignChars(prompt) > 500) {
    return res.status(400).json({ ok: false, error: "声音描述超长（最多约 500 字符，汉字按 2 个计）" });
  }
  if (preview.length < 15) {
    return res.status(400).json({ ok: false, error: "预览文案至少 15 个字" });
  }
  if (preview.length > 200) {
    return res.status(400).json({ ok: false, error: "预览文案最多 200 个字" });
  }

  const lang = language === "en" ? "en" : language === "zh" ? "zh" : /[\u4e00-\u9fa5]/.test(preview) ? "zh" : "en";

  try {
    const created = await callBailianVoiceEnrollment({
      endpoint: String(endpoint || ""),
      apiKey: String(apiKey),
      input: {
        action: "create_voice",
        target_model: resolvedModel,
        voice_prompt: prompt,
        preview_text: preview,
        prefix: sanitizeVoicePrefix(String(prefix || "voice")),
        language_hints: [lang]
      },
      timeoutMs: 120000
    });

    if (!created.ok) {
      return res.status(created.status && created.status >= 400 ? created.status : 400).json({
        ok: false,
        error: created.error || "创建音色失败"
      });
    }

    const output = created.data?.output || {};
    const voiceId = String(output.voice_id || output.voice || "").trim();
    if (!voiceId) {
      return res.status(400).json({ ok: false, error: "百炼未返回 voice_id" });
    }

    const previewData = output.preview_audio?.data;
    let previewAudioUrl = "";
    if (typeof previewData === "string" && previewData.length > 80) {
      const format = String(output.preview_audio?.response_format || "wav").toLowerCase();
      const ext = format.includes("mp3") ? "mp3" : format.includes("pcm") ? "wav" : "wav";
      previewAudioUrl = materializeClientAudioUrl(`data:audio/${ext === "mp3" ? "mpeg" : "wav"};base64,${previewData}`);
      if (previewAudioUrl.startsWith("data:")) {
        const filename = `voice-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        try {
          fs.writeFileSync(path.join(generatedDir, filename), Buffer.from(previewData, "base64"));
          previewAudioUrl = `/generated/${filename}`;
        } catch {
          // keep data URI as last resort
        }
      }
    }

    let status = normalizeEnrollmentStatus(output.status);
    const queried = await callBailianVoiceEnrollment({
      endpoint: String(endpoint || ""),
      apiKey: String(apiKey),
      input: { action: "query_voice", voice_id: voiceId },
      timeoutMs: 30000
    });
    if (queried.ok) {
      status = normalizeEnrollmentStatus(queried.data?.output?.status);
    }

    return res.json({
      ok: true,
      voiceId,
      targetModel: String(output.target_model || resolvedModel),
      status,
      previewAudioUrl,
      language: lang
    });
  } catch (err: unknown) {
    return res.status(500).json({ ok: false, error: errorMessage(err) || "声音设计请求失败" });
  }
});

app.post("/api/audio/voice-design/query", async (req, res) => {
  const { endpoint, apiKey, voiceId } = requestBody(req.body as unknown);
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return res.status(400).json({ ok: false, error: "请输入 API Key" });
  }
  const id = String(voiceId || "").trim();
  if (!id) {
    return res.status(400).json({ ok: false, error: "缺少 voice_id" });
  }

  try {
    const queried = await callBailianVoiceEnrollment({
      endpoint: String(endpoint || ""),
      apiKey: String(apiKey),
      input: { action: "query_voice", voice_id: id },
      timeoutMs: 30000
    });
    if (!queried.ok) {
      return res.status(queried.status && queried.status >= 400 ? queried.status : 400).json({
        ok: false,
        error: queried.error || "查询音色失败"
      });
    }
    const output = queried.data?.output || {};
    const voiceId = String(output.voice_id || id);
    return res.json({
      ok: true,
      voiceId,
      targetModel: String(output.target_model || inferTargetModelFromVoiceId(voiceId) || ""),
      status: normalizeEnrollmentStatus(output.status),
      prompt: String(output.voice_prompt || ""),
      previewText: String(output.preview_text || "")
    });
  } catch (err: unknown) {
    return res.status(500).json({ ok: false, error: errorMessage(err) || "查询音色失败" });
  }
});
}
