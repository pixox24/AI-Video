import React from 'react';
import { 
  FileText,
  Film,
  Palette, 
  Subtitles, 
  Volume2, 
  FolderGit2, 
  Settings,
  Sparkles
} from 'lucide-react';
import { ActiveTab } from '../types';

interface SidebarNavProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
}

export const SidebarNav: React.FC<SidebarNavProps> = ({ activeTab, onTabChange }) => {
  const topTabs: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: 'script', label: '文案', icon: <FileText className="w-5 h-5" /> },
    { id: 'storyboard', label: '分镜', icon: <Film className="w-5 h-5" /> },
    { id: 'style', label: '风格', icon: <Palette className="w-5 h-5" /> },
    { id: 'subtitles', label: '字幕', icon: <Subtitles className="w-5 h-5" /> },
    { id: 'audio', label: '声音', icon: <Volume2 className="w-5 h-5" /> },
  ];

  const bottomTabs: { id: ActiveTab; label: string; icon: React.ReactNode }[] = [
    { id: 'projects', label: '作品', icon: <FolderGit2 className="w-5 h-5" /> },
    { id: 'settings', label: '设置', icon: <Settings className="w-5 h-5" /> },
  ];

  return (
    <aside 
      id="sidebar-nav-container"
      className="w-16 flex-shrink-0 bg-[#131318] border border-[#23232c] rounded-2xl flex flex-col justify-between items-center py-3 select-none z-30 shadow-xl shadow-black/40 overflow-y-auto custom-scrollbar"
    >
      {/* Top Primary Tabs */}
      <div className="flex flex-col items-center gap-1.5 w-full px-1">
        {/* Brand Studio Mark */}
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-600/30 border border-amber-500/40 flex items-center justify-center text-amber-400 mb-1.5 shadow-inner">
          <Sparkles className="w-5 h-5" />
        </div>

        {topTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`nav-tab-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-[#2a2a32] text-amber-400 font-medium shadow-md shadow-black/40 border border-amber-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1a20]'
              }`}
              title={tab.label}
            >
              {tab.icon}
              <span className="text-[11px] leading-none tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Bottom Secondary Tabs */}
      <div className="flex flex-col items-center gap-1.5 w-full px-1 pt-2">
        {bottomTabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`nav-tab-${tab.id}`}
              onClick={() => onTabChange(tab.id)}
              className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-all duration-200 cursor-pointer ${
                isActive
                  ? 'bg-[#2a2a32] text-amber-400 font-medium shadow-md shadow-black/40 border border-amber-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1a1a20]'
              }`}
              title={tab.label}
            >
              {tab.icon}
              <span className="text-[11px] leading-none tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
};
