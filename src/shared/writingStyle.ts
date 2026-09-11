import { z } from 'zod';

/**
 * Writing style axis ("how the narrator talks"), orthogonal to genre and pace.
 * Browser-safe: imported by both the client bundle and the Express routes.
 */
export const BUILTIN_WRITING_STYLE_IDS = ['analyst', 'narrator', 'pundit'] as const;
export type BuiltinWritingStyleId = (typeof BUILTIN_WRITING_STYLE_IDS)[number];

/** Deterministic sentence-length thresholds. Declared on the profile so styleLint never parses prompt text. */
export const writingStyleLintThresholdsSchema = z.object({
  /** Units (Chinese chars / English words) a single sentence must not exceed to count as short. */
  maxSentenceUnits: z.number().int().positive().max(200),
  /** Minimum share of short sentences required, 0–1. */
  minShortSentenceShare: z.number().positive().max(1),
  /** Sentence units above which a single sentence is reported as too long, even when the share passes. */
  maxSentenceUnitsHard: z.number().int().positive().max(400)
}).strict();
export type WritingStyleLintThresholds = z.infer<typeof writingStyleLintThresholdsSchema>;

export const writingStyleProfileSchema = z.object({
  id: z.string().trim().min(1),
  kind: z.enum(['builtin', 'custom']),
  label: z.string().trim().min(1).max(24),
  description: z.string().trim().min(1).max(160),
  rules: z.array(z.string().trim().min(1)).min(1).max(12),
  bannedPatterns: z.array(z.string().trim().min(1)).max(40),
  exemplar: z.string().trim().min(1).max(600),
  counterExemplar: z.string().trim().min(1).max(600),
  derivedFromSamples: z.boolean(),
  locked: z.boolean(),
  lintThresholds: writingStyleLintThresholdsSchema.optional(),
  /** True while the archive text still needs to be replaced by the user's own copy. */
  provisional: z.boolean().optional()
}).strict();
export type WritingStyleProfile = z.infer<typeof writingStyleProfileSchema>;

/** Shared baseline bans for every archive; each archive appends its own. */
export const BASE_BANNED_PATTERNS = ['众所周知', '显而易见', '毋庸置疑', '不得不说', '总的来说', '总的来说呢'] as const;

/**
 * Abstract placeholder words expanded from the existing SECTION_DRAFT_SYSTEM ban
 * ("很有氛围" / "电影感"), so the deterministic lint and the prompt forbid the same class of wording.
 */
export const ABSTRACT_PLACEHOLDER_WORDS = [
  '很有氛围', '氛围感', '电影感', '高级感', '很有质感', '质感十足',
  '满满的', '治愈人心', '触动人心', '令人深思', '发人深省', '震撼人心'
] as const;

const provisionNote = '（当前档案为通用骨架，待用你的真实优质文案样例替换）';

/**
 * Built-in archives. Drafted as same-shape skeletons per SPEC-P7 §4 and explicitly marked
 * `provisional` because they are NOT yet inducted from the user's own copy.
 */
