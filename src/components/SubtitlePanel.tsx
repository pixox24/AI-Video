import React, { useEffect, useState } from 'react';
import { Subtitles, Sparkles, Type, ChevronDown, Loader2 } from 'lucide-react';
import { StoryboardClip, SubtitleConfig, SubtitlePreset } from '../types';
import { ToolRail } from './ToolRail';
import { showStatusToast } from '../utils/statusToast';
import { secondaryCoverage, translateClipsSecondary } from '../utils/secondaryText';
import {
  STUDIO_FONTS,
  StudioFont,
  fontFamilyStack,
  isStudioFontReady,
  loadStudioFont,
  resolveSubtitleFontId,
  studioFontById,
  subscribeStudioFonts
} from '../utils/subtitleFonts';

interface SubtitlePanelProps {
  config: SubtitleConfig;
  onChange: (config: SubtitleConfig) => void;
  clips?: StoryboardClip[];
  onUpdateClips?: (clips: StoryboardClip[]) => void;
  llmApi?: unknown;
}

const FONT_PREVIEW_TEXT = '这是当前字幕字体';

function FontSpecimenCard({
  font,
  active = false,
  pickerOpen = false,
  onClick,
  ariaExpanded,
  ariaControls
}: {
  font: StudioFont;
  active?: boolean;
  pickerOpen?: boolean;
  onClick: () => void;
  ariaExpanded?: boolean;
  ariaControls?: string;
}) {
  const ready = isStudioFontReady(font.id);
  return (
    <button
      id={`subtitle-font-${font.id}`}
      type="button"
      onClick={onClick}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      className={`w-full text-left rounded-xl border overflow-hidden cursor-pointer transition-all ${
        active
          ? 'bg-[#252530] border-amber-500 ring-1 ring-amber-500/40'
          : 'bg-[#1b1b22] border-[#292934] hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
      }`}
    >
      <div className="px-2.5 pt-2 pb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-zinc-200 truncate">{font.name}</span>
            {active && (
              <span className="flex-shrink-0 px-1.5 py-0.2 text-[9px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded">
                当前使用
              </span>
            )}
          </div>
          <p className="text-[10px] text-zinc-500 truncate mt-0.5">{font.desc}</p>
        </div>
        {active && (
          <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-amber-300 pt-0.5">
            {pickerOpen ? '收起' : '更换'}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
          </span>
        )}
      </div>
      <div className="mx-2 mb-2 rounded-lg bg-black/40 border border-white/5 px-3 py-3">
        <p
          className={`text-zinc-50 leading-relaxed ${active ? 'text-[22px]' : 'text-[20px]'}`}
          style={ready ? { fontFamily: fontFamilyStack(font) } : undefined}
        >
          {ready ? FONT_PREVIEW_TEXT : '正在载入字体…'}
        </p>
      </div>
    </button>
  );
}

