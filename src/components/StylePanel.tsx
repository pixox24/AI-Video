import React from 'react';
import { Sparkles, Check, RefreshCw, Sliders, Palette } from 'lucide-react';
import { VisualStyle } from '../types';
import { STYLE_DEFINITIONS } from '../utils/presets';

interface StylePanelProps {
  currentStyle: VisualStyle;
  onStyleChange: (style: VisualStyle) => void;
  onApplyStyleToAllClips: () => void;
  isApplying: boolean;
}

export const StylePanel: React.FC<StylePanelProps> = ({
  currentStyle,
  onStyleChange,
  onApplyStyleToAllClips,
  isApplying
}) => {
  const stylesList = Object.values(STYLE_DEFINITIONS);

  return (
    <div
      id="style-tool-panel"
      className="w-80 lg:w-84 flex-shrink-0 bg-[#131318] border border-[#23232c] rounded-2xl flex flex-col h-full overflow-hidden select-none z-20 shadow-xl shadow-black/40"
    >
      {/* Header */}
      <div className="p-3.5 border-b border-[#23232c] bg-[#16161c] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-zinc-200">AI 视觉风格 & 艺术滤镜</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs custom-scrollbar">
        <div className="space-y-1">
          <p className="text-zinc-400 text-[11px] leading-relaxed">
            选择视频的整体美术风格，AI将自动匹配画面光影、渲染器参数及色彩调色。
          </p>
        </div>

        {/* Style Cards Grid */}
        <div className="grid grid-cols-1 gap-2.5">
          {stylesList.map((styleItem) => {
            const isSelected = currentStyle === styleItem.id;

            return (
              <div
                key={styleItem.id}
                id={`style-card-${styleItem.id}`}
                onClick={() => onStyleChange(styleItem.id)}
                className={`relative rounded-xl p-3.5 border transition-all cursor-pointer overflow-hidden ${
                  isSelected
                    ? 'bg-[#252530] border-amber-500 ring-1 ring-amber-500/40 shadow-lg shadow-black/40'
                    : 'bg-[#1b1b22] border-[#292934] hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
                }`}
              >
                {/* Background ambient accent */}
                <div
                  className={`absolute top-0 right-0 w-32 h-full bg-gradient-to-l opacity-25 pointer-events-none ${styleItem.previewBg}`}
                />

                <div className="relative z-10 flex items-stretch justify-between gap-3">
                  <div className="flex-1 space-y-1.5 py-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-zinc-100 text-xs">{styleItem.name}</span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full font-medium whitespace-nowrap"
                        style={{
                          backgroundColor: `${styleItem.accentColor}20`,
                          color: styleItem.accentColor,
                          border: `1px solid ${styleItem.accentColor}40`
                        }}
                      >
                        {styleItem.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-snug line-clamp-2">
                      {styleItem.description}
                    </p>
                  </div>

                  {/* 16:9 Thumbnail Container */}
                  <div className="relative w-[96px] h-[54px] flex-shrink-0 rounded-lg overflow-hidden border border-[#ffffff10] my-auto">
                    <img 
                      src={styleItem.thumbnail} 
                      alt={styleItem.name}
                      className="w-full h-full object-cover"
                    />
                    {isSelected && (
                      <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center backdrop-blur-[1px]">
                        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-black shadow-md">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Action Button: Apply style & Re-render */}
        <div className="pt-2">
          <button
            id="btn-apply-style-all"
            onClick={onApplyStyleToAllClips}
            disabled={isApplying}
            className="w-full py-2.5 bg-[#252532] hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-amber-500/40 font-medium rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isApplying ? 'animate-spin' : ''}`} />
            {isApplying ? '正在按新风格全量重绘...' : '应用此风格并重绘所有分镜'}
          </button>
        </div>
      </div>
    </div>
  );
};
