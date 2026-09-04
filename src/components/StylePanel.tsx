import React, { useState } from 'react';
import {
  ChevronDown,
  Eye,
  EyeOff,
  Grid3x3,
  LayoutGrid,
  Pencil,
  Pin,
  RefreshCw,
  Palette,
  Settings2,
  Star,
  Trash2
} from 'lucide-react';
import { StyleLibraryEntry, StylePack, VisualStyle } from '../types';
import { STYLE_DEFINITIONS } from '../utils/presets';
import { libraryCardSrc, splitLibraryByPins } from '../utils/styleLibrary';
import { ToolRail } from './ToolRail';

const COLS_KEY = 'ai_video_style_shelf_cols';
const OPEN_KEY = 'ai_video_style_shelf_open';
const APPLY_HINT = '点卡只切换世界，不自动重绘。画面跟上请点底部写入。';

type ShelfCols = 2 | 3;
type ShelfOpen = { library: boolean; presets: boolean };

function loadShelfCols(): ShelfCols {
  try {
    return localStorage.getItem(COLS_KEY) === '3' ? 3 : 2;
  } catch {
    return 2;
  }
}

function persistShelfCols(cols: ShelfCols) {
  try {
    localStorage.setItem(COLS_KEY, String(cols));
  } catch {
    /* ignore quota */
  }
}

function loadShelfOpen(): ShelfOpen {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (!raw) return { library: true, presets: true };
    const parsed = JSON.parse(raw);
    return {
      library: parsed.library !== false,
      presets: parsed.presets !== false
    };
  } catch {
    return { library: true, presets: true };
  }
}

function persistShelfOpen(next: ShelfOpen) {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota */
  }
}

function packSourceLabel(pack: StylePack, usingLibrary: boolean) {
  if (usingLibrary) return '我的世界';
  if (pack.source === 'inferred') return '反推';
  return '预设';
}

