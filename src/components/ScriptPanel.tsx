import React, { useState } from 'react';
import {
  Wand2,
  RefreshCw,
  Sparkles,
  Layers,
  Clock,
  Lightbulb,
  CheckCircle2,
  Sliders,
  ArrowRight
} from 'lucide-react';
import { StoryboardClip, ScriptSubTab, CameraMotion, TransitionType, VisualStyle, CustomLlmApiConfig } from '../types';
import { TOPIC_IDEAS } from '../utils/presets';
import { generateProceduralArtwork } from '../utils/visualGenerator';

interface ScriptPanelProps {
  topic: string;
  onTopicChange: (topic: string) => void;
  onClipsChange: (clips: StoryboardClip[]) => void;
  visualStyle: VisualStyle;
  customLlmApi?: CustomLlmApiConfig;
  onSelectClip: (clipId: string) => void;
  onOpenStoryboard?: () => void;
}

export const ScriptPanel: React.FC<ScriptPanelProps> = ({
  topic,
  onTopicChange,
  onClipsChange,
  visualStyle,
  customLlmApi,
  onSelectClip,
  onOpenStoryboard
}) => {
  const [subTab, setSubTab] = useState<ScriptSubTab>('one-click');
  const [genre, setGenre] = useState('爆款科普');
  const [targetDuration, setTargetDuration] = useState<number>(30);
  const [clipCount, setClipCount] = useState<number>(4);
  const [tone, setTone] = useState<'punchy' | 'emotional' | 'humorous'>('punchy');
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const genres = ['爆款科普', '商业宣传', '情感治愈', '科幻未来', '历史传奇', '旅行纪实'];

  const applyGeneratedShots = (rawShots: any[] | null, sourceTopic: string) => {
    const safeCount = Math.max(3, Math.min(8, clipCount));
    const avgDur = Math.round((targetDuration / safeCount) * 10) / 10;
    const shots = rawShots && rawShots.length > 0
      ? rawShots
      : Array.from({ length: safeCount }, (_, i) => ({
          order: i + 1,
          duration: avgDur,
          narration: `【镜头 ${i + 1}】围绕「${sourceTopic}」展开精彩解析，层层递进揭秘核心看点。`,
          secondaryText: `Scene ${i + 1}: Exploring the core perspectives of ${sourceTopic}.`,
          visualPrompt: `Cinematic atmospheric shot showing ${sourceTopic}, scene ${i + 1}, highly detailed, masterwork composition`,
          chineseVisualPrompt: `画面展现 ${sourceTopic} 第 ${i + 1} 幕核心场景`,
          cameraMotion: i === 0 ? 'zoom-in' : i === 1 ? 'pan-left' : 'cinematic-orbit',
          transition: 'crossfade'
        }));

    const newClips: StoryboardClip[] = shots.map((shot: any, index: number) => ({
      id: `clip-${Date.now()}-${index}`,
      order: shot.order || index + 1,
      duration: typeof shot.duration === 'number' ? shot.duration : avgDur,
      narration: shot.narration || `镜头 ${index + 1}：关于${sourceTopic}的精彩解析`,
      secondaryText: shot.secondaryText || `Shot ${index + 1}: Key perspective on ${sourceTopic}`,
      visualPrompt: shot.visualPrompt || `${sourceTopic}, scene ${index + 1}, cinematic lighting, 8k resolution`,
      chineseVisualPrompt: shot.chineseVisualPrompt || `第 ${index + 1} 幕画面，细腻光影与氛围感`,
      cameraMotion: (shot.cameraMotion as CameraMotion) || 'zoom-in',
      transition: (shot.transition as TransitionType) || 'crossfade',
      imageUrl: generateProceduralArtwork(shot.narration || sourceTopic, visualStyle, '16:9', index),
      isGeneratingImage: false
    }));

    onClipsChange(newClips);
    if (newClips.length > 0) onSelectClip(newClips[0].id);
    setStatusMessage(`已生成 ${newClips.length} 个分镜头，正在进入分镜台`);
    window.setTimeout(() => onOpenStoryboard?.(), 350);
  };

  const handleGenerateScript = async () => {
    if (!topic.trim()) {
      setStatusMessage('请输入短视频主题或提示词');
      return;
    }

    setIsGeneratingScript(true);
    setStatusMessage('AI 正在构思黄金3秒抓人Hook与智能分镜剧本...');

    try {
      const res = await fetch('/api/script/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: topic.trim(),
          genre,
          targetDuration,
          visualStyle,
          clipCount,
          tone,
          llmApi: customLlmApi
        })
      });

      const data = await res.json().catch(() => ({}));
      const rawShots = data?.shots && Array.isArray(data.shots) && data.shots.length > 0
        ? data.shots
        : null;
      applyGeneratedShots(rawShots, topic.trim());
    } catch (err: any) {
      console.warn('Script generation exception, activating robust client fallback:', err);
      applyGeneratedShots(null, topic.trim());
    } finally {
      setIsGeneratingScript(false);
    }
  };

  return (
    <div
      id="script-tool-panel"
      className="w-80 lg:w-84 flex-shrink-0 bg-[#131318] border border-[#23232c] rounded-2xl flex flex-col h-full overflow-hidden select-none z-20 shadow-xl shadow-black/40"
    >
      <div className="grid grid-cols-2 gap-1 p-2.5 border-b border-[#23232c] bg-[#16161c]">
        <button
          id="subtab-one-click"
          onClick={() => setSubTab('one-click')}
          className={`py-1.5 px-1 text-center rounded-lg text-[11px] font-medium transition-all cursor-pointer truncate ${
            subTab === 'one-click'
              ? 'bg-[#2a2a32] text-amber-400 border border-amber-500/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1f1f26]'
          }`}
        >
          一键文案
        </button>
        <button
          id="subtab-batch-topics"
          onClick={() => setSubTab('batch-topics')}
          className={`py-1.5 px-1 text-center rounded-lg text-[11px] font-medium transition-all cursor-pointer truncate ${
            subTab === 'batch-topics'
              ? 'bg-[#2a2a32] text-amber-400 border border-amber-500/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1f1f26]'
          }`}
        >
          批量选题
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-zinc-300 custom-scrollbar">
        {subTab === 'one-click' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-zinc-400 font-medium flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                输入短视频主题 / 提示词
              </label>
              <textarea
                id="input-video-topic"
                value={topic}
                onChange={(e) => onTopicChange(e.target.value)}
                placeholder="例如：人类探索深空的壮丽史诗、为什么太阳会发光、AI如何改变未来城市..."
                rows={3}
                className="w-full bg-[#1e1e24] border border-[#2b2b36] rounded-xl p-3 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 resize-none text-xs leading-relaxed"
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                <Lightbulb className="w-3 h-3 text-amber-400/80" />
                灵感预设：
              </span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  '人类探索深空的壮丽史诗',
                  '未来AI重塑文明的一天',
                  '深海一万米未知生物',
                  '允许一切发生的治愈哲学'
                ].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => onTopicChange(preset)}
                    className="px-2.5 py-1 bg-[#1e1e24] hover:bg-[#282832] border border-[#2b2b36] text-[11px] text-zinc-300 rounded-lg transition-colors cursor-pointer text-left truncate max-w-full"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-zinc-400 font-medium">视频基调 & 领域</label>
              <div className="grid grid-cols-3 gap-1.5">
                {genres.map((g) => (
                  <button
                    key={g}
                    onClick={() => setGenre(g)}
                    className={`py-1.5 rounded-lg text-center transition-all cursor-pointer text-[11px] ${
                      genre === g
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 font-medium'
                        : 'bg-[#1e1e24] text-zinc-400 border border-[#2b2b36] hover:bg-[#25252e]'
                    }`}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1">
                <label className="text-zinc-400 font-medium flex items-center gap-1">
                  <Clock className="w-3 h-3 text-amber-400" />
                  目标时长
                </label>
                <select
                  value={targetDuration}
                  onChange={(e) => setTargetDuration(Number(e.target.value))}
                  className="w-full bg-[#1e1e24] border border-[#2b2b36] rounded-lg px-2.5 py-1.5 text-zinc-200 text-xs focus:outline-none focus:border-amber-500/50 cursor-pointer"
                >
                  <option value={15}>15 秒 (快节奏)</option>
                  <option value={30}>30 秒 (标准爆款)</option>
                  <option value={45}>45 秒 (深度叙事)</option>
                  <option value={60}>60 秒 (完整讲解)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-zinc-400 font-medium flex items-center gap-1">
                  <Layers className="w-3 h-3 text-amber-400" />
                  分镜数量
                </label>
                <select
                  value={clipCount}
                  onChange={(e) => setClipCount(Number(e.target.value))}
                  className="w-full bg-[#1e1e24] border border-[#2b2b36] rounded-lg px-2.5 py-1.5 text-zinc-200 text-xs focus:outline-none focus:border-amber-500/50 cursor-pointer"
                >
                  <option value={3}>3 个镜头</option>
                  <option value={4}>4 个镜头 (推荐)</option>
                  <option value={5}>5 个镜头</option>
                  <option value={6}>6 个镜头</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-zinc-400 font-medium flex items-center gap-1">
                <Sliders className="w-3 h-3 text-amber-400" />
                文案叙事语调
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'punchy', label: '抓人爆款', desc: '强悬念·快节奏' },
                  { id: 'emotional', label: '治愈深情', desc: '富有哲思共鸣' },
                  { id: 'humorous', label: '生动通俗', desc: '幽默易懂科普' }
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTone(t.id as typeof tone)}
                    className={`p-1.5 rounded-lg text-center transition-all cursor-pointer text-[11px] ${
                      tone === t.id
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50 font-medium'
                        : 'bg-[#1e1e24] text-zinc-400 border border-[#2b2b36] hover:bg-[#25252e]'
                    }`}
                  >
                    <div className="font-medium">{t.label}</div>
                    <div className="text-[9px] text-zinc-500">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <button
              id="btn-generate-script"
              onClick={handleGenerateScript}
              disabled={isGeneratingScript}
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-semibold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition-all cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-xs"
            >
              {isGeneratingScript ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-black" />
                  AI 正在构思剧本与分镜...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  一键生成文案并自动分镜
                </>
              )}
            </button>

            <p className="text-[11px] text-zinc-500 leading-relaxed flex items-center gap-1">
              生成完成后会自动进入
              <button
                type="button"
                onClick={() => onOpenStoryboard?.()}
                className="text-amber-400 hover:text-amber-300 inline-flex items-center gap-0.5 cursor-pointer"
              >
                分镜台
                <ArrowRight className="w-3 h-3" />
              </button>
              继续拆镜与微调。
            </p>

            {statusMessage && (
              <div className="p-2.5 bg-[#1f1f28] border border-[#2e2e3a] rounded-lg text-amber-300 text-[11px] flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                <span className="flex-1">{statusMessage}</span>
              </div>
            )}
          </div>
        )}

        {subTab === 'batch-topics' && (
          <div className="space-y-4">
            <div className="p-3 bg-[#1e1e24] border border-[#2b2b36] rounded-xl space-y-1">
              <span className="text-zinc-200 font-medium text-xs flex items-center gap-1.5">
                <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
                全网热门爆款短视频选题库
              </span>
              <p className="text-zinc-400 text-[11px]">
                点击任意主题即可填入一键文案生成器。
              </p>
            </div>

            {TOPIC_IDEAS.map((cat, idx) => (
              <div key={idx} className="space-y-1.5">
                <span className="text-[11px] font-semibold text-amber-400/90 tracking-wide">
                  {cat.category}
                </span>
                <div className="space-y-1.5">
                  {cat.topics.map((t, tIdx) => (
                    <button
                      key={tIdx}
                      onClick={() => {
                        onTopicChange(t);
                        setSubTab('one-click');
                      }}
                      className="w-full text-left p-2.5 bg-[#1a1a20] hover:bg-[#24242d] border border-[#262630] hover:border-amber-500/40 rounded-xl text-zinc-300 hover:text-amber-300 transition-all text-xs flex items-center justify-between group cursor-pointer"
                    >
                      <span className="line-clamp-2 leading-relaxed">{t}</span>
                      <Wand2 className="w-3.5 h-3.5 text-zinc-500 group-hover:text-amber-400 flex-shrink-0 ml-2" />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
