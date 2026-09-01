import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Clapperboard,
  Clock,
  FileText,
  Lightbulb,
  Link2,
  Loader2,
  Package,
  Pause,
  PenLine,
  RefreshCw,
  Sparkles,
  Volume2,
  Wand2,
  Zap,
  Users,
  Lock,
  Unlock,
  ImagePlus,
  X
} from 'lucide-react';
import {
  AspectRatio,
  BeatFunction,
  CustomLlmApiConfig,
  CustomTtsApiConfig,
  ResearchNotes,
  ScriptGenre,
  ScriptIntent,
  ScriptPace,
  ScriptPlatform,
  ScriptStage,
  ScriptWorkspace,
  ShotEnergy,
  StoryboardClip,
  TopicCard,
  StylePack,
  VisualBible,
  VisualStyle
} from '../types';
import { countNarrationChars } from '../utils/narrationTrack';
import { applyLlmCoverage, CAMERA_ANGLE_LABEL, COVERAGE_JOB_LABEL, SHOT_SIZE_LABEL } from '../utils/shotCoverage';
import {
  PACE_PRESETS,
  PLATFORM_OPTIONS,
  STAGE_META,
  TARGET_SECONDS_PRESETS,
  applyNarrationToBeats,
  beatIntentLabel,
  buildDurationBudget,
  estimatedShotCount,
  formatSeconds,
  GENRE_PACKS,
  genrePackById,
  lockedShotImplication,
  narrationFromBeats,
  recommendDuration,
  usageRatio
} from '../utils/scriptBudget';
import {
  applyGenrePack,
  applyHoldToWorkspace,
  applyResearchNoteToHook,
  applyResearchNoteToTopic,
  canApplyStoryboard,
  diagnoseExistingScript,
  fallbackDraft,
  fallbackTopicCards,
  forecastScriptHash,
  forecastSummary,
  forecastToClips,
  hookPreviewText,
  resolveStoryboardApplyMode,
  stampAppliedWorkspace,
  stylePackFingerprint,
  mixTopicCards,
  rebuildForecast,
  refreshWorkspaceDerived,
  RESEARCH_DRAG_MIME,
  RESEARCH_FIELDS,
  stageCompleted,
  workspaceTopicTitle
} from '../utils/scriptWorkspace';
import { bgmById } from '../utils/presets';
import { showStatusToast } from '../utils/statusToast';
import {
  bibleSummary,
  characterRefPreview,
  characterHasRef,
  clearCharacterRef,
  continuityShortLabel,
  fallbackVisualBible,
  isVisualBibleStale,
  leadCharacter,
  mergeVisualBible,
  normalizeVisualBible,
  setCharacterRef,
  toggleCharacterLock,
  updateCharacterField,
  visualBibleModeForGenre
} from '../utils/visualBible';
import { prepareCharacterRefFile } from '../utils/characterRef';

interface ScriptPanelProps {
  workspace: ScriptWorkspace;
  onChange: (workspace: ScriptWorkspace) => void;
  onTopicChange: (topic: string) => void;
  onClipsChange: (clips: StoryboardClip[]) => void;
  visualStyle: VisualStyle;
  stylePack?: StylePack;
  aspectRatio?: AspectRatio;
  customLlmApi?: CustomLlmApiConfig;
  customTtsApi?: CustomTtsApiConfig;
  voiceCharacter?: string;
  speechRate?: number;
  onSelectClip: (clipId: string) => void;
  onOpenStoryboard?: () => void;
  onNeedFullNarration?: (clips: StoryboardClip[]) => void;
  onApplyStyleOnly?: () => void;
  existingClips?: StoryboardClip[];
  isApplyingStyle?: boolean;
  onRecommendBgm?: (trackId: string) => void;
  isGeneratingNarration?: boolean;
  narrationError?: string | null;
  narrationFresh?: boolean;
  isPlaying?: boolean;
  currentTime?: number;
  onTogglePlay?: () => void;
  sentenceGap?: number;
}

const INTENT_CARDS: {
  id: ScriptIntent;
  title: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  { id: 'blank', title: '今天不知道拍什么', desc: '给你三张可拍的选题卡', icon: <Lightbulb className="w-5 h-5" /> },
  { id: 'direction', title: '有方向没题目', desc: '一句话扩成三个不同角度', icon: <Sparkles className="w-5 h-5" /> },
  { id: 'product', title: '有产品 / 账号', desc: '卖点变成可拍场景', icon: <Package className="w-5 h-5" /> },
  { id: 'reference', title: '有对标', desc: '保留节奏，换角度', icon: <Link2 className="w-5 h-5" /> },
  { id: 'have-script', title: '已有文案', desc: '粘贴口播，诊断时长和切镜', icon: <FileText className="w-5 h-5" /> }
];

const ENERGY_LABEL: Record<ShotEnergy, string> = {
  fast: '快',
  medium: '中',
  slow: '慢',
  hold: '停'
};

const ENERGY_COLOR: Record<ShotEnergy, string> = {
  fast: 'bg-orange-400',
  medium: 'bg-amber-400',
  slow: 'bg-sky-400',
  hold: 'bg-violet-400'
};

const FUNCTION_LABEL: Record<BeatFunction, string> = {
  hook: '钩子',
  setup: '铺垫',
  turn: '转折',
  proof: '证据',
  reveal: '揭示',
  cta: '收束'
};

