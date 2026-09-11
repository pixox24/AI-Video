import type { Claim, QualityIssue, QualityReport, ScriptSection, ScriptRevisionAction } from '../../src/types';
import { evaluatorSchema, type QualityInput } from '../../src/shared/quality';
import { emptyScriptBrief } from '../../src/utils/scriptOutline';
import { splitCompleteSentences } from '../../src/utils/speechSpans';
import { fnv1a64Hex } from '../../src/utils/scriptEntity';
import { assessProjectDuration, assessSectionDuration } from '../duration/engine';
import { generateStructured } from '../llm/gateway';
import { QUALITY_SYSTEM } from '../llm/prompts/quality';
import { executeSectionRevision } from './section-revise';

export function sectionIsLocked(input: QualityInput, sectionId: string): boolean {
  return input.sections.some(s => s.id === sectionId && s.status === 'locked') || input.outline.sections.some(s => s.id === sectionId && s.status === 'locked');
}

/** Risk flags are source requirements, not assertions that a sentence is false. */
export function groundedClaims(input: QualityInput, modelClaims: Claim[]): Claim[] {
  const candidates = [...modelClaims];
  for (const section of input.sections) {
    for (const text of splitCompleteSentences(section.narration, input.scriptLanguage, { keepShort: true })) {
      if (/\d+(?:\.\d+)?\s*(?:%|％|倍|元|美元|million|billion)|百分之|研究表明|研究证明|政策规定|已经倒闭|studies show|research proves|bankrupt/i.test(text)) {
        candidates.push({ id: '', sectionId: section.id, text, kind: 'fact', risk: 'high', needsSource: true });
      }
    }
  }
  const unique = new Map<string, Claim>();
  for (const claim of candidates) {
    const section = input.sections.find(s => s.id === claim.sectionId);
    if (!section?.narration.includes(claim.text)) continue;
    const key = `${section.id}:${claim.text}`;
    const saved = input.claims.find(c => c.sectionId === section.id && c.text === claim.text);
    const evidence = input.brief?.evidence.find(e => e.confidence !== 'unverified' && e.source && e.claim.includes(claim.text));
    const sourceUrl = saved?.sourceUrl?.trim();
    const sourceNote = saved?.sourceNote?.trim() || evidence?.source;
    const sourced = Boolean((sourceUrl && /^https?:\/\//i.test(sourceUrl)) || sourceNote);
    unique.set(key, { ...claim, id: `claim-${fnv1a64Hex(key)}`, sourceUrl, sourceNote,
      needsSource: claim.kind === 'fact' ? !sourced : claim.needsSource && !sourced });
  }
  return [...unique.values()];
}

export async function evaluateQuality(input: QualityInput): Promise<QualityReport> {
  const pace = input.durationSpec?.pace || input.pace;
  const durations = input.sections.map(s => {
    const plan = input.outline.sections.find(p => p.id === s.id)!;
    return assessSectionDuration(s.id, s.narration, plan.minUnits, plan.maxUnits, input.scriptLanguage, pace);
  });
  const projectDuration = assessProjectDuration(input.sections, input.outline, input.scriptLanguage, pace, input.durationSpec);
  const { llmApi, repair: _repair, sectionIds: _sectionIds, ...context } = input;
  const result = await generateStructured({ stage: 'quality', role: 'evaluator', schema: evaluatorSchema,
    clientLlmApi: llmApi, projectId: input.projectId, system: QUALITY_SYSTEM, user: JSON.stringify({ ...context, durations, projectDuration }) });
  if (!result.data) throw new Error(result.reason || '质量评估器未返回有效结果');
  const claims = groundedClaims(input, result.data.claims);
  const issues: QualityIssue[] = result.data.issues.filter(issue => !issue.sectionId || input.sections.some(s => s.id === issue.sectionId));
  // ponytail: chapter deviations are display-only; a global budget warning cannot trigger automatic padding.
  if (projectDuration.complete && projectDuration.verdict !== 'in_range') {
    issues.push({ severity: 'medium', kind: 'duration',
      message: `全文预计口播 ${projectDuration.estimatedSec.toFixed(1)} 秒，参考范围 ${projectDuration.minSec.toFixed(1)}–${projectDuration.maxSec.toFixed(1)} 秒（${projectDuration.verdict}）`,
      suggestedFix: projectDuration.verdict === 'too_short'
        ? '先检查章节任务是否完整；只补充有依据的内容缺口。若已讲清，请接受较短时长或补充材料，不强行凑字。'
        : '结合具体质量问题删去重复和冗余；必要论证应保留，也可调整目标时长。' });
  }
  for (const claim of claims.filter(c => c.kind === 'fact' && c.needsSource)) {
    issues.push({ sectionId: claim.sectionId, severity: claim.risk === 'high' ? 'high' : 'medium', kind: 'fact_risk',
      message: `待核实事实：${claim.text}`, suggestedFix: `没有可靠来源时删去或明确限定这条事实，不得编造出处：${claim.text}` });
  }
  const verdict = projectDuration.verdict;
  return { id: result.run.id, stage: 'quality', createdAt: result.run.createdAt, issues, claims, durations, verdict, projectDuration };
}

/** Group all issues for a chapter into one existing revision action. No global rewrite action. */
export function qualityRevisionActions(input: QualityInput, report: QualityReport): ScriptRevisionAction[] {
  const groups = new Map<string, QualityIssue[]>();
  for (const issue of report.issues) {
    if (!issue.sectionId || sectionIsLocked(input, issue.sectionId) || (input.sectionIds && !input.sectionIds.includes(issue.sectionId))) continue;
    groups.set(issue.sectionId, [...(groups.get(issue.sectionId) || []), issue]);
  }
  return [...groups].map(([sectionId, issues]) => ({
    sectionId,
    action: 'replace-transition' as const,
    targetDeltaUnits: 0,
    instruction: `按以下具体内容问题修订，不以章节字数是否达标决定扩写或压缩。资料不足时不编造，可保留有依据的正文。\n${issues.map(i => `[${i.kind}] ${i.suggestedFix}`).join('\n')}`
  }));
}

export async function runQualityLoop(input: QualityInput) {
  let sections: ScriptSection[] = structuredClone(input.sections);
  let report = await evaluateQuality({ ...input, sections });
  const history = [report];
  const failures: { sectionId: string; status: number; error: string }[] = [];
  let rounds = 0;
  let stoppedReason: 'checked' | 'resolved' | 'round_limit' | 'no_editable_issues' | 'revision_failed' = 'checked';
  if (input.repair) {
    // A constant server-side bound. Clients cannot provide or reset a round counter inside a run.
    for (let round = 0; round < 2; round++) {
      const actions = qualityRevisionActions({ ...input, sections }, report);
      if (!actions.length) { stoppedReason = report.issues.length ? 'no_editable_issues' : 'resolved'; break; }
      rounds++;
      for (const action of actions) {
        const result = await executeSectionRevision({ sections, action, planned: input.outline.sections.find(s => s.id === action.sectionId),
          language: input.scriptLanguage, brief: input.brief || emptyScriptBrief(), targetSeconds: input.durationSpec?.targetSeconds || 300,
          llmApi: input.llmApi, strict: true, projectId: input.projectId });
        if (result.status !== 200) failures.push({ sectionId: action.sectionId, status: result.status, error: result.error || '修订失败' });
        else sections = result.sections;
      }
      report = await evaluateQuality({ ...input, sections }); history.push(report);
      if (failures.length) { stoppedReason = 'revision_failed'; break; }
      if (!qualityRevisionActions({ ...input, sections }, report).length) { stoppedReason = report.issues.length ? 'no_editable_issues' : 'resolved'; break; }
      stoppedReason = 'round_limit';
    }
  }
  return { ok: failures.length === 0, report, sections, rounds, history, stoppedReason, failures };
}
