import express from "express";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

dotenv.config();

const app = express();
const PORT = 3000;
const generatedDir = path.join(process.cwd(), "public", "generated");
try {
  fs.mkdirSync(generatedDir, { recursive: true });
} catch {
  // directory may already exist
}

app.use(express.json({ limit: "50mb" }));
app.use("/generated", express.static(generatedDir));

function materializeClientImageUrl(imageUrl: string): string {
  if (!imageUrl || typeof imageUrl !== "string") return imageUrl;

  const trimmed = imageUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return `/api/image-proxy?url=${encodeURIComponent(trimmed)}`;
  }

  const dataMatch = trimmed.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!dataMatch) return trimmed;

  const mime = dataMatch[1] || "image/png";
  const ext = mime.includes("jpeg") || mime.includes("jpg")
    ? "jpg"
    : mime.includes("webp")
      ? "webp"
      : mime.includes("gif")
        ? "gif"
        : "png";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const buffer = Buffer.from(dataMatch[2], "base64");
    fs.writeFileSync(path.join(generatedDir, filename), buffer);
    console.log(`[Image Store] Saved ${filename} (${Math.round(buffer.length / 1024)} KB)`);
    return `/generated/${filename}`;
  } catch (err: any) {
    console.warn("[Image Store] Failed to persist generated image:", err?.message);
    return trimmed;
  }
}

// Lazy init Gemini SDK safely
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[Gemini API] GEMINI_API_KEY is not set in environment");
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

/**
 * Bulletproof JSON cleaner and parser
 * Strips markdown code blocks, extracts outermost JSON block, and cleans up trailing commas.
 */
function cleanAndParseJSON<T = any>(rawText: string | undefined): T | null {
  if (!rawText || typeof rawText !== "string") return null;

  let text = rawText.trim();

  // 1. Remove Markdown code blocks ```json ... ``` or ``` ... ```
  if (text.includes("```")) {
    text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  }

  // 2. Extract outermost JSON object {...} or array [...]
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    const lastBrace = text.lastIndexOf("}");
    if (lastBrace > firstBrace) {
      text = text.substring(firstBrace, lastBrace + 1);
    }
  } else if (firstBracket !== -1) {
    const lastBracket = text.lastIndexOf("]");
    if (lastBracket > firstBracket) {
      text = text.substring(firstBracket, lastBracket + 1);
    }
  }

  // 3. First attempt: standard JSON parse
  try {
    return JSON.parse(text) as T;
  } catch {
    // 4. Second attempt: clean common LLM formatting flaws (trailing commas, control characters)
    try {
      const relaxed = text
        .replace(/,\s*([}\]])/g, "$1") // strip trailing commas before } or ]
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ""); // strip invalid non-whitespace control chars
      return JSON.parse(relaxed) as T;
    } catch (secondErr) {
      console.warn("[JSON Parser] Failed to parse sanitized string:", secondErr);
      return null;
    }
  }
}

type ClientLlmApi = {
  enabled?: boolean;
  provider?: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
};

function sanitizeHttpUrl(raw: string): string {
  let val = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (val && !val.startsWith("http://") && !val.startsWith("https://")) {
    val = "https://" + val;
  }
  return val.replace(/\/+$/, "");
}

function sanitizeBearerKey(raw: string): string {
  let val = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (val.toLowerCase().startsWith("bearer ")) {
    val = val.slice(7).trim();
  }
  return val;
}

function isUsableLlmApi(llmApi: any): llmApi is ClientLlmApi {
  return Boolean(
    llmApi &&
      llmApi.enabled &&
      typeof llmApi.apiKey === "string" &&
      llmApi.apiKey.trim().length > 0 &&
      typeof llmApi.endpoint === "string" &&
      llmApi.endpoint.trim().length > 0
  );
}

function resolveChatCompletionUrls(endpoint: string): string[] {
  const raw = sanitizeHttpUrl(endpoint);
  if (!raw) return [];
  if (/\/chat\/completions$/i.test(raw)) return [raw];
  const urls = [`${raw}/chat/completions`];
  if (!raw.endsWith("/v1")) {
    urls.push(`${raw}/v1/chat/completions`);
  }
  return urls;
}

async function callOpenAiCompatibleChat(opts: {
  endpoint: string;
  apiKey: string;
  model: string;
  provider?: string;
  system: string;
  user: string;
  temperature?: number;
  json?: boolean;
  timeoutMs?: number;
}): Promise<{ ok: boolean; text?: string; model?: string; error?: string; status?: number }> {
  const urls = resolveChatCompletionUrls(opts.endpoint);
  const apiKey = sanitizeBearerKey(opts.apiKey);
  const model = (opts.model || "").trim() || "deepseek-v4-flash";
  let lastError = "请求失败";
  let lastStatus: number | undefined;

  for (const url of urls) {
    const attemptBodies: Record<string, unknown>[] = [];
    const baseBody: Record<string, unknown> = {
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user }
      ],
      temperature: opts.temperature ?? 0.7,
      stream: false
    };
    if (opts.json) {
      baseBody.response_format = { type: "json_object" };
    }
    if ((opts.provider || "").toLowerCase() === "deepseek") {
      attemptBodies.push({ ...baseBody, thinking: { type: "disabled" } });
    }
    attemptBodies.push(baseBody);

    for (const body of attemptBodies) {
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
        clearTimeout(timeoutId);

        const rawText = await response.text();
        let data: any = null;
        try {
          data = JSON.parse(rawText);
        } catch {
          data = null;
        }

        if (!response.ok) {
          lastStatus = response.status;
          lastError =
            data?.error?.message ||
            data?.message ||
            rawText.slice(0, 400) ||
            `HTTP ${response.status}`;
          continue;
        }

        const message = data?.choices?.[0]?.message;
        const text =
          (typeof message?.content === "string" && message.content) ||
          (Array.isArray(message?.content)
            ? message.content.map((part: any) => part?.text || "").join("")
            : "") ||
          data?.choices?.[0]?.text ||
          data?.output_text ||
          "";

        if (typeof text === "string" && text.trim()) {
          return { ok: true, text: text.trim(), model, error: undefined, status: undefined };
        }
        lastError = "模型未返回有效文本";
      } catch (err: any) {
        clearTimeout(timeoutId);
        lastError = err?.name === "AbortError" ? "请求超时" : err?.message || "网络异常";
      }
    }
  }

  return { ok: false, error: lastError, status: lastStatus };
}

function validateGeneratedShots(
  parsed: any,
  fallbackTitle: string,
  fallbackGenre: string,
  fallbackDuration: number
) {
  if (!parsed || !Array.isArray(parsed.shots) || parsed.shots.length === 0) return null;

  const validatedShots = parsed.shots.map((shot: any, index: number) => ({
    order: shot.order || index + 1,
    duration: typeof shot.duration === "number" ? shot.duration : 3.5,
    narration: shot.narration || `镜头 ${index + 1}：关于${fallbackTitle}的精彩解析`,
    secondaryText: shot.secondaryText || `Shot ${index + 1}: Key insight on ${fallbackTitle}`,
    visualPrompt:
      shot.visualPrompt ||
      `Cinematic visual for ${fallbackTitle}, scene ${index + 1}, highly detailed, 8k resolution`,
    chineseVisualPrompt: shot.chineseVisualPrompt || `第 ${index + 1} 幕画面，细腻光影与氛围感`,
    cameraMotion: shot.cameraMotion || "zoom-in",
    transition: shot.transition || "crossfade"
  }));

  return {
    title: parsed.title || fallbackTitle,
    genre: parsed.genre || fallbackGenre,
    totalDuration: parsed.totalDuration || fallbackDuration,
    shots: validatedShots
  };
}

/**
 * Domain-Aware Intelligent Storyboard Director Engine
 * Generates compelling, high-retention short video narrative scripts and detailed visual prompts.
 */
