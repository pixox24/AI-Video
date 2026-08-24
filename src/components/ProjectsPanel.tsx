import React from 'react';
import { FolderGit2, Plus, Download, Upload, Copy, Trash2, Sparkles, Clock, Check } from 'lucide-react';
import { VideoProject } from '../types';
import { SAMPLE_PROJECTS } from '../utils/presets';

interface ProjectsPanelProps {
  currentProject: VideoProject;
  onLoadProject: (project: VideoProject) => void;
  savedProjects: VideoProject[];
  onSaveCurrentProject: () => void;
  onDeleteProject: (projectId: string) => void;
}

export const ProjectsPanel: React.FC<ProjectsPanelProps> = ({
  currentProject,
  onLoadProject,
  savedProjects,
  onSaveCurrentProject,
  onDeleteProject,
}) => {
  const allProjects = [...SAMPLE_PROJECTS, ...savedProjects.filter(p => !SAMPLE_PROJECTS.some(sp => sp.id === p.id))];

  // Export JSON
  const handleExportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentProject, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${currentProject.title || 'video_project'}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Import JSON
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        if (imported.clips && Array.isArray(imported.clips)) {
          onLoadProject(imported);
        } else {
          alert('无效的工程文件格式');
        }
      } catch (err) {
        alert('解析工程文件失败');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div
      id="projects-tool-panel"
      className="w-80 lg:w-84 flex-shrink-0 bg-[#131318] border border-[#23232c] rounded-2xl flex flex-col h-full overflow-hidden select-none z-20 shadow-xl shadow-black/40"
    >
      {/* Header */}
      <div className="p-3.5 border-b border-[#23232c] bg-[#16161c] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderGit2 className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-zinc-200">作品草稿 & 官方模板</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-zinc-300 custom-scrollbar">
        {/* Actions Bar */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onSaveCurrentProject}
            className="p-2 bg-[#22222c] hover:bg-[#2c2c38] border border-[#363644] text-zinc-200 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-xs"
          >
            <Copy className="w-3.5 h-3.5 text-amber-400" />
            保存为新副本
          </button>

          <button
            onClick={handleExportJSON}
            className="p-2 bg-[#22222c] hover:bg-[#2c2c38] border border-[#363644] text-zinc-200 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-xs"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            导出工程 JSON
          </button>
        </div>

        {/* Import JSON */}
        <label className="p-2 bg-[#1a1a20] hover:bg-[#22222a] border border-dashed border-[#343444] rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-zinc-400 hover:text-zinc-200 text-xs transition-colors">
          <Upload className="w-3.5 h-3.5 text-emerald-400" />
          <span>导入外部工程文件 (.json)</span>
          <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
        </label>

        {/* Project List */}
        <div className="space-y-2 pt-2">
          <span className="text-zinc-400 font-medium text-[11px] block">全部模板与草稿</span>
          
          <div className="space-y-2">
            {allProjects.map((project) => {
              const isCurrent = currentProject.id === project.id;
              const totalSec = project.clips.reduce((acc, c) => acc + (c.duration || 3.5), 0);

              return (
                <div
                  key={project.id}
                  onClick={() => onLoadProject(project)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer space-y-1.5 ${
                    isCurrent
                      ? 'bg-[#252530] border-amber-500/80 ring-1 ring-amber-500/30'
                      : 'bg-[#1b1b22] border-[#292934] hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-xs text-zinc-100 line-clamp-1">
                      {project.title || '无标题工程'}
                    </span>
                    {isCurrent && (
                      <span className="px-1.5 py-0.2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-[10px] flex-shrink-0">
                        当前编辑
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-zinc-400 line-clamp-1">
                    {project.topic || '暂无描述'}
                  </p>

                  <div className="flex items-center justify-between text-[10px] text-zinc-400 pt-1 border-t border-[#262632]">
                    <span>{project.clips.length} 个分镜 · 约 {totalSec.toFixed(1)} 秒</span>
                    <span className="uppercase font-mono">{project.settings.aspectRatio}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
