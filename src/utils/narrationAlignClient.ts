import { NarrationAlignment, NarrationAlignSource, NarrationTrack, NarrationWordMark, StoryboardClip } from '../types';
import { blobToDataUrl, concatAudioBuffers, decodeAudioUrl, encodeWavPcm16, silentBuffer, sliceAudioBuffer } from './audioConcat';
import {
  applyNarrationTimingsToClips,
  detectSpeechBounds,
  ensureUniqueClipIds,
  findEnergyCutTimes,
  layoutUtteranceClips,
  partitionSpeechText,
  repairClipSlices,
  timingsFromUtteranceLayouts,
  utterancesFromClips
} from './narrationTrack';
import { clampSentenceGap, stampSentenceGaps } from './sentenceGap';

export type UtteranceSegment = {
  text: string;
  audioUrl: string;
  words?: NarrationWordMark[];
};

async function assembleFromBuffers(
  sourceClips: StoryboardClip[],
  items: { text: string; buffer: AudioBuffer; words?: NarrationWordMark[] }[],
  sentenceGap?: number,
  outroHold?: number
) {
  const gap = clampSentenceGap(sentenceGap);
  const clips = stampSentenceGaps(ensureUniqueClipIds(repairClipSlices(sourceClips)), gap, outroHold);
  const utterances = utterancesFromClips(clips);
  if (utterances.length === 0) {
    throw new Error('没有可对齐的旁白句');
  }
  if (items.length !== utterances.length) {
    throw new Error(`旁白句数不一致（文案 ${utterances.length}，音频 ${items.length}）`);
  }

  const buffers = [];
  const layouts = [];
  const marks: NarrationAlignment['utterances'] = [];
  let audioOffset = 0;

  for (let i = 0; i < utterances.length; i++) {
    const utterance = utterances[i];
    const item = items[i];
    const buffer = item.buffer;
    if (!buffer || buffer.length < 32) {
      throw new Error(`旁白句没有音频：${utterance.text.slice(0, 18)}`);
    }
    buffers.push(buffer);
    const bounds = detectSpeechBounds(buffer);
    const slices = utterance.clips.map((clip) => clip.voSlice || '');
    let energyCuts: number[] | undefined;
    if (utterance.clips.length > 1) {
      const parts = partitionSpeechText(utterance.text, slices);
      const speak = Math.max(0.05, bounds.speechEnd - bounds.speechStart);
      const hints = parts.slice(0, -1).map((part) => (
        bounds.speechStart + (part.end / Math.max(1, utterance.text.length)) * speak
      ));
      energyCuts = findEnergyCutTimes(buffer, hints, bounds.speechStart, bounds.speechEnd);
    }
    const layout = layoutUtteranceClips({
      duration: buffer.duration,
      slices,
      text: utterance.text,
      words: item.words,
      energyCuts
    });
    layouts.push({ ranges: layout.ranges, audioOffset, duration: buffer.duration });
    marks.push({
      text: utterance.text,
      audioStart: audioOffset,
      audioEnd: audioOffset + buffer.duration,
      clipIds: utterance.clips.map((clip) => clip.id),
      source: layout.source
    });
    audioOffset += buffer.duration;

    const tailId = utterance.clips[utterance.clips.length - 1]?.id;
    const tail = clips.find((clip) => clip.id === tailId);
    const pad = Math.max(0, tail?.holdDuration || 0);
    if (pad > 0.001) {
      buffers.push(silentBuffer(buffer.sampleRate, pad));
      audioOffset += pad;
    }
  }

  const sources = marks.map((mark) => mark.source);
  const overall: NarrationAlignSource = sources.includes('word-boundary')
    ? 'word-boundary'
    : sources.includes('energy')
      ? 'energy'
      : sources.includes('char-fallback')
        ? 'char-fallback'
        : 'per-utterance';

  const concatenated = await concatAudioBuffers(buffers);
  const wav = encodeWavPcm16(concatenated);
  const wavDataUrl = await blobToDataUrl(wav);
  const timings = timingsFromUtteranceLayouts(utterances, layouts);
  const nextClips = applyNarrationTimingsToClips(clips, timings, gap);
  const alignment: NarrationAlignment = {
    version: 2,
    source: overall,
    utterances: marks
  };

  return {
    wavDataUrl,
    duration: concatenated.duration,
    timings,
    alignment,
    clips: nextClips
  };
}

export async function assembleAlignedNarration(
  sourceClips: StoryboardClip[],
  segments: UtteranceSegment[],
  sentenceGap?: number,
  outroHold?: number
) {
  const clips = stampSentenceGaps(ensureUniqueClipIds(repairClipSlices(sourceClips)), sentenceGap, outroHold);
  const utterances = utterancesFromClips(clips);
  if (utterances.length === 0) {
    throw new Error('没有可对齐的旁白句');
  }
  if (segments.length !== utterances.length) {
    throw new Error(`旁白句数不一致（文案 ${utterances.length}，音频 ${segments.length}）`);
  }

  const items = [];
  for (let i = 0; i < utterances.length; i++) {
    const utterance = utterances[i];
    const segment = segments[i];
    const buffer = await decodeAudioUrl(segment.audioUrl);
    if (!buffer || buffer.length < 32) {
      throw new Error(`旁白句没有音频：${utterance.text.slice(0, 18)}`);
    }
    items.push({ text: utterance.text, buffer, words: segment.words });
  }

  return assembleFromBuffers(clips, items, sentenceGap, outroHold);
}

/** Re-pad an existing aligned VO file without calling TTS. */
export async function reassembleNarrationWithHolds(
  sourceClips: StoryboardClip[],
  track: NarrationTrack,
  sentenceGap?: number,
  outroHold?: number
) {
  if (!track.audioUrl || !track.alignment?.utterances?.length) return null;
  const clips = stampSentenceGaps(ensureUniqueClipIds(repairClipSlices(sourceClips)), sentenceGap, outroHold);
  const utterances = utterancesFromClips(clips);
  if (utterances.length === 0) return null;
  if (utterances.length !== track.alignment.utterances.length) return null;

  const full = await decodeAudioUrl(track.audioUrl);
  const used = new Set<number>();
  const items: { text: string; buffer: AudioBuffer }[] = [];

  for (let i = 0; i < utterances.length; i++) {
    const utterance = utterances[i];
    let markIndex = track.alignment.utterances.findIndex(
      (item, itemIndex) => item.text === utterance.text && !used.has(itemIndex)
    );
    if (markIndex < 0) markIndex = !used.has(i) ? i : -1;
    const mark = markIndex >= 0 ? track.alignment.utterances[markIndex] : undefined;
    if (!mark || mark.audioEnd <= mark.audioStart + 0.02) return null;
    used.add(markIndex);
    const slice = sliceAudioBuffer(full, mark.audioStart, mark.audioEnd);
    if (!slice || slice.length < 32) return null;
    items.push({ text: utterance.text, buffer: slice });
  }

  return assembleFromBuffers(clips, items, sentenceGap, outroHold);
}