function generateIntelligentShots(
  topic: string,
  genre: string = "爆款科普",
  visualStyle: string = "cinematic",
  clipCount: number = 4,
  targetDuration: number = 30,
  tone: string = "punchy"
) {
  const safeCount = Math.max(3, Math.min(8, clipCount));
  const avgDuration = Math.round((targetDuration / safeCount) * 10) / 10;
  
  // Style keyword dictionary for prompt generation
  const styleKeywords: Record<string, { promptTag: string; cnStyle: string }> = {
    photorealistic: {
      promptTag: "photorealistic, shot on 35mm lens, f/1.8 aperture, natural volumetric lighting, 8k resolution, award winning photography",
      cnStyle: "超写实单反摄影，通透自然光影"
    },
    cinematic: {
      promptTag: "cinematic lighting, anamorphic lens, blockbuster movie still, 35mm film still, shallow depth of field, atmospheric mist, high production value",
      cnStyle: "电影质感院线大片，戏剧性光影"
    },
    anime: {
      promptTag: "Makoto Shinkai style, vibrant anime art, beautiful lighting, dramatic volumetric clouds, sunbeams, highly detailed background, gorgeous color palette, 4k anime wallpaper",
      cnStyle: "新海诚风唯美动漫，梦幻通透光影"
    },
    cyberpunk: {
      promptTag: "cyberpunk aesthetic, neon city lights, rainy reflective street, holographic interfaces, futuristic skyscrapers, purple and cyan color grading, moody night atmosphere",
      cnStyle: "赛博朋克未来科幻，霓虹流光夜景"
    },
    "3d-render": {
      promptTag: "3D CGI render, Unreal Engine 5, Octane render, ray tracing, cute stylized character, Pixar Disney style lighting, smooth textures, volumetric lighting",
      cnStyle: "皮克斯3D三维渲染，精细全局光照"
    },
    "chinese-ink": {
      promptTag: "traditional Chinese ink wash painting, ethereal poetic atmosphere, watercolor brush strokes, mist and distant mountains, gold foil accents, elegant oriental aesthetics",
      cnStyle: "东方古典水墨意境，苍茫泼墨山水"
    },
    "vintage-film": {
      promptTag: "vintage 1990s 35mm Kodak Portra 400 film photograph, nostalgic warm tones, subtle film grain, soft lens flare, documentary realism",
      cnStyle: "90年代怀旧胶片，温润柯达色调"
    },
    "vector-art": {
      promptTag: "modern vector illustration, clean lines, minimalist flat art, elegant color palette, high contrast, trendy graphic design, Dribbble trending",
      cnStyle: "现代极简矢量插画，扁平几何科技感"
    }
  };

  const currentStyle = styleKeywords[visualStyle] || styleKeywords.cinematic;

  // Curated narrative blueprints based on topic semantic clustering
  const isSpace = /宇宙|星|深空|太空|黑洞|银河|月球|火星|天文|物理|大爆炸/i.test(topic);
  const isAI = /AI|人工智能|机器人|科技|未来|算法|大模型|数字化|元宇宙|芯片/i.test(topic);
  const isNature = /深海|海洋|地球|生物|自然|动物|森林|极光|火山|冰川/i.test(topic);
  const isHealing = /治愈|人生|焦虑|哲学|允许|成长|心理|生活|情绪|孤独/i.test(topic);
  const isHistory = /历史|古代|文明|战争|帝王|遗迹|王朝|考古|神话/i.test(topic);

  // Template narrative builder
  const shotTemplates = [
    // Shot 1: The Golden 3s Hook
    {
      hookText: isSpace 
        ? `你敢相信吗？当我们仰望星空，所见的浩瀚宇宙，竟只是冰山一角。`
        : isAI 
        ? `如果未来就在明天，你是否已经做好准备，迎接AI重构的新世界？`
        : isNature
        ? `在深海一万米的极度深渊，隐藏着颠覆人类认知的神秘生命。`
        : isHealing
        ? `学会允许一切发生，才是治愈内耗、重塑自我的终极力量。`
        : isHistory
        ? `翻开尘封千年的历史画卷，隐藏着许多惊心动魄的文明转折。`
        : `关于「${topic}」，很多人的认知其实只停留在最表层。`,
      enText: isSpace
        ? "Look up at the stars—what we see is merely the tip of the cosmic iceberg."
        : isAI
        ? "If the future arrives tomorrow, are we truly ready for the AI era?"
        : isNature
        ? "In the deep abyss, uncharted life forms defy human imagination."
        : isHealing
        ? "Allowing everything to unfold is the ultimate cure for inner turmoil."
        : isHistory
        ? "Ancient chronicles reveal breathless turning points of civilization."
        : `Unveiling the captivating essence and deeper truth behind ${topic}.`,
      motion: "zoom-in",
      trans: "crossfade",
      sceneDesc: `宏大震撼的黄金开场抓人镜头，聚焦${topic}的极致氛围感`,
      promptKeyword: `Dramatic wide establishing shot of ${topic}, epic atmosphere, stunning visual hook`
    },
    // Shot 2: Deep Dive & Mechanism
    {
      hookText: isSpace 
        ? `数百亿光年的尺度上，无数星系与引力交织，蕴含着时空起源的终极谜题。`
        : isAI 
        ? `算力与神经网络的指数级爆发，正在以前所未有的速度重塑每个行业。`
        : isNature
        ? `在黑暗与高压的极限环境中，大自然以独特的方式孕育着奇迹。`
        : isHealing
        ? `放下对未知的执念，专注当下每一次呼吸，内心便会逐渐平静澄明。`
        : isHistory
        ? `无数英雄与智者的每一次抉择，都在悄然改变着整个时代的走向。`
        : `深入探索其核心逻辑，你会发现一个环环相扣、充满魅力的全新视角。`,
      enText: isSpace
        ? "Across billions of light years, galaxies weave the ultimate puzzle of time."
        : isAI
        ? "Exponential computing power reshapes every frontier of human innovation."
        : isNature
        ? "Under extreme pressure and darkness, nature crafts breathtaking miracles."
        : isHealing
        ? "Releasing stubborn resistance brings profound clarity and peace to the soul."
        : isHistory
        ? "Pivotal decisions by great minds quietly altered the course of human destiny."
        : `Delving into the inner mechanisms reveals a breathtaking perspective.`,
      motion: "pan-left",
      trans: "crossfade",
      sceneDesc: `层层递进的细节特写与中景，展现核心演化过程与精细机理`,
      promptKeyword: `Intricate detailed medium shot exploring the depth of ${topic}, master composition`
    },
    // Shot 3: Climax & Dynamic Breakthrough
    {
      hookText: isSpace 
        ? `每一次深空探测的突破，都是人类智慧跨越光年、触碰真理的勇气。`
        : isAI 
        ? `人机共生的时代已经到来，唯有拥抱变化，才能成为时代的引领者。`
        : isNature
        ? `万物生生不息的奥秘，正是生命在漫长岁月里书写的最美赞歌。`
        : isHealing
        ? `接纳所有的不完美，风雨过后，自会迎来属于你的万里晴空。`
        : isHistory
        ? `文明的火种历经风雨淬炼，依然在岁月的长河中熠熠生辉。`
        : `突破认知的边界之后，呈现在眼前的，是一片更为广阔壮美的天地。`,
      enText: isSpace
        ? "Every deep-space discovery marks humanity's relentless quest for truth."
        : isAI
        ? "In the era of human-AI collaboration, adaptability defines the visionary."
        : isNature
        ? "The endless cycle of existence is nature's most magnificent symphony."
        : isHealing
        ? "Embracing imperfection clears the path to your own vibrant horizon."
        : isHistory
        ? "The flames of civilization endure through centuries of trial and resilience."
        : `Transcending boundaries reveals an even grander, breathtaking horizon.`,
      motion: "cinematic-orbit",
      trans: "slide-left",
      sceneDesc: `高潮段落的动感视角，光影层次丰富，展现宏大的张力`,
      promptKeyword: `High-octane dynamic cinematic shot capturing the essence of ${topic}, volumetric rays`
    },
    // Shot 4: Resonant Conclusion & Call-to-Action
    {
      hookText: isSpace 
        ? `探索未知的征途永无止境，我们的征途，始终是星辰大海。`
        : isAI 
        ? `未来的画卷已然铺展，让我们一起见证并创造科技的无限可能。`
        : isNature
        ? `敬畏自然，珍视每一个生命的律动，守护这颗蓝色星球的奇迹。`
        : isHealing
        ? `愿你带着这份从容与热爱，勇敢前行，去拥抱更广阔的自我。`
        : isHistory
        ? `读懂历史的厚重与智慧，方能更加坚定地走向属于我们的明天。`
        : `关注更多深度思考与精彩瞬间，一起探索更广阔的认知世界。`,
      enText: isSpace
        ? "The cosmic journey is endless; our quest remains the boundless ocean of stars."
        : isAI
        ? "The canvas of tomorrow unfolds—join the journey into limitless innovation."
        : isNature
        ? "Revere the wild and protect the wonder of our shared living planet."
        : isHealing
        ? "Walk forward with calm conviction and embrace the boundless light within."
        : isHistory
        ? "Understanding the past empowers us to stride confidently into the future."
        : `Stay inspired and join us as we continue to explore deeper horizons.`,
      motion: "zoom-out",
      trans: "fade-black",
      sceneDesc: `意境深远的收尾镜头，余韵悠长，引发情感共鸣与互动`,
      promptKeyword: `Poetic closing wide shot of ${topic}, golden hour glow, awe-inspiring beauty`
    }
  ];

  return Array.from({ length: safeCount }, (_, i) => {
    const template = shotTemplates[i % shotTemplates.length];
    const shotNum = i + 1;
    const duration = i === safeCount - 1 
      ? Math.round((targetDuration - (avgDuration * (safeCount - 1))) * 10) / 10 || avgDuration
      : avgDuration;

    return {
      order: shotNum,
      duration: Math.max(2.5, Math.min(8.0, duration)),
      narration: template.hookText,
      secondaryText: template.enText,
      visualPrompt: `${template.promptKeyword}, depicting ${topic}, scene ${shotNum}, ${currentStyle.promptTag}`,
      chineseVisualPrompt: `${template.sceneDesc}，${currentStyle.cnStyle}`,
      cameraMotion: template.motion,
      transition: template.trans
    };
  });
}

// 1. Health check
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", hasApiKey: !!process.env.GEMINI_API_KEY });
});

