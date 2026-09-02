import React from 'react';
import {
  ChevronUp,
  ChevronDown,
  Image as ImageIcon,
  Sparkles,
  Trash2,
  Hourglass,
  Loader2
} from 'lucide-react';
import { CameraMotion, StoryboardClip, TransitionType } from '../types';
import { clipSharesUtterance, clipShotNarration } from '../utils/narrationTrack';
import { SentenceGapControl } from './SentenceGapControl';

const CAMERA_LABEL: Record<CameraMotion, string> = {
  'zoom-in': '拉近',
  'zoom-out': '拉远',
  'pan-left': '左移',
  'pan-right': '右移',
  'tilt-up': '上摇',
  'tilt-down': '下摇',
  'cinematic-orbit': '环绕',
  static: '静止'
};

const TRANSITION_LABEL: Record<TransitionType, string> = {
  crossfade: '叠化',
  'fade-black': '黑场',
  'slide-left': '左推',
  'zoom-in': '缩放',
  none: '硬切'
};

interface StoryboardClipCardProps {
  clip: StoryboardClip;
  index: number;
  total: number;
  selected: boolean;
  generating: boolean;
  queued: boolean;
  failed: boolean;
  success: boolean;
  polishing: boolean;
  fileInputRef: (el: HTMLInputElement | null) => void;
  onSelect: () => void;
  onUpdate: (updates: Partial<StoryboardClip>) => void;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onPolish: (e: React.MouseEvent) => void;
  onMove: (direction: 'up' | 'down', e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  isUtteranceTail?: boolean;
  sentenceGap?: number;
  onUtteranceHoldChange?: (holdDuration: number, pinned: boolean) => void;
  imagePromptPreview?: string;
}

export const StoryboardClipCard: React.FC<StoryboardClipCardProps> = ({
  clip,
  index,
  total,
  selected,
  generating,
  queued,
  failed,
  polishing,
  fileInputRef,
  onSelect,
  onUpdate,
  onGenerate,
  onUpload,
  onPolish,
  onMove,
  onDelete,
  isUtteranceTail = false,
  sentenceGap = 0.2,
  onUtteranceHoldChange,
  imagePromptPreview
}) => {
  const voText = clipShotNarration(clip);
  const linkedShot = clipSharesUtterance(clip);
  const statusDot = generating
    ? 'bg-amber-400'
    : queued
      ? 'bg-zinc-500'
      : failed
        ? 'bg-rose-400'
        : clip.imageUrl
          ? 'bg-emerald-400'
          : 'bg-zinc-600';

  return (
    <div
      id={`clip-card-${clip.id}`}
      onClick={onSelect}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files[0]) onUpload(e.dataTransfer.files[0]);
      }}
      className={`rounded-xl border transition-all cursor-pointer relative ${
        selected
          ? 'bg-[#22222b] border-amber-500/60 ring-1 ring-amber-500/30 p-3 space-y-2.5'
          : 'bg-[#1b1b22] border-[#292934] hover:border-[#3a3a48] px-3 py-2'
      }`}
    >
      <input
        id={`clip-file-${clip.id}`}
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files && e.target.files[0]) onUpload(e.target.files[0]);
        }}
      />

      {!selected ? (
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-16 h-9 rounded-md overflow-hidden bg-[#121218] border border-[#2e2e3c] flex-shrink-0">
            {clip.imageUrl ? (
              <img src={clip.imageUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-600">
                <ImageIcon className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[11px] text-amber-400 font-semibold">{String(clip.order).padStart(2, '0')}</span>
              <span className="text-[10px] text-zinc-500">{(clip.duration || 0).toFixed(1)}s</span>
              {clip.shotSize && (
                <span className="text-[9px] text-zinc-500">{clip.shotSize === 'ecu' ? '大特写' : clip.shotSize === 'cu' ? '特写' : clip.shotSize === 'ms' ? '中景' : clip.shotSize === 'ws' ? '全景' : '插入'}</span>
              )}
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} />
              {generating && <span className="text-[10px] text-amber-300">绘制中</span>}
              {failed && <span className="text-[10px] text-rose-300">失败</span>}
              {clip.referenceStatus === 'accepted' && <span className="text-[9px] text-emerald-300/80">参考图已送达</span>}
              {clip.referenceStatus === 'dropped' && <span className="text-[9px] text-rose-300">参考图未采用</span>}
              {clip.characterIds && clip.characterIds.length > 0 && (
                <span className="text-[9px] text-amber-400/80 border border-amber-500/20 rounded px-1">角色锁</span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400 truncate">{voText || '暂无旁白'}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <span className="font-mono text-[11px] text-amber-400 font-semibold">{String(clip.order).padStart(2, '0')}</span>
              <span className="text-[11px] text-zinc-500">{(clip.duration || 0).toFixed(1)}s</span>
              {generating && (
                <span className="text-[10px] text-amber-300 flex items-center gap-1">
                  <Loader2 className="w-2.5 h-2.5 animate-spin" />绘制中
                </span>
              )}
              {queued && <span className="text-[10px] text-zinc-500">排队</span>}
              {failed && <span className="text-[10px] text-rose-300">失败</span>}
              {clip.referenceStatus === 'accepted' && <span className="text-[9px] text-emerald-300/80">参考图已送达</span>}
              {clip.referenceStatus === 'dropped' && <span className="text-[9px] text-rose-300">参考图未采用</span>}
            </div>
            <div className="flex items-center gap-0.5">
              <button type="button" title="润色旁白" onClick={onPolish} disabled={polishing || !clip.narration || clip.voRole === 'continue'} className="p-1 hover:text-amber-400 disabled:opacity-20 text-zinc-500 cursor-pointer">
                <Sparkles className={`w-3.5 h-3.5 ${polishing ? 'animate-spin' : ''}`} />
              </button>
              <button type="button" onClick={(e) => onMove('up', e)} disabled={index === 0} className="p-1 hover:text-amber-400 disabled:opacity-20 text-zinc-400 cursor-pointer">
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={(e) => onMove('down', e)} disabled={index === total - 1} className="p-1 hover:text-amber-400 disabled:opacity-20 text-zinc-400 cursor-pointer">
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button type="button" onClick={onDelete} className="p-1 hover:text-rose-400 text-zinc-500 cursor-pointer">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-[minmax(132px,42%)_minmax(0,1fr)] gap-2.5 items-start">
            <div className="relative rounded-lg overflow-hidden border border-[#2e2e3c] bg-[#121218] group aspect-video flex items-center justify-center">
              {clip.imageUrl ? (
                <img
                  src={clip.imageUrl}
                  alt={`镜头 ${clip.order}`}
                  className={`w-full h-full object-cover ${generating ? 'opacity-40 blur-[1px]' : 'opacity-100'}`}
                />
              ) : (
                <div className="text-zinc-500 text-[11px] flex items-center gap-1.5">
                  <ImageIcon className="w-4 h-4" />
                  暂无画面
                </div>
              )}
              {generating && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                </div>
              )}
              {queued && !generating && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Hourglass className="w-5 h-5 text-zinc-400 animate-pulse" />
                </div>
              )}
              {failed && !generating && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onGenerate();
                  }}
                  className="absolute bottom-1 left-1 right-1 px-1.5 py-1 bg-rose-950/90 border border-rose-500/40 rounded text-rose-300 text-[10px] cursor-pointer"
                >
                  失败，点击重试
                </button>
              )}
              {!generating && (
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1.5 p-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onGenerate();
                    }}
                    className="px-2 py-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg text-[10px] cursor-pointer"
                  >
                    重新生图
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      const input = document.getElementById(`clip-file-${clip.id}`) as HTMLInputElement | null;
                      input?.click();
                    }}
                    className="px-2 py-1 bg-zinc-800 text-zinc-100 border border-zinc-600 rounded-lg text-[10px] cursor-pointer"
                  >
                    上传本地图
                  </button>
                </div>
              )}
            </div>

            <div className="min-w-0 space-y-1.5">
              <textarea
                value={voText}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  if (clip.voRole === 'continue') return;
                  const value = e.target.value;
                  if (linkedShot) {
                    onUpdate({ voSlice: value });
                    return;
                  }
                  onUpdate({ narration: value, voSlice: value });
                }}
                readOnly={clip.voRole === 'continue'}
                rows={2}
                placeholder={clip.voRole === 'continue' ? '承接上一句，只换画面' : '旁白…'}
                className="w-full bg-[#16161c] border border-[#2b2b36] rounded-lg p-2 text-zinc-200 text-xs focus:outline-none focus:border-amber-500/50 resize-none leading-relaxed custom-scrollbar"
              />
              {linkedShot && (
                <p className="text-[10px] text-zinc-500">
                  {clip.voRole === 'continue' ? '同一句旁白的下一张图，不在这里切开念。' : '本镜只配这半句。整句口播和后图共用，不在这里切开念。'}
                </p>
              )}
              {isUtteranceTail && onUtteranceHoldChange && (
                <SentenceGapControl
                  variant="card"
                  value={clip.holdDuration ?? sentenceGap}
                  globalValue={sentenceGap}
                  pinned={Boolean(clip.holdPinned)}
                  onChange={(seconds) => onUtteranceHoldChange(seconds, true)}
                  onFollowGlobal={() => onUtteranceHoldChange(sentenceGap, false)}
                />
              )}
              <textarea
                value={clip.chineseVisualPrompt || ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onUpdate({
                  chineseVisualPrompt: e.target.value,
                  visualBeat: undefined,
                  promptPinned: false
                })}
                placeholder="这一镜看见什么（不要写口播原句）…"
                className="prompt-resize custom-scrollbar w-full bg-[#16161c] border border-[#2b2b36] rounded-lg p-2 text-zinc-300 text-[11px] focus:outline-none focus:border-amber-500/50 leading-relaxed"
              />
              {imagePromptPreview && (
                <details
                  className="rounded-lg border border-[#2b2b36] bg-[#14141a] px-2 py-1.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <summary className="text-[10px] text-zinc-500 cursor-pointer select-none">
                    {clip.promptPinned ? '已钉住英文，按此发送' : '将发送给生图模型'}
                  </summary>
                  <textarea
                    value={clip.promptPinned ? clip.visualPrompt : imagePromptPreview}
                    onChange={(e) => onUpdate({ visualPrompt: e.target.value, promptPinned: true })}
                    rows={6}
                    className="mt-1.5 w-full bg-[#101014] border border-[#2b2b36] rounded-md p-2 text-[10px] text-zinc-400 font-mono leading-relaxed resize-y custom-scrollbar"
                  />
                  {clip.promptPinned && (
                    <button
                      type="button"
                      className="mt-1 text-[10px] text-amber-300 cursor-pointer"
                      onClick={() => onUpdate({ promptPinned: false })}
                    >
                      取消钉住，改回自动编译
                    </button>
                  )}
                </details>
              )}
              <div className="flex gap-2">
                <select
                  value={clip.cameraMotion}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onUpdate({ cameraMotion: e.target.value as CameraMotion })}
                  className="flex-1 min-w-0 bg-[#16161c] border border-[#2b2b36] rounded-md px-1.5 py-1 text-zinc-400 text-[10px] cursor-pointer"
                  title="运镜"
                >
                  {(Object.keys(CAMERA_LABEL) as CameraMotion[]).map((id) => (
                    <option key={id} value={id}>{CAMERA_LABEL[id]}</option>
                  ))}
                </select>
                <select
                  value={clip.transition}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onUpdate({ transition: e.target.value as TransitionType })}
                  className="flex-1 min-w-0 bg-[#16161c] border border-[#2b2b36] rounded-md px-1.5 py-1 text-zinc-400 text-[10px] cursor-pointer"
                  title="转场"
                >
                  {(Object.keys(TRANSITION_LABEL) as TransitionType[]).map((id) => (
                    <option key={id} value={id}>{TRANSITION_LABEL[id]}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
