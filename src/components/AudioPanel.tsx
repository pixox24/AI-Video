import React, { useState, useEffect } from 'react';
import { Volume2, Music, Mic, Play, Pause, Upload, Sparkles, Check, VolumeX, CheckCircle2, RotateCcw, Trash2, Sliders, Radio } from 'lucide-react';
import { AudioConfig } from '../types';
import { BGM_TRACKS } from '../utils/presets';
import { audioEngine } from '../utils/audioEngine';

interface AudioPanelProps {
  config: AudioConfig;
  onChange: (config: AudioConfig) => void;
  sampleNarrationText: string;
}

export const AudioPanel: React.FC<AudioPanelProps> = ({ config, onChange, sampleNarrationText }) => {
  const [isPlayingPreviewVoice, setIsPlayingPreviewVoice] = useState(false);
  const [previewingBgmId, setPreviewingBgmId] = useState<string | null>(null);
  const [customTrackName, setCustomTrackName] = useState<string | null>(null);
  const [customTrackSize, setCustomTrackSize] = useState<string | null>(null);
  const [customAudioUrl, setCustomAudioUrl] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const voiceCharacters = [
    { id: 'magnetic-male', name: '磁性男声 (云希)', desc: '影视解说/短视频第一爆款音色，富有磁性', badge: '影视标配' },
    { id: 'warm-female', name: '温柔女声 (晓晓)', desc: '亲和治愈，适合生活美学/情感哲思', badge: '全网热门' },
    { id: 'tech-anchor', name: '商业播音 (云扬)', desc: '干练专业，适合科技前沿/商业资讯', badge: '商业首选' },
    { id: 'documentary-male', name: '纪录片沉稳 (云健)', desc: '深沉浑厚，适合历史大片/地理探索', badge: '史诗大片' },
    { id: 'vibrant-creator', name: '活力主播 (晓伊)', desc: '轻快自然，适合好物种草/旅行日常', badge: '生动自然' },
    { id: 'bilingual-en', name: '美语播音 (Christopher)', desc: '地道国际双语播音主播音色', badge: '双语国际' },
  ];

  const volumePresets = [
    { label: '静音 0%', value: 0.0 },
    { label: '推荐 10%', value: 0.10, isDefault: true },
    { label: '清晰 25%', value: 0.25 },
    { label: '主打 50%', value: 0.50 }
  ];

  // Show a quick auto-dismiss toast feedback
  const showFeedback = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2400);
  };

  // Subscribe to audio engine preview states for bi-directional synchronization
  useEffect(() => {
    const unsubscribe = audioEngine.subscribePreviewState((trackId) => {
      setPreviewingBgmId(trackId);
    });

    return () => {
      unsubscribe();
      audioEngine.stopPreviewBgm();
      audioEngine.stopNarration();
    };
  }, []);

  // Synchronize audio ducking state into engine
  useEffect(() => {
    audioEngine.setAudioDucking(config.audioDucking !== false);
  }, [config.audioDucking]);

  // Test Voiceover (exclusive)
  const handleTestVoice = () => {
    // Stop any ongoing BGM preview to keep voice crystal clear
    if (previewingBgmId) {
      audioEngine.stopPreviewBgm();
      setPreviewingBgmId(null);
    }

    if (isPlayingPreviewVoice) {
      audioEngine.stopNarration();
      setIsPlayingPreviewVoice(false);
    } else {
      setIsPlayingPreviewVoice(true);
      const textToSpeak = sampleNarrationText || '这是AI自动合成的短视频旁白配音效果，正在为你实时试听。';
      audioEngine.speakNarration(
        textToSpeak,
        config.voiceCharacter,
        config.speechRate,
        () => setIsPlayingPreviewVoice(false)
      );
    }
  };

  // Exclusively Audition / Preview a BGM track (Only plays sample, does NOT force select)
  const handleAuditionTrack = (trackId: string, customUrl?: string) => {
    // If voiceover preview is playing, stop it
    if (isPlayingPreviewVoice) {
      audioEngine.stopNarration();
      setIsPlayingPreviewVoice(false);
    }

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
        bgmEnabled: true
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
    // Revert to default epic cinematic
    onChange({
      ...config,
      bgmTrackId: 'epic-cinematic'
    });
    showFeedback('已移除自定义音频，恢复默认背景音乐');
  };

  return (
    <div
      id="audio-tool-panel"
      className="w-80 lg:w-84 flex-shrink-0 bg-[#131318] border border-[#23232c] rounded-2xl flex flex-col h-full overflow-hidden select-none z-20 shadow-xl shadow-black/40 relative"
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-50 px-3 py-1.5 bg-amber-500 text-black font-semibold text-[11px] rounded-lg shadow-lg shadow-amber-500/20 flex items-center gap-1.5 animate-in fade-in slide-in-from-top-2 duration-150">
          <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate max-w-[220px]">{toastMessage}</span>
        </div>
      )}

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

          {/* Voice Character Cards */}
          <div className="grid grid-cols-1 gap-2">
            {voiceCharacters.map((vc) => {
              const isSelected = config.voiceCharacter === vc.id;
              return (
                <div
                  key={vc.id}
                  id={`voice-char-${vc.id}`}
                  onClick={() => onChange({ ...config, voiceCharacter: vc.id as any })}
                  className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'bg-[#252530] border-amber-500 ring-1 ring-amber-500/40 text-zinc-100'
                      : 'bg-[#1b1b22] border-[#292934] text-zinc-400 hover:border-[#3d3d4e] hover:bg-[#1f1f28]'
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-zinc-100">{vc.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/20 text-amber-400 rounded-full font-medium">
                        {vc.badge}
                      </span>
                    </div>
                    <div className="text-[10px] text-zinc-400">{vc.desc}</div>
                  </div>

                  {isSelected && (
                    <div className="w-4 h-4 rounded-full bg-amber-500 flex items-center justify-center text-black flex-shrink-0">
                      <Check className="w-2.5 h-2.5 stroke-[3]" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Voice Pitch / Rate / Test Voice Button */}
          <div className="space-y-2.5 pt-1">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-zinc-400">
                <span>语速调节</span>
                <span className="font-mono text-zinc-200">{config.speechRate}x</span>
              </div>
              <input
                type="range"
                min="0.8"
                max="1.5"
                step="0.1"
                value={config.speechRate}
                onChange={(e) => onChange({ ...config, speechRate: Number(e.target.value) })}
                className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            <button
              onClick={handleTestVoice}
              className="w-full py-2 bg-[#22222c] hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer text-xs font-medium"
            >
              {isPlayingPreviewVoice ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  停止试听配音
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  试听当前音色
                </>
              )}
            </button>
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
            点击卡片<span className="text-amber-400 font-medium">应用为视频配乐</span>，点击右侧播放键<span className="text-zinc-200 font-medium">独立试听</span>。
          </p>

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
            {BGM_TRACKS.map((track) => {
              const isSelected = config.bgmTrackId === track.id && config.bgmEnabled;
              const isPreviewing = previewingBgmId === track.id;

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
                      {track.id === 'epic-cinematic' && (
                        <span className="px-1.5 py-0.2 text-[9px] font-medium bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded">默认</span>
                      )}
                      {isSelected && (
                        <span className="px-1.5 py-0.2 text-[9px] font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded flex items-center gap-0.5">
                          <Check className="w-2.5 h-2.5" /> 已选配乐
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-zinc-400 flex items-center gap-2 flex-wrap">
                      <span className="px-1.5 py-0.2 bg-zinc-800 rounded text-zinc-300">{track.category}</span>
                      <span className="text-zinc-500 font-mono">{track.durationText}</span>
                      <span className="text-zinc-500 font-mono">{track.bpm} BPM</span>
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
                  {config.bgmVolume !== 0.10 && (
                    <button
                      onClick={() => {
                        onChange({ ...config, bgmVolume: 0.10 });
                        audioEngine.setBgmVolume(0.10);
                        showFeedback('音量已重置为推荐默认 10%');
                      }}
                      className="text-[10px] text-zinc-500 hover:text-amber-400 flex items-center gap-0.5 cursor-pointer"
                      title="重置为默认 10%"
                    >
                      <RotateCcw className="w-2.5 h-2.5" /> 恢复10%
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
    </div>
  );
};
