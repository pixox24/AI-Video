import type { Express } from 'express';
import { z } from 'zod';
import { contentBriefDraftSchema, contentBriefSchema, durationSpecSchema } from '../../src/shared/contentBrief';
import { preserveBriefLocks } from '../../src/utils/contentBrief';
import { generateStructured } from '../llm/gateway';
import { promptHash } from '../llm/runs';

const requestSchema = z.object({
  input: z.string().trim().min(1).max(20000),
  contentBrief: contentBriefDraftSchema.optional(),
  durationSpec: durationSpecSchema.optional(),
  scriptLanguage: z.enum(['zh', 'en']).optional(),
  projectId: z.string().optional(),
  llmApi: z.object({ enabled: z.boolean().optional(), provider: z.string().optional(), endpoint: z.string().optional(), apiKey: z.string().optional(), model: z.string().optional() }).strict().optional()
}).strict();

export function registerBriefRoutes(app: Express): void {
  app.post('/api/script/brief', async (req, res) => {
    const parsed = requestSchema.safeParse(req.body as unknown);
    if (!parsed.success) { res.status(400).json({ ok: false, code: 'invalid_request', issues: parsed.error.issues }); return; }
    const { llmApi, ...input } = parsed.data;
    const system = '你是长视频策划。根据输入生成观众承诺：看完能带走什么。不要伪造事实。保留用户锁定字段，只输出指定 JSON。';
    const user = JSON.stringify(input);
    try {
      const result = await generateStructured({ stage: 'brief', role: 'planner', schema: contentBriefSchema, system, user,
        clientLlmApi: llmApi, projectId: input.projectId,
        idempotencyKey: `brief:${promptHash(user, JSON.stringify(llmApi || {}))}` });
      if (!result.data) { res.status(503).json({ ok: false, code: 'llm_response_invalid', error: result.reason }); return; }
      const brief = contentBriefSchema.safeParse(preserveBriefLocks(input.contentBrief, result.data));
      if (!brief.success) { res.status(409).json({ ok: false, code: 'locked_brief_invalid', issues: brief.error.issues }); return; }
      res.json({ ok: true, contentBrief: brief.data, run: result.run });
    } catch (error: unknown) {
      res.status(503).json({ ok: false, code: 'brief_generation_failed', error: error instanceof Error ? error.message : '生成失败' });
    }
  });
}
