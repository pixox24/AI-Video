export const VOICE_PREVIEW_TEXT = '这是当前音色的试听。成片口播会用这把声音。';

const STORAGE_KEY = 'ai_video_tts_preview_cache';
const MAX_ENTRIES = 24;

interface PreviewEntry {
  key: string;
  url: string;
  at: number;
}

const memory = new Map<string, string>();

function canPersistUrl(url: string): boolean {
  return url.startsWith('/') || url.startsWith('http://') || url.startsWith('https://');
}

function loadEntries(): PreviewEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.key === 'string' && typeof item.url === 'string') : [];
  } catch {
    return [];
  }
}

function saveEntries(entries: PreviewEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // quota / private mode
  }
}

export function getTtsPreviewUrl(key: string): string | null {
  const mem = memory.get(key);
  if (mem) return mem;
  const found = loadEntries().find((item) => item.key === key);
  if (!found) return null;
  memory.set(key, found.url);
  return found.url;
}

export function setTtsPreviewUrl(key: string, url: string) {
  if (!key || !url) return;
  memory.set(key, url);
  if (!canPersistUrl(url)) return;
  const next = [{ key, url, at: Date.now() }, ...loadEntries().filter((item) => item.key !== key)]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_ENTRIES);
  saveEntries(next);
}

export function makeVoicePreviewKey(sourceKey: string, rate: number): string {
  return `${sourceKey}|${rate.toFixed(2)}|sample`;
}
