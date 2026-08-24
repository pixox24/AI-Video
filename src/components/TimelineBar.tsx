import React, { useRef, useState, useEffect, useCallback } from 'react';
import { 
  Play, 
  Pause, 
  Plus, 
  RotateCcw, 
  ZoomIn, 
  ZoomOut, 
  Clock, 
  Sparkles, 
  Layers, 
  HelpCircle, 
  Film, 
  Zap, 
  Maximize2, 
  Volume2, 
  MessageSquare, 
  Music, 
  Video, 
  GripVertical, 
  Check, 
  Sliders,
  Loader2,
  Hourglass
} from 'lucide-react';
import { StoryboardClip, TransitionType, CameraMotion } from '../types';

interface TimelineBarProps {
  clips: StoryboardClip[];
  onClipsChange: (clips: StoryboardClip[]) => void;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
}

const TRANSITIONS: { id: TransitionType; name: string; icon: string; desc: string }[] = [
  { id: 'crossfade', name: '叠化', icon: '⚡', desc: '自然平滑淡入淡出，电影级质感' },
  { id: 'slide-left', name: '平移', icon: '➡️', desc: '短视频节奏推镜，动感明快' },
  { id: 'fade-black', name: '黑场', icon: '⚫', desc: '淡入黑场，用于叙事段落转折' },
  { id: 'zoom-in', name: '推进', icon: '🔍', desc: '镜头冲入变焦，极具视觉冲击' },
  { id: 'none', name: '直切', icon: '🎬', desc: '无特效硬切，写实直接' },
];

const CAMERA_MOTIONS: { id: CameraMotion; name: string; icon: string; desc: string }[] = [
  { id: 'zoom-in', name: '推进', icon: '🔍', desc: '镜头平缓推近，突出视觉焦点' },
  { id: 'zoom-out', name: '拉远', icon: '🔎', desc: '镜头缓缓拉开，展现宏大环境' },
  { id: 'pan-left', name: '左移', icon: '⬅️', desc: '平稳向左横摇，叙事感强' },
  { id: 'pan-right', name: '右移', icon: '➡️', desc: '平稳向右横移，引导视线' },
  { id: 'tilt-up', name: '仰视', icon: '⬆️', desc: '由下至上摇镜，营造威严感' },
  { id: 'tilt-down', name: '俯视', icon: '⬇️', desc: '由上至下俯拍，俯瞰全貌' },
  { id: 'cinematic-orbit', name: '环绕', icon: '🔄', desc: '电影级弧形环绕旋转' },
  { id: 'static', name: '静止', icon: '⏸️', desc: '固定机位稳定拍摄' },
];