export const ScriptPanel: React.FC<ScriptPanelProps> = ({
  workspace,
  onChange,
  onTopicChange,
  onClipsChange,
  visualStyle,
  stylePack,
  aspectRatio = '16:9',
  customLlmApi,
  customTtsApi,
  voiceCharacter = 'magnetic-male',
  speechRate = 1,
  onSelectClip,
  onOpenStoryboard,
  onNeedFullNarration,
  onApplyStyleOnly,
  existingClips = [],
  isApplyingStyle = false,
  onRecommendBgm,
  isGeneratingNarration = false,
  narrationError = null,
  narrationFresh = false,
  isPlaying = false,
  currentTime = 0,
  onTogglePlay,
  sentenceGap = 0.2
}) => {
  const [busy, setBusy] = useState<'topics' | 'draft' | 'research' | 'reference' | 'concepts' | 'preview' | 'bible' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const handleGenrePack = (genre: ScriptGenre) => {
    onChange(applyGenrePack(workspace, genre));
    const pack = genrePackById(genre);
    if (pack?.bgmTrackId) onRecommendBgm?.(pack.bgmTrackId);
    const track = pack?.bgmTrackId ? bgmById(pack.bgmTrackId) : null;
    setStatus(track ? `已套 ${genre} 体裁包，配乐切到「${track.title.replace(/^[^\s]+\s*/, '')}」` : `已套 ${genre} 体裁包`);
    setError(null);
  };

  const selected = workspace.topicCards.find((card) => card.id === workspace.selectedTopicId) || null;
  const chars = workspace.durationBudget.usedChars;
  const applyReady = canApplyStoryboard(workspace);
  const topicTitle = workspaceTopicTitle(workspace, '未选题');

  const commit = (next: ScriptWorkspace) => {
    onChange(refreshWorkspaceDerived(next));
  };

  const setStage = (stage: ScriptStage) => commit({ ...workspace, stage, gate: 'deep' });

  const handleFastGate = async () => {
    if (workspace.intent === 'have-script' && (workspace.fullNarration || workspace.intentNotes).trim()) {
      await handleDiagnose();
      return;
    }
    if (workspace.selectedTopicId && (selected || workspace.intentNotes.trim())) {
      await handleDraft();
      return;
    }
    if (workspace.intent === 'reference' && workspace.referenceUrl.trim()) {
      await handleReference();
      return;
    }
    await handleScoutTopics();
  };

  const handleScoutTopics = async () => {
    if (workspace.intent === 'direction' || workspace.intent === 'product' || workspace.intent === 'reference') {
      if (!workspace.intentNotes.trim()) {
        setError('先写一句话，再出选题卡');
        return;
      }
    }
    setBusy('topics');
    setError(null);
    setStatus('正在找三个不同角度...');
    try {
      const res = await fetch('/api/script/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: workspace.intent || 'blank',
          intentNotes: workspace.intentNotes,
          platform: workspace.durationBudget.platform,
          pace: workspace.durationBudget.pace,
          researchNotes: workspace.researchNotes,
          researchBrief: workspace.researchBrief,
          genrePackId: workspace.genrePackId,
          llmApi: customLlmApi
        })
      });
      const data = await res.json().catch(() => ({}));
      const cards: TopicCard[] = Array.isArray(data?.cards) && data.cards.length > 0
        ? data.cards.slice(0, 3)
        : fallbackTopicCards(workspace.intentNotes, workspace.intent);
      commit({
        ...workspace,
        gate: 'fast',
        topicCards: cards,
        selectedTopicId: null,
        stage: 'topic'
      });
      setStatus('选出一张卡。点卡只锁题，不会写全文。');
    } catch {
      const cards = fallbackTopicCards(workspace.intentNotes, workspace.intent);
      commit({ ...workspace, gate: 'fast', topicCards: cards, selectedTopicId: null, stage: 'topic' });
      setStatus('网络不可用，已用本地选题卡。');
    } finally {
      setBusy(null);
    }
  };

  const handleSelectCard = (card: TopicCard) => {
    const rec = recommendDuration(workspace.durationBudget.platform, card.genre, card.conceptCount);
    const durationBudget = buildDurationBudget({
      platform: workspace.durationBudget.platform,
      pace: card.paceHint || rec.pace,
      targetSeconds: card.durationHint || rec.seconds,
      usedChars: chars,
      conceptUsed: card.conceptCount
    });
    onTopicChange(card.title);
    commit({
      ...workspace,
      selectedTopicId: card.id,
      durationBudget,
      stage: 'duration',
      gate: workspace.gate
    });
    setStatus(rec.reason);
    setError(null);
  };

  const handleDraft = async () => {
    const topic = selected?.title || workspace.intentNotes.trim();
    if (!topic) {
      setError('先选定选题，或在意图里写方向');
      return;
    }
    setBusy('draft');
    setError(null);
    setStatus('按字数预算写节拍和口播...');
    try {
      const res = await fetch('/api/script/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          topicCard: selected,
          intent: workspace.intent,
          intentNotes: workspace.intentNotes,
          researchNotes: workspace.researchNotes,
          budget: workspace.durationBudget,
          genrePack: genrePackById(workspace.genrePackId || selected?.genre || null),
          llmApi: customLlmApi,
          stylePack
        })
      });
      const data = await res.json().catch(() => ({}));
      await applyDraftResult(data, topic);
    } catch {
      await applyDraftResult(null, topic);
    } finally {
      setBusy(null);
    }
  };

  const ensureVisualBible = async (base: ScriptWorkspace, narration: string): Promise<ScriptWorkspace> => {
    if (countNarrationChars(narration) < 8) return base;
    const genre = base.genrePackId || selected?.genre || null;
    try {
      const res = await fetch('/api/script/visual-bible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          narration,
          genre,
          title: selected?.title || topicTitle,
          stylePack,
          llmApi: customLlmApi,
          previousBible: base.visualBible
        })
      });
      const data = await res.json().catch(() => ({}));
      const incoming = normalizeVisualBible(data?.bible, visualBibleModeForGenre(genre));
      const bible = incoming
        ? mergeVisualBible(base.visualBible, incoming)
        : mergeVisualBible(base.visualBible, fallbackVisualBible({ narration, genre, title: selected?.title }));
      return { ...base, visualBible: bible };
    } catch {
      return {
        ...base,
        visualBible: mergeVisualBible(base.visualBible, fallbackVisualBible({ narration, genre, title: selected?.title }))
      };
    }
  };

  const refineSpeechSpans = async (base: ScriptWorkspace, narration: string): Promise<ScriptWorkspace> => {
    try {
      const res = await fetch('/api/script/split-spans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          narration,
          llmApi: customLlmApi,
          visualBible: base.visualBible,
          genre: base.genrePackId || selected?.genre || null
        })
      });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.spans) && data.spans.length > 0) {
        return rebuildForecast({ ...base, fullNarration: narration, speechSpans: data.spans });
      }
    } catch {
      // local sentence + contrast visuals
    }
    return rebuildForecast({ ...base, fullNarration: narration, speechSpans: [] });
  };

  const refineCoverage = async (base: ScriptWorkspace): Promise<ScriptWorkspace> => {
    const shots = base.forecastShots || [];
    if (shots.length < 2) return base;
    try {
      const res = await fetch('/api/script/coverage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shots: shots.map((shot) => ({
            id: shot.id,
            function: shot.function,
            voRole: shot.voRole,
            splitReason: shot.splitReason,
            sliceText: shot.sliceText,
            narration: shot.narration,
            visualIntent: shot.visualIntent
          })),
          visualBible: base.visualBible,
          genre: base.genrePackId || selected?.genre || null,
          stylePack,
          llmApi: customLlmApi
        })
      });
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data?.shots) && data.shots.length === shots.length) {
        return { ...base, forecastShots: applyLlmCoverage(shots, data.shots) };
      }
    } catch {
      // keep rule coverage from rebuildForecast
    }
    return base;
  };

  const applyDraftResult = async (data: any, topic: string) => {
    const fallback = fallbackDraft({
      topic,
      hook: selected?.hook,
      genre: selected?.genre,
      maxChars: workspace.durationBudget.maxChars
    });
    const beats = Array.isArray(data?.beats) && data.beats.length >= 2 ? data.beats : fallback.beats;
    const fullNarration = typeof data?.fullNarration === 'string' && data.fullNarration.trim()
      ? data.fullNarration.trim()
      : fallback.fullNarration;
    const drafted: ScriptWorkspace = {
      ...workspace,
      beats: beats.map((beat: any, index: number) => ({
        id: beat.id || `beat-${index + 1}`,
        order: index + 1,
        function: beat.function || 'setup',
        intent: beat.intent || beatIntentLabel(beat.function || 'setup'),
        narration: beat.narration || '',
        targetSeconds: Number(beat.targetSeconds) || 0,
        energy: beat.energy || 'medium',
        visualIntent: beat.visualIntent || '',
        needsHold: Boolean(beat.needsHold)
      })),
      fullNarration,
      speechSpans: [],
      stage: 'copy',
      gate: 'fast'
    };
    const withBible = await ensureVisualBible(drafted, fullNarration);
    const spanned = await refineSpeechSpans(withBible, fullNarration);
    const next = await refineCoverage(spanned);
    if (typeof data?.title === 'string' && data.title.trim()) {
      onTopicChange(data.title.trim());
    }
    onChange(next);
    setStatus(
      withBible.visualBible?.mode === 'story'
        ? '已编画面圣经。同一角色会贯穿各镜，对照句仍同一口气两张图。'
        : '口播按整句切开。对照句会同一口气、两张画面。'
    );
  };

  const handleDiagnose = async () => {
    const pasted = (workspace.fullNarration || workspace.intentNotes || '').trim();
    if (countNarrationChars(pasted) < 8) {
      setError('先把已有口播粘贴进来');
      return;
    }
    const diagnosed = diagnoseExistingScript({
      ...workspace,
      fullNarration: pasted,
      intentNotes: workspace.intentNotes || pasted,
      speechSpans: [],
      gate: 'fast'
    });
    const withBible = await ensureVisualBible(diagnosed, pasted);
    const spanned = await refineSpeechSpans(withBible, pasted);
    const next = await refineCoverage(spanned);
    onChange(next);
    setStatus(
      withBible.visualBible?.mode === 'story'
        ? '已按整句切口播，并编了画面圣经。'
        : '已按整句切口播；一句里若有对照，会切两张图。'
    );
    setError(null);
  };

  const applyMode = resolveStoryboardApplyMode({
    workspace,
    stylePack,
    clipCount: existingClips.length
  });

  const handleRebuildBible = async () => {
    const narration = workspace.fullNarration.trim();
    if (countNarrationChars(narration) < 8) {
      setError('先写出口播，再编画面圣经');
      return;
    }
    setBusy('bible');
    setError(null);
    try {
      const next = await ensureVisualBible({
        ...workspace,
        visualBible: workspace.visualBible ? { ...workspace.visualBible, pinned: false } : null
      }, narration);
      const covered = await refineCoverage(rebuildForecast(next));
      onChange(covered);
      setStatus(next.visualBible?.mode === 'story' ? '画面圣经已更新，角色会贯穿各镜' : '画面约束已更新');
    } finally {
      setBusy(null);
    }
  };

  const handleApply = () => {
    if (!applyReady) return;
    const clips = forecastToClips(
      workspace.forecastShots,
      visualStyle,
      aspectRatio,
      stylePack,
      existingClips,
      workspace.visualBible,
      sentenceGap
    );
    commit(stampAppliedWorkspace(workspace, workspace.forecastShots, stylePack, clips.length));
    onNeedFullNarration?.(clips);
    setStatus(`已写入 ${clips.length} 镜。机位已按全片设计，对照句同一口气配两图。`);
  };

  const handleStyleOnly = () => {
    if (!existingClips.length) {
      setError('还没有分镜，请先写入分镜');
      return;
    }
    onApplyStyleOnly?.();
    commit({
      ...workspace,
      appliedAt: Date.now(),
      appliedShotCount: workspace.appliedShotCount || existingClips.length,
      appliedScriptHash: workspace.appliedScriptHash || forecastScriptHash(workspace.forecastShots),
      appliedStyleFingerprint: stylePackFingerprint(stylePack)
    });
    setStatus('画面词已写入分镜，可去分镜表查看。尚未生图。');
    setError(null);
  };

  const handleHoldChange = (shotId: string, holdDuration: number) => {
    onChange(applyHoldToWorkspace(workspace, shotId, holdDuration));
  };

  const handleFillHook = (key: keyof ResearchNotes) => {
    const value = (workspace.researchNotes[key] || '').trim();
    if (!value) {
      setError('这条笔记还是空的');
      return;
    }
    onChange(applyResearchNoteToHook(workspace, key));
    setError(null);
    setStatus(key === 'visualRef' ? '画面笔记已填进钩子镜的画面意图。' : '已把这条笔记填进钩子。');
  };

  const handleResearch = async () => {
    const topic = selected?.title || workspace.intentNotes.trim() || workspaceTopicTitle(workspace);
    if (!topic && !workspace.referenceUrl.trim()) {
      setError('先写主题或贴对标链接');
      return;
    }
    setBusy('research');
    setError(null);
    setStatus('四刀浅调研进行中：对标 / 受众 / 事实 / 画面...');
    try {
      const res = await fetch('/api/script/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          intentNotes: workspace.intentNotes,
          referenceUrl: workspace.referenceUrl,
          platform: workspace.durationBudget.platform,
          llmApi: customLlmApi
        })
      });
      const data = await res.json().catch(() => ({}));
      commit({
        ...workspace,
        researchBrief: {
          summary: data.summary || '',
          blades: Array.isArray(data.blades) ? data.blades : [],
          notes: { ...workspace.researchNotes, ...(data.notes || {}) },
          source: data.source || 'model',
          fetchedAt: data.fetchedAt || Date.now()
        },
        researchNotes: { ...workspace.researchNotes, ...(data.notes || {}) },
        stage: 'research',
        gate: 'deep'
      });
      setStatus(data.source === 'model' ? '网页没搜到多少，已用模型归纳。可改笔记再出概念。' : '四刀有结果。可填进钩子，或根据调研出三个概念。');
    } catch {
      setError('浅调研失败，先手写四条笔记也能继续。');
    } finally {
      setBusy(null);
    }
  };

  const handleReference = async () => {
    const url = workspace.referenceUrl.trim();
    if (!url) {
      setError('先粘贴对标链接');
      return;
    }
    setBusy('reference');
    setError(null);
    setStatus('正在反拆对标：保留什么、改什么...');
    try {
      const res = await fetch('/api/script/reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          topic: selected?.title || workspace.intentNotes,
          intentNotes: workspace.intentNotes,
          llmApi: customLlmApi
        })
      });
      const data = await res.json().catch(() => ({}));
      const cards: TopicCard[] = Array.isArray(data?.cards) && data.cards.length > 0
        ? data.cards.slice(0, 3)
        : fallbackTopicCards(workspace.intentNotes, 'reference');
      commit({
        ...workspace,
        topicCards: cards,
        selectedTopicId: null,
        referenceBreakdown: {
          url,
          title: data.title || url,
          keep: data.keep || [],
          change: data.change || [],
          whyBetter: data.whyBetter || '',
          hookStyle: data.hookStyle || '',
          pacingNote: data.pacingNote || ''
        },
        stage: 'topic',
        gate: 'fast'
      });
      setStatus('对标已拆。选出一张，或杂交钩子和结构。');
    } catch {
      setError('对标链接打不开，改成描述也可以选题。');
    } finally {
      setBusy(null);
    }
  };

  const handleConcepts = async () => {
    setBusy('concepts');
    setError(null);
    setStatus('按调研出三个不同结构的概念...');
    try {
      const res = await fetch('/api/script/concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: selected?.title || workspace.intentNotes,
          intentNotes: workspace.intentNotes,
          researchNotes: workspace.researchNotes,
          researchBrief: workspace.researchBrief,
          genrePackId: workspace.genrePackId,
          llmApi: customLlmApi
        })
      });
      const data = await res.json().catch(() => ({}));
      const cards: TopicCard[] = Array.isArray(data?.cards) && data.cards.length > 0
        ? data.cards.slice(0, 3)
        : fallbackTopicCards(workspace.intentNotes, workspace.intent);
      commit({
        ...workspace,
        topicCards: cards,
        selectedTopicId: null,
        conceptMix: { hookFromId: cards[0]?.id || null, structureFromId: cards[1]?.id || cards[0]?.id || null },
        stage: 'topic',
        gate: 'deep'
      });
      setStatus('三个概念的结构应不同。可以杂交。');
    } catch {
      setError('概念生成失败，用手写方向再点给我选题。');
    } finally {
      setBusy(null);
    }
  };

  const handleMix = () => {
    if (!workspace.conceptMix.hookFromId || !workspace.conceptMix.structureFromId) {
      setError('先选钩子来自哪张、结构来自哪张');
      return;
    }
    const mixed = mixTopicCards(workspace);
    const card = mixed.topicCards.find((item) => item.id === mixed.selectedTopicId);
    if (card) {
      const rec = recommendDuration(mixed.durationBudget.platform, card.genre, card.conceptCount);
      onTopicChange(card.title);
      onChange(refreshWorkspaceDerived({
        ...mixed,
        durationBudget: buildDurationBudget({
          ...mixed.durationBudget,
          pace: card.paceHint || rec.pace,
          targetSeconds: card.durationHint || rec.seconds,
          conceptUsed: card.conceptCount
        }),
        stage: 'duration'
      }));
      setStatus(card.whyThisWorks || rec.reason);
      setError(null);
      return;
    }
    setError('杂交失败，换两张卡再试');
  };

  const stopPreview = () => {
    const audio = previewAudioRef.current;
    if (audio) {
      try {
        audio.pause();
        audio.src = '';
      } catch {
        // ignore
      }
    }
    previewAudioRef.current = null;
    setPreviewPlaying(false);
  };

  const handlePreviewHook = async () => {
    if (previewPlaying) {
      stopPreview();
      return;
    }
    const text = hookPreviewText(workspace);
    if (!text) {
      setError('先写出口播或钩子节拍，再试听');
      return;
    }
    setBusy('preview');
    setError(null);
    setStatus('在合成约 8 秒钩子试听...');
    try {
      const res = await fetch('/api/audio/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          character: voiceCharacter,
          rate: speechRate,
          ttsApi: customTtsApi
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.audioUrl) {
        throw new Error(data.error || '试听合成失败');
      }
      stopPreview();
      const audio = new Audio(data.audioUrl);
      previewAudioRef.current = audio;
      audio.onended = () => setPreviewPlaying(false);
      audio.onerror = () => {
        setPreviewPlaying(false);
        setError('试听音频播放失败');
      };
      await audio.play();
      setPreviewPlaying(true);
      commit({ ...workspace, hookPreviewUrl: data.audioUrl });
      setStatus('这是钩子约 8 秒，不是整段旁白。');
    } catch (err: any) {
      setError(err?.message || '试听失败');
    } finally {
      setBusy(null);
    }
  };

  const fastGateLabel = useMemo(() => {
    if (workspace.intent === 'have-script' && (workspace.fullNarration || workspace.intentNotes).trim()) {
      return '诊断并拆分';
    }
    if (workspace.selectedTopicId) return '按预算写稿';
    if (workspace.intent === 'reference' && workspace.referenceUrl.trim()) return '反拆对标';
    return '给我选题';
  }, [workspace]);

  return (
    <section
      id="script-workspace"
      className="flex-1 min-w-0 bg-[#131318] border border-[#23232c] rounded-2xl flex flex-col h-full overflow-hidden shadow-xl shadow-black/40"
    >
      <header className="px-6 py-4 border-b border-[#23232c] bg-[#16161c] flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <PenLine className="w-4 h-4 text-amber-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100">文案预制作台</h2>
            <p className="text-[12px] text-zinc-500 mt-0.5 truncate">
              先选题，再定时长，最后写口播。预览已收起，把空间留给结构。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="hidden md:inline-flex text-[11px] px-2.5 py-1 rounded-full border bg-zinc-800 text-zinc-400 border-zinc-700 max-w-[220px] truncate">
            {topicTitle}
          </span>
          <button
            id="btn-script-fast-gate"
            type="button"
            onClick={handleFastGate}
            disabled={Boolean(busy)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
          >
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
            快闸 · {fastGateLabel}
          </button>
          <button
            id="btn-hook-preview"
            type="button"
            onClick={handlePreviewHook}
            disabled={busy === 'preview'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border border-[#2b2b36] text-zinc-200 hover:border-amber-500/40 cursor-pointer disabled:opacity-50"
          >
            {busy === 'preview' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : previewPlaying ? <Pause className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            {previewPlaying ? '停试听' : '试听钩子 8秒'}
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <nav className="w-52 lg:w-56 flex-shrink-0 border-r border-[#23232c] bg-[#14141a] p-3 space-y-1 overflow-y-auto custom-scrollbar">
          {STAGE_META.map((item) => {
            const active = workspace.stage === item.id;
            const done = stageCompleted(workspace, item.id);
            return (
              <button
                key={item.id}
                id={`script-nav-${item.id}`}
                type="button"
                onClick={() => setStage(item.id)}
                className={`w-full text-left rounded-xl px-3 py-2.5 flex items-start gap-2.5 transition-all cursor-pointer ${
                  active
                    ? 'bg-amber-500/12 border border-amber-500/35 text-amber-200'
                    : 'border border-transparent text-zinc-400 hover:bg-[#1c1c24] hover:text-zinc-200'
                }`}
              >
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  done === 'skipped' ? 'bg-zinc-600' : done ? 'bg-emerald-400' : 'bg-zinc-600'
                }`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-zinc-100">{item.label}</span>
                    {done === 'skipped' && (
                      <span className="text-[9px] text-zinc-500 border border-zinc-700 rounded px-1 py-px">跳过</span>
                    )}
                  </span>
                  <span className="block text-[11px] text-zinc-500 mt-0.5 leading-snug">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div key={workspace.stage} className="flex-1 min-w-0 overflow-y-auto custom-scrollbar bg-[#121217] p-5 lg:p-6">
          {workspace.stage === 'intent' && (
            <IntentStage
              workspace={workspace}
              busy={busy === 'topics' || busy === 'reference'}
              onIntent={(intent) => commit({ ...workspace, intent })}
              onNotes={(intentNotes) => commit({ ...workspace, intentNotes })}
              onReferenceUrl={(referenceUrl) => commit({ ...workspace, referenceUrl })}
              onPlatform={(platform) => commit({ ...workspace, durationBudget: buildDurationBudget({ ...workspace.durationBudget, platform }) })}
              onPace={(pace) => commit({ ...workspace, durationBudget: buildDurationBudget({ ...workspace.durationBudget, pace }) })}
              onGenrePack={handleGenrePack}
              onScout={handleScoutTopics}
              onDiagnose={handleDiagnose}
              onReference={handleReference}
            />
          )}
          {workspace.stage === 'topic' && (
            <TopicStage
              workspace={workspace}
              selectedId={workspace.selectedTopicId}
              busy={busy === 'topics' || busy === 'concepts'}
              onScout={handleScoutTopics}
              onSelect={handleSelectCard}
              onDropResearch={(topicId, key) => {
                onChange(applyResearchNoteToTopic(workspace, topicId, key));
                setStatus('钩子已换成这条调研笔记。');
              }}
              onMixChange={(conceptMix) => commit({ ...workspace, conceptMix })}
              onMix={handleMix}
            />
          )}
          {workspace.stage === 'research' && (
            <ResearchStage
              workspace={workspace}
              busy={busy === 'research' || busy === 'concepts'}
              onChange={(researchNotes) => commit({ ...workspace, researchNotes })}
              onReferenceUrl={(referenceUrl) => commit({ ...workspace, referenceUrl })}
              onFillHook={handleFillHook}
              onResearch={handleResearch}
              onConcepts={handleConcepts}
            />
          )}
          {workspace.stage === 'duration' && (
            <DurationStage
              workspace={workspace}
              selected={selected}
              busy={busy === 'draft'}
              onBudget={(durationBudget) => {
                const next = { ...workspace, durationBudget };
                onChange(workspace.fullNarration.trim() ? rebuildForecast(next) : refreshWorkspaceDerived(next));
              }}
              onDraft={handleDraft}
              onGenrePack={handleGenrePack}
            />
          )}
          {workspace.stage === 'beats' && (
            <BeatsStage
              workspace={workspace}
              onChange={(beats) => {
                const fullNarration = narrationFromBeats(beats);
                onChange(rebuildForecast({ ...workspace, beats, fullNarration }));
              }}
              onFillHook={handleFillHook}
            />
          )}
          {workspace.stage === 'copy' && (
            <CopyStage
              workspace={workspace}
              onChange={(fullNarration) => {
                const beats = applyNarrationToBeats(workspace.beats, fullNarration);
                onChange(rebuildForecast({ ...workspace, fullNarration, beats }));
              }}
              onDraft={handleDraft}
              onDiagnose={handleDiagnose}
              busy={Boolean(busy)}
              onHoldChange={handleHoldChange}
              onFillHook={handleFillHook}
            />
          )}
          {workspace.stage === 'rhythm' && (
            <RhythmStage workspace={workspace} onHoldChange={handleHoldChange} />
          )}
        </div>

        <aside className="hidden xl:flex w-72 flex-shrink-0 border-l border-[#23232c] bg-[#14141a] flex-col overflow-hidden">
          <DirectorRail
            workspace={workspace}
            onChange={onChange}
            onRebuildBible={() => void handleRebuildBible()}
            bibleBusy={busy === 'bible'}
          />
        </aside>
      </div>

      <div className="xl:hidden border-t border-[#23232c] bg-[#14141a] px-5 py-3">
        <DirectorRail
          workspace={workspace}
          onChange={onChange}
          onRebuildBible={() => void handleRebuildBible()}
          bibleBusy={busy === 'bible'}
          compact
        />
      </div>

      <footer className="px-5 py-3 border-t border-[#23232c] bg-[#16161c] flex flex-wrap items-center gap-3 flex-shrink-0">
        <button
          id="btn-apply-storyboard"
          type="button"
          onClick={applyMode.mode === 'style-only' ? handleStyleOnly : handleApply}
          disabled={!applyReady || isGeneratingNarration || isApplyingStyle || applyMode.mode === 'current'}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold bg-gradient-to-r from-amber-500 to-orange-500 text-black disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Clapperboard className="w-4 h-4" />
          {applyMode.mode === 'style-only'
            ? '只更新画面，旁白沿用'
            : applyMode.mode === 'current'
              ? '已是当前稿'
              : '写入分镜'}
        </button>
        {applyMode.mode === 'style-only' && (
          <button
            type="button"
            onClick={handleApply}
            disabled={!applyReady || isGeneratingNarration}
            className="text-[12px] text-zinc-400 hover:text-zinc-200 cursor-pointer disabled:opacity-40"
          >
            整表重写并重新配音
          </button>
        )}
        {applyMode.mode === 'full' && existingClips.length >= 2 && (
          <button
            type="button"
            onClick={handleStyleOnly}
            disabled={isApplyingStyle || isGeneratingNarration}
            className="text-[12px] text-zinc-400 hover:text-zinc-200 cursor-pointer disabled:opacity-40"
          >
            只更新画面，旁白沿用
          </button>
        )}
        {existingClips.length > 0 && onTogglePlay && (
          <button
            type="button"
            onClick={onTogglePlay}
            title="空格也可播放/暂停"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#2e2e3a] text-[12px] text-zinc-200 hover:border-amber-500/40 hover:text-amber-300 cursor-pointer"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            {isPlaying ? '暂停预览' : '播放预览'}
            <span className="font-mono text-[10px] text-zinc-500">
              {currentTime.toFixed(1)}s
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={() => onOpenStoryboard?.()}
          className="inline-flex items-center gap-1 text-[12px] text-amber-400 hover:text-amber-300 cursor-pointer"
        >
          进入分镜台
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
        <span className="text-[11px] text-zinc-500 flex-1 min-w-[160px]">
          {applyMode.mode === 'style-only'
            ? '口播未改，风格已变'
            : applyMode.mode === 'current'
              ? '结构和风格都已是当前稿'
              : workspace.appliedShotCount
                ? `上次写入 ${workspace.appliedShotCount} 镜`
                : forecastSummary(workspace)}
        </span>
        {(status || error) && (
          <span className={`text-[11px] max-w-md truncate ${error ? 'text-rose-300' : 'text-amber-300'}`}>
            {error || status}
          </span>
        )}
      </footer>
    </section>
  );
};

function IntentStage({
  workspace,
  busy,
  onIntent,
  onNotes,
  onReferenceUrl,
  onPlatform,
  onPace,
  onGenrePack,
  onScout,
  onDiagnose,
  onReference
}: {
  workspace: ScriptWorkspace;
  busy: boolean;
  onIntent: (intent: ScriptIntent) => void;
  onNotes: (value: string) => void;
  onReferenceUrl: (value: string) => void;
  onPlatform: (platform: ScriptPlatform) => void;
  onPace: (pace: ScriptPace) => void;
  onGenrePack: (genre: ScriptGenre) => void;
  onScout: () => void;
  onDiagnose: () => void;
  onReference: () => void;
}) {
  const intent = workspace.intent;
  const placeholder = intent === 'product'
    ? '产品是什么，卖给谁，最想强调哪一句'
    : intent === 'reference'
      ? '对标片讲了什么；有链接更好，没有就写钩子怎么开'
      : intent === 'have-script'
        ? '把整段口播贴在这里'
        : intent === 'direction'
          ? '比如：想讲咖啡因对睡眠的影响'
          : '可选：一个关键词，或直接给我选题';

  return (
    <div className="space-y-5 max-w-5xl">
      <SectionIntro title="从哪一步开始" desc="点一张入口卡。快闸会按这条路往下走，不会一上来写全文。" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
        {INTENT_CARDS.map((card) => {
          const active = intent === card.id;
          return (
            <button
              key={card.id}
              id={`intent-${card.id}`}
              type="button"
              onClick={() => onIntent(card.id)}
              className={`text-left rounded-2xl border px-3.5 py-3.5 transition-all cursor-pointer ${
                active
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-[#2b2b36] bg-[#18181f] hover:border-amber-500/30'
              }`}
            >
              <div className={`${active ? 'text-amber-400' : 'text-zinc-500'}`}>{card.icon}</div>
              <div className="mt-2 text-[13px] font-medium text-zinc-100 leading-snug">{card.title}</div>
              <div className="mt-1 text-[11px] text-zinc-500 leading-relaxed">{card.desc}</div>
            </button>
          );
        })}
      </div>

      {intent && (
        <div className="space-y-3 rounded-2xl border border-[#2b2b36] bg-[#18181f] p-4">
          <label className="text-[12px] text-zinc-400">
            {intent === 'have-script' ? '已有口播' : '补充一句（可空，空白灵感除外）'}
          </label>
          <textarea
            value={workspace.intentNotes}
            onChange={(e) => onNotes(e.target.value)}
            rows={intent === 'have-script' ? 8 : 3}
            placeholder={placeholder}
            className="w-full bg-[#121217] border border-[#2b2b36] rounded-xl p-3 text-[13px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 resize-none leading-relaxed select-text"
          />
          {(intent === 'reference' || intent === 'direction') && (
            <input
              id="input-reference-url"
              value={workspace.referenceUrl}
              onChange={(e) => onReferenceUrl(e.target.value)}
              placeholder="对标链接（YouTube / B 站 / 网页，可空）"
              className="w-full bg-[#121217] border border-[#2b2b36] rounded-xl px-3 py-2 text-[13px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 select-text"
            />
          )}
          <div className="flex flex-wrap gap-2">
            {GENRE_PACKS.map((pack) => (
              <Chip
                key={pack.id}
                active={workspace.genrePackId === pack.id}
                onClick={() => onGenrePack(pack.id)}
              >
                {pack.id}
              </Chip>
            ))}
          </div>
          {workspace.genrePackId && bgmById(genrePackById(workspace.genrePackId)?.bgmTrackId || '') && (
            <p className="text-[11px] text-zinc-500">
              配乐已切到「{bgmById(genrePackById(workspace.genrePackId)!.bgmTrackId)?.title.replace(/^[^\s]+\s*/, '')}」，可在音频页换曲。
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {PLATFORM_OPTIONS.map((item) => (
              <Chip
                key={item.id}
                active={workspace.durationBudget.platform === item.id}
                onClick={() => onPlatform(item.id)}
              >
                {item.label}
              </Chip>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.values(PACE_PRESETS) as typeof PACE_PRESETS[ScriptPace][]).map((item) => (
              <Chip
                key={item.id}
                active={workspace.durationBudget.pace === item.id}
                onClick={() => onPace(item.id)}
              >
                {item.label} · {item.hint}
              </Chip>
            ))}
          </div>
          {intent === 'have-script' ? (
            <PrimaryButton id="btn-diagnose-script" busy={busy} onClick={onDiagnose}>
              诊断并拆分
            </PrimaryButton>
          ) : intent === 'reference' && workspace.referenceUrl.trim() ? (
            <PrimaryButton id="btn-reverse-reference" busy={busy} onClick={onReference}>
              反拆对标
            </PrimaryButton>
          ) : (
            <PrimaryButton id="btn-scout-topics" busy={busy} onClick={onScout}>
              给我选题
            </PrimaryButton>
          )}
        </div>
      )}
    </div>
  );
}

function TopicStage({
  workspace,
  selectedId,
  busy,
  onScout,
  onSelect,
  onDropResearch,
  onMixChange,
  onMix
}: {
  workspace: ScriptWorkspace;
  selectedId: string | null;
  busy: boolean;
  onScout: () => void;
  onSelect: (card: TopicCard) => void;
  onDropResearch: (topicId: string, key: keyof ResearchNotes) => void;
  onMixChange: (mix: ScriptWorkspace['conceptMix']) => void;
  onMix: () => void;
}) {
  return (
    <div className="space-y-5">
      <SectionIntro title="选出一个洞察" desc="三张卡必须不是同一个意思换标题。点卡只锁题，下一步才定时长。" />
      {workspace.topicCards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#2b2b36] p-8 text-center space-y-3">
          <p className="text-sm text-zinc-400">还没有选题卡。</p>
          <PrimaryButton id="btn-scout-topics" busy={busy} onClick={onScout}>给我选题</PrimaryButton>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {workspace.topicCards.map((card) => {
            const active = selectedId === card.id;
            return (
              <button
                key={card.id}
                id={`topic-card-${card.id}`}
                type="button"
                onClick={() => onSelect(card)}
                onDragOver={(e) => {
                  if (isResearchDragEvent(e)) e.preventDefault();
                }}
                onDrop={(e) => {
                  const key = readResearchDrag(e);
                  if (!key) return;
                  e.preventDefault();
                  onDropResearch(card.id, key);
                }}
                className={`text-left rounded-2xl border p-4 transition-all cursor-pointer ${
                  active ? 'border-amber-500/60 bg-amber-500/10' : 'border-[#2b2b36] bg-[#18181f] hover:border-amber-500/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-amber-400/90">{card.genre} · {card.hookType}</span>
                  <span className="text-[10px] text-zinc-500">{card.durationHint}s · {PACE_PRESETS[card.paceHint]?.label}</span>
                </div>
                <h3 className="mt-2 text-[14px] font-semibold text-zinc-100 leading-snug">{card.title}</h3>
                <p className="mt-2 text-[12px] text-amber-200/90 leading-relaxed">钩子：{card.hook}</p>
                <p className="mt-2 text-[12px] text-zinc-400 leading-relaxed">{card.insight}</p>
                <p className="mt-2 text-[11px] text-zinc-500 leading-relaxed">为什么现在：{card.whyNow}</p>
                {card.structure && <p className="mt-1 text-[10px] text-zinc-500">结构：{card.structure}</p>}
                {card.whyThisWorks && <p className="mt-1 text-[11px] text-zinc-500">{card.whyThisWorks}</p>}
                {card.risk && <p className="mt-2 text-[11px] text-rose-300/80">风险：{card.risk}</p>}
              </button>
            );
          })}
        </div>
      )}
      {workspace.referenceBreakdown && (
        <div className="rounded-2xl border border-[#2b2b36] bg-[#18181f] p-4 space-y-2">
          <div className="text-[12px] font-medium text-zinc-200">对标反拆 · {workspace.referenceBreakdown.title}</div>
          <p className="text-[11px] text-zinc-400">{workspace.referenceBreakdown.whyBetter}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
            <div>
              <div className="text-emerald-300 mb-1">保留</div>
              <ul className="space-y-1 text-zinc-400">
                {workspace.referenceBreakdown.keep.map((item) => <li key={item}>· {item}</li>)}
              </ul>
            </div>
            <div>
              <div className="text-amber-300 mb-1">改掉</div>
              <ul className="space-y-1 text-zinc-400">
                {workspace.referenceBreakdown.change.map((item) => <li key={item}>· {item}</li>)}
              </ul>
            </div>
          </div>
        </div>
      )}
      {workspace.topicCards.length >= 2 && (
        <div className="rounded-2xl border border-[#2b2b36] bg-[#18181f] p-4 space-y-3">
          <div className="text-[12px] text-zinc-300">杂交：A 的钩子 + B 的结构</div>
          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-[11px] text-zinc-500 flex items-center gap-1.5">
              钩子
              <select
                value={workspace.conceptMix.hookFromId || ''}
                onChange={(e) => onMixChange({ ...workspace.conceptMix, hookFromId: e.target.value || null })}
                className="bg-[#121217] border border-[#2b2b36] rounded-lg px-2 py-1 text-zinc-200"
              >
                <option value="">选一张</option>
                {workspace.topicCards.map((card) => (
                  <option key={card.id} value={card.id}>{card.title}</option>
                ))}
              </select>
            </label>
            <label className="text-[11px] text-zinc-500 flex items-center gap-1.5">
              结构
              <select
                value={workspace.conceptMix.structureFromId || ''}
                onChange={(e) => onMixChange({ ...workspace.conceptMix, structureFromId: e.target.value || null })}
                className="bg-[#121217] border border-[#2b2b36] rounded-lg px-2 py-1 text-zinc-200"
              >
                <option value="">选一张</option>
                {workspace.topicCards.map((card) => (
                  <option key={card.id} value={card.id}>{card.title} {card.structure ? `· ${card.structure}` : ''}</option>
                ))}
              </select>
            </label>
            <PrimaryButton id="btn-mix-concepts" busy={busy} onClick={onMix}>采用杂交</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

function ResearchStage({
  workspace,
  busy,
  onChange,
  onReferenceUrl,
  onFillHook,
  onResearch,
  onConcepts
}: {
  workspace: ScriptWorkspace;
  busy: boolean;
  onChange: (notes: ScriptWorkspace['researchNotes']) => void;
  onReferenceUrl: (value: string) => void;
  onFillHook: (key: keyof ResearchNotes) => void;
  onResearch: () => void;
  onConcepts: () => void;
}) {
  const notes = workspace.researchNotes;
  return (
    <div className="space-y-5 max-w-3xl">
      <SectionIntro
        title="浅调研四刀"
        desc="对标、受众、事实、画面。可以联网搜，也可以手写。搜完能一键出三个概念。"
      />
      <input
        value={workspace.referenceUrl}
        onChange={(e) => onReferenceUrl(e.target.value)}
        placeholder="对标链接，可空。有的话会算进对标刀。"
        className="w-full bg-[#18181f] border border-[#2b2b36] rounded-xl px-3 py-2 text-[13px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 select-text"
      />
      <div className="flex flex-wrap gap-2">
        <PrimaryButton id="btn-shallow-research" busy={busy} onClick={onResearch}>开始浅调研</PrimaryButton>
        <button
          type="button"
          onClick={onConcepts}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium border border-[#2b2b36] text-zinc-200 hover:border-amber-500/40 cursor-pointer disabled:opacity-40"
        >
          根据调研出三个概念
        </button>
      </div>
      {workspace.researchBrief && (
        <div className="rounded-2xl border border-[#2b2b36] bg-[#18181f] p-4 space-y-2">
          <div className="text-[12px] text-zinc-200">{workspace.researchBrief.summary}</div>
          <div className="text-[10px] text-zinc-500">来源：{workspace.researchBrief.source === 'web' ? '网页' : workspace.researchBrief.source === 'mixed' ? '网页 + 模型' : '模型归纳'}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {workspace.researchBrief.blades.map((blade) => (
              <div key={blade.id} className="rounded-xl border border-[#2b2b36] p-2.5">
                <div className="text-[11px] text-amber-300">{blade.label}</div>
                <div className="text-[10px] text-zinc-600 truncate">{blade.query}</div>
                <ul className="mt-1 space-y-1">
                  {blade.findings.slice(0, 2).map((hit) => (
                    <li key={hit.url || hit.title} className="text-[11px] text-zinc-400 truncate">
                      {hit.title || hit.snippet}
                    </li>
                  ))}
                  {blade.findings.length === 0 && <li className="text-[11px] text-zinc-600">这刀没搜到</li>}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      <HookDropZone onFillHook={onFillHook} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {RESEARCH_FIELDS.map((field) => (
          <div
            key={field.key}
            className="rounded-2xl border border-[#2b2b36] bg-[#18181f] p-3 space-y-1.5"
          >
            <div
              draggable={Boolean(notes[field.key].trim())}
              onDragStart={(e) => writeResearchDrag(e, field.key)}
              className={`flex items-center justify-between gap-2 ${notes[field.key].trim() ? 'cursor-grab' : ''}`}
            >
              <span className="text-[12px] text-zinc-400">{field.label}</span>
              <button
                type="button"
                disabled={!notes[field.key].trim()}
                onClick={() => onFillHook(field.key)}
                className="text-[11px] text-amber-400 disabled:text-zinc-600 cursor-pointer disabled:cursor-not-allowed"
              >
                填进钩子
              </button>
            </div>
            <textarea
              value={notes[field.key]}
              onChange={(e) => onChange({ ...notes, [field.key]: e.target.value })}
              rows={3}
              placeholder={field.placeholder}
              className="w-full bg-[#121217] border border-[#2b2b36] rounded-xl p-3 text-[13px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 resize-none select-text"
            />
            {notes[field.key].trim() && (
              <p className="text-[10px] text-zinc-600">拖这张卡到选题或钩子槽</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DurationStage({
  workspace,
  selected,
  busy,
  onBudget,
  onDraft,
  onGenrePack
}: {
  workspace: ScriptWorkspace;
  selected: TopicCard | null;
  busy: boolean;
  onBudget: (budget: ScriptWorkspace['durationBudget']) => void;
  onDraft: () => void;
  onGenrePack: (genre: ScriptGenre) => void;
}) {
  const budget = workspace.durationBudget;
  const rec = selected
    ? recommendDuration(budget.platform, selected.genre, selected.conceptCount)
    : null;
  const estimate = estimatedShotCount(budget);
  const lockHint = lockedShotImplication(budget);
  const canDraft = Boolean(selected || workspace.intent === 'have-script' || workspace.intentNotes.trim());

  return (
    <div className="space-y-5 max-w-4xl">
      <SectionIntro
        title="把时长当成预算"
        desc={rec ? rec.reason : '改平台、节奏、秒数，字数和停留会立刻重算。体裁包会带上节拍骨架。'}
      />
      <div className="flex flex-wrap gap-2">
        {GENRE_PACKS.map((pack) => (
          <Chip key={pack.id} active={workspace.genrePackId === pack.id} onClick={() => onGenrePack(pack.id)}>
            {pack.id} · {pack.hint}
          </Chip>
        ))}
      </div>
      {workspace.genrePackId && (
        <p className="text-[11px] text-zinc-500">
          {genrePackById(workspace.genrePackId)?.draftHint} 节拍：{genrePackById(workspace.genrePackId)?.beatPlan.join(' → ')}
          {genrePackById(workspace.genrePackId)?.bgmTrackId && (
            <> · 配乐：{bgmById(genrePackById(workspace.genrePackId)!.bgmTrackId)?.title.replace(/^[^\s]+\s*/, '')}</>
          )}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {PLATFORM_OPTIONS.map((item) => (
          <Chip key={item.id} active={budget.platform === item.id} onClick={() => onBudget(buildDurationBudget({ ...budget, platform: item.id }))}>
            {item.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.values(PACE_PRESETS) as typeof PACE_PRESETS[ScriptPace][]).map((item) => (
          <Chip key={item.id} active={budget.pace === item.id} onClick={() => onBudget(buildDurationBudget({ ...budget, pace: item.id }))}>
            {item.label} {item.cps}字/秒
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {TARGET_SECONDS_PRESETS.map((seconds) => (
          <Chip key={seconds} active={budget.targetSeconds === seconds} onClick={() => onBudget(buildDurationBudget({ ...budget, targetSeconds: seconds }))}>
            {seconds}s
          </Chip>
        ))}
        <label className="text-[11px] text-zinc-500 flex items-center gap-1.5">
          自定义
          <input
            type="number"
            min={8}
            max={180}
            value={budget.targetSeconds}
            onChange={(e) => onBudget(buildDurationBudget({ ...budget, targetSeconds: Number(e.target.value) }))}
            className="w-16 bg-[#18181f] border border-[#2b2b36] rounded-lg px-2 py-1 text-zinc-200 text-[12px]"
          />
        </label>
        <label className="text-[11px] text-zinc-500 flex items-center gap-1.5">
          锁镜数
          <input
            type="number"
            min={2}
            max={24}
            placeholder="自动"
            value={budget.lockedShotCount ?? ''}
            onChange={(e) => onBudget(buildDurationBudget({
              ...budget,
              lockedShotCount: e.target.value ? Number(e.target.value) : null
            }))}
            className="w-16 bg-[#18181f] border border-[#2b2b36] rounded-lg px-2 py-1 text-zinc-200 text-[12px]"
          />
        </label>
      </div>

      {lockHint && (
        <div className={`rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed ${
          lockHint.pulled
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
            : 'border-[#2b2b36] bg-[#18181f] text-zinc-400'
        }`}>
          {lockHint.message}
          {lockHint.pulled && (
            <button
              type="button"
              onClick={() => onBudget(buildDurationBudget({ ...budget, pace: lockHint.nearestPace }))}
              className="ml-2 text-amber-300 underline cursor-pointer"
            >
              改用{PACE_PRESETS[lockHint.nearestPace].label}档再预测
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <BudgetRing label="口播字数" used={budget.usedChars} max={budget.maxChars} unit="字" />
        <BudgetRing label="停留配额" used={Number((workspace.forecastShots.reduce((sum, shot) => sum + shot.holdDuration, 0)).toFixed(1))} max={budget.holdSeconds} unit="s" />
        <BudgetRing label="概念" used={budget.conceptUsed || (selected ? selected.conceptCount : 0)} max={budget.conceptMax} unit="个" />
      </div>

      <div className="text-[12px] text-zinc-400 flex items-center gap-2">
        <Clock className="w-3.5 h-3.5 text-amber-400" />
        口播 {formatSeconds(budget.speechSeconds)} · 停留 {formatSeconds(budget.holdSeconds)} · {estimate.min}–{estimate.max} 镜
      </div>

      <PrimaryButton id="btn-draft-from-budget" busy={busy} onClick={onDraft} disabled={!canDraft}>
        按预算写稿
      </PrimaryButton>
    </div>
  );
}

function BeatsStage({
  workspace,
  onChange,
  onFillHook
}: {
  workspace: ScriptWorkspace;
  onChange: (beats: ScriptWorkspace['beats']) => void;
  onFillHook: (key: keyof ResearchNotes) => void;
}) {
  if (workspace.beats.length === 0) {
    return (
      <div className="space-y-3">
        <SectionIntro title="节拍表" desc="先在时长页点「按预算写稿」，或在已有文案里诊断。" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <SectionIntro title="节拍表" desc="改某一拍的口播，整段旁白和节奏带会一起重算。钩子行可以接调研笔记。" />
      <HookDropZone onFillHook={onFillHook} />
      <div className="space-y-2">
        {workspace.beats.map((beat, index) => (
          <div
            key={beat.id}
            onDragOver={(e) => {
              if (beat.function === 'hook' && isResearchDragEvent(e)) e.preventDefault();
            }}
            onDrop={(e) => {
              if (beat.function !== 'hook') return;
              const key = readResearchDrag(e);
              if (!key) return;
              e.preventDefault();
              onFillHook(key);
            }}
            className={`rounded-xl border p-3 grid grid-cols-1 lg:grid-cols-12 gap-2 ${
              beat.function === 'hook' ? 'border-amber-500/35 bg-amber-500/5' : 'border-[#2b2b36] bg-[#18181f]'
            }`}
          >
            <div className="lg:col-span-2 flex flex-col gap-1">
              <span className="text-[11px] text-amber-400">{FUNCTION_LABEL[beat.function]}</span>
              <span className="text-[10px] text-zinc-500">{ENERGY_LABEL[beat.energy]} · {beat.intent || beatIntentLabel(beat.function)}</span>
            </div>
            <textarea
              value={beat.narration}
              onChange={(e) => {
                const beats = workspace.beats.map((item, itemIndex) => itemIndex === index ? { ...item, narration: e.target.value } : item);
                onChange(beats);
              }}
              rows={2}
              className="lg:col-span-6 bg-[#121217] border border-[#2b2b36] rounded-lg p-2 text-[12px] text-zinc-200 resize-none select-text"
            />
            <textarea
              value={beat.visualIntent}
              onChange={(e) => {
                const beats = workspace.beats.map((item, itemIndex) => itemIndex === index ? { ...item, visualIntent: e.target.value } : item);
                onChange(beats);
              }}
              rows={2}
              placeholder="看得见的画面，不要写「很有氛围」"
              className="lg:col-span-4 bg-[#121217] border border-[#2b2b36] rounded-lg p-2 text-[12px] text-zinc-300 resize-none select-text"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function CopyStage({
  workspace,
  onChange,
  onDraft,
  onDiagnose,
  busy,
  onHoldChange,
  onFillHook
}: {
  workspace: ScriptWorkspace;
  onChange: (value: string) => void;
  onDraft: () => void;
  onDiagnose: () => void;
  busy: boolean;
  onHoldChange: (shotId: string, holdDuration: number) => void;
  onFillHook: (key: keyof ResearchNotes) => void;
}) {
  const budget = workspace.durationBudget;
  const over = budget.usedChars > budget.maxChars;
  return (
    <div className="space-y-4 max-w-4xl">
      <SectionIntro title="整段口播" desc="一条连续旁白。字数对着预算变色。切镜按画面动机，不按每句等长。节奏带右缘只能加停留。" />
      <HookDropZone onFillHook={onFillHook} />
      <div className="flex items-center justify-between text-[12px]">
        <span className={over ? 'text-rose-300' : 'text-zinc-400'}>
          {budget.usedChars} / {budget.maxChars} 字
        </span>
        {workspace.intent === 'have-script' ? (
          <button type="button" onClick={onDiagnose} className="text-amber-400 text-[12px] cursor-pointer">重新诊断</button>
        ) : (
          <button type="button" onClick={onDraft} disabled={busy} className="text-amber-400 text-[12px] cursor-pointer disabled:opacity-50">按预算重写</button>
        )}
      </div>
      <textarea
        id="input-full-narration"
        value={workspace.fullNarration}
        onChange={(e) => onChange(e.target.value)}
        rows={14}
        placeholder="口播写在这里。刷新后还在。"
        className={`w-full bg-[#18181f] border rounded-2xl p-4 text-[14px] leading-relaxed text-zinc-100 placeholder-zinc-600 focus:outline-none resize-none select-text ${
          over ? 'border-rose-500/50' : 'border-[#2b2b36] focus:border-amber-500/50'
        }`}
      />
      <RhythmTape shots={workspace.forecastShots} onHoldChange={onHoldChange} />
    </div>
  );
}

function RhythmStage({
  workspace,
  onHoldChange
}: {
  workspace: ScriptWorkspace;
  onHoldChange: (shotId: string, holdDuration: number) => void;
}) {
  const shots = workspace.forecastShots;
  return (
    <div className="space-y-5">
      <SectionIntro title="节奏带" desc="格子宽是秒数。拖每格右缘只加「念完后的停留」，不能短于口播。停过的格下次重算还会记住。" />
      <RhythmTape shots={shots} onHoldChange={onHoldChange} />
      {shots.length === 0 ? (
        <p className="text-sm text-zinc-500">还没有预测镜。先写稿或诊断已有文案。</p>
      ) : (
        <div className="space-y-2">
          {shots.map((shot) => (
            <div key={shot.id} className="rounded-xl border border-[#2b2b36] bg-[#18181f] px-3 py-2.5 flex gap-3">
              <div className="w-16 flex-shrink-0">
                <div className="text-[11px] text-amber-400">镜 {shot.order}</div>
                <div className="text-[10px] text-zinc-500">{(shot.speechDuration + shot.holdDuration).toFixed(1)}s</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-zinc-200 truncate">{shot.sliceText || shot.narration || '（无口播，纯画面停留）'}</div>
                <div className="mt-1 text-[10px] text-zinc-500">
                  {FUNCTION_LABEL[shot.function]} · {ENERGY_LABEL[shot.energy]}
                  {shot.shotSize ? ` · ${SHOT_SIZE_LABEL[shot.shotSize]}` : ''}
                  {shot.cameraAngle ? ` · ${CAMERA_ANGLE_LABEL[shot.cameraAngle]}` : ''}
                  {shot.coverageJob ? ` · ${COVERAGE_JOB_LABEL[shot.coverageJob]}` : ''}
                  {' '}· 口播 {shot.speechDuration.toFixed(1)}s · 停留 {shot.holdDuration.toFixed(1)}s
                  {shot.visualCount && shot.visualCount > 1 ? ` · 同一句图 ${(shot.visualIndex || 0) + 1}/${shot.visualCount}` : ''}
                  {shot.holdPinned ? ' · 停留已钉' : ''}
                  {continuityShortLabel(shot.continuity) ? ` · ${continuityShortLabel(shot.continuity)}` : ''}
                  {leadCharacter(workspace.visualBible) && shot.characterIds?.includes(leadCharacter(workspace.visualBible)!.id)
                    ? ` · ${leadCharacter(workspace.visualBible)!.name}`
                    : ''}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-600 truncate">{shot.splitReason}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RhythmTape({
  shots,
  onHoldChange
}: {
  shots: ScriptWorkspace['forecastShots'];
  onHoldChange?: (shotId: string, holdDuration: number) => void;
}) {
  const tapeRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startHold: number; pps: number } | null>(null);

  if (shots.length === 0) {
    return <div id="rhythm-tape" className="h-10 rounded-lg bg-[#18181f] border border-dashed border-[#2b2b36]" />;
  }

  const beginHoldDrag = (event: React.PointerEvent, shot: ScriptWorkspace['forecastShots'][number]) => {
    if (!onHoldChange) return;
    event.preventDefault();
    event.stopPropagation();
    const total = shots.reduce((sum, item) => sum + item.speechDuration + item.holdDuration, 0);
    const width = tapeRef.current?.clientWidth || 1;
    dragRef.current = {
      id: shot.id,
      startX: event.clientX,
      startHold: shot.holdDuration,
      pps: total > 0 ? width / total : 40
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveHoldDrag = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !onHoldChange) return;
    const delta = (event.clientX - drag.startX) / drag.pps;
    const hold = Math.max(0, Math.min(8, Math.round((drag.startHold + delta) * 10) / 10));
    onHoldChange(drag.id, hold);
  };

  const endHoldDrag = () => {
    dragRef.current = null;
  };

  return (
    <div
      id="rhythm-tape"
      ref={tapeRef}
      className="flex h-12 rounded-lg overflow-hidden border border-[#2b2b36] select-none"
    >
      {shots.map((shot) => {
        const duration = Math.max(0.4, shot.speechDuration + shot.holdDuration);
        return (
          <div
            key={shot.id}
            title={`镜${shot.order} 口播 ${shot.speechDuration.toFixed(1)}s · 停留 ${shot.holdDuration.toFixed(1)}s${shot.holdPinned ? '（已钉）' : ''}。拖右缘只加停留。`}
            style={{ flex: duration }}
            className={`${ENERGY_COLOR[shot.energy]} relative opacity-90 border-r border-black/30 last:border-0`}
          >
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-black/70 pointer-events-none">
              {shot.order}
            </span>
            {onHoldChange && (
              <span
                id={`rhythm-hold-handle-${shot.id}`}
                onPointerDown={(event) => beginHoldDrag(event, shot)}
                onPointerMove={moveHoldDrag}
                onPointerUp={endHoldDrag}
                onPointerCancel={endHoldDrag}
                className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/25 hover:bg-black/45"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function HookDropZone({ onFillHook }: { onFillHook: (key: keyof ResearchNotes) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      id="hook-drop-zone"
      onDragOver={(e) => {
        if (!isResearchDragEvent(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const key = readResearchDrag(e);
        setOver(false);
        if (!key) return;
        e.preventDefault();
        onFillHook(key);
      }}
      className={`rounded-xl border border-dashed px-3 py-2.5 text-[12px] ${
        over
          ? 'border-amber-400 bg-amber-500/15 text-amber-100'
          : 'border-[#2b2b36] bg-[#18181f] text-zinc-500'
      }`}
    >
      钩子槽 · 把调研卡拖到这里，或在调研页点「填进钩子」
    </div>
  );
}

function isResearchDragEvent(event: React.DragEvent) {
  const types = Array.from(event.dataTransfer.types || []);
  return types.includes(RESEARCH_DRAG_MIME) || types.includes('text/plain');
}

function writeResearchDrag(event: React.DragEvent, key: keyof ResearchNotes) {
  event.dataTransfer.setData(RESEARCH_DRAG_MIME, key);
  event.dataTransfer.setData('text/plain', `research-note:${key}`);
  event.dataTransfer.effectAllowed = 'copy';
}

function readResearchDrag(event: React.DragEvent): keyof ResearchNotes | null {
  const raw = event.dataTransfer.getData(RESEARCH_DRAG_MIME) || event.dataTransfer.getData('text/plain');
  const key = raw.replace(/^research-note:/, '') as keyof ResearchNotes;
  if (key === 'competitor' || key === 'audienceQuestion' || key === 'fact' || key === 'visualRef') return key;
  return null;
}

function CharacterRefSlot({
  previewUrl,
  disabled,
  onPick,
  onClear
}: {
  previewUrl: string | null;
  disabled?: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputId = React.useId();
  return (
    <div className="relative">
      <input
        id={inputId}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
      {previewUrl ? (
        <div className="flex items-center gap-2 rounded-lg border border-[#2b2b36] bg-[#121217] p-1.5">
          <img src={previewUrl} alt="" className="w-12 h-12 rounded-md object-cover flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-zinc-200">已钉参考图</div>
            <button
              type="button"
              disabled={disabled}
              onClick={() => document.getElementById(inputId)?.click()}
              className="text-[10px] text-amber-400 cursor-pointer disabled:opacity-40"
            >
              替换
            </button>
          </div>
          <button
            type="button"
            title="清除参考图"
            disabled={disabled}
            onClick={onClear}
            className="p-1 text-zinc-500 hover:text-rose-300 cursor-pointer disabled:opacity-40"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => document.getElementById(inputId)?.click()}
          className="w-full rounded-lg border border-dashed border-[#3a3a4a] px-2 py-2 text-[10px] text-zinc-500 hover:text-zinc-300 hover:border-amber-500/40 cursor-pointer disabled:opacity-40 flex items-center justify-center gap-1.5"
        >
          <ImagePlus className="w-3.5 h-3.5" />
          上传一张正脸或半身，锁脸和服装
        </button>
      )}
    </div>
  );
}

function DirectorRail({
  workspace,
  onChange,
  onRebuildBible,
  bibleBusy,
  compact
}: {
  workspace: ScriptWorkspace;
  onChange?: (workspace: ScriptWorkspace) => void;
  onRebuildBible?: () => void;
  bibleBusy?: boolean;
  compact?: boolean;
}) {
  const [compactOpen, setCompactOpen] = useState(false);
  const [refBusyId, setRefBusyId] = useState<string | null>(null);
  const budget = workspace.durationBudget;
  const notes = workspace.directorNotes;
  const bible = workspace.visualBible;
  const stale = isVisualBibleStale(bible, workspace.fullNarration, workspace.genrePackId);
  const showCards = !compact || compactOpen;
  const patchBible = (next: VisualBible) => {
    if (!onChange) return;
    onChange(rebuildForecast({ ...workspace, visualBible: next }));
  };
  const handlePickRef = async (characterId: string, file: File) => {
    if (!bible) return;
    setRefBusyId(characterId);
    try {
      const ref = await prepareCharacterRefFile(file);
      patchBible(setCharacterRef(bible, characterId, ref));
      showStatusToast('已钉参考图，生图时会锁脸和服装', { tone: 'ok', id: 'character-ref' });
    } catch (err: any) {
      showStatusToast(err?.message || '参考图上传失败', { tone: 'error', id: 'character-ref' });
    } finally {
      setRefBusyId(null);
    }
  };
  return (
    <div className={`p-4 space-y-3 ${compact ? '' : 'overflow-y-auto custom-scrollbar h-full'}`}>
      <div className="text-[12px] font-medium text-zinc-200">导演批注</div>
      <div className={`grid gap-2 ${compact ? 'grid-cols-3' : 'grid-cols-1'}`}>
        <MiniStat label="字数" value={`${budget.usedChars}/${budget.maxChars}`} warn={budget.usedChars > budget.maxChars} />
        <MiniStat
          label="时长"
          value={`${budget.targetSeconds}s`}
          warn={workspace.forecastShots.reduce((sum, shot) => sum + shot.speechDuration + shot.holdDuration, 0) > budget.targetSeconds + 0.4}
        />
        <MiniStat label="预测" value={forecastSummary(workspace).split('·')[0]} />
      </div>
      {notes.length === 0 ? (
        <p className="text-[11px] text-zinc-500 leading-relaxed">还没有需要改的地方。字数超了、钩子太长、节奏太平，会出现在这里。</p>
      ) : (
        <div className="space-y-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className={`rounded-lg px-2.5 py-2 text-[11px] leading-relaxed ${
                note.level === 'block'
                  ? 'bg-rose-500/10 text-rose-200 border border-rose-500/30'
                  : note.level === 'warn'
                    ? 'bg-amber-500/10 text-amber-200 border border-amber-500/25'
                    : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700/80'
              }`}
            >
              {note.message}
            </div>
          ))}
        </div>
      )}

      <div className="pt-2 border-t border-[#23232c] space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] font-medium text-zinc-200 flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-amber-400" />
            画面圣经
          </div>
          {bible?.mode === 'story' ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-300">叙事</span>
          ) : bible ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500">说明</span>
          ) : null}
        </div>
        {compact && (
          <button
            type="button"
            onClick={() => setCompactOpen((open) => !open)}
            className="w-full text-left text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
          >
            {bibleSummary(bible)}{stale ? ' · 口播已改' : ''}{bible?.mode === 'story' ? ' · 点开钉参考图' : ''}
          </button>
        )}
        {showCards && (
          <>
            {!compact && (
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              {bible ? bibleSummary(bible) : '写稿后会按整段口播编角色和场景，而不是一句一换人。'}
            </p>
            )}
            {stale && bible && (
              <p className="text-[11px] text-amber-300 leading-relaxed">口播已改，圣经可能过时。</p>
            )}
            {onRebuildBible && (
              <button
                type="button"
                onClick={onRebuildBible}
                disabled={bibleBusy || countNarrationChars(workspace.fullNarration) < 8}
                className="text-[11px] text-amber-400 hover:text-amber-300 cursor-pointer disabled:opacity-40"
              >
                {bibleBusy ? '正在编圣经…' : bible ? '按口播重编' : '编画面圣经'}
              </button>
            )}
            {bible?.mode === 'story' && bible.characters.map((character) => (
              <div key={character.id} className="rounded-xl border border-[#2b2b36] bg-[#18181f] p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <input
                    value={character.name}
                    onChange={(e) => patchBible(updateCharacterField(bible, character.id, { name: e.target.value }))}
                    className="bg-transparent text-[12px] text-zinc-100 font-medium min-w-0 flex-1 focus:outline-none"
                  />
                  <button
                    type="button"
                    title={character.locked ? '已钉住，重编时保留' : '钉住这张角色卡'}
                    onClick={() => patchBible(toggleCharacterLock(bible, character.id))}
                    className={`p-1 rounded cursor-pointer ${character.locked ? 'text-amber-300' : 'text-zinc-500 hover:text-zinc-300'}`}
                  >
                    {character.locked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                  </button>
                </div>
                <p className="text-[10px] text-zinc-500">{character.role === 'lead' ? '主角' : '配角'} · {character.ageBand}</p>
                <textarea
                  value={character.look}
                  onChange={(e) => patchBible(updateCharacterField(bible, character.id, { look: e.target.value }))}
                  rows={2}
                  className="w-full bg-[#121217] border border-[#2b2b36] rounded-lg p-1.5 text-[11px] text-zinc-300 resize-none select-text"
                />
                <input
                  value={character.wardrobe}
                  onChange={(e) => patchBible(updateCharacterField(bible, character.id, { wardrobe: e.target.value }))}
                  className="w-full bg-[#121217] border border-[#2b2b36] rounded-lg px-1.5 py-1 text-[11px] text-zinc-300 focus:outline-none"
                />
                <CharacterRefSlot
                  previewUrl={characterRefPreview(character)}
                  disabled={refBusyId === character.id}
                  onPick={(file) => void handlePickRef(character.id, file)}
                  onClear={() => patchBible(clearCharacterRef(bible, character.id))}
                />
                {refBusyId === character.id && (
                  <p className="text-[10px] text-amber-300">正在保存参考图…</p>
                )}
                {characterHasRef(character) && (
                  <p className="text-[10px] text-zinc-600">生图时会按这张图锁脸和服装</p>
                )}
              </div>
            ))}
            {bible?.locations[0] && (
              <div className="text-[11px] text-zinc-500 leading-relaxed">
                场景 {bible.locations[0].name} · {bible.locations[0].timeOfDay}
              </div>
            )}
            {bible?.mode === 'expository' && bible.paletteLock && (
              <p className="text-[11px] text-zinc-400 leading-relaxed">{bible.paletteLock}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function BudgetRing({ label, used, max, unit }: { label: string; used: number; max: number; unit: string }) {
  const ratio = Math.min(1.2, usageRatio(used, max));
  const over = used > max && max > 0;
  return (
    <div className="rounded-2xl border border-[#2b2b36] bg-[#18181f] p-4">
      <div className="text-[11px] text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${over ? 'text-rose-300' : 'text-zinc-100'}`}>
        {used}{unit} <span className="text-[12px] font-normal text-zinc-500">/ {max}{unit}</span>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full ${over ? 'bg-rose-400' : 'bg-amber-400'}`}
          style={{ width: `${Math.min(100, ratio * 100)}%` }}
        />
      </div>
    </div>
  );
}

function SectionIntro({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
      <p className="mt-1 text-[13px] text-zinc-500 leading-relaxed">{desc}</p>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer ${
        active ? 'bg-amber-500/15 text-amber-200 border-amber-500/40' : 'bg-[#18181f] text-zinc-400 border-[#2b2b36] hover:text-zinc-200'
      }`}
    >
      {children}
    </button>
  );
}

function PrimaryButton({
  id,
  busy,
  onClick,
  disabled,
  children
}: {
  id?: string;
  busy?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold bg-gradient-to-r from-amber-500 to-orange-500 text-black disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
    >
      {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
      {children}
    </button>
  );
}

function MiniStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-[#18181f] border border-[#2b2b36] px-2.5 py-2">
      <div className="text-[10px] text-zinc-500">{label}</div>
      <div className={`text-[12px] mt-0.5 ${warn ? 'text-rose-300' : 'text-zinc-200'}`}>{value}</div>
    </div>
  );
}

