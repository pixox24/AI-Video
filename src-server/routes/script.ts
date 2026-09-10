// @ts-nocheck — mechanical port of server.ts script routes; behavior frozen.
import type { Express } from "express";
import { Type } from "@google/genai";
import type { ScriptGenre, ScriptLanguage, ScriptSection } from "../../src/types";
import { STYLE_DIRECTOR_SYSTEM } from "../../src/utils/stylePack";
import {
  bilingualTarget,
  countBudgetUnits,
  countCjk,
  countLatin,
  inferScriptLanguage,
  languageProfile,
  normalizeScriptLanguage
} from "../../src/utils/scriptLanguage";
import {
  FILL_RATIO_MIN,
  LLM_JSON_MAX_TOKENS,
  LLM_LONGFORM_MAX_TOKENS,
  TRANSLATE_BATCH_SIZE,
  chunkItems,
  clampVideoSeconds,
  isLongForm,
  llmMaxTokensForSeconds,
  llmTimeoutMsForSeconds,
  longFormTotalTimeoutMsForSeconds,
  resolveScriptForm
} from "../../src/utils/scriptDuration";
import { emptySectionFromPlan, flattenSectionBeats, joinSectionNarrations, planScriptSections } from "../../src/utils/scriptSections";
import {
  buildRevisionPlan,
  completedSectionSummaries,
  mergeSectionIntoWorkspaceSections,
  normalizeScriptBrief,
  outlineFromPlans,
  stampOutlineBudgets,
  validateOutline,
  validateSectionAgainstOutline,
  validateScriptProgression
} from "../../src/utils/scriptOutline";
import {
  OUTLINE_SYSTEM,
  SECTION_DRAFT_SYSTEM,
  SECTION_REVISE_SYSTEM,
  outlineUserPrompt,
  sectionDraftUserPrompt,
  sectionReviseUserPrompt
} from "../../src/utils/scriptPrompts";
import { draftGate, runSectionedDraft } from "../../src/utils/scriptDraftEngine";
import { fitTextChunksToCount, splitCoversSource, splitPastedNarration } from "../../src/utils/scriptSplit";
import { coerceLlmDraftPayload, describeDraftPayloadGap, normalizeDraftBeats, validateDraftResult } from "../../src/utils/scriptDraft";
import { splitCompleteSentences } from "../../src/utils/speechSpans";
import {
  bibleContractForPrompt,
  normalizeVisualBible,
  visualBibleModeForGenre
} from "../../src/utils/visualBible";
import { compileVisualBible } from "../../src/services/visualBibleService";
import { errorMessage, requestBody, toLoose, toLooseList, type Loose } from "../loose";
import { incomingStyleContract } from "../style-contract";
import { isUsableLlmApi } from "../llm/client-api";
import { generateGeminiJson, generateStructured, runScriptLlmJson, runScriptLlmJsonDetailed } from "../llm/gateway";
import { cleanAndParseJSON } from "../llm/parse";
import { generateIntelligentShots, validateGeneratedShots } from "../pipeline/shortform";
import { fallbackTopicCardsServer } from "../pipeline/script-fallbacks";
import { fetchPageFinding, searchWeb } from "../pipeline/research";
import { scriptDraftContext } from "../pipeline/script-context";
import { asClientLlmApi } from "../llm/client-api";
import { outlineSchema } from '../../src/shared/contentBrief';

/** Compatibility shim: existing callOpenAiCompatibleChat sites go through gateway. */
async function gatewayChat(opts: {
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
  stage?: string;
}) {
  const result = await generateStructured({
    stage: opts.stage || "script_draft",
    role: "drafter",
    clientLlmApi: {
      enabled: true,
      endpoint: opts.endpoint,
      apiKey: opts.apiKey,
      model: opts.model,
      provider: opts.provider
    },
    system: opts.system,
    user: opts.user,
    temperature: opts.temperature,
    timeoutMs: opts.timeoutMs,
    maxTokens: opts.maxTokens,
    json: opts.json
  });
  if (result.data == null && !result.text) {
    return { ok: false as const, error: result.reason, text: undefined, model: result.run.model };
  }
  const text = result.text || (typeof result.data === "string" ? result.data : JSON.stringify(result.data));
  return { ok: true as const, text, model: result.run.model, error: undefined };
}

function countChars(text: string, language: ScriptLanguage = "zh") {
  return countBudgetUnits(text, language);
}

export function registerScriptRoutes(app: Express): void {

app.post("/api/script/generate", async (req, res) => {
  const { 
    topic, 
    genre = "爆款科普", 
    targetDuration = 30, 
    visualStyle = "cinematic", 
    clipCount = 4,
    tone = "punchy",
    llmApi
  } = requestBody(req.body as unknown);

  if (!topic || typeof topic !== "string" || !topic.trim()) {
    return res.status(400).json({ error: "Topic is required" });
  }

  const cleanTopic = topic.trim();
  const requestedDuration = Number(targetDuration) || 30;
  if (Number.isFinite(requestedDuration) && requestedDuration > 120) {
    return res.status(410).json({
      error: "长视频请使用 /api/script/draft；/api/script/generate 仅保留短视频兼容能力。",
      code: "legacy_shortform_endpoint"
    });
  }
  const safeDuration = clampVideoSeconds(requestedDuration, 30).seconds;
  const safeCount = Math.max(3, Math.min(8, Number(clipCount) || 4));

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
      const llmResult = await gatewayChat({
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
          cleanAndParseJSON(llmResult.text),
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

    const gemini = await generateGeminiJson({
      stage: "script_generate",
      system: systemInstruction,
      user: prompt,
      temperature: 0.75,
      models: ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.1-pro-preview"],
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
                transition: { type: Type.STRING }
              },
              required: ["order", "duration", "narration", "visualPrompt", "chineseVisualPrompt", "cameraMotion", "transition"]
            }
          }
        },
        required: ["title", "shots"]
      }
    });
    const validated = validateGeneratedShots(gemini.data, cleanTopic, genre, safeDuration);
    if (validated) return res.json(validated);

    console.warn("[Script Generation] LLM output unavailable or invalid, using domain generator");
    return res.json(fallbackResult());
  } catch (error: unknown) {
    console.warn("[Script Generation] LLM exception encountered, gracefully deploying storyboard engine:", errorMessage(error));
    return res.json(fallbackResult());
  }
});

