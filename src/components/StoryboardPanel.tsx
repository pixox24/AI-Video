import React, { useState, useRef } from 'react';
import {
  Wand2,
  Plus,
  Mic,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  FileText,
  Zap,
  Square as StopSquare,
  Loader2,
  Film
} from 'lucide-react';
import {
  StoryboardClip,
  StoryboardSubTab,
  CameraMotion,
  TransitionType,
  VisualStyle,
  AspectRatio,
  CustomImageApiConfig,
  CustomLlmApiConfig,
  ClipsChange
} from '../types';
import { resolveImageApi } from '../utils/presets';
import { generateProceduralArtwork } from '../utils/visualGenerator';
import { buildVisualPrompt, presetStylePack } from '../utils/stylePack';
import { ToolRail } from './ToolRail';
import { StoryboardClipCard } from './StoryboardClipCard';

interface StoryboardPanelProps {
  topic: string;
  onTopicChange: (topic: string) => void;
  clips: StoryboardClip[];
  onClipsChange: (clips: ClipsChange) => void;
  visualStyle: VisualStyle;
  aspectRatio?: AspectRatio;
  customImageApi?: CustomImageApiConfig;
  customLlmApi?: CustomLlmApiConfig;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onGenerateAllImages: () => void;
  onCancelGenerateAllImages?: () => void;
  onGenerateSingleImage?: (clipId: string) => void;
  isGeneratingAll: boolean;
  batchProgress?: { completed: number; total: number; activeCount: number } | null;
  onRegenerateNarration?: () => void;
  isGeneratingNarration?: boolean;
  narrationFresh?: boolean;
}

