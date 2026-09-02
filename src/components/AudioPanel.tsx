import React, { useState, useEffect } from 'react';
import { Volume2, Music, Mic, Play, Pause, Upload, Sparkles, Check, VolumeX, RotateCcw, Trash2, Sliders, Radio, Loader2 } from 'lucide-react';
import { AudioConfig, CustomTtsApiConfig, DesignedVoiceEntry, ScriptGenre, StoryboardClip, OutroConfig } from '../types';
import { BGM_GENRE_ORDER, BGM_TRACKS, DEFAULT_BGM_TRACK_ID, bgmTracksForGenre } from '../utils/presets';
import { audioEngine } from '../utils/audioEngine';
import { GENRE_PACKS } from '../utils/scriptBudget';
import {
  customVoiceBelongsToModel,
  isEnrollmentVoiceId,
  shelfVoiceForModel,
  ttsEngineLabel,
  ttsSourceKey,
  ttsSupportsSpeechRate,
  ttsVoicesForApi
} from '../utils/ttsCatalog';
import { hideStatusToast, showStatusToast } from '../utils/statusToast';
import { getTtsPreviewUrl, makeVoicePreviewKey, VOICE_PREVIEW_TEXT } from '../utils/ttsPreviewCache';
import { loadVoiceLibrary, removeDesignedVoice } from '../utils/voiceLibrary';
import { ToolRail } from './ToolRail';
import { SentenceGapControl } from './SentenceGapControl';
import { OutroControl } from './OutroControl';
import { resolveSentenceGap } from '../utils/sentenceGap';
import { VoiceDesignWorkshop } from './VoiceDesignWorkshop';

function VoicePlayButton({
  active,
  busy,
  onClick
}: {
  active: boolean;
  busy?: boolean;
  onClick: (event: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy && !active}
      className={`w-8 h-8 rounded-full border flex items-center justify-center flex-shrink-0 cursor-pointer ${
        active
          ? 'border-amber-500 bg-amber-500/20 text-amber-300'
          : 'border-[#3a3a4a] text-zinc-300 hover:text-amber-300 hover:border-amber-500/40'
      } disabled:opacity-60`}
      aria-label={active ? '停止试听' : '试听'}
    >
      {busy && !active ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : active ? (
        <Pause className="w-3.5 h-3.5" />
      ) : (
        <Play className="w-3.5 h-3.5 fill-current" />
      )}
    </button>
  );
}

interface AudioPanelProps {
  config: AudioConfig;
  onChange: (config: AudioConfig) => void;
  sampleNarrationText: string;
  narrationFresh?: boolean;
  isGeneratingNarration?: boolean;
  narrationError?: string | null;
  onGenerateFullNarration?: () => void;
  recommendedGenre?: ScriptGenre | null;
  timelinePlaying?: boolean;
  onPauseTimeline?: () => void;
  ttsApi?: CustomTtsApiConfig;
  onVoiceChange?: (voiceId: string) => void;
  onOpenSettings?: () => void;
  onSentenceGapChange?: (seconds: number) => void;
  clips?: StoryboardClip[];
  outro?: OutroConfig;
  onOutroChange?: (outro: OutroConfig) => void;
}