// 2. Generate video script and automatic storyboard breakdown with real LLM
app.post("/api/script/generate", async (req, res) => {
  const { 
    topic, 
    genre = "爆款科普", 
    targetDuration = 30, 
    visualStyle = "cinematic", 
    clipCount = 4,
    tone = "punchy",
    llmApi
  } = req.body || {};

  if (!topic || typeof topic !== "string" || !topic.trim()) {
    return res.status(400).json({ error: "Topic is required" });
  }

  const cleanTopic = topic.trim();
  const safeCount = Math.max(3, Math.min(8, Number(clipCount) || 4));
  const safeDuration = Math.max(10, Math.min(120, Number(targetDuration) || 30));

  const ai = getGeminiClient();
  const fallbackResult = () => ({
    title: cleanTopic,
    genre,
    totalDuration: safeDuration,
    shots: generateIntelligentShots(cleanTopic, genre, visualStyle, safeCount, safeDuration, tone)
  });

  try {
    const toneGuide = tone === "emotional" 
      ? "温情治愈、富有哲思与共鸣感" 
      : tone === "humorous" 
      ? "通俗易懂、生动诙谐、趣味科普" 
      : "黄金3秒强吸引力Hook、快节奏、信息密度高、语言精炼有力";

    const prompt = `你是一位全网数千万播放量的短视频金牌编导、文案策划与视觉导演大师。
请根据用户提供的短视频创作主题，真实构思一段高转化率、快节奏、具有强吸引力（Hook点）、适合短视频节奏（抖音/TikTok/视频号/快手/小红书）的原创解说文案，并精确拆解为 ${safeCount} 个分镜头剧本。

【输入参数】
- 核心创作主题：${cleanTopic}
- 视频体裁/领域：${genre}
- 视觉风格调性：${visualStyle}
- 目标预估总时长：${safeDuration} 秒
- 分镜头数量：${safeCount} 个镜头
- 文案风格调性：${toneGuide}

【分镜拆解与文案创作黄金法则】
1. 黄金3秒 Hook：第1个分镜必须具备强力黄金3秒抓人开场（悬念、颠覆认知或强烈共鸣）。
2. 中段递进：第2~${safeCount - 1}个分镜层层递进，观点清晰、画面感强、节奏紧凑，解说词自然流畅。
3. 结尾收束/升华：最后一个分镜做出有力总结、情感升华或引导互动。
4. 画图Prompt要求：visualPrompt 必须是极度丰富且具体的英文画图指令，包含：[Shot Type, Subject Action/State, Environment/Background, Lighting, Color Palette, Aesthetic Quality Keywords]。
5. 手机短视频黄金排版：每个分镜的中文旁白控制在 14~28 个汉字之间，使用逗号等自然标点断句，保证短视频字幕在横竖屏中完美展示。

【每个分镜字段必须包含】：
1. order: 镜头序号 (1 到 ${safeCount})
2. duration: 镜头秒数 (浮点数，如 3.0, 3.5, 4.0，总和约为 ${safeDuration} 秒)
3. narration: 该镜头的中文解说词/旁白（口语化、节奏感强，不要写占位符）
4. secondaryText: 旁白对应的纯正精简英文双语字幕
5. visualPrompt: 该镜头的高清AI生图英文指令 (高质量、高细节、电影级构图，风格符合 ${visualStyle})
6. chineseVisualPrompt: 该镜头的中文画面场景说明
7. cameraMotion: 运镜动效，必须从 ["zoom-in", "zoom-out", "pan-left", "pan-right", "tilt-up", "tilt-down", "cinematic-orbit", "static"] 中挑选
8. transition: 转场方式，必须从 ["crossfade", "fade-black", "slide-left", "zoom-in", "none"] 中挑选

请只输出合法 JSON 对象，结构为 {"title": string, "genre": string, "totalDuration": number, "shots": [...]}。`;

    const systemInstruction = "你是一个短视频内容创作顶级AI助手，擅长撰写爆款文案并进行电影级分镜拆解。你的输出必须是合法的JSON结构，不得包含任何多余的前缀或后缀文本。";

    if (isUsableLlmApi(llmApi)) {
      console.log(`[Script Generation] Using custom LLM (${llmApi.provider || "openai-compatible"} / ${llmApi.model})`);
      const llmResult = await callOpenAiCompatibleChat({
        endpoint: String(llmApi.endpoint),
        apiKey: String(llmApi.apiKey),
        model: String(llmApi.model || "deepseek-v4-flash"),
        provider: llmApi.provider,
        system: systemInstruction,
        user: prompt,
        temperature: 0.75,
        json: true
      });
      if (llmResult.ok && llmResult.text) {
        const validated = validateGeneratedShots(
          cleanAndParseJSON<any>(llmResult.text),
          cleanTopic,
          genre,
          safeDuration
        );
        if (validated) return res.json(validated);
        console.warn("[Script Generation] Custom LLM JSON invalid, trying fallback engines");
      } else {
        console.warn("[Script Generation] Custom LLM failed:", llmResult.error);
      }
    }

    let responseText: string | undefined;

    if (ai) {
      const modelsToTry = ["gemini-3.7-flash", "gemini-2.5-flash", "gemini-2.5-pro"];
      let lastError: any = null;

      for (const modelName of modelsToTry) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              systemInstruction,
              temperature: 0.75,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING, description: "短视频爆款标题" },
                  genre: { type: Type.STRING, description: "分类体裁" },
                  totalDuration: { type: Type.NUMBER, description: "总时长(秒)" },
                  shots: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        order: { type: Type.INTEGER },
                        duration: { type: Type.NUMBER },
                        narration: { type: Type.STRING },
                        secondaryText: { type: Type.STRING },
                        visualPrompt: { type: Type.STRING },
                        chineseVisualPrompt: { type: Type.STRING },
                        cameraMotion: { type: Type.STRING },
                        transition: { type: Type.STRING },
                      },
                      required: ["order", "duration", "narration", "visualPrompt", "chineseVisualPrompt", "cameraMotion", "transition"]
                    }
                  }
                },
                required: ["title", "shots"]
              }
            }
          });
          responseText = response.text;
          if (responseText) break;
        } catch (err: any) {
          lastError = err;
          console.warn(`[Script Generation] Model ${modelName} encountered issue, trying fallback:`, err?.message || err);
        }
      }

      if (!responseText && lastError) {
        throw lastError;
      }

      const validated = validateGeneratedShots(
        cleanAndParseJSON<any>(responseText),
        cleanTopic,
        genre,
        safeDuration
      );
      if (validated) return res.json(validated);
    }

    console.warn("[Script Generation] LLM output unavailable or invalid, using domain generator");
    return res.json(fallbackResult());
  } catch (error: any) {
    console.warn("[Script Generation] LLM exception encountered, gracefully deploying storyboard engine:", error?.message || error);
    return res.json(fallbackResult());
  }
});

// 2.1 Polish, Rewrite, or Expand single narration/prompt with LLM
app.post("/api/script/polish-narration", async (req, res) => {
  const { text, type = "narration", style = "punchy", visualStyle = "cinematic", llmApi } = req.body || {};
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Text is required" });
  }

  const cleanText = text.trim();
  const ai = getGeminiClient();

  const fallbackPolish = {
    polishedText: style === "punchy"
      ? `真正颠覆认知的秘密，往往就隐藏在「${cleanText}」的深层细节之中。`
      : style === "emotional"
      ? `学会静静感受每一个瞬间，${cleanText}，内心自会生出平静的力量。`
      : `其实很简单，把复杂的逻辑拆开来看，${cleanText}，一秒就能彻底想通！`,
    visualPrompt: `High quality cinematic shot of ${cleanText}, dramatic studio lighting, 8k resolution, photorealistic masterwork`,
    chineseVisualPrompt: `画面聚焦 ${cleanText}，细腻质感与柔和光影`,
    secondaryText: `Scene caption and deeper perspective for: ${cleanText}`
  };

  const prompt = type === "narration"
    ? `请将以下短视频旁白文案进行润色与重写，使其更加【${style === "punchy" ? "抓人爆款、节奏有力" : style === "emotional" ? "温暖治愈、富有哲思" : "通俗易懂、生动幽默"}】：
原文：${cleanText}
同时生成对应的精简英文双语字幕，以及对应的专业英文AI画图Prompt（风格要求：${visualStyle}）。以JSON返回，字段为 polishedText, secondaryText, visualPrompt, chineseVisualPrompt。`
    : `请根据以下画面意图，扩写为一个极其详尽、适合生图的专业英文Prompt（风格：${visualStyle}）：
画面意图：${cleanText}
以JSON返回，字段为 polishedText, secondaryText, visualPrompt, chineseVisualPrompt。`;

  try {
    if (isUsableLlmApi(llmApi)) {
      const llmResult = await callOpenAiCompatibleChat({
        endpoint: String(llmApi.endpoint),
        apiKey: String(llmApi.apiKey),
        model: String(llmApi.model || "deepseek-v4-flash"),
        provider: llmApi.provider,
        system: "你是短视频文案润色助手，只输出合法 JSON。",
        user: prompt,
        temperature: 0.7,
        json: true
      });
      if (llmResult.ok && llmResult.text) {
        const parsed = cleanAndParseJSON<any>(llmResult.text);
        if (parsed && parsed.polishedText) return res.json(parsed);
      } else {
        console.warn("[Polish Narration] Custom LLM failed:", llmResult.error);
      }
    }

    if (!ai) {
      return res.json(fallbackPolish);
    }

    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            polishedText: { type: Type.STRING, description: "润色后的旁白解说词" },
            secondaryText: { type: Type.STRING, description: "对应的英文双语字幕" },
            visualPrompt: { type: Type.STRING, description: "专业英文画图Prompt" },
            chineseVisualPrompt: { type: Type.STRING, description: "中文画面描述" }
          },
          required: ["polishedText", "visualPrompt"]
        }
      }
    });

    const parsed = cleanAndParseJSON<any>(response.text);
    if (parsed && parsed.polishedText) {
      return res.json(parsed);
    }
    return res.json(fallbackPolish);
  } catch (error: any) {
    console.warn("[Polish Narration] LLM error, returning polished fallback:", error?.message);
    return res.json(fallbackPolish);
  }
});

