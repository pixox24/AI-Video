import React, { useRef, useEffect, useState, useCallback } from 'react';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Maximize2, 
  Minimize2, 
  Volume2, 
  VolumeX, 
  Sparkles,
  RefreshCw,
  Camera,
  Layers
} from 'lucide-react';
import { StoryboardClip, SubtitleConfig, AudioConfig, ProjectSettings, OutroConfig } from '../types';
import { audioEngine } from '../utils/audioEngine';
import { drawClipSubtitles } from '../utils/subtitleRenderer';
import { outroFadeAlpha, outroTimeline, resolveOutro } from '../utils/outro';
import { clipShotNarration, isNarrationTrackFresh, mapNarrationToTimeline, mapTimelineToNarration } from '../utils/narrationTrack';
import { setPlayhead } from '../utils/playhead';
import { resolveTtsApi } from '../utils/presets';
import { showStatusToast } from '../utils/statusToast';
import {
  loadStudioFont,
  resolveSubtitleFontId
} from '../utils/subtitleFonts';

function formatTimecode(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec % 1) * 30);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
}

interface VideoPlayerStageProps {
  clips: StoryboardClip[];
  subtitles: SubtitleConfig;
  audio: AudioConfig;
  settings: ProjectSettings;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  isGeneratingNarration?: boolean;
  narrationError?: string | null;
}

