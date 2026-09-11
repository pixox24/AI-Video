import {
  DurationBudget,
  OutlineStatus,
  ScriptBrief,
  ScriptForm,
  ScriptLanguage,
  ScriptOutline,
  ScriptOutlineSection,
  ScriptRevisionPlan,
  ScriptSection,
  ScriptSectionRole,
  SectionStatus
} from '../types';
import { countBudgetUnits, normalizeScriptLanguage } from './scriptLanguage';
import { FILL_RATIO_MAX, FILL_RATIO_MIN, outlineConfirmationRequired, scriptFormForSeconds } from './scriptDuration';
import { lengthBudgetOf } from './scriptBudget';
import { ScriptSectionPlan, flattenSectionBeats, joinSectionNarrations, planScriptSections } from './scriptSections';
import { splitCoversSource } from './scriptSplit';
import { validateScriptSections } from './scriptDraft';

export interface OutlineValidation {
  ok: boolean;
  warnings: string[];
}

const GENERIC_PROMISE = /^(继续讲解|展开说明|继续说明|稍后展开|详见下文|见下文|本章展开)$/;

export function emptyScriptBrief(): ScriptBrief {
  return {
    audience: '',
    coreQuestion: '',
    coreConclusion: '',
    evidence: [],
    forbiddenClaims: [],
    requiredTerms: []
  };
}

export function normalizeScriptBrief(raw?: Partial<ScriptBrief> | null): ScriptBrief {
  const base = emptyScriptBrief();
  if (!raw || typeof raw !== 'object') return base;
  const evidence = Array.isArray(raw.evidence)
    ? raw.evidence.map((item, index) => {
      const confidence = item?.confidence === 'researched' || item?.confidence === 'unverified' ? item.confidence : 'user' as const;
      return {
        id: String(item?.id || `evidence-${index + 1}`),
        claim: String(item?.claim || '').trim(),
        source: item?.source ? String(item.source) : undefined,
        confidence
      };
    }).filter((item) => item.claim)
    : [];
  return {
    audience: String(raw.audience || '').trim(),
    coreQuestion: String(raw.coreQuestion || '').trim(),
    coreConclusion: String(raw.coreConclusion || '').trim(),
    evidence,
    forbiddenClaims: Array.isArray(raw.forbiddenClaims) ? raw.forbiddenClaims.map((item) => String(item || '').trim()).filter(Boolean) : [],
    requiredTerms: Array.isArray(raw.requiredTerms) ? raw.requiredTerms.map((item) => String(item || '').trim()).filter(Boolean) : [],
    callToAction: raw.callToAction ? String(raw.callToAction).trim() : undefined
  };
}

export function draftRequiresOutline(
  form: ScriptForm,
  outline?: ScriptOutline | null,
  confirmMedium = false
): boolean {
  if (!outlineConfirmationRequired(form, confirmMedium)) return false;
  return outline?.status !== 'confirmed';
}

export function draftNeedsOutlinePreview(form: ScriptForm, outline?: ScriptOutline | null): boolean {
  if (form !== 'medium') return false;
  return !outline || !Array.isArray(outline.sections) || outline.sections.length === 0;
}

export function outlineFromPlans(
  plans: ScriptSectionPlan[],
  opts?: { thesis?: string; status?: OutlineStatus; version?: number }
): ScriptOutline {
  return {
    status: opts?.status || 'draft',
    version: opts?.version || 1,
    oneSentenceThesis: String(opts?.thesis || '').trim(),
    sections: plans.map((plan) => ({
      id: plan.id,
      order: plan.order,
      title: plan.title,
      role: plan.role,
      audienceQuestion: '',
      promise: '',
      evidenceIds: [],
      bridgeFromPrevious: plan.order === 1 ? '开篇' : '',
      bridgeToNext: '',
      targetSeconds: plan.targetSeconds,
      targetUnits: plan.targetUnits,
      minUnits: plan.minUnits,
      maxUnits: plan.maxUnits,
      status: 'planned'
      ,narrationBudgetSec: plan.targetSeconds * 0.85
      ,visualHoldBudgetSec: plan.targetSeconds * 0.15
      ,retentionDevice: ''
      ,transitionOut: ''
    }))
  };
}

