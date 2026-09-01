import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { VideoProject, StoryboardClip, CameraMotion, SubtitleConfig } from '../types';
import { calculateSubtitleLayout } from './subtitleFormatter';
import { DEFAULT_BGM_TRACK_ID, bgmById, resolveBgmTrackId, resolveTtsApi } from './presets';
import { clipNarrationTimings, clipShotNarration, detectSpeechBounds, isNarrationTrackFresh } from './narrationTrack';
import { ensureSubtitleFont, resolveSubtitleTypeface, subtitleCanvasFont } from './subtitleFonts';

const TRANSITION_SECONDS = 0.4;

interface ClipAtTime {
  clip: StoryboardClip;
  index: number;
  clipTime: number;
  clipDuration: number;
}

function getClipAtTime(clips: StoryboardClip[], time: number): ClipAtTime | null {
  let acc = 0;
  for (let i = 0; i < clips.length; i++) {
    const duration = clips[i].duration || 3.5;
    if (time >= acc && time < acc + duration) {
      return { clip: clips[i], index: i, clipTime: time - acc, clipDuration: duration };
    }
    acc += duration;
  }
  if (clips.length > 0) {
    const lastIndex = clips.length - 1;
    const lastDuration = clips[lastIndex].duration || 3.5;
    return {
      clip: clips[lastIndex],
      index: lastIndex,
      clipTime: lastDuration,
      clipDuration: lastDuration
    };
  }
  return null;
}

function cameraTransform(motion: CameraMotion | string, progress: number, width: number, height: number) {
  let motionScale = 1.0;
  let motionOffsetX = 0;
  let motionOffsetY = 0;

  if (motion === 'zoom-in') {
    motionScale = 1.0 + progress * 0.15;
  } else if (motion === 'zoom-out') {
    motionScale = 1.15 - progress * 0.15;
  } else if (motion === 'pan-left') {
    motionScale = 1.1;
    motionOffsetX = (progress - 0.5) * width * 0.08;
  } else if (motion === 'pan-right') {
    motionScale = 1.1;
    motionOffsetX = (0.5 - progress) * width * 0.08;
  } else if (motion === 'tilt-up') {
    motionScale = 1.1;
    motionOffsetY = (progress - 0.5) * height * 0.08;
  } else if (motion === 'tilt-down') {
    motionScale = 1.1;
    motionOffsetY = (0.5 - progress) * height * 0.08;
  } else if (motion === 'cinematic-orbit') {
    motionScale = 1.08 + Math.sin(progress * Math.PI) * 0.05;
    motionOffsetX = Math.cos(progress * Math.PI) * width * 0.03;
    motionOffsetY = Math.sin(progress * Math.PI) * height * 0.02;
  }

  return { motionScale, motionOffsetX, motionOffsetY };
}

function drawKenBurnsImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
  motion: CameraMotion | string,
  progress: number,
  extra?: { alpha?: number; offsetX?: number; extraScale?: number }
) {
  if (!img || img.naturalWidth <= 0) return;
  const alpha = extra?.alpha ?? 1;
  const offsetX = extra?.offsetX ?? 0;
  const extraScale = extra?.extraScale ?? 1;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  const scaleX = width / img.naturalWidth;
  const scaleY = height / img.naturalHeight;
  const baseScale = Math.max(scaleX, scaleY);
  const { motionScale, motionOffsetX, motionOffsetY } = cameraTransform(motion, progress, width, height);
  const finalScale = baseScale * motionScale * extraScale;
  const drawW = img.naturalWidth * finalScale;
  const drawH = img.naturalHeight * finalScale;
  const drawX = (width - drawW) / 2 + motionOffsetX + offsetX;
  const drawY = (height - drawH) / 2 + motionOffsetY;
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();
}

