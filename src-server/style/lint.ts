import type { WritingStyleProfile } from '../../src/shared/writingStyle';
import { ABSTRACT_PLACEHOLDER_WORDS } from '../../src/shared/writingStyle';

/**
 * Deterministic, LLM-free style check. Pure function: no I/O, no randomness, stable ordering.
 * Severity is capped at `medium` — style issues never block export.
 */
export interface StyleViolation {
  code: 'banned_pattern' | 'abstract_placeholder' | 'sentence_length' | 'short_sentence_share';
  severity: 'medium' | 'low';
  message: string;
  evidence: string;
  suggestedFix: string;
}

export interface StyleLintOptions {
  /** Sentence-length thresholds apply to Chinese units only; omit for English drafts. */
  language?: 'zh' | 'en';
  /** Max distinct violations returned, default 20. */
  limit?: number;
}

/** Sentence unit count: Chinese characters, or whitespace-separated words. */
export function styleSentenceUnits(sentence: string, language: 'zh' | 'en' = 'zh'): number {
  const text = String(sentence || '').trim();
  if (!text) return 0;
  if (language === 'en') return text.split(/\s+/).filter(Boolean).length;
  return (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
}

/** Split into complete sentences; a trailing fragment without terminal punctuation is kept. */
export function splitStyleSentences(text: string): string[] {
  const normalized = String(text || '').replace(/\r\n?/g, '\n');
  const matches = normalized.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [];
  return matches.map(part => part.trim()).filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Tolerates whitespace and hyphen/quote variants inside a multi-word pattern. */
function patternRegExp(pattern: string): RegExp {
  const parts = pattern.split(/\s+/).filter(Boolean).map(escapeRegExp);
  return new RegExp(parts.join('\\s*'), 'i');
}

function hitSnippet(sentence: string, pattern: string): string {
  const match = sentence.match(patternRegExp(pattern));
  if (!match || match.index === undefined) return sentence.trim().slice(0, 40);
  const start = Math.max(0, match.index - 6);
  return sentence.trim().slice(start, Math.min(sentence.trim().length, match.index + match[0].length + 6));
}

export interface SentenceHighlight {
  sentence: string;
  /** The banned expression found in this sentence, or null when the sentence is clean. */
  hit: string | null;
}

/**
 * Sentence-level banned-word highlighting for the copy canvas. Pure and LLM-free:
 * it looks up the same pattern list styleLint uses, so the highlight cannot drift from the check.
 */
export function highlightBannedSentences(narration: string, profile: WritingStyleProfile): SentenceHighlight[] {
  const patterns = [...new Set([...profile.bannedPatterns, ...ABSTRACT_PLACEHOLDER_WORDS].map(item => String(item).trim()).filter(Boolean))];
  return splitStyleSentences(narration).map(sentence => {
    const hit = patterns.find(pattern => patternRegExp(pattern).test(sentence)) || null;
    return { sentence, hit };
  });
}

export function styleLint(narration: string, profile: WritingStyleProfile, options: StyleLintOptions = {}): StyleViolation[] {  const text = String(narration || '');
  if (!text.trim()) return [];
  const language = options.language === 'en' ? 'en' : 'zh';
  const limit = Math.max(1, options.limit ?? 20);
  const violations: StyleViolation[] = [];
  const sentences = splitStyleSentences(text);
  const bannedPatterns = [...new Set(profile.bannedPatterns.map(item => String(item).trim()).filter(Boolean))];
  const abstractPatterns = [...new Set(ABSTRACT_PLACEHOLDER_WORDS.map(item => String(item).trim()).filter(Boolean))];
  const emitted = new Set<string>();

  // Banned patterns are evaluated first: an archive ban wins over the shared abstract word list.
  for (const pattern of bannedPatterns) {
    const hit = sentences.find(sentence => patternRegExp(pattern).test(sentence));
    if (!hit || emitted.has(pattern)) continue;
    emitted.add(pattern);
    violations.push({
      code: 'banned_pattern',
      severity: 'medium',
      message: `命中「${profile.label}」档案的禁用表达：${pattern}`,
      evidence: hitSnippet(hit, pattern),
      suggestedFix: `改写含「${pattern}」的这句：直接给判断或具体事实，不要用套话起头。`
    });
  }
  for (const pattern of abstractPatterns) {
    // Skip words already covered by a banned hit in the same sentence.
    const hit = sentences.find(sentence => patternRegExp(pattern).test(sentence) && !bannedPatterns.some(banned => patternRegExp(banned).test(sentence)));
    if (!hit || emitted.has(pattern)) continue;
    emitted.add(pattern);
    violations.push({
      code: 'abstract_placeholder',
      severity: 'medium',
      message: `出现抽象占位词「${pattern}」，不可拍也不可验证`,
      evidence: hitSnippet(hit, pattern),
      suggestedFix: `把「${pattern}」换成一个看得见的画面、动作或数字。`
    });
  }

  const thresholds = profile.lintThresholds;
  if (thresholds && language === 'zh' && sentences.length > 0) {
    const units = sentences.map(sentence => styleSentenceUnits(sentence, language));
    const shortCount = units.filter(count => count > 0 && count <= thresholds.maxSentenceUnits).length;
    const share = shortCount / units.length;
    if (share < thresholds.minShortSentenceShare) {
      violations.push({
        code: 'short_sentence_share',
        severity: 'low',
        message: `短句占比 ${(share * 100).toFixed(0)}%，低于「${profile.label}」要求的下限 ${(thresholds.minShortSentenceShare * 100).toFixed(0)}%`,
        evidence: `${shortCount}/${units.length} 句不超过 ${thresholds.maxSentenceUnits} 字`,
        suggestedFix: `把长句拆成短句：把「因为…所以…」拆成两句陈述，单位降到 ${thresholds.maxSentenceUnits} 字以内。`
      });
    }
    const overHard = sentences.filter((sentence, index) => units[index] > thresholds.maxSentenceUnitsHard);
    if (overHard.length > 0) {
      violations.push({
        code: 'sentence_length',
        severity: 'low',
        message: `有 ${overHard.length} 句超过 ${thresholds.maxSentenceUnitsHard} 字硬上限`,
        evidence: overHard[0].trim().slice(0, 40),
        suggestedFix: `在句中标点处断句，单句控制在 ${thresholds.maxSentenceUnits} 字以内。`
      });
    }
  }

  return violations.slice(0, limit);
}
