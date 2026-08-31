import {
  AudioConfig,
  CustomTtsApiConfig,
  NarrationAlignSource,
  NarrationAlignment,
  NarrationClipTiming,
  NarrationTrack,
  NarrationWordMark,
  StoryboardClip
} from '../types';
import { ttsSourceKey } from './ttsCatalog';

type SpeechClip = Pick<StoryboardClip, 'id' | 'narration' | 'voSlice' | 'voRole' | 'voSpanId' | 'speechDuration'>;

export type SpeechWindow = {
  duration: number;
  speechStart: number;
  speechEnd: number;
};

export function countNarrationChars(text: string | undefined): number {
  return (text || '').replace(/\s+/g, '').length;
}

function withSentenceEnd(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '';
  return /[。！？.!?…]$/.test(trimmed) ? trimmed : `${trimmed}。`;
}

function stripSpeechPunct(text: string): string {
  return (text || '').replace(/[。！？.!?…]+$/g, '').trim();
}

function compactSpeech(text: string): string {
  return (text || '').replace(/\s+/g, '');
}

function isAlmostFullSpeech(slice: string, sentence: string): boolean {
  const a = compactSpeech(stripSpeechPunct(slice));
  const b = compactSpeech(stripSpeechPunct(sentence));
  if (!a || !b) return false;
  return a === b || (b.includes(a) && a.length >= Math.max(4, b.length * 0.9));
}

/** Subtitle / card line for this shot, not the whole shared sentence. */
export function clipShotNarration(clip: Pick<StoryboardClip, 'narration' | 'voSlice'>): string {
  return (clip.voSlice || clip.narration || '').trim();
}

export function clipSharesUtterance(
  clip: Pick<StoryboardClip, 'voRole' | 'narration' | 'voSlice'>
): boolean {
  if (clip.voRole === 'continue') return true;
  const slice = (clip.voSlice || '').trim();
  const full = (clip.narration || '').trim();
  if (!slice || !full) return false;
  return !isAlmostFullSpeech(slice, full);
}

export function joinClipNarrations(clips: Pick<StoryboardClip, 'narration'>[]): string {
  return clips
    .map((clip) => withSentenceEnd(clip.narration || ''))
    .filter(Boolean)
    .join('');
}

export function groupClipsByUtterance<T extends Pick<StoryboardClip, 'voRole'>>(clips: T[]): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  for (const clip of clips) {
    if (clip.voRole === 'continue' && current.length > 0) {
      current.push(clip);
      continue;
    }
    if (current.length > 0) groups.push(current);
    current = [clip];
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function uniqueSliceConcat(slices: string[]): string {
  let joined = '';
  for (const slice of slices) {
    const trimmed = slice.trim();
    if (!trimmed) continue;
    const core = stripSpeechPunct(trimmed);
    if (core && joined.includes(core)) continue;
    joined += trimmed;
  }
  return joined;
}

export function utteranceText(group: Pick<StoryboardClip, 'narration' | 'voSlice' | 'voRole'>[]): string {
  if (group.length === 0) return '';
  const start = group[0];
  const fromNarration = withSentenceEnd((start.narration || '').trim());
  const concat = uniqueSliceConcat(group.map((clip) => clip.voSlice || ''));
  if (fromNarration && countNarrationChars(fromNarration) >= countNarrationChars(concat)) {
    return fromNarration;
  }
  return withSentenceEnd(concat || fromNarration);
}

function equalCharRanges(length: number, count: number): { start: number; end: number }[] {
  const n = Math.max(1, count);
  const ranges: { start: number; end: number }[] = [];
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const end = i === n - 1 ? length : Math.round(((i + 1) * length) / n);
    ranges.push({ start: cursor, end: Math.max(cursor, end) });
    cursor = ranges[i].end;
  }
  return ranges;
}

