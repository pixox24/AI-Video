import React from 'react';
import { RotateCcw, Film } from 'lucide-react';
import { OutroConfig } from '../types';
import { OUTRO_DEFAULT, OUTRO_HOLD_MAX, OUTRO_FADE_MAX } from '../utils/outro';

interface OutroControlProps {
  value: OutroConfig;
  onChange: (config: OutroConfig) => void;
}

function fmt(seconds: number): string {
  const v = Math.round(seconds * 10) / 10;
  return Number.isInteger(v) ? `${v}s` : `${v.toFixed(1)}s`;
}

/**
 * 片尾收束：旁白结束后的画面延续 / 画面渐隐 / 音乐淡出。
 * 音乐淡出窗口会自动钳制到片尾总长，用户不需要自己算账。
 */
export const OutroControl: React.FC<OutroControlProps> = ({ value, onChange }) => {
  const total = Math.round((value.hold + value.pictureFade) * 10) / 10;
  const musicEffective = Math.min(value.musicFade, total);

  const slider = (label: string, hint: string, key: keyof OutroConfig, max: number) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-zinc-400">
        <span className="text-[11px]">{label}</span>
        <span className="font-mono text-[11px] text-zinc-200">{fmt(value[key])}</span>
      </div>
      <input
        type="range"
        min="0"
        max={max}
        step="0.1"
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
        className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
      />
      <div className="text-[10px] text-zinc-600">{hint}</div>
    </div>
  );

  return (
    <div className="p-3 bg-[#1e1e26] border border-[#2b2b38] rounded-xl space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
          <Film className="w-3.5 h-3.5 text-amber-400" />
          片尾收束
        </div>
        <button
          type="button"
          onClick={() => onChange({ ...OUTRO_DEFAULT })}
          title="恢复默认"
          className="text-zinc-500 hover:text-amber-300 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>

      {slider('画面延续', '旁白说完后画面继续走', 'hold', OUTRO_HOLD_MAX)}
      {slider('画面渐隐', '结尾淡出到黑场', 'pictureFade', OUTRO_FADE_MAX)}
      {slider('音乐淡出', '随片尾渐弱，超长自动收短', 'musicFade', OUTRO_HOLD_MAX)}

      <div className="pt-0.5 text-[10px] text-zinc-500 leading-relaxed">
        片尾总长 <span className="font-mono text-zinc-300">{fmt(total)}</span>
        （画面延续 + 渐隐）
        {value.musicFade > total + 0.05 && (
          <> · 音乐淡出实际 <span className="font-mono text-zinc-400">{fmt(musicEffective)}</span></>
        )}
        {total === 0 && <> · 全部归零＝说完即停</>}
      </div>
    </div>
  );
};
