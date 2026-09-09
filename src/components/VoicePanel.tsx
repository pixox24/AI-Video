import React, { useState, useEffect } from 'react';
import { Mic, Play, Pause, Sparkles, Check, Trash2, ChevronDown, Music } from 'lucide-react';
import { AudioConfig, CustomTtsApiConfig, DesignedVoiceEntry, StoryboardClip } from '../types';
import { audioEngine } from '../utils/audioEngine';
import {
  customVoiceBelongsToModel,
  designedVoiceUsableOnModel,
  isEnrollmentVoiceId,
  shelfVoiceForModel,
  ttsEngineLabel,
  ttsModelFamilyHint,
  ttsModelLabel,
  ttsSourceKey,
  ttsSupportsSpeechRate,
  ttsVoicesForApi
} from '../utils/ttsCatalog';
import { hideStatusToast, showStatusToast } from '../utils/statusToast';
import { getTtsPreviewUrl, makeVoicePreviewKey, VOICE_PREVIEW_TEXT } from '../utils/ttsPreviewCache';
import { loadVoiceLibrary, removeDesignedVoice } from '../utils/voiceLibrary';
import { ToolRail } from './ToolRail';
import { SentenceGapControl } from './SentenceGapControl';
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
        <span className="w-3.5 h-3.5 border-2 border-amber-300/40 border-t-amber-300 rounded-full animate-spin" />
      ) : active ? (
        <Pause className="w-3.5 h-3.5" />
      ) : (
        <Play className="w-3.5 h-3.5 fill-current" />
      )}
    </button>
  );
}

interface VoicePanelProps {
  config: AudioConfig;
  onChange: (config: AudioConfig) => void;
  narrationFresh?: boolean;
  isGeneratingNarration?: boolean;
  narrationError?: string | null;
  onGenerateFullNarration?: () => void;
  timelinePlaying?: boolean;
  onPauseTimeline?: () => void;
  ttsApi?: CustomTtsApiConfig;
  onVoiceChange?: (voiceId: string) => void;
  onAdoptVoiceModel?: (model: string, voiceId: string) => void;
  onOpenSettings?: () => void;
  onOpenMusic?: () => void;
  onSentenceGapChange?: (seconds: number) => void;
  clips?: StoryboardClip[];
  measuredSeconds?: number;
  targetSeconds?: number;
  onOpenScriptCopy?: () => void;
}