app.post("/api/script/topics", async (req, res) => {
  const {
    intent = "blank",
    intentNotes = "",
    lockedTitle = "",
    platform = "douyin",
    pace = "medium",
    researchNotes,
    researchBrief,
    genrePackId,
    llmApi,
    scriptLanguage
  } = requestBody(req.body as unknown);
  const language = normalizeScriptLanguage(scriptLanguage);
  const profile = languageProfile(language);
  const seed = String(lockedTitle || intentNotes || "").trim();
  const fallback = () => ({ cards: fallbackTopicCardsServer(seed, String(intent || "blank"), language) });
  const pinFirstCard = (cards: Loose[]) => {
    if (String(intent) !== "have-title" || !seed || !Array.isArray(cards) || cards.length === 0) return cards;
    return [{ ...cards[0], title: seed }, ...cards.slice(1)];
  };
  const haveTitleRule = String(intent) === "have-title" && seed
    ? `\n- 用户已有标题「${seed}」。第一张卡的 title 必须逐字等于该标题；另两张必须换 insight 和钩子结构，主题词保持一致。禁止把用户标题改成更「爆」的同义句。`
    : "";

  const languageRule = language === "en"
    ? `- Write title, hook, insight, whyNow, risk, completionFit, whyThisWorks in natural spoken English.
- hook ≤ ${profile.hookMax} English words
- title ≤ ${profile.topicTitleMax} English words${haveTitleRule ? "（第一张卡除外，必须等于用户原标题）" : ""}
- genre 仍用中文枚举：科普、反常识、故事、教程、带货、情绪、热点解读、口播金句`
    : `- hook 不超过 ${profile.hookMax} 个汉字
- title 不超过 ${profile.topicTitleMax} 个汉字${haveTitleRule ? "（第一张卡除外，必须等于用户原标题）" : ""}
- genre 只能是：科普、反常识、故事、教程、带货、情绪、热点解读、口播金句`;

  const prompt = `你是短视频选题导演。根据用户入口、备注和调研，给出恰好 3 张选题卡。
规则：
- 三张卡的 insight 必须不同，钩子结构必须不同（分别用 misconception / outcome / mystery 或 stakes）
- whyNow 必须具体，禁止写「这个话题很火」「很有意义」
${languageRule}
- paceHint 只能是：ultrafast、fast、medium、slow、cinematic
- durationHint 只能是 15、21、30、45、60、90 之一
- conceptCount 为 1 或 2
- structure 只能是 myth_busting / problem_solution / story / tutorial / contrast / reveal，三张必须不同
- whyThisWorks 一句话，必须引用调研里的具体点（若有）${haveTitleRule}

【入口】${intent}
【平台】${platform}
【节奏意向】${pace}
【体裁包】${genrePackId || "未选"}
【用户备注】${seed || "（空白，请在该领域给出可拍选题）"}
【调研笔记】${JSON.stringify(researchNotes || {})}
【调研摘要】${researchBrief?.summary || ""}

只输出 JSON：{"cards":[{id,title,hook,insight,genre,whyNow,durationHint,paceHint,conceptCount,risk,completionFit,hookType,structure,whyThisWorks}]}`;

  try {
    const system = "你只输出合法 JSON，不要解释。";
    if (isUsableLlmApi(llmApi)) {
      const llmResult = await gatewayChat({
        endpoint: String(llmApi.endpoint),
        apiKey: String(llmApi.apiKey),
        model: String(llmApi.model || "deepseek-v4-flash"),
        provider: llmApi.provider,
        system,
        user: prompt,
        temperature: 0.8,
        json: true
      });
      if (llmResult.ok && llmResult.text) {
        const parsed = cleanAndParseJSON(llmResult.text);
        if (Array.isArray(parsed?.cards) && parsed.cards.length >= 3) {
          return res.json({
            cards: pinFirstCard(parsed.cards.slice(0, 3).map((card: Loose, index: number) => ({
              id: card.id || `topic-${index + 1}-${Date.now()}`,
              title: String(card.title || "").slice(0, language === "en" ? 80 : 24) || (language === "en" ? `Angle ${index + 1}` : `选题 ${index + 1}`),
              hook: String(card.hook || ""),
              insight: String(card.insight || ""),
              genre: card.genre || "科普",
              whyNow: String(card.whyNow || ""),
              durationHint: Number(card.durationHint) || 30,
              paceHint: card.paceHint || "medium",
              conceptCount: Number(card.conceptCount) || 1,
              risk: String(card.risk || ""),
              completionFit: String(card.completionFit || ""),
              hookType: String(card.hookType || "question")
            })))
          });
        }
      }
    }

    const gemini = await generateGeminiJson({
      stage: "topics",
      system,
      user: prompt,
      temperature: 0.8
    });
    const parsed = toLoose(gemini.data);
    if (Array.isArray(parsed.cards) && parsed.cards.length >= 3) {
      return res.json({ cards: pinFirstCard(toLooseList(parsed.cards).slice(0, 3)) });
    }
    return res.json(fallback());
  } catch (error: unknown) {
    console.warn("[Script Topics] fallback:", errorMessage(error));
    return res.json(fallback());
  }
});

