import { ScriptLanguage, ScriptPace, ScriptPlatform } from '../types';

export const MIN_VIDEO_SECONDS = 8;
export const MAX_VIDEO_SECONDS = 1800;
export const LONG_FORM_SECONDS = 90;
export const FILL_RATIO_MIN = 0.9;
export const FILL_RATIO_MAX = 1.05;
export const TRANSLATE_BATCH_SIZE = 24;
export const SPAN_BATCH_SIZE = 20;
export const COVERAGE_BATCH_SIZE = 24;
export const LLM_JSON_MAX_TOKENS = 8192;
export const LLM_LONGFORM_MAX_TOKENS = 16384;
export const MAX_FORECAST_SHOTS = 240;

export const TARGET_SECONDS_PRESETS = [15, 21, 30, 45, 60, 90, 120, 180, 300, 600];

export interface ClampSecondsResult {
  seconds: number;
  clamped: boolean;
  warning?: string;
}

export function clampVideoSeconds(value: number, fallback = 30): ClampSecondsResult {
  const raw = Number(value);
  const source = Number.isFinite(raw) && raw > 0 ? raw : fallback;
  const seconds = Math.max(MIN_VIDEO_SECONDS, Math.min(MAX_VIDEO_SECONDS, source));
  const clamped = seconds !== source;
  return {
    seconds,
    clamped,
    warning: clamped
      ? source > MAX_VIDEO_SECONDS
        ? `时长超过上限，已限制为 ${MAX_VIDEO_SECONDS} 秒。`
        : `时长低于下限，已调整为 ${MIN_VIDEO_SECONDS} 秒。`
      : undefined
  };
}

export function isLongForm(seconds: number): boolean {
  return Number(seconds) >= LONG_FORM_SECONDS;
}

export function fillRatio(used: number, max: number): number {
  if (!(max > 0)) return 0;
  return used / max;
}

export function fillStatus(used: number, max: number): 'empty' | 'short' | 'ok' | 'over' {
  const ratio = fillRatio(used, max);
  if (used <= 0) return 'empty';
  if (ratio < FILL_RATIO_MIN) return 'short';
  if (ratio > FILL_RATIO_MAX) return 'over';
  return 'ok';
}

export function chunkItems<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size) || 1);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

export function conceptMaxForDuration(seconds: number): number {
  if (seconds <= 18) return 1;
  if (seconds <= 35) return 2;
  if (seconds <= 75) return 3;
  if (seconds <= 120) return 4;
  if (seconds <= 180) return 6;
  if (seconds <= 300) return 8;
  if (seconds <= 600) return 12;
  return 16;
}

export function maxForecastShotsForDuration(seconds: number): number {
  const estimate = Math.ceil(Math.max(MIN_VIDEO_SECONDS, seconds) / 0.8) + 4;
  return Math.min(MAX_FORECAST_SHOTS, Math.max(24, estimate));
}

export function maxUniqueScenesForDuration(seconds: number): number {
  return Math.min(80, Math.max(4, Math.ceil(Math.max(MIN_VIDEO_SECONDS, seconds) / 12)));
}

export function platformRangeLabel(min: number, max: number): string {
  return `推荐 ${min}–${max}s`;
}

export function longFormLabel(seconds: number, language?: ScriptLanguage | null): string {
  if (!isLongForm(seconds)) return language === 'en' ? 'Short form' : '短视频';
  return language === 'en' ? 'Long form' : '长视频';
}

export function suggestedSplitShotPresets(sentenceCount: number): number[] {
  const auto = Math.max(2, sentenceCount || 0);
  const presets = [4, 6, 8, 12, 16, 24, 32, 48];
  const next = presets.filter((n) => n <= Math.max(auto, 6));
  if (!next.includes(auto) && auto > 2) next.push(auto);
  return Array.from(new Set(next)).sort((a, b) => a - b);
}

export function durationModeForSeconds(seconds: number): 'short' | 'long' {
  return isLongForm(seconds) ? 'long' : 'short';
}

export function llmMaxTokensForSeconds(seconds: number): number {
  return isLongForm(seconds) ? LLM_LONGFORM_MAX_TOKENS : LLM_JSON_MAX_TOKENS;
}

export function llmTimeoutMsForSeconds(seconds: number): number {
  if (seconds >= 300) return 180000;
  if (isLongForm(seconds)) return 120000;
  return 60000;
}

export function longFormTotalTimeoutMsForSeconds(seconds: number): number {
  if (!isLongForm(seconds)) return llmTimeoutMsForSeconds(seconds);
  return Math.min(900000, Math.max(300000, 120000 + Math.ceil(Math.max(0, seconds) / 60) * 30000));
}

export function paceAsl(pace: ScriptPace): number {
  switch (pace) {
    case 'ultrafast': return 1.6;
    case 'fast': return 2.5;
    case 'slow': return 6.5;
    case 'cinematic': return 5.0;
    default: return 3.7;
  }
}

export function visualSlotEstimate(targetSeconds: number, pace: ScriptPace): { axis: number; min: number; max: number } {
  const asl = paceAsl(pace);
  const axis = Math.max(2, Math.round(targetSeconds / asl));
  const min = Math.max(2, Math.round(targetSeconds / (asl * 1.2)));
  const max = Math.max(min, Math.round(targetSeconds / (asl * 0.75)));
  return { axis, min, max };
}

export function recommendedSecondsForPlatform(
  platform: ScriptPlatform,
  range: { min: number; max: number; defaultSeconds: number }
): { min: number; max: number; defaultSeconds: number } {
  return range;
}