function mixNarrationFromTrack(
  offlineCtx: OfflineAudioContext,
  decodedBuffer: AudioBuffer,
  project: VideoProject,
  totalDuration: number,
  voiceoverVolume: number
): { start: number; end: number }[] {
  const speechIntervals: { start: number; end: number }[] = [];
  const track = project.audio?.narrationTrack;
  const timelineDuration = project.clips.reduce((sum, clip) => sum + (clip.duration || 3.5), 0);
  const fileIncludesHolds = Math.abs(decodedBuffer.duration - timelineDuration) < 0.15;

  const connectSource = (when: number, offset: number, duration: number) => {
    const bufferDuration = decodedBuffer.duration;
    if (when >= totalDuration - 0.001) return false;
    if (offset >= bufferDuration - 0.001) return false;
    const playDuration = Math.min(duration, bufferDuration - offset, totalDuration - when);
    if (playDuration <= 0.01) return false;
    const source = offlineCtx.createBufferSource();
    source.buffer = decodedBuffer;
    const gain = offlineCtx.createGain();
    gain.gain.value = voiceoverVolume;
    source.connect(gain);
    gain.connect(offlineCtx.destination);
    source.start(Math.max(0, when), Math.max(0, offset), playDuration);
    speechIntervals.push({
      start: Math.max(0, when),
      end: Math.min(totalDuration, when + playDuration)
    });
    return true;
  };

  // One clock: if the VO file already contains sentence-gap silence, mix it whole.
  if (fileIncludesHolds && track?.alignment?.version === 2) {
    connectSource(0, 0, Math.min(decodedBuffer.duration, totalDuration));
    return speechIntervals;
  }
  if (!project.clips.some((clip) => (clip.holdDuration || 0) > 0.04)) {
    if (track?.alignment?.version === 2) {
      connectSource(0, 0, Math.min(decodedBuffer.duration, totalDuration));
      return speechIntervals;
    }
    const bounds = typeof track?.speechStart === 'number'
      ? { speechStart: track.speechStart, speechEnd: track.speechEnd ?? decodedBuffer.duration }
      : detectSpeechBounds(decodedBuffer);
    const offset = Math.max(0, bounds.speechStart || 0);
    const end = Math.max(offset + 0.05, Math.min(decodedBuffer.duration, bounds.speechEnd || decodedBuffer.duration));
    connectSource(0, offset, Math.min(end - offset, totalDuration));
    return speechIntervals;
  }

  const resolved = clipNarrationTimings(project.clips, track?.clips);
  let timelineCursor = 0;
  let lastAudioEnd = 0;

  for (let i = 0; i < project.clips.length; i++) {
    const clip = project.clips[i];
    const clipDuration = clip.duration || 3.5;
    const timing = resolved[i];
    const audioStart = timing?.audioStart ?? lastAudioEnd;
    const timedSpeech = timing ? Math.max(0, timing.audioEnd - timing.audioStart) : 0;
    const speechDuration =
      timedSpeech > 0.02
        ? timedSpeech
        : clip.speechDuration ?? 0;
    const holdDuration = Math.max(0, clip.holdDuration || 0);
    const playDuration = Math.min(speechDuration, Math.max(0, clipDuration - holdDuration), clipDuration);

    try {
      connectSource(timelineCursor, audioStart, playDuration);
    } catch (err) {
      console.warn('[AudioExport] Clip narration slice skipped:', clip.id, err);
    }

    lastAudioEnd = timing?.audioEnd ?? audioStart + speechDuration;
    timelineCursor += clipDuration;
  }

  return speechIntervals;
}

export interface ExportProgressCallback {
  (progress: number, stageText: string): void;
}

/**
 * Convert Base64 (data:audio/mp3;base64,... or raw base64) to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const cleanBase64 = base64.replace(/^data:audio\/[a-zA-Z0-9]+;base64,/, '');
  const binaryString = atob(cleanBase64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Fetch and decode all narration voiceovers & BGM into a single synchronized AudioBuffer
 * using OfflineAudioContext with smart Audio Ducking.
 */
