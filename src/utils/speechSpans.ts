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

const SENTENCE_SPLIT = /([。！？!?]+)/;
const TURN_MARKER_ZH = /(而是|却是|其实是|其实|不如|但是|可是)/;
const TURN_MARKER_EN = /(\bbut\b|\binstead\b|\bhowever\b|\brather\b)/i;
const CONTRAST_SPAN_ZH = /(不是[^。！？]{1,30}[，,][^。！？]{0,20}(而是|却是|其实是)|虽然[^。！？]{1,30}[，,][^。！？]{0,20}(但是|可是)|与其[^。！？]{1,30}[，,][^。！？]{0,20}不如|[^。！？]{4,40}[，,](其实是|而是|却是))/;
const CONTRAST_SPAN_EN = /\b(not\b[^.]{1,40},\s*(but|instead)\b|although\b[^.]{1,40},\s*(but|however)\b)/i;

function minUnits(language: ScriptLanguage, zh: number, en: number): number {
  return language === 'en' ? en : zh;
}

function closeSentence(text: string, language: ScriptLanguage): string {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  if (/[。！？!?]$/.test(trimmed)) return trimmed;
  return language === 'en' ? `${trimmed}.` : `${trimmed}。`;
}

export function splitCompleteSentences(text: string, language?: ScriptLanguage): string[] {
  const lang = normalizeScriptLanguage(language);
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const parts = cleaned.split(SENTENCE_SPLIT);
  const sentences: string[] = [];
  let current = '';
  const minLen = minUnits(lang, 2, 2);
  for (const part of parts) {
    if (!part) continue;
    if (/^[。！？!?]+$/.test(part)) {
      current = `${current}${part}`;
      if (countBudgetUnits(current, lang) >= minLen) sentences.push(current.trim());
      current = '';
    } else {
      current = `${current}${part}`;
    }
  }
  if (countBudgetUnits(current, lang) >= minLen) {
    sentences.push(closeSentence(current, lang));
  }
  return sentences.filter((sentence) => countBudgetUnits(sentence, lang) >= minLen);
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
    visualIntent: sliceText.replace(/[。！？!?]$/, ''),
    sliceText,
    splitReason
  };
}

export function buildSpeechSpans(narration: string, beats?: ScriptBeat[], language?: ScriptLanguage): SpeechSpan[] {
  const lang = normalizeScriptLanguage(language);
  const beatTexts = (beats || [])
    .map((beat) => (beat.narration || '').trim())
    .filter((text) => countBudgetUnits(text, lang) >= 2);
  const source = (narration || '').trim() || beatTexts.join('');
  const sentences = splitCompleteSentences(source, lang);
  const count = Math.max(1, sentences.length);
  return sentences.map((text, index) => {
    const progress = count <= 1 ? 0 : index / (count - 1);
    const fn = functionAt(progress, index === count - 1);
    const beat = beats && beats[Math.min(index, beats.length - 1)];
    return {
      id: `span-${index + 1}`,
      text,
      function: beat?.function || fn,
      energy: beat?.energy || energyAt(progress),
      needsHold: beat?.needsHold || fn === 'cta' || fn === 'reveal',
      visuals: localVisualsForSentence(text, lang)
    };
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
  const sentences = splitCompleteSentences(originalNarration, lang);
  if (!Array.isArray(raw) || raw.length === 0) {
    return buildSpeechSpans(originalNarration, undefined, lang);
  }
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
    return {
      id: span.id || `span-${index + 1}`,
      text: closeSentence(text, lang),
      function: span.function || functionAt(index / Math.max(1, raw.length - 1), index === raw.length - 1),
      energy: span.energy || energyAt(index / Math.max(1, raw.length - 1)),
      needsHold: Boolean(span.needsHold) || span.function === 'cta' || span.function === 'reveal',
      visuals: fixed
    };
  });
}

export function gateSpeechSpans(spans: SpeechSpan[], language?: ScriptLanguage): string[] {
  const lang = normalizeScriptLanguage(language);
  const issues: string[] = [];
  spans.forEach((span, index) => {
    if (!/[。！？!?]$/.test(span.text.trim())) {
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
        voRole: visualIndex === 0 ? 'start' : 'continue'
      });
      cursor += speechDuration + holdDuration;
      order += 1;
    });
  });
  return shots;
}