function ratioCharRanges(
  length: number,
  ratios: { startRatio: number; endRatio: number }[]
): { start: number; end: number }[] {
  if (ratios.length === 0) return [{ start: 0, end: length }];
  return ratios.map((ratio, index) => {
    const start = index === 0 ? 0 : Math.round(Math.max(0, Math.min(1, ratio.startRatio)) * length);
    const end = index === ratios.length - 1
      ? length
      : Math.round(Math.max(0, Math.min(1, ratio.endRatio)) * length);
    return { start: Math.min(start, end), end: Math.max(start, end) };
  });
}

function indexFrom(haystack: string, needle: string, from: number): number {
  if (!needle) return -1;
  const direct = haystack.indexOf(needle, from);
  if (direct >= 0) return direct;
  const core = stripSpeechPunct(needle);
  if (core && core !== needle) return haystack.indexOf(core, from);
  return -1;
}

/**
 * Split one spoken sentence onto N clips without overlapping characters.
 * Duplicate punchlines / empty slices fall back to ratio or equal split.
 */
export function partitionSpeechText(
  text: string,
  slices: string[],
  ratios?: { startRatio: number; endRatio: number }[]
): { start: number; end: number }[] {
  const n = Math.max(1, slices.length);
  if (!text) return slices.map(() => ({ start: 0, end: 0 }));
  if (n === 1) return [{ start: 0, end: text.length }];

  const cores = slices.map((slice) => compactSpeech(stripSpeechPunct(slice || '')));
  const nonemptyCores = cores.filter(Boolean);
  if (nonemptyCores.length >= 2 && new Set(nonemptyCores).size === 1) {
    return ratios && ratios.length === n ? ratioCharRanges(text.length, ratios) : equalCharRanges(text.length, n);
  }

  const located: Array<{ start: number; end: number } | null> = [];
  let searchFrom = 0;
  for (const slice of slices) {
    const raw = (slice || '').trim();
    if (!raw || isAlmostFullSpeech(raw, text)) {
      located.push(null);
      continue;
    }
    const core = stripSpeechPunct(raw) || raw;
    const idx = indexFrom(text, core, searchFrom);
    if (idx < 0) {
      located.push(null);
      continue;
    }
    const usedLen = text.startsWith(raw, idx) ? raw.length : core.length;
    const end = Math.min(text.length, idx + usedLen);
    located.push({ start: idx, end });
    searchFrom = end;
  }

  const hits = located.filter(Boolean) as { start: number; end: number }[];
  if (hits.length === 0) {
    return ratios && ratios.length === n ? ratioCharRanges(text.length, ratios) : equalCharRanges(text.length, n);
  }

  const occupied = [...hits].sort((a, b) => a.start - b.start);
  const gaps: { start: number; end: number }[] = [];
  let pos = 0;
  for (const hit of occupied) {
    if (hit.start > pos) gaps.push({ start: pos, end: hit.start });
    pos = Math.max(pos, hit.end);
  }
  if (pos < text.length) gaps.push({ start: pos, end: text.length });

  let gapIndex = 0;
  const ranges = located.map((hit) => {
    if (hit) return { ...hit };
    const gap = gaps[gapIndex++];
    return gap ? { ...gap } : { start: text.length, end: text.length };
  });

  if (ranges.length > 0) {
    ranges[0].start = 0;
    ranges[ranges.length - 1].end = text.length;
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i].start < ranges[i - 1].end) ranges[i].start = ranges[i - 1].end;
      if (ranges[i - 1].end < ranges[i].start && !located[i] && !located[i - 1]) {
        ranges[i].start = ranges[i - 1].end;
      }
    }
  }

  const empty = ranges.some((range) => countNarrationChars(text.slice(range.start, range.end)) === 0);
  if (empty) {
    return ratios && ratios.length === n ? ratioCharRanges(text.length, ratios) : equalCharRanges(text.length, n);
  }
  return ranges;
}

function splitUtteranceToClips(text: string, group: SpeechClip[]): { start: number; end: number }[] {
  return partitionSpeechText(
    text,
    group.map((clip) => clip.voSlice || '')
  );
}

