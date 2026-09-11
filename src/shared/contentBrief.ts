import { z } from 'zod';
import { MAX_VIDEO_SECONDS } from '../utils/scriptDuration';

export const durationPresetSchema = z.enum(['insight', 'deep_dive', 'tutorial']);
export const scriptPaceSchema = z.enum(['ultrafast', 'fast', 'medium', 'slow', 'cinematic']);
/** Lockable brief fields. `writingStyleId` joined the lock set in Phase 7. */
export const contentBriefFields = ['topic', 'audience', 'objective', 'viewerPromise', 'contentType', 'mustCover', 'mustAvoid', 'writingStyleId'] as const;
const text = z.string().trim().min(1);
export const contentBriefDraftSchema = z.object({
  topic: z.string(),
  audience: z.object({ roles: z.array(z.string()), knowledgeLevel: z.enum(['beginner', 'intermediate', 'advanced']), primaryNeed: z.string() }).strict(),
  objective: z.string(),
  viewerPromise: z.string(),
  contentType: z.enum(['analysis', 'tutorial', 'commentary', 'story']),
  mustCover: z.array(z.string()),
  mustAvoid: z.array(z.string()),
  /** Selected writing style archive; absent = no style constraints (Phase 6 behaviour, byte-identical). */
  writingStyleId: z.string().trim().min(1).optional(),
  lockedFields: z.array(z.enum(contentBriefFields))
}).strict();
export const contentBriefSchema = contentBriefDraftSchema.extend({
  topic: text, viewerPromise: text, objective: text,
  audience: z.object({ roles: z.array(text).min(1), knowledgeLevel: z.enum(['beginner', 'intermediate', 'advanced']), primaryNeed: text }).strict(),
  mustCover: z.array(text), mustAvoid: z.array(text)
}).strict();
export const durationSpecSchema = z.object({
  preset: durationPresetSchema,
  targetSeconds: z.number().positive().max(MAX_VIDEO_SECONDS),
  minSeconds: z.number().positive().max(MAX_VIDEO_SECONDS),
  maxSeconds: z.number().positive().max(MAX_VIDEO_SECONDS),
  pace: scriptPaceSchema,
  narrationRatio: z.number().positive().max(1)
}).strict().refine(s => s.minSeconds <= s.targetSeconds && s.targetSeconds <= s.maxSeconds, { message: '需满足 min ≤ target ≤ max', path: ['targetSeconds'] });
export const outlineSectionSchema = z.object({ id: z.string(), order: z.number(), title: z.string(), role: z.string(), audienceQuestion: z.string(), promise: z.string(), evidenceIds: z.array(z.string()), bridgeFromPrevious: z.string(), bridgeToNext: z.string(), targetSeconds: z.number(), targetUnits: z.number(), minUnits: z.number(), maxUnits: z.number(), status: z.enum(['planned','drafting','ready','locked','needs-revision','failed']), narrationBudgetSec: z.number().nonnegative(), visualHoldBudgetSec: z.number().nonnegative(), retentionDevice: z.string(), transitionOut: z.string() }).strict();
export const outlineSchema = z.object({ status: z.enum(['draft','confirmed','stale']), version: z.number(), oneSentenceThesis: z.string(), sections: z.array(outlineSectionSchema).min(1), confirmedAt: z.number().optional() }).strict();

export const DURATION_PRESETS = {
  insight: { label: '观点解析', minSeconds: 300, targetSeconds: 420, maxSeconds: 480 },
  deep_dive: { label: '深度剖析', minSeconds: 600, targetSeconds: 750, maxSeconds: 900 },
  tutorial: { label: '完整教程', minSeconds: 900, targetSeconds: 1200, maxSeconds: 1500 }
} as const;
