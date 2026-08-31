import { VisualCharacterRef } from '../types';

const MAX_BYTES = 8 * 1024 * 1024;
const FULL_EDGE = 1024;
const THUMB_EDGE = 256;

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取这张图片'));
    image.src = dataUrl;
  });
}

function drawContain(image: HTMLImageElement, edge: number, quality: number): string {
  const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return image.src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', quality);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export async function prepareCharacterRefFile(file: File): Promise<VisualCharacterRef> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请上传 jpg / png / webp 图片');
  }
  if (file.size > MAX_BYTES) {
    throw new Error('图片超过 8MB，请换一张更小的');
  }
  const original = await readFileAsDataUrl(file);
  const image = await loadImage(original);
  const full = drawContain(image, FULL_EDGE, 0.88);
  const thumb = drawContain(image, THUMB_EDGE, 0.8);
  const res = await fetch('/api/assets/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl: full, prefix: 'char-ref' })
  });
  const data = await res.json().catch(() => ({}));
  const imageUrl = typeof data?.url === 'string' ? data.url : '';
  if (!res.ok || !imageUrl) {
    throw new Error(data?.error || '参考图保存失败');
  }
  return {
    imageId: imageUrl.replace(/^\/generated\//, '') || `char-${Date.now()}`,
    imageUrl,
    thumbDataUrl: thumb,
    kind: 'face'
  };
}
