import { SubtitleConfig } from '../types';

export const SYSTEM_FONT_ID = 'system-cjk';

const CJK_FALLBACK = '"PingFang SC", "Microsoft YaHei", sans-serif';
export const SYSTEM_FONT_STACK = `system-ui, -apple-system, ${CJK_FALLBACK}`;

export interface StudioFont {
  id: string;
  name: string;
  desc: string;
  family: string;
  url?: string;
  synthBold: boolean;
}

export interface SubtitleTypeface {
  primaryFamily: string;
  primaryWeight: string;
  secondaryFamily: string;
  secondaryWeight: string;
}

export const STUDIO_FONTS: StudioFont[] = [
  {
    id: SYSTEM_FONT_ID,
    name: '系统黑体',
    desc: '清晰通用，全场景适用',
    family: 'system-ui',
    synthBold: true
  },
  {
    id: 'lemi-shigu-song',
    name: '乐米石鼓旧宋',
    desc: '石鼓碑意，旧宋书卷气',
    family: 'StudioLemiShiguSong',
    url: '/fonts/lemi-shigu-song.ttf',
    synthBold: false
  },
  {
    id: 'nanxi-youmo-song',
    name: '南西油墨宋',
    desc: '油墨印迹，宋体标题感',
    family: 'StudioNanxiYoumoSong',
    url: '/fonts/nanxi-youmo-song.ttf',
    synthBold: false
  },
  {
    id: 'wuhan-yingxiong',
    name: '武汉英雄体',
    desc: '手写力量感，适合短视频标题',
    family: 'StudioWuhanYingxiong',
    url: '/fonts/wuhan-yingxiong.ttf',
    synthBold: false
  },
  {
    id: 'xiangcui-jixue-song',
    name: '香萃积雪宋',
    desc: '细宋积雪，清冷雅致',
    family: 'StudioXiangcuiJixueSong',
    url: '/fonts/xiangcui-jixue-song.ttf',
    synthBold: false
  },
  {
    id: 'yaoxing-qingnian-hei',
    name: '摇醒青年黑',
    desc: '青年黑体，利落有力',
    family: 'StudioYaoxingQingnianHei',
    url: '/fonts/yaoxing-qingnian-hei.ttf',
    synthBold: false
  },
  {
    id: 'zhuote-ziyou',
    name: '卓特自由体',
    desc: '自由手写，轻松随性',
    family: 'StudioZhuoteZiyou',
    url: '/fonts/zhuote-ziyou.ttf',
    synthBold: false
  }
];

const SYSTEM_TYPEFACE: SubtitleTypeface = {
  primaryFamily: SYSTEM_FONT_STACK,
  primaryWeight: 'bold',
  secondaryFamily: SYSTEM_FONT_STACK,
  secondaryWeight: '500'
};

const fontByIdMap = new Map(STUDIO_FONTS.map((font) => [font.id, font]));
const loadPromises = new Map<string, Promise<boolean>>();
const readyIds = new Set<string>([SYSTEM_FONT_ID]);
const listeners = new Set<() => void>();

function notifyFontListeners() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // ignore subscriber errors
    }
  });
}

export function studioFontById(id: string | null | undefined): StudioFont {
  return (id && fontByIdMap.get(id)) || STUDIO_FONTS[0];
}

export function fontFamilyStack(font: StudioFont): string {
  if (!font.url) return SYSTEM_FONT_STACK;
  return `"${font.family}", ${CJK_FALLBACK}`;
}

export function resolveSubtitleFontId(config?: Partial<SubtitleConfig> | null): string {
  const rawId = String(config?.fontId || '').trim();
  if (fontByIdMap.has(rawId)) return rawId;

  const family = String(config?.fontFamily || '');
  if (family) {
    const matched = STUDIO_FONTS.find((font) => font.url && family.includes(font.family));
    if (matched) return matched.id;
  }

  return SYSTEM_FONT_ID;
}

export function resolveSubtitleTypeface(config?: Partial<SubtitleConfig> | null): SubtitleTypeface {
  const font = studioFontById(resolveSubtitleFontId(config));
  if (!font.url) return SYSTEM_TYPEFACE;
  return {
    primaryFamily: fontFamilyStack(font),
    primaryWeight: font.synthBold ? 'bold' : '400',
    secondaryFamily: SYSTEM_FONT_STACK,
    secondaryWeight: '500'
  };
}

export function subtitleCanvasFont(family: string, size: number, weight: string): string {
  return `${weight} ${Math.max(1, Math.round(size))}px ${family}`;
}

export function isStudioFontReady(id: string): boolean {
  return readyIds.has(studioFontById(id).id);
}

export function subscribeStudioFonts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function loadStudioFont(id: string): Promise<boolean> {
  const font = studioFontById(id);
  if (!font.url) {
    readyIds.add(font.id);
    return Promise.resolve(true);
  }
  const cached = loadPromises.get(font.id);
  if (cached) return cached;

  const promise = (async () => {
    try {
      const face = new FontFace(font.family, `url(${font.url}) format("truetype")`, {
        weight: '400',
        style: 'normal',
        display: 'swap'
      });
      const loaded = await face.load();
      document.fonts.add(loaded);
      await document.fonts.load(`400 32px "${font.family}"`);
      readyIds.add(font.id);
      notifyFontListeners();
      return true;
    } catch (err) {
      console.warn(`[SubtitleFonts] Failed to load ${font.id}:`, err);
      loadPromises.delete(font.id);
      notifyFontListeners();
      return false;
    }
  })();

  loadPromises.set(font.id, promise);
  return promise;
}

export async function ensureSubtitleFont(config?: Partial<SubtitleConfig> | null): Promise<boolean> {
  return loadStudioFont(resolveSubtitleFontId(config));
}