export type SpeechUtterance = {
  text: string;
  clips: SpeechClip[];
};

export function utterancesFromClips(clips: SpeechClip[]): SpeechUtterance[] {
  return groupClipsByUtterance(clips)
    .map((group) => ({ text: utteranceText(group), clips: group }))
    .filter((item) => item.text);
}

/** Whole-sentence VO: one utterance per start+continue group, slices never counted twice. */
export function joinClipsForTts(
  clips: Pick<StoryboardClip, 'narration' | 'voRole' | 'voSlice'>[]
): string {
  return groupClipsByUtterance(clips)
    .map((group) => utteranceText(group))
    .filter(Boolean)
    .join('');
}

function monotonicRanges(cuts: number[], duration: number, count: number): { start: number; end: number }[] {
  const n = Math.max(1, count);
  if (n === 1) return [{ start: 0, end: duration }];
  const points = [0, ...cuts.map((value) => Math.max(0, Math.min(duration, value))), duration]
    .sort((a, b) => a - b);
  const unique: number[] = [];
  for (const point of points) {
    if (unique.length === 0 || point - unique[unique.length - 1] >= 0.05) unique.push(point);
  }
  if (unique[0] !== 0) unique.unshift(0);
  if (unique[unique.length - 1] !== duration) unique.push(duration);
  while (unique.length < n + 1) {
    let widest = 0;
    for (let i = 0; i < unique.length - 1; i++) {
      if (unique[i + 1] - unique[i] > unique[widest + 1] - unique[widest]) widest = i;
    }
    unique.splice(widest + 1, 0, (unique[widest] + unique[widest + 1]) / 2);
  }
  const ranges: { start: number; end: number }[] = [];
  for (let i = 0; i < n; i++) {
    const start = unique[Math.min(i, unique.length - 2)];
    const end = i === n - 1 ? duration : unique[Math.min(i + 1, unique.length - 1)];
    ranges.push({ start, end: Math.max(start, end) });
  }
  ranges[n - 1].end = duration;
  return ranges;
}

export function cutsFromWordMarks(
  text: string,
  slices: string[],
  words: NarrationWordMark[]
): number[] | null {
  if (!words.length || slices.length <= 1) return slices.length <= 1 ? [] : null;
  const parts = partitionSpeechText(text, slices);
  let joined = '';
  const charTime: { chars: number; time: number }[] = [];
  for (const word of words) {
    joined += compactSpeech(word.text);
    charTime.push({ chars: compactSpeech(joined).length, time: word.end });
  }
  if (charTime.length === 0 || charTime[charTime.length - 1].chars < countNarrationChars(text) * 0.45) {
    return null;
  }
  const cuts: number[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const need = countNarrationChars(text.slice(0, parts[i].end));
    const hit = charTime.find((item) => item.chars >= Math.max(1, need)) || charTime[charTime.length - 1];
    cuts.push(hit.time);
  }
  return cuts;
}

