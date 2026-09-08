import { ScriptLanguage } from '../types';
import { countBudgetUnits, inferScriptLanguage, normalizeScriptLanguage } from './scriptLanguage';
import { splitCompleteSentences } from './speechSpans';

export function compactForCoverage(text: string): string {
  return (text || '')
    .replace(/\s+/g, '')
    .replace(/[。．.]+/g, '.')
    .replace(/[！!]+/g, '!')
    .replace(/[？?]+/g, '?')
    .replace(/[，,]+/g, ',');
}

export function splitCoversSource(chunks: string[], source: string): boolean {
  const src = compactForCoverage(source);
  if (!src) return true;
  const joined = compactForCoverage(chunks.join(''));
  return joined === src;
}

export function splitCoverageRatio(chunks: string[], source: string): number {
  const src = compactForCoverage(source);
  if (!src) return 1;
  const joined = compactForCoverage(chunks.join(''));
  if (!joined) return 0;
  if (joined === src) return 1;
  let matched = 0;
  let cursor = 0;
  for (let i = 0; i < joined.length && cursor < src.length; i++) {
    const idx = src.indexOf(joined[i], cursor);
    if (idx === -1) continue;
    matched += 1;
    cursor = idx + 1;
  }
  return matched / src.length;
}

function mergeShortChunks(sentences: string[], language: ScriptLanguage): string[] {
  const minKeep = language === 'en' ? 8 : 10;
  const merged: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    const next = current
      ? `${current}${language === 'en' && !current.endsWith(' ') ? ' ' : ''}${piece}`
      : piece;
    if (countBudgetUnits(current, language) >= minKeep && current) {
      merged.push(current.trim());
      current = piece;
    } else {
      current = next;
    }
  }
  if (current.trim()) merged.push(current.trim());
  return merged;
}

export function splitPastedNarration(
  text: string,
  language?: ScriptLanguage
): { chunks: string[]; coverageOk: boolean; language: ScriptLanguage } {
  const source = (text || '').trim();
  const lang = normalizeScriptLanguage(language || inferScriptLanguage(source));
  if (!source) return { chunks: [], coverageOk: true, language: lang };
  const sentences = splitCompleteSentences(source, lang, { keepShort: true });
  const fromSentences = sentences.length > 0 ? sentences : [source];
  const merged = mergeShortChunks(fromSentences, lang);
  const candidates = [fromSentences, merged];
  for (const chunks of candidates) {
    if (chunks.length > 0 && splitCoversSource(chunks, source)) {
      return { chunks, coverageOk: true, language: lang };
    }
  }
  return { chunks: [source], coverageOk: true, language: lang };
}

function splitChunkAtBoundary(text: string, language: ScriptLanguage): [string, string] | null {
  const value = text.trim();
  if (countBudgetUnits(value, language) < 4) return null;
  const mid = Math.floor(value.length / 2);
  const boundary = language === 'en' ? /[\s,;:.!?]/ : /[，；：、。！？]/;
  let cut = -1;
  for (let distance = 0; distance <= Math.max(mid, value.length - mid); distance += 1) {
    const left = mid - distance;
    const right = mid + distance;
    if (left > 1 && boundary.test(value[left])) {
      cut = left + 1;
      break;
    }
    if (right < value.length - 1 && boundary.test(value[right])) {
      cut = right + 1;
      break;
    }
  }
  if (cut <= 1 || cut >= value.length - 1) cut = mid;
  const left = value.slice(0, cut).trim();
  const right = value.slice(cut).trim();
  return left && right ? [left, right] : null;
}

/** Fit chunks to a requested count while preserving the source text exactly. */
export function fitTextChunksToCount(chunks: string[], target: number, language?: ScriptLanguage): string[] {
  const lang = normalizeScriptLanguage(language);
  const desired = Math.max(2, Math.min(240, Math.round(Number(target) || 0)));
  const next = chunks.map((chunk) => chunk.trim()).filter(Boolean);
  while (next.length > desired && next.length > 2) {
    let mergeAt = 0;
    let shortest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < next.length - 1; index += 1) {
      const size = countBudgetUnits(next[index], lang) + countBudgetUnits(next[index + 1], lang);
      if (size < shortest) {
        shortest = size;
        mergeAt = index;
      }
    }
    const glue = lang === 'en' ? ' ' : '';
    next.splice(mergeAt, 2, `${next[mergeAt]}${glue}${next[mergeAt + 1]}`.trim());
  }
  let guard = 0;
  while (next.length < desired && guard < desired * 2) {
    guard += 1;
    let longest = 0;
    for (let index = 1; index < next.length; index += 1) {
      if (countBudgetUnits(next[index], lang) > countBudgetUnits(next[longest], lang)) longest = index;
    }
    const split = splitChunkAtBoundary(next[longest], lang);
    if (!split) break;
    next.splice(longest, 1, split[0], split[1]);
  }
  return next;
}

export function assertSplitCoversSource(chunks: string[], source: string): string[] {
  if (splitCoversSource(chunks, source)) return chunks;
  throw new Error('拆分未覆盖原文，已拒绝截断结果');
}
