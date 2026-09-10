import { DraftSource, ScriptBeat, ScriptLanguage, ScriptSection } from '../types';
import { countBudgetUnits, normalizeScriptLanguage } from './scriptLanguage';
import { FILL_RATIO_MIN, fillRatio, isLongForm } from './scriptDuration';
import { BEAT_FUNCTIONS, normalizeBeatFunction, flattenSectionBeats, joinSectionNarrations } from './scriptSections';
import { splitCoversSource, splitPastedNarration } from './scriptSplit';

export interface DraftValidation {
  ok: boolean;
  source: DraftSource;
  warnings: string[];
  fill: number;
  used: number;
  maxChars: number;
  beatCount: number;
  longForm: boolean;
}

const NARRATION_KEYS = [
  'fullNarration', 'full_narration', 'narration', 'script', 'voiceover', 'voiceOver',
  'voice_over', 'copy', 'text', 'content', '口播', '全文'
];
const BEAT_LIST_KEYS = ['beats', 'scenes', 'shots', 'clips', 'segments', '节拍', '分镜'];
const BEAT_NARRATION_KEYS = ['narration', 'text', 'content', 'line', 'voiceover', 'script', '口播'];
const UNWRAP_KEYS = ['data', 'result', 'draft', 'payload', 'output', 'script'];

function firstNonEmptyString(source: any, keys: string[]): string {
  if (!source || typeof source !== 'object') return '';
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstArray(source: any, keys: string[]): unknown[] {
  if (!source || typeof source !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(source[key])) return source[key];
  }
  return [];
}

function beatNarration(beat: any): string {
  if (typeof beat === 'string') return beat.trim();
  return firstNonEmptyString(beat, BEAT_NARRATION_KEYS);
}

