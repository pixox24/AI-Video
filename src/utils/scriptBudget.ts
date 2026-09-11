import {
  BeatFunction,
  DirectorNote,
  DurationBudget,
  ForecastShot,
  NarrativeStructure,
  ScriptBeat,
  ScriptGenre,
  ScriptLanguage,
  ScriptPace,
  ScriptPlatform,
  ShotEnergy,
  TopicCard
} from '../types';
import { countNarrationChars } from './narrationTrack';
import { SpeechSpan } from '../types';
import { buildSpeechSpans, shotsFromSpeechSpans, splitCompleteSentences } from './speechSpans';
import {
  budgetUnitLabel,
  normalizeScriptLanguage,
  paceUnitsPerSecond
} from './scriptLanguage';
import {
  FILL_RATIO_MAX,
  FILL_RATIO_MIN,
  MAX_VIDEO_SECONDS,
  clampVideoSeconds,
  scriptFormForSeconds,
  conceptMaxForDuration as conceptMaxForSeconds,
  maxForecastShotsForDuration,
  maxUniqueScenesForDuration,
  visualSlotEstimate
} from './scriptDuration';
import { beatsFromSectionPlans, planScriptSections, shouldUseSections } from './scriptSections';

export { TARGET_SECONDS_PRESETS } from './scriptDuration';
export {
  MIN_VIDEO_SECONDS,
  MAX_VIDEO_SECONDS,
  LONG_FORM_SECONDS,
  isLongForm,
  clampVideoSeconds,
  scriptFormForSeconds,
  scriptFormLabel,
  outlineConfirmationRequired,
  usesSectionWorkflow,
  resolveScriptForm
} from './scriptDuration';

export interface PacePreset {
  id: ScriptPace;
  label: string;
  hint: string;
  cps: number;
  asl: number;
  holdRatio: number;
  shotMin: number;
  shotMax: number;
}

export const PACE_PRESETS: Record<ScriptPace, PacePreset> = {
  ultrafast: { id: 'ultrafast', label: '极快', hint: '卡点 / 信息轰炸', cps: 5.3, asl: 1.6, holdRatio: 0.09, shotMin: 0.8, shotMax: 2.5 },
  fast: { id: 'fast', label: '快', hint: '带货 / 热点', cps: 5.0, asl: 2.5, holdRatio: 0.10, shotMin: 1.5, shotMax: 3.5 },
  medium: { id: 'medium', label: '中', hint: '科普口播', cps: 4.3, asl: 3.7, holdRatio: 0.15, shotMin: 2.5, shotMax: 5.5 },
  slow: { id: 'slow', label: '慢', hint: '情绪 / 故事', cps: 3.5, asl: 6.5, holdRatio: 0.22, shotMin: 4, shotMax: 10 },
  cinematic: { id: 'cinematic', label: '电影感', hint: '英雄镜 + 碎切', cps: 3.6, asl: 5.0, holdRatio: 0.20, shotMin: 2, shotMax: 10 }
};

export const PLATFORM_OPTIONS: { id: ScriptPlatform; label: string; defaultSeconds: number; min: number; max: number }[] = [
  { id: 'douyin', label: '抖音', defaultSeconds: 30, min: 15, max: 60 },
  { id: 'shipinhao', label: '视频号', defaultSeconds: 30, min: 15, max: 60 },
  { id: 'reels', label: 'Reels / Shorts', defaultSeconds: 30, min: 21, max: 45 },
  { id: 'bilibili', label: 'B 站', defaultSeconds: 60, min: 45, max: 90 },
  { id: 'youtube', label: 'YouTube', defaultSeconds: 60, min: 60, max: MAX_VIDEO_SECONDS }
];

export const GENRE_OPTIONS: { id: ScriptGenre; hint: string }[] = [
  { id: '科普', hint: '把一件事讲明白' },
  { id: '反常识', hint: '先拆误解' },
  { id: '故事', hint: '人物与转折' },
  { id: '教程', hint: '跟着做' },
  { id: '带货', hint: '痛点到下单' },
  { id: '情绪', hint: '共鸣与金句' },
  { id: '热点解读', hint: '这件事意味着什么' },
  { id: '口播金句', hint: '一句记住' }
];

export interface GenrePack {
  id: ScriptGenre;
  hint: string;
  pace: ScriptPace;
  durationHint: number;
  maxConcepts: number;
  structure: NarrativeStructure;
  beatPlan: BeatFunction[];
  hookStyle: string;
  draftHint: string;
  bgmTrackId: string;
}