app.post("/api/script/draft", async (req, res) => {
  const {
    topic,
    topicCard,
    intent,
    intentNotes,
    lockedTitle,
    researchNotes,
    budget,
    genrePack,
    llmApi,
    stylePack,
    scriptLanguage,
    brief: rawBrief,
    outline: rawOutline,
    sections: existingDraftSections,
    scriptFormOverride,
    confirmOutlineBeforeDraft
  } = requestBody(req.body as unknown);
  const language = normalizeScriptLanguage(scriptLanguage || budget?.scriptLanguage);
  const title = String(
    (intent === "have-title" ? lockedTitle : "") || topicCard?.title || topic || intentNotes || "这件事"
  ).trim();
  const requestedMaxChars = Number(budget?.maxChars);
  const maxChars = Math.min(20000, Math.max(24, Number.isFinite(requestedMaxChars) && requestedMaxChars > 0 ? requestedMaxChars : 110));
  const minChars = Math.max(16, Math.ceil(maxChars * FILL_RATIO_MIN));
  const targetSeconds = clampVideoSeconds(Number(budget?.targetSeconds) || 30, 30).seconds;
  const pace = budget?.pace || "medium";
  const notes = String(intentNotes || topicCard?.insight || "").trim();
  const longForm = isLongForm(targetSeconds);
  const form = resolveScriptForm(targetSeconds, scriptFormOverride);
  const brief = normalizeScriptBrief(rawBrief);
  const genreId = genrePack?.id || topicCard?.genre;
  let latestLlmFailureReason = "";
  const beatPlan = Array.isArray(genrePack?.beatPlan) ? genrePack.beatPlan.join(" → ") : "";
  const haveTitleRule = intent === "have-title"
    ? `\n- 输出 title 必须逐字等于「${title}」，不得改写、不得加修饰\n- 口播是展开题目，禁止只换说法把标题重复三遍\n- 若备注为空，把推断的「要讲清什么」写在第二节拍的 intent，不要写进 title`
    : "";
  const notesRule = notes
    ? `\n- 【要讲清什么】是硬约束，不是可忽略备注：口播必须体现「${notes}」。禁止把这句话复述成标题，禁止写成说明书。把要求写进对应节拍的 intent，并在 fullNarration 里用可拍的情节落地。`
    : "";
  const pinDraftTitle = (parsed: unknown) => {
    if (intent === "have-title" && parsed && typeof parsed === "object") parsed.title = title;
    return parsed;
  };
  const rejectFallback = (warnings: string[] = [], error?: string, extra: Record<string, unknown> = {}) => {
    const validationDetail = String(warnings[0] || "").trim();
    const detail = String(latestLlmFailureReason || validationDetail).trim();
    const reason = `${validationDetail} ${latestLlmFailureReason}`.toLowerCase();
    const customLlmFailed = latestLlmFailureReason.startsWith("自定义 LLM：")
      || latestLlmFailureReason === "自定义 LLM 返回的内容不是有效 JSON";
    const cannedLabel = form === "short" ? "未套用模板稿" : "未套用短稿";
    let code = "draft_contract_failed";
    let message = form === "short"
      ? `模型没有返回可校验的短视频稿，${cannedLabel}。`
      : "模型输出未满足完整长稿的质量约束，未套用短稿。";
    let recommendation = "请重试；若持续出现，换用支持 JSON 输出且上下文更长的模型。";

    if (/超时|timeout|timed out|abort/.test(reason)) {
      code = "llm_timeout";
      message = form === "short"
        ? `模型没有在时限内完成短视频稿，${cannedLabel}。`
        : "模型没有在长稿生成时限内完成，未套用短稿。";
      recommendation = "请换用更快的模型，或先降低视频时长/节奏预算后重试。";
    } else if (/fetch failed|network|网络异常|econn|enotfound|socket/.test(reason)) {
      code = "llm_connection_failed";
      message = "无法连接到 LLM 服务，未生成完整稿。";
      recommendation = "请检查网络、接口地址和服务商可用性；自定义 LLM 请先在设置 > LLM 点击“测试连接”。";
    } else if (customLlmFailed && /api key|密钥|unauthorized|forbidden|401|403|404|model.*not/.test(reason)) {
      code = "llm_configuration_failed";
      message = "LLM 配置或模型服务不可用，未生成完整稿。";
      recommendation = "请在设置 > LLM 检查接口地址、API Key、模型名称，并点击“测试连接”。";
    } else if (customLlmFailed && /不是有效 json/.test(reason)) {
      code = "llm_response_invalid";
      message = form === "short"
        ? `模型没有返回可校验的短视频稿，${cannedLabel}。`
        : "模型没有返回可校验的完整稿，未套用短稿。";
      recommendation = "请重试；持续失败时请换用支持 JSON 模式的模型，并在设置中测试连接。";
    } else if (customLlmFailed) {
      code = "llm_configuration_failed";
      message = form === "short"
        ? `自定义 LLM 未能完成短视频写稿，${cannedLabel}。`
        : "自定义 LLM 未能完成长稿请求，未生成完整稿。";
      recommendation = "请在设置 > LLM 测试当前模型；确认它支持 JSON 输出和足够长的回复。";
    } else if (/location is not supported|当前网络或地区不可用|user location/.test(reason)) {
      code = "builtin_llm_region_unsupported";
      message = "内置 Gemini 在当前网络或地区不可用，无法生成完整稿。";
      recommendation = "请在设置 > LLM 配置一个可用的 OpenAI-compatible 服务商，并先点击“测试连接”。";
    } else if (/未配置|api key|密钥|unauthorized|forbidden|401|403|404|model.*not/.test(reason)) {
      code = "llm_configuration_failed";
      message = "LLM 配置或模型服务不可用，未生成完整稿。";
      recommendation = "请在设置 > LLM 检查接口地址、API Key、模型名称，并点击“测试连接”。";
    } else if (/不是有效 json|没有返回可用|没有口播|缺少全文|有效节拍不足/.test(reason)) {
      code = "llm_response_invalid";
      message = form === "short"
        ? `模型没有返回可校验的短视频稿，${cannedLabel}。`
        : "模型没有返回可校验的完整稿，未套用短稿。";
      recommendation = "请重试；持续失败时请换用支持 JSON 模式的模型，并在设置中测试连接。";
    }

    return res.status(503).json({
      source: "fallback",
      code,
      error: error || message,
      detail: detail || undefined,
      validationDetail: validationDetail || undefined,
      recommendation,
      warnings,
      longForm,
      scriptForm: form,
      ...extra
    });
  };

  const styleContract = incomingStyleContract(stylePack);
  const unitName = language === "en" ? "词" : "字";
  const budgetRule = language === "en"
    ? `- Write fullNarration and every beat.narration in natural spoken English. Do not write Chinese voiceover.
- fullNarration word count must be between ${minChars} and ${Math.round(maxChars * 1.05)} (target ${maxChars}). Do not stop early.`
    : `- fullNarration 去掉空白后的汉字数必须在 ${minChars}–${Math.round(maxChars * 1.05)} 之间（目标 ${maxChars}），不要只写「不超过」，必须填满约 90%–105%。`;

  const contextBlock = `【题目】${title}
【钩子】${topicCard?.hook || ""}
【洞察】${topicCard?.insight || ""}
【结构】${topicCard?.structure || genrePack?.structure || ""}
【体裁包】${genrePack?.id || topicCard?.genre || ""} ${genrePack?.draftHint || ""}
【入口】${intent || ""}
【备注】${intentNotes || ""}
【调研】对标:${researchNotes?.competitor || ""}；问题:${researchNotes?.audienceQuestion || ""}；事实:${researchNotes?.fact || ""}；画面:${researchNotes?.visualRef || ""}
【目标时长】${targetSeconds}s 【节奏】${pace} 【${unitName}预算】${minChars}–${maxChars} 【口播语言】${language}`;

  const stampDraft = (parsed: unknown, source: "llm", extra: Record<string, unknown> = {}) => {
    const fullNarration = String(parsed?.fullNarration || "").trim();
    const normalizedBeats = normalizeDraftBeats(parsed?.beats).map((beat, index) => ({
      ...beat,
      id: `beat-${index + 1}`,
      order: index + 1
    }));
    const used = countChars(fullNarration, language);
    const validation = validateDraftResult({
      fullNarration,
      beats: normalizedBeats,
      sections: parsed?.sections,
      maxChars,
      targetSeconds,
      scriptLanguage: language,
      source
    });
    const warnings = [
      ...(Array.isArray(parsed?.warnings) ? parsed.warnings : []),
      ...validation.warnings,
      ...(used > maxChars ? [`超预算 ${used - maxChars} ${unitName}`] : [])
    ].filter(Boolean);
    return pinDraftTitle({
      ...parsed,
      fullNarration,
      beats: normalizedBeats,
      source,
      warnings,
      longForm,
      budgetStatus: used > maxChars * 1.05 ? "over_budget" : used < minChars ? "under_budget" : "ok",
      overByChars: used > maxChars * 1.05 ? used - Math.round(maxChars * 1.05) : 0,
      fillRatio: validation.fill,
      ...extra
    });
  };

  const shortPrompt = `你是短视频口播导演。按${unitName}数预算写一整段连续口播，并拆成节拍。秒数不要你估，只写${language === "en" ? "词" : "字"}。
硬约束：
${budgetRule}
- 第一拍 function 必须是 hook
- 最后一拍 function 必须是 cta 或 reveal
- visualIntent 必须写看得见的因果，禁止「很有氛围」「电影感」
- 第一拍 visualIntent 必须同时有：主体足够大、正在做什么、一个尚未完成的可见异常（光种、未落下的动作、环境开始回应）。禁止只写「张嘴/很有氛围」，禁止把场景说明书再写一遍。
- visualIntent 必须服从下面的美术世界契约（服饰、道具、建筑、时代）
- 若体裁是故事或情绪：visualIntent 必须反复画同一个可指认的人（发型+服装锁定），优先待在同一空间；收束拍回收钩子的构图或物件。不要每拍换主角。
- 若体裁是科普/教程/带货/反常识：允许按句图解，但色板和道具材质保持一致。
- 全文只服务一个主张、一个反差或一个结果；禁止为了填时长引入第二主题
- 不要改口播去迁就风格
- beats ${longForm ? "按章节展开，总数随时长增加，不要压成 4–8 个" : "4 到 8 个"}，优先按体裁包节拍：${beatPlan || "hook → setup → turn → proof → cta"}
- energy 只能是 fast / medium / slow / hold
- function 只能是 hook / setup / turn / proof / reveal / cta${haveTitleRule}${notesRule}

${styleContract}

${contextBlock}

只输出 JSON：{"title":string,"fullNarration":string,"beats":[{"id","order","function","intent","narration","energy","visualIntent","needsHold"}]}`;

  try {
    const system = STYLE_DIRECTOR_SYSTEM;
    const deadline = Date.now() + longFormTotalTimeoutMsForSeconds(targetSeconds);
    const ask = async (user: string, maxTokens = llmMaxTokensForSeconds(targetSeconds), systemPrompt = system): Promise<unknown> => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), remaining);
        runScriptLlmJsonDetailed({
          llmApi,
          system: systemPrompt,
          user,
          temperature: 0.7,
          timeoutMs: Math.min(llmTimeoutMsForSeconds(targetSeconds), remaining),
          maxTokens,
          stage: systemPrompt === OUTLINE_SYSTEM
            ? "blueprint"
            : systemPrompt === SECTION_DRAFT_SYSTEM
              ? "script_section"
              : "script_draft",
          role: systemPrompt === OUTLINE_SYSTEM ? "planner" : "drafter"
        }).then((result) => {
          clearTimeout(timer);
          if (!result.data && result.reason) latestLlmFailureReason = result.reason;
          resolve(result.data);
        }).catch(() => {
          clearTimeout(timer);
          resolve(null);
        });
      });
    };

    if (form !== "short") {
      const plans = planScriptSections({
        targetSeconds,
        maxChars,
        genre: genreId,
        form
      });
      let outline = stampOutlineBudgets(
        rawOutline && Array.isArray(rawOutline.sections) && rawOutline.sections.length > 0
          ? rawOutline
          : outlineFromPlans(plans, { status: "draft" }),
        plans,
        rawOutline?.sections
      );

      const buildOutlineFromModel = async () => {
        const parsed = await ask(outlineUserPrompt({
          title,
          brief,
          contextBlock,
          plans,
          unitName,
          notesRule: `${haveTitleRule}${notesRule}`
        }), 4000, OUTLINE_SYSTEM);
        return stampOutlineBudgets({
          ...outline,
          status: outline.status === "confirmed" ? "confirmed" : "draft",
          version: Number(outline.version) || 1,
          oneSentenceThesis: String(parsed?.oneSentenceThesis || outline.oneSentenceThesis || title)
        }, plans, parsed?.sections);
      };

      const gate = draftGate({ form, outline, confirmMedium: Boolean(confirmOutlineBeforeDraft) });
      if (gate.action === "outline_preview" || gate.action === "outline_required") {
        outline = await buildOutlineFromModel();
        return res.status(409).json({
          source: "llm",
          code: gate.action,
          error: gate.action === "outline_preview"
            ? "段落视频已生成轻提纲，确认或直接按提纲写稿。"
            : "长视频需要先确认全片提纲，再逐章写稿。",
          outline,
          brief,
          recommendation: gate.action === "outline_preview"
            ? "可编辑轻提纲后点「按提纲写稿」，无需强制确认。"
            : "请在提纲页核对章节任务后，点击确认提纲。",
          longForm: true,
          scriptForm: form
        });
      }

      const drafted = await runSectionedDraft({
        ask,
        plans,
        outline,
        priorSections: Array.isArray(existingDraftSections) ? existingDraftSections : [],
        brief,
        language,
        maxTokens: LLM_LONGFORM_MAX_TOKENS,
        system: SECTION_DRAFT_SYSTEM,
        buildPrompt: (section, planned, completed) => sectionDraftUserPrompt({
          language,
          section: planned,
          sectionIndex: planned.order - 1,
          sectionCount: outline.sections.length,
          brief,
          thesis: outline.oneSentenceThesis,
          summaries: completedSectionSummaries(completed, language),
          contextBlock,
          styleContract,
          unitName,
          notesRule: `${haveTitleRule}${notesRule}`
        })
      });
      if (!drafted.ok) {
        return rejectFallback(drafted.warnings, undefined, {
          sections: drafted.sections,
          outline,
          failedSectionId: drafted.failedSectionId
        });
      }
      const sections = drafted.sections;

      const fullNarration = joinSectionNarrations(sections, language);
      const beats = flattenSectionBeats(sections);
      const stamped = stampDraft({
        title: outline.oneSentenceThesis || title,
        fullNarration,
        beats,
        sections,
        outline: { ...outline, status: outline.status === "confirmed" ? "confirmed" : "draft" },
        brief,
        scriptForm: form
      }, "llm");
      const validation = validateDraftResult({
        fullNarration,
        beats,
        sections,
        maxChars,
        targetSeconds,
        scriptLanguage: language,
        source: "llm",
        durationMode: "target-driven"
      });
      const sectionValidation = validateScriptProgression(sections, outline, language);
      if (!sectionValidation.ok) return rejectFallback(sectionValidation.warnings);
      if (!validation.ok) return rejectFallback(validation.warnings);
      return res.json(stamped);
    }

    const readShortDraft = (raw: unknown) => {
      const coerced = coerceLlmDraftPayload(raw);
      if (coerced) {
        return {
          parsed: { ...(raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}), ...coerced },
          warnings: [] as string[]
        };
      }
      return {
        parsed: null,
        warnings: [raw ? describeDraftPayloadGap(raw) : (latestLlmFailureReason || "模型没有返回可用口播和节拍")]
      };
    };

    let { parsed, warnings: lastWarnings } = readShortDraft(await ask(shortPrompt));
    if (lastWarnings.length === 0) lastWarnings = ["模型没有返回可用口播和节拍"];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (parsed?.fullNarration && Array.isArray(parsed.beats) && parsed.beats.length >= 2) {
        const stamped = stampDraft(parsed, "llm");
        const validation = validateDraftResult({
          fullNarration: stamped.fullNarration,
          beats: stamped.beats,
          maxChars,
          targetSeconds,
          scriptLanguage: language,
          source: "llm",
          durationMode: "target-driven"
        });
        if (validation.ok) return res.json(stamped);
        lastWarnings = validation.warnings.length ? validation.warnings : lastWarnings;
      }
      const retry = readShortDraft(await ask(`${shortPrompt}\n上次输出未通过校验：${lastWarnings.join('；')}。请严格修正，并确保全文与 beats.narration 按顺序逐字覆盖。`));
      parsed = retry.parsed;
      if (retry.warnings.length) lastWarnings = retry.warnings;
    }
    return rejectFallback(lastWarnings);
  } catch (error: unknown) {
    console.warn("[Script Draft] failed:", errorMessage(error));
    return rejectFallback([String(errorMessage(error))]);
  }
});

