import {
  ScriptBrief,
  ScriptForm,
  ScriptLanguage,
  ScriptOutline,
  ScriptSection
} from '../types';
import { emptySectionFromPlan, ScriptSectionPlan } from './scriptSections';
import { draftNeedsOutlinePreview, draftRequiresOutline, validateSectionAgainstOutline } from './scriptOutline';

export type DraftAsk = (user: string, maxTokens?: number, system?: string) => Promise<any | null>;

export type DraftGateResult =
  | { action: 'short' }
  | { action: 'outline_preview' }
  | { action: 'outline_required' }
  | { action: 'write-sections' };

export function draftGate(input: {
  form: ScriptForm;
  outline?: ScriptOutline | null;
  confirmMedium?: boolean;
}): DraftGateResult {
  if (input.form === 'short') return { action: 'short' };
  if (draftNeedsOutlinePreview(input.form, input.outline)) return { action: 'outline_preview' };
  if (draftRequiresOutline(input.form, input.outline, Boolean(input.confirmMedium))) {
    return { action: 'outline_required' };
  }
  return { action: 'write-sections' };
}

export function seedSectionsFromOutline(
  plans: ScriptSectionPlan[],
  outline: ScriptOutline,
  priorSections: ScriptSection[] | undefined
): ScriptSection[] {
  const prior = Array.isArray(priorSections) ? priorSections : [];
  return plans.map((plan) => {
    const existing = prior.find((item) => item.id === plan.id);
    if (existing && (existing.status === 'locked' || String(existing.narration || '').trim())) {
      return { ...emptySectionFromPlan(plan), ...existing, id: plan.id, order: plan.order, role: plan.role };
    }
    const planned = outline.sections.find((item) => item.id === plan.id);
    const section = emptySectionFromPlan(plan);
    return {
      ...section,
      title: planned?.title || plan.title,
      outline: planned?.promise || '',
      audienceQuestion: planned?.audienceQuestion,
      promise: planned?.promise,
      status: 'planned'
    };
  });
}

export function materializeSectionFromLlm(
  piece: any,
  section: ScriptSection,
  planned: ScriptOutline['sections'][number]
): ScriptSection | null {
  const narration = String(piece?.narration || '').trim();
  if (!narration) return null;
  const beats = Array.isArray(piece?.beats) && piece.beats.length > 0
    ? piece.beats.map((beat: any, index: number) => ({
      id: `${section.id}-beat-${index + 1}`,
      order: index + 1,
      function: beat.function || section.beats[0]?.function || 'setup',
      intent: beat.intent || '',
      narration: String(beat.narration || '').trim() || (index === 0 ? narration : ''),
      targetSeconds: Number(beat.targetSeconds) || section.targetSeconds,
      energy: beat.energy || 'medium',
      visualIntent: beat.visualIntent || '',
      needsHold: Boolean(beat.needsHold),
      sectionId: section.id
    }))
    : [{ ...section.beats[0], narration, sectionId: section.id }];
  return {
    ...section,
    title: planned.title || section.title,
    narration,
    beats,
    usedEvidenceIds: Array.isArray(piece?.usedEvidenceIds) ? piece.usedEvidenceIds.map(String) : [],
    status: 'ready'
  };
}

export async function draftOneSection(input: {
  ask: DraftAsk;
  prompt: string;
  system: string;
  section: ScriptSection;
  planned: ScriptOutline['sections'][number];
  brief?: ScriptBrief;
  language?: ScriptLanguage;
  maxTokens: number;
}): Promise<{ section?: ScriptSection; warnings: string[]; failed: boolean }> {
  if (input.section.status === 'locked' || input.planned.status === 'locked') {
    return { failed: true, warnings: ['锁定章节不会被自动改写。'] };
  }
  let warnings: string[] = [];
  // Initial attempt plus two retries; every paid response is materialized and checked.
  for (let attempt = 0; attempt <= 2; attempt += 1) {
    const prompt = attempt === 0 ? input.prompt : `${input.prompt}\n上次输出未通过结构校验：${warnings.join('；')}。请修正本章，并让 beats.narration 按顺序完整拼接成 narration。`;
    const piece = await input.ask(prompt, input.maxTokens, input.system);
    const candidate = materializeSectionFromLlm(piece, input.section, input.planned);
    if (candidate) {
      const check = validateSectionAgainstOutline(candidate, input.planned, input.brief, input.language);
      if (check.ok) return { section: candidate, warnings: check.warnings, failed: false };
      warnings = check.errors;
    } else {
      warnings = [`第 ${input.section.order} 章「${input.section.title}」没有口播`];
    }
  }
  return { warnings, failed: true };
}

export async function runSectionedDraft(input: {
  ask: DraftAsk;
  plans: ScriptSectionPlan[];
  outline: ScriptOutline;
  priorSections?: ScriptSection[];
  brief?: ScriptBrief;
  language?: ScriptLanguage;
  maxTokens: number;
  system: string;
  buildPrompt: (section: ScriptSection, planned: ScriptOutline['sections'][number], completed: ScriptSection[]) => string;
}): Promise<{
  ok: boolean;
  sections: ScriptSection[];
  failedSectionId?: string;
  warnings: string[];
}> {
  const sections = seedSectionsFromOutline(input.plans, input.outline, input.priorSections);
  const warnings: string[] = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (section.status === 'locked' || String(section.narration || '').trim()) continue;
    const planned = input.outline.sections.find((item) => item.id === section.id) || input.outline.sections[i];
    const prompt = input.buildPrompt(section, planned, sections.filter((item) => String(item.narration || '').trim()));
    const result = await draftOneSection({
      ask: input.ask,
      prompt,
      system: input.system,
      section,
      planned,
      brief: input.brief,
      language: input.language,
      maxTokens: input.maxTokens
    });
    if (result.failed || !result.section) {
      sections[i] = { ...section, status: 'failed' };
      return {
        ok: false,
        sections: sections.filter((item) => String(item.narration || '').trim() || item.status === 'locked'),
        failedSectionId: section.id,
        warnings: result.warnings
      };
    }
    sections[i] = result.section;
    warnings.push(...result.warnings);
  }
  return { ok: true, sections, warnings };
}