// 2.2 Split free-form long text into structured storyboard shots
app.post("/api/script/split-text", async (req, res) => {
  const { rawText, visualStyle = "cinematic", targetShots, llmApi } = req.body || {};
  if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
    return res.status(400).json({ error: "rawText is required" });
  }

  const cleanText = rawText.trim();
  const ai = getGeminiClient();

  // Rule-based fallback splitter
  const splitFallback = () => {
    // Split by punctuation and line breaks
    const rawSentences = cleanText
      .split(/([。！？\n\r!?]+)/)
      .map(s => s.trim())
      .filter(Boolean);

    const mergedChunks: string[] = [];
    let currentChunk = '';

    for (let i = 0; i < rawSentences.length; i++) {
      const part = rawSentences[i];
      if (/^[。！？\n\r!?]+$/.test(part)) {
        currentChunk += (part.includes('\n') ? ' ' : part);
      } else {
        if (currentChunk.length >= 16) {
          mergedChunks.push(currentChunk.trim());
          currentChunk = part;
        } else {
          currentChunk = currentChunk ? `${currentChunk} ${part}` : part;
        }
      }
    }
    if (currentChunk.trim()) {
      mergedChunks.push(currentChunk.trim());
    }

    const safeChunks = mergedChunks.length > 0 ? mergedChunks.slice(0, 8) : [cleanText];
    const cameraMotions = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right', 'tilt-up', 'cinematic-orbit'];
    const transitions = ['crossfade', 'slide-left', 'crossfade', 'fade-black', 'zoom-in'];

    const shots = safeChunks.map((chunk, idx) => {
      const charCount = chunk.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').length;
      const duration = Math.max(2.5, Math.min(7.0, Math.round((charCount / 4.2) * 10) / 10 || 3.5));
      return {
        order: idx + 1,
        duration,
        narration: chunk,
        secondaryText: `Scene ${idx + 1}: ${chunk.slice(0, 40)}`,
        visualPrompt: `Cinematic high quality visual depicting ${chunk.slice(0, 50)}, dramatic atmospheric lighting, 8k resolution, photorealistic masterwork`,
        chineseVisualPrompt: `画面表现：${chunk}`,
        cameraMotion: cameraMotions[idx % cameraMotions.length],
        transition: transitions[idx % transitions.length]
      };
    });

    return {
      title: cleanText.slice(0, 18),
      shots
    };
  };

  try {
    const prompt = `你是一位短视频金牌导演与剪辑师。用户提供了一段现成的完整口播/短视频文案。
请将该文案智能拆解为 ${targetShots ? targetShots + '个' : '3~6个'} 适合短视频节奏（抖音/小红书/快手/B站）的分镜头剧本。

【用户文案】：
${cleanText}

【拆解要求】：
1. 完整保留用户的原意与文案，将长文案合理拆分为各个分镜的 narration（每句 15~35 字左右，口语流畅）。
2. 根据解说字数精确计算每个分镜的 duration（秒数，通常每秒读4~5个字，单镜头时长在 2.5~7.0 秒之间）。
3. 为每个镜头生成高水准的英文 AI 生图 Prompt（visualPrompt，风格符合 ${visualStyle}），以及中文画面描述。
4. 提供 secondaryText（精简英文双语字幕）、cameraMotion（运镜）和 transition（转场）。
以合法的 JSON 格式返回，结构为 {"title": string, "shots": [...]}。`;

    if (isUsableLlmApi(llmApi)) {
      const llmResult = await callOpenAiCompatibleChat({
        endpoint: String(llmApi.endpoint),
        apiKey: String(llmApi.apiKey),
        model: String(llmApi.model || "deepseek-v4-flash"),
        provider: llmApi.provider,
        system: "你是短视频导演，只输出合法 JSON。",
        user: prompt,
        temperature: 0.7,
        json: true
      });
      if (llmResult.ok && llmResult.text) {
        const parsed = cleanAndParseJSON<any>(llmResult.text);
        if (parsed && Array.isArray(parsed.shots) && parsed.shots.length > 0) {
          return res.json(parsed);
        }
      } else {
        console.warn("[Split Text] Custom LLM failed:", llmResult.error);
      }
    }

    if (!ai) {
      return res.json(splitFallback());
    }

    let responseText: string | undefined;
    const modelsToTry = ["gemini-3.7-flash", "gemini-2.5-flash", "gemini-2.5-pro"];

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: "基于文案提炼的视频标题" },
                shots: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      order: { type: Type.INTEGER },
                      duration: { type: Type.NUMBER },
                      narration: { type: Type.STRING },
                      secondaryText: { type: Type.STRING },
                      visualPrompt: { type: Type.STRING },
                      chineseVisualPrompt: { type: Type.STRING },
                      cameraMotion: { type: Type.STRING },
                      transition: { type: Type.STRING }
                    },
                    required: ["order", "duration", "narration", "visualPrompt"]
                  }
                }
              },
              required: ["shots"]
            }
          }
        });
        responseText = response.text;
        if (responseText) break;
      } catch (err: any) {
        console.warn(`[Split Text] Model ${modelName} encountered issue, trying fallback:`, err?.message || err);
      }
    }

    const parsed = cleanAndParseJSON<any>(responseText);
    if (parsed && Array.isArray(parsed.shots) && parsed.shots.length > 0) {
      return res.json(parsed);
    }
    return res.json(splitFallback());
  } catch (error: any) {
    console.warn("[Split Text] LLM error, returning rule-based split:", error?.message);
    return res.json(splitFallback());
  }
});

// 3. Generate individual visual frame using AI Image Generation Engine (Custom Provider API / Pollinations FLUX.1 / Procedural Fallback)
app.post("/api/visual/generate", async (req, res) => {
  try {
    const { prompt, visualStyle = "cinematic", aspectRatio = "16:9", seed, customApi } = req.body || {};

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // Determine dimensions based on aspect ratio
    let width = 1280;
    let height = 720;
    let standardSize = "1792x1024";

    if (aspectRatio === "9:16") {
      width = 720;
      height = 1280;
      standardSize = "1024x1792";
    } else if (aspectRatio === "1:1") {
      width = 1024;
      height = 1024;
      standardSize = "1024x1024";
    } else if (aspectRatio === "4:5") {
      width = 864;
      height = 1080;
      standardSize = "1024x1280";
    }

    // Style prompt enhancer
    const styleEnhancers: Record<string, string> = {
      photorealistic: "photorealistic, 35mm photograph, master composition, natural lighting, 8k resolution",
      cinematic: "cinematic lighting, 35mm film photograph, master composition, photorealistic, 8k resolution, dramatic shadows",
      anime: "modern anime aesthetic, Makoto Shinkai style, vibrant colors, detailed anime background, crisp lines",
      cyberpunk: "cyberpunk city, neon lighting, volumetric glow, futuristic metropolis, hyperdetailed sci-fi concept art",
      vintage: "vintage 1970s retro film photo, nostalgic warm tones, Kodachrome color palette, analog grain",
      "3d_animation": "Pixar and Disney 3D animation style, octane render, soft subsurface scattering, charming character design, cute lighting",
      "3d-render": "Pixar and Disney 3D animation style, octane render, soft subsurface scattering, charming character design, cute lighting",
      ink_wash: "traditional Chinese ink wash painting, Shan Shui aesthetic, poetic atmospheric mist, artistic brush strokes",
      "chinese-ink": "traditional Chinese ink wash painting, Shan Shui aesthetic, poetic atmospheric mist, artistic brush strokes",
      "vintage-film": "vintage 1990s 35mm Kodak Portra film photograph, warm tones, subtle film grain",
      "vector-art": "modern vector illustration, clean lines, minimalist flat art, elegant color palette, high contrast"
    };

    const styleAddition = styleEnhancers[visualStyle] || "high quality, ultra detailed, cinematic composition";
    const cleanedPrompt = String(prompt).replace(/[^\w\s\u4e00-\u9fa5,.-]/g, ' ').trim();
    const finalPrompt = `${cleanedPrompt}, ${styleAddition}`;

    // =========================================================================
    // PRIORITY 1: User-configured Custom Image Generation Provider API
    // (SiliconFlow / OpenAI DALL-E / OneAPI / NewAPI / Midjourney / Chat-to-Image)
    // =========================================================================
    const isCustomProvider =
      customApi &&
      customApi.provider !== "builtin" &&
      customApi.enabled !== false;

    if (isCustomProvider) {
      if (!customApi.apiKey?.trim() || !customApi.endpoint?.trim()) {
        return res.status(400).json({
          ok: false,
          error: "请先填写所选生图供应商的接口地址和 API Key",
          diagnosis: "当前已选择自定义生图供应商。请补全凭证，或改选「内置 FLUX」。"
        });
      }
    }

    if (isCustomProvider && customApi.apiKey && customApi.endpoint) {
      try {
        const chosenSize = customApi.size === 'auto' || !customApi.size ? standardSize : customApi.size;
        const targetModel = customApi.model ? customApi.model.trim() : 'black-forest-labs/FLUX.1-schnell';

        console.log(`[Custom Image API] Requesting ${customApi.endpoint} with model "${targetModel}"...`);
        const customResult = await executeCustomImageRequest({
          endpoint: customApi.endpoint,
          apiKey: customApi.apiKey,
          model: targetModel,
          prompt: finalPrompt,
          size: chosenSize,
          protocol: customApi.protocol || 'auto',
          quality: customApi.quality
        });

        if (customResult.ok && customResult.imageUrl) {
          const clientImageUrl = materializeClientImageUrl(customResult.imageUrl);
          console.log(`[Custom Image API] Successfully generated via ${customResult.methodUsed} (${customResult.endpointUsed}) -> ${clientImageUrl}`);
          return res.json({
            imageUrl: clientImageUrl,
            source: 'custom-provider-api',
            model: targetModel,
            provider: customApi.provider || 'custom',
            protocolUsed: customResult.methodUsed
          });
        } else {
          console.warn('[Custom Image API] Generation failed:', customResult.error, customResult.diagnosis);
          // Return the actual provider error so the user and UI clearly understand why the supplier failed
          return res.status(400).json({
            ok: false,
            error: customResult.error || '供应商生图请求失败',
            diagnosis: customResult.diagnosis || '请检查供应商 API 密钥有效性、账户余额或模型名称',
            rawError: customResult.rawError,
            provider: customApi.provider || 'custom',
            model: targetModel
          });
        }
      } catch (customApiErr: any) {
        console.error('[Custom Image API Exception]:', customApiErr?.message || customApiErr);
        return res.status(500).json({
          ok: false,
          error: `供应商接口调用异常: ${customApiErr?.message || customApiErr}`,
          diagnosis: '连接第三方供应商服务超时或网络中断，请检查 Endpoint 连通性'
        });
      }
    }

    // =========================================================================
    // PRIORITY 2: Built-in Pollinations FLUX.1 Schnell Engine (Free Default)
    // =========================================================================
    const randomSeed = seed || Math.floor(Math.random() * 9999999);
    const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=${width}&height=${height}&seed=${randomSeed}&model=flux&nologo=true`;

    // Try fetching direct image stream from Pollinations FLUX with 8s timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const imgResponse = await fetch(pollinationsUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'image/jpeg,image/png,image/webp,*/*'
        }
      });
      clearTimeout(timeoutId);

      if (imgResponse.ok) {
        const arrayBuffer = await imgResponse.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const contentType = imgResponse.headers.get('content-type') || 'image/jpeg';
        const base64Image = `data:${contentType};base64,${buffer.toString('base64')}`;

        return res.json({ 
          imageUrl: materializeClientImageUrl(base64Image),
          source: 'flux-pollinations',
          model: 'FLUX.1-schnell'
        });
      }
    } catch {
      // Proceed to server-side proxied image fallback
    }

    // Return direct Pollinations CDN URL with safe proxy wrapper fallback
    return res.json({ 
      imageUrl: materializeClientImageUrl(pollinationsUrl),
      source: 'flux-pollinations-cdn',
      model: 'FLUX.1-schnell'
    });
  } catch (error: any) {
    console.error("Visual generation error:", error);
    const fallbackPrompt = encodeURIComponent(req.body?.prompt || 'cinematic scenery');
    return res.json({
      imageUrl: materializeClientImageUrl(`https://image.pollinations.ai/prompt/${fallbackPrompt}?width=1280&height=720&model=flux&nologo=true`),
      source: 'flux-pollinations-cdn'
    });
  }
});

