/**
 * 中英双语字幕英文行（secondaryText）的生命周期工具。
 * 不变式：翻译单位 = 显示单位（clipShotNarration），逐单元哈希锁定中英对应，
 * 哈希不匹配即视为过期，渲染端宁可隐藏也不画错位字幕。
 */
import { StoryboardClip } from '../types';
import { clipShotNarration } from './narrationTrack';

export interface SecondaryUnit {
  id: string;
  zh: string;
}

const PUNCT_RE = /[\s\p{P}\p{S}]+/gu;

export function zhHash(text: string): string {
  const normalized = (text || '').replace(PUNCT_RE, '');
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash + normalized.charCodeAt(i)) | 0;
  }
  return `${normalized.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

/** 画面上实际显示的中文文本（切片优先于整句，与渲染端一致）。 */
export function secondaryDisplayText(clip: Pick<StoryboardClip, 'narration' | 'voSlice'>): string {
  return clipShotNarration(clip);
}

function isSecondaryLatin(text: string): boolean {
  return ((text || '').match(/[A-Za-z]/g) || []).length >= 3;
}

function sameSubtitleText(a: string, b: string): boolean {
  return (a || '').replace(PUNCT_RE, '').toLowerCase() === (b || '').replace(PUNCT_RE, '').toLowerCase();
}

/** 渲染端判定：这镜的英文行是否可信可画（存在、是英文、与当前中文逐字对应）。 */
export function isSecondaryUsable(
  clip: Pick<StoryboardClip, 'narration' | 'voSlice' | 'secondaryText' | 'secondaryHash'>
): boolean {
  const en = (clip.secondaryText || '').trim();
  if (!en || !isSecondaryLatin(en)) return false;
  const zh = secondaryDisplayText(clip);
  if (!zh || sameSubtitleText(zh, en)) return false;
  // 无哈希的旧数据（示例工程、润色产物）无法校验，保留显示
  if (clip.secondaryHash) return clip.secondaryHash === zhHash(zh);
  return true;
}

/** 需要进翻译队列：缺英文、非英文、或与当前中文不再对应。 */
export function pendingTranslateUnits(clips: StoryboardClip[]): SecondaryUnit[] {
  const units: SecondaryUnit[] = [];
  const seen = new Set<string>();
  for (const clip of clips) {
    if (seen.has(clip.id)) continue;
    seen.add(clip.id);
    const zh = secondaryDisplayText(clip);
    if (!zh) continue;
    if (!isSecondaryUsable(clip) || !clip.secondaryHash) {
      units.push({ id: clip.id, zh });
    }
  }
  return units;
}

export function secondaryCoverage(clips: StoryboardClip[]): { total: number; fresh: number; stale: number } {
  let total = 0;
  let fresh = 0;
  for (const clip of clips) {
    if (!secondaryDisplayText(clip)) continue;
    total++;
    if (isSecondaryUsable(clip)) fresh++;
  }
  return { total, fresh, stale: total - fresh };
}

export function applySecondaryTranslation(
  clips: StoryboardClip[],
  translations: Map<string, string>
): StoryboardClip[] {
  return clips.map((clip) => {
    const en = translations.get(clip.id);
    if (!en) return clip;
    return { ...clip, secondaryText: en, secondaryHash: zhHash(secondaryDisplayText(clip)) };
  });
}

export interface SecondaryTranslateResult {
  clips: StoryboardClip[];
  translated: number;
  failed: number;
  error?: string;
}

/** 批量补齐英文双语行：发送显示单元，按 ID 锚定回填。 */
export async function translateClipsSecondary(
  clips: StoryboardClip[],
  llmApi?: unknown
): Promise<SecondaryTranslateResult> {
  const units = pendingTranslateUnits(clips);
  if (units.length === 0) return { clips, translated: 0, failed: 0 };
  try {
    let res: Response;
    try {
      res = await fetch('/api/script/translate-secondary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units, llmApi })
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
      if (item && typeof item.id === 'string' && typeof item.en === 'string' && item.en.trim()) {
        map.set(item.id, item.en.trim());
      }
    }
    if (map.size === 0) {
      throw new Error(String(data?.error || '模型没有返回可用英文，请检查设置里的 LLM API 配置'));
    }
    return {
      clips: applySecondaryTranslation(clips, map),
      translated: map.size,
      failed: units.length - map.size,
      error: map.size < units.length ? `有 ${units.length - map.size} 条未译出` : undefined
    };
  } catch (err: any) {
    return { clips, translated: 0, failed: units.length, error: err?.message || '英文翻译失败' };
  }
}