export function stampOutlineBudgets(
  outline: ScriptOutline,
  plans: ScriptSectionPlan[],
  modelSections?: Array<Partial<ScriptOutlineSection>> | null
): ScriptOutline {
  const byId = new Map((modelSections || []).map((item) => [String(item?.id || ''), item]));
  const sections = plans.map((plan, index) => {
    const hit = byId.get(plan.id) || modelSections?.[index] || {};
    const evidenceIds = Array.isArray(hit.evidenceIds)
      ? hit.evidenceIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const previousStatus = outline.sections.find((item) => item.id === plan.id)?.status;
    return {
      id: plan.id,
      order: plan.order,
      role: plan.role,
      title: String(hit.title || plan.title).trim() || plan.title,
      audienceQuestion: String(hit.audienceQuestion || '').trim(),
      promise: String(hit.promise || '').trim(),
      evidenceIds,
      bridgeFromPrevious: String(hit.bridgeFromPrevious || (plan.order === 1 ? '开篇' : '')).trim(),
      bridgeToNext: String(hit.bridgeToNext || '').trim(),
      targetSeconds: plan.targetSeconds,
      targetUnits: plan.targetUnits,
      minUnits: plan.minUnits,
      maxUnits: plan.maxUnits,
      status: previousStatus && previousStatus !== 'planned' ? previousStatus : 'planned'
      ,narrationBudgetSec: Number(hit.narrationBudgetSec) || plan.targetSeconds * 0.85
      ,visualHoldBudgetSec: Number(hit.visualHoldBudgetSec) || plan.targetSeconds * 0.15
      ,retentionDevice: String(hit.retentionDevice || '').trim()
      ,transitionOut: String(hit.transitionOut || '').trim()
    } satisfies ScriptOutlineSection;
  });
  return {
    ...outline,
    sections,
    version: Math.max(1, Number(outline.version) || 1)
  };
}

export function outlineFromExistingSections(
  sections: ScriptSection[] | undefined,
  budget: DurationBudget,
  genre?: string | null
): ScriptOutline | undefined {
  if (!Array.isArray(sections) || sections.length === 0) return undefined;
  const plans = planScriptSections({
    targetSeconds: budget.targetSeconds,
    maxChars: lengthBudgetOf(budget).targetUnits,
    genre
  });
  const draft = outlineFromPlans(plans, { status: 'draft', thesis: sections.map((item) => item.title).filter(Boolean).join('；') });
  return {
    ...draft,
    sections: draft.sections.map((item, index) => {
      const existing = sections[index];
      return {
        ...item,
        title: existing?.title || item.title,
        promise: existing?.promise || existing?.outline || item.promise,
        audienceQuestion: existing?.audienceQuestion || item.audienceQuestion,
        status: existing?.status === 'locked' || existing?.status === 'ready'
          ? existing.status
          : existing?.narration
            ? 'ready'
            : 'planned'
      };
    })
  };
}

export function validateOutline(
  outline: ScriptOutline | undefined,
  brief: ScriptBrief | undefined,
  budget: DurationBudget
): OutlineValidation {
  const warnings: string[] = [];
  if (!outline || !Array.isArray(outline.sections) || outline.sections.length === 0) {
    return { ok: false, warnings: ['提纲没有章节'] };
  }
  const ids = outline.sections.map((section) => section.id);
  if (new Set(ids).size !== ids.length) warnings.push('提纲章节 ID 重复');
  outline.sections.forEach((section, index) => {
    if (section.order !== index + 1) warnings.push(`第 ${index + 1} 章顺序应为 ${index + 1}`);
    if (!section.title.trim()) warnings.push(`第 ${index + 1} 章没有标题`);
    if (GENERIC_PROMISE.test(section.promise.trim())) {
      warnings.push(`第 ${index + 1} 章承诺过于空泛`);
    }
  });
  if (outline.sections[0]?.role !== 'hook') warnings.push('第一章必须是开场钩子');
  if (outline.sections[outline.sections.length - 1]?.role !== 'cta') warnings.push('最后一章必须是收束');
  const evidenceIds = new Set((brief?.evidence || []).map((item) => item.id));
  outline.sections.forEach((section) => {
    section.evidenceIds.forEach((id) => {
      if (!evidenceIds.has(id)) warnings.push(`章节「${section.title}」引用了不存在的证据 ${id}`);
    });
  });
  const length = lengthBudgetOf(budget);
  const unitSum = outline.sections.reduce((sum, section) => sum + Number(section.targetUnits || 0), 0);
  if (Math.abs(unitSum - length.targetUnits) > 1) {
    warnings.push(`章节目标字数合计 ${unitSum}，与全片目标 ${length.targetUnits} 相差超过 1`);
  }
  const form = scriptFormForSeconds(budget.targetSeconds);
  const totalNarration = outline.sections.reduce((sum, section) => sum + section.narrationBudgetSec, 0);
  const totalHold = outline.sections.reduce((sum, section) => sum + section.visualHoldBudgetSec, 0);
  const speechBudget = budget.speechTargetSeconds || budget.speechSeconds;
  if (Math.abs(totalNarration - speechBudget) > speechBudget * 0.1) warnings.push('章节口播预算合计必须在全片口播预算 ±10% 内');
  if (Math.abs(totalNarration + totalHold - budget.targetSeconds) > budget.targetSeconds * 0.1) warnings.push('章节总时长预算合计必须在全片目标 ±10% 内');
  if (outline.sections[0] && outline.sections[0].narrationBudgetSec + outline.sections[0].visualHoldBudgetSec > 35) warnings.push('hook 段总预算不得超过 35 秒');
  if (form === 'medium' && outline.sections.length < 3) warnings.push('段落视频至少需要 3 章');
  if ((form === 'long' || form === 'extended') && outline.sections.length < 6) warnings.push('章节视频至少需要 6 章');
  return { ok: warnings.length === 0, warnings };
}