function scriptDraftContext(body: unknown) {
  const language = normalizeScriptLanguage(body?.scriptLanguage || body?.budget?.scriptLanguage);
  const requestedMaxChars = Number(body?.budget?.maxChars || body?.budget?.targetUnits);
  const maxChars = Math.min(20000, Math.max(24, Number.isFinite(requestedMaxChars) && requestedMaxChars > 0 ? requestedMaxChars : 110));
  const targetSeconds = clampVideoSeconds(Number(body?.budget?.targetSeconds) || 30, 30).seconds;
  const title = String(
    (body?.intent === "have-title" ? body?.lockedTitle : "") || body?.topicCard?.title || body?.topic || body?.intentNotes || "这件事"
  ).trim();
  const brief = normalizeScriptBrief(body?.brief);
  const genre = body?.genrePack?.id || body?.topicCard?.genre || body?.genre;
  const form = resolveScriptForm(targetSeconds, body?.scriptFormOverride || body?.scriptForm);
  const plans = planScriptSections({ targetSeconds, maxChars, genre, form });
  return { language, maxChars, targetSeconds, title, brief, genre, plans, unitName: language === "en" ? "词" : "字", form };
}

app.post("/api/script/outline", async (req, res) => {
  const body = requestBody(req.body as unknown);
  const { language, maxChars, targetSeconds, title, brief, genre, plans, unitName, form } = scriptDraftContext(body);
  const styleContract = incomingStyleContract(body.stylePack);
  const contextBlock = `【题目】${title}
【目标时长】${targetSeconds}s 【${unitName}预算】${Math.ceil(maxChars * FILL_RATIO_MIN)}–${Math.round(maxChars * 1.05)} 【形态】${form}`;
  try {
    const parsed = await runScriptLlmJson({
      llmApi: body.llmApi,
      stage: "blueprint",
      role: "planner",
      system: OUTLINE_SYSTEM,
      user: outlineUserPrompt({
        title,
        brief,
        contextBlock: `${styleContract}\n${contextBlock}`,
        plans,
        unitName,
        viewerPromise: body.contentBrief?.viewerPromise
      }),
      temperature: 0.5,
      timeoutMs: llmTimeoutMsForSeconds(targetSeconds),
      maxTokens: 4000
    });
    const outline = stampOutlineBudgets(outlineFromPlans(plans, {
      status: "draft",
      thesis: String(parsed?.oneSentenceThesis || title)
    }), plans, parsed?.sections);
    const locked = new Map((body.outline?.sections || []).filter((item: Loose) => item.status === 'locked').map((item: Loose) => [item.id, item]));
    for (const section of outline.sections) { const old = locked.get(section.id); if (old) Object.assign(section, old); }
    const strict = outlineSchema.safeParse(outline);
    if (!strict.success) return res.status(503).json({ ok: false, code: 'outline_schema_invalid', error: strict.error.message });
    const validation = validateOutline(outline, brief, {
      ...body.budget,
      targetSeconds,
      maxChars,
      durationMode: body.budget?.durationMode || "target-driven"
    });
    return res.json({ ok: validation.ok, outline: strict.data, brief, warnings: validation.warnings, scriptForm: form });
  } catch (error: unknown) {
    const outline = outlineFromPlans(plans, { status: "draft", thesis: title });
    return res.status(503).json({
      ok: false,
      code: "llm_response_invalid",
      error: "未能生成全片提纲。",
      outline,
      brief,
      scriptForm: form,
      recommendation: "请检查 LLM 配置后重试，或先手工编辑章节任务。"
    });
  }
});

app.post("/api/script/section-draft", async (req, res) => {
  const body = requestBody(req.body as unknown);
  const { language, maxChars, targetSeconds, title, brief, plans, unitName, form } = scriptDraftContext(body);
  const sectionId = String(body.sectionId || "").trim();
  const outline = stampOutlineBudgets(
    body.outline && Array.isArray(body.outline.sections) ? body.outline : outlineFromPlans(plans),
    plans,
    body.outline?.sections
  );
  const planned = outline.sections.find((item) => item.id === sectionId);
  if (!planned) {
    return res.status(400).json({ ok: false, code: "draft_contract_failed", error: "提纲中没有这一章。" });
  }
  if (planned.status === "locked") {
    return res.status(409).json({ ok: false, code: "draft_contract_failed", error: "该章已锁定，不会自动改写。" });
  }
  const existing: Loose[] = Array.isArray(body.sections) ? body.sections : [];
  const prior = existing.find((item) => String(item?.id) === planned.id);
  if (prior?.status === "locked") {
    return res.status(409).json({ ok: false, code: "draft_contract_failed", error: "该章已锁定，不会自动改写。" });
  }
  const styleContract = incomingStyleContract(body.stylePack);
  const contextBlock = `【题目】${title} 【目标时长】${targetSeconds}s`;
  const summaries = completedSectionSummaries(existing, language);
  try {
    const user = sectionDraftUserPrompt({
      language,
      section: planned,
      sectionIndex: planned.order - 1,
      sectionCount: outline.sections.length,
      brief,
      thesis: outline.oneSentenceThesis,
      summaries,
      contextBlock,
      styleContract,
      unitName
    });
    let parsed = await runScriptLlmJson({
      llmApi: body.llmApi,
      stage: "script_section",
      role: "drafter",
      system: SECTION_DRAFT_SYSTEM,
      user,
      temperature: 0.7,
      timeoutMs: llmTimeoutMsForSeconds(targetSeconds),
      maxTokens: LLM_LONGFORM_MAX_TOKENS
    });
    let warnings: string[] = [];
    let section = emptySectionFromPlan(plans[planned.order - 1] || plans[0]);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const narration = String(parsed?.narration || "").trim();
      const beats = Array.isArray(parsed?.beats) ? parsed.beats.map((beat: Loose, index: number) => ({
        id: `${planned.id}-beat-${index + 1}`,
        order: index + 1,
        function: beat.function || section.beats[0]?.function || "setup",
        intent: beat.intent || "",
        narration: String(beat.narration || "").trim() || (index === 0 ? narration : ""),
        targetSeconds: Number(beat.targetSeconds) || planned.targetSeconds,
        energy: beat.energy || "medium",
        visualIntent: beat.visualIntent || "",
        needsHold: Boolean(beat.needsHold),
        sectionId: planned.id
      })) : [{ ...section.beats[0], narration, sectionId: planned.id }];
      section = {
        ...section,
        id: planned.id,
        order: planned.order,
        role: planned.role,
        title: planned.title,
        minUnits: planned.minUnits,
        maxUnits: planned.maxUnits,
        targetSeconds: planned.targetSeconds,
        narration,
        beats,
        usedEvidenceIds: Array.isArray(parsed?.usedEvidenceIds) ? parsed.usedEvidenceIds.map(String) : [],
        status: "ready",
        promise: planned.promise,
        audienceQuestion: planned.audienceQuestion
      };
      const check = validateSectionAgainstOutline(section, planned, brief, language);
      if (check.ok && narration) {
        const nextSections = mergeSectionIntoWorkspaceSections(existing, section);
        return res.json({ ok: true, section, sections: nextSections, outline, scriptForm: form });
      }
      warnings = check.warnings.length ? check.warnings : ["本章没有口播"];
      parsed = await runScriptLlmJson({
        llmApi: body.llmApi,
        stage: "script_section",
        role: "drafter",
        system: SECTION_DRAFT_SYSTEM,
        user: `${user}\n上次输出未通过校验：${warnings.join("；")}。请重写本章。`,
        temperature: 0.5,
        timeoutMs: llmTimeoutMsForSeconds(targetSeconds),
        maxTokens: LLM_LONGFORM_MAX_TOKENS
      });
    }
    return res.status(503).json({
      ok: false,
      code: "draft_contract_failed",
      error: "本章未通过校验，其他章节未改动。",
      warnings,
      failedSectionId: planned.id,
      sections: existing,
      outline
    });
  } catch (error: unknown) {
    return res.status(503).json({
      ok: false,
      code: "llm_response_invalid",
      error: errorMessage(error) || "本章生成失败。",
      failedSectionId: planned.id,
      sections: existing,
      outline
    });
  }
});

