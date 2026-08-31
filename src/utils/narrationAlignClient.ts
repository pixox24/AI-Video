import { NarrationAlignment, NarrationAlignSource, NarrationWordMark, StoryboardClip } from '../types';
import { blobToDataUrl, concatAudioBuffers, decodeAudioUrl, encodeWavPcm16 } from './audioConcat';
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

export type UtteranceSegment = {
  text: string;
  audioUrl: string;
  words?: NarrationWordMark[];
};

export async function assembleAlignedNarration(
  sourceClips: StoryboardClip[],
  segments: UtteranceSegment[]
) {
  const clips = ensureUniqueClipIds(repairClipSlices(sourceClips));
  const utterances = utterancesFromClips(clips);
  if (utterances.length === 0) {
    throw new Error('没有可对齐的旁白句');
  }
  if (segments.length !== utterances.length) {
    throw new Error(`旁白句数不一致（文案 ${utterances.length}，音频 ${segments.length}）`);
  }

  const buffers = [];
  const layouts = [];
  const marks: NarrationAlignment['utterances'] = [];
  let audioOffset = 0;

  for (let i = 0; i < utterances.length; i++) {
    const utterance = utterances[i];
    const segment = segments[i];
    const buffer = await decodeAudioUrl(segment.audioUrl);
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
      words: segment.words,
      energyCuts
    });
    layouts.push({ ranges: layout.ranges, audioOffset });
    marks.push({
      text: utterance.text,
      audioStart: audioOffset,
      audioEnd: audioOffset + buffer.duration,
      clipIds: utterance.clips.map((clip) => clip.id),
      source: layout.source
    });
    audioOffset += buffer.duration;
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
  const nextClips = applyNarrationTimingsToClips(clips, timings);
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
