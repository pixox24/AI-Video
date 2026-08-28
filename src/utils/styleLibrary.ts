import { StyleLibraryEntry, StylePack, StyleShelfConfig, VisualStyle } from '../types';
import { nearestVisualStyleFromPack } from './stylePack';

const STORAGE_KEY = 'ai_video_style_library';
export const STYLE_LIBRARY_MAX = 24;

export interface StyleCatalogDraft {
  title: string;
  tags: string[];
  blurb: string;
}

function uid(): string {
  return `library:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadRaw(): StyleLibraryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && item.pack && item.title);
  } catch {
    return [];
  }
}

const MAX_THUMB_CHARS = 160000;

function compactThumb(dataUrl?: string): string | undefined {
  if (!dataUrl) return undefined;
  return dataUrl.length <= MAX_THUMB_CHARS ? dataUrl : undefined;
}

function slimLibraryEntry(entry: StyleLibraryEntry): StyleLibraryEntry {
  const thumb = compactThumb(entry.thumbDataUrl) || compactThumb(entry.pack.reference?.thumbDataUrl);
  return {
    ...entry,
    thumbDataUrl: thumb,
    pack: {
      ...entry.pack,
      reference: entry.pack.reference
        ? { ...entry.pack.reference, thumbDataUrl: thumb }
        : undefined
    }
  };
}

function persist(entries: StyleLibraryEntry[]) {
  const slim = entries.map(slimLibraryEntry);
  const write = (payload: StyleLibraryEntry[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  };
  try {
    write(slim);
    return;
  } catch {
    try {
      localStorage.removeItem('ai_video_style_infer_cache');
      write(slim);
      return;
    } catch {
      const bare = slim.map((entry) => ({
        ...entry,
        pack: {
          ...entry.pack,
          reference: entry.pack.reference
            ? { imageId: entry.pack.reference.imageId, notes: entry.pack.reference.notes }
            : undefined
        }
      }));
      try {
        write(bare);
        return;
      } catch {
        throw new Error('浏览器本地空间不足，不是风格数量超限。分镜原图和旁白占用了大部分空间，请先减少工程里的大图或刷新后再推送。');
      }
    }
  }
}

export function loadStyleLibrary(): StyleLibraryEntry[] {
  return loadRaw().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function catalogFromPack(pack: StylePack): StyleCatalogDraft {
  const medium = (pack.render.medium || '').toLowerCase();
  const era = pack.world.era || '';
  const hay = `${pack.label} ${era} ${pack.world.wardrobe} ${medium}`;

  const tags: string[] = [];
  const push = (tag: string) => {
    if (tag && !tags.includes(tag) && tags.length < 4) tags.push(tag);
  };

  if (/水墨|墨|工笔|国画|ink/.test(hay)) push('水墨');
  else if (/胶片|film|portra|kodak/.test(hay)) push('胶片');
  else if (/矢量|扁平|vector|flat/.test(hay)) push('矢量');
  else if (/三维|cgi|unreal|octane/.test(hay)) push('三维');
  else if (/动漫|新海|anime/.test(hay)) push('动漫');
  else if (/赛博|霓虹|cyber|neon/.test(hay)) push('赛博');
  else if (/摄影|photoreal|photograph/.test(hay)) push('写实');
  else push('风格');

  if (/古|唐|宋|明|清|汉服|袍|东方|写意/.test(hay)) push('古风');
  else if (/近未来|机能|义体/.test(hay)) push('近未来');
  else if (/当代|现代|日常/.test(hay)) push('当代');

  if (pack.source === 'inferred' && pack.dna) push('风格基因');
  else if (pack.contemporaryPolicy === 'adapt') push('译入世界');
  else if (pack.contemporaryPolicy === 'costume') push('只换画法');
  else push('只改光影');

  let title = (pack.label || '').trim().slice(0, 16);
  if (!title || title === '反推风格' || title === '风格基因') {
    title = `${tags[0] || '风格'} · ${pack.dna?.mood?.[0] || era}`.replace(/·\s*$/, '').trim().slice(0, 16) || '我的风格基因';
  }

  const moodLine = (pack.dna?.mood || []).join('、');
  const palette = (pack.dna?.color?.palette || []).slice(0, 3).join('、');
  const wardrobe = (pack.world.wardrobe || '').replace(/。+$/, '');
  const space = (pack.world.space || '').replace(/。+$/, '');
  const blurb = (pack.dna
    ? [moodLine, palette || pack.dna.rendering?.medium]
    : [wardrobe, space]
  ).filter(Boolean).join('。').slice(0, 48) || '从参考图固化的视觉基因';

  return { title, tags, blurb };
}

export function makeStyleCardThumb(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const width = 512;
      const height = 288;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      const scale = Math.max(width / img.naturalWidth, height / img.naturalHeight);
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export function libraryCardSrc(entry: StyleLibraryEntry): string | undefined {
  const card = entry.thumbDataUrl;
  const source = entry.pack.reference?.thumbDataUrl;
  if (card && source) return source.length > card.length ? source : card;
  return card || source;
}

export function findLibraryByImageHash(hash?: string | null): StyleLibraryEntry | null {
  if (!hash) return null;
  return loadStyleLibrary().find((item) => item.imageHash === hash) || null;
}

export function findLibraryById(id: string): StyleLibraryEntry | null {
  return loadStyleLibrary().find((item) => item.id === id) || null;
}

export type SaveStyleLibraryInput = {
  pack: StylePack;
  title: string;
  tags: string[];
  blurb: string;
  thumbDataUrl?: string;
  imageHash?: string;
  nearestVisualStyle?: VisualStyle;
  overwriteId?: string;
  forceNew?: boolean;
};

export type SaveStyleLibraryResult =
  | { ok: true; entry: StyleLibraryEntry; overwritten: boolean }
  | { ok: false; reason: 'full' }
  | { ok: false; reason: 'duplicate'; existing: StyleLibraryEntry };

export function saveStyleLibraryEntry(input: SaveStyleLibraryInput): SaveStyleLibraryResult {
  const list = loadStyleLibrary();
  const title = input.title.trim().slice(0, 16) || '我的美术世界';
  const tags = input.tags.map((item) => item.trim()).filter(Boolean).slice(0, 4);
  const blurb = input.blurb.trim().slice(0, 48) || '从参考图固化的美术世界';
  const now = Date.now();

  const existingById = input.overwriteId ? list.find((item) => item.id === input.overwriteId) : undefined;
  const existingByHash =
    !input.forceNew && !existingById && input.imageHash
      ? list.find((item) => item.imageHash === input.imageHash)
      : undefined;
  const existing = existingById || existingByHash;

  if (existingByHash && !input.overwriteId && !input.forceNew) {
    return { ok: false, reason: 'duplicate', existing: existingByHash };
  }

  if (!existing && list.length >= STYLE_LIBRARY_MAX) {
    return { ok: false, reason: 'full' };
  }

  const id = existing?.id || uid();
  const nearest = input.nearestVisualStyle || nearestVisualStyleFromPack(input.pack);
  const pack: StylePack = {
    ...input.pack,
    id,
    source: 'inferred',
    label: title,
    pinned: true,
    createdAt: existing?.pack.createdAt || input.pack.createdAt || now,
    reference: {
      imageId: input.imageHash || input.pack.reference?.imageId || id,
      notes: input.pack.reference?.notes,
      thumbDataUrl: compactThumb(input.thumbDataUrl) || compactThumb(input.pack.reference?.thumbDataUrl)
    }
  };

  const entry: StyleLibraryEntry = {
    id,
    pack,
    title,
    tags,
    blurb,
    thumbDataUrl: compactThumb(input.thumbDataUrl) || compactThumb(existing?.thumbDataUrl),
    imageHash: input.imageHash || existing?.imageHash,
    nearestVisualStyle: nearest,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  const next = [entry, ...list.filter((item) => item.id !== id)].sort((a, b) => b.updatedAt - a.updatedAt);
  persist(next);
  return { ok: true, entry, overwritten: Boolean(existing) };
}

export function removeStyleLibraryEntry(id: string): StyleLibraryEntry[] {
  const next = loadStyleLibrary().filter((item) => item.id !== id);
  persist(next);
  unpinStyleId(id);
  return next;
}

const PINS_KEY = 'ai_video_style_pins';
export const STYLE_PIN_MAX = 3;

export function loadStylePins(): string[] {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function persistPins(ids: string[]) {
  localStorage.setItem(PINS_KEY, JSON.stringify(ids.slice(0, STYLE_PIN_MAX)));
}

export function unpinStyleId(id: string): string[] {
  const next = loadStylePins().filter((item) => item !== id);
  persistPins(next);
  return next;
}

export function toggleStylePin(id: string): { pins: string[]; ok: boolean; reason?: 'full' } {
  const pins = loadStylePins();
  if (pins.includes(id)) {
    const next = pins.filter((item) => item !== id);
    persistPins(next);
    return { pins: next, ok: true };
  }
  if (pins.length >= STYLE_PIN_MAX) {
    return { pins, ok: false, reason: 'full' };
  }
  const next = [id, ...pins];
  persistPins(next);
  return { pins: next, ok: true };
}

export function updateStyleLibraryEntry(
  id: string,
  patch: { title?: string; blurb?: string; tags?: string[] }
): StyleLibraryEntry[] {
  const list = loadStyleLibrary();
  const next = list.map((item) => {
    if (item.id !== id) return item;
    const title = (patch.title ?? item.title).trim().slice(0, 16) || item.title;
    return {
      ...item,
      title,
      blurb: (patch.blurb ?? item.blurb).trim().slice(0, 48) || item.blurb,
      tags: patch.tags ? patch.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 4) : item.tags,
      pack: { ...item.pack, label: title }
    };
  });
  persist(next);
  return next.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function splitLibraryByPins(library: StyleLibraryEntry[], pinnedIds: string[]) {
  const byId = new Map(library.map((item) => [item.id, item]));
  const pinned = pinnedIds.map((id) => byId.get(id)).filter((item): item is StyleLibraryEntry => Boolean(item));
  const rest = library.filter((item) => !pinnedIds.includes(item.id));
  return { pinned, rest };
}

export function hydrateStyleShelf(shelf?: StyleShelfConfig | null): StyleShelfConfig {
  const hidden = Array.isArray(shelf?.hiddenPresetIds) ? shelf!.hiddenPresetIds : [];
  const allowed: VisualStyle[] = [
    'photorealistic',
    'cinematic',
    'anime',
    'cyberpunk',
    '3d-render',
    'chinese-ink',
    'vintage-film',
    'vector-art'
  ];
  return {
    hiddenPresetIds: hidden.filter((id): id is VisualStyle => allowed.includes(id))
  };
}