export const BUILTIN_WRITING_STYLES: WritingStyleProfile[] = [
  {
    id: 'analyst',
    kind: 'builtin',
    label: '冷静拆解',
    description: `先给结论再给论证，每段一个明确判断，数字与机制优先于感受。${provisionNote}`,
    rules: [
      '开头三句内给出本章结论，然后再解释理由。',
      '每段只下一个明确判断，不在同一段里给两个互相抵消的结论。',
      '每 3–5 句出现一个具体数字、时间、成本或可验证的机制描述。',
      '先写机制再写结论：说明"因为它如何运作，所以会怎样"。',
      '出现因果判断时同时给出成立条件，写明"在什么前提下成立"。',
      '禁用煽情词与情绪形容词，感受类内容改写成可观察的行为或结果。',
      '结尾收束成一句可复述的判断句，不追加抒情。'
    ],
    bannedPatterns: [...BASE_BANNED_PATTERNS, '太震撼了', '绝对', '史上最强', '颠覆认知'],
    exemplar: '先看结论：把每日睡眠压到六小时以下，连续两周后，受试者的工作记忆成绩平均下降约 15%。原因不是"意志力变差"，而是前额叶在睡眠不足时优先削减了维持注意力的资源，而记忆编码恰好依赖这部分资源。换句话说，你不是记不住了，是根本没来得及记。这个结论有个前提：它描述的是持续性的睡眠不足，偶尔一晚熬夜并不成立。',
    counterExemplar: '睡眠真的太重要了，睡不好整个人状态都会崩，感觉脑子像蒙了一层雾，做什么都提不起劲。所以说，大家一定要好好睡觉，早睡早起，才能元气满满地迎接每一天，真的很重要，希望每个人都能重视起来。',
    derivedFromSamples: false,
    locked: false,
    provisional: true,
    lintThresholds: { maxSentenceUnits: 40, minShortSentenceShare: 0.4, maxSentenceUnitsHard: 80 }
  },
  {
    id: 'narrator',
    kind: 'builtin',
    label: '故事叙事',
    description: `场景化开场，细节驱动，悬念延迟释放，段落以画面或动作收束。${provisionNote}`,
    rules: [
      '开场先给一个可看见的具体场景，包含时间、地点和一个人正在做的动作。',
      '用细节替代结论：把"他很焦虑"写成可观察的动作、物件或身体反应。',
      '悬念延后释放：先说异常现象，转折之前不提前给出答案。',
      '每个段落以画面或动作收束，不用总结句收尾。',
      '同一段落内保持同一视角，不在叙述中跳回全知解释。',
      '关键转折单独成段，前后各留一句短句作为呼吸。',
      '禁用"很有氛围""电影感"等抽象形容词，画面必须能被拍出来。'
    ],
    bannedPatterns: [...BASE_BANNED_PATTERNS, '氛围感爆棚', '电影质感', '画面感十足', '仿佛置身其中'],
    exemplar: '凌晨四点十七分，便利店的白炽灯管有一根在闪。林晚把第三杯关东煮的汤推到一边，手机屏幕亮着，是她第七次打开同一个对话框。她打了四个字，删掉，又打两个字，再删掉。收银台的挂钟秒针跳过十二，她终于把手机扣在桌面上，屏幕朝下，像盖住一件不想再看的东西。',
    counterExemplar: '那是一个非常有氛围的夜晚，城市的霓虹灯闪烁着迷人的光芒，给人一种很电影感的感觉。主人公内心充满了复杂的情绪，感慨万千，仿佛整个世界都在和他对话，让人不禁为之动容，陷入深深的思考之中。',
    derivedFromSamples: false,
    locked: false,
    provisional: true,
    lintThresholds: { maxSentenceUnits: 45, minShortSentenceShare: 0.4, maxSentenceUnitsHard: 95 }
  },
  {
    id: 'pundit',
    kind: 'builtin',
    label: '犀利观点',
    description: `短句为主，立场先行，敢下判断，反问与对比是主要修辞。${provisionNote}`,
    rules: [
      '单句不超过 25 字，短句占比不低于六成。',
      '第一句就亮立场，不用"我觉得""可能"软化。',
      '敢下判断：给出明确的"该做/不该做"，不两头下注。',
      '主要修辞只用反问与对比，每段至多一个反问。',
      '每 2–3 句插一句不超过 12 字的短句作重音。',
      '禁用官话套话与四字排比，也禁用"其实吧""话说回来"这类填充词。',
      '结尾用一句对立判断收束，不再解释。'
    ],
    bannedPatterns: [...BASE_BANNED_PATTERNS, '说实话', '讲真', '仁者见仁', '因人而异', '要辩证地看'],
    exemplar: '别再谈"要不要自律"了。问题不是自律，是诱惑太便宜。手机就在手边，短视频三秒给一次反馈，你让大脑怎么选？同样一个人，把手机放另一个房间，专注时长能翻倍。所以别改意志，改距离。做不到自律不是道德问题，是设计问题。把选择变难，比逼自己变强有效得多。',
    counterExemplar: '关于自律这个话题，其实是一个比较复杂的问题，不同的人可能有不同的看法。有的人认为自律非常重要，也有的人觉得顺其自然更好。总的来说，我们应该辩证地看待这个问题，既不能过分苛求自己，也不能完全放任，要因人而异，找到适合自己的方式，这样才能取得更好的效果。',
    derivedFromSamples: false,
    locked: false,
    provisional: true,
    lintThresholds: { maxSentenceUnits: 25, minShortSentenceShare: 0.6, maxSentenceUnitsHard: 60 }
  }
];

export function findWritingStyleProfile(writingStyleId: string | undefined | null, custom?: WritingStyleProfile[]): WritingStyleProfile | undefined {
  const id = String(writingStyleId || '').trim();
  if (!id) return undefined;
  return (custom || []).find(profile => profile.id === id) || BUILTIN_WRITING_STYLES.find(profile => profile.id === id);
}

export function isBuiltinWritingStyleId(id: string): boolean {
  return (BUILTIN_WRITING_STYLE_IDS as readonly string[]).includes(id);
}
