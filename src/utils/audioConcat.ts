export function mixToMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const out = new Float32Array(n);
  const c0 = buffer.getChannelData(0);
  if (buffer.numberOfChannels === 1) {
    out.set(c0);
    return out;
  }
  const extra: Float32Array[] = [];
  for (let c = 1; c < buffer.numberOfChannels; c++) extra.push(buffer.getChannelData(c));
  for (let i = 0; i < n; i++) {
    let sum = c0[i];
    for (const channel of extra) sum += channel[i];
    out[i] = sum / buffer.numberOfChannels;
  }
  return out;
}

export async function resampleTo(buffer: AudioBuffer, sampleRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === sampleRate && buffer.numberOfChannels === 1) return buffer;
  const length = Math.max(1, Math.round(buffer.duration * sampleRate));
  const ctx = new OfflineAudioContext(1, length, sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

export async function concatAudioBuffers(buffers: AudioBuffer[]): Promise<AudioBuffer> {
  const usable = buffers.filter((buffer) => buffer && buffer.length > 0);
  if (usable.length === 0) {
    throw new Error('没有可拼接的旁白音频');
  }
  if (usable.length === 1 && usable[0].numberOfChannels === 1) return usable[0];
  const sampleRate = usable[0].sampleRate;
  const normalized = await Promise.all(usable.map((buffer) => resampleTo(buffer, sampleRate)));
  const total = normalized.reduce((sum, buffer) => sum + buffer.length, 0);
  const ctx = new OfflineAudioContext(1, Math.max(1, total), sampleRate);
  const out = ctx.createBuffer(1, Math.max(1, total), sampleRate);
  const dest = out.getChannelData(0);
  let offset = 0;
  for (const buffer of normalized) {
    dest.set(mixToMono(buffer), offset);
    offset += buffer.length;
  }
  return out;
}

export function encodeWavPcm16(buffer: AudioBuffer): Blob {
  const sampleRate = buffer.sampleRate;
  const mono = mixToMono(buffer);
  const pcm = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    const sample = Math.max(-1, Math.min(1, mono[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  const header = 44;
  const bytes = new ArrayBuffer(header + pcm.byteLength);
  const view = new DataView(bytes);
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  new Uint8Array(bytes).set(new Uint8Array(pcm.buffer), header);
  return new Blob([bytes], { type: 'audio/wav' });
}

export async function decodeAudioUrl(url: string): Promise<AudioBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('无法读取旁白音频');
  const arr = await res.arrayBuffer();
  const AC = (typeof AudioContext !== 'undefined'
    ? AudioContext
    : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as
    | typeof AudioContext
    | undefined;
  if (!AC) throw new Error('当前环境不支持解码音频');
  const ctx = new AC();
  try {
    return await ctx.decodeAudioData(arr.slice(0));
  } finally {
    void ctx.close();
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('无法编码旁白音频'));
    reader.readAsDataURL(blob);
  });
}