export function findEnergyCutTimes(
  buffer: {
    getChannelData: (channel: number) => Float32Array;
    numberOfChannels: number;
    sampleRate: number;
    duration: number;
  },
  hintTimes: number[],
  speechStart: number,
  speechEnd: number
): number[] {
  if (hintTimes.length === 0) return [];
  const channelCount = Math.max(1, buffer.numberOfChannels || 1);
  const sr = buffer.sampleRate || 24000;
  const win = Math.max(1, Math.round(sr * 0.01));
  const data0 = buffer.getChannelData(0);
  const rms: number[] = [];
  for (let i = 0; i < data0.length; i += win) {
    const n = Math.min(win, data0.length - i);
    let sum = 0;
    for (let c = 0; c < channelCount; c++) {
      const data = c === 0 ? data0 : buffer.getChannelData(c);
      for (let j = 0; j < n; j++) {
        const sample = data[i + j] || 0;
        sum += sample * sample;
      }
    }
    rms.push(Math.sqrt(sum / (n * channelCount)));
  }
  const median = [...rms].sort((a, b) => a - b)[Math.floor(rms.length / 2)] || 0;
  const cuts: number[] = [];
  for (const hint of hintTimes) {
    const center = Math.max(speechStart, Math.min(speechEnd, hint));
    const from = Math.max(0, Math.floor(((center - 0.38) * sr) / win));
    const to = Math.min(rms.length - 1, Math.ceil(((center + 0.38) * sr) / win));
    let best = center;
    let bestVal = Infinity;
    for (let i = from; i <= to; i++) {
      const prev = rms[Math.max(from, i - 1)];
      const next = rms[Math.min(to, i + 1)];
      const value = rms[i];
      const isValley = value <= prev && value <= next;
      if (isValley && value < bestVal) {
        bestVal = value;
        best = (i * win) / sr;
      }
    }
    if (bestVal < Infinity && bestVal <= Math.max(0.012, median * 0.55)) {
      cuts.push(best);
    } else {
      cuts.push(center);
    }
  }
  return cuts;
}

export function layoutUtteranceClips(input: {
  duration: number;
  slices: string[];
  text: string;
  words?: NarrationWordMark[];
  energyCuts?: number[];
}): { ranges: { start: number; end: number }[]; source: NarrationAlignSource } {
  const duration = Math.max(0.05, input.duration);
  const n = Math.max(1, input.slices.length);
  if (n === 1) return { ranges: [{ start: 0, end: duration }], source: 'per-utterance' };

  const wordCuts = input.words?.length ? cutsFromWordMarks(input.text, input.slices, input.words) : null;
  if (wordCuts && wordCuts.length === n - 1) {
    return { ranges: monotonicRanges(wordCuts, duration, n), source: 'word-boundary' };
  }
  if (input.energyCuts && input.energyCuts.length === n - 1) {
    return { ranges: monotonicRanges(input.energyCuts, duration, n), source: 'energy' };
  }
  const parts = partitionSpeechText(input.text, input.slices);
  const cuts = parts.slice(0, -1).map((part) => (part.end / Math.max(1, input.text.length)) * duration);
  return { ranges: monotonicRanges(cuts, duration, n), source: 'char-fallback' };
}

export function timingsFromUtteranceLayouts(
  utterances: SpeechUtterance[],
  layouts: { ranges: { start: number; end: number }[]; audioOffset: number }[]
): NarrationClipTiming[] {
  const timings: NarrationClipTiming[] = [];
  utterances.forEach((utterance, index) => {
    const layout = layouts[index];
    const offset = layout?.audioOffset ?? 0;
    utterance.clips.forEach((clip, clipIndex) => {
      const range = layout?.ranges[clipIndex] || { start: 0, end: 0 };
      timings.push({
        clipId: clip.id,
        audioStart: offset + range.start,
        audioEnd: offset + range.end
      });
    });
  });
  return timings;
}

export function timingsFromAlignment(
  clips: SpeechClip[],
  alignment: NarrationAlignment | undefined,
  audioDuration: number
): NarrationClipTiming[] | null {
  if (!alignment?.utterances?.length) return null;
  const groups = utterancesFromClips(clips);
  if (groups.length === 0) return null;
  const used = new Set<number>();
  const timings: NarrationClipTiming[] = [];
  groups.forEach((group, index) => {
    let markIndex = alignment.utterances.findIndex((item, itemIndex) => item.text === group.text && !used.has(itemIndex));
    if (markIndex < 0) markIndex = !used.has(index) ? index : -1;
    const mark = markIndex >= 0 ? alignment.utterances[markIndex] : undefined;
    if (!mark) return;
    used.add(markIndex);
    const span = Math.max(0.05, mark.audioEnd - mark.audioStart);
    const layout = layoutUtteranceClips({
      duration: span,
      slices: group.clips.map((clip) => clip.voSlice || ''),
      text: group.text
    });
    group.clips.forEach((clip, clipIndex) => {
      const range = layout.ranges[clipIndex] || { start: 0, end: span };
      timings.push({
        clipId: clip.id,
        audioStart: mark.audioStart + range.start,
        audioEnd: mark.audioStart + range.end
      });
    });
  });
  if (timings.length === 0) return null;
  const seen = new Set(timings.map((item) => item.clipId));
  clips.forEach((clip) => {
    if (!seen.has(clip.id)) {
      const last = timings[timings.length - 1];
      const t = last?.audioEnd ?? 0;
      timings.push({ clipId: clip.id, audioStart: t, audioEnd: t });
    }
  });
  return timings;
}

