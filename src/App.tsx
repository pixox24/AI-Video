import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VideoProject, ActiveTab, StoryboardClip } from './types';
import { SAMPLE_PROJECTS, DEFAULT_SUBTITLE_CONFIG, DEFAULT_AUDIO_CONFIG, resolveImageApi } from './utils/presets';
import { generateProceduralArtwork } from './utils/visualGenerator';
import { runConcurrencyPool } from './utils/concurrencyPool';
import { SidebarNav } from './components/SidebarNav';
import { ScriptPanel } from './components/ScriptPanel';
import { StoryboardPanel } from './components/StoryboardPanel';
import { StylePanel } from './components/StylePanel';
import { SubtitlePanel } from './components/SubtitlePanel';
import { AudioPanel } from './components/AudioPanel';
import { ProjectsPanel } from './components/ProjectsPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { TopHeader } from './components/TopHeader';
import { VideoPlayerStage } from './components/VideoPlayerStage';
import { TimelineBar } from './components/TimelineBar';
import { ExportModal } from './components/ExportModal';

function settleProjectImages(project: VideoProject): VideoProject {
  return {
    ...project,
    clips: (project.clips || []).map((clip) => {
      const stuck = clip.imageStatus === 'generating' || clip.imageStatus === 'queued' || clip.isGeneratingImage;
      if (!stuck) return { ...clip, isGeneratingImage: false };
      return {
        ...clip,
        isGeneratingImage: false,
        imageStatus: clip.imageUrl ? 'success' : 'idle'
      };
    })
  };
}