export const AudioPanel: React.FC<AudioPanelProps> = ({
  config,
  onChange,
  sampleNarrationText,
  narrationFresh = false,
  isGeneratingNarration = false,
  narrationError,
  onGenerateFullNarration,
  recommendedGenre = null,
  timelinePlaying = false,
  onPauseTimeline,
  ttsApi,
  onVoiceChange,
  onOpenSettings,
  onSentenceGapChange,
  clips = [],
  outro,
  onOutroChange
}) => {
  const [isPlayingPreviewVoice, setIsPlayingPreviewVoice] = useState(false);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [previewBusyVoiceId, setPreviewBusyVoiceId] = useState<string | null>(null);
  const [previewingBgmId, setPreviewingBgmId] = useState<string | null>(null);
  const [customTrackName, setCustomTrackName] = useState<string | null>(null);
  const [customTrackSize, setCustomTrackSize] = useState<string | null>(null);
  const [customAudioUrl, setCustomAudioUrl] = useState<string | null>(null);
  const [genreFilter, setGenreFilter] = useState<ScriptGenre | 'all'>(recommendedGenre || 'all');
  const [voiceLibrary, setVoiceLibrary] = useState<DesignedVoiceEntry[]>(() => loadVoiceLibrary());

  const voiceCharacters = ttsVoicesForApi(ttsApi);
  const supportsSpeechRate = ttsSupportsSpeechRate(ttsApi);
  const libraryIds = new Set(voiceLibrary.map((item) => item.voiceId));
  const customVoice = config.voiceCharacter
    && !voiceCharacters.some((item) => item.id === config.voiceCharacter)
    && !libraryIds.has(config.voiceCharacter)
    ? {
        id: config.voiceCharacter,
        name: `自定义 · ${config.voiceCharacter}`,
        desc: '来自设置里的 voice id，不在当前目录',
        badge: '自定义'
      }
    : null;
  const visibleVoices = customVoice ? [...voiceCharacters, customVoice] : voiceCharacters;
  const currentModel = (ttsApi?.model || '').trim();
  const matchingDesigned = voiceLibrary.filter((item) => item.targetModel === currentModel);
  const mismatchedDesigned = voiceLibrary.filter((item) => item.targetModel !== currentModel);
  const selectedDesigned = voiceLibrary.find((item) => item.voiceId === config.voiceCharacter);
  const designedBlocked = Boolean(
    (selectedDesigned && selectedDesigned.status !== 'ok')
    || (
      isEnrollmentVoiceId(config.voiceCharacter)
      && !customVoiceBelongsToModel(config.voiceCharacter, currentModel)
      && !shelfVoiceForModel(config.voiceCharacter, currentModel, selectedDesigned?.targetModel).ok
    )
  );

  const refreshVoiceLibrary = () => setVoiceLibrary(loadVoiceLibrary());

  const selectVoice = (voiceId: string) => {
    if (onVoiceChange) onVoiceChange(voiceId);
    else onChange({ ...config, voiceCharacter: voiceId });
  };

  const handleSelectDesigned = (entry: DesignedVoiceEntry) => {
    if (entry.status === 'deploying') {
      showStatusToast('这条音色还在审核，通过后再选用', { tone: 'warn', id: 'voice-design' });
      return;
    }
    if (entry.status !== 'ok') {
      showStatusToast('这条音色不可用', { tone: 'warn', id: 'voice-design' });
      return;
    }
    const usable = shelfVoiceForModel(entry.voiceId, currentModel, entry.targetModel);
    selectVoice(usable.ok ? usable.voiceId : entry.voiceId);
  };

  const stopVoicePreview = () => {
    audioEngine.stopNarration();
    setIsPlayingPreviewVoice(false);
    setPreviewingVoiceId(null);
    setPreviewBusyVoiceId(null);
    hideStatusToast('voice-preview');
  };

  const handlePreviewVoice = (voiceId: string, cachedUrl?: string, event?: React.MouseEvent) => {
    event?.stopPropagation();
    if (previewingBgmId) {
      audioEngine.stopPreviewBgm();
      setPreviewingBgmId(null);
    }
    onPauseTimeline?.();

    if (previewingVoiceId === voiceId && isPlayingPreviewVoice) {
      stopVoicePreview();
      return;
    }

    setPreviewingVoiceId(voiceId);
    setIsPlayingPreviewVoice(true);

    if (cachedUrl) {
      setPreviewBusyVoiceId(null);
      const started = audioEngine.playUrlPreview(cachedUrl, () => {
        setIsPlayingPreviewVoice(false);
        setPreviewingVoiceId(null);
      });
      if (!started) {
        setIsPlayingPreviewVoice(false);
        setPreviewingVoiceId(null);
      }
      return;
    }

    const previewKey = makeVoicePreviewKey(ttsSourceKey(ttsApi, voiceId), 1);
    const cached = getTtsPreviewUrl(previewKey);
    if (!cached) {
      setPreviewBusyVoiceId(voiceId);
      showStatusToast('正在合成试听…', { tone: 'progress', id: 'voice-preview', durationMs: 0 });
    }
    void audioEngine.speakNarration(
      VOICE_PREVIEW_TEXT,
      voiceId,
      config.speechRate,
      () => {
        setIsPlayingPreviewVoice(false);
        setPreviewingVoiceId(null);
        setPreviewBusyVoiceId(null);
      },
      { persistPreview: true }
    ).then((result) => {
      setPreviewBusyVoiceId(null);
      if (result?.cancelled) {
        hideStatusToast('voice-preview');
        return;
      }
      if (!result?.played) {
        hideStatusToast('voice-preview');
        setIsPlayingPreviewVoice(false);
        setPreviewingVoiceId(null);
        showStatusToast('试听合成了，但没有播出来，请再点一次', { tone: 'warn', id: 'voice-preview' });
        return;
      }
      if (result.fromCache) {
        hideStatusToast('voice-preview');
        return;
      }
      showStatusToast('试听已缓存，同一音色下次不再请求', { tone: 'ok', id: 'voice-preview' });
    }).catch(() => {
      hideStatusToast('voice-preview');
      stopVoicePreview();
    });
  };

  const volumePresets = [
    { label: '静音 0%', value: 0.0 },
    { label: '推荐 16%', value: 0.16, isDefault: true },
    { label: '清晰 25%', value: 0.25 },
    { label: '主打 50%', value: 0.50 }
  ];

  const recommendedTrackId = recommendedGenre
    ? GENRE_PACKS.find((pack) => pack.id === recommendedGenre)?.bgmTrackId
    : null;
  const visibleTracks = bgmTracksForGenre(genreFilter);

  // Show a quick auto-dismiss toast feedback
  const showFeedback = (msg: string) => {
    showStatusToast(msg, { tone: 'ok' });
  };

  useEffect(() => {
    if (recommendedGenre) setGenreFilter(recommendedGenre);
  }, [recommendedGenre]);

  // Subscribe to audio engine preview states for bi-directional synchronization
  useEffect(() => {
    const unsubscribeBgm = audioEngine.subscribePreviewState((trackId) => {
      setPreviewingBgmId(trackId);
    });
    const unsubscribeVoice = audioEngine.subscribeVoicePreview((playing) => {
      setIsPlayingPreviewVoice(playing);
      if (!playing) {
        setPreviewingVoiceId(null);
        setPreviewBusyVoiceId(null);
      }
    });

    return () => {
      unsubscribeBgm();
      unsubscribeVoice();
      audioEngine.stopPreviewBgm();
      audioEngine.stopNarration();
    };
  }, []);

  // Synchronize audio ducking state into engine
  useEffect(() => {
    audioEngine.setAudioDucking(config.audioDucking !== false);
  }, [config.audioDucking]);

  // Exclusively Audition / Preview a BGM track (Only plays sample, does NOT force select)
  const handleAuditionTrack = (trackId: string, customUrl?: string) => {
    // If voiceover preview is playing, stop it
    if (isPlayingPreviewVoice) stopVoicePreview();
    onPauseTimeline?.();

    if (previewingBgmId === trackId) {
      // Toggle off
      audioEngine.stopPreviewBgm();
      setPreviewingBgmId(null);
    } else {
      // Exclusively play this track
      setPreviewingBgmId(trackId);
      audioEngine.previewBgmTrack(
        trackId, 
        config.bgmVolume > 0 ? Math.max(config.bgmVolume, 0.20) : 0.20, 
        customUrl, 
        () => setPreviewingBgmId(null)
      );
    }
  };

  // Select a track as the Video Project's active BGM (Instantly replaces previous)
  const handleSelectTrack = (trackId: string, trackTitle: string) => {
    const isAlreadySelected = config.bgmTrackId === trackId && config.bgmEnabled;
    
    if (isAlreadySelected) {
      showFeedback(`当前视频已应用：${trackTitle.replace(/^[^\s]+\s*/, '')}`);
      return;
    }

    onChange({
      ...config,
      bgmTrackId: trackId,
      bgmEnabled: true
    });

    if (isPlayingPreviewVoice) stopVoicePreview();

    if (timelinePlaying) {
      audioEngine.stopPreviewBgm();
      setPreviewingBgmId(null);
    } else {
      const auditionUrl = trackId === 'custom-uploaded' ? (customAudioUrl || undefined) : undefined;
      setPreviewingBgmId(trackId);
      audioEngine.previewBgmTrack(
        trackId,
        config.bgmVolume > 0 ? Math.max(config.bgmVolume, 0.20) : 0.20,
        auditionUrl,
        () => setPreviewingBgmId(null)
      );
    }

    showFeedback(`已切换视频配乐：${trackTitle.replace(/^[^\s]+\s*/, '')}`);
  };

  // Custom audio file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setCustomTrackName(file.name);
      setCustomTrackSize(`${sizeMb} MB`);
      setCustomAudioUrl(url);
      
      onChange({
        ...config,
        bgmTrackId: 'custom-uploaded',
        bgmEnabled: true,
        customBgmUrl: url
      });

      // Auto start preview for instant user feedback
      handleAuditionTrack('custom-uploaded', url);
      showFeedback(`已载入自定义配乐并开始试听：${file.name}`);
    }
  };

  const handleClearCustomAudio = () => {
    if (customAudioUrl) {
      URL.revokeObjectURL(customAudioUrl);
    }
    setCustomTrackName(null);
    setCustomTrackSize(null);
    setCustomAudioUrl(null);
    if (previewingBgmId === 'custom-uploaded') {
      audioEngine.stopPreviewBgm();
      setPreviewingBgmId(null);
    }
    onChange({
      ...config,
      bgmTrackId: DEFAULT_BGM_TRACK_ID,
      customBgmUrl: undefined
    });
    showFeedback('已移除自定义音频，恢复默认背景音乐');
  };

  return (
    <ToolRail id="audio-tool-panel">
      {/* Header */}
      <div className="p-3.5 border-b border-[#23232c] bg-[#16161c] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Volume2 className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-zinc-200">声音设计 & AI配音</span>
        </div>
        {previewingBgmId && (
          <button
            onClick={() => {
              audioEngine.stopPreviewBgm();
              setPreviewingBgmId(null);
            }}
            className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Pause className="w-2.5 h-2.5" />
            停止试听
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs text-zinc-300 custom-scrollbar">
        {/* SECTION 1: AI 配音与旁白 (Voiceover) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
              <Mic className="w-3.5 h-3.5 text-amber-400" />
              AI 旁白配音
            </span>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={config.voiceoverEnabled}
                onChange={(e) => onChange({ ...config, voiceoverEnabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-7 h-3.5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border border-[#292934] bg-[#181820]">
            <div className="min-w-0">
              <div className="text-[10px] text-zinc-500">当前引擎</div>
              <div className="text-[11px] text-zinc-200 truncate">{ttsEngineLabel(ttsApi)}</div>
            </div>
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex-shrink-0 text-[10px] px-2 py-1 rounded-lg border border-[#3a3a4a] text-zinc-400 hover:text-amber-300 hover:border-amber-500/40 cursor-pointer"
              >
                去设置
              </button>
            )}
          </div>

          <div id="full-narration-status" className="p-2.5 rounded-xl border border-[#2b2b36] bg-[#181820] space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-200 font-medium">整段旁白</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                isGeneratingNarration
                  ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                  : narrationFresh
                    ? 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10'
                    : config.narrationTrack
                      ? 'text-amber-300 border-amber-500/40 bg-amber-500/10'
                      : 'text-zinc-500 border-zinc-700 bg-zinc-800'
              }`}>
                {isGeneratingNarration
                  ? '正在合成'
                  : narrationFresh
                    ? '已写入预览'
                    : config.narrationTrack
                      ? '需重新生成'
                      : '还没生成'}
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              可在这里单独重配音，不改画面文件。合成后各镜时长会按口播自动对齐。分镜表里也有同一入口。
            </p>
            <button
              type="button"
              onClick={() => onGenerateFullNarration?.()}
              disabled={isGeneratingNarration || !onGenerateFullNarration || designedBlocked}
              className="w-full py-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-semibold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 text-xs"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isGeneratingNarration ? 'animate-spin' : ''}`} />
              {isGeneratingNarration ? '正在生成整段旁白...' : narrationFresh ? '重新生成整段旁白' : '生成整段旁白'}
            </button>
            {config.narrationTrack && narrationFresh && (
              <div className="text-[10px] text-zinc-500 font-mono">
                时长 {config.narrationTrack.duration.toFixed(1)}s
              </div>
            )}
            {designedBlocked && (
              <div className="text-[11px] text-amber-200/90 leading-relaxed">
                当前设计音色还不能成片：要等审核通过，且必须和设置里的 3.0 模型一致。
              </div>
            )}
            {narrationError && (
              <div className="text-[11px] text-rose-300 leading-relaxed">{narrationError}</div>
            )}
          </div>

          <SentenceGapControl
            variant="panel"
            value={resolveSentenceGap(config)}
            clips={clips}
            onChange={(seconds) => {
              if (onSentenceGapChange) onSentenceGapChange(seconds);
              else onChange({ ...config, sentenceGap: seconds });
            }}
          />

          {outro && onOutroChange && (
            <OutroControl
              value={outro}
              onChange={(next) => onOutroChange(next)}
            />
          )}

          <VoiceDesignWorkshop
            ttsApi={ttsApi}
            onLibraryChange={refreshVoiceLibrary}
            onPushAndSelect={selectVoice}
            onNeedSettings={onOpenSettings}
          />

          <p className="text-[11px] text-zinc-500">点卡片选用，点圆形播放键试听。试听不必先选中。</p>

          {(matchingDesigned.length > 0 || mismatchedDesigned.length > 0) && (
            <div className="space-y-2">
              <div className="text-[11px] text-zinc-400">我的音色</div>
              <div className="grid grid-cols-1 gap-2">
                {[...matchingDesigned, ...mismatchedDesigned].map((entry) => {
                  const usableVoice = shelfVoiceForModel(entry.voiceId, currentModel, entry.targetModel);
                  const isSelected = config.voiceCharacter === entry.voiceId || config.voiceCharacter === usableVoice.voiceId;
                  const usable = entry.status === 'ok';
                  const playId = usableVoice.ok ? usableVoice.voiceId : entry.voiceId;
                  const isPreviewing = previewingVoiceId === playId || previewingVoiceId === entry.voiceId;
                  return (
                    <div
                      key={entry.id}
                      id={`voice-designed-${entry.id}`}
                      onClick={() => handleSelectDesigned(entry)}
                      className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#252530] border-amber-500 ring-1 ring-amber-500/40 text-zinc-100'
                          : usable
                            ? 'bg-[#1b1b22] border-[#292934] text-zinc-400 hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
                            : 'bg-[#16161c] border-[#292934] text-zinc-500 opacity-70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-xs text-zinc-100">{entry.title}</span>
                            <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/20 text-amber-400 rounded-full font-medium">
                              {entry.targetModel.includes('plus') ? 'Plus' : 'Flash'}
                            </span>
                            {entry.status !== 'ok' && (
                              <span className="text-[10px] text-amber-300">
                                {entry.status === 'deploying' ? '审核中' : entry.status === 'undeployed' ? '未通过' : '已失效'}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-zinc-400 line-clamp-2">{entry.prompt}</div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <VoicePlayButton
                            active={isPreviewing && isPlayingPreviewVoice}
                            busy={previewBusyVoiceId === playId || previewBusyVoiceId === entry.voiceId}
                            onClick={(event) => handlePreviewVoice(playId, entry.previewAudioUrl, event)}
                          />
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              const next = removeDesignedVoice(entry.id);
                              setVoiceLibrary(next);
                              showStatusToast('已从货架移除', { tone: 'ok', id: 'voice-design' });
                            }}
                            className="w-8 h-8 rounded-full border border-[#3a3a4a] text-zinc-500 hover:text-rose-300 flex items-center justify-center cursor-pointer"
                            aria-label="从货架移除"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          {isSelected && (
                            <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-black">
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="text-[11px] text-zinc-400">系统音色</div>
          <div className="grid grid-cols-1 gap-2">
            {visibleVoices.map((vc) => {
              const isSelected = config.voiceCharacter === vc.id;
              const isPreviewing = previewingVoiceId === vc.id;
              return (
                <div
                  key={vc.id}
                  id={`voice-char-${vc.id}`}
                  onClick={() => selectVoice(vc.id)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                    isSelected
                      ? 'bg-[#252530] border-amber-500 ring-1 ring-amber-500/40 text-zinc-100'
                      : 'bg-[#1b1b22] border-[#292934] text-zinc-400 hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
                  }`}
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-zinc-100">{vc.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/20 text-amber-400 rounded-full font-medium">
                        {vc.badge}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400">{vc.desc}</div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <VoicePlayButton
                      active={isPreviewing && isPlayingPreviewVoice}
                      busy={previewBusyVoiceId === vc.id}
                      onClick={(event) => handlePreviewVoice(vc.id, undefined, event)}
                    />
                    {isSelected && (
                      <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-black">
                        <Check className="w-2.5 h-2.5 stroke-[3]" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-2.5 pt-1">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-zinc-400">
                <span>语速调节</span>
                <span className="font-mono text-zinc-200">{supportsSpeechRate ? `${config.speechRate}x` : '此引擎不支持'}</span>
              </div>
              <input
                type="range"
                min="0.8"
                max="1.5"
                step="0.1"
                value={config.speechRate}
                disabled={!supportsSpeechRate}
                onChange={(e) => onChange({ ...config, speechRate: Number(e.target.value) })}
                className={`w-full h-1.5 bg-zinc-700 rounded-lg appearance-none accent-amber-500 ${
                  supportsSpeechRate ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'
                }`}
              />
              {!supportsSpeechRate && (
                <p className="text-[10px] text-zinc-500">当前模型不会吃语速滑条。换 Audio 3.0 后可在合成时调语速。</p>
              )}
            </div>
          </div>
        </div>

        {/* SECTION 2: 背景音乐 (BGM) */}
        <div className="space-y-3 pt-2 border-t border-[#24242e]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Music className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-semibold text-zinc-200">智能背景音乐 (BGM)</span>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={config.bgmEnabled}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  onChange({ ...config, bgmEnabled: enabled });
                  if (!enabled) {
                    audioEngine.stopBgm();
                    audioEngine.stopPreviewBgm();
                    setPreviewingBgmId(null);
                  }
                }}
                className="sr-only peer"
              />
              <div className="w-7 h-3.5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-amber-500"></div>
            </label>
          </div>

          <p className="text-[11px] text-zinc-400">
            点卡片<span className="text-amber-400 font-medium">立刻应用到预览</span>；预览正在播时会直接换曲，暂停时会先试听。右侧播放键只负责独立试听。
            {recommendedGenre && (
              <span className="block mt-1 text-zinc-500">当前文案体裁「{recommendedGenre}」已匹配一条推荐曲。</span>
            )}
          </p>

          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setGenreFilter('all')}
              className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                genreFilter === 'all'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-[#1b1b22] text-zinc-400 border-[#292934] hover:text-zinc-200'
              }`}
            >
              全部 {BGM_TRACKS.length}
            </button>
            {BGM_GENRE_ORDER.map((genre) => (
              <button
                key={genre}
                type="button"
                onClick={() => setGenreFilter(genre)}
                className={`px-2 py-0.5 rounded-full text-[10px] border transition-colors ${
                  genreFilter === genre
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-[#1b1b22] text-zinc-400 border-[#292934] hover:text-zinc-200'
                }`}
              >
                {genre}
              </button>
            ))}
          </div>

          {/* Custom Uploaded Track Card (If exists) */}
          {customTrackName && (
            <div
              id="bgm-track-custom-uploaded"
              onClick={() => handleSelectTrack('custom-uploaded', customTrackName)}
              className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                config.bgmTrackId === 'custom-uploaded' && config.bgmEnabled
                  ? 'bg-[#252530] border-amber-500 ring-1 ring-amber-500/40 shadow-sm shadow-amber-500/10'
                  : 'bg-[#1b1b22] border-[#292934] hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
              }`}
            >
              <div className="space-y-1 flex-1 pr-2 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="font-semibold text-xs text-zinc-100 truncate">🎵 {customTrackName}</span>
                  <span className="px-1.5 py-0.2 text-[9px] font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30 rounded">自定义音频</span>
                  {config.bgmTrackId === 'custom-uploaded' && config.bgmEnabled && (
                    <span className="px-1.5 py-0.2 text-[9px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded flex items-center gap-0.5">
                      <Check className="w-2.5 h-2.5" /> 已选配乐
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-zinc-400 flex items-center gap-2">
                  <span className="text-zinc-500 font-mono">{customTrackSize || '本地文件'}</span>
                  <span className="text-zinc-400">已载入至剪辑工程</span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAuditionTrack('custom-uploaded', customAudioUrl || undefined);
                  }}
                  className={`w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-all flex-shrink-0 ${
                    previewingBgmId === 'custom-uploaded'
                      ? 'bg-amber-500 text-black shadow-md shadow-amber-500/40 animate-pulse'
                      : 'bg-[#2b2b36] group-hover:bg-[#383846] text-zinc-300 hover:text-white'
                  }`}
                  title={previewingBgmId === 'custom-uploaded' ? '停止试听' : '独立试听本曲'}
                >
                  {previewingBgmId === 'custom-uploaded' ? (
                    <Pause className="w-3 h-3" />
                  ) : (
                    <Play className="w-3 h-3 fill-current ml-0.5" />
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleClearCustomAudio();
                  }}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="移除自定义音频"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* BGM Tracks List */}
          <div className="space-y-1.5">
            {visibleTracks.map((track) => {
              const isSelected = config.bgmTrackId === track.id && config.bgmEnabled;
              const isPreviewing = previewingBgmId === track.id;
              const isRecommended = recommendedTrackId === track.id;

              return (
                <div
                  key={track.id}
                  id={`bgm-track-${track.id}`}
                  onClick={() => handleSelectTrack(track.id, track.title)}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                    isSelected
                      ? 'bg-[#252530] border-amber-500 ring-1 ring-amber-500/40 shadow-sm shadow-amber-500/10'
                      : 'bg-[#1b1b22] border-[#292934] hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
                  }`}
                >
                  <div className="space-y-1 flex-1 pr-2 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-xs text-zinc-100 truncate">{track.title}</span>
                      {isRecommended && (
                        <span className="px-1.5 py-0.2 text-[9px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded">体裁推荐</span>
                      )}
                      {isSelected && (
                        <span className="px-1.5 py-0.2 text-[9px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded flex items-center gap-0.5">
                          <Check className="w-2.5 h-2.5" /> 已选配乐
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-400 flex items-center gap-2 flex-wrap">
                      {track.genres.map((genre) => (
                        <span key={genre} className="px-1.5 py-0.2 bg-zinc-800 rounded text-zinc-300">{genre}</span>
                      ))}
                      <span className="text-zinc-500 font-mono">{track.durationText}</span>
                      <span className="text-zinc-400 truncate">{track.mood}</span>
                    </div>
                  </div>

                  {/* Independent Audition Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAuditionTrack(track.id);
                    }}
                    className={`w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-all flex-shrink-0 ${
                      isPreviewing
                        ? 'bg-amber-500 text-black shadow-md shadow-amber-500/40 animate-pulse'
                        : 'bg-[#2b2b36] group-hover:bg-[#383846] text-zinc-300 hover:text-white'
                    }`}
                    title={isPreviewing ? '停止试听' : '独立试听本曲'}
                  >
                    {isPreviewing ? (
                      <Pause className="w-3 h-3" />
                    ) : (
                      <Play className="w-3 h-3 fill-current ml-0.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Upload Custom Audio */}
          <div className="pt-1">
            <label className="w-full p-2.5 bg-[#1b1b22] hover:bg-[#22222c] border border-dashed border-[#3a3a4a] hover:border-amber-500/40 rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors text-zinc-400 hover:text-zinc-200">
              <Upload className="w-3.5 h-3.5 text-amber-400" />
              <span className="truncate">{customTrackName ? `替换自定义音频: ${customTrackName}` : '上传自定义背景音乐 (.mp3 / .wav)'}</span>
              <input
                type="file"
                accept="audio/*"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          {/* BGM Volume & Quick Preset Chips & Audio Ducking */}
          <div className="space-y-3 pt-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-zinc-400">
                <span className="flex items-center gap-1">
                  {config.bgmVolume === 0 ? <VolumeX className="w-3.5 h-3.5 text-zinc-500" /> : <Volume2 className="w-3.5 h-3.5 text-amber-400" />}
                  音乐音量
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-zinc-200 font-semibold">{Math.round(config.bgmVolume * 100)}%</span>
                  {Math.abs(config.bgmVolume - 0.16) > 0.02 && (
                    <button
                      onClick={() => {
                        onChange({ ...config, bgmVolume: 0.16 });
                        audioEngine.setBgmVolume(0.16);
                        showFeedback('音量已重置为推荐默认 16%');
                      }}
                      className="text-[10px] text-zinc-500 hover:text-amber-400 flex items-center gap-0.5 cursor-pointer"
                      title="重置为默认 16%"
                    >
                      <RotateCcw className="w-2.5 h-2.5" /> 恢复16%
                    </button>
                  )}
                </div>
              </div>

              {/* Quick Preset Buttons */}
              <div className="grid grid-cols-4 gap-1.5">
                {volumePresets.map((preset) => {
                  const isActive = Math.abs(config.bgmVolume - preset.value) < 0.02;
                  return (
                    <button
                      key={preset.label}
                      onClick={() => {
                        onChange({ ...config, bgmVolume: preset.value });
                        audioEngine.setBgmVolume(preset.value);
                        showFeedback(`音量已调整为 ${preset.label}`);
                      }}
                      className={`py-1 text-[10px] font-medium rounded-lg border transition-all cursor-pointer ${
                        isActive
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
                          : 'bg-[#1b1b22] text-zinc-400 border-[#292934] hover:bg-[#22222d] hover:text-zinc-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={config.bgmVolume}
                onChange={(e) => {
                  const vol = Number(e.target.value);
                  onChange({ ...config, bgmVolume: vol });
                  audioEngine.setBgmVolume(vol);
                }}
                className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            <label className="flex items-center justify-between p-2.5 bg-[#1b1b22] border border-[#292934] rounded-xl cursor-pointer hover:bg-[#20202a]">
              <div className="space-y-0.5">
                <span className="text-[11px] font-medium text-zinc-200 block">智能人声避让 (Audio Ducking)</span>
                <span className="text-[10px] text-zinc-400 block">播放旁白解说时，自动平滑压低背景音 65%</span>
              </div>
              <input
                type="checkbox"
                checked={config.audioDucking !== false}
                onChange={(e) => {
                  const checked = e.target.checked;
                  onChange({ ...config, audioDucking: checked });
                  audioEngine.setAudioDucking(checked);
                  showFeedback(checked ? '已开启智能人声避让 (Audio Ducking)' : '已关闭智能人声避让');
                }}
                className="w-4 h-4 accent-amber-500 cursor-pointer"
              />
            </label>
          </div>
        </div>
      </div>
    </ToolRail>
  );
};