app.post("/api/script/revision-plan", async (req, res) => {
  const body = requestBody(req.body as unknown);
  const measured = Number(body.measuredSeconds ?? body.budget?.actualTotalSeconds);
  const target = Number(body.targetSeconds ?? body.budget?.targetSeconds);
  if (!(measured > 0) || !(target > 0)) {
    return res.status(400).json({ ok: false, error: "需要实测时长和目标时长。" });
  }
  const plan = buildRevisionPlan({
    measuredSeconds: measured,
    targetSeconds: target,
    outline: body.outline,
    sections: body.sections,
    unitsPerSecond: Number(body.budget?.charsPerSecond) || 4.3
  });
  return res.json({ ok: true, revisionPlan: plan });
});

app.post("/api/script/section-revise", async (req, res) => {
  const body = requestBody(req.body as unknown);
  const { language, targetSeconds, title, brief, plans, unitName } = scriptDraftContext(body);
  const action = body.action || body.revisionAction;
  if (!action?.sectionId || !action?.action) {
    return res.status(400).json({ ok: false, error: "缺少章节修订动作。" });
  }
  const existing: Loose[] = Array.isArray(body.sections) ? body.sections : [];
  const current = existing.find((item) => String(item?.id) === String(action.sectionId));
  if (!current) return res.status(400).json({ ok: false, error: "找不到要修订的章节。" });
  if (current.status === "locked") {
    return res.status(409).json({ ok: false, code: "draft_contract_failed", error: "锁定章节不会被自动回修。" });
  }
  const planned = (body.outline?.sections || []).find((item: Loose) => item.id === action.sectionId);
  try {
    const parsed = await runScriptLlmJson({
      llmApi: body.llmApi,
      stage: "section_revise",
      role: "drafter",
      system: SECTION_REVISE_SYSTEM,
      user: sectionReviseUserPrompt({
        language,
        section: {
          title: current.title,
          narration: current.narration,
          minUnits: planned?.minUnits || current.minUnits,
          maxUnits: planned?.maxUnits || current.maxUnits
        },
        action,
        unitName,
        brief
      }),
      temperature: 0.4,
      timeoutMs: llmTimeoutMsForSeconds(targetSeconds),
      maxTokens: LLM_LONGFORM_MAX_TOKENS
    });
    const narration = String(parsed?.narration || "").trim();
    if (!narration) {
      return res.status(503).json({ ok: false, code: "llm_response_invalid", error: "修订结果没有口播。", sections: existing });
    }
    const section = {
      ...current,
      narration,
      beats: Array.isArray(parsed?.beats) && parsed.beats.length
        ? parsed.beats.map((beat: Loose, index: number) => ({
          ...(current.beats?.[index] || {}),
          id: `${current.id}-beat-${index + 1}`,
          order: index + 1,
          function: beat.function || current.beats?.[index]?.function || "setup",
          intent: beat.intent || current.beats?.[index]?.intent || "",
          narration: String(beat.narration || "").trim(),
          visualIntent: beat.visualIntent || current.beats?.[index]?.visualIntent || "",
          energy: beat.energy || current.beats?.[index]?.energy || "medium",
          needsHold: Boolean(beat.needsHold),
          sectionId: current.id,
          targetSeconds: current.targetSeconds
        }))
        : current.beats,
      status: "ready"
    };
    const nextSections = mergeSectionIntoWorkspaceSections(existing, section);
    return res.json({ ok: true, section, sections: nextSections });
  } catch (error: unknown) {
    return res.status(503).json({ ok: false, code: "llm_response_invalid", error: errorMessage(error) || "章节回修失败。", sections: existing });
  }
});

app.post("/api/script/validate", async (req, res) => {
  const body = requestBody(req.body as unknown);
  const language = normalizeScriptLanguage(body.scriptLanguage);
  const outlineCheck = body.outline
    ? validateOutline(body.outline, normalizeScriptBrief(body.brief), body.budget || { targetSeconds: 30, maxChars: 110, durationMode: "target-driven" })
    : { ok: true, warnings: [] };
  const progression = validateScriptProgression(body.sections, body.outline, language);
  return res.json({
    ok: outlineCheck.ok && progression.ok,
    outlineWarnings: outlineCheck.warnings,
    progressionWarnings: progression.warnings
  });
});

app.post("/api/script/research", async (req, res) => {
  const {
    topic,
    intentNotes = "",
    referenceUrl = "",
    platform = "douyin",
    llmApi,
    scriptLanguage
  } = requestBody(req.body as unknown);
  const language = normalizeScriptLanguage(scriptLanguage);
  const seed = String(topic || intentNotes || "").trim() || (language === "en" ? "short video topic" : "短视频选题");
  const bladesMeta = language === "en"
    ? [
      { id: "competitor", label: "对标", query: `${seed} YouTube Shorts OR TikTok explainer` },
      { id: "audience", label: "受众", query: `${seed} why people get this wrong` },
      { id: "fact", label: "事实", query: `${seed} study OR data OR report` },
      { id: "visual", label: "画面", query: `${seed} diagram OR visualization OR animation` }
    ]
    : [
      { id: "competitor", label: "对标", query: `${seed} 短视频 讲解 OR 抖音` },
      { id: "audience", label: "受众", query: `${seed} 为什么 搞不懂 OR 误区` },
      { id: "fact", label: "事实", query: `${seed} 数据 OR 研究 OR 报告` },
      { id: "visual", label: "画面", query: `${seed} 图解 OR 可视化 OR 动画` }
    ];

  try {
    const pageFinding = referenceUrl ? await fetchPageFinding(String(referenceUrl)) : null;
    const blades = await Promise.all(bladesMeta.map(async (meta) => {
      const findings = await searchWeb(meta.query);
      if (meta.id === "competitor" && pageFinding) {
        findings.unshift(pageFinding);
      }
      return { ...meta, findings: findings.slice(0, 4) };
    }));
    const webHits = blades.reduce((sum, blade) => sum + blade.findings.length, 0);

  const prompt = `你是短视频调研导演。根据检索结果，提炼四条可写进口播的笔记。禁止编造 URL。找不到就明说缺口。
【主题】${seed}
【平台】${platform}
【检索】${JSON.stringify(blades.map((b) => ({ id: b.id, query: b.query, findings: b.findings })))}

只输出 JSON：{"summary":string,"notes":{"competitor":string,"audienceQuestion":string,"fact":string,"visualRef":string}}
notes 每条要具体。${language === "en" ? " Write notes in English, each ≤ 18 words." : " notes 每条 ≤ 40 字。"}`;

    const parsed = await runScriptLlmJson({
      llmApi,
      system: "你只输出合法 JSON。笔记必须能对应到检索结果，不要写「这个话题很火」。",
      user: prompt,
      temperature: 0.4
    });

    const notes = {
      competitor: String(parsed?.notes?.competitor || blades[0].findings[0]?.snippet || `对标还薄，先记下「${seed}」常见讲法。`).slice(0, 80),
      audienceQuestion: String(parsed?.notes?.audienceQuestion || blades[1].findings[0]?.title || `观众在问：${seed}到底是怎么回事？`).slice(0, 80),
      fact: String(parsed?.notes?.fact || blades[2].findings[0]?.snippet || "").slice(0, 80),
      visualRef: String(parsed?.notes?.visualRef || blades[3].findings[0]?.title || "避免空镜堆砌，给一个能看懂的对比画面。").slice(0, 80)
    };

    return res.json({
      summary: String(parsed?.summary || `围绕「${seed}」做了四刀浅调研，${webHits > 0 ? "有网页结果" : "网页没搜到，用了模型归纳"}。`),
      blades,
      notes,
      source: webHits > 0 ? (parsed ? "mixed" : "web") : "model",
      fetchedAt: Date.now()
    });
  } catch (error: unknown) {
    console.warn("[Script Research] fallback:", errorMessage(error));
    return res.json({
      summary: `「${seed}」浅调研失败，先用手写笔记。`,
      blades: bladesMeta.map((meta) => ({ ...meta, findings: [] })),
      notes: { competitor: "", audienceQuestion: "", fact: "", visualRef: "" },
      source: "model",
      fetchedAt: Date.now()
    });
  }
});

