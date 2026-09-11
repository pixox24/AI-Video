import { BEAT_FUNCTIONS, BEAT_ENERGIES, normalizeBeatEnergy } from '../utils/scriptSections';
import { z } from 'zod';
import { contentBriefDraftSchema, durationSpecSchema, scriptPaceSchema } from './contentBrief';
import { writingStyleProfileSchema } from './writingStyle';

export const claimSchema = z.object({
  id: z.string(), sectionId: z.string(), text: z.string().min(1),
  kind: z.enum(['fact', 'opinion', 'prediction']), risk: z.enum(['low', 'high']), needsSource: z.boolean(),
  sourceUrl: z.string().optional(), sourceNote: z.string().optional()
}).strict();
export const qualityIssueSchema = z.object({ sectionId: z.string().optional(), severity: z.enum(['high', 'medium', 'low']),
  kind: z.enum(['architecture', 'duration', 'fact_risk', 'pacing', 'style']), message: z.string().min(1), suggestedFix: z.string().min(1)
}).strict();
export const evaluatorSchema = z.object({ issues: z.array(qualityIssueSchema), claims: z.array(claimSchema) }).strict();
export const sectionStatusSchema = z.enum(['planned', 'drafting', 'ready', 'locked', 'needs-revision', 'failed']);
const role = z.enum(['hook', 'setup', 'body', 'turn', 'proof', 'reveal', 'cta']);
export const beatSchema = z.object({ id: z.string(), order: z.number(), function: z.enum(BEAT_FUNCTIONS),
  intent: z.string(), narration: z.string(), targetSeconds: z.number(), energy: z.enum(BEAT_ENERGIES),
  visualIntent: z.string(), needsHold: z.boolean(), sectionId: z.string().optional() }).strict();
export const scriptSectionSchema = z.object({ id: z.string().min(1), order: z.number(), role, title: z.string(), outline: z.string().optional(),
  actualSec: z.number().positive().optional(), beatLabelWarnings: z.array(z.string()).optional(),
  targetSeconds: z.number().nonnegative(), minUnits: z.number().nonnegative(), maxUnits: z.number().nonnegative(),
  narration: z.string(), beats: z.array(beatSchema), status: sectionStatusSchema.optional(), usedEvidenceIds: z.array(z.string()).optional(),
  audienceQuestion: z.string().optional(), promise: z.string().optional() }).strict();
export const qualityOutlineSchema = z.object({ status: z.enum(['draft', 'confirmed', 'stale']), version: z.number(), oneSentenceThesis: z.string(), confirmedAt: z.number().optional(),
  sections: z.array(z.object({ id: z.string(), order: z.number(), title: z.string(), role,
    audienceQuestion: z.string(), promise: z.string(), evidenceIds: z.array(z.string()), bridgeFromPrevious: z.string(), bridgeToNext: z.string(),
    targetSeconds: z.number().nonnegative(), targetUnits: z.number().nonnegative(), minUnits: z.number().nonnegative(), maxUnits: z.number().nonnegative(), status: sectionStatusSchema,
    narrationBudgetSec: z.number().nonnegative().optional(), visualHoldBudgetSec: z.number().nonnegative().optional(), retentionDevice: z.string().optional(), transitionOut: z.string().optional()
  }).strict()).min(1)
}).strict();
// Accept legacy pace metadata at the input boundary; all content fields remain strict.
const qualityInputSectionSchema = scriptSectionSchema.extend({
  beats: z.array(beatSchema.extend({ energy: z.unknown().optional() }))
}).transform(section => {
  const warnings = [...(section.beatLabelWarnings || [])];
  const beats = section.beats.map((beat, index) => {
    const normalized = normalizeBeatEnergy(beat.energy);
    if (normalized.warning) warnings.push(`第 ${section.order} 章第 ${index + 1} 个节拍：${normalized.warning}`);
    return { ...beat, energy: normalized.energy };
  });
  return { ...section, beats, ...(warnings.length ? { beatLabelWarnings: [...new Set(warnings)] } : {}) };
});

