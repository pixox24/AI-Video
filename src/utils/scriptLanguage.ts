import { ScriptLanguage, ScriptPace } from '../types';

export type BudgetUnit = 'chars' | 'words';
export type SecondaryScript = 'latin' | 'cjk';

export interface LanguageProfile {
  id: ScriptLanguage;
  bilingualTarget: ScriptLanguage;
  budgetUnit: BudgetUnit;
  budgetUnitLabel: string;
  paceUnitsPerSecond: Record<ScriptPace, number>;
  titleMin: number;
  titleMax: number;
  hookMax: number;
  topicTitleMax: number;
  secondaryScript: SecondaryScript;
  defaultVoice: string;
}

const ZH_PACE: Record<ScriptPace, number> = {
  ultrafast: 5.3,
  fast: 5.0,
  medium: 4.3,
  slow: 3.5,
  cinematic: 3.6
};

const EN_PACE: Record<ScriptPace, number> = {
  ultrafast: 3.2,
  fast: 2.9,
  medium: 2.5,
  slow: 2.1,
  cinematic: 2.2
};

export const LANGUAGE_PROFILES: Record<ScriptLanguage, LanguageProfile> = {
  zh: {
    id: 'zh',
    bilingualTarget: 'en',
    budgetUnit: 'chars',
    budgetUnitLabel: '字',
    paceUnitsPerSecond: ZH_PACE,
    titleMin: 2,
    titleMax: 24,
    hookMax: 22,
    topicTitleMax: 18,
    secondaryScript: 'latin',
    defaultVoice: 'magnetic-male'
  },
  en: {
    id: 'en',
    bilingualTarget: 'zh',
    budgetUnit: 'words',
    budgetUnitLabel: '词',
    paceUnitsPerSecond: EN_PACE,
    titleMin: 2,
    titleMax: 12,
    hookMax: 12,
    topicTitleMax: 10,
    secondaryScript: 'cjk',
    defaultVoice: 'bilingual-en'
  }
};

export function normalizeScriptLanguage(value: unknown): ScriptLanguage {
  return value === 'en' ? 'en' : 'zh';
}

export function languageProfile(language?: ScriptLanguage | null): LanguageProfile {
  return LANGUAGE_PROFILES[normalizeScriptLanguage(language)];
}

export function bilingualTarget(language?: ScriptLanguage | null): ScriptLanguage {
  return languageProfile(language).bilingualTarget;
}

export function countWords(text: string | undefined): number {
  return (text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function countChars(text: string | undefined): number {
  return (text || '').replace(/\s+/g, '').length;
}

export function countBudgetUnits(text: string | undefined, language?: ScriptLanguage | null): number {
  return languageProfile(language).budgetUnit === 'words' ? countWords(text) : countChars(text);
}

export function countCjk(text: string | undefined): number {
  return ((text || '').match(/[\u4e00-\u9fff]/g) || []).length;
}

export function countLatin(text: string | undefined): number {
  return ((text || '').match(/[A-Za-z]/g) || []).length;
}

export function looksLikeSecondary(text: string | undefined, language?: ScriptLanguage | null): boolean {
  const value = (text || '').trim();
  if (!value) return false;
  const expected = language ? languageProfile(language).secondaryScript : null;
  const latin = countLatin(value);
  const cjk = countCjk(value);
  if (expected === 'latin') return latin >= 3 && cjk === 0;
  if (expected === 'cjk') return cjk >= 2;
  return latin >= 3 || cjk >= 2;
}

export function inferScriptLanguage(text: string | undefined): ScriptLanguage {
  const value = (text || '').trim();
  if (!value) return 'zh';
  const cjk = countCjk(value);
  const latin = countLatin(value);
  if (cjk >= 2 && cjk >= Math.max(1, Math.floor(latin / 4))) return 'zh';
  if (latin >= 3) return 'en';
  return 'zh';
}

export function titleUnitCount(text: string | undefined, language?: ScriptLanguage | null): number {
  const lang = normalizeScriptLanguage(language);
  if (lang === 'en') return countWords(text);
  return (text || '').trim().length;
}

export function isLockedTitleValidFor(title: string | undefined, language?: ScriptLanguage | null): boolean {
  const profile = languageProfile(language);
  const n = titleUnitCount(title, language);
  return n >= profile.titleMin && n <= profile.titleMax;
}

export function budgetUnitLabel(language?: ScriptLanguage | null): string {
  return languageProfile(language).budgetUnitLabel;
}

export function paceUnitsPerSecond(pace: ScriptPace, language?: ScriptLanguage | null, speechRate = 1): number {
  const rate = Math.max(0.8, Math.min(1.5, Number(speechRate) || 1));
  return languageProfile(language).paceUnitsPerSecond[pace] * rate;
}