app.post("/api/script/reference", async (req, res) => {
  const { url, topic, intentNotes, llmApi } = requestBody(req.body as unknown);
  const rawUrl = String(url || "").trim();
  if (!rawUrl) {
    return res.status(400).json({ error: "请先粘贴对标链接" });
  }

  try {
    const finding = await fetchPageFinding(rawUrl);
    const title = finding?.title || rawUrl;
    const snippet = finding?.snippet || "";
    const prompt = `你在反拆一条对标内容，给 3 个「保留节奏、换角度」的概念。禁止碳拷贝金句。
【链接】${rawUrl}
【标题】${title}
【摘要】${snippet}
【我们的主题】${topic || intentNotes || ""}

只输出 JSON：{
  "title": string,
  "keep": string[],
  "change": string[],
  "whyBetter": string,
  "hookStyle": string,
  "pacingNote": string,
  "cards": [{id,title,hook,insight,genre,whyNow,durationHint,paceHint,conceptCount,risk,completionFit,hookType,structure,whyThisWorks}]
}
cards 恰好 3 张，structure 必须互不相同。keep / change 各 2-4 条短句。`;

    const parsed = await runScriptLlmJson({
      llmApi,
      system: "你只输出合法 JSON。必须同时写保留什么和改什么。",
      user: prompt,
      temperature: 0.7
    });

    const cards = Array.isArray(parsed?.cards) && parsed.cards.length >= 3
      ? parsed.cards.slice(0, 3)
      : fallbackTopicCardsServer(String(topic || title), "reference");

    return res.json({
      url: rawUrl,
      title: String(parsed?.title || title),
      keep: Array.isArray(parsed?.keep) ? parsed.keep.slice(0, 4) : ["保留它的开场钩子形态", "保留信息更新密度"],
      change: Array.isArray(parsed?.change) ? parsed.change.slice(0, 4) : ["换成我们的题材", "论据用更新的事实"],
      whyBetter: String(parsed?.whyBetter || "同一套节奏，换一个别人没讲透的角度。"),
      hookStyle: String(parsed?.hookStyle || "misconception"),
      pacingNote: String(parsed?.pacingNote || "对标偏快切，我们按自己的节奏档走。"),
      cards
    });
  } catch (error: unknown) {
    console.warn("[Script Reference] fallback:", errorMessage(error));
    return res.json({
      url: rawUrl,
      title: rawUrl,
      keep: ["保留钩子形态"],
      change: ["换成自己的主题"],
      whyBetter: "同一节奏，不同洞察。",
      hookStyle: "misconception",
      pacingNote: "按当前节奏档预测镜数。",
      cards: fallbackTopicCardsServer(String(topic || ""), "reference")
    });
  }
});

app.post("/api/script/concepts", async (req, res) => {
  const { topic, intentNotes, researchNotes, researchBrief, genrePackId, llmApi } = requestBody(req.body as unknown);
  const seed = String(topic || intentNotes || "").trim() || "这个主题";
  const prompt = `根据调研产出恰好 3 个概念。结构、钩子类型、洞察必须都不同。
【主题】${seed}
【体裁包】${genrePackId || "未选"}
【调研】${JSON.stringify(researchNotes || {})}
【摘要】${researchBrief?.summary || ""}
【检索】${JSON.stringify((researchBrief?.blades || []).map((b: Loose) => ({ id: b.id, hits: (b.findings || []).slice(0, 2) })))}

只输出 JSON：{"cards":[{id,title,hook,insight,genre,whyNow,durationHint,paceHint,conceptCount,risk,completionFit,hookType,structure,whyThisWorks}]}
whyThisWorks 必须点名调研里的一条。`;

  try {
    const parsed = await runScriptLlmJson({
      llmApi,
      system: "你只输出合法 JSON。三张卡不能是同一个意思换标题。",
      user: prompt,
      temperature: 0.8
    });
    const cards = Array.isArray(parsed?.cards) && parsed.cards.length >= 3
      ? parsed.cards.slice(0, 3)
      : fallbackTopicCardsServer(seed, "direction");
    return res.json({ cards });
  } catch (error: unknown) {
    console.warn("[Script Concepts] fallback:", errorMessage(error));
    return res.json({ cards: fallbackTopicCardsServer(seed, "direction") });
  }
});

app.post("/api/script/split-spans", async (req, res) => {
  const { narration, llmApi, visualBible, genre, scriptLanguage } = requestBody(req.body as unknown);
  const language = normalizeScriptLanguage(scriptLanguage);
  const text = String(narration || "").trim();
  if (!text) {
    return res.status(400).json({ error: "narration is required" });
  }

  const sentenceRule = language === "en"
    ? `- Each spoken span must be a complete sentence ending with . ! or ?. Do not break the voiceover at a comma.
- Contrast patterns like "not A, but B" / "although A, however B" stay one spoken span; cut the picture at the turn word into 2 visuals.`
    : `- 口播段必须是完整一句，以。！？结束。禁止在逗号处断开旁白。
- 「不是A，而是B」「不是A，其实是B」「虽然A，但是B」「与其A，不如B」必须同一口播段；画面在翻转词处切成 2 张。`;

  const prompt = `把口播拆成「整句口播段 + 句内画面」。
硬规则：
${sentenceRule}
- 一句默认 1 张图；只有新主体/对照翻转才 2 张；最多 3 张。
- startRatio/endRatio 覆盖 0 到 1，sliceText 必须是互不重复的前后两截，合起来等于该句。禁止两张图都写成后半句。
- visualIntent 写看得见的画面，不要写情绪形容词，不要抄口播原句。
- 第一格 visualIntent 必须是未完成的可见事件：主体足够大、正在做什么、一个尚未释放的异常（环境开始回应即可）。禁止只写张嘴或风景说明书。
- 若下面有画面圣经：叙事型必须反复使用圣经里的角色和场景；说明型只锁色板，允许图解。

${bibleContractForPrompt(normalizeVisualBible(visualBible, visualBibleModeForGenre(genre)))}

【口播】
${text}

只输出 JSON：{"spans":[{"id","text","function","energy","needsHold","visuals":[{"startRatio","endRatio","sliceText","visualIntent","splitReason"}]}]}
function 只能是 hook/setup/turn/proof/reveal/cta。energy 只能是 fast/medium/slow/hold。`;

  try {
    const parsed = await runScriptLlmJson({
      llmApi,
      system: "你只输出合法 JSON。旁白以整句为单位，画面可以在一句里切。",
      user: prompt,
      temperature: 0.3
    });
    if (Array.isArray(parsed?.spans) && parsed.spans.length > 0) {
      const texts = parsed.spans.map((span: Loose) => String(span?.text || ""));
      if (splitCoversSource(texts, text)) {
        return res.json({ spans: parsed.spans, source: "llm" });
      }
    }
  } catch (error: unknown) {
    console.warn("[Split Spans] LLM failed:", errorMessage(error));
  }
  return res.json({ spans: [] });
});