async function renderOfflineAudio(
  project: VideoProject,
  totalDuration: number,
  sampleRate: number = 44100,
  onProgress?: ExportProgressCallback
): Promise<AudioBuffer | null> {
  try {
    const totalFrames = Math.max(1, Math.ceil(totalDuration * sampleRate));
    const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

    // Temp AudioContext for decoding audio array buffers
    const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

    const voiceCharacter = project.audio?.voiceCharacter || 'magnetic-male';
    const speechRate = project.audio?.speechRate || 1.0;
    const voiceoverVolume = Math.max(0, Math.min(1, project.audio?.voiceoverVolume ?? 1.0));
    const voiceoverEnabled = project.audio?.voiceoverEnabled !== false;
    const bgmVolume = Math.max(0, Math.min(1, project.audio?.bgmVolume ?? 0.10));
    const bgmEnabled = project.audio?.bgmEnabled !== false;
    const audioDucking = project.audio?.audioDucking !== false;

    // 1. Fetch & decode all narration voice clips
    onProgress?.(10, '正在预拉取全分镜 AI 语音解说...');
    const speechIntervals: { start: number; end: number }[] = [];
    let accTime = 0;

    if (voiceoverEnabled) {
      const track = project.audio?.narrationTrack;
      const trackFresh = isNarrationTrackFresh(project.audio, project.clips, resolveTtsApi(project.settings.customTtsApi));
      let mixedFullTrack = false;

      // Prefer the same full VO file the preview plays, even if hash is slightly stale.
      // Per-clip TTS skips continue shots (empty narration) and creates mid-video silence.
      if (track?.audioUrl) {
        onProgress?.(10, '正在铺整段旁白音轨...');
        try {
          const res = await fetch(track.audioUrl);
          if (res.ok) {
            const arrayBuf = await res.arrayBuffer();
            const decodedBuffer = await decodeCtx.decodeAudioData(arrayBuf);
            speechIntervals.push(
              ...mixNarrationFromTrack(offlineCtx, decodedBuffer, project, totalDuration, voiceoverVolume)
            );
            mixedFullTrack = speechIntervals.length > 0;
            if (!trackFresh) {
              console.warn('[AudioExport] Narration track hash is stale; still mixed full VO to avoid export gaps.');
            }
          }
        } catch (ttsErr) {
          console.warn('[AudioExport] Full narration track mix failed:', ttsErr);
        }
      }

      if (!mixedFullTrack) {
        for (let i = 0; i < project.clips.length; i++) {
          const clip = project.clips[i];
          const clipStart = accTime;
          const clipDur = clip.duration || 3.5;
          accTime += clipDur;

          const spokenText = (clip.narration || '').trim();
          if (!spokenText) continue;

          try {
            const res = await fetch('/api/audio/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: spokenText,
                character: voiceCharacter,
                rate: speechRate,
                ttsApi: resolveTtsApi(project.settings.customTtsApi)
              })
            });

            if (res.ok) {
              const data = await res.json();
              if (data?.audioUrl) {
                const arrayBuf = data.audioUrl.startsWith('data:')
                  ? base64ToArrayBuffer(data.audioUrl)
                  : await (await fetch(data.audioUrl)).arrayBuffer();
                const decodedBuffer = await decodeCtx.decodeAudioData(arrayBuf);

                const source = offlineCtx.createBufferSource();
                source.buffer = decodedBuffer;

                const gain = offlineCtx.createGain();
                gain.gain.value = voiceoverVolume;

                source.connect(gain);
                gain.connect(offlineCtx.destination);
                source.start(clipStart);

                speechIntervals.push({
                  start: clipStart,
                  end: Math.min(totalDuration, clipStart + decodedBuffer.duration)
                });
              }
            }
          } catch (ttsErr) {
            console.warn(`[AudioExport] Clip ${i + 1} TTS pre-fetch warning:`, ttsErr);
          }
        }
      }
    }

    // 2. Fetch & decode Background Music (BGM)
    const bgmTrackId = project.audio?.bgmTrackId;
    if (bgmEnabled && bgmTrackId && bgmTrackId !== 'none') {
      onProgress?.(18, '正在加载背景音乐并配置人声闪避 (Ducking)...');
      const trackDef = bgmById(resolveBgmTrackId(bgmTrackId));
      const bgmUrl = project.audio?.customBgmUrl || trackDef?.url || `/audio/bgm/${DEFAULT_BGM_TRACK_ID}.mp3`;

      let bgmArrayBuf: ArrayBuffer | null = null;
      try {
        const bgmRes = await fetch(bgmUrl);
        if (bgmRes.ok) {
          bgmArrayBuf = await bgmRes.arrayBuffer();
        } else if (trackDef?.fallbackUrl) {
          const fallbackRes = await fetch(trackDef.fallbackUrl);
          if (fallbackRes.ok) bgmArrayBuf = await fallbackRes.arrayBuffer();
        }
      } catch {
        if (trackDef?.fallbackUrl) {
          try {
            const fallbackRes = await fetch(trackDef.fallbackUrl);
            if (fallbackRes.ok) bgmArrayBuf = await fallbackRes.arrayBuffer();
          } catch (e) {
            console.warn('[AudioExport] Failed to fetch BGM track:', e);
          }
        }
      }

      if (bgmArrayBuf) {
        try {
          const bgmDecoded = await decodeCtx.decodeAudioData(bgmArrayBuf);
          const bgmSource = offlineCtx.createBufferSource();
          bgmSource.buffer = bgmDecoded;
          bgmSource.loop = true;

          const bgmGain = offlineCtx.createGain();
          
          if (audioDucking && speechIntervals.length > 0) {
            // Apply dynamic volume curve with smooth fade in/out
            const duckedVol = bgmVolume * 0.35;
            bgmGain.gain.setValueAtTime(bgmVolume, 0);

            speechIntervals.forEach(interval => {
              const duckStart = Math.max(0, interval.start - 0.1);
              const duckEnd = Math.min(totalDuration, interval.end + 0.15);

              // Fade down 150ms before speech
              bgmGain.gain.setValueAtTime(bgmVolume, duckStart);
              bgmGain.gain.linearRampToValueAtTime(duckedVol, interval.start + 0.05);

              // Fade up 250ms after speech ends
              bgmGain.gain.setValueAtTime(duckedVol, interval.end);
              bgmGain.gain.linearRampToValueAtTime(bgmVolume, duckEnd + 0.2);
            });
          } else {
            bgmGain.gain.value = bgmVolume;
          }

          bgmSource.connect(bgmGain);
          bgmGain.connect(offlineCtx.destination);
          bgmSource.start(0);
        } catch (e) {
          console.warn('[AudioExport] Error mixing BGM track:', e);
        }
      }
    }

    try {
      decodeCtx.close();
    } catch {
      // ignore
    }

    onProgress?.(22, '正在离线渲染混音音轨...');
    const renderedBuffer = await offlineCtx.startRendering();
    return renderedBuffer;
  } catch (err) {
    console.warn('[AudioExport] Offline audio render encountered error, exporting video without audio:', err);
    return null;
  }
}

