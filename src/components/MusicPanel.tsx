import React, { useState, useEffect } from 'react';
import { Music, Play, Pause, Upload, Check, VolumeX, Volume2, RotateCcw, Trash2 } from 'lucide-react';
import { AudioConfig, ScriptGenre, OutroConfig } from '../types';
import { BGM_GENRE_ORDER, BGM_TRACKS, DEFAULT_BGM_TRACK_ID, bgmTracksForGenre } from '../utils/presets';
import { audioEngine } from '../utils/audioEngine';
import { GENRE_PACKS } from '../utils/scriptBudget';
import { showStatusToast } from '../utils/statusToast';
import { ToolRail } from './ToolRail';
import { OutroControl } from './OutroControl';

interface MusicPanelProps {
  config: AudioConfig;
  onChange: (config: AudioConfig) => void;
  recommendedGenre?: ScriptGenre | null;
  timelinePlaying?: boolean;
  onPauseTimeline?: () => void;
  outro?: OutroConfig;
  onOutroChange?: (outro: OutroConfig) => void;
}

export const MusicPanel: React.FC<MusicPanelProps> = ({
  config,
  onChange,
  recommendedGenre = null,
  timelinePlaying = false,
  onPauseTimeline,
  outro,
  onOutroChange
}) => {
  const [previewingBgmId, setPreviewingBgmId] = useState<string | null>(null);
  const [customTrackName, setCustomTrackName] = useState<string | null>(null);
  const [customTrackSize, setCustomTrackSize] = useState<string | null>(null);
  const [customAudioUrl, setCustomAudioUrl] = useState<string | null>(null);
  const [genreFilter, setGenreFilter] = useState<ScriptGenre | 'all'>(recommendedGenre || 'all');

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

  const showFeedback = (msg: string) => {
    showStatusToast(msg, { tone: 'ok' });
  };

  useEffect(() => {
    if (recommendedGenre) setGenreFilter(recommendedGenre);
  }, [recommendedGenre]);

  useEffect(() => {
    if (config.customBgmUrl && config.bgmTrackId === 'custom-uploaded' && !customAudioUrl) {
      setCustomAudioUrl(config.customBgmUrl);
      setCustomTrackName((prev) => prev || '自定义配乐');
    }
  }, [config.customBgmUrl, config.bgmTrackId, customAudioUrl]);

  useEffect(() => {
    const unsubscribeBgm = audioEngine.subscribePreviewState((trackId) => {
      setPreviewingBgmId(trackId);
    });

    return () => {
      unsubscribeBgm();
      audioEngine.stopPreviewBgm();
    };
  }, []);

  useEffect(() => {
    audioEngine.setAudioDucking(config.audioDucking !== false);
  }, [config.audioDucking]);

  const handleAuditionTrack = (trackId: string, customUrl?: string) => {
    audioEngine.stopNarration();
    onPauseTimeline?.();

    if (previewingBgmId === trackId) {
      audioEngine.stopPreviewBgm();
      setPreviewingBgmId(null);
    } else {
      setPreviewingBgmId(trackId);
      audioEngine.previewBgmTrack(
        trackId,
        config.bgmVolume > 0 ? Math.max(config.bgmVolume, 0.20) : 0.20,
        customUrl,
        () => setPreviewingBgmId(null)
      );
    }
  };

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

    audioEngine.stopNarration();

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
    <ToolRail id="music-tool-panel">
      <div className="p-3.5 border-b border-[#23232c] bg-[#16161c] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-semibold text-zinc-200">音乐</span>
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

      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs text-zinc-300 custom-scrollbar">
        <div className="space-y-3">
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

          {outro && onOutroChange && (
            <OutroControl
              value={outro}
              onChange={(next) => onOutroChange(next)}
            />
          )}
        </div>
      </div>
    </ToolRail>
  );
};
