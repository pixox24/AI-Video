import React, { useState } from 'react';
import { 
  Tv, 
  Smartphone, 
  Square, 
  Layers, 
  Download, 
  Sparkles, 
  ChevronDown,
  Palette,
  Eye,
  Sliders,
  Play,
  Square as StopSquare,
  XCircle,
  RefreshCw,
  Undo2,
  Redo2,
  Mic
} from 'lucide-react';
import { AspectRatio, ProjectSettings } from '../types';

interface TopHeaderProps {
  title: string;
  onTitleChange: (title: string) => void;
  settings: ProjectSettings;
  onSettingsChange: (settings: ProjectSettings) => void;
  onOpenExportModal: () => void;
  onGenerateAll: () => void;
  onCancelGenerateAll?: () => void;
  isGeneratingAll: boolean;
  batchProgress?: { completed: number; total: number; activeCount: number } | null;
  narrationFresh?: boolean;
  isGeneratingNarration?: boolean;
  onRegenerateNarration?: () => void;
  failedImageCount?: number;
  onRetryFailedImages?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  title,
  onTitleChange,
  settings,
  onSettingsChange,
  onOpenExportModal,
  onGenerateAll,
  onCancelGenerateAll,
  isGeneratingAll,
  batchProgress,
  narrationFresh = true,
  isGeneratingNarration = false,
  onRegenerateNarration,
  failedImageCount = 0,
  onRetryFailedImages,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo
}) => {
  const [showAspectDropdown, setShowAspectDropdown] = useState(false);
  const [showBgDropdown, setShowBgDropdown] = useState(false);

  const aspectOptions: { id: AspectRatio; label: string; icon: React.ReactNode; sub: string }[] = [
    { id: '16:9', label: '16:9 横屏', icon: <Tv className="w-3.5 h-3.5" />, sub: 'YouTube / B站 / 电脑' },
    { id: '9:16', label: '9:16 竖屏', icon: <Smartphone className="w-3.5 h-3.5" />, sub: '抖音 / TikTok / 视频号' },
    { id: '1:1', label: '1:1 正方', icon: <Square className="w-3.5 h-3.5" />, sub: 'Instagram / 小红书' },
    { id: '4:5', label: '4:5 信息流', icon: <Layers className="w-3.5 h-3.5" />, sub: '社交媒体信息流' },
  ];

  const bgColors = [
    { id: '#0a0a0c', label: '纯黑暗夜' },
    { id: '#18181b', label: '深空深灰' },
    { id: '#0f172a', label: '深邃午夜蓝' },
    { id: '#1e1b4b', label: '神秘星云紫' },
    { id: 'blur', label: '动态背景模糊' },
  ];

  const currentAspect = aspectOptions.find(a => a.id === settings.aspectRatio) || aspectOptions[0];

  return (
    <header 
      id="top-header-bar"
      className="h-13 bg-[#131318] border border-[#23232c] rounded-2xl flex items-center justify-between px-4 select-none z-30 shadow-xl shadow-black/40 flex-shrink-0"
    >
      {/* Left controls: Aspect ratio & Background (Matching reference UI) */}
      <div className="flex items-center gap-3">
        {/* Aspect Ratio Selector */}
        <div className="relative">
          <button
            id="btn-aspect-ratio-selector"
            onClick={() => setShowAspectDropdown(!showAspectDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1e1e24] hover:bg-[#282830] border border-[#2e2e3a] text-zinc-200 text-xs font-medium cursor-pointer transition-all"
          >
            {currentAspect.icon}
            <span>{currentAspect.id}</span>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
          </button>

          {showAspectDropdown && (
            <div className="absolute top-full left-0 mt-1.5 w-52 bg-[#1b1b22] border border-[#2e2e3a] rounded-xl shadow-2xl p-1.5 space-y-1 z-50">
              {aspectOptions.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    onSettingsChange({ ...settings, aspectRatio: opt.id });
                    setShowAspectDropdown(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                    settings.aspectRatio === opt.id
                      ? 'bg-amber-500/20 text-amber-300 font-medium'
                      : 'text-zinc-300 hover:bg-[#262630]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {opt.icon}
                    <span>{opt.label}</span>
                  </div>
                  <span className="text-[10px] text-zinc-500">{opt.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Canvas Background Color Picker */}
        <div className="relative">
          <button
            id="btn-bg-color-selector"
            onClick={() => setShowBgDropdown(!showBgDropdown)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1e1e24] hover:bg-[#282830] border border-[#2e2e3a] text-zinc-300 text-xs cursor-pointer transition-all"
          >
            <div
              className="w-3 h-3 rounded-full border border-white/20"
              style={{
                backgroundColor: settings.canvasBackground === 'blur' ? '#6366f1' : settings.canvasBackground
              }}
            />
            <span className="text-zinc-400">背景</span>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
          </button>

          {showBgDropdown && (
            <div className="absolute top-full left-0 mt-1.5 w-40 bg-[#1b1b22] border border-[#2e2e3a] rounded-xl shadow-2xl p-1.5 space-y-1 z-50">
              {bgColors.map((bg) => (
                <button
                  key={bg.id}
                  onClick={() => {
                    onSettingsChange({ ...settings, canvasBackground: bg.id });
                    setShowBgDropdown(false);
                  }}
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs cursor-pointer ${
                    settings.canvasBackground === bg.id
                      ? 'bg-amber-500/20 text-amber-300 font-medium'
                      : 'text-zinc-300 hover:bg-[#262630]'
                  }`}
                >
                  <div
                    className="w-3 h-3 rounded-full border border-white/20"
                    style={{ backgroundColor: bg.id === 'blur' ? '#6366f1' : bg.id }}
                  />
                  <span>{bg.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Safe Margin Toggle */}
        <button
          onClick={() => onSettingsChange({ ...settings, safeMargin: !settings.safeMargin })}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors border ${
            settings.safeMargin
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
              : 'bg-[#1e1e24] text-zinc-400 border-[#2e2e3a] hover:text-zinc-200'
          }`}
          title="切换短视频安全参考线"
        >
          <Eye className="w-3.5 h-3.5" />
          <span>安全线</span>
        </button>
      </div>

      {/* Center: Editable Title */}
      <div className="flex-1 max-w-md mx-4">
        <input
          id="input-project-title"
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          placeholder="短视频工程标题..."
          className="w-full text-center bg-transparent border border-transparent hover:border-[#2b2b36] focus:border-amber-500/50 rounded-lg px-3 py-1 text-xs text-zinc-200 font-medium focus:outline-none transition-colors"
        />
      </div>

      {/* Right controls: AI batch generate and Export (Matching reference UI) */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          title="撤销 (Ctrl+Z)"
          className="p-1.5 rounded-lg border border-[#2e2e3a] text-zinc-400 hover:text-amber-300 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onRedo}
          disabled={!canRedo}
          title="重做 (Ctrl+Shift+Z)"
          className="p-1.5 rounded-lg border border-[#2e2e3a] text-zinc-400 hover:text-amber-300 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
        >
          <Redo2 className="w-3.5 h-3.5" />
        </button>
        {!narrationFresh && onRegenerateNarration && (
          <button
            type="button"
            onClick={onRegenerateNarration}
            disabled={isGeneratingNarration}
            title="口播和分镜不一致，点击重配音"
            className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[11px] font-medium flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            <Mic className={`w-3.5 h-3.5 ${isGeneratingNarration ? 'animate-pulse' : ''}`} />
            {isGeneratingNarration ? '配音中' : '旁白需重配'}
          </button>
        )}
        {failedImageCount > 0 && !isGeneratingAll && onRetryFailedImages && (
          <button
            type="button"
            onClick={onRetryFailedImages}
            className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-300 text-[11px] font-medium cursor-pointer"
          >
            重试失败 {failedImageCount}
          </button>
        )}
        {isGeneratingAll ? (
          <div className="flex items-center gap-1.5 bg-[#1c1c24] border border-amber-500/40 rounded-lg p-1 pr-2">
            <button
              id="btn-generate-all-assets"
              disabled
              className="px-2.5 py-1 text-amber-300 text-xs font-medium flex items-center gap-1.5 cursor-wait"
            >
              <Sparkles className="w-3.5 h-3.5 animate-spin text-amber-400" />
              <span>
                {batchProgress
                  ? `并行渲染中 (${batchProgress.completed}/${batchProgress.total})`
                  : 'AI 并发绘制中...'}
              </span>
            </button>

            {onCancelGenerateAll && (
              <button
                onClick={onCancelGenerateAll}
                className="p-1 px-1.5 bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white rounded border border-rose-500/30 text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
                title="中止当前正在进行的批量生图"
              >
                <StopSquare className="w-2.5 h-2.5 fill-current" />
                <span>停止</span>
              </button>
            )}
          </div>
        ) : (
          <button
            id="btn-generate-all-assets"
            onClick={onGenerateAll}
            className="px-3.5 py-1.5 rounded-lg bg-[#22222c] hover:bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer shadow-sm hover:shadow-amber-500/10 active:scale-95"
            title="以智能并发池模式并发生成所有镜头的 AI 原画"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>并发生成全部画面</span>
          </button>
        )}

        {/* Reference Image Styled "导出" Button */}
        <button
          id="btn-export-video"
          onClick={onOpenExportModal}
          className="px-5 py-1.5 rounded-lg bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-white/10 transition-all cursor-pointer active:scale-95"
        >
          <Download className="w-3.5 h-3.5 text-zinc-900" />
          <span>导出</span>
        </button>
      </div>
    </header>
  );
};