/**
 * High-performance browser-side true MP4 (H.264 / AVC + AAC Audio) video exporter
 * utilizing WebCodecs VideoEncoder, AudioEncoder & mp4-muxer.
 */
export async function exportProjectToMP4(
  project: VideoProject,
  onProgress?: ExportProgressCallback
): Promise<{ blob: Blob; url: string; filename: string; format: 'mp4' | 'webm' }> {
  const fps = project.settings.frameRate || 30;
  const totalDuration = project.clips.reduce((acc, c) => acc + (c.duration || 3.5), 0) || 5;
  const totalFrames = Math.max(1, Math.floor(totalDuration * fps));

  onProgress?.(5, '正在初始化画布与导出参数...');
  onProgress?.(6, '正在载入字幕字体...');
  await ensureSubtitleFont(project.subtitles);

  // Determine export canvas dimensions based on aspect ratio & export quality
  let width = 1920;
  let height = 1080;

  if (project.settings.aspectRatio === '9:16') {
    width = 1080;
    height = 1920;
  } else if (project.settings.aspectRatio === '1:1') {
    width = 1080;
    height = 1080;
  } else if (project.settings.aspectRatio === '4:5') {
    width = 1080;
    height = 1350;
  }

  // Adjust for 720p or 4K if configured
  if (project.settings.exportQuality === '720p') {
    width = Math.round(width * 0.6667);
    height = Math.round(height * 0.6667);
  } else if (project.settings.exportQuality === '4k') {
    width = Math.round(width * 2);
    height = Math.round(height * 2);
  }

  // Ensure width and height are even numbers (H.264 standard requirement)
  width = width % 2 === 0 ? width : width + 1;
  height = height % 2 === 0 ? height : height + 1;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) {
    throw new Error('无法创建 2D 渲染上下文');
  }

  // 1. Preload all images and render audio track concurrently
  onProgress?.(8, '正在预加载各分镜原画并混音音轨...');

  const [loadedImages, mixedAudioBuffer] = await Promise.all([
    Promise.all(
      project.clips.map((clip) => {
        if (!clip.imageUrl) return Promise.resolve(null);
        return new Promise<HTMLImageElement | null>((resolve) => {
          const tryLoad = (src: string, allowProxyRetry: boolean) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => {
              if (allowProxyRetry && /^https?:\/\//i.test(src)) {
                tryLoad(`/api/image-proxy?url=${encodeURIComponent(src)}`, false);
              } else {
                resolve(null);
              }
            };
            img.src = src;
          };
          tryLoad(clip.imageUrl!, true);
        });
      })
    ),
    renderOfflineAudio(project, totalDuration, 44100, onProgress)
  ]);

  onProgress?.(25, '正在启动 H.264 + AAC 硬件加速编码器...');

  // Check if WebCodecs VideoEncoder & AudioEncoder are supported
  const hasWebCodecs = typeof window !== 'undefined' && 'VideoEncoder' in window && 'VideoFrame' in window;
  const hasAudioEncoder = typeof window !== 'undefined' && 'AudioEncoder' in window && 'AudioData' in window;

  if (hasWebCodecs) {
    try {
      const sampleRate = 44100;
      const target = new ArrayBufferTarget();

      const muxerConfig: any = {
        target: target,
        video: {
          codec: 'avc',
          width: width,
          height: height
        },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset'
      };

      const enableAudioMuxing = Boolean(mixedAudioBuffer && hasAudioEncoder);
      if (enableAudioMuxing) {
        muxerConfig.audio = {
          codec: 'aac',
          numberOfChannels: 2,
          sampleRate: sampleRate
        };
      }

      const muxer = new Muxer(muxerConfig);

      let encodeError: Error | null = null;

      const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => {
          muxer.addVideoChunk(chunk, meta);
        },
        error: (e) => {
          console.error('VideoEncoder encountered error:', e);
          encodeError = e;
        }
      });

      // Configure H.264 Video Encoder
      videoEncoder.configure({
        codec: 'avc1.4d002a', // Main Profile Level 4.2
        width: width,
        height: height,
        bitrate: project.settings.exportQuality === '4k' ? 20_000_000 : 8_000_000,
        framerate: fps
      });

      // 2. Encode Audio using AudioEncoder if available
      let audioEncoder: AudioEncoder | null = null;
      if (enableAudioMuxing && mixedAudioBuffer) {
        try {
          audioEncoder = new AudioEncoder({
            output: (chunk, meta) => {
              muxer.addAudioChunk(chunk, meta);
            },
            error: (e) => {
              console.error('AudioEncoder error:', e);
            }
          });

          audioEncoder.configure({
            codec: 'mp4a.40.2', // AAC-LC
            numberOfChannels: 2,
            sampleRate: sampleRate,
            bitrate: 128_000
          });

          // Feed audio frames into AudioEncoder in chunks of 1024 frames
          const totalAudioFrames = mixedAudioBuffer.length;
          const chunkSize = 1024;
          const ch0 = mixedAudioBuffer.getChannelData(0);
          const ch1 = mixedAudioBuffer.numberOfChannels > 1 ? mixedAudioBuffer.getChannelData(1) : ch0;

          for (let offset = 0; offset < totalAudioFrames; offset += chunkSize) {
            const currentChunkFrames = Math.min(chunkSize, totalAudioFrames - offset);
            const planarData = new Float32Array(currentChunkFrames * 2);

            // Channel 0
            planarData.set(ch0.subarray(offset, offset + currentChunkFrames), 0);
            // Channel 1
            planarData.set(ch1.subarray(offset, offset + currentChunkFrames), currentChunkFrames);

            const timestampMicros = Math.round((offset / sampleRate) * 1_000_000);

            const audioData = new (window as any).AudioData({
              format: 'f32-planar',
              sampleRate: sampleRate,
              numberOfFrames: currentChunkFrames,
              numberOfChannels: 2,
              timestamp: timestampMicros,
              data: planarData
            });

            audioEncoder.encode(audioData);
            audioData.close();
          }

          await audioEncoder.flush();
        } catch (audioErr) {
          console.warn('[AudioExport] AudioEncoder failed, continuing with video only:', audioErr);
        }
      }

      // 3. Frame-by-frame offline video rendering loop
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (encodeError) throw encodeError;

        const currentTime = frameIndex / fps;
        renderCanvasFrame(ctx, width, height, project, loadedImages, currentTime);

        const timestampMicros = Math.round(currentTime * 1_000_000);
        const durationMicros = Math.round((1 / fps) * 1_000_000);

        const videoFrame = new VideoFrame(canvas, {
          timestamp: timestampMicros,
          duration: durationMicros
        });

        // Insert keyframe every 2 seconds
        const isKeyFrame = frameIndex % (fps * 2) === 0;
        videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
        videoFrame.close();

        if (frameIndex % 5 === 0 || frameIndex === totalFrames - 1) {
          const currentPct = 25 + Math.floor((frameIndex / totalFrames) * 70);
          onProgress?.(currentPct, `正在逐帧编码 H.264 视频流 (${frameIndex + 1}/${totalFrames} 帧)...`);
          // Yield to main thread for responsive UI
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      onProgress?.(96, '正在封装 MP4 容器格式与音频元数据...');
      await videoEncoder.flush();
      muxer.finalize();

      const mp4Blob = new Blob([target.buffer], { type: 'video/mp4' });
      const mp4Url = URL.createObjectURL(mp4Blob);
      const safeTitle = (project.title || 'AI_Short_Video').replace(/[/\\?%*:|"<>]/g, '_');

      onProgress?.(100, 'MP4 视频渲染完成！');

      return {
        blob: mp4Blob,
        url: mp4Url,
        filename: `${safeTitle}.mp4`,
        format: 'mp4'
      };
    } catch (err) {
      console.warn('WebCodecs MP4 encoding failed, falling back to MediaRecorder:', err);
    }
  }

  // Fallback: MediaRecorder stream recording with audio track
  onProgress?.(30, '使用兼容模式渲染视频与音频流...');
  return exportViaMediaRecorder(project, canvas, ctx, width, height, loadedImages, mixedAudioBuffer, onProgress);
}

