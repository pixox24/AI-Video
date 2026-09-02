import { AudioConfig, StoryboardClip } from '../types';
import { OUTRO_HOLD_MAX } from './outro';

export const SENTENCE_GAP_DEFAULT = 0.2;
export const SENTENCE_GAP_MIN = 0;
export const SENTENCE_GAP_MAX = 2;
export const SENTENCE_GAP_STEP = 0.05;

export const SENTENCE_GAP_PRESETS = [
  { id: 'tight', label: '贴着', seconds: 0, hint: '句句紧挨，不换气' },
  { id: 'breath', label: '换气', seconds: 0.2, hint: '默认气口' },
  { id: 'punch', label: '金句', seconds: 0.5, hint: '让这句站住' },
  { id: 'hold', label: '停住', seconds: 1, hint: '戏剧停顿' }
] as const;

export type SentenceGapPresetId = (typeof SENTENCE_GAP_PRESETS)[number]['id'];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function clampSentenceGap(value: number | undefined | null): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return SENTENCE_GAP_DEFAULT;
  return round2(Math.max(SENTENCE_GAP_MIN, Math.min(SENTENCE_GAP_MAX, n)));
}

export function resolveSentenceGap(audio?: Pick<AudioConfig, 'sentenceGap'> | null): number {
  return audio?.sentenceGap == null ? SENTENCE_GAP_DEFAULT : clampSentenceGap(audio.sentenceGap);
}

export function formatSentenceGap(seconds: number): string {
  const n = clampSentenceGap(seconds);
  return Number.isInteger(n) ? `${n}` : n.toFixed(2).replace(/0$/, '');
}

export function matchingGapPreset(seconds: number): SentenceGapPresetId | null {
  const n = clampSentenceGap(seconds);
  const hit = SENTENCE_GAP_PRESETS.find((item) => Math.abs(item.seconds - n) < 0.001);
  return hit ? hit.id : null;
}

export function isUtteranceTail<T extends { voRole?: 'start' | 'continue' }>(
  clips: T[],
  index: number
): boolean {
  const next = clips[index + 1];
  return !next || next.voRole !== 'continue';
}

export function effectiveHoldDuration(
  clip: Pick<StoryboardClip, 'holdDuration' | 'holdPinned'>,
  index: number,
  clips: Pick<StoryboardClip, 'voRole' | 'holdDuration' | 'holdPinned'>[],
  sentenceGap?: number,
  outroHold?: number
): number {
  if (clip.holdPinned) {
    return round2(Math.max(0, Math.min(8, clip.holdDuration || 0)));
  }
  if (!isUtteranceTail(clips, index)) return 0;
  let base = sentenceGap == null
    ? clampSentenceGap(clip.holdDuration ?? SENTENCE_GAP_DEFAULT)
    : clampSentenceGap(sentenceGap);
  // 片尾停留只作用于全片最后一镜：钉住且更长时以钉住为准
  if (outroHold != null && index === clips.length - 1) {
    base = round2(Math.max(base, clampOutroHold(outroHold)));
  }
  return base;
}

export function clampOutroHold(value: number | undefined | null): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return round1(Math.max(0, Math.min(OUTRO_HOLD_MAX, n)));
}

export function stampSentenceGaps(
  clips: StoryboardClip[],
  sentenceGap?: number,
  outroHold?: number
): StoryboardClip[] {
  const gap = clampSentenceGap(sentenceGap);
  return clips.map((clip, index) => {
    const holdDuration = effectiveHoldDuration(clip, index, clips, gap, outroHold);
    const speechDuration = clip.speechDuration ?? Math.max(
      0.05,
      (clip.duration || 3.5) - (clip.holdDuration || 0)
    );
    return {
      ...clip,
      holdDuration,
      duration: Math.max(0.05, round2(speechDuration + holdDuration))
    };
  });
}

export function utteranceTailHold(
  group: Pick<StoryboardClip, 'holdDuration' | 'holdPinned'>[],
  sentenceGap?: number
): number {
  const tail = group[group.length - 1];
  if (!tail) return 0;
  if (tail.holdPinned) return round2(Math.max(0, Math.min(8, tail.holdDuration || 0)));
  return clampSentenceGap(sentenceGap);
}

/** True when the VO file already contains silence pads matching tail holds. */
export function narrationFileIncludesHolds(
  track: { duration?: number } | undefined,
  clips: Pick<StoryboardClip, 'speechDuration' | 'holdDuration' | 'voRole'>[]
): boolean {
  if (!track || !Number.isFinite(track.duration) || (track.duration || 0) <= 0) return false;
  const expected = clips.reduce((sum, clip, index) => {
    const speech = clip.speechDuration || 0;
    const hold = isUtteranceTail(clips, index) ? Math.max(0, clip.holdDuration || 0) : 0;
    return sum + speech + hold;
  }, 0);
  if (expected < 0.05) return false;
  return Math.abs((track.duration || 0) - expected) < 0.12;
}

export function extraGapSeconds(
  clips: Pick<StoryboardClip, 'holdDuration' | 'voRole' | 'holdPinned'>[],
  sentenceGap?: number
): number {
  return round2(clips.reduce((sum, clip, index) => (
    sum + effectiveHoldDuration(clip, index, clips, sentenceGap)
  ), 0));
}

export function utteranceSeamCount(
  clips: Pick<StoryboardClip, 'voRole'>[]
): number {
  return clips.reduce((sum, _clip, index) => sum + (isUtteranceTail(clips, index) ? 1 : 0), 0);
}
