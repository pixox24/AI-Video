import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CalibrationInput, CalibrationResult } from '../../src/shared/calibration';
import { estimateNarrationSeconds, measuredSpeechSeconds } from './engine';

export const CALIBRATION_WINDOW = 20;
const sampleSchema = z.object({ id: z.string(), scale: z.number().positive(), estimates: z.array(z.number().nonnegative()) }).strict();
const bucketSchema = z.object({ samples: z.array(sampleSchema).max(CALIBRATION_WINDOW),
  seen: z.record(z.string(), z.array(z.number().nonnegative())).default({}) }).strict();
export const rateTableSchema = z.object({ version: z.literal(1), buckets: z.record(z.string(), bucketSchema) }).strict();
export type RateTable = z.infer<typeof rateTableSchema>;
export function bucketKey(input: Pick<CalibrationInput, 'provider' | 'voice' | 'pace'>): string {
  return JSON.stringify([input.provider, input.voice, input.pace]);
}
export function averageScale(samples: { scale: number }[]): number {
  return samples.length ? samples.reduce((sum, sample) => sum + sample.scale, 0) / samples.length : 1;
}
export function alignmentMeasurements(input: CalibrationInput): Map<string, number> {
  const result = new Map<string, number>();
  const track = input.track;
  if (!track || track.alignment.source === 'char-fallback') return result;
  const compact = (text: string) => text.replace(/[\s\p{P}\p{S}]/gu, '');
  const utterances = track.alignment.utterances;
  if (utterances.some((u, i) => u.source === 'char-fallback' || u.audioEnd <= u.audioStart || u.audioEnd > track.duration + 0.01 || (i > 0 && u.audioStart < utterances[i - 1].audioEnd))) return result;
  if (input.sections.map(s => compact(s.narration)).join('') !== utterances.map(u => compact(u.text)).join('')) return result;
  // Only exact utterance boundaries qualify. Never prorate an utterance into invented measurements.
  let cursor = 0;
  for (const section of input.sections) {
    const target = compact(section.narration);
    let text = ''; const spans: typeof utterances = [];
    while (cursor < utterances.length && text.length < target.length) {
      const utterance = utterances[cursor++]; text += compact(utterance.text); spans.push(utterance);
    }
    if (!target || text !== target) return new Map();
    result.set(section.id, measuredSpeechSeconds(spans));
  }
  return result;
}
export function calibrate(input: CalibrationInput, table: RateTable): { table: RateTable; result: CalibrationResult } {
  const key = bucketKey(input);
  const samples = table.buckets[key]?.samples || [];
  const scale = averageScale(samples);
  const actual = alignmentMeasurements(input);
  const id = createHash('sha256').update(JSON.stringify([input.projectId, input.track?.sourceHash, input.track?.generatedAt, input.language, input.speechRate, input.sections])).digest('hex');
  const priorEstimates = table.buckets[key]?.seen[id] ?? samples.find(s => s.id === id)?.estimates;
  const sections = input.sections.map((s, index) => ({ sectionId: s.id,
    estimatedSec: priorEstimates?.[index] ?? estimateNarrationSeconds(s.narration, input.language, input.pace, scale, input.speechRate),
    ...(actual.has(s.id) ? { actualSec: actual.get(s.id)! } : {}) }));
  const actualSec = actual.size === input.sections.length ? [...actual.values()].reduce((sum, sec) => sum + sec, 0) : undefined;
  let next = table; let recorded = false;
  if (actualSec && !priorEstimates) {
    // Normalize by baseline language rate and TTS speed so a bucket never averages chars and words directly.
    const baseline = input.sections.reduce((sum, s) => sum + estimateNarrationSeconds(s.narration, input.language, input.pace, 1, input.speechRate), 0);
    if (baseline > 0) {
      const estimates = sections.map(s => s.estimatedSec);
      next = { ...table, buckets: { ...table.buckets, [key]: {
        samples: [...samples, { id, scale: baseline / actualSec, estimates }].slice(-CALIBRATION_WINDOW),
        seen: { ...Object.fromEntries(samples.map(s => [s.id, s.estimates])), ...table.buckets[key]?.seen, [id]: estimates }
      } } };
      recorded = true;
    }
  }
  return { table: next, result: { sections, estimatedSec: sections.reduce((sum, s) => sum + s.estimatedSec, 0), actualSec,
    rateScale: scale, sampleCount: next.buckets[key]?.samples.length || 0, recorded } };
}
/** Synchronous read/modify/atomic rename prevents lost updates within the Express process. */
export function recordCalibration(input: CalibrationInput, filename = path.resolve('data/rate-table.json')): CalibrationResult {
  const table = fs.existsSync(filename) ? rateTableSchema.parse(JSON.parse(fs.readFileSync(filename, 'utf8'))) : { version: 1 as const, buckets: {} };
  const next = calibrate(input, table);
  if (next.result.recorded) {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename + '.tmp', JSON.stringify(next.table, null, 2));
    fs.renameSync(filename + '.tmp', filename);
  }
  return next.result;
}