export function validateSectionAgainstOutline(
  section: ScriptSection,
  outlineSection: ScriptOutlineSection | undefined,
  brief?: ScriptBrief,
  language?: ScriptLanguage
): OutlineValidation & { errors: string[] } {
  if (!outlineSection) {
    const errors = [`找不到章节 ${section.id} 的提纲`];
    return { ok: false, errors, warnings: errors };
  }
  const coverage = validateScriptSections([{ ...section, minUnits: outlineSection.minUnits, maxUnits: outlineSection.maxUnits }], language);
  const errors = [...coverage.errors];
  if (section.id !== outlineSection.id) errors.push('章节 ID 与提纲不一致');
  const allowed = new Set(outlineSection.evidenceIds);
  const briefIds = new Set((brief?.evidence || []).map((item) => item.id));
  (section.usedEvidenceIds || []).forEach((id) => {
    if (!allowed.has(id)) errors.push(`章节使用了提纲未列出的证据 ${id}`);
    if (!briefIds.has(id)) errors.push(`章节使用了不存在的证据 ${id}`);
  });
  return { ok: errors.length === 0, errors, warnings: [...new Set([...errors, ...coverage.warnings])] };
}

function normalizeSnippet(text: string, language?: ScriptLanguage): string {
  const lang = normalizeScriptLanguage(language);
  return (text || '').replace(/\s+/g, lang === 'en' ? ' ' : '').slice(0, 60);
}

export function validateScriptProgression(
  sections: ScriptSection[] | undefined,
  outline: ScriptOutline | undefined,
  language?: ScriptLanguage
): OutlineValidation {
  const warnings: string[] = [];
  if (!Array.isArray(sections) || sections.length === 0) return { ok: false, warnings: ['没有章节正文'] };
  if (outline?.sections?.length) {
    if (sections.length !== outline.sections.length) warnings.push('成稿章节数与提纲不一致');
    sections.forEach((section, index) => {
      const planned = outline.sections[index];
      if (planned && section.id !== planned.id) warnings.push(`第 ${index + 1} 章 ID 应为 ${planned.id}`);
    });
  }
  const lang = normalizeScriptLanguage(language);
  for (let i = 1; i < sections.length; i += 1) {
    const prev = normalizeSnippet(sections[i - 1].narration, lang);
    const current = normalizeSnippet(sections[i].narration, lang);
    if (prev && current && prev === current) {
      warnings.push(`第 ${i} 章与第 ${i + 1} 章开头重复`);
    }
  }
  const thesis = String(outline?.oneSentenceThesis || '').trim();
  if (thesis) {
    const hits = sections.filter((section) => section.narration.includes(thesis)).length;
    if (hits > 2) warnings.push('核心结论在正文中重复过多');
  }
  const coverage = validateScriptSections(sections, lang);
  warnings.push(...coverage.errors);
  const full = joinSectionNarrations(sections, lang);
  const beats = flattenSectionBeats(sections);
  if (beats.length > 0 && full && !splitCoversSource(beats.map((beat) => beat.narration), full)) {
    warnings.push('节拍口播没有完整覆盖全文');
  }
  return { ok: warnings.length === 0, warnings };
}

