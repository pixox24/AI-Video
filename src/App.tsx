import React, { useState, useEffect, useCallback, useRef } from 'react';
import { VideoProject, ActiveTab, StoryboardClip, ClipsChange, StyleLibraryEntry, ProjectLibraryItem, OutroConfig } from './types';
import { clampOutro, resolveOutro } from './utils/outro';
import { SAMPLE_PROJECTS, DEFAULT_SUBTITLE_CONFIG, DEFAULT_AUDIO_CONFIG, resolveBgmTrackId, resolveImageApi, isImageApiReady, resolveLlmApi, resolveTtsApi } from './utils/presets';
import { generateImageWithRetry } from './utils/imageGenerateClient';
import { classifyImageError } from './utils/imageGenerateRetry';
import { defaultFontIdForScript, resolveSecondarySubtitleFontId, resolveSubtitleFontId, studioFontById } from './utils/subtitleFonts';
import { normalizeScriptLanguage } from './utils/scriptLanguage';
import { applyTtsSettingsToProject, applyVoiceToProject, bailianTtsConcurrency, customVoiceBelongsToModel, isEnrollmentVoiceId, resolveTtsVoiceId, ttsSourceKey } from './utils/ttsCatalog';
import { findDesignedVoice } from './utils/voiceLibrary';
import { hydrateActiveStylePack, localRewriteClipPrompt, presetStylePack, renderLine } from './utils/stylePack';
import { beatToChinese, clipImagePromptArgs } from './utils/imagePrompt';
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
import { assembleAlignedNarration, reassembleNarrationWithHolds } from './utils/narrationAlignClient';
import {
  clampSentenceGap,
  narrationFileIncludesHolds,
  resolveSentenceGap,
  stampSentenceGaps
} from './utils/sentenceGap';
import { audioEngine } from './utils/audioEngine';
import { setPlayhead } from './utils/playhead';

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
import { ConfirmDialog } from './components/ConfirmDialog';
import {
  createBlankProject,
  fetchDiskCurrentProject,
  fetchPreviousProject,
  isSampleProjectId,
  projectHasLocalWork,
  getPersistSnapshot,
  rememberSaveRevision,
  RESET_TO_SAMPLE_KEY,
  stashPreviousProject,
  writeCurrentProject,
  writeDiskCurrentProject
} from './utils/projectPersist';
import {
  captureAppSettingsIfEmpty,
  mergeAppSettings,
  persistAppSettingsFromProject
} from './utils/appSettings';
import {
  copyTemplateProject,
  createLibraryProject,
  deleteLibraryProject,
  duplicateLibraryProject,
  fetchLibraryProject,
  fetchProjectLibrary,
  migrateBrowserCopiesToLibrary
} from './utils/projectLibrary';
import { createEditHistory } from './utils/editHistory';
import { characterForShot, characterRefUrl, storyLeadMissingRef, isVisualBibleStale, visualBibleHasBlockingWarnings } from './utils/visualBible';

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
  const sentenceGap = resolveSentenceGap(settled.audio);
  const outroHold = resolveOutro(settled.settings).hold;
  return {
    ...settled,
    clips: stampSentenceGaps(ensureUniqueClipIds(settled.clips || []), sentenceGap, outroHold),
    audio: {
      ...settled.audio,
      sentenceGap,
      bgmTrackId: resolveBgmTrackId(settled.audio?.bgmTrackId),
      voiceCharacter: resolveTtsVoiceId(settled.audio?.voiceCharacter, resolveTtsApi(settled.settings?.customTtsApi))
    },
    subtitles: (() => {
      const spoken = normalizeScriptLanguage(settled.scriptWorkspace?.scriptLanguage);
      const fontId = resolveSubtitleFontId(settled.subtitles);
      const hasSecondary = Boolean(settled.subtitles?.secondaryFontId);
      let secondaryFontId = resolveSecondarySubtitleFontId(settled.subtitles);
      if (!hasSecondary && spoken === 'en') secondaryFontId = defaultFontIdForScript('cjk');
      const alignedPrimary = spoken === 'en' && studioFontById(fontId).id === 'system-cjk'
        ? defaultFontIdForScript('latin')
        : fontId;
      return {
        ...DEFAULT_SUBTITLE_CONFIG,
        ...settled.subtitles,
        fontId: alignedPrimary,
        secondaryFontId
      };
    })(),
    scriptWorkspace: hydrateScriptWorkspace(settled),
    settings: {
      ...settled.settings,
      activeStylePack: hydrateActiveStylePack(settled.settings)
    }
  };
}

function hydratePersistedProject(raw: VideoProject): VideoProject {
  return mergeAppSettings(rebindProjectNarration(settleProjectImages(raw)));
}