export const qualityRequestSchema = z.object({
  sections: z.array(qualityInputSectionSchema).min(1), outline: qualityOutlineSchema,
  scriptLanguage: z.enum(['zh', 'en']).default('zh'), pace: scriptPaceSchema.default('medium'),
  contentBrief: contentBriefDraftSchema.optional(), durationSpec: durationSpecSchema.optional(),
  /** Phase 7: selected writing style archive. Absent = style checking is skipped entirely. */
  writingStyleId: z.string().trim().min(1).optional(),
  /** Phase 7: project-scoped custom archives so a custom id resolves server-side. */
  writingStyles: z.array(writingStyleProfileSchema).optional(),
  brief: z.object({ audience: z.string(), coreQuestion: z.string(), coreConclusion: z.string(),
    evidence: z.array(z.object({ id: z.string(), claim: z.string(), source: z.string().optional(), confidence: z.enum(['user', 'researched', 'unverified']) }).strict()),
    forbiddenClaims: z.array(z.string()), requiredTerms: z.array(z.string()), callToAction: z.string().optional() }).strict().optional(),
  claims: z.array(claimSchema).default([]),
  /** Phase 7: style findings the caller already holds, fed into the style-repair revision prompt. */
  styleFindings: z.array(qualityIssueSchema).optional(),
  llmApi: z.object({ enabled: z.boolean().optional(), provider: z.string().optional(), endpoint: z.string().optional(), apiKey: z.string().optional(), model: z.string().optional() }).strict().optional(),
  repair: z.boolean().default(false), sectionIds: z.array(z.string()).optional(), projectId: z.string().optional()
}).strict().superRefine((input, ctx) => {
  const ids = input.sections.map(s => s.id);
  const plans = input.outline.sections.map(s => s.id);
  if (new Set(ids).size !== ids.length || new Set(plans).size !== plans.length || ids.some(id => !plans.includes(id))) ctx.addIssue({ code: 'custom', message: '章节 ID 必须唯一且存在于大纲' });
  if (input.sectionIds?.some(id => !ids.includes(id))) ctx.addIssue({ code: 'custom', message: '未知修复章节' });
  if (input.outline.sections.some(s => s.minUnits > s.maxUnits)) ctx.addIssue({ code: 'custom', message: '章节字数区间无效' });
});
export type QualityInput = z.infer<typeof qualityRequestSchema>;
export function qualityInputKey(input: unknown): string {
  const parsed = qualityRequestSchema.safeParse(input);
  if (!parsed.success) return '';
  const { llmApi, repair, sectionIds, styleFindings: _styleFindings, ...content } = parsed.data;
  return JSON.stringify(content);
}
export const durationAssessmentSchema = z.object({ sectionId: z.string(), estimatedSec: z.number(), minSec: z.number(), maxSec: z.number(), verdict: z.enum(['too_short', 'in_range', 'too_long']) }).strict();
export const qualityReportSchema = z.object({ id: z.string(), stage: z.literal('quality'), issues: z.array(qualityIssueSchema), claims: z.array(claimSchema), createdAt: z.string(),
  projectDuration: durationAssessmentSchema.omit({ sectionId: true }).extend({ complete: z.boolean() }).optional(),
  durations: z.array(durationAssessmentSchema), verdict: z.enum(['too_short', 'in_range', 'too_long']) }).strict();
export const qualityResponseSchema = z.object({ ok: z.boolean(), report: qualityReportSchema, sections: z.array(scriptSectionSchema), rounds: z.number().int().min(0).max(2),
  history: z.array(qualityReportSchema), stoppedReason: z.enum(['checked', 'resolved', 'round_limit', 'no_editable_issues', 'revision_failed']),
  failures: z.array(z.object({ sectionId: z.string(), status: z.number(), error: z.string() }).strict()) }).strict();

export function qualityFailureMessage(status: number, data: unknown): string {
  if (status === 409) return '锁定章节不能修订（409）。';
  const failure = z.object({ error: z.string().optional(), issues: z.array(z.object({
    path: z.array(z.union([z.string(), z.number()])), message: z.string()
  })).optional() }).safeParse(data);
  const details = failure.success ? failure.data : undefined;
  if (status === 400 && details?.issues?.length) {
    const paths = details.issues.slice(0, 3).map(issue => issue.path.join('.') || '请求内容').join('、');
    return `质量检查输入格式不正确（400）：${paths}，共 ${details.issues.length} 处。请更新代码并刷新；若仍失败，请反馈这些字段。`;
  }
  return `质量检查失败（${status}）：${details?.error?.slice(0, 600) || '服务未返回具体原因，请检查服务日志或网络连接。'}`;
}