export const GENRE_PACKS: GenrePack[] = [
  { id: '科普', hint: '先误解后机制', pace: 'medium', durationHint: 30, maxConcepts: 1, structure: 'myth_busting', beatPlan: ['hook', 'setup', 'turn', 'proof', 'cta'], hookStyle: 'misconception', draftHint: '开场拆一个常见误解，中段只讲一个机制，结尾回收开场。', bgmTrackId: 'kepu-thinking' },
  { id: '反常识', hint: '翻转一句常识', pace: 'medium', durationHint: 30, maxConcepts: 1, structure: 'contrast', beatPlan: ['hook', 'setup', 'turn', 'reveal', 'cta'], hookStyle: 'contrarian', draftHint: '钩子必须和常识对着干，证据只留一句。', bgmTrackId: 'fan-sneaky' },
  { id: '故事', hint: '人物与转折', pace: 'slow', durationHint: 45, maxConcepts: 1, structure: 'story', beatPlan: ['hook', 'setup', 'turn', 'reveal', 'cta'], hookStyle: 'mystery', draftHint: '用一个具体场面装主题，金句后停。', bgmTrackId: 'story-touching' },
  { id: '教程', hint: '跟着做三步', pace: 'fast', durationHint: 30, maxConcepts: 1, structure: 'tutorial', beatPlan: ['hook', 'setup', 'proof', 'proof', 'cta'], hookStyle: 'outcome', draftHint: '步骤不超过 3 个，每步一镜一个动作。', bgmTrackId: 'tutorial-lemon' },
  { id: '带货', hint: '痛点到下单', pace: 'fast', durationHint: 21, maxConcepts: 1, structure: 'problem_solution', beatPlan: ['hook', 'setup', 'proof', 'reveal', 'cta'], hookStyle: 'stakes', draftHint: '3 秒痛点，产品只出现一次英雄镜，CTA 一句话。', bgmTrackId: 'shop-catwalk' },
  { id: '情绪', hint: '共鸣与金句', pace: 'slow', durationHint: 45, maxConcepts: 1, structure: 'story', beatPlan: ['hook', 'setup', 'reveal', 'cta'], hookStyle: 'stakes', draftHint: '少论证，多停留。金句独立成镜。', bgmTrackId: 'emotion-frozen' },
  { id: '热点解读', hint: '这件事意味着什么', pace: 'fast', durationHint: 30, maxConcepts: 2, structure: 'contrast', beatPlan: ['hook', 'setup', 'turn', 'proof', 'cta'], hookStyle: 'recency', draftHint: '先说新闻，再说它和观众有什么关系。', bgmTrackId: 'news-investigations' },
  { id: '口播金句', hint: '一句记住', pace: 'fast', durationHint: 15, maxConcepts: 1, structure: 'reveal', beatPlan: ['hook', 'reveal', 'cta'], hookStyle: 'outcome', draftHint: '全文不超过两句半，钩子即金句。', bgmTrackId: 'punch-nba' }
];

export function genrePackById(id: ScriptGenre | null | undefined): GenrePack | null {
  if (!id) return null;
  return GENRE_PACKS.find((pack) => pack.id === id) || null;
}

export const STAGE_META: { id: import('../types').ScriptStage; label: string; hint: string }[] = [
  { id: 'intent', label: '意图', hint: '从哪开始' },
  { id: 'brief', label: '观众承诺', hint: '看完带走什么' },
  { id: 'topic', label: '选题', hint: '锁题 / 角度卡' },
  { id: 'research', label: '调研', hint: '四刀浅调研' },
  { id: 'duration', label: '时长', hint: '字数与停留' },
  { id: 'beats', label: '节拍', hint: '叙事骨架' },
  { id: 'copy', label: '口播', hint: '整段旁白' },
  { id: 'rhythm', label: '节奏', hint: '镜数预测' }
];

export function stageNavMeta(form: import('../types').ScriptForm) {
  return STAGE_META.map((item) => (
    item.id === 'beats' && form !== 'short'
      ? { ...item, label: '提纲 / 章节', hint: '全片结构' }
      : item
  ));
}

export function conceptMaxForDuration(seconds: number): number {
  return conceptMaxForSeconds(seconds);
}

export function recommendDuration(
  platform: ScriptPlatform,
  genre: ScriptGenre,
  conceptCount = 1
): { seconds: number; reason: string; pace: ScriptPace } {
  const plat = PLATFORM_OPTIONS.find((item) => item.id === platform) || PLATFORM_OPTIONS[0];
  let seconds = plat.defaultSeconds;
  let pace: ScriptPace = 'medium';

  if (genre === '情绪' || genre === '故事') {
    pace = 'slow';
    seconds = Math.min(plat.max, seconds + 10);
  } else if (genre === '带货' || genre === '热点解读') {
    pace = 'fast';
    seconds = Math.min(seconds, 30);
  } else if (genre === '口播金句') {
    pace = 'fast';
    seconds = 15;
  } else if (genre === '反常识' || genre === '科普') {
    pace = 'medium';
  } else if (genre === '教程') {
    pace = 'medium';
    seconds = Math.max(seconds, 30);
  }

  if (conceptCount >= 3) {
    seconds = Math.min(plat.max, Math.max(seconds, 45));
  }

  seconds = Math.max(plat.min, Math.min(plat.max, seconds));
  const reason = `建议 ${seconds} 秒，因为体裁「${genre}」、平台「${plat.label}」、概念 ${conceptCount} 个`;
  return { seconds, reason, pace };
}

export function buildDurationBudget(partial: {
  durationMode?: 'target-driven' | 'content-driven';
  targetSeconds?: number;
  platform?: ScriptPlatform;
  pace?: ScriptPace;
  speechRate?: number;
  usedChars?: number;
  actualSpeechSeconds?: number;
  actualTotalSeconds?: number;
  conceptUsed?: number;
  lockedShotCount?: number | null;
  scriptLanguage?: ScriptLanguage;
}): DurationBudget {
  const platform = partial.platform || 'douyin';
  const pace = partial.pace || 'medium';
  const preset = PACE_PRESETS[pace];
  const plat = PLATFORM_OPTIONS.find((item) => item.id === platform) || PLATFORM_OPTIONS[0];
  const language = normalizeScriptLanguage(partial.scriptLanguage);
  // TTS rate is a multiplier: faster speech carries more budget units per second.
  const speechRate = Math.max(0.8, Math.min(1.5, Number(partial.speechRate) || 1));
  const effectiveCps = paceUnitsPerSecond(pace, language, speechRate);
  const targetSeconds = clampVideoSeconds(Number(partial.targetSeconds) || plat.defaultSeconds, plat.defaultSeconds).seconds;
  const holdSeconds = round1(targetSeconds * preset.holdRatio);
  const speechSeconds = round1(Math.max(0.5, targetSeconds - holdSeconds));
  const targetUnits = Math.max(8, Math.round(speechSeconds * effectiveCps));
  const usedChars = Math.max(0, partial.usedChars || 0);
  const conceptMax = conceptMaxForDuration(targetSeconds);
  const locked = partial.lockedShotCount;
  return {
    durationMode: partial.durationMode || 'target-driven',
    targetSeconds,
    platform,
    pace,
    speechRate,
    scriptLanguage: language,
    charsPerSecond: effectiveCps,
    speechSeconds,
    holdSeconds,
    speechTargetSeconds: speechSeconds,
    visualHoldTargetSeconds: holdSeconds,
    maxChars: targetUnits,
    targetUnits,
    minUnits: Math.max(8, Math.ceil(targetUnits * FILL_RATIO_MIN)),
    maxUnits: Math.max(8, Math.ceil(targetUnits * FILL_RATIO_MAX)),
    usedChars,
    actualSpeechSeconds: Number.isFinite(partial.actualSpeechSeconds) ? Math.max(0, Number(partial.actualSpeechSeconds)) : undefined,
    actualTotalSeconds: Number.isFinite(partial.actualTotalSeconds) ? Math.max(0, Number(partial.actualTotalSeconds)) : undefined,
    conceptMax,
    conceptUsed: Math.max(0, partial.conceptUsed || 0),
    lockedShotCount: typeof locked === 'number' && locked > 0 ? Math.round(locked) : null
  };
}