export const SubtitlePanel: React.FC<SubtitlePanelProps> = ({ config, onChange, clips, onUpdateClips, llmApi }) => {
  const [, setFontTick] = useState(0);
  const [fontPickerOpen, setFontPickerOpen] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const selectedFontId = resolveSubtitleFontId(config);
  const selectedFont = studioFontById(selectedFontId);
  const otherFonts = STUDIO_FONTS.filter((font) => font.id !== selectedFontId);
  const coverage = secondaryCoverage(clips || []);

  const handleBackfillEnglish = async () => {
    if (!clips || !onUpdateClips || backfilling) return;
    setBackfilling(true);
    try {
      const result = await translateClipsSecondary(clips, llmApi);
      if (result.translated > 0) {
        onUpdateClips(result.clips);
        showStatusToast(
          result.failed > 0
            ? `已补齐 ${result.translated} 镜英文，${result.failed} 镜未译出，可再点一次`
            : `已补齐 ${result.translated} 镜英文`,
          { tone: result.failed > 0 ? 'warn' : 'ok', id: 'subtitle-english' }
        );
      } else {
        showStatusToast(result.error || '英文没生成出来，请检查模型设置', { tone: 'warn', id: 'subtitle-english' });
      }
    } finally {
      setBackfilling(false);
    }
  };

  useEffect(() => {
    const unsubscribe = subscribeStudioFonts(() => setFontTick((tick) => tick + 1));
    void loadStudioFont(selectedFontId);
    return unsubscribe;
  }, [selectedFontId]);

  useEffect(() => {
    if (!fontPickerOpen) return;
    STUDIO_FONTS.forEach((font) => {
      if (font.id === selectedFontId) return;
      void loadStudioFont(font.id);
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFontPickerOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fontPickerOpen, selectedFontId]);

  const handleSelectFont = (fontId: string) => {
    const font = studioFontById(fontId);
    setFontPickerOpen(false);
    if (font.id === selectedFontId) return;
    onChange({
      ...config,
      fontId: font.id,
      fontFamily: fontFamilyStack(font)
    });
    if (!font.url || isStudioFontReady(font.id)) {
      showStatusToast(`已切换字幕字体：${font.name}`, { tone: 'ok', id: 'subtitle-font' });
      return;
    }
    showStatusToast('正在载入字幕字体…', { tone: 'progress', id: 'subtitle-font', durationMs: 0 });
    void loadStudioFont(font.id).then((ok) => {
      if (ok) {
        showStatusToast(`已切换字幕字体：${font.name}`, { tone: 'ok', id: 'subtitle-font' });
      } else {
        showStatusToast(`字体载入失败：${font.name}，预览暂用系统字体`, { tone: 'error', id: 'subtitle-font' });
      }
    });
  };

  const presets: { id: SubtitlePreset; name: string; desc: string; sampleColor: string }[] = [
    { id: 'viral-yellow', name: '抖音爆款黄白', desc: '白字搭配明黄重点，高停留率', sampleColor: 'text-amber-400' },
    { id: 'cinematic-bilingual', name: '电影双语大片', desc: '中英双语优雅排版，高级院线感', sampleColor: 'text-sky-400' },
    { id: 'glow-capsule', name: '荧光暗黑胶囊', desc: '半透明圆角药丸底色，极其清晰', sampleColor: 'text-emerald-400' },
    { id: 'neon-cyan', name: '赛博霓虹发光', desc: '青色与粉色外发光，未来科技感', sampleColor: 'text-cyan-400' },
    { id: 'retro-typewriter', name: '复古打字机', desc: '等宽机械字体，纪实人文感', sampleColor: 'text-orange-300' },
    { id: 'classic-contrast', name: '经典黑底白字', desc: '高对比度纯黑底衬，全场景适用', sampleColor: 'text-zinc-200' },
  ];

  const handlePresetSelect = (preset: SubtitlePreset) => {
    let updates: Partial<SubtitleConfig> = { preset };

    if (preset === 'viral-yellow') {
      updates = {
        ...updates,
        primaryColor: '#ffffff',
        highlightColor: '#facc15',
        showBackground: true,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        showStroke: true,
        strokeColor: '#000000',
        animation: 'pop',
        bilingual: false
      };
    } else if (preset === 'cinematic-bilingual') {
      updates = {
        ...updates,
        primaryColor: '#ffffff',
        highlightColor: '#38bdf8',
        showBackground: false,
        showStroke: true,
        strokeColor: '#000000',
        animation: 'fade',
        bilingual: true
      };
    } else if (preset === 'glow-capsule') {
      updates = {
        ...updates,
        primaryColor: '#ffffff',
        highlightColor: '#34d399',
        showBackground: true,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        showStroke: false,
        animation: 'pop',
        bilingual: false
      };
    } else if (preset === 'neon-cyan') {
      updates = {
        ...updates,
        primaryColor: '#22d3ee',
        highlightColor: '#f43f5e',
        showBackground: true,
        backgroundColor: 'rgba(5, 5, 16, 0.85)',
        showStroke: true,
        strokeColor: '#083344',
        animation: 'karaoke',
        bilingual: false
      };
    } else if (preset === 'retro-typewriter') {
      updates = {
        ...updates,
        primaryColor: '#ffedd5',
        highlightColor: '#fb923c',
        showBackground: true,
        backgroundColor: 'rgba(41, 20, 5, 0.8)',
        showStroke: false,
        animation: 'fade',
        bilingual: false
      };
    } else {
      updates = {
        ...updates,
        primaryColor: '#ffffff',
        highlightColor: '#ffffff',
        showBackground: true,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        showStroke: false,
        animation: 'none',
        bilingual: false
      };
    }

    onChange({ ...config, ...updates });
  };

  return (
    <ToolRail id="subtitle-tool-panel">
      {/* Header */}
      <div className="p-3.5 border-b border-[#23232c] bg-[#16161c] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Subtitles className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-zinc-200">字幕排版 & 动画动效</span>
        </div>

        {/* Global Subtitle Enable Switch */}
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
            className="sr-only peer"
          />
          <div className="w-8 h-4 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500"></div>
        </label>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-zinc-300 custom-scrollbar">
        {/* Preset Styles */}
        <div className="space-y-2">
          <label className="text-zinc-400 font-medium">推荐字幕样式预设</label>
          <div className="grid grid-cols-2 gap-2">
            {presets.map((p) => {
              const isSelected = config.preset === p.id;
              return (
                <button
                  key={p.id}
                  id={`subtitle-preset-${p.id}`}
                  onClick={() => handlePresetSelect(p.id)}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#252530] border-amber-500 text-zinc-100 ring-1 ring-amber-500/40'
                      : 'bg-[#1b1b22] border-[#292934] text-zinc-400 hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
                  }`}
                >
                  <div className={`font-semibold text-xs mb-0.5 ${p.sampleColor}`}>{p.name}</div>
                  <div className="text-[10px] text-zinc-500 line-clamp-1 leading-snug">{p.desc}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="text-zinc-400 font-medium flex items-center gap-1.5">
              <Type className="w-3.5 h-3.5 text-amber-400" />
              字幕字体
            </label>
            <span className="text-[10px] text-zinc-500">{STUDIO_FONTS.length} 款</span>
          </div>

          <FontSpecimenCard
            font={selectedFont}
            active
            pickerOpen={fontPickerOpen}
            onClick={() => setFontPickerOpen((open) => !open)}
            ariaExpanded={fontPickerOpen}
            ariaControls="subtitle-font-picker"
          />

          <div
            id="subtitle-font-picker"
            className={`grid transition-[grid-template-rows] duration-200 ease-out ${
              fontPickerOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
            }`}
          >
            <div className="overflow-hidden" aria-hidden={!fontPickerOpen} inert={!fontPickerOpen}>
              <div className="space-y-1.5 pt-0.5">
                <p className="text-[10px] text-zinc-500 px-0.5">点选即用，选完自动收起</p>
                <div className="max-h-72 overflow-y-auto space-y-2 pr-0.5 custom-scrollbar">
                  {otherFonts.map((font) => (
                    <FontSpecimenCard
                      key={font.id}
                      font={font}
                      onClick={() => handleSelectFont(font.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bilingual Switch */}
        <div className="p-3 bg-[#1e1e26] border border-[#2b2b38] rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="font-medium text-zinc-200 block text-xs">中英双语字幕显示</span>
              <span className="text-[10px] text-zinc-400">自动同步分镜的英文对照翻译</span>
            </div>
            <input
              type="checkbox"
              checked={config.bilingual}
              onChange={(e) => onChange({ ...config, bilingual: e.target.checked })}
              className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
            />
          </div>
          {config.bilingual && clips && onUpdateClips && coverage.total > 0 && (
            <div className="pt-1 border-t border-[#2b2b38] space-y-1.5">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-zinc-400">
                  英文行 <span className="font-mono text-zinc-200">{coverage.fresh}/{coverage.total}</span> 镜与旁白对齐
                </span>
                {coverage.stale > 0 && <span className="text-amber-400">{coverage.stale} 镜待更新</span>}
              </div>
              {coverage.stale > 0 && (
                <button
                  id="btn-backfill-english"
                  type="button"
                  onClick={() => { void handleBackfillEnglish(); }}
                  disabled={backfilling}
                  className="w-full py-1.5 rounded-xl border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 cursor-pointer disabled:opacity-50 text-[11px]"
                >
                  {backfilling ? '正在生成英文…' : `补齐英文（${coverage.stale} 镜）`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Typography Controls */}
        <div className="space-y-3 pt-1">
          {/* Font Size */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-zinc-400">
              <span>字幕字号</span>
              <span className="font-mono text-zinc-200">{config.fontSize}px</span>
            </div>
            <input
              type="range"
              min="18"
              max="42"
              value={config.fontSize}
              onChange={(e) => onChange({ ...config, fontSize: Number(e.target.value) })}
              className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
          </div>

          {/* Position Y (Percentage) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-zinc-400">
              <span>垂直位置 (Y轴)</span>
              <span className="font-mono text-zinc-200">{config.positionY}%</span>
            </div>
            <input
              type="range"
              min="20"
              max="90"
              value={config.positionY}
              onChange={(e) => onChange({ ...config, positionY: Number(e.target.value) })}
              className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
          </div>

          {/* Animation Type */}
          <div className="space-y-1.5">
            <label className="text-zinc-400">文字出场动效</label>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: 'pop', name: '弹性弹出 (Pop)' },
                { id: 'fade', name: '平滑淡入 (Fade)' },
                { id: 'karaoke', name: '逐字高亮 (Karaoke)' },
              ].map((anim) => (
                <button
                  key={anim.id}
                  onClick={() => onChange({ ...config, animation: anim.id as any })}
                  className={`py-1.5 px-1 rounded-lg text-center text-[11px] transition-all cursor-pointer truncate ${
                    config.animation === anim.id
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 font-medium'
                      : 'bg-[#1e1e24] text-zinc-400 border border-[#2b2b36] hover:bg-[#25252e]'
                  }`}
                >
                  {anim.name}
                </button>
              ))}
            </div>
          </div>

          {/* Anti-Overflow Smart Multi-line Settings */}
          <div className="p-3 bg-[#1e1e26] border border-[#2b2b38] rounded-xl space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="font-medium text-zinc-200 block text-xs flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  智能多行排版 & 防截断
                </span>
                <span className="text-[10px] text-zinc-400">过长长句自动自然折行与字号自适应</span>
              </div>
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono">
                已激活
              </span>
            </div>

            {/* Max Width Ratio Slider */}
            <div className="space-y-1 pt-1">
              <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                <span>安全排版宽度</span>
                <span className="font-mono text-zinc-200">
                  {Math.round((config.maxWidthRatio || 0.84) * 100)}% 画面
                </span>
              </div>
              <input
                type="range"
                min="70"
                max="92"
                value={Math.round((config.maxWidthRatio || 0.84) * 100)}
                onChange={(e) => onChange({ ...config, maxWidthRatio: Number(e.target.value) / 100 })}
                className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            {/* Max Lines */}
            <div className="flex items-center justify-between text-[11px] pt-0.5">
              <span className="text-zinc-400">最大允许行数</span>
              <div className="flex gap-1">
                {[2, 3, 4].map((lines) => (
                  <button
                    key={lines}
                    onClick={() => onChange({ ...config, maxLines: lines })}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                      (config.maxLines || 3) === lines
                        ? 'bg-amber-500 text-black font-semibold'
                        : 'bg-[#292936] text-zinc-400 hover:bg-[#323242]'
                    }`}
                  >
                    {lines} 行
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Background Pill & Stroke Toggles */}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <label className="flex items-center gap-2 p-2 bg-[#1b1b22] border border-[#292934] rounded-lg cursor-pointer hover:bg-[#20202a]">
              <input
                type="checkbox"
                checked={config.showBackground}
                onChange={(e) => onChange({ ...config, showBackground: e.target.checked })}
                className="w-3.5 h-3.5 accent-amber-500"
              />
              <span className="text-[11px] text-zinc-300">半透明胶囊背景</span>
            </label>

            <label className="flex items-center gap-2 p-2 bg-[#1b1b22] border border-[#292934] rounded-lg cursor-pointer hover:bg-[#20202a]">
              <input
                type="checkbox"
                checked={config.showStroke}
                onChange={(e) => onChange({ ...config, showStroke: e.target.checked })}
                className="w-3.5 h-3.5 accent-amber-500"
              />
              <span className="text-[11px] text-zinc-300">文字描边与阴影</span>
            </label>
          </div>
        </div>
      </div>
    </ToolRail>
  );
};