export const VideoPlayerStage: React.FC<VideoPlayerStageProps> = ({
  clips,
  subtitles,
  audio,
  settings,
  currentTime,
  onTimeUpdate,
  isPlaying,
  onTogglePlay,
  selectedClipId,
  onSelectClip,
  isGeneratingNarration = false,
  narrationError = null,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const loadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(performance.now());
  const activeClipIndexRef = useRef<number>(-1);
  const timeRef = useRef<number>(currentTime);
  const lastUiPushRef = useRef<number>(0);
  const wasPlayingRef = useRef<boolean>(isPlaying);
  const outroConfigRef = useRef<OutroConfig>(resolveOutro(settings));

  useEffect(() => {
    outroConfigRef.current = resolveOutro(settings);
  }, [settings]);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const overlayTimeRef = useRef<HTMLSpanElement | null>(null);

  // Total duration
  const totalDuration = clips.reduce((acc, c) => acc + (c.duration || 3.5), 0) || 10;

  // Preload images into cache with CORS and proxy fallback
  useEffect(() => {
    clips.forEach((clip) => {
      if (clip.imageUrl && !loadedImagesRef.current.has(clip.imageUrl)) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = clip.imageUrl;
        img.onload = () => {
          loadedImagesRef.current.set(clip.imageUrl!, img);
        };
        img.onerror = () => {
          // If direct load failed (e.g. cross-origin/hotlink blocking), retry via proxy
          if (clip.imageUrl && clip.imageUrl.startsWith('http')) {
            const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(clip.imageUrl)}`;
            const retryImg = new Image();
            retryImg.crossOrigin = 'anonymous';
            retryImg.src = proxyUrl;
            retryImg.onload = () => {
              loadedImagesRef.current.set(clip.imageUrl!, retryImg);
            };
          }
        };
      }
    });
  }, [clips]);

  // Audio start/stop syncing with playback
  useEffect(() => {
    if (isPlaying) {
      if (audio.bgmEnabled && !isMuted) {
        audioEngine.startBgm(audio.bgmTrackId, audio.bgmVolume, audio.customBgmUrl);
      } else {
        audioEngine.stopBgm();
      }
    } else {
      audioEngine.stopBgm();
    }

    return () => {
      audioEngine.stopBgm();
    };
  }, [isPlaying, audio.bgmEnabled, audio.bgmTrackId, audio.bgmVolume, audio.customBgmUrl, isMuted]);

  const narrationFresh = isNarrationTrackFresh(audio, clips, resolveTtsApi(settings.customTtsApi));
  const subtitleFontId = resolveSubtitleFontId(subtitles);

  useEffect(() => {
    void loadStudioFont(subtitleFontId);
  }, [subtitleFontId]);

  useEffect(() => {
    if (audio.voiceoverEnabled && audio.narrationTrack?.audioUrl) {
      audioEngine.ensureFullNarration(audio.narrationTrack.audioUrl, audio.voiceoverVolume ?? 0.95);
    } else {
      audioEngine.stopFullNarration();
    }
  }, [audio.voiceoverEnabled, audio.narrationTrack?.audioUrl, audio.voiceoverVolume]);

  useEffect(() => {
    if (!isPlaying) {
      // Pausing the timeline must not kill the audio-panel "试听当前音色" session.
      if (!audioEngine.isVoicePreviewActive()) {
        audioEngine.stopNarration();
      }
      activeClipIndexRef.current = -1;
    }
  }, [isPlaying]);

  useEffect(() => {
    return () => {
      audioEngine.stopFullNarration();
    };
  }, []);

  // Determine active clip given a time
  const getClipAtTime = useCallback((time: number) => {
    let acc = 0;
    for (let i = 0; i < clips.length; i++) {
      const duration = clips[i].duration || 3.5;
      if (time >= acc && time < acc + duration) {
        return { clip: clips[i], index: i, clipTime: time - acc, clipDuration: duration };
      }
      acc += duration;
    }
    // Fallback to last clip
    if (clips.length > 0) {
      const lastIndex = clips.length - 1;
      const lastDuration = clips[lastIndex].duration || 3.5;
      return { clip: clips[lastIndex], index: lastIndex, clipTime: lastDuration, clipDuration: lastDuration };
    }
    return null;
  }, [clips]);

  const renderCanvas = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!ctxRef.current || ctxRef.current.canvas !== canvas) {
      ctxRef.current = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    }
    const ctx = ctxRef.current;
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Background color
    if (settings.canvasBackground === 'blur') {
      ctx.fillStyle = '#0a0a0f';
    } else {
      ctx.fillStyle = settings.canvasBackground || '#0a0a0c';
    }
    ctx.fillRect(0, 0, width, height);

    const currentInfo = getClipAtTime(time);
    if (!currentInfo || !currentInfo.clip) return;

    const { clip, index, clipTime, clipDuration } = currentInfo;
    const progress = Math.min(1, Math.max(0, clipTime / clipDuration));

    // Draw image with Ken Burns Camera Motion
    const img = clip.imageUrl ? loadedImagesRef.current.get(clip.imageUrl) : null;

    ctx.save();
    // Clip to canvas bounds
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();

    if (img && img.complete && img.naturalWidth > 0) {
      // Calculate aspect fill
      const scaleX = width / img.naturalWidth;
      const scaleY = height / img.naturalHeight;
      const baseScale = Math.max(scaleX, scaleY);

      let motionScale = 1.0;
      let motionOffsetX = 0;
      let motionOffsetY = 0;

      const motion = clip.cameraMotion || 'zoom-in';

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

      const finalScale = baseScale * motionScale;
      const drawW = img.naturalWidth * finalScale;
      const drawH = img.naturalHeight * finalScale;
      const drawX = (width - drawW) / 2 + motionOffsetX;
      const drawY = (height - drawH) / 2 + motionOffsetY;

      ctx.drawImage(img, drawX, drawY, drawW, drawH);
    } else {
      // Drawing elegant placeholder if image loading
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#1c1917');
      grad.addColorStop(1, '#0c0a09');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`镜头 ${clip.order} · 生成中`, width / 2, height / 2);
    }

    // Handle Transitions (Fade in at start of clip)
    const transitionDuration = 0.4;
    if (clipTime < transitionDuration && index > 0) {
      const transProgress = clipTime / transitionDuration;
      if (clip.transition === 'fade-black') {
        ctx.fillStyle = `rgba(0, 0, 0, ${1 - transProgress})`;
        ctx.fillRect(0, 0, width, height);
      } else if (clip.transition === 'crossfade') {
        // Subtle crossfade brightening
        ctx.fillStyle = `rgba(0, 0, 0, ${(1 - transProgress) * 0.4})`;
        ctx.fillRect(0, 0, width, height);
      }
    }

    ctx.restore();

    // Subtle cinematic vignette
    const vignette = ctx.createRadialGradient(
      width / 2, height / 2, Math.min(width, height) * 0.35,
      width / 2, height / 2, Math.max(width, height) * 0.75
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    // Draw Subtitles on Canvas
    if (subtitles.enabled && clipShotNarration(clip)) {
      drawClipSubtitles(ctx, width, height, clip, subtitles, progress, clipShotNarration(clip));
    }

    // Outro fade-to-black: 最后一镜收束，字幕随画面一起沉入黑场
    const outro = outroTimeline(clips, resolveOutro(settings));
    const alpha = outroFadeAlpha(outro, time);
    if (alpha > 0) {
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
      ctx.fillRect(0, 0, width, height);
    }

    // Draw Safe Zone Margins if enabled
    if (settings.safeMargin) {
      drawSafeZones(ctx, width, height);
    }

  }, [clips, subtitles, settings, getClipAtTime]);

  // Draw Social Media Safe Zones overlay
  const drawSafeZones = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    ctx.save();
    ctx.strokeStyle = 'rgba(234, 179, 8, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);

    // Top status safe zone (10%)
    ctx.strokeRect(w * 0.05, h * 0.08, w * 0.9, h * 0.78);

    // Right action icons zone (TikTok like / share)
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.fillRect(w * 0.85, h * 0.45, w * 0.12, h * 0.35);

    // Labels
    ctx.fillStyle = 'rgba(234, 179, 8, 0.8)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('短视频安全区域 (Safe Margin)', w * 0.06, h * 0.11);
    ctx.restore();
  };

  useEffect(() => {
    if (isPlaying) {
      if (Math.abs(currentTime - timeRef.current) > 0.35) {
        timeRef.current = currentTime;
        setPlayhead(currentTime);
        audioEngine.requestNarrationSeek();
      }
      return;
    }
    timeRef.current = currentTime;
    setPlayhead(currentTime);
    audioEngine.requestNarrationSeek();
  }, [currentTime, isPlaying]);

  useEffect(() => {
    if (wasPlayingRef.current && !isPlaying) {
      onTimeUpdate(timeRef.current);
    }
    if (!wasPlayingRef.current && isPlaying) {
      lastTimeRef.current = performance.now();
      audioEngine.requestNarrationSeek();
    }
    wasPlayingRef.current = isPlaying;
  }, [isPlaying, onTimeUpdate]);

  const syncNarrationAt = useCallback((time: number, playing: boolean) => {
    if (isMuted || !audio.voiceoverEnabled) {
      audioEngine.syncFullNarration(0, false, true, 0);
      return;
    }
    if (audio.narrationTrack) {
      const mapped = mapTimelineToNarration(time, clips, audio.narrationTrack);
      audioEngine.syncFullNarration(
        mapped.audioTime,
        playing,
        mapped.frozen,
        audio.voiceoverVolume ?? 0.95
      );
      return;
    }
    const hasLinkedVoiceover = clips.some((item) => item.voRole === 'continue');
    if (hasLinkedVoiceover) {
      // Linked utterances use the full aligned track. Skip per-clip TTS, but
      // never stop an in-flight audio-panel voice preview from this rAF tick.
      if (playing && !audioEngine.isVoicePreviewActive()) {
        audioEngine.stopNarration();
      }
      return;
    }
    const info = getClipAtTime(time);
    if (playing && info && activeClipIndexRef.current !== info.index) {
      activeClipIndexRef.current = info.index;
      if (info.clip.narration) {
        audioEngine.speakNarration(info.clip.narration, audio.voiceCharacter, audio.speechRate);
      }
    }
  }, [audio, clips, getClipAtTime, isMuted, narrationFresh]);

  useEffect(() => {
    lastTimeRef.current = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(0.08, Math.max(0, (now - lastTimeRef.current) / 1000));
      lastTimeRef.current = now;

      if (isPlaying) {
        let next = timeRef.current + delta;
        if (audio.narrationTrack && audio.voiceoverEnabled && !isMuted) {
          const mapped = mapTimelineToNarration(timeRef.current, clips, audio.narrationTrack);
          audioEngine.syncFullNarration(
            mapped.audioTime,
            !mapped.frozen,
            mapped.frozen,
            audio.voiceoverVolume ?? 0.95
          );
          const audioTime = audioEngine.getFullNarrationTime();
          if (!mapped.frozen && audioTime != null && !audioEngine.isFullNarrationPaused()) {
            next = mapNarrationToTimeline(audioTime, clips, audio.narrationTrack);
          }
        } else {
          syncNarrationAt(next, true);
        }
        // 片尾音乐淡出：进入淡出窗口开始收弱，回跳则恢复
        const outro = outroTimeline(clips, outroConfigRef.current);
        if (outro && outro.musicFadeDuration > 0 && next >= outro.musicFadeStart) {
          audioEngine.beginTimelineBgmOutro(Math.max(120, (outro.totalDuration - next) * 1000));
        } else {
          audioEngine.cancelTimelineBgmOutro();
        }
        if (next >= totalDuration) {
          next = 0;
          activeClipIndexRef.current = -1;
          audioEngine.requestNarrationSeek();
        }
        timeRef.current = next;
        setPlayhead(next);
        if (overlayTimeRef.current) {
          overlayTimeRef.current.textContent = `${formatTimecode(next)} \\ ${formatTimecode(totalDuration)}`;
        }
        if (now - lastUiPushRef.current >= 150) {
          lastUiPushRef.current = now;
          onTimeUpdate(next);
        }
      } else {
        syncNarrationAt(timeRef.current, false);
      }

      renderCanvas(timeRef.current);
      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isPlaying, totalDuration, onTimeUpdate, renderCanvas, syncNarrationAt, narrationFresh, audio, clips, isMuted]);

  // Compute container aspect ratio style
  const getAspectDimensions = () => {
    if (settings.aspectRatio === '9:16') {
      return { width: 720, height: 1280, style: 'aspect-[9/16] max-h-[82vh]' };
    } else if (settings.aspectRatio === '1:1') {
      return { width: 1080, height: 1080, style: 'aspect-square max-h-[82vh]' };
    } else if (settings.aspectRatio === '4:5') {
      return { width: 864, height: 1080, style: 'aspect-[4/5] max-h-[82vh]' };
    }
    // 16:9
    return { width: 1280, height: 720, style: 'aspect-[16/9] max-w-[92%] max-h-[80vh]' };
  };

  const aspect = getAspectDimensions();

  const handlePreviewPlayToggle = () => {
    if (!isPlaying) {
      if (isGeneratingNarration) {
        showStatusToast('旁白还在合成，画面可以先看', { tone: 'warn', id: 'narration-play' });
      } else if (!narrationFresh) {
        showStatusToast(
          narrationError
            ? `旁白失败：${narrationError}`
            : audio.narrationTrack
              ? '旁白需重生成，预览暂无声'
              : '还没配音，预览暂无声',
          { tone: narrationError ? 'error' : 'warn', id: 'narration-play' }
        );
      }
    }
    onTogglePlay();
  };

  // Fullscreen handler
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => console.error(err));
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      id="video-player-stage"
      className="flex-1 bg-[#101015] border border-[#23232c] rounded-2xl flex flex-col items-center justify-center relative p-3 sm:p-4 select-none overflow-hidden shadow-xl shadow-black/40 min-h-0"
    >
      {/* Canvas Viewport Frame */}
      <div 
        className={`relative ${aspect.style} w-full flex items-center justify-center shadow-2xl shadow-black rounded-2xl overflow-hidden border border-[#22222a] bg-black`}
      >
        <canvas
          ref={canvasRef}
          width={aspect.width}
          height={aspect.height}
          onClick={handlePreviewPlayToggle}
          className="w-full h-full object-contain cursor-pointer"
        />

        {/* Center Big Play Button Overlay when paused */}
        {!isPlaying && (
          <button
            id="btn-stage-play"
            onClick={handlePreviewPlayToggle}
            className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-black/60 hover:bg-amber-500/90 text-white hover:text-black border border-white/20 flex items-center justify-center shadow-2xl backdrop-blur-md transition-all cursor-pointer transform hover:scale-110 active:scale-95"
          >
            <Play className="w-7 h-7 fill-current ml-1" />
          </button>
        )}

        {/* Hover Stage Overlay HUD (Controls) */}
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between px-3.5 py-2 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 text-white text-xs opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300">
          <div className="flex items-center gap-3">
            <button
              onClick={handlePreviewPlayToggle}
              className="p-1 hover:text-amber-400 cursor-pointer transition-colors"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            </button>

            <button
              onClick={() => onTimeUpdate(0)}
              className="p-1 hover:text-amber-400 cursor-pointer transition-colors"
              title="重头播放"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            {/* Timecode display matching reference format */}
            <span ref={overlayTimeRef} className="font-mono text-zinc-300 text-[11px]">
              {formatTimecode(currentTime)} \ {formatTimecode(totalDuration)}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsMuted(!isMuted)}
              className="p-1 hover:text-amber-400 cursor-pointer text-zinc-300 transition-colors"
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <button
              onClick={toggleFullscreen}
              className="p-1 hover:text-amber-400 cursor-pointer text-zinc-300 transition-colors"
              title="全屏预览"
            >
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