app.post("/api/script/coverage", async (req, res) => {
  const { shots, visualBible, genre, stylePack, llmApi } = requestBody(req.body as unknown);
  const list = Array.isArray(shots) ? shots : [];
  if (list.length === 0) {
    return res.status(400).json({ error: "shots are required" });
  }
  const mode = visualBibleModeForGenre(genre as ScriptGenre);
  const styleContract = incomingStyleContract(stylePack);
  const slotLines = list
    .map((shot: Loose, index: number) => {
      const contrast = shot.voRole === "continue" || String(shot.splitReason || "").includes("对照");
      return `${index + 1}. id=${shot.id} function=${shot.function || ""} contrast=${contrast ? "yes" : "no"} first=${index === 0} last=${index === list.length - 1}\n口播切片：${shot.sliceText || shot.narration || ""}\n画面：${shot.visualIntent || ""}`;
    })
    .join("\n\n");

  const prompt = `你是短视频摄影指导。口播和槽位已经锁死，只给每一格填机位。
硬规则：
- 输出 shots 必须与输入同 id、同数量、同顺序。禁止增删格、禁止改口播。
- 相邻两格 shotSize 不能相同。
- 第一格 coverageJob=hook。最后一格 coverageJob=callback，构图尽量贴近第一格。
- 叙事/情绪首镜 shotSize 必须是 ms（中远景全身，角色轮廓可读），cameraAngle=eye，shotComposition=thirds。禁止用 ws 开场。
- 说明/科普首镜 shotSize 必须是 ecu 或 cu。
- 叙事第二格优先 ws + establish；说明第二格优先 insert。
- 对照格 coverageJob=contrast，coverageLink=contrast-cut。
- 有角色卡时：叙事镜可出同一主体，insert 必须是无人机制/物件特写，不要把角色塞进 insert。
- 无角色卡时：不要编男主走来走去；第二格优先 insert。
- 不要写生图英文长 prompt，不要改画风。
- shotSize 只能是 ecu|cu|ms|ws|insert
- cameraAngle 只能是 eye|low|high
- shotComposition 只能是 center|thirds|silhouette|negative-left|negative-right
- coverageJob 只能是 hook|establish|evidence|insert|contrast|callback
- coverageLink 只能是 advance|contrast-cut|callback|same-axis

${styleContract}
${bibleContractForPrompt(normalizeVisualBible(visualBible, mode))}

【体裁】${genre || ""}
【槽位】
${slotLines}

只输出 JSON：{"shots":[{"id":string,"shotSize":string,"cameraAngle":string,"shotComposition":string,"coverageJob":string,"coverageLink":string}]}`;

  try {
    const parsed = await runScriptLlmJson({
      llmApi,
      system: "你只输出合法 JSON。机位设计不能改口播、不能增删镜头。",
      user: prompt,
      temperature: 0.35
    });
    if (Array.isArray(parsed?.shots) && parsed.shots.length === list.length) {
      return res.json({ shots: parsed.shots, source: "llm" });
    }
  } catch (error: unknown) {
    console.warn("[Coverage] fallback:", errorMessage(error));
  }
  return res.json({ shots: [], source: "rule", fallback: true });
});

app.post("/api/script/visual-bible", async (req, res) => {
  const { narration, genre, title, stylePack, llmApi, previousBible, intentNotes, candidates, forceReanalyse, requestId, language, scriptLanguage } = requestBody(req.body as unknown);
  const text = String(narration || "").trim();
  if (!text) {
    return res.status(400).json({ error: "narration is required" });
  }
  try {
    const result = await compileVisualBible({
      narration: text,
      genre,
      title: String(title || ""),
      intentNotes: String(intentNotes || "").trim(),
      previousBible,
      candidates: Array.isArray(candidates) ? candidates : undefined,
      forceReanalyse: Boolean(forceReanalyse),
      requestId,
      language: language || scriptLanguage,
      model: String(llmApi?.model || 'gemini-3.7-flash'),
      stylePack
    }, {
      analyze: isUsableLlmApi(llmApi)
        ? async ({ system, user }) => runScriptLlmJson({ llmApi, system, user, temperature: 0 })
        : undefined,
      compileCards: async ({ system, user }) => runScriptLlmJson({ llmApi, system, user, temperature: 0.35 })
    });
    return res.json({
      bible: result.bible,
      analysisApplied: result.analysisApplied,
      fallback: result.fallback,
      diagnostics: result.diagnostics
    });
  } catch (error: unknown) {
    console.warn("[Visual Bible] compileVisualBible failed:", errorMessage(error));
    return res.status(500).json({ error: errorMessage(error) || "visual bible failed" });
  }
});

// 2.1 Polish, Rewrite, or Expand single narration/prompt with LLM
app.post("/api/script/polish-narration", async (req, res) => {
  const { text, type = "narration", style = "punchy", visualStyle = "cinematic", llmApi, scriptLanguage } = requestBody(req.body as unknown);
  const language = normalizeScriptLanguage(scriptLanguage);
  const target = bilingualTarget(language);
  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Text is required" });
  }

  const cleanText = text.trim();

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

  const secondaryLangLabel = target === "zh" ? "精简中文双语字幕" : "精简英文双语字幕";
  const prompt = type === "narration"
    ? `请将以下短视频旁白文案进行润色与重写，使其更加【${style === "punchy" ? "抓人爆款、节奏有力" : style === "emotional" ? "温暖治愈、富有哲思" : "通俗易懂、生动幽默"}】：
原文：${cleanText}
polishedText 必须用${language === "en" ? "英文" : "中文"}口播。同时生成对应的${secondaryLangLabel}，以及对应的专业英文AI画图Prompt（风格要求：${visualStyle}）。以JSON返回，字段为 polishedText, secondaryText, visualPrompt, chineseVisualPrompt。`
    : `请根据以下画面意图，扩写为一个极其详尽、适合生图的专业英文Prompt（风格：${visualStyle}）：
画面意图：${cleanText}
以JSON返回，字段为 polishedText, secondaryText, visualPrompt, chineseVisualPrompt。`;

  try {
    if (isUsableLlmApi(llmApi)) {
      const llmResult = await gatewayChat({
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
        const parsed = cleanAndParseJSON(llmResult.text);
        if (parsed && parsed.polishedText) return res.json(parsed);
      } else {
        console.warn("[Polish Narration] Custom LLM failed:", llmResult.error);
      }
    }

    const gemini = await generateGeminiJson({
      stage: "polish_narration",
      system: "你是短视频文案润色助手，只输出合法 JSON。",
      user: prompt,
      temperature: 0.7,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          polishedText: { type: Type.STRING, description: "润色后的旁白解说词" },
          secondaryText: { type: Type.STRING, description: target === "zh" ? "对应的中文双语字幕" : "对应的英文双语字幕" },
          visualPrompt: { type: Type.STRING, description: "专业英文画图Prompt" },
          chineseVisualPrompt: { type: Type.STRING, description: "中文画面描述" }
        },
        required: ["polishedText", "visualPrompt"]
      }
    });
    const parsed = toLoose(gemini.data);
    if (parsed.polishedText) {
      return res.json(parsed);
    }
    return res.json(fallbackPolish);
  } catch (error: unknown) {
    console.warn("[Polish Narration] LLM error, returning polished fallback:", errorMessage(error));
    return res.json(fallbackPolish);
  }
});

