import {
  BeatFunction,
  ForecastShot,
  ScriptBeat,
  ShotEnergy,
  SpeechSpan,
  SpeechVisual
} from '../types';
import { countNarrationChars, partitionSpeechText } from './narrationTrack';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const SENTENCE_SPLIT = /([。！？!?]+)/;
const TURN_MARKER = /(而是|却是|其实是|其实|不如|但是|可是)/;
const CONTRAST_SPAN = /(不是[^。！？]{1,30}[，,][^。！？]{0,20}(而是|却是|其实是)|虽然[^。！？]{1,30}[，,][^。！？]{0,20}(但是|可是)|与其[^。！？]{1,30}[，,][^。！？]{0,20}不如|[^。！？]{4,40}[，,](其实是|而是|却是))/;

export function splitCompleteSentences(text: string): string[] {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const parts = cleaned.split(SENTENCE_SPLIT);
  const sentences: string[] = [];
  let current = '';
  for (const part of parts) {
    if (!part) continue;
    if (/^[。！？!?]+$/.test(part)) {
      current = `${current}${part}`;
      if (countNarrationChars(current) >= 2) sentences.push(current.trim());
      current = '';
    } else {
      current = `${current}${part}`;
    }
  }
  if (countNarrationChars(current) >= 2) {
    sentences.push(/[。！？!?]$/.test(current.trim()) ? current.trim() : `${current.trim()}。`);
  }
  return sentences.filter((sentence) => countNarrationChars(sentence) >= 2);
}

export function isContrastSentence(text: string): boolean {
  return CONTRAST_SPAN.test(text);
}

export function localVisualsForSentence(text: string): SpeechVisual[] {
  if (!isContrastSentence(text)) {
    return [makeVisual(text, 0, 1, '一句一图')];
  }
  const match = text.match(TURN_MARKER);
  if (!match || match.index == null) {
    return [makeVisual(text, 0, 1, '一句一图')];
  }
  const cut = match.index;
  const left = text.slice(0, cut).trim();
  const right = text.slice(cut).trim();
  if (countNarrationChars(left) < 4 || countNarrationChars(right) < 4) {
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

export function buildSpeechSpans(narration: string, beats?: ScriptBeat[]): SpeechSpan[] {
  const beatTexts = (beats || [])
    .map((beat) => (beat.narration || '').trim())
    .filter((text) => countNarrationChars(text) >= 2);
  const source = (narration || '').trim() || beatTexts.join('');
  const sentences = splitCompleteSentences(source);
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
      visuals: localVisualsForSentence(text)
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

export function normalizeSpeechSpans(raw: SpeechSpan[], originalNarration: string): SpeechSpan[] {
  const sentences = splitCompleteSentences(originalNarration);
  if (!Array.isArray(raw) || raw.length === 0) {
    return buildSpeechSpans(originalNarration);
  }
  return raw.map((span, index) => {
    const text = (span.text || sentences[index] || '').trim();
    let visuals = Array.isArray(span.visuals) ? span.visuals.filter((visual) => visual.endRatio > visual.startRatio) : [];
    visuals = visuals.slice(0, 3);
    if (visuals.length === 0) visuals = localVisualsForSentence(text);
    if (isContrastSentence(text) && visuals.length < 2) {
      visuals = localVisualsForSentence(text);
    }
    const sorted = [...visuals].sort((a, b) => a.startRatio - b.startRatio);
    const first = { ...sorted[0], startRatio: 0 };
    const last = { ...sorted[sorted.length - 1], endRatio: 1 };
    const middle = sorted.slice(1, -1);
    const aligned = sorted.length === 1 ? [{ ...first, endRatio: 1 }] : [first, ...middle, last];
    const sentence = /[。！？!?]$/.test(text) ? text : `${text}。`;
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
      text: /[。！？!?]$/.test(text) ? text : `${text}。`,
      function: span.function || functionAt(index / Math.max(1, raw.length - 1), index === raw.length - 1),
      energy: span.energy || energyAt(index / Math.max(1, raw.length - 1)),
      needsHold: Boolean(span.needsHold) || span.function === 'cta' || span.function === 'reveal',
      visuals: fixed
    };
  });
}

export function gateSpeechSpans(spans: SpeechSpan[]): string[] {
  const issues: string[] = [];
  spans.forEach((span, index) => {
    if (!/[。！？!?]$/.test(span.text.trim())) {
      issues.push(`第 ${index + 1} 段口播没有以句号结束，不能单独成段。`);
    }
    if (isContrastSentence(span.text) && span.visuals.length < 2) {
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

export function shotsFromSpeechSpans(spans: SpeechSpan[], charsPerSecond: number): ForecastShot[] {
  const shots: ForecastShot[] = [];
  let cursor = 0;
  let order = 1;
  spans.forEach((span) => {
    const speechTotal = Math.max(0.4, countNarrationChars(span.text) / Math.max(2.5, charsPerSecond));
    const visuals = span.visuals.length > 0 ? span.visuals : localVisualsForSentence(span.text);
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
