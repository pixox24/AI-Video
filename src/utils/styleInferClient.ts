import { StylePack } from '../types';
import { hashStyleImage } from './stylePack';

const CACHE_KEY = 'ai_video_style_infer_cache';
const MAX_CACHE = 12;

interface CacheEntry {
  hash: string;
  pack: StylePack;
  at: number;
}

function loadCache(): CacheEntry[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCache(entries: CacheEntry[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries.slice(0, MAX_CACHE)));
  } catch {
    // ignore quota
  }
}

export function getCachedStyleInfer(hash: string): StylePack | null {
  const hit = loadCache().find((item) => item.hash === hash);
  return hit?.pack || null;
}

export function setCachedStyleInfer(hash: string, pack: StylePack) {
  const next = [{ hash, pack, at: Date.now() }, ...loadCache().filter((item) => item.hash !== hash)]
    .sort((a, b) => b.at - a.at)
    .slice(0, MAX_CACHE);
  saveCache(next);
}

export async function compressStyleImage(file: File): Promise<{ dataUrl: string; hash: string }> {
  if (file.size > 4 * 1024 * 1024) {
    throw new Error('图片请小于 4MB');
  }
  const bitmap = await createImageBitmap(file);
  const maxSide = 1280;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(10, Math.round(bitmap.width * scale));
  const height = Math.max(10, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法压缩图片');
  ctx.drawImage(bitmap, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  return { dataUrl, hash: hashStyleImage(dataUrl) };
}