export const VoicePanel: React.FC<VoicePanelProps> = ({
  config,
  onChange,
  narrationFresh = false,
  isGeneratingNarration = false,
  narrationError,
  onGenerateFullNarration,
  onPauseTimeline,
  ttsApi,
  onVoiceChange,
  onAdoptVoiceModel,
  onOpenSettings,
  onOpenMusic,
  onSentenceGapChange,
  clips = [],
  measuredSeconds,
  targetSeconds,
  onOpenScriptCopy
}) => {
  const [isPlayingPreviewVoice, setIsPlayingPreviewVoice] = useState(false);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
  const [previewBusyVoiceId, setPreviewBusyVoiceId] = useState<string | null>(null);
  const [voiceLibrary, setVoiceLibrary] = useState<DesignedVoiceEntry[]>(() => loadVoiceLibrary());
  const [archiveOpen, setArchiveOpen] = useState(false);

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
  const matchingDesigned = voiceLibrary.filter((item) => designedVoiceUsableOnModel(item.voiceId, currentModel, item.targetModel));
  const mismatchedDesigned = voiceLibrary.filter((item) => !designedVoiceUsableOnModel(item.voiceId, currentModel, item.targetModel));
  const selectedDesigned = voiceLibrary.find((item) => item.voiceId === config.voiceCharacter);
  const designedBlocked = Boolean(
    (selectedDesigned && selectedDesigned.status !== 'ok')
    || (
      isEnrollmentVoiceId(config.voiceCharacter)
      && !customVoiceBelongsToModel(config.voiceCharacter, currentModel)
      && !shelfVoiceForModel(config.voiceCharacter, currentModel, selectedDesigned?.targetModel).ok
    )
  );
  const modelTitle = ttsModelLabel(currentModel);
  const familyHint = ttsModelFamilyHint(currentModel);

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
    if (!usable.ok) {
      showStatusToast(`这条音色绑定 ${ttsModelLabel(entry.targetModel)}，当前模型用不了`, { tone: 'warn', id: 'voice-design' });
      return;
    }
    selectVoice(usable.voiceId);
  };

  const handleAdoptArchived = (entry: DesignedVoiceEntry) => {
    if (entry.status !== 'ok') {
      showStatusToast(entry.status === 'deploying' ? '这条音色还在审核' : '这条音色不可用', { tone: 'warn', id: 'voice-design' });
      return;
    }
    if (!onAdoptVoiceModel) {
      onOpenSettings?.();
      showStatusToast(`先把设置里的模型换成 ${ttsModelLabel(entry.targetModel)}`, { tone: 'warn', id: 'voice-design' });
      return;
    }
    onAdoptVoiceModel(entry.targetModel, entry.voiceId);
    showStatusToast(`已切到 ${ttsModelLabel(entry.targetModel)} 并选用「${entry.title}」`, { tone: 'ok', id: 'voice-design' });
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
    audioEngine.stopPreviewBgm();
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

  useEffect(() => {
    const unsubscribeVoice = audioEngine.subscribeVoicePreview((playing) => {
      setIsPlayingPreviewVoice(playing);
      if (!playing) {
        setPreviewingVoiceId(null);
        setPreviewBusyVoiceId(null);
      }
    });

    return () => {
      unsubscribeVoice();
      audioEngine.stopNarration();
    };
  }, []);

  return (
    <ToolRail id="voice-tool-panel">
      <div className="p-3.5 border-b border-[#23232c] bg-[#16161c] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-zinc-200">旁白</span>
        </div>
        {isPlayingPreviewVoice && (
          <button
            onClick={stopVoicePreview}
            className="text-[10px] px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 flex items-center gap-1 cursor-pointer transition-colors"
          >
            <Pause className="w-2.5 h-2.5" />
            停止试听
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs text-zinc-300 custom-scrollbar">
        {measuredSeconds != null && targetSeconds != null && Math.abs(measuredSeconds - targetSeconds) > Math.max(2, targetSeconds * 0.05) && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100">
            目标 {targetSeconds}s · 实测 {measuredSeconds}s。可到口播页查看局部回修计划。
            {onOpenScriptCopy && (
              <button type="button" className="ml-2 underline cursor-pointer" onClick={onOpenScriptCopy}>去口播页</button>
            )}
          </div>
        )}
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
                当前设计音色还不能成片：要等审核通过，且必须属于当前模型。
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

          <div className="p-2.5 rounded-xl border border-[#2b2b38] bg-[#181820] space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
              <Music className="w-3.5 h-3.5 text-amber-400" />
              片尾与人声避让
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              画面收束、音乐淡出、人声避让已挪到「音乐」页，避免和配音设置挤在一起。
            </p>
            {onOpenMusic && (
              <button
                type="button"
                onClick={onOpenMusic}
                className="text-[10px] px-2 py-1 rounded-lg border border-[#3a3a4a] text-zinc-400 hover:text-amber-300 hover:border-amber-500/40 cursor-pointer"
              >
                去音乐页
              </button>
            )}
          </div>

          <VoiceDesignWorkshop
            ttsApi={ttsApi}
            onLibraryChange={refreshVoiceLibrary}
            onPushAndSelect={selectVoice}
            onNeedSettings={onOpenSettings}
          />

          <p className="text-[11px] text-zinc-500">点卡片选用，点圆形播放键试听。试听不必先选中。</p>

          {matchingDesigned.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] text-zinc-400">我的音色 · {modelTitle}</div>
              <div className="grid grid-cols-1 gap-2">
                {matchingDesigned.map((entry) => {
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
                              {ttsModelLabel(entry.targetModel)}
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

          {mismatchedDesigned.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setArchiveOpen((prev) => !prev)}
                className="w-full flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                <ChevronDown className={`w-3 h-3 transition-transform ${archiveOpen ? '' : '-rotate-90'}`} />
                <span>另有 {mismatchedDesigned.length} 条音色绑定其他模型</span>
              </button>
              {archiveOpen && (
                <div className="grid grid-cols-1 gap-2">
                  {mismatchedDesigned.map((entry) => (
                    <div
                      key={entry.id}
                      id={`voice-archived-${entry.id}`}
                      className="p-2.5 rounded-xl border border-dashed border-[#2b2b38] bg-[#16161c] text-zinc-500"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-xs text-zinc-300">{entry.title}</span>
                            <span className="text-[10px] px-1.5 py-0.2 bg-zinc-800 text-zinc-400 rounded-full font-medium">
                              {ttsModelLabel(entry.targetModel)}
                            </span>
                          </div>
                          <div className="text-[10px] text-zinc-500 line-clamp-2">{entry.prompt}</div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {entry.previewAudioUrl ? (
                            <VoicePlayButton
                              active={previewingVoiceId === entry.voiceId && isPlayingPreviewVoice}
                              busy={previewBusyVoiceId === entry.voiceId}
                              onClick={(event) => handlePreviewVoice(entry.voiceId, entry.previewAudioUrl, event)}
                            />
                          ) : (
                            <span title="需先切回绑定模型" className="w-8 h-8 rounded-full border border-[#2b2b38] text-zinc-600 flex items-center justify-center">
                              <Play className="w-3.5 h-3.5" />
                            </span>
                          )}
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
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleAdoptArchived(entry)}
                        className="mt-2 text-[10px] text-amber-300 hover:text-amber-200 cursor-pointer"
                      >
                        切到该模型并选用
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            <span>系统音色 · {modelTitle}</span>
            {familyHint && (
              <span title={familyHint} className="text-[10px] text-zinc-600 normal-case tracking-normal">
                共用目录
              </span>
            )}
          </div>
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
      </div>
    </ToolRail>
  );
};