// Universal High-Performance Image Proxy (Resolves CORS & Canvas Tainting for External Image URLs)
app.get("/api/image-proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send("url query param required");
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch image: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    return res.status(500).send(`Proxy fetch error: ${err?.message}`);
  }
});

// Universal Helper: Extract image URL from any provider response structure, markdown, base64, nested objects, or text
function extractImageUrlUniversal(data: any): string | null {
  if (!data) return null;

  // 1. Direct String handling
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) return null;

    // Direct data URL
    if (trimmed.startsWith('data:image/')) return trimmed;

    // Direct HTTP URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      // Ignore schema definitions
      if (!trimmed.includes('json-schema.org') && !trimmed.includes('w3.org')) {
        return trimmed;
      }
    }

    // Markdown image ![alt](url)
    const mdMatch = trimmed.match(/!\[.*?\]\((https?:\/\/[^\s\)\'\"]+)\)/i);
    if (mdMatch && mdMatch[1]) return mdMatch[1];

    // HTML img tag <img src="url">
    const htmlMatch = trimmed.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (htmlMatch && htmlMatch[1]) return htmlMatch[1];

    // Base64 data URL inside string
    const b64DataMatch = trimmed.match(/(data:image\/[a-zA-Z0-9+]+;base64,[A-Za-z0-9+/=]+)/i);
    if (b64DataMatch && b64DataMatch[1]) return b64DataMatch[1];

    // Raw Base64 string check (JPEG / PNG / WEBP / GIF header)
    if (trimmed.length > 200) {
      if (trimmed.startsWith('/9j/')) return `data:image/jpeg;base64,${trimmed}`;
      if (trimmed.startsWith('iVBORw0KGgo')) return `data:image/png;base64,${trimmed}`;
      if (trimmed.startsWith('UklGR')) return `data:image/webp;base64,${trimmed}`;
      if (trimmed.startsWith('R0lGOD')) return `data:image/gif;base64,${trimmed}`;
    }

    // Image URL with extension inside string
    const extMatch = trimmed.match(/(https?:\/\/[^\s"'<>\[\]\(\)]+?\.(?:png|jpe?g|webp|gif|svg)(\?[^\s"'<>\[\]\(\)]*)?)/i);
    if (extMatch && extMatch[1]) return extMatch[1];

    // Standalone URL inside string
    const bareUrlMatch = trimmed.match(/(https:\/\/[^\s"'<>\[\]\(\)]+)/i);
    if (bareUrlMatch && bareUrlMatch[1] && !bareUrlMatch[1].includes('json-schema') && !bareUrlMatch[1].includes('w3.org')) {
      return bareUrlMatch[1];
    }
    return null;
  }

  // 2. Direct OpenAI and common provider fields
  if (data?.data?.[0]?.url && typeof data.data[0].url === 'string') return data.data[0].url;
  if (data?.data?.[0]?.b64_json) return `data:image/png;base64,${data.data[0].b64_json}`;
  // NewAPI / OneAPI wrap: { data: { data: [ { url | b64_json } ] } }
  if (data?.data?.data?.[0]?.url && typeof data.data.data[0].url === 'string') return data.data.data[0].url;
  if (data?.data?.data?.[0]?.b64_json) return `data:image/png;base64,${data.data.data[0].b64_json}`;
  if (data?.data?.[0]?.image) {
    const imgVal = data.data[0].image;
    if (typeof imgVal === 'string') {
      return imgVal.startsWith('http') || imgVal.startsWith('data:image') ? imgVal : `data:image/png;base64,${imgVal}`;
    }
  }
  if (data?.data?.[0]?.base64) return `data:image/png;base64,${data.data[0].base64}`;
  if (data?.data?.[0]?.b64) return `data:image/png;base64,${data.data[0].b64}`;
  if (data?.data?.[0]?.img_url) return data.data[0].img_url;
  if (data?.data?.[0]?.file_url) return data.data[0].file_url;
  if (typeof data?.data === 'string' && (data.data.startsWith('http') || data.data.startsWith('data:image'))) return data.data;
  if (data?.data?.url && typeof data.data.url === 'string') return data.data.url;
  if (data?.data?.image_url && typeof data.data.image_url === 'string') return data.data.image_url;
  if (data?.data?.image && typeof data.data.image === 'string') return data.data.image;

  // 3. Array of string URLs or image objects
  if (Array.isArray(data?.images) && data.images.length > 0) {
    const first = data.images[0];
    const url = typeof first === 'string' ? first : first?.url || first?.image || first?.b64_json;
    if (typeof url === 'string') {
      if (url.startsWith('http') || url.startsWith('data:image')) return url;
      if (url.length > 200) return `data:image/png;base64,${url}`;
    }
  }

  // 4. Output / Outputs format (Replicate, DashScope, Midjourney, etc.)
  if (Array.isArray(data?.output) && data.output.length > 0) {
    const first = data.output[0];
    const url = typeof first === 'string' ? first : first?.url || first?.image || first?.file_url;
    if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('data:image'))) return url;
  }
  if (typeof data?.output === 'string' && (data.output.startsWith('http') || data.output.startsWith('data:image'))) return data.output;
  if (data?.output?.url) return data.output.url;
  if (data?.output?.image) return data.output.image;
  if (data?.output?.results?.[0]?.url) return data.output.results[0].url;

  // 5. Result / Results format
  if (typeof data?.result === 'string' && (data.result.startsWith('http') || data.result.startsWith('data:image'))) return data.result;
  if (data?.result?.url) return data.result.url;
  if (data?.result?.image) return data.result.image;
  if (Array.isArray(data?.result) && data.result.length > 0) {
    const first = data.result[0];
    const url = typeof first === 'string' ? first : first?.url || first?.image;
    if (url) return url;
  }
  if (Array.isArray(data?.results) && data.results.length > 0) {
    const first = data.results[0];
    const url = typeof first === 'string' ? first : first?.url || first?.image;
    if (url) return url;
  }

  // 6. Direct top-level fields
  if (data?.image_url && typeof data.image_url === 'string') return data.image_url;
  if (data?.imageUrl && typeof data.imageUrl === 'string') return data.imageUrl;
  if (data?.img_url && typeof data.img_url === 'string') return data.img_url;
  if (data?.url && typeof data.url === 'string' && data.url.startsWith('http') && !data.url.includes('json-schema')) return data.url;
  if (data?.image && typeof data.image === 'string') {
    if (data.image.startsWith('http') || data.image.startsWith('data:image')) return data.image;
    if (data.image.length > 200) return `data:image/png;base64,${data.image}`;
  }

  // 7. Chat completions format
  const chatContent = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.choices?.[0]?.delta?.content;
  if (chatContent) {
    const fromChat = extractImageUrlUniversal(chatContent);
    if (fromChat) return fromChat;
  }

  // 8. Universal Deep Search across all keys/nested arrays
  try {
    const visited = new Set();
    function deepSearch(obj: any, depth = 0): string | null {
      if (!obj || depth > 5 || visited.has(obj)) return null;
      if (typeof obj === 'object') visited.add(obj);

      if (typeof obj === 'string') {
        const found = extractImageUrlUniversal(obj);
        if (found) return found;
      } else if (Array.isArray(obj)) {
        for (const item of obj) {
          const res = deepSearch(item, depth + 1);
          if (res) return res;
        }
      } else if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          // Priority keys first
          if (['url', 'imageUrl', 'image_url', 'image', 'b64_json', 'base64', 'file_url', 'src', 'link', 'output', 'result'].includes(key)) {
            const found = extractImageUrlUniversal(obj[key]);
            if (found) return found;
          }
        }
        for (const key of Object.keys(obj)) {
          const res = deepSearch(obj[key], depth + 1);
          if (res) return res;
        }
      }
      return null;
    }
    const deepFound = deepSearch(data);
    if (deepFound) return deepFound;
  } catch {
    // Ignore deep crawl exceptions
  }

  return null;
}

function isLikelyBusinessError(data: any): boolean {
  if (!data || typeof data !== "object" || data.code === undefined) return false;
  const successCodes: Array<string | number> = [0, 1, 200, "0", "1", "200", "success", "ok", "Success", "OK"];
  if (successCodes.includes(data.code)) return false;
  if (data.data || data.images || data.output || data.result) return false;
  return true;
}

function extractTaskId(data: any): string | null {
  if (!data || typeof data !== "object") return null;

  const candidates = [
    data.task_id,
    data.taskId,
    data.taskID,
    data.result,
    data.data?.task_id,
    data.data?.taskId,
    data.data?.id,
    data.data?.result,
    data.output?.task_id,
    data.output?.taskId,
    data.output?.id,
    typeof data.data === "string" ? data.data : null,
    typeof data.result === "string" ? data.result : null,
    data.id
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (!value || value.length > 180) continue;
    if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) continue;
    if (/^\d{10,13}$/.test(value)) continue;
    return value;
  }
  return null;
}

// Helper: Polls async image task if provider returns a task_id
async function pollAsyncTask(taskId: string, rootBase: string, apiKey: string, maxWaitMs = 180000): Promise<string | null> {
  const startTime = Date.now();
  const candidateGets = [
    `${rootBase}/v1/images/tasks/${taskId}`,
    `${rootBase}/v1/images/generations/${taskId}`,
    `${rootBase}/v1/images/${taskId}`,
    `${rootBase}/v1/task/${taskId}`,
    `${rootBase}/v1/tasks/${taskId}`,
    `${rootBase}/api/v1/task/${taskId}`,
    `${rootBase}/api/task/${taskId}`,
    `${rootBase}/mj/task/${taskId}/fetch`,
    `${rootBase}/task/${taskId}`
  ];

  console.log(`[Custom Image API] Detected Async Task ID: ${taskId}. Polling ${rootBase} for up to ${Math.round(maxWaitMs / 1000)}s...`);

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, 2500));

    for (const pollUrl of candidateGets) {
      try {
        const res = await fetch(pollUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json"
          }
        });

        if (!res.ok) continue;
        const pollData = await res.json();
        const img = extractImageUrlUniversal(pollData);
        if (img) {
          console.log(`[Custom Image API] Async task ${taskId} completed via ${pollUrl}`);
          return img;
        }
        const status = String(
          pollData?.status ||
          pollData?.state ||
          pollData?.task_status ||
          pollData?.data?.status ||
          pollData?.output?.task_status ||
          ""
        ).toUpperCase();
        if (["FAILED", "FAILURE", "ERROR", "CANCELLED", "CANCELED"].includes(status)) {
          console.warn(`[Custom Image API] Async task ${taskId} returned status: ${status}`);
          return null;
        }
      } catch {
        // continue polling other endpoints
      }
    }
  }

  console.warn(`[Custom Image API] Async task ${taskId} timed out after ${Math.round((Date.now() - startTime) / 1000)}s`);
  return null;
}

