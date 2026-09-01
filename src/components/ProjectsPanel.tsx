import React, { useEffect, useMemo, useState } from 'react';
import { FolderGit2, Plus, Download, Upload, Copy, Trash2, RotateCcw, RefreshCw, Image as ImageIcon } from 'lucide-react';
import { ProjectLibraryItem, StoryboardClip, VideoProject } from '../types';
import { SAMPLE_PROJECTS } from '../utils/presets';
import {
  collectReferencedAssetUrls,
  fetchGeneratedAssets,
  fetchPreviousProject,
  GeneratedAsset,
  projectForPersist
} from '../utils/projectPersist';
import { stripProjectSecrets } from '../utils/appSettings';
import { ToolRail } from './ToolRail';

interface ProjectsPanelProps {
  currentProject: VideoProject;
  selectedClipId: string | null;
  libraryItems: ProjectLibraryItem[];
  onOpenLibraryProject: (id: string) => void;
  onOpenTemplate: (project: VideoProject) => void;
  onSaveAs: () => void;
  onDeleteLibraryProject: (projectId: string) => void;
  onNewBlankProject: () => void;
  onRestorePrevious: () => void;
  onAttachGeneratedImage: (url: string) => void;
  onImportProject: (project: VideoProject) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(mtime: number): string {
  try {
    return new Date(mtime).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function clipLabel(clip: StoryboardClip | undefined, clips: StoryboardClip[]): string {
  if (!clip) return '未选分镜';
  const index = clips.findIndex((item) => item.id === clip.id);
  const order = index >= 0 ? index + 1 : clip.order;
  const text = (clip.narration || clip.visualPrompt || '').trim().slice(0, 18);
  return `镜 ${order}${text ? ` · ${text}` : ''}`;
}

export const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
  currentProject,
  selectedClipId,
  libraryItems,
  onOpenLibraryProject,
  onOpenTemplate,
  onSaveAs,
  onDeleteLibraryProject,
  onNewBlankProject,
  onRestorePrevious,
  onAttachGeneratedImage,
  onImportProject
}) => {
  const selectedClip = currentProject.clips.find((clip) => clip.id === selectedClipId);
  const referenced = useMemo(() => collectReferencedAssetUrls(currentProject), [currentProject]);

  const [assets, setAssets] = useState<GeneratedAsset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [previousTitle, setPreviousTitle] = useState<string | null>(null);

  const loadAssets = async () => {
    setAssetsLoading(true);
    const items = await fetchGeneratedAssets('image');
    setAssets(items);
    setAssetsLoading(false);
  };

  useEffect(() => {
    void loadAssets();
    void fetchPreviousProject().then((stored) => {
      setPreviousTitle(stored?.project?.title || (stored ? '上一份工程' : null));
    });
  }, [currentProject.id]);

  const orphans = assets.filter((item) => !referenced.has(item.url));
  const attached = assets.filter((item) => referenced.has(item.url));

  const handleExportJSON = () => {
    const payload = stripProjectSecrets(projectForPersist(currentProject));
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${currentProject.title || 'video_project'}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (imported.clips && Array.isArray(imported.clips)) {
          onImportProject(imported);
        } else {
          alert('无效的工程文件格式');
        }
      } catch (err) {
        alert('解析工程文件失败');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <ToolRail id="projects-tool-panel">
      <div className="p-3.5 border-b border-[#23232c] bg-[#16161c] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderGit2 className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-zinc-200">工程库</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-zinc-300 custom-scrollbar">
        <p className="text-[11px] text-zinc-500 leading-relaxed">
          每个作品一个文件夹，自动保存到 <span className="font-mono text-zinc-400">data/projects/</span>。密钥留在本机设置，不进工程文件。模板打开会复制一份。
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            id="btn-new-blank-project"
            onClick={onNewBlankProject}
            className="p-2 bg-[#22222c] hover:bg-[#2c2c38] border border-[#363644] text-zinc-200 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-xs"
          >
            <Plus className="w-3.5 h-3.5 text-amber-400" />
            新建工程
          </button>
          <button
            type="button"
            id="btn-save-as-project"
            onClick={onSaveAs}
            className="p-2 bg-[#22222c] hover:bg-[#2c2c38] border border-[#363644] text-zinc-200 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-xs"
          >
            <Copy className="w-3.5 h-3.5 text-amber-400" />
            另存为
          </button>
          <button
            type="button"
            onClick={handleExportJSON}
            className="p-2 bg-[#22222c] hover:bg-[#2c2c38] border border-[#363644] text-zinc-200 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-xs"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            导出 JSON
          </button>
          <button
            type="button"
            id="btn-restore-previous-project"
            onClick={onRestorePrevious}
            disabled={!previousTitle}
            className="p-2 bg-[#22222c] hover:bg-[#2c2c38] border border-[#363644] text-zinc-200 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-xs disabled:opacity-40 disabled:cursor-not-allowed"
            title={previousTitle ? `恢复「${previousTitle}」` : '还没有上一份备份'}
          >
            <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
            {previousTitle ? '恢复上一份' : '暂无上一份'}
          </button>
        </div>

        <label className="p-2 bg-[#1a1a20] hover:bg-[#22222a] border border-dashed border-[#343444] rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-zinc-400 hover:text-zinc-200 text-xs transition-colors">
          <Upload className="w-3.5 h-3.5 text-emerald-400" />
          <span>导入工程 JSON</span>
          <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
        </label>

        <section id="library-project-list" className="space-y-2">
          <span className="text-zinc-400 font-medium text-[11px] block">进行中的工程</span>
          {libraryItems.length === 0 ? (
            <div className="p-3 rounded-xl border border-dashed border-[#2e2e3a] text-[11px] text-zinc-500">
              还没有工程。编辑当前稿或点新建后会出现在这里。
            </div>
          ) : (
            <div className="space-y-2">
              {libraryItems.map((item) => {
                const isCurrent = currentProject.id === item.id;
                return (
                  <div
                    key={item.id}
                    onClick={() => onOpenLibraryProject(item.id)}
                    className={`rounded-xl border transition-all cursor-pointer overflow-hidden ${
                      isCurrent
                        ? 'bg-[#252530] border-amber-500/80 ring-1 ring-amber-500/30'
                        : 'bg-[#1b1b22] border-[#292934] hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
                    }`}
                  >
                    {item.coverUrl && (
                      <div className="aspect-video bg-[#0e0e12] overflow-hidden">
                        <img src={item.coverUrl} alt="" className="w-full h-full object-cover" />
                      </div>
                    )}
                    <div className="p-3 space-y-1.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-xs text-zinc-100 line-clamp-1">
                          {item.title || '无标题工程'}
                        </span>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {isCurrent && (
                            <span className="px-1.5 py-0.2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-[10px]">
                              当前
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDeleteLibraryProject(item.id);
                            }}
                            className="p-1 rounded-lg text-zinc-500 hover:text-rose-300 cursor-pointer"
                            title="从工程库删除"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-zinc-400 line-clamp-1">
                        {item.topic || '暂无描述'}
                      </p>
                      <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-1 border-t border-[#262632]">
                        <span>{item.clipCount} 个分镜 · 约 {item.duration.toFixed(1)} 秒</span>
                        <span className="uppercase font-mono">{item.aspectRatio}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-2 pt-1">
          <span className="text-zinc-400 font-medium text-[11px] block">官方模板（打开即复制）</span>
          <div className="space-y-2">
            {SAMPLE_PROJECTS.map((project) => (
              <div
                key={project.id}
                onClick={() => onOpenTemplate(project)}
                className="p-3 rounded-xl border border-[#292934] bg-[#1b1b22] hover:border-[#3d3d4e] hover:bg-[#1f1f28] cursor-pointer space-y-1.5"
              >
                <span className="font-semibold text-xs text-zinc-100 line-clamp-1">{project.title}</span>
                <p className="text-[11px] text-zinc-400 line-clamp-1">{project.topic}</p>
                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  <span>{project.clips.length} 个分镜</span>
                  <span>打开后另存为新工程</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="orphan-assets-section" className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-zinc-400 font-medium text-[11px]">未挂上当前工程的生成图</span>
            <button
              type="button"
              onClick={() => { void loadAssets(); }}
              className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 cursor-pointer"
              title="刷新文件列表"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${assetsLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 leading-relaxed">
            点一张图即可挂到 {clipLabel(selectedClip, currentProject.clips)}。文件仍在磁盘，只是镜头引用会改。
          </p>
          {orphans.length === 0 ? (
            <div className="p-3 rounded-xl border border-dashed border-[#2e2e3a] text-[11px] text-zinc-500 flex items-center gap-2">
              <ImageIcon className="w-3.5 h-3.5" />
              {assetsLoading ? '正在扫描 public/generated…' : attached.length > 0 ? '生成图都已挂在当前工程里' : '还没有本地生成图'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {orphans.slice(0, 48).map((item) => (
                <button
                  key={item.url}
                  type="button"
                  onClick={() => onAttachGeneratedImage(item.url)}
                  className="group text-left rounded-xl overflow-hidden border border-[#2a2a36] bg-[#16161c] hover:border-amber-500/50 cursor-pointer"
                  title={`挂到${clipLabel(selectedClip, currentProject.clips)}`}
                >
                  <div className="aspect-video bg-[#0e0e12] overflow-hidden">
                    <img src={item.url} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="px-2 py-1.5 space-y-0.5">
                    <div className="text-[10px] text-zinc-300 truncate">{item.kind === 'char-ref' ? '角色参考' : formatTime(item.mtime)}</div>
                    <div className="text-[10px] text-zinc-500">{formatBytes(item.bytes)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {orphans.length > 48 && (
            <p className="text-[10px] text-zinc-500">还有 {orphans.length - 48} 张，请按时间从上面找最近的。</p>
          )}
          {attached.length > 0 && (
            <p className="text-[10px] text-zinc-500">当前工程已引用 {attached.length} 张本地图。</p>
          )}
        </section>
      </div>
    </ToolRail>
  );
};