function unwrapDraftPayload(raw: unknown): any {
  if (Array.isArray(raw)) return { beats: raw };
  if (!raw || typeof raw !== 'object') return raw;
  const obj = raw as Record<string, unknown>;
  if (firstNonEmptyString(obj, NARRATION_KEYS) || firstArray(obj, BEAT_LIST_KEYS).length > 0) return obj;
  for (const key of UNWRAP_KEYS) {
    const nested = obj[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
    if (Array.isArray(nested)) return { beats: nested };
  }
  return obj;
}

function joinBeatNarration(parts: string[]): string {
  const glue = parts.some((part) => /[\u4e00-\u9fff]/.test(part)) ? '' : ' ';
  return parts.map((part) => part.trim()).filter(Boolean).join(glue);
}

function splitNarrationInHalf(text: string): string[] {
  const value = text;
  if (value.trim().length < 4) return value.trim() ? [value] : [];
  const mid = Math.floor(value.length / 2);
  const punct = new Set(['。', '！', '？', '，', '.', '!', '?', ',', ' ', '、']);
  let cut = -1;
  for (let i = mid; i >= Math.floor(value.length * 0.3); i -= 1) {
    if (punct.has(value[i])) {
      cut = i + 1;
      break;
    }
  }
  if (cut < 2 || cut >= value.length) cut = mid;
  return [value.slice(0, cut), value.slice(cut)].filter((part) => part.trim());
}

function beatsFromChunks(chunks: string[]): ScriptBeat[] {
  return chunks.map((text, index) => ({
    id: `beat-${index + 1}`,
    order: index + 1,
    function: (index === 0 ? 'hook' : index === chunks.length - 1 ? 'cta' : 'setup') as ScriptBeat['function'],
    intent: '',
    narration: text,
    targetSeconds: 0,
    energy: 'medium' as const,
    visualIntent: '',
    needsHold: index === chunks.length - 1
  })).filter((beat) => beat.narration);
}

function beatsFromFullNarration(narration: string): ScriptBeat[] {
  const split = splitPastedNarration(narration);
  if (split.chunks.length >= 2 && splitCoversSource(split.chunks, narration)) {
    return beatsFromChunks(split.chunks);
  }
  return beatsFromChunks(splitNarrationInHalf(narration));
}

export function normalizeDraftBeats(raw: unknown): ScriptBeat[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((beat: any, index: number) => {
    const functionName = typeof beat === 'string' ? '' : String(beat?.function || beat?.role || beat?.type || '');
    return {
      id: String((typeof beat === 'object' && beat?.id) || `beat-${index + 1}`),
      order: Number(typeof beat === 'object' ? beat?.order : 0) || index + 1,
      function: normalizeBeatFunction(functionName, index === 0 ? 'hook' : 'setup').function,
      intent: String((typeof beat === 'object' && (beat?.intent || beat?.purpose)) || ''),
      narration: beatNarration(beat),
      targetSeconds: Number(typeof beat === 'object' ? beat?.targetSeconds : 0) || 0,
      energy: (typeof beat === 'object' && beat?.energy) || 'medium',
      visualIntent: String((typeof beat === 'object' && (beat?.visualIntent || beat?.visual || beat?.shot)) || ''),
      needsHold: Boolean(typeof beat === 'object' && beat?.needsHold),
      sectionId: typeof beat === 'object' && beat?.sectionId ? String(beat.sectionId) : undefined
    };
  }).filter((beat) => beat.narration);
}

export function coerceLlmDraftPayload(raw: unknown): { title?: string; fullNarration: string; beats: ScriptBeat[] } | null {
  if (raw == null) return null;
  const root = unwrapDraftPayload(raw);
  if (!root || typeof root !== 'object') return null;
  let beats = normalizeDraftBeats(firstArray(root, BEAT_LIST_KEYS));
  let fullNarration = firstNonEmptyString(root, NARRATION_KEYS);
  if (!fullNarration && beats.length >= 2) fullNarration = joinBeatNarration(beats.map((beat) => beat.narration));
  if (fullNarration && beats.length < 2) beats = beatsFromFullNarration(fullNarration);
  if (!fullNarration || beats.length < 2) return null;
  if (!splitCoversSource(beats.map((beat) => beat.narration), fullNarration)) {
    const synthesized = beatsFromFullNarration(fullNarration);
    if (synthesized.length >= 2 && splitCoversSource(synthesized.map((beat) => beat.narration), fullNarration)) {
      beats = synthesized;
    } else {
      fullNarration = joinBeatNarration(beats.map((beat) => beat.narration));
    }
  }
  if (!fullNarration || beats.length < 2) return null;
  const title = typeof (root as any).title === 'string' && (root as any).title.trim()
    ? String((root as any).title).trim()
    : undefined;
  return { title, fullNarration, beats };
}

export function describeDraftPayloadGap(raw: unknown): string {
  if (raw == null) return '模型没有返回可用口播和节拍';
  if (typeof raw !== 'object') return `模型返回了 ${typeof raw}，不是带口播和节拍的 JSON`;
  if (Array.isArray(raw)) {
    const beats = normalizeDraftBeats(raw);
    return beats.length < 2
      ? `模型只返回了数组，有效节拍 ${beats.length} 个，至少需要 2 个带口播的节拍`
      : '模型返回了节拍数组，但没有全文口播';
  }
  const keys = Object.keys(raw as object).slice(0, 12).join('、') || '空对象';
  const root = unwrapDraftPayload(raw);
  const narration = firstNonEmptyString(root, NARRATION_KEYS);
  const beats = normalizeDraftBeats(firstArray(root, BEAT_LIST_KEYS));
  if (!narration && beats.length === 0) return `模型返回了 JSON，但没有口播和节拍字段。实际键：${keys}`;
  if (!narration) return `模型返回了 ${beats.length} 个节拍，但缺少全文口播（fullNarration）。实际键：${keys}`;
  if (beats.length < 2) return `模型返回了口播，但有效节拍不足 2 个（当前 ${beats.length}）。实际键：${keys}`;
  return `模型返回了口播和节拍，但无法套成可校验短稿。实际键：${keys}`;
}

export interface SectionValidation {
  errors: string[];
  ok: boolean;
  warnings: string[];
}

export function validateScriptSections(
  sections: ScriptSection[] | undefined,
  scriptLanguage?: ScriptLanguage
): SectionValidation {
  if (!Array.isArray(sections) || sections.length === 0) return { ok: true, warnings: [], errors: [] };
  const language = normalizeScriptLanguage(scriptLanguage);
  const warnings: string[] = [];
  const errors: string[] = [];
  sections.forEach((section, index) => {
    const label = `第 ${section.order || index + 1} 章「${section.title || section.id || '未命名'}」`;
    const narration = String(section.narration || '').trim();
    const used = countBudgetUnits(narration, language);
    const declaredMin = Number(section.minUnits);
    const declaredMax = Number(section.maxUnits);
    const min = Number.isFinite(declaredMin) && declaredMin > 0 ? Math.round(declaredMin) : 0;
    const max = Number.isFinite(declaredMax) && declaredMax > 0 ? Math.max(min, Math.round(declaredMax)) : Number.POSITIVE_INFINITY;
    if (!narration) {
      errors.push(`${label}没有口播`);
    } else if (used < min || used > max) {
      warnings.push(`${label}口播为 ${used} ${language === 'en' ? '词' : '字'}，参考预算 ${min}–${max}；草稿保留，全文完成后统一评估。`);
    }
    const beats = Array.isArray(section.beats)
      ? section.beats.filter((beat) => String(beat?.narration || '').trim())
      : [];
    if (beats.length === 0) {
      errors.push(`${label}没有有效节拍`);
    } else if (beats.length > 4) {
      errors.push(`${label}有 ${beats.length} 个节拍，单章最多 4 个`);
    } else if (narration && !splitCoversSource(beats.map((beat) => String(beat.narration || '')), narration)) {
      errors.push(`${label}的节拍口播没有完整覆盖章节口播`);
    }
    warnings.push(...(section.beatLabelWarnings || []));
    beats.forEach((beat, beatIndex) => {
      if (!BEAT_FUNCTIONS.includes(beat.function)) errors.push(`${label}第 ${beatIndex + 1} 个节拍类型「${String(beat.function)}」未归一化；合法值：${BEAT_FUNCTIONS.join('、')}`);
    });
  });
  return { ok: errors.length === 0, errors, warnings: [...errors, ...warnings] };
}

export function validateDraftResult(input: {
  fullNarration?: string;
  beats?: unknown;
  sections?: ScriptSection[];
  maxChars: number;
  targetSeconds: number;
  scriptLanguage?: ScriptLanguage;
  source?: DraftSource;
  durationMode?: 'target-driven' | 'content-driven';
}): DraftValidation {
  const language = normalizeScriptLanguage(input.scriptLanguage);
  const fromSections = input.sections && input.sections.length > 0
    ? joinSectionNarrations(input.sections, language)
    : '';
  const narration = String(input.fullNarration || fromSections || '').trim();
  const beats = normalizeDraftBeats(input.beats).length > 0
    ? normalizeDraftBeats(input.beats)
    : (input.sections ? flattenSectionBeats(input.sections) : []);
  const used = countBudgetUnits(narration, language);
  const fill = fillRatio(used, input.maxChars);
  const longForm = isLongForm(input.targetSeconds);
  const warnings: string[] = [];
  const hasSections = Array.isArray(input.sections) && input.sections.length > 0;
  const sectionValidation = validateScriptSections(input.sections, language);
  if (!narration) warnings.push('没有口播正文');
  if (beats.length < 2) warnings.push('节拍少于 2 个');
  if (fill > 1.05) warnings.push(`口播超出预算 ${Math.round((fill - 1) * 100)}%`);
  if (fill > 0 && fill < FILL_RATIO_MIN) warnings.push(`口播约为参考预算的 ${Math.round(fill * 100)}%；草稿保留，全文完成后检查内容完整性与目标时长`);
  if (hasSections && input.fullNarration && !splitCoversSource([input.fullNarration], fromSections)) {
    warnings.push('fullNarration 与章节口播不一致');
  }
  if (beats.length > 0 && !splitCoversSource(beats.map((beat) => beat.narration), narration)) {
    warnings.push('fullNarration 与节拍口播不一致');
  }
  warnings.push(...sectionValidation.warnings);
  if (longForm && !hasSections && beats.length > 0 && beats.length <= 8 && input.targetSeconds >= 120) {
    warnings.push('长视频仍只有短视频节拍数量，请按章节展开');
  }
  // ponytail: length stays advisory; quality review decides whether content needs revision.
  const reject = !narration
    || beats.length < 2
    || (input.source !== 'fallback' && sectionValidation.ok === false)
    || (input.source !== 'fallback' && beats.length > 0 && !splitCoversSource(beats.map((beat) => beat.narration), narration))
    || (input.source !== 'fallback' && hasSections && Boolean(input.fullNarration) && !splitCoversSource([input.fullNarration!], fromSections));
  return {
    ok: !reject,
    source: input.source || 'llm',
    warnings,
    fill,
    used,
    maxChars: input.maxChars,
    beatCount: beats.length,
    longForm
  };
}

export function draftHttpError(validation: DraftValidation): string {
  if (!validation.ok && validation.source === 'fallback') {
    return '模型未能按时长写出完整稿，未套用短稿。请检查 LLM 配置后重试。';
  }
  if (!validation.ok) return validation.warnings[0] || '写稿结果未通过校验';
  return '';
}
