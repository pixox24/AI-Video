/**
 * 双语字幕翻译行（secondaryText）的生命周期工具。
 * 不变式：翻译单位 = 显示单位（clipShotNarration），逐单元哈希锁定主行与翻译对应，
 * 哈希不匹配即视为过期，渲染端宁可隐藏也不画错位字幕。
 */
import { ScriptLanguage, StoryboardClip } from '../types';
import { clipShotNarration } from './narrationTrack';
import {
  bilingualTarget,
  countCjk,
  countLatin,
  inferScriptLanguage,
  looksLikeSecondary,
  normalizeScriptLanguage
} from './scriptLanguage';

export interface SecondaryUnit {
  id: string;
  text: string;
  zh?: string;
}

const PUNCT_RE = /[\s\p{P}\p{S}]+/gu;

export function zhHash(text: string): string {
  return primaryHash(text);
}

export function primaryHash(text: string): string {
  const normalized = (text || '').replace(PUNCT_RE, '');
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return `${normalized.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/** 画面上实际显示的口播文本（切片优先于整句，与渲染端一致）。 */
export function secondaryDisplayText(clip: Pick<StoryboardClip, 'narration' | 'voSlice'>): string {
  return clipShotNarration(clip);
}

function sameSubtitleText(a: string, b: string): boolean {
  return (a || '').replace(PUNCT_RE, '').toLowerCase() === (b || '').replace(PUNCT_RE, '').toLowerCase();
}

export function resolveClipScriptLanguage(
  clip: Pick<StoryboardClip, 'narration' | 'voSlice'>,
  language?: ScriptLanguage | null
): ScriptLanguage {
  if (language) return normalizeScriptLanguage(language);
  return inferScriptLanguage(secondaryDisplayText(clip));
}

/** 渲染端判定：翻译行是否可信可画（存在、是对方语言、与当前主行逐字对应）。 */
export function isSecondaryUsable(
  clip: Pick<StoryboardClip, 'narration' | 'voSlice' | 'secondaryText' | 'secondaryHash'>,
  language?: ScriptLanguage | null
): boolean {
  const translated = (clip.secondaryText || '').trim();
  if (!translated) return false;
  const primary = secondaryDisplayText(clip);
  if (!primary || sameSubtitleText(primary, translated)) return false;
  const scriptLanguage = resolveClipScriptLanguage(clip, language);
  if (!looksLikeSecondary(translated, scriptLanguage)) return false;
  if (clip.secondaryHash) return clip.secondaryHash === primaryHash(primary);
  return true;
}

/** 需要进翻译队列：缺翻译、语言不对、或与当前主行不再对应。 */
export function pendingTranslateUnits(
  clips: StoryboardClip[],
  language?: ScriptLanguage | null
): SecondaryUnit[] {
  const units: SecondaryUnit[] = [];
  const seen = new Set<string>();
  for (const clip of clips) {
    if (seen.has(clip.id)) continue;
    seen.add(clip.id);
    const text = secondaryDisplayText(clip);
    if (!text) continue;
    if (!isSecondaryUsable(clip, language) || !clip.secondaryHash) {
      units.push({ id: clip.id, text, zh: text });
    }
  }
  return units;
}

export function secondaryCoverage(
  clips: StoryboardClip[],
  language?: ScriptLanguage | null
): { total: number; fresh: number; stale: number } {
  let total = 0;
  let fresh = 0;
  for (const clip of clips) {
    if (!secondaryDisplayText(clip)) continue;
    total++;
    if (isSecondaryUsable(clip, language)) fresh++;
  }
  return { total, fresh, stale: total - fresh };
}

export function applySecondaryTranslation(
  clips: StoryboardClip[],
  translations: Map<string, string>
): StoryboardClip[] {
  return clips.map((clip) => {
    const translated = translations.get(clip.id);
    if (!translated) return clip;
    return { ...clip, secondaryText: translated, secondaryHash: primaryHash(secondaryDisplayText(clip)) };
  });
}

export interface SecondaryTranslateResult {
  clips: StoryboardClip[];
  translated: number;
  failed: number;
  error?: string;
}

function pickTranslatedText(item: { text?: unknown; en?: unknown; zh?: unknown }): string {
  if (typeof item.text === 'string' && item.text.trim()) return item.text.trim();
  if (typeof item.en === 'string' && item.en.trim()) return item.en.trim();
  if (typeof item.zh === 'string' && item.zh.trim()) return item.zh.trim();
  return '';
}

/** 批量补齐翻译行：发送显示单元，按 ID 锚定回填。 */
export async function translateClipsSecondary(
  clips: StoryboardClip[],
  llmApi?: unknown,
  language?: ScriptLanguage | null
): Promise<SecondaryTranslateResult> {
  const from = clips.length
    ? resolveClipScriptLanguage(clips[0], language)
    : normalizeScriptLanguage(language);
  const to = bilingualTarget(from);
  const units = pendingTranslateUnits(clips, from);
  if (units.length === 0) return { clips, translated: 0, failed: 0 };
  try {
    let res: Response;
    try {
      res = await fetch('/api/script/translate-secondary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units, llmApi, from, to, scriptLanguage: from })
      });
    } catch {
      throw new Error('连不上应用服务，请确认 AI-Video 已启动（或刷新页面后重试）');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data?.items)) {
      throw new Error(data?.error || `翻译服务返回异常（HTTP ${res.status}）`);
    }
    const map = new Map<string, string>();
    for (const item of data.items) {
      if (!item || typeof item.id !== 'string') continue;
      const translated = pickTranslatedText(item);
      if (translated) map.set(item.id, translated);
    }
    if (map.size === 0) {
      throw new Error(String(data?.error || '模型没有返回可用翻译，请检查设置里的 LLM API 配置'));
    }
    return {
      clips: applySecondaryTranslation(clips, map),
      translated: map.size,
      failed: units.length - map.size,
      error: map.size < units.length ? `有 ${units.length - map.size} 条未译出` : undefined
    };
  } catch (err: any) {
    return { clips, translated: 0, failed: units.length, error: err?.message || '翻译失败' };
  }
}

export function secondaryLooksPlausible(source: string, translated: string, from: ScriptLanguage): boolean {
  if (from === 'zh') {
    const zhChars = countCjk(source) || source.replace(/\s/g, '').length;
    const enWords = translated.trim().split(/\s+/).filter(Boolean).length;
    const ratio = enWords / Math.max(1, zhChars);
    return ratio >= 0.2 && ratio <= 2.6;
  }
  const words = source.trim().split(/\s+/).filter(Boolean).length;
  const zhChars = countCjk(translated) || translated.replace(/\s/g, '').length;
  const ratio = zhChars / Math.max(1, words);
  return ratio >= 0.4 && ratio <= 3.0;
}

export function secondaryTooLong(translated: string, from: ScriptLanguage): boolean {
  if (from === 'zh') return translated.length > 80;
  return countCjk(translated) > 40 || translated.length > 60;
}

export function looksTranslated(translated: string, from: ScriptLanguage): boolean {
  if (from === 'zh') return countLatin(translated) >= 3 && countCjk(translated) === 0;
  return countCjk(translated) >= 2;
}
