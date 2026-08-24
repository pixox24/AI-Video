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
import { StoryboardClip, SubtitleConfig, AudioConfig, ProjectSettings } from '../types';
import { audioEngine } from '../utils/audioEngine';
import { calculateSubtitleLayout } from '../utils/subtitleFormatter';

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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const loadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(performance.now());
  const activeClipIndexRef = useRef<number>(0);

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
        audioEngine.startBgm(audio.bgmTrackId, audio.bgmVolume);
      }
    } else {
      audioEngine.stopBgm();
      audioEngine.stopNarration();
    }

    return () => {
      audioEngine.stopBgm();
      audioEngine.stopNarration();
    };
  }, [isPlaying, audio.bgmEnabled, audio.bgmTrackId, audio.bgmVolume, isMuted]);

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

  // Main 60 FPS Render Loop
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
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

    const currentInfo = getClipAtTime(currentTime);
    if (!currentInfo || !currentInfo.clip) return;

    const { clip, index, clipTime, clipDuration } = currentInfo;
    const progress = Math.min(1, Math.max(0, clipTime / clipDuration));

    // Handle voiceover triggering at start of clip during playback
    if (isPlaying && activeClipIndexRef.current !== index) {
      activeClipIndexRef.current = index;
      if (audio.voiceoverEnabled && !isMuted && clip.narration) {
        audioEngine.speakNarration(
          clip.narration,
          audio.voiceCharacter,
          audio.speechRate
        );
      }
    }

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
    if (subtitles.enabled && clip.narration) {
      drawSubtitles(ctx, width, height, clip, subtitles, progress);
    }

    // Draw Safe Zone Margins if enabled
    if (settings.safeMargin) {
      drawSafeZones(ctx, width, height);
    }

  }, [clips, subtitles, audio, settings, currentTime, isPlaying, isMuted, getClipAtTime]);

  // Subtitle drawing function with smart multi-line anti-overflow layout
  const drawSubtitles = (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    clip: StoryboardClip,
    config: SubtitleConfig,
    progress: number
  ) => {
    const baseFontSize = Math.round(config.fontSize * (w / 950));
    const posY = (h * config.positionY) / 100;
    const maxWidthRatio = config.maxWidthRatio || 0.84;
    const maxLines = config.maxLines || 3;

    // Calculate smart multi-line layout
    const layout = calculateSubtitleLayout(
      ctx,
      clip.narration,
      clip.secondaryText,
      w,
      baseFontSize,
      config.bilingual,
      maxWidthRatio,
      maxLines
    );

    if (layout.lines.length === 0) return;

    // Pop scale animation
    let scale = 1.0;
    if (config.animation === 'pop') {
      scale = progress < 0.15 ? 0.92 + (progress / 0.15) * 0.08 : 1.0;
    }

    ctx.save();
    ctx.translate(w / 2, posY);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw background box / capsule
    if (config.showBackground) {
      ctx.fillStyle = config.backgroundColor;
      const radius = Math.min(layout.boxHeight * 0.35, layout.fontSize * 0.5);
      ctx.beginPath();
      ctx.roundRect(-layout.boxWidth / 2, -layout.boxHeight / 2, layout.boxWidth, layout.boxHeight, radius);
      ctx.fill();
    }

    // Starting Y offset for lines within the block
    const primaryBlockHeight = layout.lines.length * layout.lineHeight;
    const startY = -layout.totalHeight / 2 + layout.lineHeight / 2;

    // Render Primary Chinese Narration Lines
    ctx.font = `bold ${layout.fontSize}px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;

    layout.lines.forEach((line, idx) => {
      const lineY = startY + idx * layout.lineHeight;

      // Text stroke
      if (config.showStroke) {
        ctx.strokeStyle = config.strokeColor || '#000000';
        ctx.lineWidth = Math.max(3, layout.fontSize * 0.16);
        ctx.lineJoin = 'round';
        ctx.strokeText(line, 0, lineY);
      }

      // Text Fill
      ctx.fillStyle = config.primaryColor || '#ffffff';
      ctx.fillText(line, 0, lineY);
    });

    // Render Secondary Bilingual English Lines
    if (config.bilingual && layout.secondaryLines.length > 0) {
      ctx.font = `500 ${layout.secondaryFontSize}px system-ui, -apple-system, sans-serif`;
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
  };

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

  // Animation Frame Loop
  useEffect(() => {
    let animId: number;

    const tick = (now: number) => {
      const delta = (now - lastTimeRef.current) / 1000;
      lastTimeRef.current = now;

      if (isPlaying) {
        onTimeUpdate(Math.min(totalDuration, currentTime + delta));
        if (currentTime >= totalDuration) {
          // Loop or stop
          onTimeUpdate(0);
          activeClipIndexRef.current = -1;
        }
      }

      renderCanvas();
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, currentTime, totalDuration, onTimeUpdate, renderCanvas]);

  // Format Time (00:00:00 \ 00:08:00)
  const formatTimecode = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const f = Math.floor((sec % 1) * 30);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  };

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
          onClick={onTogglePlay}
          className="w-full h-full object-contain cursor-pointer"
        />

        {/* Center Big Play Button Overlay when paused */}
        {!isPlaying && (
          <button
            id="btn-stage-play"
            onClick={onTogglePlay}
            className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-black/60 hover:bg-amber-500/90 text-white hover:text-black border border-white/20 flex items-center justify-center shadow-2xl backdrop-blur-md transition-all cursor-pointer transform hover:scale-110 active:scale-95"
          >
            <Play className="w-7 h-7 fill-current ml-1" />
          </button>
        )}

        {/* Hover Stage Overlay HUD (Controls) */}
        <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between px-3.5 py-2 rounded-xl bg-black/70 backdrop-blur-md border border-white/10 text-white text-xs opacity-0 hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300">
          <div className="flex items-center gap-3">
            <button
              onClick={onTogglePlay}
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
            <span className="font-mono text-zinc-300 text-[11px]">
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