export const TimelineBar: React.FC<TimelineBarProps> = ({
  clips,
  onClipsChange,
  currentTime,
  onTimeUpdate,
  isPlaying,
  onTogglePlay,
  selectedClipId,
  onSelectClip,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isDraggingPlayheadRef = useRef<boolean>(false);
  const isTrimmingRef = useRef<boolean>(false);
  const isReorderingRef = useRef<boolean>(false);
  const autoScrollAnimFrameRef = useRef<number | null>(null);
  const currentPointerClientXRef = useRef<number>(0);
  
  const [isDragging, setIsDragging] = useState(false);

  // Zoom scale: pixels per second (Default 90px/s)
  const [pixelsPerSecond, setPixelsPerSecond] = useState<number>(90);

  // Multi-track view mode toggle (expanded multi-track vs compact single track)
  const [isTrackExpanded, setIsTrackExpanded] = useState<boolean>(true);

  // Hover Scrubbing Preview State
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<{ x: number; clientX: number } | null>(null);

  // Active Trimming State
  const [trimmingClipId, setTrimmingClipId] = useState<string | null>(null);
  const [trimData, setTrimData] = useState<{ originalDuration: number; newDuration: number } | null>(null);

  // Drag & Drop Reordering State
  const [draggedClipIndex, setDraggedClipIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Inline Popovers
  const [activeTransitionClipIndex, setActiveTransitionClipIndex] = useState<number | null>(null);
  const [activeMotionClipId, setActiveMotionClipId] = useState<string | null>(null);

  // Keyboard shortcut guide modal
  const [showShortcutHelp, setShowShortcutHelp] = useState<boolean>(false);

  const totalDuration = clips.reduce((acc, c) => acc + (c.duration || 3.5), 0) || 10;
  const timelineContentWidth = Math.max(900, totalDuration * pixelsPerSecond + 200);

  // Format Timecode
  const formatTimecode = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 10);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`;
  };

  const formatHeaderTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const f = Math.floor((sec % 1) * 30);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  };

  // Find cumulative start time of a clip
  const getClipStartTime = useCallback((index: number) => {
    let acc = 0;
    for (let i = 0; i < index; i++) {
      acc += clips[i].duration || 3.5;
    }
    return acc;
  }, [clips]);

  // Find active clip at a given timestamp
  const getClipAtTime = useCallback((time: number) => {
    let acc = 0;
    for (let i = 0; i < clips.length; i++) {
      const duration = clips[i].duration || 3.5;
      if (time >= acc && time < acc + duration) {
        return { clip: clips[i], index: i, start: acc, progress: (time - acc) / duration };
      }
      acc += duration;
    }
    return clips.length > 0 ? { clip: clips[clips.length - 1], index: clips.length - 1, start: acc - (clips[clips.length - 1]?.duration || 3.5), progress: 1 } : null;
  }, [clips]);

  // Handle zooming
  const handleZoomIn = () => {
    setPixelsPerSecond(prev => Math.min(260, prev + 25));
  };

  const handleZoomOut = () => {
    setPixelsPerSecond(prev => Math.max(45, prev - 25));
  };

  const handleResetZoom = () => {
    setPixelsPerSecond(90);
  };

  // Fit to screen (自适应全片)
  const handleFitToScreen = () => {
    if (!scrollContainerRef.current) return;
    const containerWidth = scrollContainerRef.current.clientWidth - 80;
    if (totalDuration > 0 && containerWidth > 100) {
      const calculatedPps = Math.max(40, Math.min(220, containerWidth / totalDuration));
      setPixelsPerSecond(Math.round(calculatedPps));
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollLeft = 0;
      }
    }
  };

  // Wheel zoom listener (Ctrl + Wheel or horizontal scroll)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 15 : -15;
        setPixelsPerSecond(prev => Math.max(40, Math.min(260, prev + delta)));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  // Cleanup auto-scroll loop on unmount
  useEffect(() => {
    return () => {
      if (autoScrollAnimFrameRef.current !== null) {
        cancelAnimationFrame(autoScrollAnimFrameRef.current);
        autoScrollAnimFrameRef.current = null;
      }
    };
  }, []);

  // Stop auto scrolling loop
  const stopAutoScroll = useCallback(() => {
    if (autoScrollAnimFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollAnimFrameRef.current);
      autoScrollAnimFrameRef.current = null;
    }
  }, []);

  // Convert mouse X position relative to scroll container to time
  const getTimeFromPointerX = useCallback((clientX: number) => {
    if (!scrollContainerRef.current) return 0;
    const rect = scrollContainerRef.current.getBoundingClientRect();
    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const relativeX = clientX - rect.left + scrollLeft - 16;
    const rawTime = relativeX / pixelsPerSecond;
    const snappedTime = Math.round(rawTime * 10) / 10;
    return Math.max(0, Math.min(totalDuration, snappedTime));
  }, [pixelsPerSecond, totalDuration]);

  // High-performance boundary auto-scroll engine with progressive acceleration
  const checkAndRunAutoScroll = useCallback((
    clientX: number,
    onTick: (newTime: number) => void
  ) => {
    currentPointerClientXRef.current = clientX;
    const container = scrollContainerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const EDGE_ZONE = 48; // Edge detection proximity in pixels

    let velocity = 0;
    if (clientX > rect.right - EDGE_ZONE) {
      // Near or dragging beyond right edge
      const distance = clientX - (rect.right - EDGE_ZONE);
      velocity = Math.min(32, Math.max(4, distance * 0.35));
    } else if (clientX < rect.left + EDGE_ZONE) {
      // Near or dragging beyond left edge
      const distance = (rect.left + EDGE_ZONE) - clientX;
      velocity = -Math.min(32, Math.max(4, distance * 0.35));
    }

    if (velocity === 0) {
      stopAutoScroll();
      return;
    }

    // Loop already running, step will read updated clientX
    if (autoScrollAnimFrameRef.current !== null) return;

    const scrollStep = () => {
      if (!scrollContainerRef.current) {
        stopAutoScroll();
        return;
      }

      const currentContainer = scrollContainerRef.current;
      const currentRect = currentContainer.getBoundingClientRect();
      const ptrX = currentPointerClientXRef.current;

      let currentVel = 0;
      if (ptrX > currentRect.right - EDGE_ZONE) {
        const dist = ptrX - (currentRect.right - EDGE_ZONE);
        currentVel = Math.min(32, Math.max(4, dist * 0.35));
      } else if (ptrX < currentRect.left + EDGE_ZONE) {
        const dist = (currentRect.left + EDGE_ZONE) - ptrX;
        currentVel = -Math.min(32, Math.max(4, dist * 0.35));
      }

      if (currentVel !== 0) {
        currentContainer.scrollLeft += currentVel;
        const newTime = getTimeFromPointerX(ptrX);
        onTick(newTime);
        autoScrollAnimFrameRef.current = requestAnimationFrame(scrollStep);
      } else {
        stopAutoScroll();
      }
    };

    autoScrollAnimFrameRef.current = requestAnimationFrame(scrollStep);
  }, [getTimeFromPointerX, stopAutoScroll]);

  // 1. Playhead dragging with boundary auto-scroll
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || isTrimmingRef.current || isReorderingRef.current) return;
    
    isDraggingPlayheadRef.current = true;
    setIsDragging(true);

    const targetTime = getTimeFromPointerX(e.clientX);
    onTimeUpdate(targetTime);

    // Initial check for edge proximity
    checkAndRunAutoScroll(e.clientX, (t) => onTimeUpdate(t));

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!isDraggingPlayheadRef.current) return;
      const updatedTime = getTimeFromPointerX(moveEvent.clientX);
      onTimeUpdate(updatedTime);
      checkAndRunAutoScroll(moveEvent.clientX, (t) => onTimeUpdate(t));
    };

    const handlePointerUp = () => {
      isDraggingPlayheadRef.current = false;
      setIsDragging(false);
      stopAutoScroll();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // 2. Hover Scrubbing Tracking
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging || isTrimmingRef.current || isReorderingRef.current || !scrollContainerRef.current) return;
    const rect = scrollContainerRef.current.getBoundingClientRect();
    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const x = e.clientX - rect.left + scrollLeft - 16;
    const time = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
    setHoverTime(time);
    setHoverPosition({ x: x + 16, clientX: e.clientX });
  };

  const handleMouseLeave = () => {
    if (!isDragging && !isTrimmingRef.current && !isReorderingRef.current) {
      setHoverTime(null);
      setHoverPosition(null);
    }
  };

  // 3. Direct Edge Trim Handle (Drag to adjust clip duration)
  const handleTrimStart = (e: React.PointerEvent, clipId: string, initialDuration: number) => {
    e.stopPropagation();
    e.preventDefault();

    isTrimmingRef.current = true;
    setTrimmingClipId(clipId);
    setTrimData({ originalDuration: initialDuration, newDuration: initialDuration });

    const startX = e.clientX;

    const handleTrimMove = (moveEvent: PointerEvent) => {
      const deltaPixels = moveEvent.clientX - startX;
      const deltaSec = deltaPixels / pixelsPerSecond;
      const calculated = Math.max(0.8, Math.min(15.0, Math.round((initialDuration + deltaSec) * 10) / 10));

      setTrimData({ originalDuration: initialDuration, newDuration: calculated });

      const updated = clips.map(c => c.id === clipId ? { ...c, duration: calculated } : c);
      onClipsChange(updated);

      checkAndRunAutoScroll(moveEvent.clientX, () => {
        // Keep updated while scrolling
      });
    };

    const handleTrimUp = () => {
      isTrimmingRef.current = false;
      setTrimmingClipId(null);
      setTrimData(null);
      stopAutoScroll();
      window.removeEventListener('pointermove', handleTrimMove);
      window.removeEventListener('pointerup', handleTrimUp);
    };

    window.addEventListener('pointermove', handleTrimMove);
    window.addEventListener('pointerup', handleTrimUp);
  };

  // 4. Drag & Drop Reordering Handlers
  const handleDragStart = (index: number, e: React.DragEvent) => {
    isReorderingRef.current = true;
    setDraggedClipIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  const handleDragOver = (index: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
    checkAndRunAutoScroll(e.clientX, () => {});
  };

  const handleDrop = (targetIndex: number, e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isReorderingRef.current = false;
    stopAutoScroll();

    if (draggedClipIndex === null || draggedClipIndex === targetIndex) {
      setDraggedClipIndex(null);
      setDragOverIndex(null);
      return;
    }

    const reordered = [...clips];
    const [movedItem] = reordered.splice(draggedClipIndex, 1);
    reordered.splice(targetIndex, 0, movedItem);

    // Re-assign order numbers
    const updated = reordered.map((c, i) => ({ ...c, order: i + 1 }));
    onClipsChange(updated);
    onSelectClip(movedItem.id);

    setDraggedClipIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    isReorderingRef.current = false;
    stopAutoScroll();
    setDraggedClipIndex(null);
    setDragOverIndex(null);
  };

  // 5. Quick Transition & Motion Changes
  const handleSelectTransition = (clipIndex: number, transition: TransitionType) => {
    const updated = [...clips];
    if (updated[clipIndex]) {
      updated[clipIndex] = { ...updated[clipIndex], transition };
      onClipsChange(updated);
    }
    setActiveTransitionClipIndex(null);
  };

  const handleSelectMotion = (clipId: string, cameraMotion: CameraMotion) => {
    const updated = clips.map(c => c.id === clipId ? { ...c, cameraMotion } : c);
    onClipsChange(updated);
    setActiveMotionClipId(null);
  };

  // Auto-scroll when playing
  useEffect(() => {
    if (isPlaying && scrollContainerRef.current && !isDragging && !trimmingClipId && !isReorderingRef.current) {
      const container = scrollContainerRef.current;
      const playheadX = currentTime * pixelsPerSecond + 16;
      const viewLeft = container.scrollLeft;
      const viewRight = viewLeft + container.clientWidth;

      if (playheadX > viewRight - 100) {
        container.scrollLeft = playheadX - container.clientWidth + 200;
      } else if (playheadX < viewLeft) {
        container.scrollLeft = Math.max(0, playheadX - 50);
      }
    }
  }, [currentTime, isPlaying, pixelsPerSecond, isDragging, trimmingClipId]);

  // Add new clip
  const handleAddClip = () => {
    const newOrder = clips.length + 1;
    const newClip: StoryboardClip = {
      id: `clip-${Date.now()}`,
      order: newOrder,
      duration: 3.5,
      narration: `镜头 ${newOrder}：解说旁白文案`,
      secondaryText: `Shot ${newOrder}`,
      visualPrompt: `Cinematic visual scene ${newOrder}`,
      cameraMotion: 'zoom-in',
      transition: 'crossfade',
      imageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&auto=format&fit=crop&q=80'
    };
    onClipsChange([...clips, newClip]);
    onSelectClip(newClip.id);
  };

  // Render SVG time ruler ticks
  const renderRulerTicks = () => {
    const tickElements: React.ReactNode[] = [];
    const totalTenths = Math.ceil(totalDuration * 10) + 20;

    for (let i = 0; i <= totalTenths; i++) {
      const timeInSec = i / 10;
      const x = timeInSec * pixelsPerSecond;
      const isOneSecond = i % 10 === 0;
      const isHalfSecond = i % 5 === 0 && !isOneSecond;
      const isTenthSecond = !isOneSecond && !isHalfSecond;

      if (isOneSecond) {
        tickElements.push(
          <g key={`sec-${i}`} className="text-zinc-400">
            <line 
              x1={x} 
              y1={12} 
              x2={x} 
              y2={24} 
              stroke="#6b7280" 
              strokeWidth={1.5} 
            />
            <text 
              x={x + 3} 
              y={10} 
              fill="#9ca3af" 
              fontSize={10} 
              fontFamily="monospace"
              fontWeight="600"
            >
              {formatTimecode(timeInSec)}
            </text>
          </g>
        );
      } else if (isHalfSecond) {
        tickElements.push(
          <line 
            key={`half-${i}`}
            x1={x} 
            y1={16} 
            x2={x} 
            y2={24} 
            stroke="#4b5563" 
            strokeWidth={1.2} 
          />
        );
      } else if (isTenthSecond && pixelsPerSecond >= 70) {
        tickElements.push(
          <line 
            key={`tenth-${i}`}
            x1={x} 
            y1={20} 
            x2={x} 
            y2={24} 
            stroke="#374151" 
            strokeWidth={1} 
          />
        );
      }
    }

    return tickElements;
  };

  const playheadX = currentTime * pixelsPerSecond + 16;
  const hoverClipInfo = hoverTime !== null ? getClipAtTime(hoverTime) : null;

  return (
    <div
      id="bottom-timeline-bar"
      className={`bg-[#131318] border border-[#23232c] rounded-2xl flex flex-col justify-between p-2.5 select-none z-20 shadow-xl shadow-black/40 flex-shrink-0 relative transition-all ${
        isTrackExpanded ? 'h-52' : 'h-38'
      }`}
    >
      {/* Top Playback Control Row */}
      <div className="flex items-center justify-between px-2 pb-1 text-xs flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-semibold text-zinc-300 flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-amber-400" />
            分镜多轨时间轴 ({clips.length} 镜 / {totalDuration.toFixed(1)}s)
          </span>

          {/* Multi-Track Expansion Toggle */}
          <button
            onClick={() => setIsTrackExpanded(prev => !prev)}
            className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-lg border transition-colors cursor-pointer ${
              isTrackExpanded 
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                : 'bg-[#1a1a22] text-zinc-400 border-[#272733] hover:text-zinc-200'
            }`}
            title="切换多轨道分层视图（画面轨/字幕轨/音频波形轨）"
          >
            <Layers className="w-3 h-3" />
            <span>{isTrackExpanded ? '多轨分层' : '紧凑单轨'}</span>
          </button>

          <button
            onClick={() => setShowShortcutHelp(prev => !prev)}
            className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-amber-400 bg-[#1a1a22] hover:bg-[#22222d] border border-[#272733] px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
            title="查看键盘快捷键 (Space, 左右箭头, J/K/L, Ctrl+D)"
          >
            <HelpCircle className="w-3 h-3" />
            <span>快捷键</span>
          </button>
        </div>

        {/* Center Playback Controls */}
        <div className="flex items-center gap-3">
          <button
            id="btn-timeline-play-toggle"
            onClick={onTogglePlay}
            className="w-7 h-7 rounded-full bg-amber-500/20 hover:bg-amber-500 text-amber-400 hover:text-black flex items-center justify-center transition-all cursor-pointer shadow-md shadow-amber-500/10"
            title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}
          >
            {isPlaying ? (
              <Pause className="w-3.5 h-3.5 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
            )}
          </button>

          {/* Timecode display */}
          <span className="font-mono text-zinc-200 text-xs tracking-wider font-medium">
            {formatHeaderTime(currentTime)} <span className="text-zinc-500">\</span> {formatHeaderTime(totalDuration)}
          </span>
        </div>

        {/* Right Tools: Zoom + Fit to screen + Reset */}
        <div className="flex items-center gap-2">
          {/* Fit to screen */}
          <button
            onClick={handleFitToScreen}
            className="p-1 px-1.5 text-zinc-400 hover:text-amber-400 hover:bg-[#252532] border border-[#272733] rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-[10px]"
            title="一键自适应全片 (Fit To Screen, 自动缩放完全展示)"
          >
            <Maximize2 className="w-3 h-3" />
            <span>自适应</span>
          </button>

          {/* Zoom controls */}
          <div className="flex items-center bg-[#1a1a22] rounded-lg border border-[#272733] p-0.5">
            <button
              onClick={handleZoomOut}
              className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-[#252532] rounded transition-colors cursor-pointer"
              title="缩小时间轴 (Ctrl + 滚轮向下)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleResetZoom}
              className="px-1.5 text-[10px] font-mono text-zinc-400 hover:text-zinc-200"
              title="重置缩放比例"
            >
              {Math.round((pixelsPerSecond / 90) * 100)}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-[#252532] rounded transition-colors cursor-pointer"
              title="放大时间轴 (Ctrl + 滚轮向上)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            onClick={() => onTimeUpdate(0)}
            className="text-zinc-400 hover:text-zinc-200 text-[11px] flex items-center gap-1 px-2 py-1 bg-[#1a1a22] hover:bg-[#252532] border border-[#272733] rounded-lg transition-colors cursor-pointer"
            title="回到开头"
          >
            <RotateCcw className="w-3 h-3" />
            重置
          </button>
        </div>
      </div>

      {/* Main Scrollable Timeline Track Area with Multi-Track visual lanes */}
      <div 
        ref={scrollContainerRef}
        id="timeline-scroll-container"
        className="relative flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar bg-[#0f0f13] border border-[#202028] rounded-xl cursor-crosshair select-none"
        onPointerDown={handlePointerDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <div 
          className="relative h-full flex flex-col justify-between"
          style={{ width: `${timelineContentWidth}px`, minWidth: '100%' }}
        >
          {/* 1. Time Ruler Top Strip */}
          <div className="h-6 w-full bg-[#14141a] border-b border-[#23232c] sticky top-0 z-10">
            <svg 
              className="w-full h-full"
              style={{ paddingLeft: '16px' }}
            >
              {renderRulerTicks()}
            </svg>
          </div>

          {/* 2. TRACK 1: VIDEO / SHOT CLIPS TRACK */}
          <div className="relative flex items-center pt-1.5 pb-1 px-4 flex-shrink-0">
            {clips.map((clip, index) => {
              const startTime = getClipStartTime(index);
              const endTime = startTime + (clip.duration || 3.5);
              const isCurrentActive = currentTime >= startTime && currentTime < endTime;
              const isSelected = selectedClipId === clip.id;
              const isTrimmingThis = trimmingClipId === clip.id;
              const isBeingDragged = draggedClipIndex === index;
              const isDropTarget = dragOverIndex === index;
              
              const clipWidth = Math.max(130, (clip.duration || 3.5) * pixelsPerSecond);

              return (
                <React.Fragment key={clip.id}>
                  {/* Drop Insert Indicator line */}
                  {isDropTarget && draggedClipIndex !== null && draggedClipIndex > index && (
                    <div className="w-1.5 h-13 bg-amber-400 rounded-full mx-1 shadow-[0_0_8px_#f59e0b] animate-pulse z-20" />
                  )}

                  {/* Main Clip Block */}
                  <div
                    id={`timeline-clip-${clip.id}`}
                    draggable
                    onDragStart={(e) => handleDragStart(index, e)}
                    onDragOver={(e) => handleDragOver(index, e)}
                    onDrop={(e) => handleDrop(index, e)}
                    onDragEnd={handleDragEnd}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectClip(clip.id);
                      onTimeUpdate(startTime);
                    }}
                    style={{ width: `${clipWidth}px` }}
                    className={`relative flex-shrink-0 h-13 rounded-xl border transition-all cursor-pointer overflow-hidden flex items-center p-1.5 gap-2 group select-none ${
                      isBeingDragged
                        ? 'opacity-40 scale-95 border-dashed border-amber-400 bg-amber-500/10'
                        : isSelected || isCurrentActive || isTrimmingThis
                        ? 'bg-[#252532] border-amber-500 ring-1 ring-amber-500/50 shadow-md shadow-amber-500/10'
                        : 'bg-[#18181f] border-[#292934] hover:border-[#3d3d4e] hover:bg-[#1e1e26]'
                    }`}
                  >
                    {/* Drag Handle Grip */}
                    <div 
                      className="cursor-grab active:cursor-grabbing text-zinc-600 group-hover:text-zinc-300 transition-colors -ml-0.5"
                      title="按住拖拽自由重排镜头顺序"
                    >
                      <GripVertical className="w-3.5 h-3.5" />
                    </div>

                    {/* Thumbnail Image */}
                    <div className="w-11 h-10 rounded-lg bg-black/40 overflow-hidden flex-shrink-0 border border-white/10 relative">
                      {clip.imageUrl ? (
                        <img
                          src={clip.imageUrl}
                          alt={`Shot ${clip.order}`}
                          className={`w-full h-full object-cover ${
                            clip.imageStatus === 'generating' ? 'opacity-40 blur-[0.5px]' : 'opacity-100'
                          }`}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-500">
                          Shot {clip.order}
                        </div>
                      )}

                      {/* Mini Generating Spinner */}
                      {clip.imageStatus === 'generating' && (
                        <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                        </div>
                      )}

                      {/* Mini Queued Indicator */}
                      {clip.imageStatus === 'queued' && (
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                          <Hourglass className="w-3 h-3 animate-pulse text-zinc-400" />
                        </div>
                      )}

                      {/* Duration Badge */}
                      <div className="absolute bottom-0.5 right-0.5 px-1 py-0.2 bg-black/80 rounded text-[9px] font-mono text-amber-400 font-semibold">
                        {clip.duration}s
                      </div>
                    </div>

                    {/* Text Info & Interactive Camera Motion Badge */}
                    <div className="flex-1 min-w-0 space-y-0.5 pr-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold text-zinc-200 truncate">
                          镜头 {clip.order}
                        </span>

                        {/* Interactive Camera Motion Badge */}
                        <div className="relative">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveMotionClipId(activeMotionClipId === clip.id ? null : clip.id);
                            }}
                            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border flex items-center gap-1 transition-all cursor-pointer ${
                              activeMotionClipId === clip.id
                                ? 'bg-amber-500 text-black border-amber-400 font-semibold'
                                : 'bg-[#21212b] hover:bg-[#2c2c3a] text-zinc-300 border-[#323242]'
                            }`}
                            title="点击就地切换运镜动效"
                          >
                            <span>{CAMERA_MOTIONS.find(m => m.id === clip.cameraMotion)?.icon || '🔍'}</span>
                            <span>{CAMERA_MOTIONS.find(m => m.id === clip.cameraMotion)?.name || clip.cameraMotion}</span>
                          </button>

                          {/* Inline Motion Popover Selector */}
                          {activeMotionClipId === clip.id && (
                            <div 
                              onClick={(e) => e.stopPropagation()}
                              className="absolute top-7 right-0 bg-[#1c1c27] border border-[#37374b] rounded-xl p-1.5 shadow-2xl shadow-black/90 z-50 w-48 space-y-1"
                            >
                              <div className="text-[10px] font-semibold text-zinc-300 px-1.5 py-0.5 border-b border-zinc-800 flex justify-between items-center">
                                <span>选择镜头运镜动效</span>
                                <span className="text-amber-400 text-[9px]">镜头 {clip.order}</span>
                              </div>
                              <div className="space-y-0.5 pt-0.5">
                                {CAMERA_MOTIONS.map(motion => (
                                  <button
                                    key={motion.id}
                                    onClick={() => handleSelectMotion(clip.id, motion.id)}
                                    className={`w-full text-left px-2 py-1 rounded-lg text-[10px] flex items-center justify-between transition-colors ${
                                      clip.cameraMotion === motion.id
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-medium'
                                        : 'text-zinc-300 hover:bg-[#292939]'
                                    }`}
                                  >
                                    <span className="flex items-center gap-1.5">
                                      <span>{motion.icon}</span>
                                      <span>{motion.name}</span>
                                    </span>
                                    <span className="text-[9px] text-zinc-500">{motion.desc.slice(0, 6)}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <p className="text-[10px] text-zinc-400 truncate leading-snug">
                        {clip.narration || clip.visualPrompt || '分镜片段'}
                      </p>
                    </div>

                    {/* Active Progress Bar */}
                    {isCurrentActive && (
                      <div
                        className="absolute bottom-0 left-0 h-1 bg-amber-400 rounded-b transition-all"
                        style={{
                          width: `${Math.min(100, Math.max(0, ((currentTime - startTime) / (clip.duration || 3.5)) * 100))}%`
                        }}
                      />
                    )}

                    {/* RIGHT EDGE TRIM HANDLE (Drag to resize duration) */}
                    <div
                      onPointerDown={(e) => handleTrimStart(e, clip.id, clip.duration || 3.5)}
                      className="absolute right-0 top-0 bottom-0 w-3.5 bg-gradient-to-l from-amber-500/40 via-amber-500/10 to-transparent hover:from-amber-500 hover:via-amber-400/40 cursor-ew-resize opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-10"
                      title="按住向左右拖拽微调分镜时长"
                    >
                      <div className="w-1 h-5 rounded-full bg-amber-300 flex flex-col justify-between py-0.5 shadow-sm">
                        <div className="w-0.5 h-0.5 rounded-full bg-black mx-auto" />
                        <div className="w-0.5 h-0.5 rounded-full bg-black mx-auto" />
                      </div>
                    </div>

                    {/* Live Duration Trim Floating Tooltip */}
                    {isTrimmingThis && trimData && (
                      <div className="absolute top-1 right-2 px-2 py-0.5 bg-amber-500 text-black text-[10px] font-mono font-bold rounded-md shadow-lg shadow-black/60 z-30 animate-pulse">
                        时长: {trimData.newDuration.toFixed(1)}s ({trimData.newDuration >= trimData.originalDuration ? '+' : ''}{(trimData.newDuration - trimData.originalDuration).toFixed(1)}s)
                      </div>
                    )}
                  </div>

                  {/* Drop Insert Indicator line (right) */}
                  {isDropTarget && draggedClipIndex !== null && draggedClipIndex < index && (
                    <div className="w-1.5 h-13 bg-amber-400 rounded-full mx-1 shadow-[0_0_8px_#f59e0b] animate-pulse z-20" />
                  )}

                  {/* INLINE TRANSITION CONNECTOR PILL (Between adjacent clips) */}
                  {index < clips.length - 1 && (
                    <div className="relative flex-shrink-0 px-1 z-10 flex items-center justify-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveTransitionClipIndex(activeTransitionClipIndex === index ? null : index);
                        }}
                        className={`px-1.5 py-1 rounded-md text-[10px] border transition-all flex items-center gap-1 cursor-pointer ${
                          activeTransitionClipIndex === index
                            ? 'bg-amber-500 text-black border-amber-400 ring-2 ring-amber-400/50'
                            : 'bg-[#1a1a24] hover:bg-[#252535] text-zinc-300 border-[#2f2f3d]'
                        }`}
                        title={`转场: ${TRANSITIONS.find(t => t.id === clip.transition)?.name || '叠化'} (点击就地切换)`}
                      >
                        <Zap className="w-2.5 h-2.5 text-amber-400" />
                        <span className="font-medium text-[9px]">
                          {TRANSITIONS.find(t => t.id === clip.transition)?.name || '叠化'}
                        </span>
                      </button>

                      {/* INLINE TRANSITION POPOVER SELECTOR */}
                      {activeTransitionClipIndex === index && (
                        <div 
                          onClick={(e) => e.stopPropagation()}
                          className="absolute bottom-11 left-1/2 -translate-x-1/2 bg-[#1b1b24] border border-[#353545] rounded-xl p-1.5 shadow-2xl shadow-black/80 z-50 w-44 space-y-1"
                        >
                          <div className="text-[10px] font-semibold text-zinc-300 px-1.5 py-0.5 border-b border-zinc-800 flex justify-between items-center">
                            <span>切换转场特效</span>
                            <span className="text-amber-400 text-[9px]">镜头 {clip.order} ➔ {clip.order + 1}</span>
                          </div>
                          <div className="space-y-0.5 pt-0.5">
                            {TRANSITIONS.map(trans => (
                              <button
                                key={trans.id}
                                onClick={() => handleSelectTransition(index, trans.id)}
                                className={`w-full text-left px-2 py-1 rounded-lg text-[10px] flex items-center justify-between transition-colors ${
                                  clip.transition === trans.id
                                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 font-medium'
                                    : 'text-zinc-300 hover:bg-[#282836]'
                                }`}
                              >
                                <span className="flex items-center gap-1.5">
                                  <span>{trans.icon}</span>
                                  <span>{trans.name}</span>
                                </span>
                                <span className="text-[9px] text-zinc-500">{trans.id}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            {/* Add Clip Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleAddClip();
              }}
              className="h-13 w-10 ml-2 rounded-xl bg-[#18181f] hover:bg-[#252532] border border-dashed border-[#343444] hover:border-amber-500/50 flex flex-col items-center justify-center text-zinc-400 hover:text-amber-300 transition-all flex-shrink-0 cursor-pointer"
              title="添加新分镜"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {/* 3. MULTI-TRACK EXTENSIONS: SUBTITLE TRACK & AUDIO WAVEFORM TRACK */}
          {isTrackExpanded && (
            <div className="px-4 pb-1 space-y-1">
              {/* SUBTITLE SUB-TRACK */}
              <div className="flex items-center gap-1 h-5 overflow-hidden">
                <div className="w-5 flex items-center justify-center text-zinc-500 flex-shrink-0" title="字幕轨">
                  <MessageSquare className="w-3 h-3 text-emerald-400" />
                </div>
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  {clips.map((clip, index) => {
                    const startTime = getClipStartTime(index);
                    const endTime = startTime + (clip.duration || 3.5);
                    const isCurrentActive = currentTime >= startTime && currentTime < endTime;
                    const clipWidth = Math.max(130, (clip.duration || 3.5) * pixelsPerSecond);

                    return (
                      <div
                        key={`sub-${clip.id}`}
                        style={{ width: `${clipWidth}px` }}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectClip(clip.id);
                          onTimeUpdate(startTime);
                        }}
                        className={`h-5 rounded-md px-1.5 flex items-center text-[9px] truncate border cursor-pointer transition-all flex-shrink-0 ${
                          isCurrentActive
                            ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300 font-medium ring-1 ring-emerald-500/30'
                            : 'bg-[#15151c] border-[#252530] text-zinc-400 hover:bg-[#1c1c24]'
                        }`}
                        title={clip.narration}
                      >
                        <span className="truncate">💬 {clip.narration || '（无字幕）'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* AUDIO WAVEFORM SUB-TRACK */}
              <div className="flex items-center gap-1 h-5 overflow-hidden">
                <div className="w-5 flex items-center justify-center text-zinc-500 flex-shrink-0" title="AI旁白语音与BGM音频轨">
                  <Volume2 className="w-3 h-3 text-amber-400" />
                </div>
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  {clips.map((clip, index) => {
                    const startTime = getClipStartTime(index);
                    const endTime = startTime + (clip.duration || 3.5);
                    const isCurrentActive = currentTime >= startTime && currentTime < endTime;
                    const clipWidth = Math.max(130, (clip.duration || 3.5) * pixelsPerSecond);
                    // Number of wave bars proportional to width
                    const barCount = Math.max(8, Math.floor(clipWidth / 6));

                    return (
                      <div
                        key={`audio-${clip.id}`}
                        style={{ width: `${clipWidth}px` }}
                        className={`h-5 rounded-md px-1.5 flex items-center justify-between border flex-shrink-0 overflow-hidden ${
                          isCurrentActive
                            ? 'bg-amber-500/15 border-amber-500/50'
                            : 'bg-[#14141a] border-[#22222c]'
                        }`}
                      >
                        {Array.from({ length: barCount }).map((_, barIdx) => {
                          // Procedural audio energy wave variation
                          const pseudoHeight = 3 + Math.abs(Math.sin((barIdx + index * 5) * 0.8)) * 11;
                          const isBarActive = isCurrentActive && (currentTime - startTime) / (clip.duration || 3.5) >= barIdx / barCount;

                          return (
                            <div
                              key={barIdx}
                              className={`w-0.5 rounded-full transition-all ${
                                isBarActive
                                  ? 'bg-amber-400 shadow-[0_0_4px_#f59e0b]'
                                  : isCurrentActive
                                  ? 'bg-amber-500/50'
                                  : 'bg-zinc-600'
                              }`}
                              style={{ height: `${pseudoHeight}px` }}
                            />
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 4. HOVER SCRUBBING INDICATOR & PREVIEW POPUP */}
          {hoverTime !== null && hoverPosition && !isDragging && (
            <>
              {/* Vertical White Guide Line */}
              <div 
                className="absolute top-0 bottom-0 w-[1px] bg-white/60 pointer-events-none z-20 shadow-[0_0_4px_rgba(255,255,255,0.8)]"
                style={{ left: `${hoverPosition.x}px` }}
              />

              {/* Floating Tooltip with Timestamp & Clip Preview */}
              <div
                className="absolute bottom-20 pointer-events-none z-40 -translate-x-1/2 bg-[#1b1b24] border border-[#353545] rounded-xl p-2 shadow-2xl shadow-black/90 w-48 text-left space-y-1.5 animate-in fade-in zoom-in-95 duration-100"
                style={{ 
                  left: `${Math.max(100, Math.min(timelineContentWidth - 100, hoverPosition.x))}px` 
                }}
              >
                <div className="flex items-center justify-between border-b border-zinc-800 pb-1">
                  <span className="text-[10px] font-mono font-bold text-amber-400">
                    {formatTimecode(hoverTime)}
                  </span>
                  {hoverClipInfo && (
                    <span className="text-[9px] font-medium text-zinc-300">
                      镜头 {hoverClipInfo.clip.order}
                    </span>
                  )}
                </div>

                {hoverClipInfo && (
                  <div className="flex gap-2 items-center">
                    {hoverClipInfo.clip.imageUrl && (
                      <img 
                        src={hoverClipInfo.clip.imageUrl} 
                        alt="" 
                        className="w-10 h-10 rounded-md object-cover flex-shrink-0 border border-zinc-700" 
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[9px] text-zinc-300 line-clamp-2 leading-tight">
                        {hoverClipInfo.clip.narration || hoverClipInfo.clip.visualPrompt}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* 5. DRAGGABLE PLAYHEAD NEEDLE & HANDLE */}
          <div
            id="timeline-playhead"
            className="absolute top-0 bottom-0 pointer-events-none z-30"
            style={{ 
              left: `${playheadX}px`, 
              transform: 'translateX(-50%)' 
            }}
          >
            {/* Draggable Diamond & Time */}
            <div className="pointer-events-auto cursor-ew-resize flex flex-col items-center group">
              <div className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold shadow-lg transition-all flex items-center gap-1 ${
                isDragging 
                  ? 'bg-amber-400 text-black ring-2 ring-amber-300 shadow-amber-500/40 scale-105' 
                  : 'bg-amber-500 text-black hover:bg-amber-400'
              }`}>
                <span>{currentTime.toFixed(1)}s</span>
              </div>
              <div 
                className="w-0 h-0 border-x-[5px] border-x-transparent border-t-[6px] border-t-amber-500" 
              />
            </div>

            {/* Glowing Vertical Needle */}
            <div className="w-[2px] h-[calc(100%-18px)] bg-amber-400 mx-auto shadow-[0_0_8px_#f59e0b] relative">
              <div className="absolute inset-0 bg-white/40 animate-pulse" />
            </div>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Helper Drawer / Overlay Modal */}
      {showShortcutHelp && (
        <div 
          onClick={() => setShowShortcutHelp(false)}
          className="absolute inset-0 bg-black/80 backdrop-blur-sm rounded-2xl z-50 flex items-center justify-center p-4"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-[#181822] border border-[#2d2d3d] rounded-xl p-4 max-w-sm w-full space-y-3 shadow-2xl shadow-black"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
              <span className="font-semibold text-zinc-100 text-xs flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                全功能剪辑快捷键指南
              </span>
              <button 
                onClick={() => setShowShortcutHelp(false)}
                className="text-zinc-400 hover:text-zinc-200 text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="flex items-center justify-between p-1.5 bg-[#20202d] rounded-lg">
                <span className="text-zinc-400">播放 / 暂停</span>
                <kbd className="px-1.5 py-0.5 bg-black/60 border border-zinc-700 rounded font-mono text-[10px] text-amber-400">Space</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 bg-[#20202d] rounded-lg">
                <span className="text-zinc-400">逐帧微调 (0.1s)</span>
                <kbd className="px-1.5 py-0.5 bg-black/60 border border-zinc-700 rounded font-mono text-[10px] text-amber-400">← / →</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 bg-[#20202d] rounded-lg">
                <span className="text-zinc-400">跨秒快进/后退</span>
                <kbd className="px-1.5 py-0.5 bg-black/60 border border-zinc-700 rounded font-mono text-[10px] text-amber-400">Shift + ← / →</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 bg-[#20202d] rounded-lg">
                <span className="text-zinc-400">专业三键倒/停/放</span>
                <kbd className="px-1.5 py-0.5 bg-black/60 border border-zinc-700 rounded font-mono text-[10px] text-amber-400">J / K / L</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 bg-[#20202d] rounded-lg">
                <span className="text-zinc-400">复制当前分镜</span>
                <kbd className="px-1.5 py-0.5 bg-black/60 border border-zinc-700 rounded font-mono text-[10px] text-amber-400">Ctrl/Cmd + D</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 bg-[#20202d] rounded-lg">
                <span className="text-zinc-400">删除选中镜头</span>
                <kbd className="px-1.5 py-0.5 bg-black/60 border border-zinc-700 rounded font-mono text-[10px] text-amber-400">Del / Backspace</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 bg-[#20202d] rounded-lg">
                <span className="text-zinc-400">手势缩放时间轴</span>
                <kbd className="px-1.5 py-0.5 bg-black/60 border border-zinc-700 rounded font-mono text-[10px] text-amber-400">Ctrl + 滚轮</kbd>
              </div>
              <div className="flex items-center justify-between p-1.5 bg-[#20202d] rounded-lg">
                <span className="text-zinc-400">拖拽镜头排序</span>
                <kbd className="px-1.5 py-0.5 bg-black/60 border border-zinc-700 rounded font-mono text-[10px] text-amber-400">鼠标左键拖拽</kbd>
              </div>
            </div>

            <button
              onClick={() => setShowShortcutHelp(false)}
              className="w-full py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg text-xs transition-colors cursor-pointer"
            >
              我知道了，开始创作
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