function cardShellClass(selected: boolean, managing: boolean, dense: boolean, hidden?: boolean) {
  const pad = dense ? 'p-1.5' : 'p-2';
  const base = `relative rounded-xl ${pad} border-2 transition-colors overflow-hidden ${
    managing ? 'cursor-default' : 'cursor-pointer'
  }`;
  if (hidden) return `${base} opacity-50 bg-[#16161c] border-dashed border-[#2b2b38]`;
  if (selected) return `${base} bg-[#252530] border-amber-500`;
  return `${base} bg-[#1b1b22] border-[#292934] hover:border-[#3d3d4e] hover:bg-[#1f1f28]`;
}

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
  const [cols, setCols] = useState<ShelfCols>(loadShelfCols);
  const [shelfOpen, setShelfOpen] = useState<ShelfOpen>(loadShelfOpen);
  const [worldOpen, setWorldOpen] = useState(false);

  const stylesList = Object.values(STYLE_DEFINITIONS);
  const activeId = activePack?.id || '';
  const usingLibrary = Boolean(activeId && library.some((item) => item.id === activeId));
  const { pinned, rest } = splitLibraryByPins(library, pinnedIds);
  const libraryCards = [...pinned, ...rest];
  const hiddenSet = new Set(hiddenPresetIds);
  const visiblePresets = stylesList.filter((item) => managing || !hiddenSet.has(item.id));
  const dense = cols === 3;

  const startRename = (entry: StyleLibraryEntry) => {
    setRenamingId(entry.id);
    setRenameValue(entry.title);
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRenameLibrary(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  const changeCols = (next: ShelfCols) => {
    setCols(next);
    persistShelfCols(next);
  };

  const toggleSection = (key: keyof ShelfOpen) => {
    setShelfOpen((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      persistShelfOpen(next);
      return next;
    });
  };

  const revealSelected = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (usingLibrary) {
      if (!shelfOpen.library) {
        const next = { ...shelfOpen, library: true };
        setShelfOpen(next);
        persistShelfOpen(next);
      }
    } else if (!shelfOpen.presets) {
      const next = { ...shelfOpen, presets: true };
      setShelfOpen(next);
      persistShelfOpen(next);
    }
    requestAnimationFrame(() => {
      const id = usingLibrary
        ? `style-library-card-${activeId}`
        : `style-card-${currentStyle}`;
      document.getElementById(id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  const isPresetSelected = (styleId: VisualStyle) =>
    activeId === `preset:${styleId}`
    || (activePack?.source === 'preset' && currentStyle === styleId && !usingLibrary);

  return (
    <ToolRail id="style-tool-panel">
      <div className="p-3.5 border-b border-[#23232c] bg-[#16161c] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Palette className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-zinc-200 truncate">风格</span>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <button
            type="button"
            title="两栏（含描述）"
            aria-pressed={cols === 2}
            onClick={() => changeCols(2)}
            className={`p-1 rounded-md cursor-pointer ${
              cols === 2 ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="三栏（更密）"
            aria-pressed={cols === 3}
            onClick={() => changeCols(3)}
            className={`p-1 rounded-md cursor-pointer ${
              cols === 3 ? 'text-amber-400' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Grid3x3 className="w-3.5 h-3.5" />
          </button>
          <button
            id="btn-manage-style-shelf"
            type="button"
            title={managing ? '完成管理' : '钉、隐藏、改名或移除'}
            onClick={() => {
              setManaging((prev) => !prev);
              setRenamingId(null);
            }}
            className={`ml-0.5 cursor-pointer ${
              managing
                ? 'text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500 text-black font-medium'
                : 'p-1 rounded-md text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {managing ? '完成' : <Settings2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {activePack && (
        <div className="px-3.5 py-2 border-b border-[#23232c] bg-[#16161c]">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setWorldOpen((prev) => !prev)}
              className="min-w-0 flex-1 flex items-center gap-1.5 text-left cursor-pointer"
            >
              <div className="text-[12px] text-zinc-100 truncate">
                {activePack.label}
                <span className="text-zinc-500"> · {packSourceLabel(activePack, usingLibrary)}</span>
              </div>
              <ChevronDown className={`w-3 h-3 text-zinc-500 flex-shrink-0 transition-transform ${worldOpen ? 'rotate-180' : ''}`} />
            </button>
            <button
              type="button"
              title={APPLY_HINT}
              onClick={revealSelected}
              className={`text-[10px] px-1.5 py-0.5 rounded-full flex-shrink-0 cursor-pointer ${
                appliedToStoryboard
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-zinc-800 text-zinc-400'
              }`}
            >
              {appliedToStoryboard ? '已写入' : '未应用'}
            </button>
          </div>
          {worldOpen && (
            <div className="mt-2 space-y-1.5">
              {activePack.world.wardrobe && (
                <p className="text-[10px] text-zinc-500 leading-snug">{activePack.world.wardrobe}</p>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {onOpenSettings && (
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="text-[10px] text-amber-300 hover:text-amber-200 cursor-pointer"
                  >
                    去设置反推
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
      )}

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs custom-scrollbar">
        {managing && (
          <p className="text-zinc-500 text-[11px] leading-relaxed">
            钉常用、对本片隐藏预设、改名或移除。完成后即可选用。
          </p>
        )}

        {libraryCards.length > 0 && (
          <ShelfSection
            title="我的世界"
            count={libraryCards.length}
            open={shelfOpen.library}
            onToggle={() => toggleSection('library')}
            hasActive={usingLibrary}
            cols={cols}
          >
            {libraryCards.map((entry) => (
              <LibraryCard
                key={entry.id}
                entry={entry}
                selected={activeId === entry.id}
                managing={managing}
                dense={dense}
                pinned={pinnedIds.includes(entry.id)}
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

        <ShelfSection
          title="预设"
          count={visiblePresets.length}
          open={shelfOpen.presets}
          onToggle={() => toggleSection('presets')}
          hasActive={!usingLibrary}
          cols={cols}
        >
          {visiblePresets.map((styleItem) => {
            const isSelected = isPresetSelected(styleItem.id);
            const hidden = hiddenSet.has(styleItem.id);
            return (
              <div
                key={styleItem.id}
                id={`style-card-${styleItem.id}`}
                onClick={() => {
                  if (managing) return;
                  onSelectPreset(styleItem.id);
                }}
                className={cardShellClass(isSelected, managing, dense, hidden)}
              >
                <div className={`absolute inset-0 bg-gradient-to-t opacity-20 pointer-events-none ${styleItem.previewBg}`} />
                <div className="relative z-10">
                  <div className={`relative aspect-video rounded-lg overflow-hidden border border-[#ffffff10] ${dense ? 'mb-1.5' : 'mb-2'}`}>
                    <img src={styleItem.thumbnail} alt={styleItem.name} className="w-full h-full object-cover" />
                  </div>
                  <span className="font-semibold text-zinc-100 text-xs truncate block">{styleItem.name}</span>
                  {!dense && (
                    <p className="text-[11px] text-zinc-400 leading-snug line-clamp-1 mt-0.5">
                      {styleItem.description}
                    </p>
                  )}
                </div>
                {managing && (
                  <button
                    type="button"
                    title={hidden ? '对本片显示' : '对本片隐藏'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleHiddenPreset(styleItem.id);
                    }}
                    className="absolute bottom-1.5 left-2 text-zinc-500 hover:text-amber-200 cursor-pointer p-0.5"
                  >
                    {hidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            );
          })}
        </ShelfSection>
      </div>

      <div className="p-3 border-t border-[#23232c] bg-[#16161c]">
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
    </ToolRail>
  );
};

function ShelfSection({
  title,
  count,
  open,
  onToggle,
  hasActive,
  cols,
  children
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  hasActive?: boolean;
  cols: ShelfCols;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500 px-0.5 hover:text-zinc-300 cursor-pointer"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? '' : '-rotate-90'}`} />
        <span>{title}</span>
        <span className="text-zinc-600 normal-case tracking-normal">{count}</span>
        {hasActive && !open && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
      </button>
      {open && (
        <div className="style-shelf-grid" data-cols={String(cols)}>
          {children}
        </div>
      )}
    </div>
  );
}

function LibraryCard({
  entry,
  selected,
  managing,
  dense,
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
  dense: boolean;
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
      className={cardShellClass(selected, managing, dense)}
    >
      <div className={`relative aspect-video rounded-lg overflow-hidden border border-[#ffffff10] bg-[#121217] ${dense ? 'mb-1.5' : 'mb-2'}`}>
        {thumbSrc ? (
          <img src={thumbSrc} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-600">无图</div>
        )}
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-1 min-w-0">
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
        {!dense && (
          <p className="text-[11px] text-zinc-400 leading-snug line-clamp-1 mt-0.5">{entry.blurb}</p>
        )}
      </div>
      {managing && (
        <div className="mt-1.5 flex items-center gap-2 text-zinc-500">
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