/**
 * Render single video frame to Canvas — keep camera, transitions and
 * subtitles aligned with VideoPlayerStage preview.
 */
function renderCanvasFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: VideoProject,
  loadedImages: (HTMLImageElement | null)[],
  currentTime: number
) {
  const currentInfo = getClipAtTime(project.clips, currentTime);
  const fallbackClip: StoryboardClip = project.clips[0] || {
    id: 'default',
    order: 1,
    duration: 3.5,
    narration: '',
    visualPrompt: '',
    cameraMotion: 'zoom-in',
    transition: 'crossfade'
  };
  const activeClip = currentInfo?.clip || fallbackClip;
  const activeClipIndex = currentInfo?.index ?? 0;
  const clipDuration = currentInfo?.clipDuration || activeClip.duration || 3.5;
  const clipTime = currentInfo?.clipTime ?? 0;
  const clipProgress = Math.min(1, Math.max(0, clipTime / Math.max(0.05, clipDuration)));

  const bgType = project.settings.canvasBackground;
  ctx.fillStyle = bgType === 'blur' ? '#0a0a0f' : (bgType || '#0a0a0c');
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ctx.clip();

  const img = loadedImages[activeClipIndex];
  const prevImg = activeClipIndex > 0 ? loadedImages[activeClipIndex - 1] : null;
  const prevClip = activeClipIndex > 0 ? project.clips[activeClipIndex - 1] : null;
  const inTransition = clipTime < TRANSITION_SECONDS && activeClipIndex > 0;
  const transProgress = inTransition ? Math.min(1, clipTime / TRANSITION_SECONDS) : 1;
  const transition = activeClip.transition || 'none';

  if (inTransition && prevImg && prevClip) {
    if (transition === 'crossfade') {
      drawKenBurnsImage(ctx, prevImg, width, height, prevClip.cameraMotion || 'zoom-in', 1, {
        alpha: 1 - transProgress
      });
      if (img) {
        drawKenBurnsImage(ctx, img, width, height, activeClip.cameraMotion || 'zoom-in', clipProgress, {
          alpha: transProgress
        });
      }
    } else if (transition === 'slide-left') {
      drawKenBurnsImage(ctx, prevImg, width, height, prevClip.cameraMotion || 'zoom-in', 1, {
        offsetX: -width * transProgress
      });
      if (img) {
        drawKenBurnsImage(ctx, img, width, height, activeClip.cameraMotion || 'zoom-in', clipProgress, {
          offsetX: width * (1 - transProgress)
        });
      }
    } else if (transition === 'zoom-in') {
      drawKenBurnsImage(ctx, prevImg, width, height, prevClip.cameraMotion || 'zoom-in', 1, {
        alpha: 1 - transProgress,
        extraScale: 1 + transProgress * 0.12
      });
      if (img) {
        drawKenBurnsImage(ctx, img, width, height, activeClip.cameraMotion || 'zoom-in', clipProgress, {
          extraScale: 1.08 - transProgress * 0.08
        });
      }
    } else if (img) {
      drawKenBurnsImage(ctx, img, width, height, activeClip.cameraMotion || 'zoom-in', clipProgress);
    }
  } else if (img && img.naturalWidth > 0) {
    drawKenBurnsImage(ctx, img, width, height, activeClip.cameraMotion || 'zoom-in', clipProgress);
  } else {
    ctx.fillStyle = '#181822';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#71717a';
    ctx.font = `${Math.round(height * 0.03)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`分镜镜头 ${activeClip.order}`, width / 2, height / 2);
  }

  if (inTransition && transition === 'fade-black') {
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - transProgress})`;
    ctx.fillRect(0, 0, width, height);
  } else if (inTransition && transition === 'crossfade' && !prevImg) {
    ctx.fillStyle = `rgba(0, 0, 0, ${(1 - transProgress) * 0.4})`;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.restore();

  const vignette = ctx.createRadialGradient(
    width / 2, height / 2, Math.min(width, height) * 0.35,
    width / 2, height / 2, Math.max(width, height) * 0.75
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);

  const subtitleText = clipShotNarration(activeClip);
  if (project.subtitles?.enabled && subtitleText) {
    drawExportSubtitles(ctx, width, height, activeClip, project.subtitles, clipProgress, subtitleText);
  }
}

function drawExportSubtitles(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  clip: StoryboardClip,
  config: SubtitleConfig,
  progress: number,
  subtitleText: string
) {
  const baseFontSize = Math.round(config.fontSize * (width / 950));
  const posY = (height * config.positionY) / 100;
  const maxWidthRatio = config.maxWidthRatio || 0.84;
  const maxLines = config.maxLines || 3;
  const typeface = resolveSubtitleTypeface(config);

  const layout = calculateSubtitleLayout(
    ctx,
    subtitleText,
    clip.secondaryText,
    width,
    baseFontSize,
    config.bilingual,
    maxWidthRatio,
    maxLines,
    typeface
  );

  if (layout.lines.length === 0) return;

  let scale = 1.0;
  if (config.animation === 'pop') {
    scale = progress < 0.15 ? 0.92 + (progress / 0.15) * 0.08 : 1.0;
  }

  ctx.save();
  ctx.translate(width / 2, posY);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (config.showBackground) {
    ctx.fillStyle = config.backgroundColor || 'rgba(0, 0, 0, 0.75)';
    const radius = Math.min(layout.boxHeight * 0.35, layout.fontSize * 0.5);
    ctx.beginPath();
    ctx.roundRect(-layout.boxWidth / 2, -layout.boxHeight / 2, layout.boxWidth, layout.boxHeight, radius);
    ctx.fill();
  }

  const primaryBlockHeight = layout.lines.length * layout.lineHeight;
  const startY = -layout.totalHeight / 2 + layout.lineHeight / 2;

  ctx.font = subtitleCanvasFont(typeface.primaryFamily, layout.fontSize, typeface.primaryWeight);

  layout.lines.forEach((line, idx) => {
    const lineY = startY + idx * layout.lineHeight;
    if (config.showStroke) {
      ctx.strokeStyle = config.strokeColor || '#000000';
      ctx.lineWidth = Math.max(3, layout.fontSize * 0.16);
      ctx.lineJoin = 'round';
      ctx.strokeText(line, 0, lineY);
    }
    ctx.fillStyle = config.primaryColor || '#ffffff';
    ctx.fillText(line, 0, lineY);
  });

  if (config.bilingual && layout.secondaryLines.length > 0) {
    ctx.font = subtitleCanvasFont(typeface.secondaryFamily, layout.secondaryFontSize, typeface.secondaryWeight);
    const secondaryStartY = -layout.totalHeight / 2 + primaryBlockHeight + layout.fontSize * 0.25 + layout.secondaryLineHeight / 2;

    layout.secondaryLines.forEach((secLine, idx) => {
      const secLineY = secondaryStartY + idx * layout.secondaryLineHeight;
      if (config.showStroke) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = Math.max(2, layout.secondaryFontSize * 0.15);
        ctx.lineJoin = 'round';
        ctx.strokeText(secLine, 0, secLineY);
      }
      ctx.fillStyle = config.highlightColor || '#facc15';
      ctx.fillText(secLine, 0, secLineY);
    });
  }

  ctx.restore();
}