export function lengthBudgetOf(budget: Partial<DurationBudget> | DurationBudget) {
  const targetUnits = Math.max(8, Number(budget.targetUnits) || Number(budget.maxChars) || 8);
  const minUnits = Math.max(8, Number(budget.minUnits) || Math.ceil(targetUnits * FILL_RATIO_MIN));
  const maxUnits = Math.max(minUnits, Number(budget.maxUnits) || Math.ceil(targetUnits * FILL_RATIO_MAX));
  return {
    targetUnits,
    minUnits,
    maxUnits,
    speechTargetSeconds: Number(budget.speechTargetSeconds) || Number(budget.speechSeconds) || 0,
    visualHoldTargetSeconds: Number(budget.visualHoldTargetSeconds) || Number(budget.holdSeconds) || 0,
    form: scriptFormForSeconds(Number(budget.targetSeconds) || 30)
  };
}

export function budgetFromWordCount(
  chars: number,
  platform: ScriptPlatform,
  pace: ScriptPace,
  speechRate = 1,
  scriptLanguage?: ScriptLanguage
): DurationBudget {
  const preset = PACE_PRESETS[pace];
  const language = normalizeScriptLanguage(scriptLanguage);
  const effectiveCps = paceUnitsPerSecond(pace, language, speechRate);
  const speechSeconds = Math.max(4, chars / effectiveCps);
  const targetSeconds = clampVideoSeconds(speechSeconds / (1 - preset.holdRatio)).seconds;
  return buildDurationBudget({
    targetSeconds: round1(targetSeconds),
    platform,
    pace,
    speechRate,
    durationMode: 'content-driven',
    usedChars: chars,
    scriptLanguage: language
  });
}

export function estimatedShotCount(budget: DurationBudget): { axis: number; min: number; max: number } {
  const cap = maxForecastShotsForDuration(budget.targetSeconds);
  if (budget.lockedShotCount && budget.lockedShotCount >= 2) {
    const n = Math.min(cap, Math.round(budget.lockedShotCount));
    return { axis: n, min: n, max: n };
  }
  const estimate = visualSlotEstimate(budget.targetSeconds, budget.pace);
  const min = Math.min(cap, Math.max(2, estimate.min));
  const max = Math.max(min, Math.min(cap, estimate.max));
  const axis = Math.min(max, Math.max(min, estimate.axis));
  return { axis, min, max };
}

function energyAtProgress(progress: number, pace: ScriptPace): ShotEnergy {
  if (progress < 0.12) return 'fast';
  if (progress >= 0.82) return pace === 'fast' || pace === 'ultrafast' ? 'medium' : 'hold';
  if (progress >= 0.55) return 'fast';
  if (pace === 'slow' || pace === 'cinematic') return 'slow';
  if (pace === 'ultrafast') return 'fast';
  return 'medium';
}

function functionAtProgress(progress: number, isLast: boolean): BeatFunction {
  if (progress < 0.12) return 'hook';
  if (isLast) return 'cta';
  if (progress >= 0.82) return 'cta';
  if (progress >= 0.7) return 'reveal';
  if (progress >= 0.45) return 'proof';
  if (progress >= 0.28) return 'turn';
  return 'setup';
}

const ACTION_VERBS = /开门|关门|看见|望见|看到|打开|走进来|走出去|走进|走出|转身|举起|放下|跑开|跑向|推开|拉开|切开|点燃|摔倒|抱住|看向|拿出|关上|出现|消失|揭示|坐下|站起|伸手|回头|跪下|跳起|拾起|撕开|倒出|按下|滑动|点击/;
const ACTION_CONNECTORS = /然后|接着|同时|随后|于是|并且/;

export function countActionUnits(text: string): string[] {
  const source = text || '';
  const verbs = source.match(new RegExp(ACTION_VERBS.source, 'g')) || [];
  const unique: string[] = [];
  verbs.forEach((verb) => {
    if (!unique.includes(verb)) unique.push(verb);
  });
  const clauses = source
    .split(/[，,、]/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 14);
  if (unique.length >= 2 && clauses.length >= 3) return clauses;
  if (unique.length >= 2) return unique;
  const connectors = source.match(new RegExp(ACTION_CONNECTORS.source, 'g')) || [];
  if (unique.length === 1 && connectors.length >= 1) {
    return [unique[0], ...connectors];
  }
  return unique;
}

export function impliedAsl(targetSeconds: number, shotCount: number): number {
  if (shotCount <= 0) return 0;
  return round1(targetSeconds / shotCount);
}

export function nearestPaceForAsl(asl: number): ScriptPace {
  if (asl <= 1.8) return 'ultrafast';
  if (asl <= 2.8) return 'fast';
  if (asl <= 4.6) return 'medium';
  if (asl <= 8) return 'slow';
  return 'cinematic';
}

