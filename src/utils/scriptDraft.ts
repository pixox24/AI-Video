import { DraftSource, ScriptBeat, ScriptLanguage, ScriptSection } from '../types';
import { countBudgetUnits, normalizeScriptLanguage } from './scriptLanguage';
import { FILL_RATIO_MAX, FILL_RATIO_MIN, fillRatio, isLongForm } from './scriptDuration';
import { flattenSectionBeats, joinSectionNarrations } from './scriptSections';
import { splitCoversSource } from './scriptSplit';

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

const BEAT_FNS = new Set(['hook', 'setup', 'turn', 'proof', 'reveal', 'cta']);
const SECTION_BEAT_FNS: Record<ScriptSection['role'], Set<string>> = {
  hook: new Set(['hook']),
  setup: new Set(['setup']),
  body: new Set(['setup', 'turn', 'proof', 'reveal']),
  turn: new Set(['turn']),
  proof: new Set(['proof']),
  reveal: new Set(['reveal']),
  cta: new Set(['cta', 'reveal'])
};

export function normalizeDraftBeats(raw: unknown): ScriptBeat[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((beat: any, index: number) => ({
    id: String(beat?.id || `beat-${index + 1}`),
    order: Number(beat?.order) || index + 1,
    function: BEAT_FNS.has(beat?.function) ? beat.function : (index === 0 ? 'hook' : 'setup'),
    intent: String(beat?.intent || ''),
    narration: String(beat?.narration || '').trim(),
    targetSeconds: Number(beat?.targetSeconds) || 0,
    energy: beat?.energy || 'medium',
    visualIntent: String(beat?.visualIntent || ''),
    needsHold: Boolean(beat?.needsHold),
    sectionId: beat?.sectionId ? String(beat.sectionId) : undefined
  })).filter((beat) => beat.narration);
}

export interface SectionValidation {
  ok: boolean;
  warnings: string[];
}

export function validateScriptSections(
  sections: ScriptSection[] | undefined,
  scriptLanguage?: ScriptLanguage
): SectionValidation {
  if (!Array.isArray(sections) || sections.length === 0) return { ok: true, warnings: [] };
  const language = normalizeScriptLanguage(scriptLanguage);
  const warnings: string[] = [];
  sections.forEach((section, index) => {
    const label = `第 ${section.order || index + 1} 章「${section.title || section.id || '未命名'}」`;
    const narration = String(section.narration || '').trim();
    const used = countBudgetUnits(narration, language);
    const declaredMin = Number(section.minUnits);
    const declaredMax = Number(section.maxUnits);
    const min = Number.isFinite(declaredMin) && declaredMin > 0 ? Math.round(declaredMin) : 0;
    const max = Number.isFinite(declaredMax) && declaredMax > 0 ? Math.max(min, Math.round(declaredMax)) : Number.POSITIVE_INFINITY;
    if (!narration) {
      warnings.push(`${label}没有口播`);
    } else if (used < min || used > max) {
      warnings.push(`${label}口播为 ${used} ${language === 'en' ? '词' : '字'}，应为 ${min}–${max}`);
    }
    const beats = Array.isArray(section.beats)
      ? section.beats.filter((beat) => String(beat?.narration || '').trim())
      : [];
    if (beats.length === 0) {
      warnings.push(`${label}没有有效节拍`);
    } else if (beats.length > 4) {
      warnings.push(`${label}有 ${beats.length} 个节拍，单章最多 4 个`);
    } else if (narration && !splitCoversSource(beats.map((beat) => String(beat.narration || '')), narration)) {
      warnings.push(`${label}的节拍口播没有完整覆盖章节口播`);
    }
    const allowed = SECTION_BEAT_FNS[section.role];
    if (allowed && beats.some((beat) => !allowed.has(String(beat.function || '')))) {
      warnings.push(`${label}包含不符合章节角色的节拍类型`);
    }
  });
  return { ok: warnings.length === 0, warnings };
}

export function validateDraftResult(input: {
  fullNarration?: string;
  beats?: unknown;
  sections?: ScriptSection[];
  maxChars: number;
  targetSeconds: number;
  scriptLanguage?: ScriptLanguage;
  source?: DraftSource;
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
  if (fill > 0 && fill < FILL_RATIO_MIN) warnings.push(`口播只填了预算的 ${Math.round(fill * 100)}%，目标是 90%–105%`);
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
  const strictFill = input.source !== 'fallback' && input.targetSeconds >= 45;
  const fillOutOfContract = strictFill && (fill < FILL_RATIO_MIN || fill > FILL_RATIO_MAX);
  const reject = !narration
    || beats.length < 2
    || fillOutOfContract
    || (input.source !== 'fallback' && sectionValidation.ok === false)
    || (input.source !== 'fallback' && beats.length > 0 && !splitCoversSource(beats.map((beat) => beat.narration), narration))
    || (input.source !== 'fallback' && hasSections && Boolean(input.fullNarration) && !splitCoversSource([input.fullNarration], fromSections));
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