/**
 * Fallback MediaRecorder implementation with full audio track integration
 */
async function exportViaMediaRecorder(
  project: VideoProject,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  loadedImages: (HTMLImageElement | null)[],
  mixedAudioBuffer: AudioBuffer | null,
  onProgress?: ExportProgressCallback
): Promise<{ blob: Blob; url: string; filename: string; format: 'mp4' | 'webm' }> {
  const fps = project.settings.frameRate || 30;
  const totalDuration = project.clips.reduce((acc, c) => acc + (c.duration || 3.5), 0) || 5;
  const totalFrames = Math.max(1, Math.floor(totalDuration * fps));

  const canvasStream = canvas.captureStream(fps);
  let mixedStream = canvasStream;
  let audioSourceNode: AudioBufferSourceNode | null = null;
  let audioContext: AudioContext | null = null;

  if (mixedAudioBuffer) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const dest = audioContext.createMediaStreamDestination();
      audioSourceNode = audioContext.createBufferSource();
      audioSourceNode.buffer = mixedAudioBuffer;
      audioSourceNode.connect(dest);

      const combinedTracks = [
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ];
      mixedStream = new MediaStream(combinedTracks);
    } catch (e) {
      console.warn('[MediaRecorder] Audio track merge warning:', e);
    }
  }

  const isMp4Supported = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1');
  const mimeType = isMp4Supported 
    ? 'video/mp4;codecs=avc1' 
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

  let mediaRecorder: MediaRecorder;
  try {
    mediaRecorder = new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: 8000000 });
  } catch {
    mediaRecorder = new MediaRecorder(mixedStream);
  }

  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      try {
        if (audioSourceNode) audioSourceNode.stop();
        if (audioContext) audioContext.close();
      } catch {
        // ignore
      }

      const finalFormat = isMp4Supported ? 'mp4' : 'webm';
      const blob = new Blob(chunks, { type: isMp4Supported ? 'video/mp4' : 'video/webm' });
      const url = URL.createObjectURL(blob);
      const safeTitle = (project.title || 'AI_Short_Video').replace(/[/\\?%*:|"<>]/g, '_');
      onProgress?.(100, '视频导出就绪！');
      resolve({
        blob,
        url,
        filename: `${safeTitle}.${finalFormat}`,
        format: finalFormat
      });
    };

    mediaRecorder.start();
    if (audioSourceNode) {
      audioSourceNode.start(0);
    }

    let frame = 0;
    const renderLoop = () => {
      if (frame >= totalFrames) {
        mediaRecorder.stop();
        return;
      }

      const currentTime = frame / fps;
      renderCanvasFrame(ctx, width, height, project, loadedImages, currentTime);
      frame++;

      if (frame % 5 === 0 || frame === totalFrames - 1) {
        const pct = 30 + Math.floor((frame / totalFrames) * 65);
        onProgress?.(pct, `正在录制视频帧 (${frame}/${totalFrames})...`);
      }

      requestAnimationFrame(renderLoop);
    };

    renderLoop();
  });
}