export function measuredDurationDelta(measuredSeconds: number, targetSeconds: number): {
  delta: number;
  tolerance: number;
  within: boolean;
} {
  const delta = Number(measuredSeconds) - Number(targetSeconds);
  const tolerance = Math.max(2, Number(targetSeconds) * 0.05);
  return { delta, tolerance, within: Math.abs(delta) <= tolerance };
}

export function buildRevisionPlan(input: {
  measuredSeconds: number;
  targetSeconds: number;
  outline?: ScriptOutline | null;
  sections?: ScriptSection[];
  unitsPerSecond?: number;
  reason?: ScriptRevisionPlan['reason'];
}): ScriptRevisionPlan {
  const { delta } = measuredDurationDelta(input.measuredSeconds, input.targetSeconds);
  const reason = input.reason || (delta > 0 ? 'over-duration' : 'under-duration');
  const cps = Math.max(1, Number(input.unitsPerSecond) || 4.3);
  let remaining = Math.round(Math.abs(delta) * cps);
  const action = delta > 0 ? 'compress' : 'expand';
  const candidates = (input.outline?.sections || []).filter((section) => {
    if (section.status === 'locked') return false;
    if (section.role === 'hook' || section.role === 'cta' || section.role === 'reveal') return false;
    return true;
  });
  const sectionActions: ScriptRevisionPlan['sectionActions'] = [];
  candidates.forEach((section, index) => {
    if (remaining <= 0) return;
    const cap = Math.max(4, Math.round(section.targetUnits * 0.2));
    const last = index === candidates.length - 1;
    const take = last ? Math.min(cap, remaining) : Math.min(cap, Math.ceil(remaining / Math.max(1, candidates.length - index)));
    if (take <= 0) return;
    remaining -= take;
    sectionActions.push({
      sectionId: section.id,
      action,
      targetDeltaUnits: take,
      instruction: action === 'compress'
        ? `压缩约 ${take} 字，优先删重复修饰和可替代过渡，不改本章结论。`
        : `扩写约 ${take} 字，补具体例子、必要解释或可执行步骤，不改本章结论。`
    });
  });
  return {
    reason,
    measuredSeconds: input.measuredSeconds,
    targetSeconds: input.targetSeconds,
    deltaSeconds: Math.round(delta * 10) / 10,
    sectionActions
  };
}

export function markOutlineStale(outline: ScriptOutline | undefined, keepStatuses = true): ScriptOutline | undefined {
  if (!outline) return outline;
  return {
    ...outline,
    status: outline.status === 'confirmed' ? 'stale' : outline.status,
    sections: keepStatuses
      ? outline.sections.map((section) => (
        section.status === 'ready' || section.status === 'locked'
          ? { ...section, status: section.status === 'locked' ? 'locked' : 'needs-revision' }
          : section
      ))
      : outline.sections
  };
}

export function completedSectionSummaries(
  sections: ScriptSection[] | undefined,
  language?: ScriptLanguage
): string {
  if (!Array.isArray(sections) || sections.length === 0) return '（尚无已完成章节）';
  const lang = normalizeScriptLanguage(language);
  return sections
    .filter((section) => section.narration.trim())
    .map((section) => {
      const units = countBudgetUnits(section.narration, lang);
      const snippet = section.narration.replace(/\s+/g, lang === 'en' ? ' ' : '').slice(0, 80);
      return `${section.order}. ${section.title}（${units}${lang === 'en' ? '词' : '字'}）：${snippet}`;
    })
    .join('\n');
}

export function mergeSectionIntoWorkspaceSections(
  sections: ScriptSection[] | undefined,
  next: ScriptSection
): ScriptSection[] {
  const list = Array.isArray(sections) ? [...sections] : [];
  const index = list.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    const previous = list[index];
    if (previous.status === 'locked') return list;
    list[index] = next;
    return list;
  }
  list.push(next);
  return list.sort((a, b) => a.order - b.order);
}

function chapterWindow(units: number, role: ScriptSectionRole): { minUnits: number; maxUnits: number } {
  if (role === 'hook' || role === 'cta') {
    return {
      minUnits: Math.max(8, Math.ceil(units * 0.5)),
      maxUnits: Math.max(24, Math.ceil(units * 1.25), Math.round(units) + 12)
    };
  }
  return {
    minUnits: Math.max(8, Math.ceil(units * 0.9)),
    maxUnits: Math.max(8, Math.ceil(units * 1.05))
  };
}