export default function App() {
  // Initialize with the rich Space Exploration sample project
  const [project, setProject] = useState<VideoProject>(() => {
    const saved = localStorage.getItem('ai_video_current_project');
    if (saved) {
      try {
        return hydratePersistedProject(JSON.parse(saved));
      } catch {
        return hydratePersistedProject(SAMPLE_PROJECTS[0]);
      }
    }
    return hydratePersistedProject(SAMPLE_PROJECTS[0]);
  });

  const [libraryItems, setLibraryItems] = useState<ProjectLibraryItem[]>([]);

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
  const historyRef = useRef(createEditHistory());
  const skipHistoryRef = useRef(false);
  const [persistReady, setPersistReady] = useState(false);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    detail: string;
    confirmLabel: string;
    action: () => void | Promise<void>;
  } | null>(null);
  const bootUpdatedAtRef = useRef(project.updatedAt);
  const [historyVersion, setHistoryVersion] = useState(0);
  const characterRefWarnOnceRef = useRef(false);
  const projectRef = useRef(project);
  projectRef.current = project;
  const bakeTimerRef = useRef<number | null>(null);
  const bakeGenRef = useRef(0);
  const autoBakedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!storyLeadMissingRef(project.scriptWorkspace?.visualBible)) {
      characterRefWarnOnceRef.current = false;
    }
  }, [project.scriptWorkspace?.visualBible]);
  const [isGeneratingNarration, setIsGeneratingNarration] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);
  const [styleLibrary, setStyleLibrary] = useState<StyleLibraryEntry[]>(() => loadStyleLibrary());
  const [stylePins, setStylePins] = useState<string[]>(() => loadStylePins());

  useEffect(() => {
    if (activeTab === 'settings') {
      setIsPlaying(false);
    }
  }, [activeTab]);

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
          clips: applyNarrationTimingsToClips(repaired, timings, resolveSentenceGap(prev.audio)),
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

  const bumpHistory = useCallback(() => {
    setHistoryVersion((value) => value + 1);
  }, []);

  const recordHistory = useCallback((snapshot: VideoProject) => {
    if (skipHistoryRef.current) return;
    historyRef.current.push(snapshot);
    bumpHistory();
  }, [bumpHistory]);

  const handleUndo = useCallback(() => {
    setProject((current) => {
      const next = historyRef.current.undo(current);
      return next || current;
    });
    bumpHistory();
  }, [bumpHistory]);

  const handleRedo = useCallback(() => {
    setProject((current) => {
      const next = historyRef.current.redo(current);
      return next || current;
    });
    bumpHistory();
  }, [bumpHistory]);

  // Update project helper
  const updateProject = useCallback((updates: Partial<VideoProject>, opts?: { history?: boolean }) => {
    setProject(prev => {
      if (opts?.history !== false) recordHistory(prev);
      const next = {
        ...prev,
        ...updates,
        updatedAt: Date.now()
      };
      if (updates.settings) persistAppSettingsFromProject(next);
      return next;
    });
  }, [recordHistory]);

  const applyClipsChange = useCallback((clipsOrUpdater: ClipsChange) => {
    setProject(prev => {
      if (!skipHistoryRef.current) recordHistory(prev);
      const raw = typeof clipsOrUpdater === 'function' ? clipsOrUpdater(prev.clips) : clipsOrUpdater;
      const nextClips = ensureUniqueClipIds(raw);
      const idsRepaired = nextClips.some((clip, index) => clip.id !== raw[index]?.id);
      if (!idsRepaired) {
        return { ...prev, clips: nextClips, updatedAt: Date.now() };
      }
      const linked = relinkNarrationTrack(prev.audio?.narrationTrack, nextClips, resolveSentenceGap(prev.audio));
      return {
        ...prev,
        clips: linked?.clips || nextClips,
        audio: linked ? { ...prev.audio, narrationTrack: linked.track } : prev.audio,
        updatedAt: Date.now()
      };
    });
  }, [recordHistory]);

  const handleGenerateFullNarration = useCallback(async (clipsOverride?: StoryboardClip[]) => {
    // onClick passes a mouse event; only an actual clip array may override.
    const sourceClips = Array.isArray(clipsOverride) ? clipsOverride : project.clips;
    if (!joinClipsForTts(sourceClips)) {
      const message = '请先在分镜里填写旁白文案';
      setNarrationError(message);
      showStatusToast(message, { tone: 'warn', id: 'narration' });
      return;
    }

    const ttsForVoice = resolveTtsApi(project.settings.customTtsApi);
    const designed = findDesignedVoice(project.audio.voiceCharacter);
    if (designed && (designed.status !== 'ok' || designed.targetModel !== ttsForVoice.model)) {
      const message = designed.status === 'deploying'
        ? '这条设计音色还在审核，通过后再生成旁白'
        : '当前设计音色和设置里的 3.0 模型不一致，换模型或换一条音色';
      setNarrationError(message);
      showStatusToast(message, { tone: 'warn', id: 'narration' });
      return;
    }
    if (isEnrollmentVoiceId(project.audio.voiceCharacter) && !customVoiceBelongsToModel(project.audio.voiceCharacter, ttsForVoice.model)) {
      const message = '这条设计音色不属于当前 3.0 模型';
      setNarrationError(message);
      showStatusToast(message, { tone: 'warn', id: 'narration' });
      return;
    }

    setIsPlaying(false);
    setIsGeneratingNarration(true);
    setNarrationError(null);
    setActiveTab('storyboard');
    recordHistory(project);
    audioEngine.stopFullNarration();
    audioEngine.stopNarration();

    try {
      const repaired = ensureUniqueClipIds(repairClipSlices(sourceClips));
      const utterances = utterancesFromClips(repaired);
      const ttsApi = resolveTtsApi(project.settings.customTtsApi);
      const concurrency = bailianTtsConcurrency(ttsApi);
      showStatusToast(`正在配音 1/${utterances.length}`, { tone: 'progress', id: 'narration', durationMs: 0 });

      const pool = await runConcurrencyPool(
        utterances,
        async (utterance) => {
          const res = await fetch('/api/audio/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: utterance.text,
              character: project.audio.voiceCharacter,
              rate: project.audio.speechRate,
              ttsApi
            })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data?.audioUrl) {
            throw new Error(data?.error || `「${utterance.text.slice(0, 18)}」合成失败`);
          }
          return {
            text: utterance.text,
            audioUrl: String(data.audioUrl),
            words: Array.isArray(data.words) ? data.words : []
          };
        },
        {
          concurrency,
          getId: (item, index) => `${index}-${item.text.slice(0, 8)}`,
          onItemStart: (task) => {
            showStatusToast(
              `正在配音 ${task.index + 1}/${utterances.length}：${task.item.text.slice(0, 18)}`,
              { tone: 'progress', id: 'narration', durationMs: 0 }
            );
          }
        }
      );

      const failed = pool.find((item) => !item.ok);
      if (failed) {
        const reason = failed.error instanceof Error ? failed.error.message : String(failed.error || '');
        throw new Error(reason || '按句旁白合成失败');
      }
      const segments = pool.map((item) => item.result!).filter(Boolean);
      if (segments.length !== utterances.length) {
        throw new Error('按句旁白合成不完整');
      }

      showStatusToast('正在拼接并对齐画面…', { tone: 'progress', id: 'narration', durationMs: 0 });
      const assembled = await assembleAlignedNarration(repaired, segments, resolveSentenceGap(project.audio), resolveOutro(project.settings).hold);
      const storeRes = await fetch('/api/audio/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: assembled.wavDataUrl })
      });
      const stored = await storeRes.json().catch(() => ({}));
      const audioUrl = stored?.audioUrl || assembled.wavDataUrl;
      const actualSpeechSeconds = assembled.clips.reduce(
        (sum, clip) => sum + Math.max(0, Number(clip.speechDuration) || 0),
        0
      );

      setProject((prev) => ({
        ...prev,
        clips: assembled.clips,
        scriptWorkspace: prev.scriptWorkspace
          ? {
              ...prev.scriptWorkspace,
              durationBudget: {
                ...prev.scriptWorkspace.durationBudget,
                actualSpeechSeconds: Math.round(actualSpeechSeconds * 10) / 10,
                actualTotalSeconds: Math.round(assembled.duration * 10) / 10
              }
            }
          : prev.scriptWorkspace,
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
      setPlayhead(0);
      showStatusToast('旁白已更新，各镜已按真实开口对齐', { tone: 'ok', id: 'narration' });
    } catch (err: any) {
      const message = err?.message || '整段旁白合成失败';
      setNarrationError(message);
      showStatusToast(`旁白失败：${message}`, { tone: 'error', id: 'narration' });
    } finally {
      setIsGeneratingNarration(false);
    }
  }, [project, project.clips, project.audio.voiceCharacter, project.audio.speechRate, project.settings.customTtsApi, recordHistory]);

  const bakeNarrationHolds = useCallback(async () => {
    const current = projectRef.current;
    const track = current.audio?.narrationTrack;
    if (!track?.audioUrl || !track.alignment?.utterances?.length) return;
    const gap = resolveSentenceGap(current.audio);
    const outroHold = resolveOutro(current.settings).hold;
    const stamped = stampSentenceGaps(current.clips, gap, outroHold);
    if (narrationFileIncludesHolds(track, stamped)) return;
    const gen = ++bakeGenRef.current;
    try {
      const assembled = await reassembleNarrationWithHolds(stamped, track, gap, outroHold);
      if (!assembled || gen !== bakeGenRef.current) return;
      const storeRes = await fetch('/api/audio/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl: assembled.wavDataUrl })
      });
      const stored = await storeRes.json().catch(() => ({}));
      const audioUrl = stored?.audioUrl || assembled.wavDataUrl;
      if (gen !== bakeGenRef.current) return;
      setProject((prev) => ({
        ...prev,
        clips: assembled.clips,
        audio: {
          ...prev.audio,
          narrationTrack: {
            ...(prev.audio.narrationTrack || track),
            audioUrl,
            duration: assembled.duration,
            speechStart: 0,
            speechEnd: assembled.duration,
            clips: assembled.timings,
            alignment: assembled.alignment
          }
        },
        updatedAt: Date.now()
      }));
    } catch (err) {
      console.warn('[SentenceGap] 气口未能写入旁白文件', err);
    }
  }, []);

  const scheduleBakeHolds = useCallback(() => {
    if (bakeTimerRef.current) window.clearTimeout(bakeTimerRef.current);
    bakeTimerRef.current = window.setTimeout(() => {
      void bakeNarrationHolds();
    }, 280);
  }, [bakeNarrationHolds]);

  useEffect(() => {
    return () => {
      if (bakeTimerRef.current) window.clearTimeout(bakeTimerRef.current);
    };
  }, []);

  const handleSentenceGapChange = useCallback((seconds: number) => {
    const gap = clampSentenceGap(seconds);
    setIsPlaying(false);
    setProject((prev) => {
      recordHistory(prev);
      const outroHold = resolveOutro(prev.settings).hold;
      return {
        ...prev,
        clips: stampSentenceGaps(prev.clips, gap, outroHold),
        audio: { ...prev.audio, sentenceGap: gap },
        updatedAt: Date.now()
      };
    });
    scheduleBakeHolds();
  }, [recordHistory, scheduleBakeHolds]);

  const handleOutroChange = useCallback((config: OutroConfig) => {
    const nextOutro = clampOutro(config);
    setIsPlaying(false);
    setProject((prev) => {
      recordHistory(prev);
      const gap = resolveSentenceGap(prev.audio);
      return {
        ...prev,
        clips: stampSentenceGaps(prev.clips, gap, nextOutro.hold),
        settings: { ...prev.settings, outro: nextOutro },
        updatedAt: Date.now()
      };
    });
    scheduleBakeHolds();
  }, [recordHistory, scheduleBakeHolds]);

  const handleUtteranceHoldChange = useCallback((clipId: string, holdDuration: number, pinned: boolean) => {
    setIsPlaying(false);
    setProject((prev) => {
      recordHistory(prev);
      const gap = resolveSentenceGap(prev.audio);
      const nextClips = prev.clips.map((clip) => {
        if (clip.id !== clipId) return clip;
        const speech = clip.speechDuration ?? Math.max(0.05, (clip.duration || 0) - (clip.holdDuration || 0));
        const hold = pinned ? Math.max(0, Math.min(8, holdDuration)) : gap;
        return {
          ...clip,
          holdDuration: hold,
          holdPinned: pinned,
          duration: Math.max(0.05, Math.round((speech + hold) * 100) / 100)
        };
      });
      return { ...prev, clips: nextClips, updatedAt: Date.now() };
    });
    scheduleBakeHolds();
  }, [recordHistory, scheduleBakeHolds]);

  const handleApplyStoryboard = useCallback((clips: StoryboardClip[]) => {
    const ttsApi = resolveTtsApi(project.settings.customTtsApi);
    const sentenceGap = resolveSentenceGap(project.audio);
    const stamped = stampSentenceGaps(clips, sentenceGap);
    if (isNarrationTrackFresh(project.audio, stamped, ttsApi)) {
      const linked = relinkNarrationTrack(project.audio.narrationTrack, stamped, sentenceGap);
      if (linked) {
        setProject((prev) => ({
          ...prev,
          clips: linked.clips,
          audio: { ...prev.audio, narrationTrack: linked.track },
          updatedAt: Date.now()
        }));
        if (linked.clips[0]) setSelectedClipId(linked.clips[0].id);
        setActiveTab('storyboard');
        showStatusToast('已写入分镜，旁白沿用', { tone: 'ok', id: 'narration' });
        scheduleBakeHolds();
        return;
      }
    }
    applyClipsChange(stamped);
    if (stamped[0]) setSelectedClipId(stamped[0].id);
    setActiveTab('storyboard');
    void handleGenerateFullNarration(stamped);
  }, [project.audio, project.settings.customTtsApi, applyClipsChange, handleGenerateFullNarration, scheduleBakeHolds]);

  useEffect(() => {
    const track = project.audio?.narrationTrack;
    if (!track?.audioUrl || !track.alignment?.utterances?.length) return;
    if (narrationFileIncludesHolds(track, project.clips)) {
      autoBakedUrlRef.current = track.audioUrl;
      return;
    }
    if (autoBakedUrlRef.current === track.audioUrl) return;
    autoBakedUrlRef.current = track.audioUrl;
    scheduleBakeHolds();
  }, [project.audio?.narrationTrack?.audioUrl, scheduleBakeHolds]);

  // Hydrate from disk after first paint. Browser cache is only a fallback.
  useEffect(() => {
    let cancelled = false;
    const skipDisk = (() => {
      try {
        return sessionStorage.getItem(RESET_TO_SAMPLE_KEY) === '1';
      } catch {
        return false;
      }
    })();

    (async () => {
      try {
        if (skipDisk) return;
        const disk = await fetchDiskCurrentProject();
        if (cancelled) return;
        const local = (() => {
          try {
            const raw = localStorage.getItem('ai_video_current_project');
            return raw ? JSON.parse(raw) as VideoProject : null;
          } catch {
            return null;
          }
        })();
        if (disk?.project) {
          const live = projectRef.current;
          const userTouched = live.updatedAt !== bootUpdatedAtRef.current;
          if (userTouched) {
            await writeDiskCurrentProject(settleProjectImages(live));
          } else {
            const diskTime = Number(disk.project.updatedAt) || disk.savedAt || 0;
            const localTime = Number(local?.updatedAt) || 0;
            if (!local || !Array.isArray(local.clips) || diskTime >= localTime) {
              const next = hydratePersistedProject(disk.project);
              rememberSaveRevision(next.saveRevision);
              captureAppSettingsIfEmpty(next);
              setProject(next);
              setSelectedClipId(next.clips[0]?.id || null);
              writeCurrentProject(next);
              if (!local || local.id !== next.id) {
                showStatusToast('已从磁盘恢复工程', { tone: 'ok', id: 'persist-restore' });
              }
            } else {
              await writeDiskCurrentProject(settleProjectImages(local));
            }
          }
        } else if (local && Array.isArray(local.clips)) {
          await writeDiskCurrentProject(settleProjectImages(local));
        }
      } catch (err) {
        console.warn('[Project Persist] Hydrate from disk failed:', err);
      } finally {
        if (!cancelled) {
          captureAppSettingsIfEmpty(projectRef.current);
          setPersistReady(true);
          void migrateBrowserCopiesToLibrary().then((count) => {
            if (count > 0) {
              showStatusToast(`已把 ${count} 份浏览器草稿迁进工程库`, { tone: 'ok', id: 'library-migrate' });
            }
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshLibrary = useCallback(async () => {
    const { items } = await fetchProjectLibrary();
    setLibraryItems(items);
  }, []);

  useEffect(() => {
    if (!persistReady) return;
    void refreshLibrary();
  }, [persistReady, refreshLibrary]);

  // Sync to local storage, session file, and project library
  useEffect(() => {
    if (!persistReady) return;
    if (isSampleProjectId(project.id) && projectHasLocalWork(project)) {
      setProject((prev) => (
        isSampleProjectId(prev.id) ? { ...prev, id: `project-${prev.updatedAt}` } : prev
      ));
      return;
    }
    const timer = window.setTimeout(() => {
      const settled = settleProjectImages(project);
      writeCurrentProject(settled);
      void writeDiskCurrentProject(settled).then((ok) => {
        if (ok) {
          try {
            sessionStorage.removeItem(RESET_TO_SAMPLE_KEY);
          } catch {
            // ignore
          }
          void refreshLibrary();
        }
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [project, persistReady, refreshLibrary]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const status = getPersistSnapshot().status;
      if (status === 'error' || status === 'saving') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Pro Editing Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in input or textarea
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyY') {
        e.preventDefault();
        handleRedo();
        return;
      }

      if (activeTab === 'settings') return;

      const total = project.clips.reduce((acc, c) => acc + (c.duration || 3.5), 0) || 10;

      // Script desk: space toggles preview when not typing.
      if (activeTab === 'script') {
        if (e.code === 'Space' && project.clips.length > 0) {
          e.preventDefault();
          setIsPlaying((prev) => !prev);
        }
        return;
      }

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
  }, [project.clips, selectedClipId, applyClipsChange, activeTab, handleUndo, handleRedo]);

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

  const visualBibleGenerationBlocked = () => {
    const workspace = project.scriptWorkspace;
    const bible = workspace?.visualBible;
    if (!bible) return false;
    if (isVisualBibleStale(bible, workspace?.fullNarration || '', workspace?.genrePackId)) {
      showStatusToast('口播已改，先按当前文案重编画面圣经', {
        tone: 'warn', id: 'visual-bible-stale', actionLabel: '去重编', onAction: () => setActiveTab('script')
      });
      return true;
    }
    if (visualBibleHasBlockingWarnings(bible)) {
      showStatusToast('画面圣经与文案存在角色冲突，请先修正后再生图', {
        tone: 'warn', id: 'visual-bible-conflict', actionLabel: '去核对', onAction: () => setActiveTab('script')
      });
      return true;
    }
    return false;
  };

  const compiledPromptFor = (clip: StoryboardClip, index: number, clips = project.clips) => {
    return clipImagePromptArgs(
      clip,
      index,
      clips.length,
      hydrateActiveStylePack(project.settings),
      project.scriptWorkspace?.visualBible,
      project.settings,
      project.scriptWorkspace?.genrePackId
    );
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
    if (visualBibleGenerationBlocked()) return;
    if (!isImageApiReady(project.settings.customImageApi)) {
      showStatusToast('请先在设置里配置生图供应商和 API Key', { tone: 'warn', id: 'image-api' });
      setActiveTab('settings');
      return;
    }
    recordHistory(project);
    warnIfMissingLeadRef();

    // Set generating status
    setProject(prev => ({
      ...prev,
      clips: prev.clips.map(c => c.id === clipId ? { ...c, imageStatus: 'generating', isGeneratingImage: true, imageError: undefined } : c)
    }));

    const controller = new AbortController();
    const clipIndex = Math.max(0, project.clips.findIndex((item) => item.id === clipId));
    const compiled = compiledPromptFor(targetClip, clipIndex);

    try {
      const result = await generateImageWithRetry(
        {
          prompt: compiled.prompt,
          visualStyle: project.settings.visualStyle,
          styleRender: renderLine(hydrateActiveStylePack(project.settings)),
          aspectRatio: project.settings.aspectRatio,
          seed: targetClip.order * 1000 + Date.now(),
          characterRef: characterRefPayload(targetClip)
        },
        {
          primary: project.settings.customImageApi,
          backup: project.settings.backupImageApi,
          retry: project.settings.imageRetry,
          signal: controller.signal,
          onAttempt: ({ attempt, max, usingBackup }) => {
            setProject((prev) => ({
              ...prev,
              clips: prev.clips.map((c) => c.id === clipId ? {
                ...c,
                imageError: usingBackup ? '主通道失败，改走备用…' : `自动重试 ${attempt}/${max}`
              } : c)
            }));
          }
        }
      );

      setProject(prev => ({
        ...prev,
        clips: prev.clips.map(c => c.id === clipId ? {
          ...c,
          imageUrl: result.imageUrl,
          imageStatus: 'success',
          isGeneratingImage: false,
          imageError: result.usedBackup ? '备用通道出图' : undefined,
          referenceStatus: result.referenceAccepted ? 'accepted' : result.referenceDropped ? 'dropped' : undefined,
          visualPrompt: c.promptPinned ? c.visualPrompt : compiled.prompt,
          visualBibleHash: c.promptPinned ? c.visualBibleHash : project.scriptWorkspace?.visualBible?.sourceHash,
          visualBeat: c.visualBeat || compiled.beat,
          chineseVisualPrompt: c.chineseVisualPrompt || beatToChinese(compiled.beat)
        } : c),
        updatedAt: Date.now()
      }));
    } catch (err: any) {
      const aborted = err?.name === 'AbortError' || err?.message === '已停止';
      setProject(prev => ({
        ...prev,
        clips: prev.clips.map(c => c.id === clipId ? {
          ...c,
          imageStatus: 'failed',
          isGeneratingImage: false,
          imageError: aborted
            ? (err?.message === '已停止' ? '已停止' : '等待超时：供应商后台可能已出图，但接口未在时限内返回。请重试。')
            : `${err?.message || '生成失败，请检查服务商 API 配置'}${err?.referenceDropped ? '；参考图未采用' : ''}`,
          referenceStatus: err?.referenceDropped ? 'dropped' : undefined
        } : c),
        updatedAt: Date.now()
      }));
    }
  }, [project.clips, project.settings, project.scriptWorkspace, project, recordHistory]);

  // Generate AI images for all storyboard clips in parallel with concurrency pool and status transitions
  const handleGenerateAllImages = async (clipsOverride?: StoryboardClip[]) => {
    const sourceClips = Array.isArray(clipsOverride) ? clipsOverride : project.clips;
    if (sourceClips.length === 0) return;
    if (visualBibleGenerationBlocked()) return;
    if (!isImageApiReady(project.settings.customImageApi)) {
      showStatusToast('请先在设置里配置生图供应商和 API Key', { tone: 'warn', id: 'image-api' });
      setActiveTab('settings');
      return;
    }
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
    const targetIds = new Set(sourceClips.map((clip) => clip.id));

    setProject(prev => {
      recordHistory(prev);
      return {
        ...prev,
        clips: prev.clips.map(c => targetIds.has(c.id) ? {
          ...c,
          imageStatus: 'queued' as const,
          isGeneratingImage: false,
          imageError: undefined
        } : c)
      };
    });
    skipHistoryRef.current = true;

    // Concurrency limit: from settings or default to 3 (optimal balance between speed and rate limits)
    const concurrency = Math.min(
      Math.max(1, resolveImageApi(project.settings.customImageApi).concurrency || 3),
      6
    );

    try {
      const runShot = async (clip: StoryboardClip, index: number, signal?: AbortSignal) => {
        const compiled = compiledPromptFor(clip, Math.max(0, project.clips.findIndex((item) => item.id === clip.id)));
        const result = await generateImageWithRetry(
          {
            prompt: compiled.prompt,
            visualStyle: project.settings.visualStyle,
            styleRender: renderLine(hydrateActiveStylePack(project.settings)),
            aspectRatio: project.settings.aspectRatio,
            seed: index * 1000 + Date.now(),
            characterRef: characterRefPayload(clip)
          },
          {
            primary: project.settings.customImageApi,
            backup: project.settings.backupImageApi,
            retry: project.settings.imageRetry,
            signal,
            onAttempt: ({ attempt, max, usingBackup }) => {
              setProject((prev) => ({
                ...prev,
                clips: prev.clips.map((c) => c.id === clip.id ? {
                  ...c,
                  imageError: usingBackup ? '主通道失败，改走备用…' : `自动重试 ${attempt}/${max}`
                } : c)
              }));
            }
          }
        );
        return {
          clipId: clip.id,
          imageUrl: result.imageUrl,
          prompt: compiled.prompt,
          beat: compiled.beat,
          usedBackup: result.usedBackup,
          referenceStatus: result.referenceAccepted ? 'accepted' as const : result.referenceDropped ? 'dropped' as const : undefined
        };
      };

      const poolOptions = {
        concurrency,
        signal: controller.signal,
        getId: (clip: StoryboardClip) => clip.id,
        onItemStart: (task: { item: StoryboardClip }) => {
          setProject(prev => ({
            ...prev,
            clips: prev.clips.map(c => c.id === task.item.id ? {
              ...c,
              imageStatus: 'generating' as const,
              isGeneratingImage: true
            } : c)
          }));
        },
        onItemSuccess: (task: { item: StoryboardClip }, result: { imageUrl: string; prompt: string; beat: StoryboardClip['visualBeat']; usedBackup: boolean; referenceStatus?: 'accepted' | 'dropped' }) => {
          setProject(prev => ({
            ...prev,
            clips: prev.clips.map(c => c.id === task.item.id ? {
              ...c,
              imageUrl: result.imageUrl,
              visualPrompt: c.promptPinned ? c.visualPrompt : result.prompt,
              visualBibleHash: c.promptPinned ? c.visualBibleHash : project.scriptWorkspace?.visualBible?.sourceHash,
              visualBeat: c.visualBeat || result.beat,
              chineseVisualPrompt: c.chineseVisualPrompt || beatToChinese(result.beat || {}),
              imageStatus: 'success' as const,
              isGeneratingImage: false,
              imageError: result.usedBackup ? '备用通道出图' : undefined,
              referenceStatus: result.referenceStatus
            } : c),
            updatedAt: Date.now()
          }));
        },
        onItemError: (task: { item: StoryboardClip }, error: any) => {
          if (controller.signal.aborted) return;
          setProject(prev => ({
            ...prev,
            clips: prev.clips.map(c => c.id === task.item.id ? {
              ...c,
              imageStatus: 'failed' as const,
              isGeneratingImage: false,
              imageError: `${error?.message || '生成失败'}${error?.referenceDropped ? '；参考图未采用' : ''}`,
              referenceStatus: error?.referenceDropped ? 'dropped' : undefined
            } : c),
            updatedAt: Date.now()
          }));
        },
        onProgress: (completed: number, total: number) => {
          setBatchGenerationProgress({
            completed,
            total,
            activeCount: Math.min(concurrency, total - completed)
          });
        }
      };

      const firstPass = await runConcurrencyPool(sourceClips, runShot, poolOptions);
      if (!controller.signal.aborted) {
        const leftover = firstPass
          .filter((item) => !item.ok)
          .filter((item) => {
            const kind = classifyImageError(item.error, false);
            return kind === 'retry' || kind === 'timeout' || kind === 'ratelimit' || kind === 'unsupported';
          })
          .map((item) => sourceClips.find((clip) => clip.id === item.id))
          .filter((clip): clip is StoryboardClip => Boolean(clip));
        if (leftover.length > 0) {
          showStatusToast(`还有 ${leftover.length} 镜失败，正在再收一口`, { tone: 'progress', id: 'image-sweep' });
          leftover.forEach((clip) => {
            setProject((prev) => ({
              ...prev,
              clips: prev.clips.map((c) => c.id === clip.id ? { ...c, imageStatus: 'queued' as const, isGeneratingImage: false } : c)
            }));
          });
          await runConcurrencyPool(leftover, runShot, poolOptions);
        }
        showStatusToast('画面生成结束', { tone: leftover.length ? 'warn' : 'ok', id: 'image-sweep' });
      }
    } catch (err: any) {
      console.warn('Batch generation interrupted or failed:', err?.message);
    } finally {
      skipHistoryRef.current = false;
      setIsGeneratingAllImages(false);
      abortControllerRef.current = null;
      setProject(prev => settleProjectImages(prev));
      setTimeout(() => {
        setBatchGenerationProgress(null);
      }, 2500);
    }
  };

  const handleRetryFailedImages = () => {
    const failed = project.clips.filter((clip) => clip.imageStatus === 'failed');
    if (failed.length === 0) return;
    void handleGenerateAllImages(failed);
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
      let rewritten = project.clips.map((clip, index) => {
        const local = localRewriteClipPrompt(clip, pack);
        const next = {
          ...clip,
          chineseVisualPrompt: local.chineseVisualPrompt,
          visualBeat: clip.visualBeat,
          promptPinned: clip.promptPinned
        };
        if (next.promptPinned) return next;
        const compiled = clipImagePromptArgs(
          next,
          index,
          project.clips.length,
          pack,
          visualBible,
          project.settings,
          project.scriptWorkspace?.genrePackId
        );
        return {
          ...next,
          visualBeat: compiled.beat,
          visualPrompt: compiled.prompt,
          visualBibleHash: visualBible?.sourceHash,
          chineseVisualPrompt: beatToChinese(compiled.beat) || local.chineseVisualPrompt
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
          const byId = new Map<string, {
            setting?: string;
            subject?: string;
            action?: string;
            chineseVisualPrompt?: string;
          }>(data.shots.map((item: {
            id: string;
            setting?: string;
            subject?: string;
            action?: string;
            chineseVisualPrompt?: string;
          }) => [item.id, item]));
          rewritten = rewritten.map((clip, index) => {
            const hit = byId.get(clip.id);
            if (clip.promptPinned) return clip;
            const beat = hit && (hit.subject || hit.setting || hit.action)
              ? { setting: hit.setting, subject: hit.subject, action: hit.action }
              : clip.visualBeat;
            const next = {
              ...clip,
              visualBeat: beat,
              chineseVisualPrompt: hit?.chineseVisualPrompt || beatToChinese(beat || {}) || clip.chineseVisualPrompt
            };
            const compiled = clipImagePromptArgs(
              next,
              index,
              rewritten.length,
              pack,
              visualBible,
              project.settings,
              project.scriptWorkspace?.genrePackId
            );
            return {
              ...next,
              visualBeat: compiled.beat,
              visualPrompt: compiled.prompt,
              visualBibleHash: visualBible?.sourceHash,
              chineseVisualPrompt: beatToChinese(compiled.beat) || next.chineseVisualPrompt
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

  const applyLoadedProject = useCallback((loaded: VideoProject) => {
    const next = hydratePersistedProject(loaded);
    rememberSaveRevision(next.saveRevision);
    captureAppSettingsIfEmpty(next);
    persistAppSettingsFromProject(next);
    historyRef.current.clear();
    setProject(next);
    setCurrentTime(0);
    setIsPlaying(false);
    setSelectedClipId(next.clips[0]?.id || null);
    bumpHistory();
  }, [bumpHistory]);

  const replaceCurrentProject = useCallback(async (loaded: VideoProject) => {
    await stashPreviousProject();
    applyLoadedProject(loaded);
  }, [applyLoadedProject]);

  const requestReplaceProject = useCallback((loaded: VideoProject, label: string, opts?: { force?: boolean }) => {
    if (!opts?.force && loaded.id === project.id) return;
    const run = () => {
      void replaceCurrentProject(loaded);
    };
    if (!projectHasLocalWork(project)) {
      run();
      return;
    }
    setConfirmState({
      title: `打开「${label}」？`,
      detail: `当前《${project.title || '未命名'}》会先写入工程库。打开后自动存会改成新工程，可点「恢复上一份」找回来。`,
      confirmLabel: '打开',
      action: run
    });
  }, [project, replaceCurrentProject]);

  const handleSaveAs = useCallback(async () => {
    try {
      const title = `${project.title || '未命名工程'} (副本)`;
      let copy: VideoProject | null = null;
      if (!isSampleProjectId(project.id)) {
        try {
          copy = await duplicateLibraryProject(project.id, title);
        } catch {
          copy = null;
        }
      }
      if (!copy) {
        copy = await createLibraryProject({
          ...project,
          id: `project-${Date.now()}`,
          title,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          saveRevision: 0
        });
      }
      if (!copy) throw new Error('另存失败');
      applyLoadedProject(copy);
      await refreshLibrary();
      showStatusToast(`已另存为「${copy.title}」`, { tone: 'ok', id: 'library-save-as' });
    } catch (err: any) {
      showStatusToast(err?.message || '另存失败', { tone: 'error', id: 'library-save-as' });
    }
  }, [applyLoadedProject, project, refreshLibrary]);

  const handleOpenLibraryProject = useCallback(async (id: string) => {
    if (id === project.id) return;
    const loaded = await fetchLibraryProject(id);
    if (!loaded) {
      showStatusToast('工程不存在或已损坏', { tone: 'error', id: 'library-open' });
      await refreshLibrary();
      return;
    }
    requestReplaceProject(loaded, loaded.title || '工程');
  }, [project.id, refreshLibrary, requestReplaceProject]);

  const handleDeleteLibraryProject = useCallback((projectId: string) => {
    const item = libraryItems.find((entry) => entry.id === projectId);
    setConfirmState({
      title: `删除「${item?.title || '工程'}」？`,
      detail: '只从工程库移除文件夹，public/generated 里的图还在，可在下方重新挂回。',
      confirmLabel: '删除',
      action: async () => {
        const ok = await deleteLibraryProject(projectId);
        if (!ok) {
          showStatusToast('删除失败', { tone: 'error', id: 'library-delete' });
          return;
        }
        if (project.id === projectId) {
          applyLoadedProject(createBlankProject(project));
        }
        await refreshLibrary();
        showStatusToast('已从工程库删除', { tone: 'ok', id: 'library-delete' });
      }
    });
  }, [applyLoadedProject, libraryItems, project, refreshLibrary]);

  const handleAttachGeneratedImage = useCallback((url: string) => {
    if (!selectedClipId) {
      showStatusToast('请先在分镜里点一个镜头，再把图挂上去', {
        tone: 'warn',
        id: 'orphan-attach',
        actionLabel: '去分镜表',
        onAction: () => setActiveTab('storyboard')
      });
      return;
    }
    applyClipsChange((clips) => clips.map((clip) => (
      clip.id === selectedClipId
        ? { ...clip, imageUrl: url, imageStatus: 'success', isGeneratingImage: false, imageError: undefined }
        : clip
    )));
    showStatusToast('已挂到当前分镜', { tone: 'ok', id: 'orphan-attach' });
  }, [applyClipsChange, selectedClipId]);

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
          onRetryFailedImages={handleRetryFailedImages}
          onCancelGenerateAllImages={handleCancelGenerateAllImages}
          onGenerateSingleImage={handleGenerateSingleClipImage}
          isGeneratingAll={isGeneratingAllImages}
          batchProgress={batchGenerationProgress}
          onRegenerateNarration={() => { void handleGenerateFullNarration(); }}
          isGeneratingNarration={isGeneratingNarration}
          narrationFresh={isNarrationTrackFresh(project.audio, project.clips, resolveTtsApi(project.settings.customTtsApi))}
          sentenceGap={resolveSentenceGap(project.audio)}
          outroHold={resolveOutro(project.settings).hold}
          onUtteranceHoldChange={handleUtteranceHoldChange}
          stylePack={hydrateActiveStylePack(project.settings)}
          visualBible={project.scriptWorkspace?.visualBible}
          genre={project.scriptWorkspace?.genrePackId || null}
          scriptLanguage={project.scriptWorkspace?.scriptLanguage}
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
          clips={project.clips}
          onUpdateClips={(clips) => updateProject({ clips })}
          llmApi={project.settings.customLlmApi}
          scriptLanguage={project.scriptWorkspace?.scriptLanguage}
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
          onPauseTimeline={() => setIsPlaying(false)}
          ttsApi={resolveTtsApi(project.settings.customTtsApi)}
          onVoiceChange={(voiceId) => updateProject(applyVoiceToProject(project, voiceId))}
          onOpenSettings={() => setActiveTab('settings')}
          onSentenceGapChange={handleSentenceGapChange}
          outro={resolveOutro(project.settings)}
          onOutroChange={handleOutroChange}
          clips={project.clips}
        />
      )}

      {activeTab === 'projects' && (
        <ProjectsPanel
          currentProject={project}
          selectedClipId={selectedClipId}
          libraryItems={libraryItems}
          onOpenLibraryProject={(id) => { void handleOpenLibraryProject(id); }}
          onOpenTemplate={(template) => requestReplaceProject(copyTemplateProject(template, project), template.title || '模板', { force: true })}
          onSaveAs={() => { void handleSaveAs(); }}
          onDeleteLibraryProject={handleDeleteLibraryProject}
          onNewBlankProject={() => requestReplaceProject(createBlankProject(project), '未命名工程')}
          onRestorePrevious={() => {
            void fetchPreviousProject().then((stored) => {
              if (!stored) {
                showStatusToast('没有上一份备份', { tone: 'warn', id: 'persist-previous' });
                return;
              }
              requestReplaceProject(stored.project, stored.project.title || '上一份工程', { force: true });
            });
          }}
          onAttachGeneratedImage={handleAttachGeneratedImage}
          onImportProject={(imported) => {
            requestReplaceProject({
              ...imported,
              id: `project-${Date.now()}`,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              saveRevision: 0
            }, imported.title || '导入工程', { force: true });
          }}
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
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
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
          sentenceGap={resolveSentenceGap(project.audio)}
          outroHold={resolveOutro(project.settings).hold}
          onApplyStyleOnly={handleApplyStyleToAllClips}
          isApplyingStyle={isGeneratingAllImages}
          isGeneratingNarration={isGeneratingNarration}
          narrationError={narrationError}
          narrationFresh={isNarrationTrackFresh(project.audio, project.clips, resolveTtsApi(project.settings.customTtsApi))}
          isPlaying={isPlaying}
          currentTime={currentTime}
          onTogglePlay={() => setIsPlaying((prev) => !prev)}
          onRecommendBgm={(trackId) => {
            updateProject({
              audio: project.audio.bgmTrackId === 'custom-uploaded'
                ? project.audio
                : { ...project.audio, bgmEnabled: true, bgmTrackId: trackId }
            });
          }}
        />
        <div className="h-0 w-0 overflow-hidden" aria-hidden>
          <VideoPlayerStage
            clips={project.clips}
            subtitles={project.subtitles}
            audio={project.audio}
            settings={project.settings}
            currentTime={currentTime}
            onTimeUpdate={setCurrentTime}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((prev) => !prev)}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
            isGeneratingNarration={isGeneratingNarration}
            narrationError={narrationError}
          />
        </div>
        </div>
      ) : (
        <main className="flex-1 flex flex-col h-full min-w-0 gap-2.5 sm:gap-3 overflow-hidden">
          <TopHeader
            title={project.title}
            onTitleChange={(title) => updateProject({ title }, { history: false })}
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
            narrationFresh={isNarrationTrackFresh(project.audio, project.clips, resolveTtsApi(project.settings.customTtsApi))}
            isGeneratingNarration={isGeneratingNarration}
            onRegenerateNarration={() => { void handleGenerateFullNarration(); }}
            failedImageCount={project.clips.filter((clip) => clip.imageStatus === 'failed').length}
            onRetryFailedImages={handleRetryFailedImages}
            canUndo={historyVersion >= 0 && historyRef.current.canUndo()}
            canRedo={historyVersion >= 0 && historyRef.current.canRedo()}
            onUndo={handleUndo}
            onRedo={handleRedo}
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
            sentenceGap={resolveSentenceGap(project.audio)}
          outroHold={resolveOutro(project.settings).hold}
            onUtteranceHoldChange={handleUtteranceHoldChange}
            onHoldCommit={scheduleBakeHolds}
          />
        </main>
      )}

      {/* 4. Export Modal */}
      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        project={project}
      />

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title || ''}
        detail={confirmState?.detail || ''}
        confirmLabel={confirmState?.confirmLabel || '继续'}
        onCancel={() => setConfirmState(null)}
        onConfirm={() => {
          const action = confirmState?.action;
          setConfirmState(null);
          if (action) void action();
        }}
      />
    </div>
  );
}
