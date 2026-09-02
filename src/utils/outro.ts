/**
 * 片尾收束（Outro）：旁白结束后的画面延续 + 画面渐隐 + 音乐淡出。
 * 时间轴结构（全部钳制在旁白结束点之后，绝不吃掉旁白）：
 *   旁白结束 → 画面延续(hold) → 画面渐隐(pictureFade) → 黑场结束
 *   音乐淡出窗口 = 片尾总窗的末尾 min(musicFade, 总窗) 秒，默认恰好从旁白结束点开始渐弱。
 */
import { OutroConfig, ProjectSettings, StoryboardClip } from '../types';

export const OUTRO_DEFAULT: OutroConfig = { hold: 1.2, pictureFade: 0.8, musicFade: 2 };
export const OUTRO_HOLD_MAX = 5;
export const OUTRO_FADE_MAX = 3;

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function clampOutro(config: OutroConfig): OutroConfig {
  const num = (v: number, max: number) => round1(Math.max(0, Math.min(max, Number.isFinite(v) ? v : 0)));
  return {
    hold: num(config.hold, OUTRO_HOLD_MAX),
    pictureFade: num(config.pictureFade, OUTRO_FADE_MAX),
    musicFade: num(config.musicFade, OUTRO_HOLD_MAX)
  };
}

/** 旧工程没有 outro 字段时直接得到默认值，零迁移成本。 */
export function resolveOutro(settings?: Pick<ProjectSettings, 'outro'> | null): OutroConfig {
  const raw = settings?.outro;
  if (!raw) return { ...OUTRO_DEFAULT };
  return clampOutro({
    hold: typeof raw.hold === 'number' ? raw.hold : OUTRO_DEFAULT.hold,
    pictureFade: typeof raw.pictureFade === 'number' ? raw.pictureFade : OUTRO_DEFAULT.pictureFade,
    musicFade: typeof raw.musicFade === 'number' ? raw.musicFade : OUTRO_DEFAULT.musicFade
  });
}

export interface OutroTimeline {
  totalDuration: number;
  speechEnd: number; // 旁白结束点 = 片尾窗口起点
  fadeStart: number; // 画面开始渐黑
  fadeDuration: number; // 实际渐隐时长（钳制后）
  musicFadeStart: number; // 音乐开始渐弱
  musicFadeDuration: number; // 实际音乐淡出时长（钳制后）
  tailIndex: number;
}

function tailHoldOf(clips: StoryboardClip[]): number {
  const tail = clips[clips.length - 1];
  if (!tail) return 0;
  if (typeof tail.holdDuration === 'number') return Math.max(0, tail.holdDuration);
  if (typeof tail.speechDuration === 'number') return Math.max(0, (tail.duration || 0) - tail.speechDuration);
  return 0;
}

export function outroTimeline(clips: StoryboardClip[], config: OutroConfig): OutroTimeline | null {
  if (!clips.length) return null;
  const totalDuration = clips.reduce((acc, clip) => acc + (clip.duration || 0), 0);
  if (totalDuration <= 0) return null;
  const speechEnd = Math.max(0, totalDuration - tailHoldOf(clips));
  const window = Math.max(0, totalDuration - speechEnd);
  const fadeDuration = Math.min(Math.max(0, config.pictureFade), window);
  const musicFadeDuration = Math.min(Math.max(0, config.musicFade), window);
  return {
    totalDuration,
    speechEnd,
    fadeStart: totalDuration - fadeDuration,
    fadeDuration,
    musicFadeStart: totalDuration - musicFadeDuration,
    musicFadeDuration,
    tailIndex: clips.length - 1
  };
}

/** 当前时刻的黑色遮罩透明度（0 = 无遮罩）。 */
export function outroFadeAlpha(timeline: OutroTimeline | null, time: number): number {
  if (!timeline || timeline.fadeDuration <= 0) return 0;
  if (time <= timeline.fadeStart) return 0;
  return Math.min(1, (time - timeline.fadeStart) / timeline.fadeDuration);
}
