import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
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
  Check, 
  Sliders,
  Loader2,
  Hourglass
} from 'lucide-react';
import { StoryboardClip, TransitionType } from '../types';
import { clipShotNarration, newClipId } from '../utils/narrationTrack';
import { getPlayhead, subscribePlayhead } from '../utils/playhead';
import { formatSentenceGap, isUtteranceTail } from '../utils/sentenceGap';
import { SentenceGapControl } from './SentenceGapControl';

interface TimelineBarProps {
  clips: StoryboardClip[];
  onClipsChange: (clips: StoryboardClip[]) => void;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  sentenceGap?: number;
  onUtteranceHoldChange?: (clipId: string, holdDuration: number, pinned: boolean) => void;
  onHoldCommit?: () => void;
}

const TRANSITIONS: { id: TransitionType; name: string; icon: string; desc: string }[] = [
  { id: 'crossfade', name: '叠化', icon: '⚡', desc: '自然平滑淡入淡出，电影级质感' },
  { id: 'slide-left', name: '平移', icon: '➡️', desc: '短视频节奏推镜，动感明快' },
  { id: 'fade-black', name: '黑场', icon: '⚫', desc: '淡入黑场，用于叙事段落转折' },
  { id: 'zoom-in', name: '推进', icon: '🔍', desc: '镜头冲入变焦，极具视觉冲击' },
  { id: 'none', name: '直切', icon: '🎬', desc: '无特效硬切，写实直接' },
];

const TRACK_HEADER_W = 44;
const TIMELINE_END_PAD = 80;

