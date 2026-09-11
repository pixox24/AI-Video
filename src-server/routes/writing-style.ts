import type { Express } from 'express';
import { z } from 'zod';
import {
  BUILTIN_WRITING_STYLES,
  BASE_BANNED_PATTERNS,
  findWritingStyleProfile,
  writingStyleProfileSchema,
  type WritingStyleProfile
} from '../../src/shared/writingStyle';
import { generateStructured } from '../llm/gateway';
import { errorMessage, requestBody } from '../loose';
import {
  STYLE_INFER_SYSTEM,
  materializeStyleInferDraft,
  styleInferModelSchema,
  styleInferUserPrompt,
  type StyleInferDraft
} from '../style/writingStyle';

/** Inducted from the user's own samples; the client owns the project-scoped archive list. */
export const customProfileInputSchema = writingStyleProfileSchema.omit({ id: true, kind: true }).extend({
  samples: z.array(z.string().trim().min(1)).max(3).optional()
}).strict();

export const writingStyleListSchema = z.object({
  ok: z.literal(true),
  builtin: z.array(writingStyleProfileSchema)
}).strict();

export const styleInferBodySchema = z.object({
  samples: z.array(z.string().trim().min(1)).min(1).max(3),
  label: z.string().trim().min(1).max(24).optional(),
  description: z.string().trim().min(1).max(160).optional(),
  counterExemplar: z.string().trim().min(1).max(600).optional(),
  llmApi: z.object({ enabled: z.boolean().optional(), provider: z.string().optional(), endpoint: z.string().optional(), apiKey: z.string().optional(), model: z.string().optional() }).strict().optional(),
  projectId: z.string().optional()
}).strict();

export const inferDraftSchema = z.object({
  label: z.string(), description: z.string(), rules: z.array(z.string()), bannedPatterns: z.array(z.string()),
  exemplar: z.string(), counterExemplar: z.string()
}).strict();

export const inferResponseSchema = z.object({ ok: z.literal(true), draft: inferDraftSchema, sampleCount: z.number().int().min(1).max(3) }).strict();
export const saveResponseSchema = z.object({ ok: z.literal(true), profile: writingStyleProfileSchema }).strict();

/** Minimum content per sample so the model cannot "induct" a style from a stub. */
const MIN_SAMPLE_UNITS = 40;

export function inferSamplesProblem(samples: string[]): string | null {
  const clean = samples.map(sample => String(sample).trim()).filter(Boolean);
  if (clean.length < 2) return '请至少粘贴 2 篇样例文案。';
  if (clean.length > 3) return '最多 3 篇样例文案。';
  if (clean.some(sample => sample.length < MIN_SAMPLE_UNITS)) return `每篇样例至少 ${MIN_SAMPLE_UNITS} 字，否则无法归纳出可执行规则。`;
  return null;
}

/** The exemplar must be a verbatim excerpt of the submitted samples, never model-written prose. */
export function exemplarIsVerbatim(exemplar: string, samples: string[]): boolean {
  const needle = String(exemplar || '').trim();
  if (!needle) return false;
  return samples.some(sample => String(sample).includes(needle));
}

export function customStyleId(now = Date.now()): string {
  return `custom-${now}`;
}

export function customStyleIdFor(profile: WritingStyleProfile | undefined): string | null {
  const id = String(profile?.id || '').trim();
  return id.startsWith('custom-') ? id : null;
}

export function registerWritingStyleRoutes(app: Express): void {
  app.get('/api/writing-styles', (_req, res) => {
    res.json(writingStyleListSchema.parse({ ok: true, builtin: BUILTIN_WRITING_STYLES }));
  });

  app.post('/api/writing-styles/infer', async (req, res) => {
    const parsed = styleInferBodySchema.safeParse(req.body as unknown);
    if (!parsed.success) { res.status(400).json({ ok: false, code: 'writing_style_input_invalid', issues: parsed.error.issues }); return; }
    const body = parsed.data;
    const problem = inferSamplesProblem(body.samples);
    if (problem) { res.status(400).json({ ok: false, code: 'writing_style_samples_invalid', error: problem }); return; }
    const input = { samples: body.samples.map(sample => sample.trim()), label: body.label, description: body.description, counterExemplar: body.counterExemplar };
    try {
      const result = await generateStructured({ stage: 'writing_style_infer', role: 'planner', schema: styleInferModelSchema,
        clientLlmApi: body.llmApi, projectId: body.projectId, temperature: 0.3,
        system: STYLE_INFER_SYSTEM, user: styleInferUserPrompt(input, [...BASE_BANNED_PATTERNS]) });
      if (!result.data) { res.status(503).json({ ok: false, code: 'writing_style_infer_failed', error: result.reason || '反推未返回可用结果' }); return; }
      const draft: StyleInferDraft | null = materializeStyleInferDraft(input, result.data);
      if (!draft || !exemplarIsVerbatim(draft.exemplar, input.samples)) {
        res.status(422).json({ ok: false, code: 'writing_style_exemplar_not_from_samples', error: '反推范例不是用户样例原文片段，请重试或换样例。' });
        return;
      }
      res.json(inferResponseSchema.parse({ ok: true, draft, sampleCount: input.samples.length }));
    } catch (error: unknown) {
      res.status(503).json({ ok: false, code: 'writing_style_infer_failed', error: errorMessage(error) || '反推失败' });
    }
  });

  app.post('/api/writing-styles', (req, res) => {
    const body = requestBody(req.body as unknown);
    const existing = Array.isArray(body.existing) ? body.existing.filter((item: unknown) => writingStyleProfileSchema.safeParse(item).success) as WritingStyleProfile[] : [];
    const id = customStyleIdFor(body.profile as WritingStyleProfile) || customStyleId();
    const lockedHit = existing.find(profile => profile.id === id && profile.locked);
    if (lockedHit) {
      res.status(409).json({ ok: false, code: 'writing_style_locked', error: `「${lockedHit.label}」已锁定，不能改动，请另存为新档案。` });
      return;
    }
    const parsed = customProfileInputSchema.safeParse(body.profile);
    if (!parsed.success) {
      res.status(400).json({ ok: false, code: 'writing_style_invalid', error: `自定义档案格式不正确：${parsed.error.issues.map(issue => issue.path.join('.') || '内容').join('、')}` });
      return;
    }
    const { samples: _samples, ...rest } = parsed.data;
    const profile = writingStyleProfileSchema.safeParse({ ...rest, id, kind: 'custom' });
    if (!profile.success) {
      res.status(400).json({ ok: false, code: 'writing_style_invalid', error: `自定义档案格式不正确：${profile.error.issues.map(issue => issue.path.join('.') || '内容').join('、')}` });
      return;
    }
    const samples = (parsed.data.samples || []).map(sample => sample.trim()).filter(Boolean);
    if (profile.data.derivedFromSamples && samples.length > 0 && !exemplarIsVerbatim(profile.data.exemplar, samples)) {
      res.status(422).json({ ok: false, code: 'writing_style_exemplar_not_from_samples', error: '范例必须来自你粘贴的样例原文。' });
      return;
    }
    res.json(saveResponseSchema.parse({ ok: true, profile: profile.data }));
  });
}

export { findWritingStyleProfile };