export function lockedShotImplication(budget: DurationBudget): {
  impliedAsl: number;
  nearestPace: ScriptPace;
  pulled: boolean;
  message: string;
} | null {
  const n = budget.lockedShotCount;
  if (!n || n < 2) return null;
  const cap = maxForecastShotsForDuration(budget.targetSeconds);
  const effectiveCount = Math.min(Math.round(n), cap);
  const asl = impliedAsl(budget.targetSeconds, effectiveCount);
  const nearestPace = nearestPaceForAsl(asl);
  const pulled = nearestPace !== budget.pace;
  const current = PACE_PRESETS[budget.pace];
  const nearest = PACE_PRESETS[nearestPace];
  const capNote = effectiveCount < Math.round(n) ? `（资源保护最多 ${cap} 镜）` : '';
  const message = pulled
    ? `锁 ${n} 镜${capNote} / ${budget.targetSeconds}s → 平均 ${asl.toFixed(1)}s 一刀，更接近「${nearest.label}」（ASL ${nearest.asl}s），当前是「${current.label}」（${current.asl}s）。`
    : `锁 ${n} 镜${capNote} / ${budget.targetSeconds}s → 平均 ${asl.toFixed(1)}s 一刀，和「${current.label}」档一致。`;
  return { impliedAsl: asl, nearestPace, pulled, message };
}

export function recomputeShotStarts(shots: ForecastShot[]): ForecastShot[] {
  let cursor = 0;
  return shots.map((shot, index) => {
    const next = { ...shot, order: index + 1, start: round2(cursor) };
    cursor += shot.speechDuration + shot.holdDuration;
    return next;
  });
}

export function shotsTotals(shots: ForecastShot[]): { total: number; speech: number; hold: number } {
  return shots.reduce(
    (acc, shot) => ({
      total: acc.total + shot.speechDuration + shot.holdDuration,
      speech: acc.speech + shot.speechDuration,
      hold: acc.hold + shot.holdDuration
    }),
    { total: 0, speech: 0, hold: 0 }
  );
}

export function applyPinnedHolds(next: ForecastShot[], prev: ForecastShot[]): ForecastShot[] {
  if (prev.length === 0) return next;
  const byNarration = new Map<string, ForecastShot>();
  prev.forEach((shot) => {
    const key = (shot.narration || '').replace(/\s+/g, '');
    if (key && shot.holdPinned) byNarration.set(key, shot);
  });
  const merged = next.map((shot, index) => {
    const key = (shot.narration || '').replace(/\s+/g, '');
    const pinned = (key && byNarration.get(key)) || (prev[index]?.holdPinned ? prev[index] : undefined);
    if (!pinned) return shot;
    return {
      ...shot,
      holdDuration: round2(Math.max(0, Math.min(8, pinned.holdDuration))),
      holdPinned: true
    };
  });
  return recomputeShotStarts(merged);
}

export function applyHoldToShots(shots: ForecastShot[], shotId: string, holdDuration: number): ForecastShot[] {
  const clamped = round1(Math.max(0, Math.min(8, holdDuration)));
  return recomputeShotStarts(
    shots.map((shot) => (
      shot.id === shotId
        ? { ...shot, holdDuration: clamped, holdPinned: true }
        : shot
    ))
  );
}

export function splitByVisualBeats(text: string, maxCharsPerShot: number): string[] {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  const parts = cleaned
    .split(/([。！？.!?；;\n]+)/)
    .reduce<string[]>((acc, part, index, arr) => {
      if (!part.trim()) return acc;
      if (/^[。！？.!?；;\n]+$/.test(part)) {
        if (acc.length > 0) acc[acc.length - 1] += part.trim();
        return acc;
      }
      const punct = arr[index + 1] && /^[。！？.!?；;\n]+$/.test(arr[index + 1]) ? '' : '';
      acc.push(part.trim() + punct);
      return acc;
    }, [])
    .map((part) => part.trim())
    .filter(Boolean);

  const merged: string[] = [];
  for (const part of parts) {
    const chars = countNarrationChars(part);
    if (merged.length > 0 && countNarrationChars(merged[merged.length - 1]) < 6 && chars < maxCharsPerShot) {
      merged[merged.length - 1] = `${merged[merged.length - 1]}${part}`;
    } else if (chars > maxCharsPerShot * 1.4) {
      const mid = Math.ceil(part.length / 2);
      const cut = part.lastIndexOf('，', mid) > 4 ? part.lastIndexOf('，', mid) : mid;
      merged.push(part.slice(0, cut + 1).trim());
      const rest = part.slice(cut + 1).trim();
      if (rest) merged.push(rest);
    } else {
      merged.push(part);
    }
  }
  return merged.length > 0 ? merged : [cleaned];
}

function chunksFromBeats(beats: ScriptBeat[], maxChars: number): { text: string; beat: ScriptBeat; splitReason: string }[] {
  const chunks: { text: string; beat: ScriptBeat; splitReason: string }[] = [];
  beats.forEach((beat) => {
    const text = (beat.narration || '').trim();
    if (!text) return;
    const pieces = countNarrationChars(text) > maxChars
      ? splitByVisualBeats(text, maxChars)
      : [text];
    pieces.forEach((piece, index) => {
      chunks.push({
        text: piece,
        beat,
        splitReason: pieces.length > 1
          ? `节拍「${beat.function}」超单镜字数，按标点切成 ${index + 1}/${pieces.length}`
          : `认领节拍 ${beat.order}（${beat.function}）`
      });
    });
  });
  return chunks;
}