export const TimelineBar: React.FC<TimelineBarProps> = ({
  clips,
  onClipsChange,
  currentTime,
  onTimeUpdate,
  isPlaying,
  onTogglePlay,
  selectedClipId,
  onSelectClip,
  sentenceGap = 0.2,
  onUtteranceHoldChange,
  onHoldCommit
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const playheadElRef = useRef<HTMLDivElement>(null);
  const playheadLabelRef = useRef<HTMLSpanElement>(null);
  const headerTimeRef = useRef<HTMLSpanElement>(null);
  const lastHeaderPaintRef = useRef<number>(0);
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
  const [hoverPosition, setHoverPosition] = useState<{ x: number; clientX: number; clientY: number } | null>(null);

  // Active Trimming State
  const [trimmingClipId, setTrimmingClipId] = useState<string | null>(null);
  const [trimData, setTrimData] = useState<{ originalDuration: number; newDuration: number } | null>(null);

  // Drag & Drop Reordering State
  const [draggedClipIndex, setDraggedClipIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Inline Popovers
  const [activeTransitionClipIndex, setActiveTransitionClipIndex] = useState<number | null>(null);
  const [gapEditor, setGapEditor] = useState<{
    clipId: string;
    index: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  // Keyboard shortcut guide modal
  const [showShortcutHelp, setShowShortcutHelp] = useState<boolean>(false);

  const totalDuration = clips.reduce((acc, c) => acc + (c.duration || 3.5), 0) || 10;
  const clipLayouts = useMemo(() => {
    let acc = 0;
    return clips.map((clip, index) => {
      const duration = clip.duration || 3.5;
      const start = acc;
      acc += duration;
      return { clip, index, start, duration, end: acc };
    });
  }, [clips]);
  const timeToX = useCallback((time: number) => TRACK_HEADER_W + time * pixelsPerSecond, [pixelsPerSecond]);
  const timelineContentWidth = Math.max(900, timeToX(totalDuration) + TIMELINE_END_PAD);

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

  useEffect(() => {
    if (!gapEditor) return;
    const close = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-sentence-gap-editor]')) return;
      setGapEditor(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [gapEditor]);

  // Fit to screen (自适应全片)
  const handleFitToScreen = () => {
    if (!scrollContainerRef.current) return;
    const containerWidth = scrollContainerRef.current.clientWidth - TRACK_HEADER_W - TIMELINE_END_PAD;
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
    const relativeX = clientX - rect.left + scrollLeft;
    const rawTime = (relativeX - TRACK_HEADER_W) / pixelsPerSecond;
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
    const x = e.clientX - rect.left + scrollLeft;
    const time = Math.max(0, Math.min(totalDuration, (x - TRACK_HEADER_W) / pixelsPerSecond));
    setHoverTime(time);
    setHoverPosition({ x, clientX: e.clientX, clientY: e.clientY });
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
      const targetClip = clips.find(c => c.id === clipId);
      const speechDuration = targetClip?.speechDuration ?? 0;
      const minDuration = speechDuration > 0 ? Math.max(0.5, Math.round(speechDuration * 10) / 10) : 0.8;
      const maxDuration = speechDuration > 0 ? minDuration + 8 : 15;
      const calculated = Math.max(minDuration, Math.min(maxDuration, Math.round((initialDuration + deltaSec) * 10) / 10));

      setTrimData({ originalDuration: initialDuration, newDuration: calculated });

      onClipsChange(clips.map(c => {
        if (c.id !== clipId) return c;
        const speech = c.speechDuration ?? 0;
        return {
          ...c,
          duration: calculated,
          holdDuration: Math.max(0, Math.round((calculated - speech) * 10) / 10),
          holdPinned: true
        };
      }));

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
      onHoldCommit?.();
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

  useEffect(() => {
    const paint = (time: number) => {
      const x = timeToX(time);
      if (playheadElRef.current) playheadElRef.current.style.left = `${x}px`;
      if (playheadLabelRef.current) playheadLabelRef.current.textContent = `${time.toFixed(1)}s`;
      const now = performance.now();
      if (headerTimeRef.current && now - lastHeaderPaintRef.current >= 120) {
        lastHeaderPaintRef.current = now;
        const m = Math.floor(time / 60);
        const s = Math.floor(time % 60);
        const f = Math.floor((time % 1) * 30);
        headerTimeRef.current.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
      }
      if (
        isPlaying
        && scrollContainerRef.current
        && !isDragging
        && !trimmingClipId
        && !isReorderingRef.current
      ) {
        const container = scrollContainerRef.current;
        const viewLeft = container.scrollLeft;
        const viewRight = viewLeft + container.clientWidth;
        if (x > viewRight - 100) {
          container.scrollLeft = x - container.clientWidth + 200;
        } else if (x < viewLeft) {
          container.scrollLeft = Math.max(0, x - 50);
        }
      }
    };
    paint(getPlayhead());
    return subscribePlayhead(paint);
  }, [timeToX, isPlaying, isDragging, trimmingClipId]);

  // Add new clip
  const handleAddClip = () => {
    const newOrder = clips.length + 1;
    const newClip: StoryboardClip = {
      id: newClipId(clips.length),
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
      const x = timeToX(timeInSec);
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

  const playheadX = timeToX(currentTime);
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
            <span ref={headerTimeRef}>{formatHeaderTime(currentTime)}</span> <span className="text-zinc-500">\</span> {formatHeaderTime(totalDuration)}
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
          className="relative h-full flex flex-col"
          style={{ width: `${timelineContentWidth}px`, minWidth: '100%' }}
        >
          <div
            className="sticky left-0 z-40 pointer-events-none h-0 w-0"
          >
          <div
            className="absolute top-0 left-0 border-r border-[#2a2a36] bg-[#121218]"
            style={{ width: TRACK_HEADER_W, height: isTrackExpanded ? 116 : 76 }}
          >
            <div className="h-6 border-b border-[#23232c]" />
            <div className="h-[52px] flex items-center justify-center" title="画面轨">
              <Film className="w-3.5 h-3.5 text-amber-400" />
            </div>
            {isTrackExpanded && (
              <>
                <div className="h-5 flex items-center justify-center" title="字幕轨">
                  <MessageSquare className="w-3 h-3 text-emerald-400" />
                </div>
                <div className="h-5 flex items-center justify-center" title="声音轨">
                  <Volume2 className="w-3 h-3 text-amber-400" />
                </div>
              </>
            )}
          </div>
          </div>

          <div className="h-6 w-full bg-[#14141a] border-b border-[#23232c] relative">
            <svg width={timelineContentWidth} height={24} className="block">
              {renderRulerTicks()}
            </svg>
          </div>

          <div className="relative h-[52px] flex-shrink-0">
            {clipLayouts.map(({ clip, index, start, duration }) => {
              const isCurrentActive = currentTime >= start && currentTime < start + duration;
              const isSelected = selectedClipId === clip.id;
              const isTrimmingThis = trimmingClipId === clip.id;
              const isBeingDragged = draggedClipIndex === index;
              const isDropTarget = dragOverIndex === index;
              const clipWidth = Math.max(2, duration * pixelsPerSecond);

              return (
                <div
                  key={`${clip.id}-${index}`}
                  id={`timeline-clip-${clip.id}`}
                  draggable
                  onDragStart={(e) => handleDragStart(index, e)}
                  onDragOver={(e) => handleDragOver(index, e)}
                  onDrop={(e) => handleDrop(index, e)}
                  onDragEnd={handleDragEnd}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectClip(clip.id);
                    onTimeUpdate(start);
                  }}
                  style={{ left: timeToX(start), width: clipWidth }}
                  className={`absolute top-1 bottom-1 rounded-md overflow-hidden group select-none cursor-pointer ${
                    isBeingDragged
                      ? 'opacity-40 ring-1 ring-dashed ring-amber-400'
                      : isSelected || isCurrentActive || isTrimmingThis
                      ? 'ring-1 ring-amber-400 z-10'
                      : 'ring-1 ring-black/40 hover:ring-white/20'
                  }`}
                >
                  {clip.imageUrl ? (
                    <img
                      src={clip.imageUrl}
                      alt=""
                      className={`absolute inset-0 w-full h-full object-cover ${clip.imageStatus === 'generating' ? 'opacity-50' : ''}`}
                    />
                  ) : (
                    <div className="absolute inset-0 bg-[#1a1a22]" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-black/25" />

                  {clip.imageStatus === 'generating' && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-300" />
                    </div>
                  )}
                  {clip.imageStatus === 'queued' && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <Hourglass className="w-3 h-3 animate-pulse text-zinc-300" />
                    </div>
                  )}

                  {clipWidth >= 22 && (
                    <span className="absolute top-1 left-1 min-w-4 h-4 px-1 rounded bg-black/65 text-[9px] font-semibold text-white/90 flex items-center justify-center">
                      {clip.order}
                    </span>
                  )}
                  {clipWidth >= 52 && (
                    <span className="absolute top-1 right-1 h-4 px-1 rounded bg-black/65 text-[9px] font-mono text-white/80 flex items-center">
                      {duration.toFixed(1)}
                    </span>
                  )}

                  {(() => {
                    const speech = clip.speechDuration || 0;
                    const hold = Math.max(0, clip.holdDuration || 0);
                    if (hold < 0.04 || speech <= 0 || duration <= 0) return null;
                    const leftPct = Math.min(96, Math.max(8, (speech / duration) * 100));
                    return (
                      <div
                        className="absolute top-0 bottom-0 bg-black/50 border-l border-amber-300/35 pointer-events-none"
                        style={{ left: `${leftPct}%`, right: 0 }}
                        title={`气口 ${hold.toFixed(2)}s`}
                      />
                    );
                  })()}

                  {isDropTarget && draggedClipIndex !== null && draggedClipIndex > index && (
                    <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-amber-400 z-20" />
                  )}
                  {isDropTarget && draggedClipIndex !== null && draggedClipIndex < index && (
                    <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-amber-400 z-20" />
                  )}

                  {isCurrentActive && (
                    <div
                      className="absolute bottom-0 left-0 h-0.5 bg-amber-400"
                      style={{ width: `${Math.min(100, Math.max(0, ((currentTime - start) / duration) * 100))}%` }}
                    />
                  )}

                  <div
                    onPointerDown={(e) => handleTrimStart(e, clip.id, duration)}
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-gradient-to-l from-white/35 to-transparent z-10"
                    title={clip.speechDuration ? '拖拽只增加念完后的画面停留，不能短于旁白时长' : '按住拖拽微调分镜时长'}
                  />

                  {isTrimmingThis && trimData && (
                    <div className="absolute -top-5 right-0 px-1.5 py-0.5 bg-amber-500 text-black text-[9px] font-mono font-bold rounded shadow-lg z-30 whitespace-nowrap">
                      {(() => {
                        const speech = clip.speechDuration || 0;
                        if (speech > 0) {
                          const hold = Math.max(0, trimData.newDuration - speech);
                          return `${speech.toFixed(1)}s + ${hold.toFixed(1)}s`;
                        }
                        return `${trimData.newDuration.toFixed(1)}s`;
                      })()}
                    </div>
                  )}
                </div>
              );
            })}

            {clipLayouts.slice(0, -1).map(({ clip, index, end }) => {
              const trans = TRANSITIONS.find((item) => item.id === clip.transition) || TRANSITIONS[0];
              const isNone = clip.transition === 'none';
              const isOpen = activeTransitionClipIndex === index;
              return (
                <div
                  key={`cut-${clip.id}-${index}`}
                  className="absolute top-1 bottom-1 z-20 group/cut"
                  style={{ left: timeToX(end) - 9, width: 18 }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-black/50" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setGapEditor(null);
                      setActiveTransitionClipIndex(isOpen ? null : index);
                    }}
                    title={trans.name}
                    className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rotate-45 rounded-[2px] flex items-center justify-center cursor-pointer shadow-md transition-opacity ${
                      isOpen
                        ? 'bg-amber-400 opacity-100'
                        : isNone
                          ? 'bg-[#2a2a36] border border-zinc-600 opacity-0 group-hover/cut:opacity-100'
                          : 'bg-[#1c1c24] border border-amber-400/70 opacity-100'
                    }`}
                  >
                    <Zap className={`w-2 h-2 -rotate-45 ${isOpen ? 'text-black' : 'text-amber-300'}`} />
                  </button>
                  {isOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-[#1b1b24] border border-[#353545] rounded-xl p-1.5 shadow-2xl z-50 w-36 space-y-0.5"
                    >
                      {TRANSITIONS.map((item) => (
                        <button
                          key={item.id}
                          onClick={() => handleSelectTransition(index, item.id)}
                          className={`w-full text-left px-2 py-1 rounded-lg text-[10px] ${
                            clip.transition === item.id
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'text-zinc-300 hover:bg-[#282836]'
                          }`}
                        >
                          {item.icon} {item.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                handleAddClip();
              }}
              style={{ left: timeToX(totalDuration) + 8 }}
              className="absolute top-1 bottom-1 w-9 rounded-lg bg-[#18181f] hover:bg-[#252532] border border-dashed border-[#343444] hover:border-amber-500/50 flex items-center justify-center text-zinc-400 hover:text-amber-300 cursor-pointer"
              title="添加新分镜"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

          {isTrackExpanded && (
            <>
              <div className="relative h-5 flex-shrink-0">
                {clipLayouts.map(({ clip, index, start, duration }) => {
                  const isCurrentActive = currentTime >= start && currentTime < start + duration;
                  return (
                    <div
                      key={`sub-${clip.id}-${index}`}
                      style={{ left: timeToX(start), width: Math.max(2, duration * pixelsPerSecond) }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectClip(clip.id);
                        onTimeUpdate(start);
                      }}
                      title={clipShotNarration(clip)}
                      className={`absolute top-0.5 bottom-0 rounded px-1 flex items-center text-[9px] truncate border cursor-pointer ${
                        isCurrentActive
                          ? 'bg-emerald-500/20 border-emerald-500/60 text-emerald-300'
                          : 'bg-[#15151c] border-[#252530] text-zinc-400 hover:bg-[#1c1c24]'
                      }`}
                    >
                      <span className="truncate">{clipShotNarration(clip) || '（无字幕）'}</span>
                    </div>
                  );
                })}
              </div>
              <div className="relative h-5 flex-shrink-0">
                {clipLayouts.map(({ clip, index, start, duration, end }) => {
                  const isCurrentActive = currentTime >= start && currentTime < start + duration;
                  const clipWidth = Math.max(2, duration * pixelsPerSecond);
                  const speech = clip.speechDuration || 0;
                  const hold = Math.max(0, clip.holdDuration || 0);
                  const speechRatio = speech > 0 && duration > 0 ? Math.min(1, speech / duration) : 1;
                  const speechWidth = Math.max(2, speechRatio * clipWidth);
                  const barCount = Math.max(3, Math.floor(speechWidth / 5));
                  const tail = isUtteranceTail(clips, index);
                  const gapOpen = gapEditor?.clipId === clip.id;
                  return (
                    <React.Fragment key={`audio-${clip.id}-${index}`}>
                      <div
                        style={{ left: timeToX(start), width: clipWidth }}
                        className="absolute top-0.5 bottom-0 flex overflow-hidden rounded"
                      >
                        <div
                          className={`h-full flex items-center justify-between px-0.5 border ${
                            isCurrentActive ? 'bg-amber-500/15 border-amber-500/50' : 'bg-[#14141a] border-[#22222c]'
                          }`}
                          style={{ width: `${speechWidth}px` }}
                        >
                          {Array.from({ length: barCount }).map((_, barIdx) => {
                            const pseudoHeight = 3 + Math.abs(Math.sin((barIdx + index * 5) * 0.8)) * 10;
                            const isBarActive = isCurrentActive && speech > 0 && (currentTime - start) / Math.max(0.01, speech) >= barIdx / barCount;
                            return (
                              <div
                                key={barIdx}
                                className={`w-0.5 rounded-full ${
                                  isBarActive ? 'bg-amber-400' : isCurrentActive ? 'bg-amber-500/50' : 'bg-zinc-600'
                                }`}
                                style={{ height: `${pseudoHeight}px` }}
                              />
                            );
                          })}
                        </div>
                        {tail && hold > 0.03 && (
                          <div className="h-full flex-1 bg-[#1a1712] border-y border-r border-[#3a3224]" />
                        )}
                      </div>
                      {tail && (
                        <button
                          type="button"
                          data-sentence-gap-editor
                          title={hold > 0.001 ? `句末气口 ${formatSentenceGap(hold)}s，点这里改` : '加上句间气口'}
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveTransitionClipIndex(null);
                            setGapEditor((current) => (
                              current?.clipId === clip.id
                                ? null
                                : { clipId: clip.id, index, clientX: e.clientX, clientY: e.clientY }
                            ));
                          }}
                          style={{ left: timeToX(end) - 15, width: 30 }}
                          className={`absolute -top-0.5 z-30 h-[22px] rounded-full flex items-center justify-center cursor-pointer shadow-lg transition-all ${
                            gapOpen
                              ? 'bg-amber-400 text-black scale-105'
                              : hold > 0.04
                                ? 'bg-[#241e16] text-amber-300 border border-amber-400/50 hover:bg-amber-400 hover:text-black'
                                : 'bg-[#1b1b22] text-zinc-500 border border-[#343444] hover:border-amber-400/50 hover:text-amber-300'
                          }`}
                        >
                          <span className="font-mono text-[8px] font-semibold leading-none">
                            {hold > 0.001 ? formatSentenceGap(hold) : '+'}
                          </span>
                        </button>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </>
          )}

          {hoverTime !== null && hoverPosition && !isDragging && (
            <div
              className="absolute top-0 bottom-0 w-px bg-white/50 pointer-events-none z-30"
              style={{ left: timeToX(hoverTime) }}
            />
          )}

          <div
            id="timeline-playhead"
            ref={playheadElRef}
            className="absolute top-0 bottom-0 pointer-events-none z-30"
            style={{ left: playheadX, transform: 'translateX(-50%)' }}
          >
            {/* Draggable Diamond & Time */}
            <div className="pointer-events-auto cursor-ew-resize flex flex-col items-center group">
              <div className={`px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold shadow-lg transition-all flex items-center gap-1 ${
                isDragging 
                  ? 'bg-amber-400 text-black ring-2 ring-amber-300 shadow-amber-500/40 scale-105' 
                  : 'bg-amber-500 text-black hover:bg-amber-400'
              }`}>
                <span ref={playheadLabelRef}>{currentTime.toFixed(1)}s</span>
              </div>
              <div 
                className="w-0 h-0 border-x-[5px] border-x-transparent border-t-[6px] border-t-amber-500" 
              />
            </div>

            <div className="absolute top-[18px] bottom-0 left-1/2 -translate-x-1/2 w-[2px] bg-amber-400 shadow-[0_0_8px_#f59e0b]">
              <div className="absolute inset-0 bg-white/40 animate-pulse" />
            </div>
          </div>
        </div>
      </div>

      {gapEditor && createPortal(
        <div
          className="fixed z-[80]"
          style={{
            left: `${Math.max(16, Math.min((typeof window !== 'undefined' ? window.innerWidth : 800) - 240, gapEditor.clientX - 110))}px`,
            top: `${Math.max(12, gapEditor.clientY - 214)}px`
          }}
          data-sentence-gap-editor
          onPointerDown={(e) => e.stopPropagation()}
        >
          <SentenceGapControl
            variant="popover"
            value={clips[gapEditor.index]?.holdDuration ?? sentenceGap}
            globalValue={sentenceGap}
            pinned={Boolean(clips[gapEditor.index]?.holdPinned)}
            onChange={(seconds) => {
              const clip = clips[gapEditor.index];
              if (!clip) return;
              onUtteranceHoldChange?.(clip.id, seconds, true);
            }}
            onFollowGlobal={() => {
              const clip = clips[gapEditor.index];
              if (!clip) return;
              onUtteranceHoldChange?.(clip.id, sentenceGap, false);
            }}
          />
        </div>,
        document.body
      )}

      {hoverTime !== null && hoverPosition && !isDragging && createPortal(
        <div
          id="timeline-hover-preview"
          className="fixed z-[70] pointer-events-none w-48 -translate-x-1/2 -translate-y-full rounded-xl border border-white/12 bg-zinc-950/80 p-2 text-left shadow-[0_12px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl space-y-1.5"
          style={{
            left: `${Math.max(104, Math.min((typeof window !== 'undefined' ? window.innerWidth : 800) - 104, hoverPosition.clientX))}px`,
            top: `${Math.max(12, (scrollContainerRef.current?.getBoundingClientRect().top ?? hoverPosition.clientY) - 10)}px`
          }}
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-1">
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
                  {clipShotNarration(hoverClipInfo.clip) || hoverClipInfo.clip.visualPrompt}
                </p>
              </div>
            </div>
          )}
        </div>,
        document.body
      )}

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