// Master Executor: Tries Images API with intelligent Chat Completions, Universal Parsing & Async Polling
async function executeCustomImageRequest(options: {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  size?: string;
  protocol?: 'auto' | 'images' | 'chat-completions';
  quality?: 'standard' | 'hd';
  timeoutMs?: number;
}): Promise<{
  ok: boolean;
  imageUrl?: string;
  methodUsed?: string;
  endpointUsed?: string;
  error?: string;
  rawError?: string;
  diagnosis?: string;
  status?: number;
}> {
  const {
    endpoint,
    apiKey,
    model,
    prompt,
    size = '1024x1024',
    protocol = 'auto',
    quality,
    timeoutMs = 180000
  } = options;

  let cleanEndpoint = String(endpoint).trim().replace(/^["']|["']$/g, '');
  if (!cleanEndpoint.startsWith('http://') && !cleanEndpoint.startsWith('https://')) {
    cleanEndpoint = 'https://' + cleanEndpoint;
  }
  cleanEndpoint = cleanEndpoint.replace(/\/+$/, '');

  let cleanApiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
  if (cleanApiKey.toLowerCase().startsWith('bearer ')) {
    cleanApiKey = cleanApiKey.slice(7).trim();
  }

  // Determine base host and standard routes
  let rootBase = cleanEndpoint
    .replace(/\/v1\/images\/generations$/i, '')
    .replace(/\/images\/generations$/i, '')
    .replace(/\/v1\/chat\/completions$/i, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/v1$/i, '')
    .replace(/\/+$/, '');

  const imagesEndpoint = cleanEndpoint.includes('/images/generations')
    ? cleanEndpoint
    : `${rootBase}/v1/images/generations`;

  const chatEndpoint = cleanEndpoint.includes('/chat/completions')
    ? cleanEndpoint
    : `${rootBase}/v1/chat/completions`;

  const targetModel = model.trim();
  const targetSize = size === 'auto' ? '1024x1024' : size;

  let lastError = '';
  let lastRawError = '';
  let lastStatus = 0;
  let imagesJobAccepted = false;

  // METHOD 1: Chat Completions Protocol (if requested)
  if (protocol === 'chat-completions' || cleanEndpoint.includes('/chat/completions')) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanApiKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'user',
              content: `Please generate and draw a high quality image based on this description:\n${prompt}\nReturn the image markdown or direct URL.`
            }
          ]
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const img = extractImageUrlUniversal(data);
        if (img) {
          return {
            ok: true,
            imageUrl: img,
            methodUsed: 'Chat Completions (/v1/chat/completions)',
            endpointUsed: chatEndpoint
          };
        }
      }
    } catch (e: any) {
      lastError = e?.message || 'Chat Completions 请求异常';
    }
  }

  // METHOD 2: Standard OpenAI Images API (/v1/images/generations)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Payload designed for broad compatibility (OpenAI, SiliconFlow, Midjourney, OneAPI)
    const requestBody: Record<string, any> = {
      model: targetModel,
      prompt: prompt,
      size: targetSize,
      image_size: targetSize,
      n: 1
    };
    if (quality) requestBody.quality = quality;

    let res = await fetch(imagesEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanApiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    // Check if response is direct binary image
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.startsWith('image/')) {
      clearTimeout(timer);
      const arrayBuf = await res.arrayBuffer();
      const b64 = Buffer.from(arrayBuf).toString('base64');
      const mime = contentType.split(';')[0] || 'image/png';
      return {
        ok: true,
        imageUrl: `data:${mime};base64,${b64}`,
        methodUsed: 'Direct Image Stream',
        endpointUsed: imagesEndpoint
      };
    }

    // If 400 Bad Request happens (some providers reject specific sizes), retry with minimal payload
    if (res.status === 400) {
      console.log(`[Custom Image API] Retrying ${imagesEndpoint} with minimal payload...`);
      res = await fetch(imagesEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanApiKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          prompt: prompt
        }),
        signal: controller.signal
      });
    }

    clearTimeout(timer);

    if (res.ok) {
      const rawText = await res.text();
      let data: any;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = rawText;
      }

      // Check if provider returned custom business error code in HTTP 200 (e.g. { code: -1, msg: "..." })
      if (data && typeof data === 'object') {
        if (isLikelyBusinessError(data)) {
          lastError = data.msg || data.message || data.error || '服务商返回业务错误';
          lastRawError = rawText;
          lastStatus = 400;
        } else {
          imagesJobAccepted = true;

          // 1. Direct Universal URL Extraction
          const img = extractImageUrlUniversal(data);
          if (img) {
            return {
              ok: true,
              imageUrl: img,
              methodUsed: 'Images API (/v1/images/generations)',
              endpointUsed: imagesEndpoint
            };
          }

          // 2. Check for Async Task ID (Midjourney Proxy / NewAPI / Task Queue)
          const taskId = extractTaskId(data);
          if (taskId) {
            const polledImg = await pollAsyncTask(taskId, rootBase, cleanApiKey, Math.max(timeoutMs, 180000));
            if (polledImg) {
              return {
                ok: true,
                imageUrl: polledImg,
                methodUsed: 'Async Image Task Polling',
                endpointUsed: imagesEndpoint
              };
            }
            lastError = `异步生图任务 ${taskId} 已提交，但未在时限内取回图片`;
            lastRawError = rawText.slice(0, 500);
            lastStatus = 202;
          } else {
            console.warn('[Custom Image API] Images endpoint returned 200 OK, but could not extract image:', rawText.slice(0, 500));
            lastError = '接口已响应但未解析到图片地址';
            lastRawError = rawText.slice(0, 500);
            lastStatus = 200;
          }
        }
      } else if (typeof data === 'string') {
        const img = extractImageUrlUniversal(data);
        if (img) {
          return {
            ok: true,
            imageUrl: img,
            methodUsed: 'Images API (Text format)',
            endpointUsed: imagesEndpoint
          };
        }
      }
    } else {
      lastStatus = res.status;
      lastRawError = await res.text();
      try {
        const jsonErr = JSON.parse(lastRawError);
        lastError = jsonErr?.error?.message || jsonErr?.message || lastRawError;
      } catch {
        lastError = lastRawError;
      }
    }
  } catch (err: any) {
    const aborted = err?.name === 'AbortError' || String(err?.message || '').toLowerCase().includes('abort');
    lastError = aborted
      ? '生图请求等待超时。供应商后台可能已经出图，但接口未在时限内返回。'
      : (err?.message || 'Images API 连接失败');
    if (aborted) lastStatus = 408;
  }

  // METHOD 3: Chat Completions fallback — only when Images 通道明确不可用
  // Never fallback after a job was already accepted, or after timeout: that would submit a second generation.
  const imagesChannelMissing =
    lastStatus === 404 ||
    lastStatus === 405 ||
    lastRawError.includes('Images API is not supported') ||
    lastRawError.includes('not supported for this platform') ||
    lastRawError.includes('not supported on the images');

  if (
    !imagesJobAccepted &&
    lastStatus !== 408 &&
    (protocol === 'chat-completions' || imagesChannelMissing || lastStatus === 400)
  ) {
    console.log(`[Custom Image API] Images endpoint returned ${lastStatus || 'error'}. Attempting auto-fallback to Chat Completions: ${chatEndpoint} (Model: ${targetModel})`);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const chatRes = await fetch(chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanApiKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'user',
              content: `Please generate and draw an image based on this description. Return the image directly or as markdown:\n${prompt}`
            }
          ]
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (chatRes.ok) {
        const rawChatText = await chatRes.text();
        let chatData: any;
        try {
          chatData = JSON.parse(rawChatText);
        } catch {
          chatData = rawChatText;
        }

        const img = extractImageUrlUniversal(chatData);
        if (img) {
          console.log(`[Custom Image API] Auto-fallback to Chat Completions succeeded! Got image URL.`);
          return {
            ok: true,
            imageUrl: img,
            methodUsed: 'Chat-to-Image 自适应通道 (/v1/chat/completions)',
            endpointUsed: chatEndpoint
          };
        } else {
          console.warn('[Custom Image API] Chat returned text but no image link parsed:', rawChatText.slice(0, 300));
          lastError = '接口已响应但未在回复内容中找到有效图片链接';
          lastRawError = rawChatText.slice(0, 300);
        }
      } else {
        lastStatus = chatRes.status;
        const chatErrText = await chatRes.text();
        lastRawError = chatErrText;
        try {
          const chatJson = JSON.parse(chatErrText);
          lastError = chatJson?.error?.message || chatJson?.message || chatErrText;
        } catch {
          lastError = chatErrText;
        }
        console.warn(`[Custom Image API] Chat fallback status ${chatRes.status}:`, lastError);
      }
    } catch (chatErr: any) {
      console.warn('[Custom Image API] Chat fallback exception:', chatErr?.message);
      if (!lastError) lastError = chatErr?.message || 'Chat 对话通道连接异常';
    }
  }

  // Generate clear diagnostic guide for user
  let diagnosis = '';
  const lowerRaw = (lastRawError + ' ' + lastError).toLowerCase();

  if (
    lowerRaw.includes('no available compatible accounts') ||
    lowerRaw.includes('all available accounts exhausted') ||
    lowerRaw.includes('exhausted')
  ) {
    diagnosis = `【中转站上游无可用渠道 (HTTP 503)】中转站服务商后台为模型「${targetModel}」配置的所有上游账号当前均处于「离线、失效或额度耗尽」状态（服务端返回: No available compatible accounts）。建议：请在中转站控制台切换到有可用上游渠道的 API 分组，或更换为其他第三方生图平台（如 SiliconFlow 硅基流动、OpenAI 官方等）。`;
  } else if (lowerRaw.includes('model_not_found') || lowerRaw.includes('is not supported by any configured account')) {
    diagnosis = `【该令牌所在分组未配置该模型】当前 API 密钥对应的中转分组未开通模型「${targetModel}」的路由。建议：请在中转站后台确认该 Token 绑定的分组权限。`;
  } else if (lowerRaw.includes('not supported on the chat completions') || lowerRaw.includes('not supported for this platform')) {
    diagnosis = `【模型通道不匹配 (HTTP 400/404)】该模型「${targetModel}」未在中转站开启生图或对话通道。建议：请点击上方「🔄 自动拉取支持的模型列表」，选择平台真实支持的模型（例如 dall-e-3、flux 或 midjourney）。`;
  } else if (lowerRaw.includes('insufficient_quota') || lowerRaw.includes('quota') || lowerRaw.includes('余额不足') || lowerRaw.includes('arrears') || lowerRaw.includes('billing')) {
    diagnosis = '【账户额度不足】当前 API Key 在中转平台的账户余额已耗尽，请前往中转站控制台充值。';
  } else if (lastStatus === 401 || lastStatus === 403) {
    diagnosis = '【密钥验证失败】API Key 无效、已过期或无权访问该模型，请检查密钥是否正确并具有充足额度。';
  } else if (lastStatus === 400) {
    diagnosis = `【参数或模型错误 (HTTP 400)】服务商不支持模型名称「${targetModel}」或请求参数。请点击「自动拉取支持的模型列表」选择有效模型。`;
  } else if (lastStatus === 404) {
    diagnosis = `【接口路径 404 未找到】请求端点不存在，且自适应通道未匹配到该模型。请核对中转站模型名称。`;
  } else if (lastStatus === 429) {
    diagnosis = '【请求频率超限】超出中转站或上游平台的请求频率限制，请稍候重试。';
  } else if (lastStatus === 408 || lastError.includes('超时')) {
    diagnosis = '【等待超时】供应商后台可能已经生成完毕，但当前请求在等待回传时超时。请稍后重试一次，或在设置里确认模型是否为异步生图通道。';
  } else if (lastStatus === 202) {
    diagnosis = '【异步任务未取回】生图任务已提交且供应商可能已完成，但未能从任务查询接口拿到图片。请稍后重试。';
  } else if (lastStatus >= 500) {
    diagnosis = `【服务商上游服务异常 (HTTP ${lastStatus})】中转站或其上游接口暂时不可用。建议切换模型或稍后重试。`;
  } else {
    diagnosis = '【连接异常】未能从服务商接口获取到有效图片。请检查 API Key 权限、模型名称及网络连接。';
  }

  return {
    ok: false,
    status: lastStatus,
    endpointUsed: imagesEndpoint,
    error: `[HTTP ${lastStatus || 'ERR'}] ${lastError || '请求失败'}`,
    rawError: lastRawError,
    diagnosis
  };
}

