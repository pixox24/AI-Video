import type { Express } from 'express';
import { qualityRequestSchema, qualityResponseSchema } from '../../src/shared/quality';
import { runQualityLoop, sectionIsLocked } from '../pipeline/quality';

export function registerQualityRoutes(app: Express): void {
  app.post('/api/script/quality-check', async (req, res) => {
    const parsed = qualityRequestSchema.safeParse(req.body as unknown);
    if (!parsed.success) { res.status(400).json({ ok: false, code: 'quality_input_invalid', issues: parsed.error.issues }); return; }
    const input = parsed.data;
    if (input.repair && input.sectionIds?.some(id => sectionIsLocked(input, id))) {
      res.status(409).json({ ok: false, code: 'draft_contract_failed', error: '锁定章节不会被自动回修。', sections: input.sections }); return;
    }
    try { res.json(qualityResponseSchema.parse(await runQualityLoop(input))); }
    catch (error: unknown) { res.status(503).json({ ok: false, code: 'quality_failed', error: error instanceof Error ? error.message : '质量检查失败', sections: input.sections }); }
  });
}
