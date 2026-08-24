import React, { useState, useRef } from 'react';
import {
  Wand2,
  Plus,
  Trash2,
  RefreshCw,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Clock,
  Upload,
  Image as ImageIcon,
  CheckCircle2,
  FileText,
  Zap,
  AlertTriangle,
  Square as StopSquare,
  Hourglass,
  Loader2,
  Check,
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
  CustomLlmApiConfig
} from '../types';
import { STYLE_DEFINITIONS, resolveImageApi } from '../utils/presets';
import { generateProceduralArtwork } from '../utils/visualGenerator';

interface StoryboardPanelProps {
  topic: string;
  onTopicChange: (topic: string) => void;
  clips: StoryboardClip[];
  onClipsChange: (clips: StoryboardClip[]) => void;
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
  batchProgress
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
            duration: shot.duration || 3.5,
            narration: shot.narration,
            secondaryText: shot.secondaryText || `Scene ${index + 1}`,
            visualPrompt: shot.visualPrompt || `${cleanText.slice(0, 30)}, cinematic lighting`,
            chineseVisualPrompt: shot.chineseVisualPrompt || shot.narration,
            cameraMotion: (shot.cameraMotion as CameraMotion) || 'zoom-in',
            transition: (shot.transition as TransitionType) || 'crossfade',
            imageUrl: generateProceduralArtwork(shot.narration || '', visualStyle, '16:9', index),
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
          visualPrompt: `High quality cinematic shot of ${chunk.slice(0, 45)}, ${STYLE_DEFINITIONS[visualStyle]?.promptSuffix || ''}`,
          chineseVisualPrompt: `画面表现：${chunk}`,
          cameraMotion: cameraMotions[idx % cameraMotions.length],
          transition: transitions[idx % transitions.length],
          imageUrl: generateProceduralArtwork(chunk, visualStyle, '16:9', idx),
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
        onClipsChange(clips.map(c => c.id === clipId ? {
          ...c,
          imageUrl: data.imageUrl,
          imageStatus: 'success',
          isGeneratingImage: false,
          imageError: undefined
        } : c));
      } else {
        const errorMsg = data?.diagnosis || data?.error || `HTTP ${res.status}: 生图失败`;
        onClipsChange(clips.map(c => c.id === clipId ? {
          ...c,
          imageStatus: 'failed',
          isGeneratingImage: false,
          imageError: errorMsg
        } : c));
      }
    } catch (err: any) {
      onClipsChange(clips.map(c => c.id === clipId ? {
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
    onClipsChange(clips.map(c => c.id === clipId ? { ...c, ...updates } : c));
  };

  const handleAddClip = () => {
    const newOrder = clips.length + 1;
    const newClip: StoryboardClip = {
      id: `clip-${Date.now()}`,
      order: newOrder,
      duration: 3.5,
      narration: `镜头 ${newOrder}：请在此输入旁白与画面描述`,
      secondaryText: `Scene ${newOrder}: Describe what unfolds on screen.`,
      visualPrompt: `Cinematic shot for scene ${newOrder}, highly detailed, ${STYLE_DEFINITIONS[visualStyle]?.promptSuffix || ''}`,
      chineseVisualPrompt: `第 ${newOrder} 幕画面`,
      cameraMotion: 'zoom-in',
      transition: 'crossfade',
      imageUrl: generateProceduralArtwork(`镜头 ${newOrder}`, visualStyle, '16:9', newOrder)
    };
    onClipsChange([...clips, newClip]);
    onSelectClip(newClip.id);
  };

  const handleDeleteClip = (clipId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (clips.length <= 1) {
      alert('视频至少需要保留一个分镜头');
      return;
    }
    const updated = clips.filter(c => c.id !== clipId).map((c, i) => ({ ...c, order: i + 1 }));
    onClipsChange(updated);
    if (selectedClipId === clipId) onSelectClip(updated[0].id);
  };

  const moveClip = (index: number, direction: 'up' | 'down', e: React.MouseEvent) => {
    e.stopPropagation();
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === clips.length - 1) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const newClips = [...clips];
    const temp = newClips[index];
    newClips[index] = newClips[targetIndex];
    newClips[targetIndex] = temp;
    onClipsChange(newClips.map((c, i) => ({ ...c, order: i + 1 })));
  };

  return (
    <div
      id="storyboard-tool-panel"
      className="w-80 lg:w-84 flex-shrink-0 bg-[#131318] border border-[#23232c] rounded-2xl flex flex-col h-full overflow-hidden select-none z-20 shadow-xl shadow-black/40"
    >
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
                <button
                  onClick={handleAddClip}
                  className="px-2.5 py-1.5 bg-[#25252e] hover:bg-[#2f2f3a] border border-[#353542] text-zinc-200 rounded-lg text-[11px] flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3 text-amber-400" />
                  加镜头
                </button>
              </div>
            </div>

            <div className="space-y-3">
              {clips.map((clip, index) => {
                const isSelected = selectedClipId === clip.id;
                const isClipGenerating = clip.imageStatus === 'generating' || generatingClipId === clip.id;
                const isClipQueued = clip.imageStatus === 'queued';
                const isClipSuccess = clip.imageStatus === 'success';
                const isClipFailed = clip.imageStatus === 'failed';

                return (
                  <div
                    key={clip.id}
                    id={`clip-card-${clip.id}`}
                    onClick={() => onSelectClip(clip.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                        handleUploadLocalImage(clip.id, e.dataTransfer.files[0]);
                      }
                    }}
                    className={`rounded-xl border transition-all cursor-pointer p-3 space-y-2.5 relative ${
                      isSelected
                        ? 'bg-[#22222b] border-amber-500/60 ring-1 ring-amber-500/30'
                        : 'bg-[#1b1b22] border-[#292934] hover:border-[#3a3a48]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 font-mono text-[11px] font-semibold border border-amber-500/30">
                          镜头 {clip.order}
                        </span>
                        {isClipGenerating && (
                          <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-[10px] border border-amber-500/40 flex items-center gap-1 animate-pulse">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            AI 绘制中...
                          </span>
                        )}
                        {isClipQueued && (
                          <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-400 text-[10px] border border-zinc-700 flex items-center gap-1">
                            <Hourglass className="w-2.5 h-2.5" />
                            排队中
                          </span>
                        )}
                        {isClipSuccess && !isClipGenerating && (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-400 text-[10px] border border-emerald-500/30 flex items-center gap-1">
                            <Check className="w-2.5 h-2.5" />
                            已生成
                          </span>
                        )}
                        {isClipFailed && !isClipGenerating && (
                          <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-400 text-[10px] border border-rose-500/30 flex items-center gap-1" title={clip.imageError}>
                            <AlertTriangle className="w-2.5 h-2.5" />
                            生成失败
                          </span>
                        )}
                        <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                          <Clock className="w-3 h-3 text-zinc-500" />
                          <input
                            type="number"
                            step="0.5"
                            min="1.0"
                            max="15.0"
                            value={clip.duration}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => updateClip(clip.id, { duration: Math.max(1, Number(e.target.value)) })}
                            className="w-10 bg-[#141418] border border-[#2e2e3a] rounded px-1 text-center text-zinc-200 text-[11px]"
                          />
                          <span>秒</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <button onClick={(e) => moveClip(index, 'up', e)} disabled={index === 0} className="p-1 hover:text-amber-400 disabled:opacity-20 text-zinc-400 cursor-pointer">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={(e) => moveClip(index, 'down', e)} disabled={index === clips.length - 1} className="p-1 hover:text-amber-400 disabled:opacity-20 text-zinc-400 cursor-pointer">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={(e) => handleDeleteClip(clip.id, e)} className="p-1 hover:text-rose-400 text-zinc-500 cursor-pointer">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="relative rounded-lg overflow-hidden border border-[#2e2e3c] bg-[#121218] group h-28 flex items-center justify-center">
                      {clip.imageUrl ? (
                        <img
                          src={clip.imageUrl}
                          alt={`镜头 ${clip.order}`}
                          className={`w-full h-full object-cover ${isClipGenerating ? 'opacity-40 blur-[1px]' : 'opacity-100'}`}
                        />
                      ) : (
                        <div className="text-zinc-500 text-[11px] flex items-center gap-1.5">
                          <ImageIcon className="w-4 h-4" />
                          暂无画面
                        </div>
                      )}
                      {isClipGenerating && (
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-1.5">
                          <Loader2 className="w-6 h-6 animate-spin text-amber-400" />
                          <span className="text-amber-300 text-[11px]">AI 正在渲染...</span>
                        </div>
                      )}
                      {isClipQueued && !isClipGenerating && (
                        <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1">
                          <Hourglass className="w-5 h-5 text-zinc-400 animate-pulse" />
                          <span className="text-zinc-300 text-[10px]">排队等待...</span>
                        </div>
                      )}
                      {isClipFailed && !isClipGenerating && clip.imageError && (
                        <div className="absolute bottom-1.5 left-1.5 right-1.5 px-2 py-1 bg-rose-950/90 border border-rose-500/40 rounded text-rose-300 text-[10px] flex items-center justify-between z-10">
                          <span className="truncate max-w-[170px]" title={clip.imageError}>{clip.imageError}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onGenerateSingleImage) onGenerateSingleImage(clip.id);
                              else handleGenerateSingleImage(clip.id);
                            }}
                            className="text-amber-400 hover:underline font-medium text-[10px] ml-1 flex-shrink-0 cursor-pointer"
                          >
                            重试
                          </button>
                        </div>
                      )}
                      {!isClipGenerating && (
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onGenerateSingleImage) onGenerateSingleImage(clip.id);
                              else handleGenerateSingleImage(clip.id);
                            }}
                            className="px-2.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-lg text-[10px] flex items-center gap-1 cursor-pointer"
                          >
                            <RefreshCw className="w-3 h-3" />
                            AI重新生图
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              fileInputRefs.current[clip.id]?.click();
                            }}
                            className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-600 rounded-lg text-[10px] flex items-center gap-1 cursor-pointer"
                          >
                            <Upload className="w-3 h-3 text-amber-400" />
                            上传本地图
                          </button>
                          <input
                            ref={(el) => { fileInputRefs.current[clip.id] = el; }}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                handleUploadLocalImage(clip.id, e.target.files[0]);
                              }
                            }}
                          />
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] text-zinc-400 font-medium">解说词 / 旁白字幕</label>
                        <button
                          onClick={(e) => handlePolishNarration(clip.id, e)}
                          disabled={polishingClipId === clip.id || !clip.narration}
                          className="text-amber-400 hover:text-amber-300 flex items-center gap-1 text-[10px] cursor-pointer disabled:opacity-40"
                        >
                          <Sparkles className={`w-2.5 h-2.5 ${polishingClipId === clip.id ? 'animate-spin' : ''}`} />
                          {polishingClipId === clip.id ? '润色中...' : 'LLM润色'}
                        </button>
                      </div>
                      <textarea
                        value={clip.narration}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateClip(clip.id, { narration: e.target.value })}
                        rows={2}
                        placeholder="输入此镜头的解说词..."
                        className="w-full bg-[#16161c] border border-[#2b2b36] rounded-lg p-2 text-zinc-200 text-xs focus:outline-none focus:border-amber-500/50 resize-none leading-relaxed"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-400 font-medium flex items-center justify-between">
                        <span>AI 画面提示词</span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onGenerateSingleImage) onGenerateSingleImage(clip.id);
                            else handleGenerateSingleImage(clip.id);
                          }}
                          disabled={isClipGenerating}
                          className="text-amber-400 hover:text-amber-300 flex items-center gap-1 text-[10px] cursor-pointer disabled:opacity-40"
                        >
                          <RefreshCw className={`w-2.5 h-2.5 ${isClipGenerating ? 'animate-spin' : ''}`} />
                          {isClipGenerating ? '生图中...' : '重新生成画面'}
                        </button>
                      </label>
                      <textarea
                        value={clip.visualPrompt}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateClip(clip.id, { visualPrompt: e.target.value })}
                        rows={2}
                        placeholder="输入AI画图英文Prompt..."
                        className="w-full bg-[#16161c] border border-[#2b2b36] rounded-lg p-2 text-zinc-300 text-[11px] focus:outline-none focus:border-amber-500/50 resize-none font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-1">运镜动效</label>
                        <select
                          value={clip.cameraMotion}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateClip(clip.id, { cameraMotion: e.target.value as CameraMotion })}
                          className="w-full bg-[#16161c] border border-[#2b2b36] rounded-lg px-2 py-1 text-zinc-300 text-[11px] cursor-pointer"
                        >
                          <option value="zoom-in">缓慢拉近</option>
                          <option value="zoom-out">缓慢拉远</option>
                          <option value="pan-left">向左平移</option>
                          <option value="pan-right">向右平移</option>
                          <option value="tilt-up">向上仰拍</option>
                          <option value="tilt-down">向下俯拍</option>
                          <option value="cinematic-orbit">环绕运镜</option>
                          <option value="static">静止镜头</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-zinc-400 block mb-1">镜头转场</label>
                        <select
                          value={clip.transition}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updateClip(clip.id, { transition: e.target.value as TransitionType })}
                          className="w-full bg-[#16161c] border border-[#2b2b36] rounded-lg px-2 py-1 text-zinc-300 text-[11px] cursor-pointer"
                        >
                          <option value="crossfade">交叉淡化</option>
                          <option value="fade-black">淡入淡出黑场</option>
                          <option value="slide-left">向左推入</option>
                          <option value="zoom-in">快速缩放</option>
                          <option value="none">直接硬切</option>
                        </select>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
