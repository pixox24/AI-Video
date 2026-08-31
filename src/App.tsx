import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VideoProject, ActiveTab, StoryboardClip, ClipsChange, StyleLibraryEntry } from './types';
import { SAMPLE_PROJECTS, DEFAULT_SUBTITLE_CONFIG, DEFAULT_AUDIO_CONFIG, resolveBgmTrackId, resolveImageApi, resolveLlmApi, resolveTtsApi } from './utils/presets';
import { resolveSubtitleFontId } from './utils/subtitleFonts';
import { applyTtsSettingsToProject, applyVoiceToProject, resolveTtsVoiceId, ttsSourceKey } from './utils/ttsCatalog';
import { hydrateActiveStylePack, localRewriteClipPrompt, presetStylePack, renderLine } from './utils/stylePack';
import {
  catalogFromPack,
  hydrateStyleShelf,
  loadStyleLibrary,
  loadStylePins,
  removeStyleLibraryEntry,
  saveStyleLibraryEntry,
  STYLE_PIN_MAX,
  toggleStylePin,
  updateStyleLibraryEntry
} from './utils/styleLibrary';
import {
  allocateSpeechTimings,
  applyNarrationTimingsToClips,
  ensureUniqueClipIds,
  isNarrationTrackFresh,
  joinClipsForTts,
  measureSpeechWindow,
  narrationSourceHash,
  newClipId,
  rebindProjectNarration,
  relinkNarrationTrack,
  repairClipSlices,
  utterancesFromClips
} from './utils/narrationTrack';
import { assembleAlignedNarration } from './utils/narrationAlignClient';
import { audioEngine } from './utils/audioEngine';

import { runConcurrencyPool } from './utils/concurrencyPool';
import { forecastScriptHash, hydrateScriptWorkspace, stylePackFingerprint } from './utils/scriptWorkspace';
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
import { StatusToastHost } from './components/StatusToastHost';
import { showStatusToast } from './utils/statusToast';
import { characterForShot, characterRefUrl, storyLeadMissingRef } from './utils/visualBible';

function settleProjectImages(project: VideoProject): VideoProject {
  const settled: VideoProject = {
    ...project,
    clips: ensureUniqueClipIds((project.clips || []).map((clip) => {
      if (clip.imageStatus === 'generating' || clip.imageStatus === 'queued') {
        return {
          ...clip,
          isGeneratingImage: false,
          imageStatus: 'idle'
        };
      }
      return { ...clip, isGeneratingImage: false };
    }))
  };
  return {
    ...settled,
    audio: {
      ...settled.audio,
      bgmTrackId: resolveBgmTrackId(settled.audio?.bgmTrackId),
      voiceCharacter: resolveTtsVoiceId(settled.audio?.voiceCharacter, resolveTtsApi(settled.settings?.customTtsApi))
    },
    subtitles: {
      ...DEFAULT_SUBTITLE_CONFIG,
      ...settled.subtitles,
      fontId: resolveSubtitleFontId(settled.subtitles)
    },
    scriptWorkspace: hydrateScriptWorkspace(settled),
    settings: {
      ...settled.settings,
      activeStylePack: hydrateActiveStylePack(settled.settings)
    }
  };
}