// 2.1.9 Batch-translate per-clip subtitle lines into condensed bilingual English.
// Units are ID-pinned (clip id -> displayed Chinese slice) so the answer can never drift.
app.post("/api/script/translate-secondary", async (req, res) => {
  const { units, llmApi, from, to, scriptLanguage } = requestBody(req.body as unknown);
  const sourceLang = normalizeScriptLanguage(from || scriptLanguage);
  const targetLang = to === "zh" || to === "en" ? to : bilingualTarget(sourceLang);
  const list = (Array.isArray(units) ? units : [])
    .map((u: Loose, index: number) => ({
      id: String(u?.id || `u${index}`),
      text: String(u?.text || u?.zh || "").trim()
    }))
    .filter((u: Loose) => u.text);
  if (list.length === 0) {
    return res.status(400).json({ error: "units are required" });
  }
  const batches = chunkItems(list, TRANSLATE_BATCH_SIZE);

  const looksTranslated = (t: string) => (
    targetLang === "en"
      ? countLatin(t) >= 3 && countCjk(t) === 0
      : countCjk(t) >= 2
  );
  const plausibleRatio = (source: string, translated: string) => {
    if (sourceLang === "zh") {
      const zhChars = countCjk(source) || source.replace(/\s/g, "").length;
      const enWords = translated.trim().split(/\s+/).filter(Boolean).length;
      const ratio = enWords / Math.max(1, zhChars);
      return ratio >= 0.2 && ratio <= 2.6;
    }
    const words = source.trim().split(/\s+/).filter(Boolean).length;
    const zhChars = countCjk(translated) || translated.replace(/\s/g, "").length;
    const ratio = zhChars / Math.max(1, words);
    return ratio >= 0.4 && ratio <= 3.0;
  };
  const tooLong = (t: string) => (
    targetLang === "en" ? t.length > 80 : (countCjk(t) > 40 || t.length > 60)
  );

  const sourceLabel = sourceLang === "en" ? "English" : "中文";
  const targetLabel = targetLang === "zh" ? "中文" : "英文";
  const buildPrompt = (items: { id: string; text: string }[], stricter: boolean) => `把下面的${sourceLabel}口播切片逐条翻译成短视频画面上的${targetLabel}字幕。
硬规则：
- 输出 JSON {"items":[{"id":输入里的id,"text":"${targetLabel}字幕"}]}，id 必须与输入一一对应，一条不多、一条不少。兼容字段 en / zh 也可以，但优先 text。
- 字幕级精简：口语自然；${targetLang === "en" ? "单条尽量不超过 45 个英文字符，最多两句。" : "单条尽量不超过 22 个汉字，最多两句。"}
- 不加引号，不夹杂另一种语言；专有名词可保留原文，数字用阿拉伯数字。
- 只翻译给定的句子，不要翻译别的句子，也不要合并或拆分条目。
${stricter ? `- 上一轮有的条目缺失、过长或可疑。这次每条务必更短，宁可简化也不要超长。\n` : ""}
【待翻译】
${items.map((u, i) => `${i + 1}. id=${u.id}\n${sourceLabel}：${u.text}`).join("\n\n")}

只输出 JSON。`;

  const askOnce = async (items: { id: string; text: string }[], stricter: boolean): Promise<Map<string, string>> => {
    const out = new Map<string, string>();
    const parsed = await runScriptLlmJson({
      llmApi,
      system: "你是只输出合法 JSON 的字幕翻译器。",
      user: buildPrompt(items, stricter),
      temperature: 0.3
    });
    const rows = Array.isArray(parsed?.items) ? parsed.items : [];
    for (const row of rows) {
      const id = String(row?.id || "");
      const translated = String(row?.text || row?.en || row?.zh || "").trim().replace(/^["'`]+|["'`]+$/g, "");
      if (id && translated) out.set(id, translated);
    }
    return out;
  };

  try {
    const byId = new Map<string, string>();
    let extraCalls = 0;
    for (const batch of batches) {
      let result = await askOnce(batch, false);
      const missing = () => batch.filter((u) => !result.has(u.id));
      if (missing().length > 0) {
        const stricter = await askOnce(batch, true);
        for (const [id, translated] of stricter) result.set(id, translated);
      }
      for (const u of batch) {
        let translated = result.get(u.id);
        const bad = (t?: string) => !t || !looksTranslated(t) || !plausibleRatio(u.text, t) || tooLong(t);
        if (translated && !bad(translated)) {
          byId.set(u.id, translated);
          continue;
        }
        while (bad(translated) && extraCalls < 16) {
          extraCalls++;
          const one = await askOnce([u], true);
          translated = one.get(u.id);
        }
        if (translated && looksTranslated(translated)) byId.set(u.id, translated);
      }
    }

    return res.json({
      ok: true,
      items: list.filter((u) => byId.has(u.id)).map((u) => {
        const text = byId.get(u.id);
        return { id: u.id, text, en: targetLang === "en" ? text : undefined, zh: targetLang === "zh" ? text : undefined };
      }),
      missing: list.filter((u) => !byId.has(u.id)).map((u) => u.id),
      source: "llm"
    });
  } catch (error: unknown) {
    console.warn("[Translate Secondary] LLM failed:", errorMessage(error));
    return res.status(500).json({ error: errorMessage(error) || "翻译失败" });
  }
});

// 2.2 Split free-form long text into structured storyboard shots
app.post("/api/script/split-text", async (req, res) => {
  const { rawText, visualStyle = "cinematic", targetShots, llmApi, scriptLanguage } = requestBody(req.body as unknown);
  if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
    return res.status(400).json({ error: "rawText is required" });
  }

  const cleanText = rawText.trim();
  const language = normalizeScriptLanguage(scriptLanguage || inferScriptLanguage(cleanText));

  const splitFallback = () => {
    const split = splitPastedNarration(cleanText, language);
    const desired = Math.max(2, Math.min(240, Number(targetShots) || split.chunks.length || 4));
    const safeChunks = fitTextChunksToCount(split.chunks.length > 0 ? split.chunks : [cleanText], desired, language);
    const cameraMotions = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right', 'tilt-up', 'cinematic-orbit'];
    const transitions = ['crossfade', 'slide-left', 'crossfade', 'fade-black', 'zoom-in'];

    const shots = safeChunks.map((chunk, idx) => {
      const units = countBudgetUnits(chunk, language);
      const unitsPerSecond = language === 'en' ? 2.5 : 4.2;
      const duration = Math.max(2.5, Math.min(10.0, Math.round((units / unitsPerSecond) * 10) / 10 || 3.5));
      return {
        order: idx + 1,
        duration,
        narration: chunk,
        secondaryText: "",
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
    const autoCount = Math.max(2, Math.min(240, Number(targetShots) || splitCompleteSentences(cleanText, language, { keepShort: true }).length || 4));
    const unitName = language === 'en' ? 'words' : '字';
    const prompt = `你是一位长视频/短视频金牌导演与剪辑师。用户提供了一段现成的完整口播文案。
请将该文案智能拆解为 ${autoCount} 个分镜头剧本。必须完整覆盖原文，禁止丢掉后文，禁止只保留前几句。
口播语言：${language === 'en' ? 'English' : '中文'}。

【用户文案】：
${cleanText}

【拆解要求】：
1. 完整保留用户的原意与文案，将长文案合理拆分为各个分镜的 narration（每镜约 8~24 ${unitName}，口语流畅）。
2. 根据解说${unitName}数精确计算每个分镜的 duration（秒数，${language === 'en' ? '每秒约 2–3 词' : '每秒约 4–5 字'}，单镜头时长在 2.5~10.0 秒之间）。
3. 为每个镜头生成高水准的英文 AI 生图 Prompt（visualPrompt，风格符合 ${visualStyle}），以及中文画面描述。
4. 提供 secondaryText（精简英文双语字幕）、cameraMotion（运镜）和 transition（转场）。
以合法的 JSON 格式返回，结构为 {"title": string, "shots": [...]}。`;

    if (isUsableLlmApi(llmApi)) {
      const llmResult = await gatewayChat({
        endpoint: String(llmApi.endpoint),
        apiKey: String(llmApi.apiKey),
        model: String(llmApi.model || "deepseek-v4-flash"),
        provider: llmApi.provider,
        system: "你是短视频导演，只输出合法 JSON。",
        user: prompt,
        temperature: 0.7,
        json: true,
        timeoutMs: llmTimeoutMsForSeconds(Math.max(30, autoCount * 4)),
        maxTokens: autoCount > 48 ? LLM_LONGFORM_MAX_TOKENS : LLM_JSON_MAX_TOKENS
      });
      if (llmResult.ok && llmResult.text) {
        const validated = validateGeneratedShots(
          cleanAndParseJSON(llmResult.text),
          cleanText.slice(0, 18),
          visualStyle,
          0
        );
        if (validated && splitCoversSource(validated.shots.map((shot: Loose) => String(shot.narration || "")), cleanText)) {
          return res.json(validated);
        }
      } else {
        console.warn("[Split Text] Custom LLM failed:", llmResult.error);
      }
    }

    const gemini = await generateGeminiJson({
      stage: "split_text",
      system: "你是短视频导演，只输出合法 JSON。",
      user: prompt,
      timeoutMs: llmTimeoutMsForSeconds(Math.max(30, autoCount * 4)),
      maxTokens: autoCount > 48 ? LLM_LONGFORM_MAX_TOKENS : LLM_JSON_MAX_TOKENS,
      models: ["gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.1-pro-preview"],
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
    });
    const parsed = validateGeneratedShots(
      gemini.data,
      cleanText.slice(0, 18),
      visualStyle,
      0
    );
    if (parsed && splitCoversSource(parsed.shots.map((shot: Loose) => String(shot.narration || "")), cleanText)) {
      return res.json(parsed);
    }
    return res.json(splitFallback());
  } catch (error: unknown) {
    console.warn("[Split Text] LLM error, returning rule-based split:", errorMessage(error));
    return res.json(splitFallback());
  }
});
}
