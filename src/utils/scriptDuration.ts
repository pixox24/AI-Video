import { ScriptForm, ScriptLanguage, ScriptPace, ScriptPlatform } from '../types';

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

export function scriptFormForSeconds(seconds: number): ScriptForm {
  const value = Number(seconds);
  if (value <= 60) return 'short';
  if (value <= 180) return 'medium';
  if (value <= 600) return 'long';
  return 'extended';
}

export function resolveScriptForm(seconds: number, override?: ScriptForm | null): ScriptForm {
  if (override === 'short' || override === 'medium' || override === 'long' || override === 'extended') {
    return override;
  }
  return scriptFormForSeconds(seconds);
}

export function scriptFormLabel(form: ScriptForm, language?: ScriptLanguage | null): string {
  if (language === 'en') {
    if (form === 'short') return 'Short form';
    if (form === 'medium') return 'Segmented video';
    if (form === 'long') return 'Chaptered video';
    return 'Extended video';
  }
  if (form === 'short') return '短视频';
  if (form === 'medium') return '段落视频';
  if (form === 'long') return '章节视频';
  return '深度长视频';
}

export function outlineConfirmationRequired(form: ScriptForm, confirmMedium = false): boolean {
  if (form === 'long' || form === 'extended') return true;
  return form === 'medium' && confirmMedium;
}

export function usesSectionWorkflow(form: ScriptForm): boolean {
  return form !== 'short';
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
  return scriptFormLabel(scriptFormForSeconds(seconds), language);
}

export function suggestedSplitShotPresets(sentenceCount: number): number[] {
  const auto = Math.max(2, sentenceCount || 0);
  const presets = [4, 6, 8, 12, 16, 24, 32, 48];
  const next = presets.filter((n) => n <= Math.max(auto, 6));
  if (!next.includes(auto) && auto > 2) next.push(auto);
  return Array.from(new Set(next)).sort((a, b) => a - b);
}

export function durationModeForSeconds(seconds: number): 'short' | 'long' {
  return usesSectionWorkflow(scriptFormForSeconds(seconds)) ? 'long' : 'short';
}

export function llmMaxTokensForSeconds(seconds: number): number {
  return scriptFormForSeconds(seconds) === 'short' ? LLM_JSON_MAX_TOKENS : LLM_LONGFORM_MAX_TOKENS;
}

export function llmTimeoutMsForSeconds(seconds: number): number {
  const form = scriptFormForSeconds(seconds);
  if (form === 'extended' || seconds >= 300) return 180000;
  if (form === 'long' || form === 'medium') return 120000;
  return 60000;
}

export function longFormTotalTimeoutMsForSeconds(seconds: number): number {
  const form = scriptFormForSeconds(seconds);
  if (form === 'short') return llmTimeoutMsForSeconds(seconds);
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
