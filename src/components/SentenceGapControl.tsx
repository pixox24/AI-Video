import React, { useEffect, useState } from 'react';
import { RotateCcw, Wind } from 'lucide-react';
import {
  clampSentenceGap,
  extraGapSeconds,
  formatSentenceGap,
  matchingGapPreset,
  SENTENCE_GAP_MAX,
  SENTENCE_GAP_MIN,
  SENTENCE_GAP_PRESETS,
  SENTENCE_GAP_STEP
} from '../utils/sentenceGap';
import { StoryboardClip } from '../types';

type GapVariant = 'panel' | 'popover' | 'card';

interface SentenceGapControlProps {
  value: number;
  onChange: (seconds: number) => void;
  variant?: GapVariant;
  pinned?: boolean;
  globalValue?: number;
  onFollowGlobal?: () => void;
  clips?: Pick<StoryboardClip, 'holdDuration' | 'voRole' | 'holdPinned'>[];
  seamCount?: number;
}

export const SentenceGapControl: React.FC<SentenceGapControlProps> = ({
  value,
  onChange,
  variant = 'panel',
  pinned = false,
  globalValue,
  onFollowGlobal,
  clips,
  seamCount
}) => {
  const seconds = clampSentenceGap(value);
  const presetId = matchingGapPreset(seconds);
  const [draft, setDraft] = useState(formatSentenceGap(seconds));
  const extra = clips ? extraGapSeconds(clips, seconds) : (seamCount || 0) * seconds;
  const seams = seamCount ?? clips?.filter((clip, index, list) => {
    const next = list[index + 1];
    return !next || next.voRole !== 'continue';
  }).length ?? 0;

  useEffect(() => {
    setDraft(formatSentenceGap(seconds));
  }, [seconds]);

  const commitDraft = () => {
    const parsed = Number(String(draft).replace(/s$/i, '').trim());
    if (!Number.isFinite(parsed)) {
      setDraft(formatSentenceGap(seconds));
      return;
    }
    onChange(clampSentenceGap(parsed));
  };

  const gapWidth = 10 + seconds * 42;
  const isPanel = variant === 'panel';
  const isCard = variant === 'card';

  return (
    <div
      className={
        isPanel
          ? 'relative overflow-hidden rounded-2xl border border-[#2f2a22] bg-gradient-to-br from-[#1d1a16] via-[#16151c] to-[#121218] p-3 space-y-3'
          : isCard
            ? 'rounded-xl border border-[#2b2b36] bg-[#16161c] p-2 space-y-2'
            : 'w-[220px] rounded-2xl border border-[#353028] bg-[#16141c]/95 p-2.5 shadow-[0_16px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl space-y-2.5'
      }
    >
      {isPanel && (
        <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-amber-400/10 blur-2xl" />
      )}

      <div className="flex items-start justify-between gap-2 relative">
        <div className="min-w-0">
          <div className={`flex items-center gap-1.5 ${isPanel ? 'text-zinc-100' : 'text-zinc-200'}`}>
            <Wind className={`${isPanel ? 'w-3.5 h-3.5' : 'w-3 h-3'} text-amber-400`} />
            <span className={`${isPanel ? 'text-xs font-semibold' : 'text-[11px] font-semibold'}`}>
              {pinned ? '这句气口' : '句间气口'}
            </span>
          </div>
          {isPanel && (
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              念完一句，画面和声音一起歇一口气再接下句。一句两图中间不断开。
            </p>
          )}
        </div>
        <label className="flex items-center gap-1 rounded-lg border border-[#3a3428] bg-black/30 px-1.5 py-0.5">
          <input
            type="number"
            min={SENTENCE_GAP_MIN}
            max={SENTENCE_GAP_MAX}
            step={SENTENCE_GAP_STEP}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              }
            }}
            className="w-10 bg-transparent text-right font-mono text-[11px] text-amber-200 outline-none"
          />
          <span className="text-[10px] text-zinc-500">s</span>
        </label>
      </div>

      <div className="flex items-center gap-1.5 h-7 relative">
        <div className="h-4 flex-1 rounded-md bg-gradient-to-r from-amber-500/80 to-amber-400/55 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.15)]" />
        <div
          className="relative h-7 flex items-center justify-center"
          style={{ width: `${gapWidth}px` }}
        >
          <div className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-amber-200/25" />
          <div className="flex items-center gap-[3px]">
            <span className="w-[2px] h-2.5 rounded-full bg-amber-200/80" />
            <span className="w-[2px] h-2.5 rounded-full bg-amber-200/80" />
          </div>
        </div>
        <div className="h-4 flex-1 rounded-md bg-gradient-to-l from-amber-500/45 to-amber-400/25" />
      </div>

      <div className="grid grid-cols-4 gap-1">
        {SENTENCE_GAP_PRESETS.map((preset) => {
          const active = presetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              title={preset.hint}
              onClick={() => onChange(preset.seconds)}
              className={`rounded-lg px-1 py-1.5 text-center cursor-pointer transition-all ${
                active
                  ? 'bg-amber-400 text-black shadow-[0_0_0_1px_rgba(251,191,36,0.45)]'
                  : 'bg-[#221f28] text-zinc-400 hover:text-amber-200 hover:bg-[#2a2630] border border-[#32303a]'
              }`}
            >
              <div className={`text-[10px] font-semibold ${active ? 'text-black' : ''}`}>{preset.label}</div>
              <div className={`font-mono text-[9px] ${active ? 'text-black/70' : 'text-zinc-500'}`}>
                {preset.seconds === 0 ? '0' : `${preset.seconds}s`}
              </div>
            </button>
          );
        })}
      </div>

      <input
        type="range"
        min={SENTENCE_GAP_MIN}
        max={SENTENCE_GAP_MAX}
        step={SENTENCE_GAP_STEP}
        value={seconds}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-[#2a261c] rounded-lg appearance-none accent-amber-400 cursor-pointer"
      />

      <div className="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
        <span>
          {pinned
            ? '只改这一句，全局换气不动'
            : seams > 0
              ? `${seams} 处句缝 · 约 +${extra.toFixed(1)}s`
              : '写入分镜后会加进成片时长'}
        </span>
        {pinned && onFollowGlobal && (
          <button
            type="button"
            onClick={onFollowGlobal}
            className="flex items-center gap-1 text-amber-300/90 hover:text-amber-200 cursor-pointer"
          >
            <RotateCcw className="w-2.5 h-2.5" />
            跟随全局 {globalValue != null ? `${formatSentenceGap(globalValue)}s` : ''}
          </button>
        )}
      </div>
    </div>
  );
};