export function newClipId(index = 0, used?: Set<string>): string {
  let id = '';
  do {
    id = `clip-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
  } while (used?.has(id));
  used?.add(id);
  return id;
}

export function ensureUniqueClipIds<T extends { id: string }>(clips: T[]): T[] {
  if (!Array.isArray(clips) || clips.length === 0) return clips;
  const used = new Set<string>();
  let changed = false;
  const next = clips.map((clip, index) => {
    const raw = typeof clip.id === 'string' ? clip.id.trim() : '';
    if (raw && !used.has(raw)) {
      used.add(raw);
      if (clip.id === raw) return clip;
      changed = true;
      return { ...clip, id: raw };
    }
    changed = true;
    return { ...clip, id: newClipId(index, used) };
  });
  return changed ? next : clips;
}

/** Resolve one timing per clip. Duplicate clipIds are consumed in storyboard order, not last-write-wins. */
export function clipNarrationTimings(
  clips: { id: string }[],
  timings: NarrationClipTiming[] | undefined
): Array<NarrationClipTiming | undefined> {
  const rows = Array.isArray(timings) ? timings : [];
  const queue = new Map<string, NarrationClipTiming[]>();
  for (const row of rows) {
    if (!row?.clipId) continue;
    const list = queue.get(row.clipId);
    if (list) list.push(row);
    else queue.set(row.clipId, [row]);
  }
  return clips.map((clip) => {
    const list = queue.get(clip.id);
    if (list && list.length > 0) return list.shift();
    return undefined;
  });
}

function rewriteAlignmentClipIds(
  clips: SpeechClip[],
  alignment: NarrationAlignment | undefined
): NarrationAlignment | undefined {
  if (!alignment?.utterances?.length) return alignment;
  const groups = utterancesFromClips(clips);
  const used = new Set<number>();
  const utterances = alignment.utterances.map((mark) => ({
    ...mark,
    clipIds: Array.isArray(mark.clipIds) ? mark.clipIds.slice() : []
  }));
  groups.forEach((group, index) => {
    let markIndex = utterances.findIndex((item, itemIndex) => item.text === group.text && !used.has(itemIndex));
    if (markIndex < 0) markIndex = !used.has(index) ? index : -1;
    if (markIndex < 0) return;
    used.add(markIndex);
    utterances[markIndex] = {
      ...utterances[markIndex],
      clipIds: group.clips.map((clip) => clip.id)
    };
  });
  return { ...alignment, utterances };
}

export function repairClipSlices<T extends StoryboardClip>(clips: T[]): T[] {
  if (!Array.isArray(clips) || clips.length === 0) return clips;
  return groupClipsByUtterance(clips).flatMap((group) => {
    const text = utteranceText(group);
    if (group.length === 1) {
      const clip = group[0];
      const slice = (clip.voSlice || clip.narration || '').trim();
      return [{ ...clip, voSlice: slice || clip.voSlice }];
    }
    const ranges = splitUtteranceToClips(text, group);
    return group.map((clip, index) => {
      const slice = text.slice(ranges[index].start, ranges[index].end).trim();
      return { ...clip, voSlice: slice || clip.voSlice };
    });
  });
}

export function clipSpeechWeight(
  clip: Pick<StoryboardClip, 'narration' | 'voSlice' | 'speechDuration'>
): number {
  const sliceChars = countNarrationChars(clip.voSlice);
  if (sliceChars > 0) return sliceChars;
  const spokenChars = countNarrationChars(clip.narration);
  if (spokenChars > 0) return spokenChars;
  if (typeof clip.speechDuration === 'number' && clip.speechDuration > 0.05) {
    return clip.speechDuration;
  }
  return 0;
}

function speechShares(clips: SpeechClip[]): number[] {
  const weights = clips.map(() => 0);
  const indexOf = new Map(clips.map((clip, index) => [clip.id, index]));
  for (const group of groupClipsByUtterance(clips)) {
    const text = utteranceText(group);
    if (!text) continue;
    const ranges = splitUtteranceToClips(text, group);
    group.forEach((clip, offset) => {
      const index = indexOf.get(clip.id);
      if (index == null) return;
      const chars = countNarrationChars(text.slice(ranges[offset].start, ranges[offset].end));
      weights[index] = chars > 0 ? chars : 0;
    });
    const groupIndices = group.map((clip) => indexOf.get(clip.id)).filter((index): index is number => index != null);
    const groupTotal = groupIndices.reduce((sum, index) => sum + weights[index], 0);
    if (group.length > 1 && groupTotal === 0) {
      const fallback = Math.max(1, countNarrationChars(text));
      groupIndices.forEach((index) => {
        weights[index] = fallback / group.length;
      });
    }
  }
  return weights;
}

function hashPayload(payload: string): string {
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0;
  }
  return String(hash);
}

export function narrationSourceHash(
  clips: Pick<StoryboardClip, 'narration' | 'voRole' | 'voSlice'>[],
  voiceCharacter: string,
  speechRate: number,
  sourceKey = 'edge'
): string {
  return hashPayload(`${joinClipsForTts(clips)}|${voiceCharacter}|${speechRate}|${sourceKey}`);
}

function narrationSourceHashLegacy(
  clips: Pick<StoryboardClip, 'narration'>[],
  voiceCharacter: string,
  speechRate: number,
  sourceKey = 'edge'
): string {
  const payload = `${clips.map((clip) => (clip.narration || '').trim()).join('\u0001')}|${voiceCharacter}|${speechRate}|${sourceKey}`;
  return hashPayload(payload);
}

export function isNarrationTrackFresh(
  audio: AudioConfig | undefined,
  clips: Pick<StoryboardClip, 'id' | 'narration' | 'voRole' | 'voSlice'>[],
  ttsApi?: CustomTtsApiConfig
): boolean {
  const track = audio?.narrationTrack;
  if (!track?.audioUrl || !track.clips?.length) return false;
  const voice = audio?.voiceCharacter || 'magnetic-male';
  const sourceKey = ttsSourceKey(ttsApi, voice);
  const rate = audio?.speechRate || 1;
  const current = narrationSourceHash(clips, voice, rate, sourceKey);
  if (track.sourceHash === current) return true;
  return track.sourceHash === narrationSourceHashLegacy(clips, voice, rate, sourceKey);
}

export function allocateSpeechTimings(
  clips: SpeechClip[],
  audioDuration: number,
  window?: Partial<SpeechWindow> & { alignment?: NarrationAlignment }
): NarrationClipTiming[] {
  const aligned = timingsFromAlignment(clips, window?.alignment, audioDuration);
  if (aligned) return aligned;
  const safeDuration = Math.max(0.01, audioDuration);
  const speechStart = Math.max(0, Math.min(safeDuration, window?.speechStart ?? 0));
  const speechEnd = Math.max(speechStart + 0.01, Math.min(safeDuration, window?.speechEnd ?? safeDuration));
  const speakLen = Math.max(0.01, speechEnd - speechStart);
  const weights = speechShares(clips);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);

  let audioCursor = speechStart;
  const timings: NarrationClipTiming[] = clips.map((clip, index) => {
    const weight = weights[index];
    if (weight <= 0 || totalWeight <= 0) {
      return { clipId: clip.id, audioStart: audioCursor, audioEnd: audioCursor };
    }
    const span = (weight / totalWeight) * speakLen;
    const audioStart = audioCursor;
    audioCursor += span;
    return { clipId: clip.id, audioStart, audioEnd: audioCursor };
  });

  if (timings.length > 0) {
    const lastSpeaking = [...timings].reverse().find((item) => item.audioEnd > item.audioStart);
    if (lastSpeaking) lastSpeaking.audioEnd = speechEnd;
  }

  return timings;
}

export function applyNarrationTimingsToClips(
  clips: StoryboardClip[],
  timings: NarrationClipTiming[]
): StoryboardClip[] {
  const resolved = clipNarrationTimings(clips, timings);
  return clips.map((clip, index) => {
    const timing = resolved[index];
    const speechDuration = timing ? Math.max(0, timing.audioEnd - timing.audioStart) : 0;
    const holdDuration = clip.holdPinned ? Math.max(0, clip.holdDuration || 0) : 0;
    return {
      ...clip,
      speechDuration,
      holdDuration,
      duration: Math.max(0.05, Math.round((speechDuration + holdDuration) * 100) / 100)
    };
  });
}

/** Keep the same VO file, re-bind unique slice timings onto the current clips. */
export function relinkNarrationTrack(
  track: NarrationTrack | undefined,
  clips: StoryboardClip[]
): { track: NarrationTrack; clips: StoryboardClip[] } | null {
  if (!track?.audioUrl || !Number.isFinite(track.duration) || track.duration <= 0 || clips.length === 0) {
    return null;
  }
  const repaired = ensureUniqueClipIds(repairClipSlices(clips));
  const timings = allocateSpeechTimings(repaired, track.duration, {
    speechStart: track.speechStart,
    speechEnd: track.speechEnd,
    alignment: track.alignment
  });
  return {
    track: {
      ...track,
      clips: timings,
      alignment: rewriteAlignmentClipIds(repaired, track.alignment)
    },
    clips: applyNarrationTimingsToClips(repaired, timings)
  };
}

export function rebindProjectNarration<T extends { clips: StoryboardClip[]; audio: AudioConfig }>(project: T): T {
  const clips = ensureUniqueClipIds(repairClipSlices(project.clips || []));
  const track = project.audio?.narrationTrack;
  if (!track?.audioUrl || !Number.isFinite(track.duration) || track.duration <= 0 || clips.length === 0) {
    return { ...project, clips };
  }
  const timings = allocateSpeechTimings(clips, track.duration, {
    speechStart: track.speechStart,
    speechEnd: track.speechEnd,
    alignment: track.alignment
  });
  return {
    ...project,
    clips: applyNarrationTimingsToClips(clips, timings),
    audio: {
      ...project.audio,
      narrationTrack: {
        ...track,
        clips: timings,
        alignment: rewriteAlignmentClipIds(clips, track.alignment)
      }
    }
  };
}

export function mapNarrationToTimeline(
  audioTime: number,
  clips: StoryboardClip[],
  track: NarrationTrack
): number {
  const resolved = clipNarrationTimings(clips, track.clips);
  let cursor = 0;
  let lastAudioEnd = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const timing = resolved[i];
    const audioStart = timing?.audioStart ?? lastAudioEnd;
    const audioEnd = timing?.audioEnd ?? audioStart;
    const speech = Math.max(0, audioEnd - audioStart);
    const hold = clip.holdPinned ? Math.max(0, clip.holdDuration || 0) : 0;
    lastAudioEnd = audioEnd;

    if (audioTime + 0.0005 < audioEnd) {
      return cursor + Math.max(0, audioTime - audioStart);
    }
    cursor += speech + hold;
  }

  return cursor;
}

export function mapTimelineToNarration(
  timelineTime: number,
  clips: StoryboardClip[],
  track: NarrationTrack
): { audioTime: number; frozen: boolean } {
  const resolved = clipNarrationTimings(clips, track.clips);
  let cursor = 0;
  let lastAudioEnd = 0;

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const timing = resolved[i];
    const speechDuration = clip.speechDuration ?? Math.max(0, (timing?.audioEnd || 0) - (timing?.audioStart || 0));
    const holdDuration = clip.holdPinned ? Math.max(0, clip.holdDuration || 0) : 0;
    const clipDuration = speechDuration + holdDuration || clip.duration || 0.05;
    const local = timelineTime - cursor;
    const audioStart = timing?.audioStart ?? lastAudioEnd;
    const audioEnd = timing?.audioEnd ?? audioStart + speechDuration;

    if (local < clipDuration) {
      if (speechDuration > 0 && local < speechDuration) {
        return { audioTime: audioStart + local, frozen: false };
      }
      return { audioTime: audioEnd, frozen: true };
    }

    lastAudioEnd = audioEnd;
    cursor += clipDuration;
  }

  return { audioTime: track.duration, frozen: true };
}

export function detectSpeechBounds(buffer: {
  getChannelData: (channel: number) => Float32Array;
  numberOfChannels: number;
  sampleRate: number;
  duration: number;
}): { speechStart: number; speechEnd: number } {
  const channelCount = Math.max(1, buffer.numberOfChannels || 1);
  const sr = buffer.sampleRate || 24000;
  const duration = buffer.duration || 0;
  const win = Math.max(1, Math.round(sr * 0.01));
  const data0 = buffer.getChannelData(0);
  const rms: number[] = [];
  let peak = 0;
  for (let i = 0; i < data0.length; i += win) {
    const n = Math.min(win, data0.length - i);
    let sum = 0;
    for (let c = 0; c < channelCount; c++) {
      const data = c === 0 ? data0 : buffer.getChannelData(c);
      for (let j = 0; j < n; j++) {
        const sample = data[i + j] || 0;
        sum += sample * sample;
      }
    }
    const value = Math.sqrt(sum / (n * channelCount));
    rms.push(value);
    if (value > peak) peak = value;
  }
  const thresh = Math.max(0.008, peak * 0.07);
  let first = 0;
  let last = rms.length - 1;
  while (first < rms.length && rms[first] < thresh) first += 1;
  while (last > first && rms[last] < thresh) last -= 1;
  if (last <= first || peak < 0.01) {
    return { speechStart: 0, speechEnd: duration };
  }
  const pad = 0.05;
  const speechStart = Math.max(0, (first * win) / sr - pad);
  const speechEnd = Math.min(duration, ((last + 1) * win) / sr + pad);
  if (speechEnd - speechStart < 0.2) {
    return { speechStart: 0, speechEnd: duration };
  }
  return { speechStart, speechEnd };
}

export function measureAudioDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    const cleanup = () => {
      audio.onloadedmetadata = null;
      audio.onerror = null;
    };
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      cleanup();
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error('旁白音频时长无效'));
        return;
      }
      resolve(duration);
    };
    audio.onerror = () => {
      cleanup();
      reject(new Error('无法读取旁白音频'));
    };
    audio.src = url;
  });
}

export async function measureSpeechWindow(url: string): Promise<SpeechWindow> {
  const duration = await measureAudioDuration(url);
  const fallback: SpeechWindow = { duration, speechStart: 0, speechEnd: duration };
  if (typeof fetch !== 'function') return fallback;
  try {
    const AC = (typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
      | typeof AudioContext
      | undefined;
    if (!AC) return fallback;
    const res = await fetch(url);
    if (!res.ok) return fallback;
    const ctx = new AC();
    try {
      const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
      const bounds = detectSpeechBounds(buffer);
      const speechStart = Math.max(0, Math.min(duration, bounds.speechStart));
      const speechEnd = Math.max(speechStart + 0.05, Math.min(duration, bounds.speechEnd));
      return { duration, speechStart, speechEnd };
    } finally {
      void ctx.close();
    }
  } catch {
    return fallback;
  }
}
