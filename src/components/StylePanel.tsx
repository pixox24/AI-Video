import React, { useState } from 'react';
import { Check, Eye, EyeOff, Pencil, Pin, RefreshCw, Palette, Star, Trash2 } from 'lucide-react';
import { StyleLibraryEntry, StylePack, VisualStyle } from '../types';
import { STYLE_DEFINITIONS } from '../utils/presets';
import { STYLE_PIN_MAX, libraryCardSrc, splitLibraryByPins } from '../utils/styleLibrary';
import { ToolRail } from './ToolRail';

interface StylePanelProps {
  currentStyle: VisualStyle;
  activePack?: StylePack;
  library: StyleLibraryEntry[];
  pinnedIds: string[];
  hiddenPresetIds: VisualStyle[];
  appliedToStoryboard: boolean;
  onSelectPreset: (style: VisualStyle) => void;
  onSelectLibrary: (entry: StyleLibraryEntry) => void;
  onDeleteLibrary: (id: string) => void;
  onRenameLibrary: (id: string, title: string) => void;
  onTogglePin: (id: string) => void;
  onToggleHiddenPreset: (id: VisualStyle) => void;
  onSaveCurrentToLibrary: () => void;
  currentInLibrary: boolean;
  onApplyStyleToAllClips: (pack?: StylePack) => void;
  isApplying: boolean;
  hasClips?: boolean;
  onOpenSettings?: () => void;
}

