import {
  BeatFunction,
  ForecastShot,
  ScriptBeat,
  ScriptLanguage,
  ShotEnergy,
  SpeechSpan,
  SpeechVisual
} from '../types';
import { countNarrationChars, partitionSpeechText } from './narrationTrack';
import { countBudgetUnits, normalizeScriptLanguage } from './scriptLanguage';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const TURN_MARKER_ZH = /(而是|却是|其实是|其实|不如|但是|可是)/;
const TURN_MARKER_EN = /(\bbut\b|\binstead\b|\bhowever\b|\brather\b)/i;
const CONTRAST_SPAN_ZH = /(不是[^。！？]{1,30}[，,][^。！？]{0,20}(而是|却是|其实是)|虽然[^。！？]{1,30}[，,][^。！？]{0,20}(但是|可是)|与其[^。！？]{1,30}[，,][^。！？]{0,20}不如|[^。！？]{4,40}[，,](其实是|而是|却是))/;
const CONTRAST_SPAN_EN = /\b(not\b[^.]{1,40},\s*(but|instead)\b|although\b[^.]{1,40},\s*(but|however)\b)/i;
const EN_ABBREV = /^(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|Inc|Ltd|St|Ave|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec|No|Vol|Fig|U\.S|U\.K|e\.g|i\.e)$/i;

function minUnits(language: ScriptLanguage, zh: number, en: number): number {
  return language === 'en' ? en : zh;
}

export function hasTerminalPunct(text: string): boolean {
  return /[。！？.!?…]$/.test((text || '').trim());
}

export function closeSentence(text: string, language: ScriptLanguage): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (hasTerminalPunct(trimmed)) return trimmed;
  return language === 'en' ? `${trimmed}.` : `${trimmed}。`;
}

function wordBefore(text: string, index: number): string {
  const slice = text.slice(0, index);
  const match = slice.match(/([A-Za-z.]+)\s*$/);
  return match ? match[1].replace(/\.$/, '') : '';
}

function splitChineseSentences(cleaned: string, lang: ScriptLanguage, keepShort: boolean): string[] {
  const parts = cleaned.split(/([。！？!?]+)/);
  const sentences: string[] = [];
  let current = '';
  const minLen = keepShort ? 1 : minUnits(lang, 2, 2);
  for (const part of parts) {
    if (!part) continue;
    if (/^[。！？!?]+$/.test(part)) {
      current = `${current}${part}`;
      if (countBudgetUnits(current, lang) >= minLen) sentences.push(current.trim());
      else if (keepShort && current.trim()) sentences.push(current.trim());
      current = '';
    } else {
      current = `${current}${part}`;
    }
  }
  if (current.trim() && (keepShort || countBudgetUnits(current, lang) >= minLen)) {
    sentences.push(closeSentence(current, lang));
  }
  return sentences.filter((sentence) => keepShort || countBudgetUnits(sentence, lang) >= minLen);
}

