import { SubtitleConfig } from '../types';

export type StudioFontScript = 'cjk' | 'latin';

export const SYSTEM_FONT_ID = 'system-cjk';
export const SYSTEM_LATIN_FONT_ID = 'system-latin';

const CJK_FALLBACK = '"PingFang SC", "Microsoft YaHei", sans-serif';
const LATIN_FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const SYSTEM_FONT_STACK = `${LATIN_FALLBACK}, ${CJK_FALLBACK}`;
export const SYSTEM_LATIN_STACK = `"Segoe UI", ${LATIN_FALLBACK}, ${CJK_FALLBACK}`;

export interface StudioFont {
  id: string;
  name: string;
  desc: string;
  family: string;
  url?: string;
  synthBold: boolean;
  script: StudioFontScript;
  stack?: string;
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
    synthBold: true,
    script: 'cjk',
    stack: SYSTEM_FONT_STACK
  },
  {
    id: 'lemi-shigu-song',
    name: '乐米石鼓旧宋',
    desc: '石鼓碑意，旧宋书卷气',
    family: 'StudioLemiShiguSong',
    url: '/fonts/lemi-shigu-song.ttf',
    synthBold: false,
    script: 'cjk'
  },
  {
    id: 'nanxi-youmo-song',
    name: '南西油墨宋',
    desc: '油墨印迹，宋体标题感',
    family: 'StudioNanxiYoumoSong',
    url: '/fonts/nanxi-youmo-song.ttf',
    synthBold: false,
    script: 'cjk'
  },
  {
    id: 'wuhan-yingxiong',
    name: '武汉英雄体',
    desc: '手写力量感，适合短视频标题',
    family: 'StudioWuhanYingxiong',
    url: '/fonts/wuhan-yingxiong.ttf',
    synthBold: false,
    script: 'cjk'
  },
  {
    id: 'xiangcui-jixue-song',
    name: '香萃积雪宋',
    desc: '细宋积雪，清冷雅致',
    family: 'StudioXiangcuiJixueSong',
    url: '/fonts/xiangcui-jixue-song.ttf',
    synthBold: false,
    script: 'cjk'
  },
  {
    id: 'yaoxing-qingnian-hei',
    name: '摇醒青年黑',
    desc: '青年黑体，利落有力',
    family: 'StudioYaoxingQingnianHei',
    url: '/fonts/yaoxing-qingnian-hei.ttf',
    synthBold: false,
    script: 'cjk'
  },
  {
    id: 'zhuote-ziyou',
    name: '卓特自由体',
    desc: '自由手写，轻松随性',
    family: 'StudioZhuoteZiyou',
    url: '/fonts/zhuote-ziyou.ttf',
    synthBold: false,
    script: 'cjk'
  },
  {
    id: SYSTEM_LATIN_FONT_ID,
    name: '系统西文',
    desc: '清晰无衬线，适合英文字幕',
    family: 'Segoe UI',
    synthBold: true,
    script: 'latin',
    stack: SYSTEM_LATIN_STACK
  },
  {
    id: 'latin-serif',
    name: '西文衬线',
    desc: 'Georgia 书卷感，适合旁白',
    family: 'Georgia',
    synthBold: false,
    script: 'latin',
    stack: `Georgia, "Times New Roman", serif, ${CJK_FALLBACK}`
  },
  {
    id: 'latin-impact',
    name: '西文粗体',
    desc: '短视频标题感，高对比',
    family: 'Impact',
    synthBold: false,
    script: 'latin',
    stack: `Impact, "Arial Black", ${LATIN_FALLBACK}, ${CJK_FALLBACK}`
  },
  {
    id: 'latin-mono',
    name: '西文等宽',
    desc: '打字机 / 纪实感',
    family: 'Consolas',
    synthBold: false,
    script: 'latin',
    stack: `Consolas, "Courier New", ui-monospace, monospace, ${CJK_FALLBACK}`
  }
];

export const CJK_FONTS = STUDIO_FONTS.filter((font) => font.script === 'cjk');
export const LATIN_FONTS = STUDIO_FONTS.filter((font) => font.script === 'latin');

const fontByIdMap = new Map(STUDIO_FONTS.map((font) => [font.id, font]));
const loadPromises = new Map<string, Promise<boolean>>();
const readyIds = new Set<string>(STUDIO_FONTS.filter((font) => !font.url).map((font) => font.id));
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

export function fontsForScript(script: StudioFontScript): StudioFont[] {
  return script === 'latin' ? LATIN_FONTS : CJK_FONTS;
}

export function defaultFontIdForScript(script: StudioFontScript): string {
  return script === 'latin' ? SYSTEM_LATIN_FONT_ID : SYSTEM_FONT_ID;
}

export function fontFamilyStack(font: StudioFont): string {
  if (font.stack) return font.stack;
  if (!font.url) return SYSTEM_FONT_STACK;
  if (font.script === 'latin') return `"${font.family}", ${SYSTEM_LATIN_STACK}`;
  return `"${font.family}", ${CJK_FALLBACK}, ${LATIN_FALLBACK}`;
}

export function resolveSubtitleFontId(config?: Partial<SubtitleConfig> | null): string {
  const rawId = String(config?.fontId || '').trim();
  if (fontByIdMap.has(rawId)) return rawId;

  const family = String(config?.fontFamily || '');
  if (family) {
    const matched = STUDIO_FONTS.find((font) => font.url && family.includes(font.family));
    if (matched) return matched.id;
    const latin = LATIN_FONTS.find((font) => family.includes(font.family));
    if (latin) return latin.id;
  }

  return SYSTEM_FONT_ID;
}

export function resolveSecondarySubtitleFontId(config?: Partial<SubtitleConfig> | null): string {
  const rawId = String(config?.secondaryFontId || '').trim();
  if (fontByIdMap.has(rawId)) return rawId;
  return SYSTEM_LATIN_FONT_ID;
}

export function resolveSubtitleTypeface(config?: Partial<SubtitleConfig> | null): SubtitleTypeface {
  const primary = studioFontById(resolveSubtitleFontId(config));
  const secondary = studioFontById(resolveSecondarySubtitleFontId(config));
  return {
    primaryFamily: fontFamilyStack(primary),
    primaryWeight: primary.synthBold ? 'bold' : '400',
    secondaryFamily: fontFamilyStack(secondary),
    secondaryWeight: secondary.synthBold ? '600' : '400'
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
  const primary = await loadStudioFont(resolveSubtitleFontId(config));
  const secondary = await loadStudioFont(resolveSecondarySubtitleFontId(config));
  return primary && secondary;
}

export function subtitleFontIds(config?: Partial<SubtitleConfig> | null): string[] {
  return Array.from(new Set([
    resolveSubtitleFontId(config),
    resolveSecondarySubtitleFontId(config)
  ]));
}
