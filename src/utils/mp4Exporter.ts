import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { VideoProject, StoryboardClip } from '../types';
import { calculateSubtitleLayout } from './subtitleFormatter';
import { BGM_TRACKS } from './presets';

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
      for (let i = 0; i < project.clips.length; i++) {
        const clip = project.clips[i];
        const clipStart = accTime;
        const clipDur = clip.duration || 3.5;
        accTime += clipDur;

        if (clip.narration && clip.narration.trim()) {
          try {
            const res = await fetch('/api/audio/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: clip.narration.trim(),
                character: voiceCharacter,
                rate: speechRate
              })
            });

            if (res.ok) {
              const data = await res.json();
              if (data?.audioUrl) {
                const arrayBuf = base64ToArrayBuffer(data.audioUrl);
                const decodedBuffer = await decodeCtx.decodeAudioData(arrayBuf);

                // Schedule voice clip in offline context
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
      const trackDef = BGM_TRACKS.find(t => t.id === bgmTrackId);
      const bgmUrl = project.audio?.customBgmUrl || (trackDef ? trackDef.url : '/audio/bgm/epic-cinematic.mp3');

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
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = clip.imageUrl;
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
 * Render single video frame to Canvas
 */
function renderCanvasFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: VideoProject,
  loadedImages: (HTMLImageElement | null)[],
  currentTime: number
) {
  // Find current active clip
  let accumulatedTime = 0;
  let activeClip: StoryboardClip = project.clips[0] || {
    id: 'default',
    order: 1,
    duration: 3.5,
    narration: '',
    visualPrompt: '',
    cameraMotion: 'zoom-in',
    transition: 'crossfade'
  };
  let activeClipIndex = 0;
  let clipStartTime = 0;
  let clipDuration = 3.5;

  for (let i = 0; i < project.clips.length; i++) {
    const d = project.clips[i].duration || 3.5;
    if (currentTime >= accumulatedTime && currentTime < accumulatedTime + d) {
      activeClip = project.clips[i];
      activeClipIndex = i;
      clipStartTime = accumulatedTime;
      clipDuration = d;
      break;
    }
    accumulatedTime += d;
  }

  const clipProgress = Math.min(1, Math.max(0, (currentTime - clipStartTime) / clipDuration));

  // 1. Draw Background
  const bgType = project.settings.canvasBackground;
  if (bgType === 'blur') {
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, width, height);
  } else {
    ctx.fillStyle = bgType || '#0a0a0c';
    ctx.fillRect(0, 0, width, height);
  }

  // 2. Draw Image with Dynamic Camera Motion
  const img = loadedImages[activeClipIndex];
  if (img && img.naturalWidth > 0) {
    const scaleX = width / img.naturalWidth;
    const scaleY = height / img.naturalHeight;
    const baseScale = Math.max(scaleX, scaleY);

    let motionScale = 1.0;
    let motionOffsetX = 0;
    let motionOffsetY = 0;

    const motion = activeClip.cameraMotion || 'zoom-in';
    if (motion === 'zoom-in') {
      motionScale = 1.0 + clipProgress * 0.12;
    } else if (motion === 'zoom-out') {
      motionScale = 1.12 - clipProgress * 0.12;
    } else if (motion === 'pan-left') {
      motionScale = 1.08;
      motionOffsetX = (clipProgress - 0.5) * width * 0.06;
    } else if (motion === 'pan-right') {
      motionScale = 1.08;
      motionOffsetX = (0.5 - clipProgress) * width * 0.06;
    }

    const finalScale = baseScale * motionScale;
    const drawW = img.naturalWidth * finalScale;
    const drawH = img.naturalHeight * finalScale;
    const drawX = (width - drawW) / 2 + motionOffsetX;
    const drawY = (height - drawH) / 2 + motionOffsetY;

    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    // Subtle dark gradient vignette for better subtitle readability
    const gradient = ctx.createLinearGradient(0, height * 0.55, 0, height);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, height * 0.55, width, height * 0.45);
  } else {
    // Placeholder background if image not yet loaded
    ctx.fillStyle = '#181822';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#71717a';
    ctx.font = `${Math.round(height * 0.03)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`分镜镜头 ${activeClip.order}`, width / 2, height / 2);
  }

  // 3. Draw Subtitles with Smart Multi-line Anti-Overflow Layout
  if (project.subtitles && project.subtitles.enabled && activeClip.narration) {
    const baseFontSize = Math.round(project.subtitles.fontSize * (width / 950));
    const posY = (height * project.subtitles.positionY) / 100;
    const maxWidthRatio = project.subtitles.maxWidthRatio || 0.84;
    const maxLines = project.subtitles.maxLines || 3;

    const layout = calculateSubtitleLayout(
      ctx,
      activeClip.narration,
      activeClip.secondaryText,
      width,
      baseFontSize,
      project.subtitles.bilingual,
      maxWidthRatio,
      maxLines
    );

    if (layout.lines.length > 0) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Subtitle Background Box / Pill
      if (project.subtitles.showBackground) {
        ctx.fillStyle = project.subtitles.backgroundColor || 'rgba(0, 0, 0, 0.75)';
        const radius = Math.min(layout.boxHeight * 0.35, layout.fontSize * 0.5);
        ctx.beginPath();
        ctx.roundRect(width / 2 - layout.boxWidth / 2, posY - layout.boxHeight / 2, layout.boxWidth, layout.boxHeight, radius);
        ctx.fill();
      }

      const primaryBlockHeight = layout.lines.length * layout.lineHeight;
      const startY = posY - layout.totalHeight / 2 + layout.lineHeight / 2;

      // Primary Chinese Text
      ctx.font = `bold ${layout.fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`;

      layout.lines.forEach((line, idx) => {
        const lineY = startY + idx * layout.lineHeight;

        // Stroke
        if (project.subtitles.showStroke) {
          ctx.strokeStyle = project.subtitles.strokeColor || '#000000';
          ctx.lineWidth = Math.max(3, layout.fontSize * 0.16);
          ctx.lineJoin = 'round';
          ctx.strokeText(line, width / 2, lineY);
        }

        // Fill
        ctx.fillStyle = project.subtitles.primaryColor || '#ffffff';
        ctx.fillText(line, width / 2, lineY);
      });

      // Secondary Bilingual Text
      if (project.subtitles.bilingual && layout.secondaryLines.length > 0) {
        ctx.font = `500 ${layout.secondaryFontSize}px "PingFang SC", sans-serif`;
        const secondaryStartY = posY - layout.totalHeight / 2 + primaryBlockHeight + layout.fontSize * 0.25 + layout.secondaryLineHeight / 2;

        layout.secondaryLines.forEach((secLine, idx) => {
          const secLineY = secondaryStartY + idx * layout.secondaryLineHeight;

          if (project.subtitles.showStroke) {
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = Math.max(2, layout.secondaryFontSize * 0.15);
            ctx.lineJoin = 'round';
            ctx.strokeText(secLine, width / 2, secLineY);
          }

          ctx.fillStyle = project.subtitles.highlightColor || '#facc15';
          ctx.fillText(secLine, width / 2, secLineY);
        });
      }

      ctx.restore();
    }
  }
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