// 2.3 Test custom LLM provider (DeepSeek / OpenAI-compatible)
app.post("/api/llm/test", async (req, res) => {
  const startTime = Date.now();
  const { endpoint, apiKey, model = "deepseek-v4-flash", provider = "deepseek" } = req.body || {};

  if (!endpoint || typeof endpoint !== "string" || !endpoint.trim()) {
    return res.status(400).json({ ok: false, error: "请输入 API 接口地址" });
  }
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return res.status(400).json({ ok: false, error: "请输入 API 密钥" });
  }

  try {
    const result = await callOpenAiCompatibleChat({
      endpoint,
      apiKey,
      model: String(model || "deepseek-v4-flash"),
      provider,
      system: "You are a concise API connectivity checker. Reply with JSON only.",
      user: 'Reply with JSON: {"ok":true,"message":"DeepSeek ready"}',
      temperature: 0,
      json: true,
      timeoutMs: 20000
    });
    const latencyMs = Date.now() - startTime;

    if (result.ok && result.text) {
      const parsed = cleanAndParseJSON<any>(result.text);
      return res.json({
        ok: true,
        latencyMs,
        model: result.model,
        preview: parsed?.message || result.text.slice(0, 80)
      });
    }

    return res.status(result.status && result.status >= 400 ? result.status : 400).json({
      ok: false,
      latencyMs,
      error: result.error
    });
  } catch (err: any) {
    return res.status(500).json({
      ok: false,
      latencyMs: Date.now() - startTime,
      error: err?.message || "LLM 测试请求失败"
    });
  }
});

