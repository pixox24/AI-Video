import { z } from 'zod';
import { writingStyleProfileSchema } from './writingStyle';

/** Response schemas for the Phase 7 writing-style endpoints (client-side parsing). */
export const inferDraftSchema = z.object({
  label: z.string(), description: z.string(), rules: z.array(z.string()),
  bannedPatterns: z.array(z.string()), exemplar: z.string(), counterExemplar: z.string()
}).strict();

export const inferResponseSchema = z.object({
  ok: z.literal(true), draft: inferDraftSchema, sampleCount: z.number().int().min(1).max(3)
}).strict();

export const saveProfileSchema = writingStyleProfileSchema;
export const saveResponseSchema = z.object({ ok: z.literal(true), profile: saveProfileSchema }).strict();

export function writingStyleFailureMessage(status: number, data: unknown): string {
  const failure = z.object({ error: z.string().optional(), code: z.string().optional() }).safeParse(data);
  if (status === 409) return failure.success && failure.data.error ? failure.data.error : '该档案已锁定，不能改动。';
  if (status === 422) return failure.success && failure.data.error ? failure.data.error : '范例必须来自你粘贴的样例原文。';
  return (failure.success && failure.data.error) || `请求失败（${status}）`;
}