export function rescaleOutline(outline: ScriptOutline, budget: DurationBudget): ScriptOutline {
  const length = lengthBudgetOf(budget);
  const sections = [...outline.sections].sort((a, b) => a.order - b.order);
  const weight = sections.map((section) => Math.max(1, Number(section.targetSeconds) || 1));
  const weightSum = weight.reduce((sum, value) => sum + value, 0) || 1;
  let usedSeconds = 0;
  let usedUnits = 0;
  const next = sections.map((section, index) => {
    const last = index === sections.length - 1;
    const targetSeconds = last
      ? Math.max(3, Math.round((budget.targetSeconds - usedSeconds) * 10) / 10)
      : Math.max(3, Math.round(budget.targetSeconds * (weight[index] / weightSum) * 10) / 10);
    const targetUnits = last
      ? Math.max(8, length.targetUnits - usedUnits)
      : Math.max(8, Math.round(length.targetUnits * (weight[index] / weightSum)));
    usedSeconds += targetSeconds;
    usedUnits += targetUnits;
    const window = chapterWindow(targetUnits, section.role);
    return {
      ...section,
      order: index + 1,
      id: `section-${index + 1}`,
      targetSeconds,
      targetUnits,
      minUnits: window.minUnits,
      maxUnits: window.maxUnits
    };
  });
  return { ...outline, sections: next, status: outline.status === 'confirmed' ? 'stale' : outline.status };
}

export function moveOutlineSection(outline: ScriptOutline, sectionId: string, direction: -1 | 1, budget: DurationBudget): ScriptOutline {
  const sections = [...outline.sections].sort((a, b) => a.order - b.order);
  const index = sections.findIndex((item) => item.id === sectionId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= sections.length) return outline;
  const swap = sections[index];
  sections[index] = sections[nextIndex];
  sections[nextIndex] = swap;
  return rescaleOutline({ ...outline, sections }, budget);
}

export function addOutlineSection(outline: ScriptOutline, afterId: string | null, budget: DurationBudget): ScriptOutline {
  const sections = [...outline.sections].sort((a, b) => a.order - b.order);
  const after = afterId ? sections.findIndex((item) => item.id === afterId) : sections.length - 1;
  const insertAt = Math.max(0, after) + 1;
  const template: ScriptOutlineSection = {
    id: `section-new-${Date.now()}`,
    order: insertAt + 1,
    title: '新章节',
    role: 'body',
    audienceQuestion: '',
    promise: '',
    evidenceIds: [],
    bridgeFromPrevious: '',
    bridgeToNext: '',
    targetSeconds: 12,
    targetUnits: 40,
    minUnits: 36,
    maxUnits: 42,
    status: 'planned',
    narrationBudgetSec: 10.2,
    visualHoldBudgetSec: 1.8,
    retentionDevice: '',
    transitionOut: ''
  };
  sections.splice(insertAt, 0, template);
  return rescaleOutline({ ...outline, sections }, budget);
}

export function removeOutlineSection(outline: ScriptOutline, sectionId: string, budget: DurationBudget): ScriptOutline {
  if (outline.sections.length <= 3) return outline;
  const target = outline.sections.find((item) => item.id === sectionId);
  if (target?.status === 'locked') return outline;
  const sections = outline.sections.filter((item) => item.id !== sectionId);
  return rescaleOutline({ ...outline, sections }, budget);
}

export function updateOutlineSection(
  outline: ScriptOutline,
  sectionId: string,
  updates: Partial<Pick<ScriptOutlineSection, 'title' | 'promise' | 'audienceQuestion' | 'bridgeFromPrevious' | 'bridgeToNext' | 'role' | 'retentionDevice' | 'transitionOut'>>
): ScriptOutline {
  return {
    ...outline,
    status: outline.status === 'confirmed' ? 'stale' : outline.status,
    sections: outline.sections.map((section) => {
      if (section.id !== sectionId) return section;
      const nextStatus = section.status === 'ready' ? 'needs-revision' : section.status;
      return { ...section, ...updates, status: section.status === 'locked' ? 'locked' : nextStatus };
    })
  };
}

export function fillRatioOk(used: number, budget: DurationBudget): boolean {
  if (budget.durationMode === 'content-driven') return true;
  const { minUnits, maxUnits } = lengthBudgetOf(budget);
  return used >= minUnits && used <= maxUnits;
}

export { FILL_RATIO_MIN, FILL_RATIO_MAX };