export function predictShots(input: {
  narration: string;
  beats?: ScriptBeat[];
  budget: DurationBudget;
  spans?: SpeechSpan[];
  scriptLanguage?: ScriptLanguage;
}): ForecastShot[] {
  const language = normalizeScriptLanguage(input.scriptLanguage || input.budget.scriptLanguage);
  const spans = input.spans && input.spans.length > 0
    ? input.spans
    : buildSpeechSpans(input.narration, input.beats, language);
  let shots = shotsFromSpeechSpans(spans, input.budget.charsPerSecond, language);
  const locked = input.budget.lockedShotCount;
  if (locked && locked >= 2) {
    shots = fitVisualShotCount(shots, Math.min(Math.round(locked), maxForecastShotsForDuration(input.budget.targetSeconds)), language);
  } else {
    const maxShots = maxForecastShotsForDuration(input.budget.targetSeconds);
    if (shots.length > maxShots) shots = fitVisualShotCount(shots, maxShots, language);
  }
  shots = distributeBudgetHolds(shots, input.budget, input.beats);
  const used = input.budget.usedChars || countNarrationChars(input.narration);
  const fillTarget = input.budget.durationMode === 'target-driven' && used >= input.budget.maxChars * FILL_RATIO_MIN;
  return fitShotsToSpeech(shots, input.budget, fillTarget);
}

function fitVisualShotCount(shots: ForecastShot[], desired: number, language: ScriptLanguage): ForecastShot[] {
  if (desired < 2 || shots.length === 0) return shots;
  let next = shots.map((shot) => ({ ...shot }));
  while (next.length > desired && next.length > 2) {
    let minIndex = 0;
    let minScore = Infinity;
    for (let i = 0; i < next.length - 1; i++) {
      const score = next[i].speechDuration + next[i + 1].speechDuration + (next[i + 1].voRole === 'continue' ? -0.4 : 0);
      if (score < minScore) {
        minScore = score;
        minIndex = i;
      }
    }
    const a = next[minIndex];
    const b = next[minIndex + 1];
    const glue = language === 'en' ? ' ' : '';
    next.splice(minIndex, 2, {
      ...a,
      speechDuration: round2(a.speechDuration + b.speechDuration),
      holdDuration: round2((a.holdDuration || 0) + (b.holdDuration || 0)),
      narration: [a.narration, b.narration].filter(Boolean).join(glue) || a.narration,
      sliceText: [a.sliceText, b.sliceText].filter(Boolean).join(''),
      visualCount: 1,
      voRole: 'start',
      splitReason: `合并到锁镜数 ${desired}`
    });
  }
  let guard = 0;
  while (next.length < desired && guard < desired * 2) {
    guard += 1;
    let longest = 0;
    for (let i = 1; i < next.length; i++) {
      if (countNarrationChars(next[i].sliceText || next[i].narration) > countNarrationChars(next[longest].sliceText || next[longest].narration)) {
        longest = i;
      }
    }
    const text = (next[longest].sliceText || next[longest].narration || '').trim();
    if (countNarrationChars(text) < 12) break;
    const pieces = splitByVisualBeats(text, Math.max(8, Math.floor(countNarrationChars(text) / 2)));
    let valid = pieces.filter(Boolean);
    if (valid.length < 2) {
      const mid = Math.ceil(text.length / 2);
      const cutAt = Math.max(text.lastIndexOf('，', mid), text.lastIndexOf(',', mid), text.lastIndexOf(' ', mid));
      const at = cutAt > 4 ? cutAt + 1 : mid;
      valid = [text.slice(0, at).trim(), text.slice(at).trim()].filter(Boolean);
    }
    if (valid.length < 2) break;
    const speechTotal = next[longest].speechDuration;
    const units = valid.map((piece) => Math.max(1, countNarrationChars(piece)));
    const unitSum = units.reduce((sum, value) => sum + value, 0) || 1;
    const inserts = valid.map((piece, index) => ({
      ...next[longest],
      id: `${next[longest].id}-x${index}`,
      narration: index === 0 ? next[longest].narration : '',
      sliceText: piece,
      speechDuration: round2(speechTotal * (units[index] / unitSum)),
      holdDuration: index === valid.length - 1 ? next[longest].holdDuration : 0,
      voRole: (index === 0 ? 'start' : 'continue') as ForecastShot['voRole'],
      visualIndex: index,
      visualCount: valid.length,
      splitReason: `拆到锁镜数 ${desired}`
    }));
    next.splice(longest, 1, ...inserts);
  }
  return recomputeShotStarts(next.map((shot, index) => ({ ...shot, order: index + 1, id: `shot-${index + 1}` })));
}

function spokenShot(shot: ForecastShot): boolean {
  return shot.speechDuration > 0.12 || Boolean((shot.sliceText || shot.narration || '').trim());
}

export function redistributeHolds(shots: ForecastShot[], budget: DurationBudget, beats?: ScriptBeat[]): ForecastShot[] {
  if (shots.length === 0) return shots;
  const holdBudget = Math.max(0, Number(budget.visualHoldTargetSeconds) || budget.holdSeconds);
  const pinnedHold = shots.reduce((sum, shot) => sum + (shot.holdPinned ? shot.holdDuration : 0), 0);
  const remaining = Math.max(0, holdBudget - pinnedHold);
  const beatHold = new Map((beats || []).map((beat) => [beat.id, beat.needsHold]));
  const weights = shots.map((shot, index) => {
    if (shot.holdPinned) return 0;
    if (!spokenShot(shot)) return 0;
    let weight = 1;
    const prev = shots[index - 1];
    if (shot.energy === 'hold' || (shot.beatId && beatHold.get(shot.beatId))) weight += 2.4;
    if (shot.function === 'cta' || shot.function === 'reveal') weight += 1.6;
    if (shot.function === 'hook') weight += 0.7;
    if (prev && prev.sectionId && shot.sectionId && prev.sectionId !== shot.sectionId) weight += 1.3;
    return weight;
  });
  const weightSum = weights.reduce((sum, value) => sum + value, 0);
  if (!(weightSum > 0) || remaining <= 0) {
    return shots.map((shot) => (shot.holdPinned || spokenShot(shot) ? shot : { ...shot, holdDuration: 0 }));
  }
  return shots.map((shot, index) => {
    if (shot.holdPinned) return shot;
    if (!spokenShot(shot)) return { ...shot, holdDuration: 0 };
    return { ...shot, holdDuration: round2(remaining * (weights[index] / weightSum)) };
  });
}

