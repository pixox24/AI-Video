import { z } from 'zod';
import { scriptPaceSchema } from './contentBrief';

export const calibrationSectionSchema = z.object({ id: z.string().min(1), narration: z.string() }).strict();
export const calibrationInputSchema = z.object({
  projectId: z.string().min(1), provider: z.string().min(1), voice: z.string().min(1), pace: scriptPaceSchema,
  language: z.enum(['zh', 'en']), speechRate: z.number().positive().max(4),
  sections: z.array(calibrationSectionSchema).min(1),
  track: z.object({ sourceHash: z.string().min(1), generatedAt: z.number().positive(), duration: z.number().positive(),
    alignment: z.object({ version: z.literal(2), source: z.enum(['per-utterance', 'word-boundary', 'energy', 'char-fallback']),
      utterances: z.array(z.object({ text: z.string(), audioStart: z.number().nonnegative(), audioEnd: z.number().positive(),
        source: z.enum(['per-utterance', 'word-boundary', 'energy', 'char-fallback']) }).strict()).min(1)
    }).strict()
  }).strict().optional()
}).strict().refine(i => new Set(i.sections.map(s => s.id)).size === i.sections.length, 'Duplicate section IDs');
export type CalibrationInput = z.infer<typeof calibrationInputSchema>;
export const calibrationResultSchema = z.object({
  sections: z.array(z.object({ sectionId: z.string(), estimatedSec: z.number().nonnegative(), actualSec: z.number().positive().optional() }).strict()),
  estimatedSec: z.number().nonnegative(), actualSec: z.number().positive().optional(),
  sampleCount: z.number().int().nonnegative(), rateScale: z.number().positive(), recorded: z.boolean()
}).strict();
export type CalibrationResult = z.infer<typeof calibrationResultSchema>;
