import { AnalysisInput, ScriptGenre, ScriptLanguage, VisualBible } from '../types';
import { fnv1a64Hex } from './scriptEntity';

export const ANALYSIS_INPUT_SCHEMA_VERSION = 2;
export const EXTRACTOR_VERSION = 'entity-ledger-2';
export const PARSER_VERSION = 'script-analysis-2';
export const PROMPT_VERSION = 'visual-bible-compile-2';

export function normalizeSourceText(value: unknown): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

export function stableSerialize(value: unknown): string {
  if (value == null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

export function buildAnalysisInput(opts: {
  narration?: string;
  title?: string;
  intentNotes?: string;
  language?: ScriptLanguage | string | null;
  genre?: ScriptGenre | string | null;
  diagnosePaste?: boolean;
}): AnalysisInput {
  const narration = normalizeSourceText(opts.narration).trim();
  const title = normalizeSourceText(opts.title).trim();
  // Diagnosing pasted script currently copies narration into intentNotes.
  // Do not treat that duplicate paste as a second creative instruction.
  const rawNotes = normalizeSourceText(opts.intentNotes).trim();
  const intentNotes = opts.diagnosePaste || (rawNotes && narration && rawNotes === narration)
    ? ''
    : rawNotes;
  const language = opts.language === 'en' ? 'en' : 'zh';
  return {
    inputSchemaVersion: ANALYSIS_INPUT_SCHEMA_VERSION,
    narration,
    title,
    intentNotes,
    language,
    genreHint: opts.genre ? String(opts.genre) : null
  };
}

export function sourceKey(input: AnalysisInput): string {
  return fnv1a64Hex(stableSerialize({
    inputSchemaVersion: input.inputSchemaVersion,
    narration: input.narration,
    title: input.title,
    intentNotes: input.intentNotes,
    language: input.language,
    genreHint: input.genreHint || ''
  }));
}

export function analysisCacheKey(input: AnalysisInput, extras?: { model?: string }): string {
  return fnv1a64Hex(stableSerialize({
    sourceKey: sourceKey(input),
    extractor: EXTRACTOR_VERSION,
    parser: PARSER_VERSION,
    prompt: PROMPT_VERSION,
    model: extras?.model || ''
  }));
}

export function bibleRevisionOf(bible: Pick<VisualBible, 'sourceKey' | 'sourceFingerprint' | 'overrides' | 'narratorMode' | 'characters' | 'subjects' | 'pendingCharacters' | 'paletteLock' | 'continuityRule' | 'locations'>): string {
  return fnv1a64Hex(stableSerialize({
    sourceKey: bible.sourceKey || bible.sourceFingerprint || '',
    narratorMode: bible.narratorMode || 'voiceover',
    overrides: Object.fromEntries(Object.entries(bible.overrides || {}).map(([id, override]) => [id, {
      decision: override.decision, displayName: override.displayName, role: override.role,
      appearance: override.appearance, locks: override.locks
    }])),
    characters: (bible.characters || []).map((item) => ({
      entityId: item.entityId || item.id,
      id: item.id,
      name: item.name,
      role: item.role,
      kind: item.kind,
      ageBand: item.ageBand,
      signature: item.signature,
      look: item.look,
      wardrobe: item.wardrobe,
      refs: (item.refs || []).map((ref) => ({ imageId: ref.imageId, imageUrl: ref.imageUrl, kind: ref.kind })),
      identityLocked: Boolean(item.identityLocked),
      appearanceLocked: Boolean(item.appearanceLocked),
      refsLocked: Boolean(item.refsLocked)
    })),
    subjects: (bible.subjects || []).map((item) => ({
      entityId: item.entityId || item.id,
      name: item.name,
      look: item.look
    })),
    pending: (bible.pendingCharacters || []).map((item) => item.entityId || item.name),
    paletteLock: bible.paletteLock || '',
    continuityRule: bible.continuityRule || '',
    locations: (bible.locations || []).map((item) => ({
      id: item.id,
      name: item.name,
      look: item.look,
      timeOfDay: item.timeOfDay
    }))
  }));
}

export function analysisInputFromFields(
  narration: string,
  extras?: { title?: string; intentNotes?: string; genre?: ScriptGenre | string | null; language?: ScriptLanguage | string | null }
): AnalysisInput {
  return buildAnalysisInput({
    narration,
    title: extras?.title,
    intentNotes: extras?.intentNotes,
    genre: extras?.genre,
    language: extras?.language
  });
}

export function currentSourceKey(
  narration: string,
  extras?: { title?: string; intentNotes?: string; genre?: ScriptGenre | string | null; language?: ScriptLanguage | string | null }
): string {
  return sourceKey(analysisInputFromFields(narration, extras));
}