function distributeBudgetHolds(shots: ForecastShot[], budget: DurationBudget, beats?: ScriptBeat[]): ForecastShot[] {
  return redistributeHolds(shots, budget, beats);
}

/**
 * Groups consecutive shots that can safely reuse one generated image.
 *
 * Must run after continuity / occupancy / location are stamped on the shots
 * (see stampShotsWithBible + withCoverage), otherwise the continuity and
 * location signals are still empty and scenes collapse into long runs.
 *
 * A new scene starts when: it is the first shot, the location lock changes,
 * continuity is contrast/new-info/callback, the beat function is hook or a CTA
 * turn, or the current scene already reached the `stride` hard cap. The cap is
 * a per-scene run limit (not a global scene budget) so the tail of the video
 * can no longer collapse into one repeated image.
 */
export function assignSceneIds(shots: ForecastShot[], budget?: DurationBudget): ForecastShot[] {
  if (shots.length === 0) return shots;
  const targetScenes = maxUniqueScenesForDuration(budget?.targetSeconds || shots.length * 3);
  const stride = Math.max(2, Math.ceil(shots.length / targetScenes));
  let sceneIndex = 1;
  let runLength = 0;
  return shots.map((shot, index) => {
    const prev = shots[index - 1];
    const locationChanged = index > 0 && (prev?.locationId || '') !== (shot.locationId || '');
    const semanticCut = shot.function === 'hook'
      || shot.continuity === 'contrast'
      || shot.continuity === 'new-info'
      || shot.continuity === 'callback'
      || locationChanged
      || (shot.function === 'cta' && prev?.function !== 'cta');
    const startNewScene = index === 0 || semanticCut || runLength >= stride;
    if (index > 0 && startNewScene) {
      sceneIndex += 1;
      runLength = 0;
    }
    runLength += 1;
    return { ...shot, sceneId: `scene-${sceneIndex}` };
  });
}

function mergeChunksToCount<T extends { text: string }>(chunks: T[], desired: number): T[] {
  const next = chunks.slice();
  while (next.length > desired && next.length > 2) {
    let minIndex = 0;
    let minChars = Infinity;
    for (let i = 0; i < next.length - 1; i++) {
      const combined = countNarrationChars(next[i].text) + countNarrationChars(next[i + 1].text);
      if (combined < minChars) {
        minChars = combined;
        minIndex = i;
      }
    }
    next.splice(minIndex, 2, {
      ...next[minIndex],
      text: `${next[minIndex].text}${next[minIndex + 1].text}`
    });
  }
  return next;
}

function splitChunksToCount<T extends { text: string; splitReason: string }>(
  chunks: T[],
  desired: number,
  maxChars: number
): T[] {
  const next = chunks.slice();
  let guard = 0;
  while (next.length < desired && guard < 24) {
    guard += 1;
    let longest = 0;
    for (let i = 1; i < next.length; i++) {
      if (countNarrationChars(next[i].text) > countNarrationChars(next[longest].text)) longest = i;
    }
    const text = next[longest].text;
    if (countNarrationChars(text) < 12) break;
    const pieces = splitByVisualBeats(text, Math.max(8, Math.floor(maxChars * 0.7)));
    if (pieces.length < 2) {
      const mid = Math.ceil(text.length / 2);
      const cut = text.lastIndexOf('，', mid) > 4 ? text.lastIndexOf('，', mid) : mid;
      pieces.splice(0, pieces.length, text.slice(0, cut + 1).trim(), text.slice(cut + 1).trim());
    }
    const valid = pieces.filter(Boolean);
    if (valid.length < 2) break;
    const inserts = valid.map((piece, index) => ({
      ...next[longest],
      text: piece,
      splitReason: `${next[longest].splitReason} · 扩到目标镜数 ${index + 1}/${valid.length}`
    }));
    next.splice(longest, 1, ...inserts);
  }
  return next.slice(0, desired);
}

function fitShotsToSpeech(
  shots: ForecastShot[],
  budget: DurationBudget,
  fillTarget: boolean
): ForecastShot[] {
  if (shots.length === 0) return shots;
  const speechSum = shots.reduce((sum, shot) => sum + shot.speechDuration, 0);
  if (!fillTarget) {
    return recomputeShotStarts(shots.map((shot, index) => ({ ...shot, order: index + 1, id: `shot-${index + 1}` })));
  }
  const holdSum = shots.reduce((sum, shot) => sum + shot.holdDuration, 0);
  const targetHold = Math.max(0, budget.targetSeconds - speechSum);
  const holdScale = holdSum > 0.05 ? targetHold / holdSum : 1;
  const fitted = shots.map((shot) => {
    const cap = shot.energy === 'hold' || shot.function === 'cta' ? 8 : 4;
    return {
      ...shot,
      speechDuration: round2(shot.speechDuration),
      holdDuration: round2(Math.min(cap, Math.max(0, shot.holdDuration * holdScale)))
    };
  });
  const afterHold = fitted.reduce((sum, shot) => sum + shot.speechDuration + shot.holdDuration, 0);
  let leftover = round2(budget.targetSeconds - afterHold);
  if (leftover > 0.15 && fitted.length > 0) {
    const holders = fitted
      .map((shot, index) => ({ shot, index, weight: shot.function === 'cta' || shot.energy === 'hold' ? 3 : 1 }))
      .filter((item) => !item.shot.holdPinned);
    const weightSum = holders.reduce((sum, item) => sum + item.weight, 0) || 1;
    holders.forEach((item) => {
      const extra = leftover * (item.weight / weightSum);
      fitted[item.index].holdDuration = round2(fitted[item.index].holdDuration + extra);
    });
    leftover = 0;
  }
  return recomputeShotStarts(fitted.map((shot, index) => ({ ...shot, order: index + 1, id: `shot-${index + 1}` })));
}