function splitEnglishSentences(cleaned: string, keepShort: boolean): string[] {
  const sentences: string[] = [];
  let last = 0;
  const re = /[.!?]+(?:["')\]]+)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned))) {
    const punct = match[0];
    const end = match.index + punct.length;
    const after = cleaned.slice(end);
    const next = after.match(/^\s+([A-Z"'“])/) || after.match(/^\s*$/);
    const isDecimal = punct === '.' && /[0-9]$/.test(cleaned.slice(0, match.index)) && /^[0-9]/.test(after);
    const isAbbrev = punct.startsWith('.') && EN_ABBREV.test(wordBefore(cleaned, match.index));
    if (isDecimal || isAbbrev) continue;
    if (!next) continue;
    const sentence = cleaned.slice(last, end).trim();
    if (sentence && (keepShort || countBudgetUnits(sentence, 'en') >= 2)) {
      sentences.push(sentence);
    }
    last = end;
  }
  const rest = cleaned.slice(last).trim();
  if (rest && (keepShort || countBudgetUnits(rest, 'en') >= 2)) {
    sentences.push(closeSentence(rest, 'en'));
  }
  return sentences;
}

export function splitCompleteSentences(
  text: string,
  language?: ScriptLanguage,
  opts?: { keepShort?: boolean }
): string[] {
  const lang = normalizeScriptLanguage(language);
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const keepShort = Boolean(opts?.keepShort);
  if (lang === 'en') return splitEnglishSentences(cleaned, keepShort);
  return splitChineseSentences(cleaned, lang, keepShort);
}

export interface BeatCharRange {
  beat: ScriptBeat;
  start: number;
  end: number;
}

export function compactChars(text: string): string {
  return (text || '').replace(/\s+/g, '');
}

export function beatRangesFromBeats(beats: ScriptBeat[] | undefined, totalChars: number): BeatCharRange[] {
  const list = (beats || []).filter(Boolean);
  if (list.length === 0) return [];
  const narrated = list.map((beat) => compactChars(beat.narration || '').length);
  const narratedSum = narrated.reduce((sum, value) => sum + value, 0);
  if (narratedSum > 0) {
    let cursor = 0;
    return list.map((beat, index) => {
      const len = Math.max(1, narrated[index] || 0);
      const range = { beat, start: cursor, end: cursor + len };
      cursor += len;
      return range;
    });
  }
  const weights = list.map((beat) => Math.max(1, Number(beat.targetSeconds) || 1));
  const weightSum = weights.reduce((sum, value) => sum + value, 0) || 1;
  const span = Math.max(1, totalChars);
  let cursor = 0;
  return list.map((beat, index) => {
    const last = index === list.length - 1;
    const len = last ? Math.max(1, span - cursor) : Math.max(1, Math.round((weights[index] / weightSum) * span));
    const range = { beat, start: cursor, end: cursor + len };
    cursor += len;
    return range;
  });
}

export function mapSentencesToBeats(
  sentences: string[],
  beats: ScriptBeat[] | undefined
): Array<ScriptBeat | undefined> {
  if (!beats || beats.length === 0) return sentences.map(() => undefined);
  const total = sentences.reduce((sum, sentence) => sum + Math.max(1, compactChars(sentence).length), 0);
  const ranges = beatRangesFromBeats(beats, total);
  if (ranges.length === 0) return sentences.map(() => undefined);
  let cursor = 0;
  return sentences.map((sentence) => {
    const len = Math.max(1, compactChars(sentence).length);
    const mid = cursor + len / 2;
    cursor += len;
    const found = ranges.find((range) => mid >= range.start && mid < range.end) || ranges[ranges.length - 1];
    return found?.beat;
  });
}

export function isContrastSentence(text: string, language?: ScriptLanguage): boolean {
  const lang = normalizeScriptLanguage(language);
  return lang === 'en' ? CONTRAST_SPAN_EN.test(text) : CONTRAST_SPAN_ZH.test(text);
}

export function localVisualsForSentence(text: string, language?: ScriptLanguage): SpeechVisual[] {
  const lang = normalizeScriptLanguage(language);
  if (!isContrastSentence(text, lang)) {
    return [makeVisual(text, 0, 1, '一句一图')];
  }
  const marker = lang === 'en' ? TURN_MARKER_EN : TURN_MARKER_ZH;
  const match = text.match(marker);
  if (!match || match.index == null) {
    return [makeVisual(text, 0, 1, '一句一图')];
  }
  const cut = match.index;
  const left = text.slice(0, cut).trim();
  const right = text.slice(cut).trim();
  if (countBudgetUnits(left, lang) < minUnits(lang, 4, 3) || countBudgetUnits(right, lang) < minUnits(lang, 4, 3)) {
    return [makeVisual(text, 0, 1, '对照前后太短，并成一图')];
  }
  const ratio = Math.min(0.75, Math.max(0.25, cut / Math.max(1, text.length)));
  return [
    makeVisual(left, 0, ratio, `对照前半，切在「${match[1]}」`),
    makeVisual(right, ratio, 1, '对照翻转')
  ];
}

function makeVisual(sliceText: string, startRatio: number, endRatio: number, splitReason: string): SpeechVisual {
  return {
    id: `vis-${startRatio}-${endRatio}`,
    startRatio,
    endRatio,
    visualIntent: sliceText.replace(/[。！？.!?]$/, ''),
    sliceText,
    splitReason
  };
}

export function buildSpeechSpans(narration: string, beats?: ScriptBeat[], language?: ScriptLanguage): SpeechSpan[] {
  const lang = normalizeScriptLanguage(language);
  const beatTexts = (beats || [])
    .map((beat) => (beat.narration || '').trim())
    .filter((text) => countBudgetUnits(text, lang) >= 2);
  const source = (narration || '').trim() || beatTexts.join(lang === 'en' ? ' ' : '');
  const sentences = splitCompleteSentences(source, lang, { keepShort: true });
  const mapped = mapSentencesToBeats(sentences, beats);
  let cursor = 0;
  return sentences.map((text, index) => {
    const progress = sentences.length <= 1 ? 0 : index / (sentences.length - 1);
    const fn = functionAt(progress, index === sentences.length - 1);
    const beat = mapped[index];
    const compact = compactChars(text);
    const span: SpeechSpan = {
      id: `span-${index + 1}`,
      text,
      function: beat?.function || fn,
      energy: beat?.energy || energyAt(progress),
      needsHold: beat?.needsHold || fn === 'cta' || fn === 'reveal',
      visuals: localVisualsForSentence(text, lang),
      beatId: beat?.id,
      sectionId: beat?.sectionId,
      charStart: cursor,
      charEnd: cursor + compact.length
    };
    cursor += compact.length;
    return span;
  });
}

function functionAt(progress: number, isLast: boolean): BeatFunction {
  if (progress < 0.12) return 'hook';
  if (isLast) return 'cta';
  if (progress >= 0.82) return 'cta';
  if (progress >= 0.7) return 'reveal';
  if (progress >= 0.45) return 'proof';
  if (progress >= 0.28) return 'turn';
  return 'setup';
}

function energyAt(progress: number): ShotEnergy {
  if (progress < 0.12) return 'fast';
  if (progress >= 0.82) return 'hold';
  if (progress >= 0.55) return 'fast';
  return 'medium';
}

export function normalizeSpeechSpans(raw: SpeechSpan[], originalNarration: string, language?: ScriptLanguage): SpeechSpan[] {
  const lang = normalizeScriptLanguage(language);
  const sentences = splitCompleteSentences(originalNarration, lang, { keepShort: true });
  if (!Array.isArray(raw) || raw.length === 0) {
    return buildSpeechSpans(originalNarration, undefined, lang);
  }
  let cursor = 0;
  return raw.map((span, index) => {
    const text = (span.text || sentences[index] || '').trim();
    let visuals = Array.isArray(span.visuals) ? span.visuals.filter((visual) => visual.endRatio > visual.startRatio) : [];
    visuals = visuals.slice(0, 3);
    if (visuals.length === 0) visuals = localVisualsForSentence(text, lang);
    if (isContrastSentence(text, lang) && visuals.length < 2) {
      visuals = localVisualsForSentence(text, lang);
    }
    const sorted = [...visuals].sort((a, b) => a.startRatio - b.startRatio);
    const first = { ...sorted[0], startRatio: 0 };
    const last = { ...sorted[sorted.length - 1], endRatio: 1 };
    const middle = sorted.slice(1, -1);
    const aligned = sorted.length === 1 ? [{ ...first, endRatio: 1 }] : [first, ...middle, last];
    const sentence = closeSentence(text, lang);
    const parts = partitionSpeechText(
      sentence,
      aligned.map((visual) => visual.sliceText || ''),
      aligned.map((visual) => ({ startRatio: visual.startRatio, endRatio: visual.endRatio }))
    );
    const fixed = aligned.map((visual, visualIndex) => {
      const part = parts[visualIndex] || { start: 0, end: sentence.length };
      const sliceText = sentence.slice(part.start, part.end).trim() || visual.sliceText || sentence;
      return {
        id: visual.id || `vis-${index}-${visualIndex}`,
        startRatio: Math.min(0.99, Math.max(0, visual.startRatio)),
        endRatio: Math.min(1, Math.max(0.01, visual.endRatio)),
        visualIntent: visual.visualIntent || sliceText || text,
        sliceText,
        splitReason: visual.splitReason || (aligned.length > 1 ? '句内换画面' : '一句一图')
      };
    });
    const compact = compactChars(sentence);
    const next: SpeechSpan = {
      id: span.id || `span-${index + 1}`,
      text: sentence,
      function: span.function || functionAt(index / Math.max(1, raw.length - 1), index === raw.length - 1),
      energy: span.energy || energyAt(index / Math.max(1, raw.length - 1)),
      needsHold: Boolean(span.needsHold) || span.function === 'cta' || span.function === 'reveal',
      visuals: fixed,
      beatId: span.beatId,
      sectionId: span.sectionId,
      charStart: span.charStart ?? cursor,
      charEnd: span.charEnd ?? cursor + compact.length
    };
    cursor += compact.length;
    return next;
  });
}

export function gateSpeechSpans(spans: SpeechSpan[], language?: ScriptLanguage): string[] {
  const lang = normalizeScriptLanguage(language);
  const issues: string[] = [];
  spans.forEach((span, index) => {
    if (!hasTerminalPunct(span.text)) {
      issues.push(`第 ${index + 1} 段口播没有以句号结束，不能单独成段。`);
    }
    if (isContrastSentence(span.text, lang) && span.visuals.length < 2) {
      issues.push(`第 ${index + 1} 句是对照句，应同一口播、两张画面。`);
    }
    if (span.visuals.length > 3) {
      issues.push(`第 ${index + 1} 句画面超过 3 张，减图或拆成两句。`);
    }
    const joined = span.visuals.map((visual) => visual.sliceText).join('');
    if (span.visuals.length > 1 && countNarrationChars(joined) < countNarrationChars(span.text) * 0.5) {
      issues.push(`第 ${index + 1} 句画面切片对不上整句口播。`);
    }
  });
  return issues;
}

export function shotsFromSpeechSpans(spans: SpeechSpan[], charsPerSecond: number, language?: ScriptLanguage): ForecastShot[] {
  const lang = normalizeScriptLanguage(language);
  const shots: ForecastShot[] = [];
  let cursor = 0;
  let order = 1;
  spans.forEach((span) => {
    const speechTotal = Math.max(0.4, countBudgetUnits(span.text, lang) / Math.max(1.6, charsPerSecond));
    const visuals = span.visuals.length > 0 ? span.visuals : localVisualsForSentence(span.text, lang);
    visuals.forEach((visual, visualIndex) => {
      const ratio = Math.max(0.08, visual.endRatio - visual.startRatio);
      const speechDuration = round2(speechTotal * ratio);
      const holdDuration = 0;
      shots.push({
        id: `shot-${order}`,
        order,
        start: round2(cursor),
        speechDuration,
        holdDuration,
        energy: span.energy,
        function: span.function,
        visualIntent: visual.visualIntent,
        narration: visualIndex === 0 ? span.text : '',
        sliceText: visual.sliceText,
        splitReason: visual.splitReason,
        spanId: span.id,
        visualIndex,
        visualCount: visuals.length,
        voRole: visualIndex === 0 ? 'start' : 'continue',
        beatId: span.beatId,
        sectionId: span.sectionId
      });
      cursor += speechDuration + holdDuration;
      order += 1;
    });
  });
  return shots;
}