export default function App() {
  // Initialize with the rich Space Exploration sample project
  const [project, setProject] = useState<VideoProject>(() => {
    const saved = localStorage.getItem('ai_video_current_project');
    if (saved) {
      try {
        return rebindProjectNarration(settleProjectImages(JSON.parse(saved)));
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
  const characterRefWarnOnceRef = useRef(false);

  useEffect(() => {
    if (!storyLeadMissingRef(project.scriptWorkspace?.visualBible)) {
      characterRefWarnOnceRef.current = false;
    }
  }, [project.scriptWorkspace?.visualBible]);
  const [isGeneratingNarration, setIsGeneratingNarration] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const [styleLibrary, setStyleLibrary] = useState<StyleLibraryEntry[]>(() => loadStyleLibrary());
  const [stylePins, setStylePins] = useState<string[]>(() => loadStylePins());

  const isImmersiveTab = activeTab === 'settings' || activeTab === 'script';

  useEffect(() => {
    if (isImmersiveTab) {
      setIsPlaying(false);
    }
  }, [isImmersiveTab]);

  // Sync the active TTS provider into the audio engine for preview & playback
  useEffect(() => {
    audioEngine.setTtsApi(resolveTtsApi(project.settings.customTtsApi));
  }, [project.settings.customTtsApi]);

  // Existing VO files have no stored speech window; trim leading/trailing silence once.
  useEffect(() => {
    const track = project.audio?.narrationTrack;
    if (!track?.audioUrl || typeof track.speechStart === 'number' || track.alignment?.version === 2) return;
    let cancelled = false;
    const audioUrl = track.audioUrl;
    void measureSpeechWindow(audioUrl).then((window) => {
      if (cancelled) return;
      setProject((prev) => {
        const current = prev.audio?.narrationTrack;
        if (!current || current.audioUrl !== audioUrl || typeof current.speechStart === 'number') return prev;
        const repaired = repairClipSlices(prev.clips);
        const timings = allocateSpeechTimings(repaired, window.duration, window);
        return {
          ...prev,
          clips: applyNarrationTimingsToClips(repaired, timings),
          audio: {
            ...prev.audio,
            narrationTrack: {
              ...current,
              duration: window.duration,
              speechStart: window.speechStart,
              speechEnd: window.speechEnd,
              clips: timings
            }
          },
          updatedAt: Date.now()
        };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [project.audio?.narrationTrack?.audioUrl, project.audio?.narrationTrack?.speechStart]);

  // Update project helper
  const updateProject = useCallback((updates: Partial<VideoProject>) => {
    setProject(prev => ({
      ...prev,
      ...updates,
      updatedAt: Date.now()
    }));
  }, []);

  const applyClipsChange = useCallback((clipsOrUpdater: ClipsChange) => {
    setProject(prev => {
      const raw = typeof clipsOrUpdater === 'function' ? clipsOrUpdater(prev.clips) : clipsOrUpdater;
      const nextClips = ensureUniqueClipIds(raw);
      const idsRepaired = nextClips.some((clip, index) => clip.id !== raw[index]?.id);
      if (!idsRepaired) {
        return { ...prev, clips: nextClips, updatedAt: Date.now() };
      }
      const linked = relinkNarrationTrack(prev.audio?.narrationTrack, nextClips);
      return {
        ...prev,
        clips: linked?.clips || nextClips,
        audio: linked ? { ...prev.audio, narrationTrack: linked.track } : prev.audio,
        updatedAt: Date.now()
      };
    });
  }, []);

  const handleGenerateFullNarration = useCallback(async (clipsOverride?: StoryboardClip[]) => {
    // onClick passes a mouse event; only an actual clip array may override.
    const sourceClips = Array.isArray(clipsOverride) ? clipsOverride : project.clips;
    if (!joinClipsForTts(sourceClips)) {
      const message = '请先在分镜里填写旁白文案';
      setNarrationError(message);
      showStatusToast(message, { tone: 'warn', id: 'narration' });
      return;
    }

    setIsPlaying(false);
    setIsGeneratingNarration(true);
    setNarrationError(null);
    showStatusToast('正在按句合成旁白并对齐画面', { tone: 'progress', id: 'narration', durationMs: 0 });
    audioEngine.stopFullNarration();
    audioEngine.stopNarration();

    try {
      const repaired = ensureUniqueClipIds(repairClipSlices(sourceClips));
      const utterances = utterancesFromClips(repaired);
      const res = await fetch('/api/audio/tts-utterances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          utterances: utterances.map((item) => ({ text: item.text })),
          clips: repaired.map((clip) => ({
            id: clip.id,
            narration: clip.narration,
            voRole: clip.voRole,
            voSlice: clip.voSlice
          })),
          character: project.audio.voiceCharacter,
          rate: project.audio.speechRate,
          ttsApi: resolveTtsApi(project.settings.customTtsApi)
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data?.segments) || data.segments.length === 0) {
        throw new Error(data?.error || `按句旁白合成失败 (HTTP ${res.status})`);
      }

      const assembled = await assembleAlignedNarration(repaired, data.segments);
      const storeRes = await fetch('/api/audio/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: assembled.wavDataUrl })
      });
      const stored = await storeRes.json().catch(() => ({}));
      const audioUrl = stored?.audioUrl || assembled.wavDataUrl;

      setProject((prev) => ({
        ...prev,
        clips: assembled.clips,
        audio: {
          ...prev.audio,
          narrationTrack: {
            audioUrl,
            duration: assembled.duration,
            speechStart: 0,
            speechEnd: assembled.duration,
            voiceCharacter: prev.audio.voiceCharacter,
            speechRate: prev.audio.speechRate,
            sourceHash: narrationSourceHash(
              assembled.clips,
              prev.audio.voiceCharacter,
              prev.audio.speechRate,
              ttsSourceKey(resolveTtsApi(prev.settings.customTtsApi), prev.audio.voiceCharacter)
            ),
            generatedAt: Date.now(),
            clips: assembled.timings,
            alignment: assembled.alignment
          }
        },
        updatedAt: Date.now()
      }));
      setCurrentTime(0);
      showStatusToast('旁白已更新，各镜已按真实开口对齐', { tone: 'ok', id: 'narration' });
    } catch (err: any) {
      const message = err?.message || '整段旁白合成失败';
      setNarrationError(message);
      showStatusToast(`旁白失败：${message}`, { tone: 'error', id: 'narration' });
    } finally {
      setIsGeneratingNarration(false);
    }
  }, [project.clips, project.audio.voiceCharacter, project.audio.speechRate, project.settings.customTtsApi]);

  const handleApplyStoryboard = useCallback((clips: StoryboardClip[]) => {
    const ttsApi = resolveTtsApi(project.settings.customTtsApi);
    if (isNarrationTrackFresh(project.audio, clips, ttsApi)) {
      const linked = relinkNarrationTrack(project.audio.narrationTrack, clips);
      if (linked) {
        setProject((prev) => ({
          ...prev,
          clips: linked.clips,
          audio: { ...prev.audio, narrationTrack: linked.track },
          updatedAt: Date.now()
        }));
        if (linked.clips[0]) setSelectedClipId(linked.clips[0].id);
        showStatusToast('已写入分镜，旁白沿用', { tone: 'ok', id: 'narration' });
        return;
      }
    }
    applyClipsChange(clips);
    if (clips[0]) setSelectedClipId(clips[0].id);
    void handleGenerateFullNarration(clips);
  }, [project.audio, project.settings.customTtsApi, applyClipsChange, handleGenerateFullNarration]);

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
      if (activeTab === 'settings' || activeTab === 'script') {
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
            id: newClipId(targetIndex + 1),
            order: source.order + 1,
            narration: `${source.narration} (副本)`
          };
          const newClips = [...project.clips];
          newClips.splice(targetIndex + 1, 0, duplicated);
          // Re-order
          const reordered = newClips.map((c, i) => ({ ...c, order: i + 1 }));
          applyClipsChange(reordered);
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
          applyClipsChange(reordered);
          const nextSelected = reordered[Math.min(targetIndex, reordered.length - 1)]?.id || null;
          setSelectedClipId(nextSelected);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [project.clips, selectedClipId, applyClipsChange, activeTab]);

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

  const characterRefPayload = (clip: StoryboardClip) => {
    const character = characterForShot(project.scriptWorkspace?.visualBible, clip.characterIds);
    const url = characterRefUrl(character);
    if (!url) return undefined;
    return { url, name: character?.name || '' };
  };

  const warnIfMissingLeadRef = () => {
    if (characterRefWarnOnceRef.current) return;
    if (!storyLeadMissingRef(project.scriptWorkspace?.visualBible)) return;
    characterRefWarnOnceRef.current = true;
    showStatusToast('主角还没钉参考图，这一批脸可能不稳', {
      tone: 'warn',
      id: 'character-ref-missing',
      actionLabel: '去钉图',
      onAction: () => setActiveTab('script')
    });
  };

  // Generate image for a single clip with live status
  const handleGenerateSingleClipImage = useCallback(async (clipId: string) => {
    const targetClip = project.clips.find(c => c.id === clipId);
    if (!targetClip) return;
    warnIfMissingLeadRef();

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
          styleRender: renderLine(hydrateActiveStylePack(project.settings)),
          aspectRatio: project.settings.aspectRatio,
          seed: targetClip.order * 1000 + Date.now(),
          customApi: resolveImageApi(project.settings.customImageApi),
          characterRef: characterRefPayload(targetClip)
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
  }, [project.clips, project.settings, project.scriptWorkspace]);

  // Generate AI images for all storyboard clips in parallel with concurrency pool and status transitions
  const handleGenerateAllImages = async (clipsOverride?: StoryboardClip[]) => {
    const sourceClips = Array.isArray(clipsOverride) ? clipsOverride : project.clips;
    if (sourceClips.length === 0) return;
    warnIfMissingLeadRef();

    // Create new abort controller
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsGeneratingAllImages(true);
    const totalClips = sourceClips.length;
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
        sourceClips,
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
                styleRender: renderLine(hydrateActiveStylePack(project.settings)),
                aspectRatio: project.settings.aspectRatio,
                seed: index * 1000 + Date.now(),
                customApi: resolveImageApi(project.settings.customImageApi),
                characterRef: characterRefPayload(clip)
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

  // Re-apply style to all clips via the selected image provider
  const handleApplyStyleToAllClips = (packOverride?: ReturnType<typeof hydrateActiveStylePack>) => {
    if (project.clips.length === 0) {
      showStatusToast('还没有分镜，请先写入分镜', { tone: 'warn', id: 'style-rewrite' });
      return;
    }
    const pack = packOverride || hydrateActiveStylePack(project.settings);
    showStatusToast('正在写入分镜画面词…', { tone: 'progress', id: 'style-rewrite', durationMs: 0 });
    void (async () => {
      const visualBible = project.scriptWorkspace?.visualBible;
      let rewritten = project.clips.map((clip) => {
        const local = localRewriteClipPrompt(clip, pack, visualBible);
        return {
          ...clip,
          visualPrompt: local.visualPrompt,
          chineseVisualPrompt: local.chineseVisualPrompt
        };
      });

      try {
        const res = await fetch('/api/style/rewrite-shots', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stylePack: pack,
            llmApi: resolveLlmApi(project.settings.customLlmApi),
            visualBible,
            genre: project.scriptWorkspace?.genrePackId,
            clips: project.clips.map((clip) => ({
              id: clip.id,
              narration: clip.narration,
              visualPrompt: clip.visualPrompt,
              chineseVisualPrompt: clip.chineseVisualPrompt,
              characterIds: clip.characterIds,
              locationId: clip.locationId,
              continuity: clip.continuity
            }))
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data?.shots)) {
          const byId = new Map<string, { visualPrompt?: string; chineseVisualPrompt?: string }>(
            data.shots.map((item: { id: string; visualPrompt?: string; chineseVisualPrompt?: string }) => [item.id, item])
          );
          rewritten = rewritten.map((clip) => {
            const hit = byId.get(clip.id);
            if (!hit?.visualPrompt) return clip;
            return {
              ...clip,
              visualPrompt: hit.visualPrompt,
              chineseVisualPrompt: hit.chineseVisualPrompt || clip.chineseVisualPrompt
            };
          });
        }
      } catch {
        // keep local rewrite
      }

      const workspace = project.scriptWorkspace;
      updateProject({
        clips: rewritten,
        scriptWorkspace: workspace
          ? {
              ...workspace,
              appliedAt: Date.now(),
              appliedShotCount: workspace.appliedShotCount || rewritten.length,
              appliedScriptHash: workspace.appliedScriptHash || forecastScriptHash(workspace.forecastShots),
              appliedStyleFingerprint: stylePackFingerprint(pack)
            }
          : workspace
      });
      showStatusToast('画面词已写入分镜，尚未生图', {
        tone: 'ok',
        id: 'style-rewrite',
        durationMs: 8000,
        actionLabel: '去分镜表',
        onAction: () => setActiveTab('storyboard')
      });
    })();
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
    showStatusToast('已保存为新工程草稿', { tone: 'ok' });
  };

  // Delete project
  const handleDeleteProject = (projectId: string) => {
    const updated = savedProjects.filter(p => p.id !== projectId);
    setSavedProjects(updated);
    localStorage.setItem('ai_video_saved_projects', JSON.stringify(updated));
  };

  return (
    <div className="flex h-screen w-screen bg-[#0a0a0d] text-zinc-100 p-2.5 sm:p-3 gap-2.5 sm:gap-3 overflow-hidden font-sans select-none">
      <StatusToastHost />
      {/* 1. Left Primary Vertical Navigation (Sidebar Card) */}
      <SidebarNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === 'storyboard' && (
        <StoryboardPanel
          topic={project.topic}
          onTopicChange={(topic) => updateProject({ topic, title: topic ? topic.slice(0, 20) : project.title })}
          clips={project.clips}
          onClipsChange={applyClipsChange}
          visualStyle={project.settings.visualStyle}
          aspectRatio={project.settings.aspectRatio}
          customImageApi={project.settings.customImageApi}
          customLlmApi={resolveLlmApi(project.settings.customLlmApi)}
          selectedClipId={selectedClipId}
          onSelectClip={setSelectedClipId}
          onGenerateAllImages={handleGenerateAllImages}
          onCancelGenerateAllImages={handleCancelGenerateAllImages}
          onGenerateSingleImage={handleGenerateSingleClipImage}
          isGeneratingAll={isGeneratingAllImages}
          batchProgress={batchGenerationProgress}
          onRegenerateNarration={() => { void handleGenerateFullNarration(); }}
          isGeneratingNarration={isGeneratingNarration}
          narrationFresh={isNarrationTrackFresh(project.audio, project.clips, resolveTtsApi(project.settings.customTtsApi))}
        />
      )}

      {activeTab === 'style' && (
        <StylePanel
          currentStyle={project.settings.visualStyle}
          activePack={hydrateActiveStylePack(project.settings)}
          library={styleLibrary}
          pinnedIds={stylePins}
          hiddenPresetIds={hydrateStyleShelf(project.settings.styleShelf).hiddenPresetIds}
          appliedToStoryboard={Boolean(
            project.clips.length >= 2
            && project.scriptWorkspace?.appliedStyleFingerprint
            && project.scriptWorkspace.appliedStyleFingerprint === stylePackFingerprint(hydrateActiveStylePack(project.settings))
          )}
          currentInLibrary={styleLibrary.some((item) => item.id === hydrateActiveStylePack(project.settings).id)}
          onSelectPreset={(style) => updateProject({
            settings: {
              ...project.settings,
              visualStyle: style,
              activeStylePack: presetStylePack(style)
            }
          })}
          onSelectLibrary={(entry) => updateProject({
            settings: {
              ...project.settings,
              visualStyle: entry.nearestVisualStyle,
              activeStylePack: entry.pack
            }
          })}
          onDeleteLibrary={(id) => {
            const next = removeStyleLibraryEntry(id);
            setStyleLibrary(next);
            setStylePins(loadStylePins());
            if (project.settings.activeStylePack?.id === id) {
              updateProject({
                settings: {
                  ...project.settings,
                  visualStyle: 'cinematic',
                  activeStylePack: presetStylePack('cinematic')
                }
              });
            }
            showStatusToast('已从风格栏移除', { tone: 'ok', id: 'style-library' });
          }}
          onRenameLibrary={(id, title) => {
            const next = updateStyleLibraryEntry(id, { title });
            setStyleLibrary(next);
            const hit = next.find((item) => item.id === id);
            if (hit && project.settings.activeStylePack?.id === id) {
              updateProject({
                settings: {
                  ...project.settings,
                  activeStylePack: hit.pack
                }
              });
            }
          }}
          onTogglePin={(id) => {
            const result = toggleStylePin(id);
            setStylePins(result.pins);
            if (!result.ok) {
              showStatusToast(`最多钉 ${STYLE_PIN_MAX} 张常用世界`, { tone: 'warn', id: 'style-shelf' });
            }
          }}
          onToggleHiddenPreset={(id) => {
            const shelf = hydrateStyleShelf(project.settings.styleShelf);
            const hidden = shelf.hiddenPresetIds.includes(id)
              ? shelf.hiddenPresetIds.filter((item) => item !== id)
              : [...shelf.hiddenPresetIds, id];
            updateProject({
              settings: {
                ...project.settings,
                styleShelf: { hiddenPresetIds: hidden }
              }
            });
          }}
          onSaveCurrentToLibrary={() => {
            const pack = hydrateActiveStylePack(project.settings);
            if (styleLibrary.some((item) => item.id === pack.id)) {
              showStatusToast('已在我的世界', { tone: 'ok', id: 'style-library' });
              return;
            }
            const catalog = catalogFromPack(pack);
            const result = saveStyleLibraryEntry({
              pack,
              title: catalog.title,
              tags: catalog.tags,
              blurb: catalog.blurb,
              thumbDataUrl: pack.reference?.thumbDataUrl,
              imageHash: pack.reference?.imageId,
              nearestVisualStyle: project.settings.visualStyle,
              forceNew: pack.source === 'preset' || !pack.reference?.imageId
            });
            if (result.ok === false) {
              if (result.reason === 'full') {
                showStatusToast('风格栏已满，请先删一张', { tone: 'warn', id: 'style-library' });
              } else {
                showStatusToast(`这张图已入库为「${result.existing.title}」`, { tone: 'warn', id: 'style-library' });
              }
              return;
            }
            setStyleLibrary(loadStyleLibrary());
            updateProject({
              settings: {
                ...project.settings,
                visualStyle: result.entry.nearestVisualStyle,
                activeStylePack: result.entry.pack
              }
            });
            showStatusToast(`已另存到我的世界：${result.entry.title}`, { tone: 'ok', id: 'style-library' });
          }}
          onApplyStyleToAllClips={handleApplyStyleToAllClips}
          isApplying={isGeneratingAllImages}
          hasClips={project.clips.length >= 2}
          onOpenSettings={() => setActiveTab('settings')}
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
          narrationFresh={isNarrationTrackFresh(project.audio, project.clips, resolveTtsApi(project.settings.customTtsApi))}
          isGeneratingNarration={isGeneratingNarration}
          narrationError={narrationError}
          onGenerateFullNarration={() => { void handleGenerateFullNarration(); }}
          recommendedGenre={project.scriptWorkspace?.genrePackId || null}
          timelinePlaying={isPlaying}
          ttsApi={resolveTtsApi(project.settings.customTtsApi)}
          onVoiceChange={(voiceId) => updateProject(applyVoiceToProject(project, voiceId))}
          onOpenSettings={() => setActiveTab('settings')}
        />
      )}

      {activeTab === 'projects' && (
        <ProjectsPanel
          currentProject={project}
          onLoadProject={(loaded) => {
            const next = rebindProjectNarration(settleProjectImages(loaded));
            setProject(next);
            setCurrentTime(0);
            setIsPlaying(false);
            if (next.clips?.length > 0) setSelectedClipId(next.clips[0].id);
          }}
          savedProjects={savedProjects}
          onSaveCurrentProject={handleSaveCurrentProject}
          onDeleteProject={handleDeleteProject}
        />
      )}

      {activeTab === 'settings' ? (
        <SettingsPanel
          settings={project.settings}
          onChange={(settings) => updateProject(applyTtsSettingsToProject(project, settings))}
          hasStoryboardClips={project.clips.length >= 2}
          onApplyStyleToExistingClips={handleApplyStyleToAllClips}
          onLibraryChange={setStyleLibrary}
          onOpenStylePanel={() => setActiveTab('style')}
        />
      ) : activeTab === 'script' ? (
        <ScriptPanel
          workspace={project.scriptWorkspace || hydrateScriptWorkspace(project)}
          onChange={(scriptWorkspace) => updateProject({ scriptWorkspace })}
          onTopicChange={(topic) => updateProject({ topic, title: topic ? topic.slice(0, 20) : project.title })}
          onClipsChange={applyClipsChange}
          existingClips={project.clips}
          visualStyle={project.settings.visualStyle}
          stylePack={hydrateActiveStylePack(project.settings)}
          aspectRatio={project.settings.aspectRatio}
          customLlmApi={resolveLlmApi(project.settings.customLlmApi)}
          customTtsApi={resolveTtsApi(project.settings.customTtsApi)}
          voiceCharacter={project.audio.voiceCharacter}
          speechRate={project.audio.speechRate}
          onSelectClip={setSelectedClipId}
          onOpenStoryboard={() => setActiveTab('storyboard')}
          onNeedFullNarration={handleApplyStoryboard}
          onApplyStyleOnly={handleApplyStyleToAllClips}
          isApplyingStyle={isGeneratingAllImages}
          isGeneratingNarration={isGeneratingNarration}
          narrationError={narrationError}
          narrationFresh={isNarrationTrackFresh(project.audio, project.clips, resolveTtsApi(project.settings.customTtsApi))}
          onRecommendBgm={(trackId) => {
            updateProject({
              audio: project.audio.bgmTrackId === 'custom-uploaded'
                ? project.audio
                : { ...project.audio, bgmEnabled: true, bgmTrackId: trackId }
            });
          }}
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
            isGeneratingNarration={isGeneratingNarration}
            narrationError={narrationError}
          />

          <TimelineBar
            clips={project.clips}
            onClipsChange={applyClipsChange}
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