export function validateForecast(input: {
  budget: DurationBudget;
  shots: ForecastShot[];
  beats?: ScriptBeat[];
  scriptLanguage?: ScriptLanguage;
}): DirectorNote[] {
  const { budget, shots } = input;
  const notes: DirectorNote[] = [];
  const preset = PACE_PRESETS[budget.pace];
  const used = budget.usedChars;
  const unit = budgetUnitLabel(input.scriptLanguage);

  if (used > budget.maxChars) {
    const extraSeconds = round1((used - budget.maxChars) / budget.charsPerSecond);
    notes.push({
      id: 'chars-over',
      // Existing copy is content-first. Length mismatch needs a decision, not a hard stop.
      level: 'warn',
      target: 'chars',
      message: budget.durationMode === 'content-driven'
        ? `这段口播预计多 ${extraSeconds} 秒，约需 ${round1(used / budget.charsPerSecond)} 秒口播；可延长视频、压缩文案，或拆成系列。`
        : `超了 ${used - budget.maxChars} ${unit}，大约多 ${extraSeconds} 秒。要卡住 ${budget.targetSeconds} 秒请删一句论据或钩子复述。`
    });
  } else if (used > 0 && used < budget.maxChars * FILL_RATIO_MIN && budget.durationMode === 'target-driven') {
    notes.push({
      id: 'chars-under',
      level: used < budget.maxChars * 0.7 ? 'warn' : 'info',
      target: 'chars',
      message: `口播约 ${Math.round((used / Math.max(1, budget.maxChars)) * 100)}% 预算，目标是填到 90%–105%，不要只写「不超过」。`
    });
  } else if (used > 0 && used < budget.maxChars * 0.55) {
    notes.push({
      id: 'chars-under',
      level: 'info',
      target: 'chars',
      message: `${unit}偏少，画面会停较久。可以补一个例子，或把节奏改慢。`
    });
  }

  const plat = PLATFORM_OPTIONS.find((item) => item.id === budget.platform);
  if (plat && budget.targetSeconds > plat.max) {
    notes.push({
      id: 'beyond-recommend',
      level: 'info',
      target: 'duration',
      message: `当前 ${budget.targetSeconds}s 超过${plat.label}推荐的 ${plat.max}s，已按长视频链路处理。`
    });
  }
  if (budget.targetSeconds >= MAX_VIDEO_SECONDS) {
    notes.push({
      id: 'duration-cap',
      level: 'info',
      target: 'duration',
      message: `时长已顶到上限 ${MAX_VIDEO_SECONDS}s。`
    });
  }

  const first = shots[0];
  if (first && first.speechDuration + first.holdDuration > 3 && budget.pace !== 'slow' && budget.pace !== 'cinematic') {
    notes.push({
      id: 'hook-late',
      level: 'warn',
      target: 'hook',
      message: '钩子超过 3 秒，快/中档容易被划走。'
    });
  }

  if (shots.length > 0 && !shots.some((shot) => shot.function === 'hook')) {
    notes.push({
      id: 'no-hook',
      level: 'warn',
      target: 'hook',
      message: '前 3 秒没有钩子镜。'
    });
  }

  let streak = 1;
  for (let i = 1; i < shots.length; i++) {
    if (shots[i].energy === shots[i - 1].energy) streak += 1;
    else streak = 1;
    if (streak === 3) {
      notes.push({
        id: 'flat-energy',
        level: 'warn',
        target: 'shot',
        message: '节奏带是平的，拉开一处快切或一处停留。'
      });
      break;
    }
  }

  shots.forEach((shot) => {
    const duration = shot.speechDuration + shot.holdDuration;
    if (duration > preset.shotMax * 1.25) {
      notes.push({
        id: `shot-long-${shot.order}`,
        level: 'warn',
        target: 'shot',
        message: `第 ${shot.order} 镜 ${duration.toFixed(1)}s，超过该档建议上限，拆动作或加快口播。`
      });
    }
    const actions = countActionUnits(shot.narration);
    if (actions.length >= 3) {
      notes.push({
        id: `multi-actions-${shot.order}`,
        level: 'block',
        target: 'shot',
        message: `第 ${shot.order} 镜塞了 ${actions.length} 个动作（${actions.slice(0, 3).join('、')}）。一镜只能一个主动作，拆开才能写入分镜。`
      });
    } else if (actions.length >= 2) {
      notes.push({
        id: `two-actions-${shot.order}`,
        level: 'warn',
        target: 'shot',
        message: `第 ${shot.order} 镜里有两个动作（${actions.join('、')}）。一镜一个动作，把后一个挪到下一镜。`
      });
    }
  });

  const lock = lockedShotImplication(budget);
  if (lock?.pulled) {
    notes.push({
      id: 'asl-pace',
      level: 'warn',
      target: 'shot',
      message: lock.message
    });
  }

  const totals = shotsTotals(shots);
  const maxForecastShots = maxForecastShotsForDuration(budget.targetSeconds);
  if (shots.length >= maxForecastShots && budget.targetSeconds >= 300) {
    notes.push({
      id: 'shot-cap',
      level: 'warn',
      target: 'shot',
      message: `长视频已按资源保护限制为最多 ${maxForecastShots} 个视觉槽位；章节会复用画面，不会为停留无限生图。`
    });
  }
  if (shots.length > 0 && totals.total > budget.targetSeconds + 0.4) {
    notes.push({
      id: 'hold-over-target',
      level: 'info',
      target: 'hold',
      message: `总长 ${totals.total.toFixed(1)}s，比目标多 ${(totals.total - budget.targetSeconds).toFixed(1)}s。多出来的都是画面停留，口播没被拉长。`
    });
  } else if (shots.length > 0 && totals.speech + 0.8 < budget.speechSeconds && budget.usedChars < budget.maxChars * 0.85) {
    notes.push({
      id: 'short-of-target',
      level: 'warn',
      target: 'chars',
      message: `口播按语速大约 ${totals.speech.toFixed(1)}s，片子不会用空画面撑满 ${budget.targetSeconds}s。要到目标时长请加字，不要靠发呆。`
    });
  }

  shots.forEach((shot) => {
    if (shot.speechDuration >= 0.8 && shot.holdDuration > Math.max(2.5, shot.speechDuration * 1.5) && !shot.holdPinned) {
      notes.push({
        id: `hold-too-long-${shot.order}`,
        level: 'warn',
        target: 'hold',
        message: `第 ${shot.order} 镜口播 ${shot.speechDuration.toFixed(1)}s，停留 ${shot.holdDuration.toFixed(1)}s，画面会空很久。`
      });
    }
  });

  const holdSum = shots.reduce((sum, shot) => sum + shot.holdDuration, 0);
  if (shots.length > 0 && budget.holdSeconds > 0.4 && budget.usedChars >= budget.maxChars * 0.85) {
    const ratio = holdSum / budget.holdSeconds;
    if (ratio < 0.8 || ratio > 1.2) {
      notes.push({
        id: 'hold-quota',
        level: 'warn',
        target: 'hold',
        message: `停留 ${holdSum.toFixed(1)}s，配额 ${budget.holdSeconds.toFixed(1)}s，差得有点多。`
      });
    }
  }

  if (budget.conceptUsed > budget.conceptMax) {
    notes.push({
      id: 'concepts',
      level: 'warn',
      target: 'concept',
      message: `这条时长最多装 ${budget.conceptMax} 个点，现在写了 ${budget.conceptUsed} 个。砍点或加长。`
    });
  }

  return notes;
}

