import type { DurationBudget, DurationPreset, DurationSpec, ScriptForm, ScriptLanguage, ScriptPace } from '../../src/types';
import { DURATION_PRESETS, durationSpecSchema } from '../../src/shared/contentBrief';
import { countBudgetUnits, paceUnitsPerSecond } from '../../src/utils/scriptLanguage';
import { FILL_RATIO_MIN, FILL_RATIO_MAX } from '../../src/utils/scriptDuration';

export function durationSpecForPreset(preset: DurationPreset, pace: ScriptPace = 'medium', contentType = 'analysis'): DurationSpec {
  const { minSeconds, targetSeconds, maxSeconds } = DURATION_PRESETS[preset];
  return { preset, minSeconds, targetSeconds, maxSeconds, pace, narrationRatio: contentType === 'tutorial' ? 0.65 : 0.8 };
}
export function durationSpecForm(spec: DurationSpec): ScriptForm {
  return spec.preset === 'insight' || (spec.preset === 'deep_dive' && spec.targetSeconds <= 600) ? 'long' : 'extended';
}
export function estimateNarrationSeconds(text: string, language: ScriptLanguage, pace: ScriptPace): number {
  return countBudgetUnits(text, language) / paceUnitsPerSecond(pace, language);
}
/** Layer new budgets on the existing budget without changing legacy pace tables. Browser-safe. */
export function applyDurationSpec(budget: DurationBudget, input: DurationSpec): DurationBudget {
  const spec = durationSpecSchema.parse(input);
  const speechSeconds = Math.round(spec.targetSeconds * spec.narrationRatio * 10) / 10;
  const holdSeconds = Math.round((spec.targetSeconds - speechSeconds) * 10) / 10;
  const cps = paceUnitsPerSecond(spec.pace, budget.scriptLanguage, budget.speechRate);
  const targetUnits = Math.max(8, Math.round(speechSeconds * cps));
  return { ...budget, targetSeconds: spec.targetSeconds, pace: spec.pace, charsPerSecond: cps,
    speechSeconds, speechTargetSeconds: speechSeconds, holdSeconds, visualHoldTargetSeconds: holdSeconds,
    maxChars: targetUnits, targetUnits, minUnits: Math.ceil(targetUnits * FILL_RATIO_MIN), maxUnits: Math.ceil(targetUnits * FILL_RATIO_MAX) };
}
