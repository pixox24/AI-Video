import { DesignedVoiceEntry, DesignedVoiceStatus } from '../types';

const STORAGE_KEY = 'ai_video_voice_library';
export const VOICE_LIBRARY_MAX = 24;

export const DEFAULT_VOICE_PREVIEW_TEXT =
  '各位观众大家好，欢迎收看本期内容，今天我们把这件事一次讲清楚。';

export const VOICE_PROMPT_EXAMPLES: { label: string; prompt: string }[] = [
  { label: '纪录片男声', prompt: '沉稳的中年男性，语速缓慢，音色低沉有磁性，适合朗读新闻或纪录片解说' },
  { label: '带货女声', prompt: '年轻活泼的女性声音，语速较快，带有明显的上扬语调，适合介绍时尚产品' },
  { label: '有声书', prompt: '温柔知性的女性，30岁左右，语调平和，适合有声书朗读' },
  { label: '儿童向', prompt: '可爱的儿童声音，大约8岁女孩，说话略带稚气，适合动画角色配音' },
  { label: '标准播音', prompt: '吐字清晰精准，字正腔圆，适合教程和资讯口播' }
];

function uid(): string {
  return `voice:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadRaw(): DesignedVoiceEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.voiceId === 'string' && item.source === 'designed');
  } catch {
    return [];
  }
}

function persist(entries: DesignedVoiceEntry[]) {
  const slim = entries.map((entry) => ({
    ...entry,
    previewAudioUrl: entry.previewAudioUrl && entry.previewAudioUrl.startsWith('data:')
      ? undefined
      : entry.previewAudioUrl
  }));
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
  } catch {
    throw new Error('浏览器本地空间不足，请先删掉不用的设计音色后再上架。');
  }
}

export function loadVoiceLibrary(): DesignedVoiceEntry[] {
  return loadRaw().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function findDesignedVoice(voiceId: string | null | undefined): DesignedVoiceEntry | null {
  const id = (voiceId || '').trim();
  if (!id) return null;
  return loadVoiceLibrary().find((item) => item.voiceId === id) || null;
}

export function countVoiceDesignChars(text: string): number {
  let n = 0;
  for (const ch of text) {
    n += /[\u4e00-\u9fff]/.test(ch) ? 2 : 1;
  }
  return n;
}

export function voicePrefixFromTitle(title: string): string {
  const ascii = title.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  if (ascii.length >= 3) return ascii.toLowerCase();
  return `v${Date.now().toString(36).replace(/[^a-z0-9]/gi, '').slice(-8)}`.slice(0, 10);
}

export function normalizeDesignedVoiceStatus(raw?: string | null): DesignedVoiceStatus {
  const value = String(raw || '').trim().toUpperCase();
  if (value === 'OK') return 'ok';
  if (value === 'UNDEPLOYED') return 'undeployed';
  if (value === 'MISSING') return 'missing';
  return 'deploying';
}

export function saveDesignedVoice(
  input: Omit<DesignedVoiceEntry, 'id' | 'createdAt' | 'updatedAt' | 'source'> & { id?: string }
): DesignedVoiceEntry[] {
  const now = Date.now();
  const current = loadRaw();
  const existing = input.id
    ? current.find((item) => item.id === input.id)
    : current.find((item) => item.voiceId === input.voiceId);
  if (existing) {
    const next = current.map((item) =>
      item.id === existing.id
        ? {
            ...item,
            ...input,
            id: existing.id,
            source: 'designed' as const,
            updatedAt: now
          }
        : item
    );
    persist(next);
    return next.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  if (current.length >= VOICE_LIBRARY_MAX) {
    throw new Error(`我的音色最多 ${VOICE_LIBRARY_MAX} 条，请先移除不用的再上架。`);
  }
  const entry: DesignedVoiceEntry = {
    id: uid(),
    voiceId: input.voiceId,
    targetModel: input.targetModel,
    title: input.title.trim().slice(0, 16) || '我的音色',
    prompt: input.prompt,
    previewText: input.previewText,
    language: input.language,
    status: input.status,
    previewAudioUrl: input.previewAudioUrl,
    createdAt: now,
    updatedAt: now,
    source: 'designed'
  };
  const next = [entry, ...current];
  persist(next);
  return next.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function updateDesignedVoice(
  id: string,
  patch: Partial<Pick<DesignedVoiceEntry, 'title' | 'status' | 'previewAudioUrl'>>
): DesignedVoiceEntry[] {
  const next = loadRaw().map((item) =>
    item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item
  );
  persist(next);
  return next.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeDesignedVoice(id: string): DesignedVoiceEntry[] {
  const next = loadRaw().filter((item) => item.id !== id);
  persist(next);
  return next.sort((a, b) => b.updatedAt - a.updatedAt);
}