export function beatsFromNarration(narration: string, budget: DurationBudget): ScriptBeat[] {
  const language = normalizeScriptLanguage(budget.scriptLanguage);
  const pieces = splitCompleteSentences(narration, language, { keepShort: true });
  if (shouldUseSections(budget.targetSeconds, pieces.length)) {
    const plans = planScriptSections({
      targetSeconds: budget.targetSeconds,
      maxChars: budget.maxChars
    });
    const grouped = beatsFromSectionPlans(narration, plans, language);
    if (grouped.length >= 2) return grouped;
  }
  const count = Math.max(1, pieces.length || 1);
  const source = pieces.length > 0 ? pieces : Array.from({ length: count }, () => '');
  return source.slice(0, count).map((text, index) => {
    const progress = count <= 1 ? 0 : index / (count - 1);
    const fn = functionAtProgress(progress, index === count - 1);
    return {
      id: `beat-${index + 1}`,
      order: index + 1,
      function: fn,
      intent: beatIntentLabel(fn),
      narration: text,
      targetSeconds: round1(budget.targetSeconds / count),
      energy: energyAtProgress(progress, budget.pace),
      visualIntent: '',
      needsHold: fn === 'cta' || fn === 'reveal'
    };
  });
}

export function narrationFromBeats(beats: ScriptBeat[], scriptLanguage?: ScriptLanguage): string {
  const glue = normalizeScriptLanguage(scriptLanguage) === 'en' ? ' ' : '';
  return beats
    .map((beat) => (beat.narration || '').trim())
    .filter(Boolean)
    .join(glue);
}

export function applyNarrationToBeats(beats: ScriptBeat[], narration: string, scriptLanguage?: ScriptLanguage): ScriptBeat[] {
  if (beats.length === 0) return beats;
  const language = normalizeScriptLanguage(scriptLanguage);
  const pieces = splitCompleteSentences(narration, language, { keepShort: true });
  if (pieces.length === 0) {
    return beats.map((beat, index) => ({ ...beat, narration: index === 0 ? narration : '' }));
  }
  if (pieces.length === beats.length) {
    return beats.map((beat, index) => ({ ...beat, narration: pieces[index] || '' }));
  }
  const chars = pieces.map((piece) => Math.max(1, countNarrationChars(piece)));
  const total = chars.reduce((sum, value) => sum + value, 0);
  const assigned = beats.map(() => '');
  let cursor = 0;
  pieces.forEach((piece, pieceIndex) => {
    const target = Math.min(
      beats.length - 1,
      Math.floor((chars.slice(0, pieceIndex).reduce((sum, value) => sum + value, 0) / total) * beats.length)
    );
    const index = Math.max(cursor, target);
    assigned[index] = assigned[index] ? `${assigned[index]}${language === 'en' ? ' ' : ''}${piece}` : piece;
    cursor = index;
  });
  return beats.map((beat, index) => ({ ...beat, narration: assigned[index] || beat.narration }));
}

export function selectedTopic(cards: TopicCard[], selectedId: string | null): TopicCard | null {
  if (!selectedId) return null;
  return cards.find((card) => card.id === selectedId) || null;
}

export function beatIntentLabel(fn: BeatFunction): string {
  switch (fn) {
    case 'hook': return '前 3 秒制造缺口';
    case 'setup': return '为什么要看下去';
    case 'turn': return '转折 / 误解被拆';
    case 'proof': return '例子或机制';
    case 'reveal': return '关键一句';
    case 'cta': return '收束或行动';
    default: return '';
  }
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatSeconds(value: number): string {
  return `${round1(value)}s`;
}

export function usageRatio(used: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, used / max);
}
