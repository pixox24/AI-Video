import type { RequestHandler } from 'express';
import { z } from 'zod';
import { contentBriefDraftSchema, durationSpecSchema } from '../../src/shared/contentBrief';
import { applyDurationSpec, durationSpecForm } from '../duration/engine';
import { buildDurationBudget } from '../../src/utils/scriptBudget';

/** Validate only the new opt-in envelope; preserve legacy ScriptBrief and endpoint responses. */
export const validateContentInput: RequestHandler = (req, res, next) => {
  const record = z.record(z.string(), z.unknown()).safeParse(req.body);
  if (!record.success) { next(); return; }
  const body = record.data;
  if (body.contentBrief === undefined && body.durationSpec === undefined) { next(); return; }
  const parsed = z.object({ contentBrief: contentBriefDraftSchema, durationSpec: durationSpecSchema.optional() }).safeParse(body);
  if (!parsed.success) { res.status(400).json({ ok: false, code: 'invalid_content_input', issues: parsed.error.issues }); return; }
  if (!parsed.data.contentBrief.viewerPromise.trim()) { res.status(409).json({ ok: false, code: 'viewer_promise_required', error: '请先填写观众承诺。' }); return; }
  if (parsed.data.durationSpec) {
    const old = z.object({ scriptLanguage: z.enum(['zh', 'en']).optional(), speechRate: z.number().optional(), usedChars: z.number().optional(), platform: z.enum(['douyin', 'shipinhao', 'reels', 'bilibili', 'youtube']).optional() }).safeParse(body.budget || {});
    const budget = buildDurationBudget({ ...(old.success ? old.data : {}), targetSeconds: parsed.data.durationSpec.targetSeconds, pace: parsed.data.durationSpec.pace });
    req.body = { ...body, budget: applyDurationSpec(budget, parsed.data.durationSpec), scriptFormOverride: durationSpecForm(parsed.data.durationSpec) };
  }
  next();
};