// 3.1 Test Custom Image Provider API endpoint
app.post("/api/visual/test-custom-api", async (req, res) => {
  const startTime = Date.now();
  const { endpoint, apiKey, model = 'black-forest-labs/FLUX.1-schnell', size = '1024x1024', protocol = 'auto' } = req.body || {};

  if (!endpoint || typeof endpoint !== 'string' || !endpoint.trim()) {
    return res.status(400).json({ ok: false, error: '请输入 API 接口地址 (Endpoint URL)' });
  }
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ ok: false, error: '请输入 API 密钥 (API Key / Token)' });
  }

  const testPrompt = 'Cinematic breathtaking crystal neon city at golden hour, futuristic sci-fi architecture, highly detailed, masterwork 8k wallpaper';
  const targetSize = size === 'auto' ? '1024x1024' : size;
  const targetModel = model.trim();

  try {
    const result = await executeCustomImageRequest({
      endpoint,
      apiKey,
      model: targetModel,
      prompt: testPrompt,
      size: targetSize,
      protocol: protocol as any,
      timeoutMs: 180000
    });

    const latencyMs = Date.now() - startTime;

    if (result.ok && result.imageUrl) {
      return res.json({
        ok: true,
        latencyMs,
        imageUrl: materializeClientImageUrl(result.imageUrl),
        model: targetModel,
        endpoint: result.endpointUsed,
        methodUsed: result.methodUsed
      });
    }

    return res.status(result.status && result.status >= 400 ? result.status : 400).json({
      ok: false,
      status: result.status,
      latencyMs,
      endpointUsed: result.endpointUsed,
      error: result.error,
      diagnosis: result.diagnosis
    });
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = err?.name === 'AbortError' || String(err?.message || '').includes('timeout') || String(err?.message || '').includes('abort');

    return res.status(500).json({
      ok: false,
      latencyMs,
      endpointUsed: endpoint,
      error: isTimeout ? '请求超时 (40s 超时)' : `网络连接异常: ${err?.message || '无法连接到目标服务'}`,
      diagnosis: isTimeout
        ? '【请求超时】服务商生成耗时过长或网络连接缓慢，请检查该服务商节点状态或更换更轻量的 schnell 模型。'
        : '【网络不可达】无法连接到指定 API 域名，请检查 URL 是否正确无误，或服务商是否要求特定网络环境。'
    });
  }
});

// 3.2 Fetch available models list from provider (/v1/models)
app.post("/api/visual/fetch-models", async (req, res) => {
  const { endpoint, apiKey } = req.body || {};

  if (!endpoint || typeof endpoint !== 'string' || !endpoint.trim()) {
    return res.status(400).json({ ok: false, error: '请输入 API 接口地址 (Endpoint URL)' });
  }
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ ok: false, error: '请输入 API 密钥 (API Key / Token)' });
  }

  let rawEndpoint = String(endpoint).trim().replace(/^["']|["']$/g, '');
  if (!rawEndpoint.startsWith('http://') && !rawEndpoint.startsWith('https://')) {
    rawEndpoint = 'https://' + rawEndpoint;
  }
  rawEndpoint = rawEndpoint.replace(/\/+$/, '');

  // Extract base URL
  let baseUrl = rawEndpoint;
  if (baseUrl.includes('/images/generations')) {
    baseUrl = baseUrl.replace(/\/images\/generations.*$/, '');
  } else if (baseUrl.includes('/chat/completions')) {
    baseUrl = baseUrl.replace(/\/chat\/completions.*$/, '');
  }
  if (baseUrl.endsWith('/v1')) {
    baseUrl = baseUrl.slice(0, -3);
  }

  let cleanApiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
  if (cleanApiKey.toLowerCase().startsWith('bearer ')) {
    cleanApiKey = cleanApiKey.slice(7).trim();
  }

  const candidateUrls = [
    `${baseUrl}/v1/models`,
    `${baseUrl}/models`,
    `${rawEndpoint}/models`
  ];

  let lastError: string = '';
  let lastStatus = 500;

  for (const modelUrl of candidateUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 12000);

      const response = await fetch(modelUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${cleanApiKey}`,
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        let rawList: any[] = [];
        if (Array.isArray(data?.data)) {
          rawList = data.data;
        } else if (Array.isArray(data?.models)) {
          rawList = data.models;
        } else if (Array.isArray(data)) {
          rawList = data;
        }

        const allModelIds: string[] = rawList
          .map((item: any) => (typeof item === 'string' ? item : item?.id || item?.name))
          .filter((id: any): id is string => Boolean(id && typeof id === 'string'));

        // Identify image-capable models
        const imageKeywords = [
          'flux', 'dall', 'sd', 'stable-diffusion', 'midjourney', 'mj',
          'image', 'recraft', 'ideogram', 'cogview', 'kolors', 'canvas',
          'kling', 'runway', 'sora', 'luma', 'doubao-image', 'qwen-vl', 'seed', 'animagine'
        ];

        const imageModels = allModelIds.filter(id => {
          const lower = id.toLowerCase();
          return imageKeywords.some(kw => lower.includes(kw));
        });

        return res.json({
          ok: true,
          models: allModelIds,
          imageModels: imageModels,
          totalCount: allModelIds.length,
          modelUrlUsed: modelUrl
        });
      } else {
        lastStatus = response.status;
        const errBody = await response.text();
        lastError = `[HTTP ${response.status}] ${errBody || '获取模型列表失败'}`;
      }
    } catch (e: any) {
      lastError = e?.message || '请求超时或网络异常';
    }
  }

  return res.status(lastStatus).json({
    ok: false,
    error: `无法从端点获取模型列表: ${lastError}`,
    diagnosis: lastStatus === 401 
      ? 'API Key 无效或未授权访问 /v1/models 接口。' 
      : '该服务商可能未开放 /v1/models 接口，或端点地址不正确。您仍可以直接手动填入模型名称进行生图。'
  });
});

// 4. Batch topic inspiration
app.post("/api/topics/suggest", async (req, res) => {
  const { category = "热门趋势" } = req.body || {};
  const ai = getGeminiClient();

  const fallbackTopics: Record<string, string[]> = {
    "热门趋势": [
      "深海一万米到底隐藏着什么未知生物？",
      "未来10年，普通人如何通过AI打造超级个体？",
      "宇宙大爆炸之前究竟存在什么？",
      "为什么越来越多年轻人开始践行极简主义生活？",
      "被神话掩盖的历史真相：古蜀文明到底来自哪里？",
      "脑机接口技术将如何彻底改写人类记忆与认知？"
    ],
    "爆款科普": [
      "如果地球突然停止自转1秒钟会发生什么？",
      "光年到底有多远？带你沉浸式体验光速穿越太阳系",
      "为什么人类的大脑只开发了10%是个巨大的谣言？",
      "量子纠缠究竟有多诡异？爱因斯坦为何称它为鬼魅行动？"
    ],
    "情感治愈": [
      "允许一切发生：治愈你所有焦虑的生命智慧",
      "走过半生才明白：真正的高贵，是不与烂人烂事纠缠",
      "不必行色匆匆，不必光芒万丈，做一棵安静生长的树"
    ]
  };

  const defaultList = fallbackTopics[category] || fallbackTopics["热门趋势"];

  if (!ai) {
    return res.json({ topics: defaultList });
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.7-flash",
      contents: `请针对分类【${category}】，推荐 6 个适合制作 30~60 秒爆款短视频的主题，要求标题极具悬念感或视觉冲击力。以JSON数组返回字符串列表。`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: { type: Type.STRING }
        }
      }
    });

    const parsed = cleanAndParseJSON<string[]>(response.text);
    if (parsed && Array.isArray(parsed) && parsed.length > 0) {
      return res.json({ topics: parsed });
    }
    return res.json({ topics: defaultList });
  } catch (error: any) {
    console.warn("[Topic Suggest] Gemini fallback:", error?.message);
    return res.json({ topics: defaultList });
  }
});

// 5. Microsoft Edge Neural Voice TTS Synthesis (100% Free, Studio-grade Audio)
app.post("/api/audio/tts", async (req, res) => {
  try {
    const { text, character = "magnetic-male", rate = 1.0 } = req.body || {};

    if (!text || typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    // Voice mapping for popular Edge Neural voices
    const voiceMap: Record<string, string> = {
      "magnetic-male": "zh-CN-YunxiNeural",       // 磁性影视解说男声 (云希)
      "warm-female": "zh-CN-XiaoxiaoNeural",      // 温柔生活情感女声 (晓晓)
      "tech-anchor": "zh-CN-YunyangNeural",       // 专业科技商业男声 (云扬)
      "documentary-male": "zh-CN-YunjianNeural",  // 纪录片深沉男声 (云健)
      "mystery-noir": "zh-CN-YunxiNeural",        // 悬疑低沉男声 (云希)
      "vibrant-creator": "zh-CN-XiaoyiNeural",    // 活力自然女声 (晓伊)
      "bilingual-en": "en-US-ChristopherNeural",   // 美语自然男主播
      "bilingual-female": "en-US-JennyNeural"     // 美语自然女主播
    };

    const targetVoice = voiceMap[character] || "zh-CN-YunxiNeural";

    // Rate calculation e.g. "+10%", "-5%"
    const ratePercent = Math.round((rate - 1.0) * 100);
    const rateStr = `${ratePercent >= 0 ? "+" : ""}${ratePercent}%`;

    const tts = new MsEdgeTTS();
    await tts.setMetadata(targetVoice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const { audioStream } = tts.toStream(text.trim(), { 
      rate: rateStr,
      pitch: character === "mystery-noir" ? "-5Hz" : "+0Hz"
    });

    const chunks: Buffer[] = [];
    audioStream.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    audioStream.on("end", () => {
      const audioBuffer = Buffer.concat(chunks);
      const base64Audio = `data:audio/mp3;base64,${audioBuffer.toString("base64")}`;
      res.json({
        audioUrl: base64Audio,
        voice: targetVoice,
        format: "mp3",
        character
      });
    });

    audioStream.on("error", (streamErr) => {
      console.warn("Edge TTS stream error:", streamErr);
      res.status(500).json({ error: "Edge TTS synthesis stream failed" });
    });
  } catch (err: any) {
    console.error("TTS endpoint error:", err);
    res.status(500).json({ error: err.message || "Failed to generate TTS audio" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Video Studio server running on http://localhost:${PORT}`);
  });
}

startServer();
