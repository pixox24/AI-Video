import { z } from 'zod';
import { MAX_VIDEO_SECONDS } from '../utils/scriptDuration';

export const durationPresetSchema = z.enum(['insight', 'deep_dive', 'tutorial']);
export const scriptPaceSchema = z.enum(['ultrafast', 'fast', 'medium', 'slow', 'cinematic']);
export const contentBriefFields = ['topic', 'audience', 'objective', 'viewerPromise', 'contentType', 'mustCover', 'mustAvoid'] as const;
const text = z.string().trim().min(1);
export const contentBriefDraftSchema = z.object({
  topic: z.string(),
  audience: z.object({ roles: z.array(z.string()), knowledgeLevel: z.enum(['beginner', 'intermediate', 'advanced']), primaryNeed: z.string() }).strict(),
  objective: z.string(),
  viewerPromise: z.string(),
  contentType: z.enum(['analysis', 'tutorial', 'commentary', 'story']),
  mustCover: z.array(z.string()),
  mustAvoid: z.array(z.string()),
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

export const DURATION_PRESETS = {
  insight: { label: '观点解析', minSeconds: 300, targetSeconds: 420, maxSeconds: 480 },
  deep_dive: { label: '深度剖析', minSeconds: 600, targetSeconds: 750, maxSeconds: 900 },
  tutorial: { label: '完整教程', minSeconds: 900, targetSeconds: 1200, maxSeconds: 1500 }
} as const;