export const StylePanel: React.FC<StylePanelProps> = ({
  currentStyle,
  activePack,
  library,
  pinnedIds,
  hiddenPresetIds,
  appliedToStoryboard,
  onSelectPreset,
  onSelectLibrary,
  onDeleteLibrary,
  onRenameLibrary,
  onTogglePin,
  onToggleHiddenPreset,
  onSaveCurrentToLibrary,
  currentInLibrary,
  onApplyStyleToAllClips,
  isApplying,
  hasClips = false,
  onOpenSettings
}) => {
  const [managing, setManaging] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const stylesList = Object.values(STYLE_DEFINITIONS);
  const activeId = activePack?.id || '';
  const usingLibrary = Boolean(activeId && library.some((item) => item.id === activeId));
  const { pinned, rest } = splitLibraryByPins(library, pinnedIds);
  const hiddenSet = new Set(hiddenPresetIds);
  const visiblePresets = stylesList.filter((item) => managing || !hiddenSet.has(item.id));
  const hiddenPresets = stylesList.filter((item) => hiddenSet.has(item.id));

  const startRename = (entry: StyleLibraryEntry) => {
    setRenamingId(entry.id);
    setRenameValue(entry.title);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRenameLibrary(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  return (
    <ToolRail id="style-tool-panel">
      <div className="p-3.5 border-b border-[#23232c] bg-[#16161c] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Palette className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-zinc-200 truncate">AI 视觉风格</span>
        </div>
        <button
          id="btn-manage-style-shelf"
          type="button"
          onClick={() => {
            setManaging((prev) => !prev);
            setRenamingId(null);
          }}
          className={`text-[11px] px-2 py-1 rounded-lg cursor-pointer ${
            managing ? 'bg-amber-500 text-black font-medium' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {managing ? '完成' : '管理货架'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs custom-scrollbar">
        <div className="space-y-1">
          <p className="text-zinc-400 text-[11px] leading-relaxed">
            {managing
              ? '钉常用、对本片隐藏预设、改名或移除我的世界。点完成后再选用。'
              : '点卡只切换世界，不自动重绘。画面跟上世界请点底部应用。'}
          </p>
          {activePack && (
            <div className="rounded-xl border border-[#2b2b36] bg-[#181820] px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] text-zinc-500">当前美术世界</div>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  appliedToStoryboard
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-zinc-800 text-zinc-400'
                }`}>
                  {appliedToStoryboard ? '已写入分镜' : '仅选用'}
                </span>
              </div>
              <div className="text-[12px] text-zinc-100">
                {activePack.label} · {usingLibrary ? '我的世界' : activePack.source === 'inferred' ? '上传反推' : '预设'}
              </div>
              <div className="text-[10px] text-zinc-500 leading-snug">
                {activePack.world.wardrobe}
              </div>
              <div className="flex flex-wrap gap-2">
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-[10px] text-amber-300 hover:text-amber-200 cursor-pointer"
                  >
                    去设置反推参考图
                  </button>
                )}
                {!currentInLibrary && (
                  <button
                    type="button"
                    onClick={onSaveCurrentToLibrary}
                    className="text-[10px] text-amber-300 hover:text-amber-200 cursor-pointer"
                  >
                    另存到我的世界
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {pinned.length > 0 && (
          <ShelfSection title={`钉 · ${pinned.length}/${STYLE_PIN_MAX}`}>
            {pinned.map((entry) => (
              <LibraryCard
                key={entry.id}
                entry={entry}
                selected={activeId === entry.id}
                managing={managing}
                pinned
                renaming={renamingId === entry.id}
                renameValue={renameValue}
                onRenameValue={setRenameValue}
                onStartRename={() => startRename(entry)}
                onCommitRename={commitRename}
                onSelect={() => onSelectLibrary(entry)}
                onTogglePin={() => onTogglePin(entry.id)}
                onDelete={() => onDeleteLibrary(entry.id)}
              />
            ))}
          </ShelfSection>
        )}

        {rest.length > 0 && (
          <ShelfSection title="我的世界">
            {rest.map((entry) => (
              <LibraryCard
                key={entry.id}
                entry={entry}
                selected={activeId === entry.id}
                managing={managing}
                pinned={false}
                renaming={renamingId === entry.id}
                renameValue={renameValue}
                onRenameValue={setRenameValue}
                onStartRename={() => startRename(entry)}
                onCommitRename={commitRename}
                onSelect={() => onSelectLibrary(entry)}
                onTogglePin={() => onTogglePin(entry.id)}
                onDelete={() => onDeleteLibrary(entry.id)}
              />
            ))}
          </ShelfSection>
        )}

        <ShelfSection title={hiddenPresets.length > 0 && !managing ? `预设 · 已隐藏 ${hiddenPresets.length}` : '预设'}>
          {visiblePresets.map((styleItem) => {
            const isSelected =
              activeId === `preset:${styleItem.id}`
              || (activePack?.source === 'preset' && currentStyle === styleItem.id && !usingLibrary);
            const hidden = hiddenSet.has(styleItem.id);
            return (
              <div
                key={styleItem.id}
                id={`style-card-${styleItem.id}`}
                onClick={() => {
                  if (managing) return;
                  onSelectPreset(styleItem.id);
                }}
                className={`relative rounded-xl p-2.5 border transition-all overflow-hidden ${
                  managing ? 'cursor-default' : 'cursor-pointer'
                } ${
                  hidden
                    ? 'opacity-50 bg-[#16161c] border-dashed border-[#2b2b38]'
                    : isSelected
                      ? 'bg-[#252530] border-amber-500 ring-1 ring-amber-500/40 shadow-lg shadow-black/40'
                      : 'bg-[#1b1b22] border-[#292934] hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
                }`}
              >
                <div className={`absolute inset-0 bg-gradient-to-t opacity-20 pointer-events-none ${styleItem.previewBg}`} />
                <div className="relative z-10">
                  <div className="relative aspect-video rounded-lg overflow-hidden border border-[#ffffff10] mb-2">
                    <img src={styleItem.thumbnail} alt={styleItem.name} className="w-full h-full object-cover" />
                    {isSelected && !hidden && (
                      <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center backdrop-blur-[1px]">
                        <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-black shadow-md">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-semibold text-zinc-100 text-xs truncate">{styleItem.name}</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-snug line-clamp-2 mt-0.5">
                    {styleItem.description}
                  </p>
                </div>
                {managing && (
                  <button
                    type="button"
                    title={hidden ? '对本片显示' : '对本片隐藏'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleHiddenPreset(styleItem.id);
                    }}
                    className="absolute bottom-2 left-3 text-zinc-500 hover:text-amber-200 cursor-pointer p-0.5"
                  >
                    {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            );
          })}
        </ShelfSection>

        <div className="pt-2">
          <button
            id="btn-apply-style-all"
            onClick={() => onApplyStyleToAllClips()}
            disabled={isApplying || !hasClips || managing}
            className="w-full py-2.5 bg-[#252532] hover:bg-amber-500/20 text-amber-300 hover:text-amber-200 border border-amber-500/40 font-medium rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isApplying ? 'animate-spin' : ''}`} />
            {isApplying
              ? '正在写入分镜画面词...'
              : hasClips
                ? '写入分镜画面词（旁白不动，不生图）'
                : '先写入分镜后再应用风格'}
          </button>
        </div>
      </div>
    </ToolRail>
  );
};

function ShelfSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-0.5">{title}</div>
      <div className="style-shelf-grid">{children}</div>
    </div>
  );
}

function LibraryCard({
  entry,
  selected,
  managing,
  pinned,
  renaming,
  renameValue,
  onRenameValue,
  onStartRename,
  onCommitRename,
  onSelect,
  onTogglePin,
  onDelete
}: {
  entry: StyleLibraryEntry;
  selected: boolean;
  managing: boolean;
  pinned: boolean;
  renaming: boolean;
  renameValue: string;
  onRenameValue: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onSelect: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const thumbSrc = libraryCardSrc(entry);
  return (
    <div
      id={`style-library-card-${entry.id}`}
      onClick={() => {
        if (managing || renaming) return;
        onSelect();
      }}
      className={`relative rounded-xl p-2.5 border transition-all overflow-hidden ${
        managing ? 'cursor-default' : 'cursor-pointer'
      } ${
        selected
          ? 'bg-[#252530] border-amber-500 ring-1 ring-amber-500/40 shadow-lg shadow-black/40'
          : 'bg-[#1b1b22] border-[#292934] hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
      }`}
    >
      <div className="relative aspect-video rounded-lg overflow-hidden border border-[#ffffff10] bg-[#121217] mb-2">
        {thumbSrc ? (
          <img src={thumbSrc} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-600">无图</div>
        )}
        {selected && (
          <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center backdrop-blur-[1px]">
            <div className="w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center text-black shadow-md">
              <Check className="w-3 h-3 stroke-[3]" />
            </div>
          </div>
        )}
      </div>
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {renaming ? (
            <input
              autoFocus
              value={renameValue}
              maxLength={16}
              onChange={(e) => onRenameValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onBlur={onCommitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onCommitRename();
                if (e.key === 'Escape') onCommitRename();
              }}
              className="flex-1 min-w-0 bg-[#121217] border border-amber-500/40 rounded-lg px-2 py-1 text-xs text-zinc-100 outline-none"
            />
          ) : (
            <span className="font-semibold text-zinc-100 text-xs truncate">{entry.title}</span>
          )}
          {pinned && !managing && <Star className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />}
        </div>
        <p className="text-[11px] text-zinc-400 leading-snug line-clamp-2">{entry.blurb}</p>
      </div>
      {managing && (
        <div className="mt-2 flex items-center gap-2 text-zinc-500">
          <button type="button" title={pinned ? '取消钉住' : '钉在顶上'} onClick={(e) => { e.stopPropagation(); onTogglePin(); }} className="hover:text-amber-200 cursor-pointer p-0.5">
            <Pin className={`w-3.5 h-3.5 ${pinned ? 'text-amber-400' : ''}`} />
          </button>
          <button type="button" title="改名" onClick={(e) => { e.stopPropagation(); onStartRename(); }} className="hover:text-zinc-200 cursor-pointer p-0.5">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button type="button" title="从风格栏移除" onClick={(e) => { e.stopPropagation(); onDelete(); }} className="hover:text-rose-300 cursor-pointer p-0.5 ml-auto">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
