import { NarrationTrack } from '../types';
import { blobToDataUrl, encodeWavPcm16, sliceAudioBuffer } from './audioConcat';

export type UtteranceTtsJob = {
  index: number;
  text: string;
  reuse: boolean;
  audioUrl?: string;
  words?: { text: string; start: number; end: number }[];
  slice?: { start: number; end: number };
};

export function normalizeUtteranceText(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

export function planUtteranceTts(
  texts: string[],
  track?: NarrationTrack | null,
  voiceCharacter?: string,
  speechRate?: number
): UtteranceTtsJob[] {
  const sameVoice = !track || (
    (!voiceCharacter || track.voiceCharacter === voiceCharacter)
    && (speechRate == null || Number(track.speechRate) === Number(speechRate))
  );
  const marks = sameVoice ? (track?.alignment?.utterances || []) : [];
  const used = new Set<number>();
  return texts.map((text, index) => {
    const needle = normalizeUtteranceText(text);
    if (!needle) return { index, text, reuse: false };
    let markIndex = marks.findIndex((mark, itemIndex) => (
      !used.has(itemIndex) && normalizeUtteranceText(mark.text) === needle
    ));
    if (markIndex < 0) return { index, text, reuse: false };
    used.add(markIndex);
    const mark = marks[markIndex];
    if (mark.audioUrl) {
      return { index, text, reuse: true, audioUrl: mark.audioUrl, words: mark.words };
    }
    if (track?.audioUrl && mark.audioEnd > mark.audioStart + 0.02) {
      return {
        index,
        text,
        reuse: true,
        audioUrl: track.audioUrl,
        slice: { start: mark.audioStart, end: mark.audioEnd }
      };
    }
    return { index, text, reuse: false };
  });
}

export function ttsReuseSummary(jobs: UtteranceTtsJob[]): { reuse: number; fresh: number } {
  const reuse = jobs.filter((job) => job.reuse).length;
  return { reuse, fresh: jobs.length - reuse };
}

export async function materializeReusedSegment(
  job: UtteranceTtsJob,
  fullBuffer?: AudioBuffer | null
): Promise<{ text: string; audioUrl: string; words?: UtteranceTtsJob['words'] } | null> {
  if (job.audioUrl && !job.slice) {
    return { text: job.text, audioUrl: job.audioUrl, words: job.words };
  }
  if (job.slice && fullBuffer) {
    const slice = sliceAudioBuffer(fullBuffer, job.slice.start, job.slice.end);
    if (!slice || slice.length < 32) return null;
    const audioUrl = await blobToDataUrl(encodeWavPcm16(slice));
    return { text: job.text, audioUrl };
  }
  return null;
}