export default function App() {
  // Initialize with the rich Space Exploration sample project
  const [project, setProject] = useState<VideoProject>(() => {
    const saved = localStorage.getItem('ai_video_current_project');
    if (saved) {
      try {
        return settleProjectImages(JSON.parse(saved));
      } catch {
        return SAMPLE_PROJECTS[0];
      }
    }
    return SAMPLE_PROJECTS[0];
  });

  const [savedProjects, setSavedProjects] = useState<VideoProject[]>(() => {
    const saved = localStorage.getItem('ai_video_saved_projects');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return SAMPLE_PROJECTS;
      }
    }
    return SAMPLE_PROJECTS;
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('script');
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(() => project.clips[0]?.id || null);
  const [isExportModalOpen, setIsExportModalOpen] = useState<boolean>(false);
  const [isGeneratingAllImages, setIsGeneratingAllImages] = useState<boolean>(false);
  const [batchGenerationProgress, setBatchGenerationProgress] = useState<{
    completed: number;
    total: number;
    activeCount: number;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (activeTab === 'settings') {
      setIsPlaying(false);
    }
  }, [activeTab]);

  // Update project helper
  const updateProject = useCallback((updates: Partial<VideoProject>) => {
    setProject(prev => ({
      ...prev,
      ...updates,
      updatedAt: Date.now()
    }));
  }, []);

  // Sync to local storage
  useEffect(() => {
    try {
      const toSave = settleProjectImages(project);
      const serializable: VideoProject = {
        ...toSave,
        clips: toSave.clips.map((clip) => {
          if (clip.imageUrl && clip.imageUrl.startsWith('data:') && clip.imageUrl.length > 200000) {
            return { ...clip, imageUrl: undefined };
          }
          return clip;
        })
      };
      localStorage.setItem('ai_video_current_project', JSON.stringify(serializable));
    } catch (err) {
      console.warn('[Project Persist] Failed to save current project:', err);
    }
  }, [project]);

  // Pro Editing Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in input or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      const total = project.clips.reduce((acc, c) => acc + (c.duration || 3.5), 0) || 10;

      // 1. Space: Play / Pause
      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying(prev => !prev);
      } 
      // 2. Left / Right Arrows: 0.1s step (or 1.0s with Shift)
      else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        const step = e.shiftKey ? 1.0 : 0.1;
        setCurrentTime(t => Math.max(0, Math.round((t - step) * 10) / 10));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1.0 : 0.1;
        setCurrentTime(t => Math.min(total, Math.round((t + step) * 10) / 10));
      } 
      // 3. J / K / L Pro Scrubbing
      else if (e.code === 'KeyJ') {
        e.preventDefault();
        setCurrentTime(t => Math.max(0, Math.round((t - 1.0) * 10) / 10));
      } else if (e.code === 'KeyK') {
        e.preventDefault();
        setIsPlaying(false);
      } else if (e.code === 'KeyL') {
        e.preventDefault();
        setIsPlaying(true);
      }
      // 4. Home / End
      else if (e.code === 'Home') {
        e.preventDefault();
        setCurrentTime(0);
      } else if (e.code === 'End') {
        e.preventDefault();
        setCurrentTime(total);
      }
      // 5. Cmd/Ctrl + D: Duplicate selected clip
      else if ((e.metaKey || e.ctrlKey) && e.code === 'KeyD' && selectedClipId) {
        e.preventDefault();
        const targetIndex = project.clips.findIndex(c => c.id === selectedClipId);
        if (targetIndex !== -1) {
          const source = project.clips[targetIndex];
          const duplicated: StoryboardClip = {
            ...source,
            id: `clip-${Date.now()}`,
            order: source.order + 1,
            narration: `${source.narration} (副本)`
          };
          const newClips = [...project.clips];
          newClips.splice(targetIndex + 1, 0, duplicated);
          // Re-order
          const reordered = newClips.map((c, i) => ({ ...c, order: i + 1 }));
          updateProject({ clips: reordered });
          setSelectedClipId(duplicated.id);
        }
      }
      // 6. Delete / Backspace: Delete selected clip
      else if ((e.code === 'Delete' || e.code === 'Backspace') && selectedClipId && project.clips.length > 1) {
        e.preventDefault();
        const targetIndex = project.clips.findIndex(c => c.id === selectedClipId);
        if (targetIndex !== -1) {
          const filtered = project.clips.filter(c => c.id !== selectedClipId);
          const reordered = filtered.map((c, i) => ({ ...c, order: i + 1 }));
          updateProject({ clips: reordered });
          const nextSelected = reordered[Math.min(targetIndex, reordered.length - 1)]?.id || null;
          setSelectedClipId(nextSelected);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [project.clips, selectedClipId, updateProject]);

  // Cancel batch image generation
  const handleCancelGenerateAllImages = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsGeneratingAllImages(false);
    setBatchGenerationProgress(null);
    // Reset any queued or generating status back to idle
    setProject(prev => ({
      ...prev,
      clips: prev.clips.map(c => 
        (c.imageStatus === 'queued' || c.imageStatus === 'generating')
          ? { ...c, imageStatus: 'idle', isGeneratingImage: false }
          : c
      )
    }));
  }, []);

  // Generate image for a single clip with live status
  const handleGenerateSingleClipImage = useCallback(async (clipId: string) => {
    const targetClip = project.clips.find(c => c.id === clipId);
    if (!targetClip) return;

    // Set generating status
    setProject(prev => ({
      ...prev,
      clips: prev.clips.map(c => c.id === clipId ? { ...c, imageStatus: 'generating', isGeneratingImage: true, imageError: undefined } : c)
    }));

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 360000);

    try {
      const res = await fetch('/api/visual/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: targetClip.visualPrompt,
          visualStyle: project.settings.visualStyle,
          aspectRatio: project.settings.aspectRatio,
          seed: targetClip.order * 1000 + Date.now(),
          customApi: resolveImageApi(project.settings.customImageApi)
        }),
        signal: controller.signal
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.imageUrl) {
        const errorMsg = data?.diagnosis || data?.error || `HTTP ${res.status}: 生图接口未返回有效画面`;
        throw new Error(errorMsg);
      }

      setProject(prev => ({
        ...prev,
        clips: prev.clips.map(c => c.id === clipId ? {
          ...c,
          imageUrl: data.imageUrl,
          imageStatus: 'success',
          isGeneratingImage: false,
          imageError: undefined
        } : c),
        updatedAt: Date.now()
      }));
    } catch (err: any) {
      const aborted = err?.name === 'AbortError';
      setProject(prev => ({
        ...prev,
        clips: prev.clips.map(c => c.id === clipId ? {
          ...c,
          imageStatus: 'failed',
          isGeneratingImage: false,
          imageError: aborted
            ? '等待超时：供应商后台可能已出图，但接口未在时限内返回。请重试。'
            : (err?.message || '生成失败，请检查服务商 API 配置')
        } : c),
        updatedAt: Date.now()
      }));
    } finally {
      window.clearTimeout(timeoutId);
    }
  }, [project.clips, project.settings]);

  // Generate AI images for all storyboard clips in parallel with concurrency pool and status transitions
  const handleGenerateAllImages = async () => {
    if (project.clips.length === 0) return;

    // Create new abort controller
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsGeneratingAllImages(true);
    const totalClips = project.clips.length;
    setBatchGenerationProgress({ completed: 0, total: totalClips, activeCount: 0 });

    // Set initial 'queued' status for all clips
    setProject(prev => ({
      ...prev,
      clips: prev.clips.map(c => ({
        ...c,
        imageStatus: 'queued' as const,
        isGeneratingImage: false,
        imageError: undefined
      }))
    }));

    // Concurrency limit: from settings or default to 3 (optimal balance between speed and rate limits)
    const concurrency = Math.min(
      Math.max(1, resolveImageApi(project.settings.customImageApi).concurrency || 3),
      6
    );

    try {
      await runConcurrencyPool<StoryboardClip, { clipId: string; imageUrl: string }>(
        project.clips,
        async (clip: StoryboardClip, index: number, signal?: AbortSignal) => {
          const timeoutController = new AbortController();
          const timeoutId = window.setTimeout(() => timeoutController.abort(), 360000);
          const onAbort = () => timeoutController.abort();
          signal?.addEventListener('abort', onAbort);

          let res: Response;
          try {
            res = await fetch('/api/visual/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                prompt: clip.visualPrompt,
                visualStyle: project.settings.visualStyle,
                aspectRatio: project.settings.aspectRatio,
                seed: index * 1000 + Date.now(),
                customApi: resolveImageApi(project.settings.customImageApi)
              }),
              signal: timeoutController.signal
            });
          } catch (err: any) {
            if (err?.name === 'AbortError') {
              throw new Error('等待超时：供应商后台可能已出图，但接口未在时限内返回。请重试。');
            }
            throw err;
          } finally {
            window.clearTimeout(timeoutId);
            signal?.removeEventListener('abort', onAbort);
          }

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData?.diagnosis || errData?.error || `HTTP ${res.status}`);
          }

          const data = await res.json().catch(() => ({}));
          if (!data?.imageUrl) {
            throw new Error(data?.error || '生图接口未返回有效画面');
          }

          return { clipId: clip.id, imageUrl: data.imageUrl };
        },
        {
          concurrency,
          signal: controller.signal,
          getId: (clip: StoryboardClip) => clip.id,
          onItemStart: (task) => {
            setProject(prev => ({
              ...prev,
              clips: prev.clips.map(c => c.id === task.item.id ? {
                ...c,
                imageStatus: 'generating' as const,
                isGeneratingImage: true
              } : c)
            }));
          },
          onItemSuccess: (task, result) => {
            setProject(prev => ({
              ...prev,
              clips: prev.clips.map(c => c.id === task.item.id ? {
                ...c,
                imageUrl: result.imageUrl,
                imageStatus: 'success' as const,
                isGeneratingImage: false,
                imageError: undefined
              } : c),
              updatedAt: Date.now()
            }));
          },
          onItemError: (task, error) => {
            if (controller.signal.aborted) return;
            setProject(prev => ({
              ...prev,
              clips: prev.clips.map(c => c.id === task.item.id ? {
                ...c,
                imageStatus: 'failed' as const,
                isGeneratingImage: false,
                imageError: error?.message || '生成失败'
              } : c),
              updatedAt: Date.now()
            }));
          },
          onProgress: (completed, total) => {
            setBatchGenerationProgress({
              completed,
              total,
              activeCount: Math.min(concurrency, total - completed)
            });
          }
        }
      );
    } catch (err: any) {
      console.warn('Batch generation interrupted or failed:', err?.message);
    } finally {
      setIsGeneratingAllImages(false);
      abortControllerRef.current = null;
      setProject(prev => settleProjectImages(prev));
      setTimeout(() => {
        setBatchGenerationProgress(null);
      }, 2500);
    }
  };

  // Re-apply style to all clips
  const handleApplyStyleToAllClips = async () => {
    setIsGeneratingAllImages(true);
    try {
      const updatedClips = project.clips.map((clip, index) => ({
        ...clip,
        imageUrl: generateProceduralArtwork(
          clip.narration || project.topic,
          project.settings.visualStyle,
          project.settings.aspectRatio,
          index
        )
      }));
      updateProject({ clips: updatedClips });
    } finally {
      setIsGeneratingAllImages(false);
    }
  };

  // Save current project copy
  const handleSaveCurrentProject = () => {
    const newProject: VideoProject = {
      ...project,
      id: `project-${Date.now()}`,
      title: `${project.title} (副本)`,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const updated = [newProject, ...savedProjects];
    setSavedProjects(updated);
    localStorage.setItem('ai_video_saved_projects', JSON.stringify(updated));
    alert('已成功保存为新工程草稿！');
  };

  // Delete project
  const handleDeleteProject = (projectId: string) => {
    const updated = savedProjects.filter(p => p.id !== projectId);
    setSavedProjects(updated);
    localStorage.setItem('ai_video_saved_projects', JSON.stringify(updated));
  };

  return (
    <div className="flex h-screen w-screen bg-[#0a0a0d] text-zinc-100 p-2.5 sm:p-3 gap-2.5 sm:gap-3 overflow-hidden font-sans select-none">
      {/* 1. Left Primary Vertical Navigation (Sidebar Card) */}
      <SidebarNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* 2. Left Secondary Tool Drawer / Panel Card */}
      {activeTab === 'script' && (
        <ScriptPanel
          topic={project.topic}
          onTopicChange={(topic) => updateProject({ topic, title: topic ? topic.slice(0, 20) : project.title })}
          onClipsChange={(clips) => updateProject({ clips })}
          visualStyle={project.settings.visualStyle}
          customLlmApi={project.settings.customLlmApi}
          onSelectClip={setSelectedClipId}
          onOpenStoryboard={() => setActiveTab('storyboard')}
        />
      )}

      {activeTab === 'storyboard' && (
        <StoryboardPanel
          topic={project.topic}
          onTopicChange={(topic) => updateProject({ topic, title: topic ? topic.slice(0, 20) : project.title })}
          clips={project.clips}
          onClipsChange={(clips) => updateProject({ clips })}
          visualStyle={project.settings.visualStyle}
          aspectRatio={project.settings.aspectRatio}
          customImageApi={project.settings.customImageApi}
          customLlmApi={project.settings.customLlmApi}
          selectedClipId={selectedClipId}
          onSelectClip={setSelectedClipId}
          onGenerateAllImages={handleGenerateAllImages}
          onCancelGenerateAllImages={handleCancelGenerateAllImages}
          onGenerateSingleImage={handleGenerateSingleClipImage}
          isGeneratingAll={isGeneratingAllImages}
          batchProgress={batchGenerationProgress}
        />
      )}

      {activeTab === 'style' && (
        <StylePanel
          currentStyle={project.settings.visualStyle}
          onStyleChange={(style) => updateProject({ settings: { ...project.settings, visualStyle: style } })}
          onApplyStyleToAllClips={handleApplyStyleToAllClips}
          isApplying={isGeneratingAllImages}
        />
      )}

      {activeTab === 'subtitles' && (
        <SubtitlePanel
          config={project.subtitles}
          onChange={(subtitles) => updateProject({ subtitles })}
        />
      )}

      {activeTab === 'audio' && (
        <AudioPanel
          config={project.audio}
          onChange={(audio) => updateProject({ audio })}
          sampleNarrationText={project.clips[0]?.narration || project.topic}
        />
      )}

      {activeTab === 'projects' && (
        <ProjectsPanel
          currentProject={project}
          onLoadProject={(loaded) => {
            setProject(loaded);
            setCurrentTime(0);
            setIsPlaying(false);
            if (loaded.clips?.length > 0) setSelectedClipId(loaded.clips[0].id);
          }}
          savedProjects={savedProjects}
          onSaveCurrentProject={handleSaveCurrentProject}
          onDeleteProject={handleDeleteProject}
        />
      )}

      {activeTab === 'settings' ? (
        <SettingsPanel
          settings={project.settings}
          onChange={(settings) => updateProject({ settings })}
        />
      ) : (
        <main className="flex-1 flex flex-col h-full min-w-0 gap-2.5 sm:gap-3 overflow-hidden">
          <TopHeader
            title={project.title}
            onTitleChange={(title) => updateProject({ title })}
            settings={project.settings}
            onSettingsChange={(settings) => updateProject({ settings })}
            onOpenExportModal={() => {
              setIsPlaying(false);
              setIsExportModalOpen(true);
            }}
            onGenerateAll={handleGenerateAllImages}
            onCancelGenerateAll={handleCancelGenerateAllImages}
            isGeneratingAll={isGeneratingAllImages}
            batchProgress={batchGenerationProgress}
          />

          <VideoPlayerStage
            clips={project.clips}
            subtitles={project.subtitles}
            audio={project.audio}
            settings={project.settings}
            currentTime={currentTime}
            onTimeUpdate={setCurrentTime}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying(prev => !prev)}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
          />

          <TimelineBar
            clips={project.clips}
            onClipsChange={(clips) => updateProject({ clips })}
            currentTime={currentTime}
            onTimeUpdate={setCurrentTime}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying(prev => !prev)}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
          />
        </main>
      )}

      {/* 4. Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        project={project}
      />
    </div>
  );
}