export const StoryboardPanel: React.FC<StoryboardPanelProps> = ({
  topic,
  onTopicChange,
  clips,
  onClipsChange,
  visualStyle,
  aspectRatio = '16:9',
  customImageApi,
  customLlmApi,
  selectedClipId,
  onSelectClip,
  onGenerateAllImages,
  onCancelGenerateAllImages,
  onGenerateSingleImage,
  isGeneratingAll,
  batchProgress,
  onRegenerateNarration,
  isGeneratingNarration = false,
  narrationFresh = false
}) => {
  const [subTab, setSubTab] = useState<StoryboardSubTab>(clips.length > 0 ? 'shots' : 'split');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [generatingClipId, setGeneratingClipId] = useState<string | null>(null);
  const [polishingClipId, setPolishingClipId] = useState<string | null>(null);
  const [pastedScript, setPastedScript] = useState<string>('');
  const [isSplittingScript, setIsSplittingScript] = useState(false);
  const [targetSplitShots, setTargetSplitShots] = useState<number>(4);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const totalDuration = clips.reduce((acc, c) => acc + (c.duration || 3.5), 0);

  const handleSplitPastedText = async (mode: 'ai' | 'quick') => {
    if (!pastedScript || !pastedScript.trim()) {
      setStatusMessage('请先粘贴或输入文案内容');
      return;
    }

    const cleanText = pastedScript.trim();
    setIsSplittingScript(true);
    setStatusMessage(mode === 'ai' ? 'AI 正在深度解析文案意境并智能分镜...' : '正在按标点语法快速断句拆镜...');

    try {
      if (mode === 'ai') {
        const res = await fetch('/api/script/split-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawText: cleanText,
            visualStyle,
            targetShots: targetSplitShots,
            llmApi: customLlmApi
          })
        });

        const data = await res.json().catch(() => ({}));
        if (data?.shots && Array.isArray(data.shots) && data.shots.length > 0) {
          const newClips: StoryboardClip[] = data.shots.map((shot: any, index: number) => ({
            id: `clip-${Date.now()}-${index}`,
            order: index + 1,
            duration: typeof shot.duration === 'number' ? shot.duration : Number(shot.duration) || 3.5,
            narration: shot.narration,
            secondaryText: shot.secondaryText || `Scene ${index + 1}`,
            visualPrompt: shot.visualPrompt || `${cleanText.slice(0, 30)}, cinematic lighting`,
            chineseVisualPrompt: shot.chineseVisualPrompt || shot.narration,
            cameraMotion: (shot.cameraMotion as CameraMotion) || 'zoom-in',
            transition: (shot.transition as TransitionType) || 'crossfade',
            imageUrl: generateProceduralArtwork(shot.narration || '', visualStyle, aspectRatio, index),
            isGeneratingImage: false
          }));

          if (data.title) onTopicChange(data.title);
          onClipsChange(newClips);
          setStatusMessage(`已将文案拆解为 ${newClips.length} 个镜头`);
          setSubTab('shots');
          if (newClips.length > 0) onSelectClip(newClips[0].id);
          return;
        }
      }

      const rawSentences = cleanText
        .split(/([。！？\n\r!?]+)/)
        .map(s => s.trim())
        .filter(Boolean);

      const mergedChunks: string[] = [];
      let currentChunk = '';

      for (let i = 0; i < rawSentences.length; i++) {
        const part = rawSentences[i];
        if (/^[。！？\n\r!?]+$/.test(part)) {
          currentChunk += (part.includes('\n') ? ' ' : part);
        } else if (currentChunk.length >= 18) {
          mergedChunks.push(currentChunk.trim());
          currentChunk = part;
        } else {
          currentChunk = currentChunk ? `${currentChunk} ${part}` : part;
        }
      }
      if (currentChunk.trim()) mergedChunks.push(currentChunk.trim());

      const safeChunks = mergedChunks.length > 0 ? mergedChunks.slice(0, 8) : [cleanText];
      const cameraMotions: CameraMotion[] = ['zoom-in', 'pan-left', 'zoom-out', 'pan-right', 'tilt-up', 'cinematic-orbit'];
      const transitions: TransitionType[] = ['crossfade', 'slide-left', 'crossfade', 'fade-black', 'zoom-in'];

      const newClips: StoryboardClip[] = safeChunks.map((chunk, idx) => {
        const charCount = chunk.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').length;
        const duration = Math.max(2.5, Math.min(7.0, Math.round((charCount / 4.2) * 10) / 10 || 3.5));
        return {
          id: `clip-${Date.now()}-${idx}`,
          order: idx + 1,
          duration,
          narration: chunk,
          secondaryText: `Scene ${idx + 1}: ${chunk.slice(0, 35)}`,
          visualPrompt: buildVisualPrompt(`High quality shot of ${chunk.slice(0, 45)}`, presetStylePack(visualStyle)),
          chineseVisualPrompt: `画面表现：${chunk}`,
          cameraMotion: cameraMotions[idx % cameraMotions.length],
          transition: transitions[idx % transitions.length],
          imageUrl: generateProceduralArtwork(chunk, visualStyle, aspectRatio, idx),
          isGeneratingImage: false
        };
      });

      onTopicChange(cleanText.slice(0, 16));
      onClipsChange(newClips);
      setStatusMessage(`快速拆镜完成，共 ${newClips.length} 个分镜`);
      setSubTab('shots');
      if (newClips.length > 0) onSelectClip(newClips[0].id);
    } catch (err: any) {
      console.warn('Split text error:', err);
      setStatusMessage('拆镜遇到问题，请重试');
    } finally {
      setIsSplittingScript(false);
    }
  };

  const handlePolishNarration = async (clipId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !clip.narration) return;

    setPolishingClipId(clipId);
    try {
      const res = await fetch('/api/script/polish-narration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: clip.narration,
          type: 'narration',
          style: 'punchy',
          visualStyle,
          llmApi: customLlmApi
        })
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.polishedText) {
        updateClip(clipId, {
          narration: data.polishedText,
          secondaryText: data.secondaryText || clip.secondaryText,
          visualPrompt: data.visualPrompt || clip.visualPrompt,
          chineseVisualPrompt: data.chineseVisualPrompt || clip.chineseVisualPrompt
        });
      }
    } catch (err) {
      console.error('Polish error:', err);
    } finally {
      setPolishingClipId(null);
    }
  };

  const handleGenerateSingleImage = async (clipId: string) => {
    if (onGenerateSingleImage) {
      onGenerateSingleImage(clipId);
      return;
    }

    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    setGeneratingClipId(clipId);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 360000);
    try {
      const res = await fetch('/api/visual/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: clip.visualPrompt,
          visualStyle,
          aspectRatio,
          seed: clip.order * 1000 + Date.now(),
          customApi: resolveImageApi(customImageApi)
        }),
        signal: controller.signal
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data?.imageUrl) {
        onClipsChange(prev => prev.map(c => c.id === clipId ? {
          ...c,
          imageUrl: data.imageUrl,
          imageStatus: 'success',
          isGeneratingImage: false,
          imageError: undefined
        } : c));
      } else {
        const errorMsg = data?.diagnosis || data?.error || `HTTP ${res.status}: 生图失败`;
        onClipsChange(prev => prev.map(c => c.id === clipId ? {
          ...c,
          imageStatus: 'failed',
          isGeneratingImage: false,
          imageError: errorMsg
        } : c));
      }
    } catch (err: any) {
      onClipsChange(prev => prev.map(c => c.id === clipId ? {
        ...c,
        imageStatus: 'failed',
        isGeneratingImage: false,
        imageError: err?.name === 'AbortError'
          ? '等待超时：供应商后台可能已出图，但接口未在时限内返回。请重试。'
          : (err?.message || '网络异常，生图请求失败')
      } : c));
    } finally {
      window.clearTimeout(timeoutId);
      setGeneratingClipId(null);
    }
  };

  const handleUploadLocalImage = (clipId: string, file: File) => {
    if (!file.type.startsWith('image/')) {
      setStatusMessage('请选择有效的图片文件 (JPG / PNG / WebP)');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      if (dataUrl) updateClip(clipId, { imageUrl: dataUrl, imageStatus: 'success' });
    };
    reader.readAsDataURL(file);
  };

  const updateClip = (clipId: string, updates: Partial<StoryboardClip>) => {
    onClipsChange(prev => prev.map(c => c.id === clipId ? { ...c, ...updates } : c));
  };

  const handleAddClip = () => {
    const newClipId = `clip-${Date.now()}`;
    onClipsChange(prev => {
      const newOrder = prev.length + 1;
      const newClip: StoryboardClip = {
        id: newClipId,
        order: newOrder,
        duration: 3.5,
        narration: `镜头 ${newOrder}：请在此输入旁白与画面描述`,
        secondaryText: `Scene ${newOrder}: Describe what unfolds on screen.`,
        visualPrompt: buildVisualPrompt(`Shot for scene ${newOrder}`, presetStylePack(visualStyle)),
        chineseVisualPrompt: `第 ${newOrder} 幕画面`,
        cameraMotion: 'zoom-in',
        transition: 'crossfade',
        imageUrl: generateProceduralArtwork(`镜头 ${newOrder}`, visualStyle, aspectRatio, newOrder)
      };
      return [...prev, newClip];
    });
    onSelectClip(newClipId);
  };

  const handleDeleteClip = (clipId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (clips.length <= 1) {
      alert('视频至少需要保留一个分镜头');
      return;
    }
    onClipsChange(prev => {
      if (prev.length <= 1) return prev;
      const updated = prev.filter(c => c.id !== clipId).map((c, i) => ({ ...c, order: i + 1 }));
      if (selectedClipId === clipId && updated[0]) onSelectClip(updated[0].id);
      return updated;
    });
  };

  const moveClip = (index: number, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === clips.length - 1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    onClipsChange(prev => {
      if (direction === 'up' && index === 0) return prev;
      if (direction === 'down' && index === prev.length - 1) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next.map((c, i) => ({ ...c, order: i + 1 }));
    });
  };

  return (
    <ToolRail id="storyboard-tool-panel">
      <div className="grid grid-cols-2 gap-1 p-2.5 border-b border-[#23232c] bg-[#16161c]">
        <button
          id="subtab-storyboard-split"
          onClick={() => setSubTab('split')}
          className={`py-1.5 px-1 text-center rounded-lg text-[11px] font-medium transition-all cursor-pointer truncate ${
            subTab === 'split'
              ? 'bg-[#2a2a32] text-amber-400 border border-amber-500/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1f1f26]'
          }`}
          title="粘贴现成长文案，智能拆解为分镜"
        >
          自由拆镜
        </button>
        <button
          id="subtab-storyboard-shots"
          onClick={() => setSubTab('shots')}
          className={`py-1.5 px-1 text-center rounded-lg text-[11px] font-medium transition-all cursor-pointer flex items-center justify-center gap-1 ${
            subTab === 'shots'
              ? 'bg-[#2a2a32] text-amber-400 border border-amber-500/30'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#1f1f26]'
          }`}
        >
          <span>分镜表</span>
          <span className="text-[9px] px-1 py-0.2 bg-zinc-800 text-zinc-400 rounded-full">{clips.length}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs text-zinc-300 custom-scrollbar">
        {subTab === 'split' && (
          <div className="space-y-3.5">
            <div className="p-3 bg-[#1e1e24] border border-[#2b2b36] rounded-xl space-y-1">
              <span className="text-zinc-200 font-medium text-xs flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-amber-400" />
                粘贴已有文案 / 口播脚本一键拆镜
              </span>
              <p className="text-zinc-400 text-[11px] leading-relaxed">
                将写好的短视频稿件粘贴到这里，系统会按标点和语义拆成 3~8 个镜头，并匹配时长与画图 Prompt。
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-zinc-400 text-[11px]">
                <span>文案内容：</span>
                <span className="font-mono text-[10px] text-zinc-500">{pastedScript.length} 字</span>
              </div>
              <textarea
                value={pastedScript}
                onChange={(e) => setPastedScript(e.target.value)}
                placeholder="例如：很多时候我们以为深海是平静的，但其实在一万米之下的马里亚纳海沟，隐藏着超越人类想象的生命奇迹。"
                rows={6}
                className="w-full bg-[#1e1e24] border border-[#2b2b36] rounded-xl p-3 text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500/60 focus:ring-1 focus:ring-amber-500/40 resize-none text-xs leading-relaxed"
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] text-zinc-400">快速填入范本文案：</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  {
                    name: '深海奇迹',
                    text: '深海一万米到底隐藏着什么？在马里亚纳海沟的永恒黑暗中，水压超过一千个大气压。然而这里却生存着晶莹剔透的狮子鱼与自发光的未知生物。生命的坚韧，永远超越我们的想象。'
                  },
                  {
                    name: '宇宙微光',
                    text: '你眼中的每一颗星星，其实都是来自亿万年前的光芒。当你抬头仰望夜空，你所看到的不是现在的宇宙，而是它的过去。我们皆是星尘，亦是时间的旅人。'
                  },
                  {
                    name: '生活随笔',
                    text: '不必行色匆匆，也不必光芒万丈。做一棵安静生长的树，向下扎根，向阳而生。生活最珍贵的美好，往往就藏在每一个从容安定的当下。'
                  }
                ].map((sample) => (
                  <button
                    key={sample.name}
                    onClick={() => setPastedScript(sample.text)}
                    className="px-2.5 py-1 bg-[#1e1e24] hover:bg-[#282832] border border-[#2b2b36] text-[11px] text-zinc-300 rounded-lg transition-colors cursor-pointer"
                  >
                    {sample.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-zinc-400 font-medium flex items-center justify-between text-[11px]">
                <span>期望镜头数量：</span>
                <span className="text-amber-400 font-mono font-semibold">{targetSplitShots} 镜</span>
              </label>
              <div className="grid grid-cols-4 gap-1.5">
                {[3, 4, 5, 6].map((num) => (
                  <button
                    key={num}
                    onClick={() => setTargetSplitShots(num)}
                    className={`py-1.5 rounded-lg text-center text-xs font-medium cursor-pointer transition-all ${
                      targetSplitShots === num
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                        : 'bg-[#1e1e24] text-zinc-400 border border-[#2b2b36] hover:bg-[#25252e]'
                    }`}
                  >
                    {num} 镜
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2">
              <button
                onClick={() => handleSplitPastedText('quick')}
                disabled={isSplittingScript || !pastedScript.trim()}
                className="py-2.5 bg-[#25252e] hover:bg-[#30303c] border border-[#3c3c4e] text-zinc-200 font-medium rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-40 text-xs"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                快速标点拆镜
              </button>
              <button
                onClick={() => handleSplitPastedText('ai')}
                disabled={isSplittingScript || !pastedScript.trim()}
                className="py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-black font-semibold rounded-xl flex items-center justify-center gap-1.5 shadow-lg shadow-amber-500/20 transition-all cursor-pointer disabled:opacity-40 text-xs"
              >
                {isSplittingScript ? <RefreshCw className="w-3.5 h-3.5 animate-spin text-black" /> : <Wand2 className="w-3.5 h-3.5" />}
                {isSplittingScript ? '正在拆解...' : 'AI 深度拆镜'}
              </button>
            </div>

            {statusMessage && (
              <div className="p-2.5 bg-[#1f1f28] border border-[#2e2e3a] rounded-lg text-amber-300 text-[11px] flex items-center gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                <span className="flex-1">{statusMessage}</span>
              </div>
            )}
          </div>
        )}

        {subTab === 'shots' && (
          <div className="space-y-3">
            <div className="p-2.5 bg-[#181820] border border-[#282834] rounded-xl flex items-center justify-between">
              <div className="space-y-0.5">
                <span className="text-zinc-200 font-semibold text-xs block flex items-center gap-1.5">
                  <Film className="w-3.5 h-3.5 text-amber-400" />
                  共 {clips.length} 个镜头 · 约 {totalDuration.toFixed(1)} 秒
                </span>
                <span className="text-[10px] text-zinc-400">
                  {totalDuration <= 20 ? '黄金快节奏' : totalDuration <= 40 ? '标准爆款' : '深度叙事'}
                  {topic ? ` · ${topic.slice(0, 12)}` : ''}
                  {batchProgress && (
                    <span className="ml-2 text-amber-400 font-medium">
                      (已生成 {batchProgress.completed}/{batchProgress.total})
                    </span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {isGeneratingAll ? (
                  <div className="flex items-center gap-1">
                    <button
                      disabled
                      className="px-2.5 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-[11px] flex items-center gap-1 cursor-wait font-medium"
                    >
                      <Loader2 className="w-3 h-3 animate-spin text-amber-400" />
                      <span>{batchProgress ? `${batchProgress.completed}/${batchProgress.total}` : '生成中'}</span>
                    </button>
                    {onCancelGenerateAllImages && (
                      <button
                        onClick={onCancelGenerateAllImages}
                        className="p-1.5 bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/40 rounded-lg cursor-pointer"
                        title="停止批量生图"
                      >
                        <StopSquare className="w-3 h-3 fill-current" />
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={onGenerateAllImages}
                    className="px-2.5 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 rounded-lg text-[11px] flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    全量生图
                  </button>
                )}
                {onRegenerateNarration && (
                  <button
                    type="button"
                    onClick={onRegenerateNarration}
                    disabled={isGeneratingNarration}
                    title="单独重配音，并按新口播时长对齐各镜画面"
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-50 ${
                      narrationFresh
                        ? 'bg-[#25252e] hover:bg-[#2f2f3a] border border-[#353542] text-zinc-200'
                        : 'bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300'
                    }`}
                  >
                    <Mic className={`w-3 h-3 ${isGeneratingNarration ? 'animate-pulse' : ''}`} />
                    {isGeneratingNarration ? '配音中' : narrationFresh ? '重新配音' : '重新配音并对齐'}
                  </button>
                )}
                <button
                  onClick={handleAddClip}
                  className="px-2.5 py-1.5 bg-[#25252e] hover:bg-[#2f2f3a] border border-[#353542] text-zinc-200 rounded-lg text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3 text-amber-400" />
                  加镜头
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {clips.map((clip, index) => (
                <StoryboardClipCard
                  key={clip.id}
                  clip={clip}
                  index={index}
                  total={clips.length}
                  selected={selectedClipId === clip.id}
                  generating={clip.imageStatus === 'generating' || generatingClipId === clip.id}
                  queued={clip.imageStatus === 'queued'}
                  failed={clip.imageStatus === 'failed'}
                  success={clip.imageStatus === 'success'}
                  polishing={polishingClipId === clip.id}
                  fileInputRef={(el) => { fileInputRefs.current[clip.id] = el; }}
                  onSelect={() => onSelectClip(clip.id)}
                  onUpdate={(updates) => updateClip(clip.id, updates)}
                  onGenerate={() => { if (onGenerateSingleImage) onGenerateSingleImage(clip.id); else void handleGenerateSingleImage(clip.id); }}
                  onUpload={(file) => handleUploadLocalImage(clip.id, file)}
                  onPolish={(e) => { void handlePolishNarration(clip.id, e); }}
                  onMove={(direction, e) => moveClip(index, direction, e)}
                  onDelete={(e) => handleDeleteClip(clip.id, e)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </ToolRail>
  );
};
