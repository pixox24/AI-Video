import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BriefStage } from './BriefStage';
import { QualityPanel } from './QualityPanel';
import { UsagePanel } from './UsagePanel';
import {
  BeatsStageCanvas,
  BriefStageCanvas,
  CopyStageCanvas,
  DurationStageCanvas,
  IntentStageCanvas,
  ResearchStageCanvas,
  RhythmStageCanvas,
  ScriptStageViewport,
  TopicStageCanvas
} from './ScriptStageViewport';
import { canEnterOutline } from '../utils/contentBrief';
import { durationSpecForm } from '../../src-server/duration/engine';
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
  Type,
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
  CustomLlmApiConfig,
  CustomTtsApiConfig,
  ResearchNotes,
  ScriptForm,
  ScriptGenre,
  ScriptIntent,
  ScriptLanguage,
  ScriptPace,
  ScriptPlatform,
  ScriptStage,
  ScriptWorkspace,
  StoryboardClip,
  TopicCard,
  NarratorMode,
  StylePack,
  VisualBible,
  VisualStyle
} from '../types';
import { budgetUnitLabel, countBudgetUnits, languageProfile, normalizeScriptLanguage } from '../utils/scriptLanguage';
import { applyLlmCoverage } from '../utils/shotCoverage';
import {
  PACE_PRESETS,
  PLATFORM_OPTIONS,
  STAGE_META,
  stageNavMeta,
  TARGET_SECONDS_PRESETS,
  lengthBudgetOf,
  applyNarrationToBeats,
  beatIntentLabel,
  buildDurationBudget,
  budgetFromWordCount,
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
  FILL_RATIO_MIN,
  MAX_VIDEO_SECONDS,
  MIN_VIDEO_SECONDS,
  SPAN_BATCH_SIZE,
  COVERAGE_BATCH_SIZE,
  chunkItems,
  clampVideoSeconds,
  maxForecastShotsForDuration,
  outlineConfirmationRequired,
  resolveScriptForm,
  scriptFormForSeconds,
  scriptFormLabel
} from '../utils/scriptDuration';
import { splitCompleteSentences } from '../utils/speechSpans';
import { splitCoversSource } from '../utils/scriptSplit';
import { flattenSectionBeats, joinSectionNarrations } from '../utils/scriptSections';
import { validateDraftResult } from '../utils/scriptDraft';
import { translateClipsSecondary } from '../utils/secondaryText';
import {
  adoptPastedScriptFromTitle,
  applyGenrePack,
  applyHoldToWorkspace,
  applyLockedTitleEdit,
  applyResearchNoteToHook,
  applyResearchNoteToTopic,
  canApplyStoryboard,
  diagnoseExistingScript,
  narrationForDiagnose,
  fallbackTopicCards,
  forecastScriptHash,
  forecastSummary,
  forecastToClips,
  hasUsableDraftTopic,
  hookPreviewText,
  isLockedTitleValid,
  lockTitleFromIntent,
  lockedTitleDurationReason,
  looksLikeScript,
  resolveStoryboardApplyMode,
  stampAppliedWorkspace,
  stylePackFingerprint,
  mixTopicCards,
  rebuildForecast,
  refreshWorkspaceDerived,
  stageCompleted,
  switchScriptIntent,
  switchScriptLanguage,
  titleCharCount,
  titleMaxFor,
  waitingForTitleAngles,
  workspaceTopicTitle
} from '../utils/scriptWorkspace';
import { bgmById } from '../utils/presets';
import { showStatusToast } from '../utils/statusToast';
import { ScriptOutlineStage } from './ScriptOutlineStage';
import { BeatsStage, CopyStage, isResearchDragEvent, readResearchDrag, ResearchStage, RhythmStage } from './ScriptWritingStages';
import {
  bibleSummary,
  bibleSubjects,
  characterRefPreview,
  characterHasRef,
  clearCharacterRef,
  confirmPendingCharacter,
  continuityShortLabel,
  evidenceSourceLabel,
  fallbackVisualBible,
  groundVisualBible,
  mergeVisualBible,
  occupancyReasonLabel,
  normalizeVisualBible,
  previewBibleDiff,
  applyNarratorMode,
  rejectPendingCharacter,
  setCharacterRef,
  toggleCharacterLockFlag,
  updateCharacterField,
  bibleHasCast,
  bibleHasNarrativeCast,
  bibleLocksObject,
  visualBibleModeForGenre,
  visualBibleSourceShift,
  workspaceBibleSource
} from '../utils/visualBible';
import { extractCastCandidates } from '../utils/castCandidates';
import { receiveVisualBibleResponse } from '../services/visualBibleService';
import { applyCharacterRefResponse, captureCharacterRefRequest, CharacterRefRequest, createBibleOperationGuard } from '../utils/visualBibleAsync';
import { reduceBibleAction } from '../utils/visualBibleState';
import { prepareCharacterRefFile } from '../utils/characterRef';
import {
  CHARACTER_CARD_VARIANTS,
  CharacterCardVariant,
  shouldOfferAutoCard
} from '../utils/characterCardPrompt';

interface ScriptPanelProps {
  projectId?: string;
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
  outroHold?: number;
  onGenerateCharacterRef?: (characterId: string, variant: CharacterCardVariant) => Promise<boolean>;
  onGenerateCharacterRefAll?: () => void;
}

const INTENT_CARDS: {
  id: ScriptIntent;
  title: string;
  desc: string;
  icon: React.ReactNode;
}[] = [
  { id: 'have-title', title: '已有标题', desc: '就按这句写口播', icon: <Type className="w-5 h-5" /> },
  { id: 'direction', title: '有方向没题目', desc: '一句话扩成三个不同角度', icon: <Sparkles className="w-5 h-5" /> },
  { id: 'blank', title: '今天不知道拍什么', desc: '给你三张可拍的选题卡', icon: <Lightbulb className="w-5 h-5" /> },
  { id: 'product', title: '有产品 / 账号', desc: '卖点变成可拍场景', icon: <Package className="w-5 h-5" /> },
  { id: 'reference', title: '有对标', desc: '保留节奏，换角度', icon: <Link2 className="w-5 h-5" /> },
  { id: 'have-script', title: '已有文案', desc: '粘贴口播，诊断时长和切镜', icon: <FileText className="w-5 h-5" /> }
];

export const ScriptPanel: React.FC<ScriptPanelProps> = ({
  projectId = '',
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
  sentenceGap = 0.2,
  outroHold = 0,
  onGenerateCharacterRef,
  onGenerateCharacterRefAll
}) => {
  const [busy, setBusy] = useState<'topics' | 'draft' | 'research' | 'reference' | 'concepts' | 'preview' | 'bible' | 'diagnose' | 'apply' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [focusTitle, setFocusTitle] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const liveWorkspace = useRef(workspace);
  liveWorkspace.current = workspace;
  const bibleOperations = useRef(createBibleOperationGuard());
  useEffect(() => () => bibleOperations.current.cancel(), []);
  type BibleOperation = ReturnType<typeof bibleOperations.current.start>;
  const operationIsCurrent = (operation: BibleOperation) => bibleOperations.current.isCurrent(operation, liveWorkspace.current);
  const discardBibleOperation = () => setStatus('文案或角色设置已更新，已忽略此前的处理结果');

  useEffect(() => {
    if (workspace.stage === 'intent' && focusTitle) {
      const timer = window.setTimeout(() => setFocusTitle(false), 0);
      return () => window.clearTimeout(timer);
    }
  }, [workspace.stage, focusTitle]);

  const handleGenrePack = (genre: ScriptGenre) => {
    onChange(applyGenrePack(workspace, genre));
    const pack = genrePackById(genre);
    if (pack?.bgmTrackId) onRecommendBgm?.(pack.bgmTrackId);
    const track = pack?.bgmTrackId ? bgmById(pack.bgmTrackId) : null;
    setStatus(track ? `已套 ${genre} 体裁包，配乐切到「${track.title.replace(/^[^\s]+\s*/, '')}」` : `已套 ${genre} 体裁包`);
    setError(null);
  };

  const selected = workspace.topicCards.find((card) => card.id === workspace.selectedTopicId) || null;
  const scriptLanguage = normalizeScriptLanguage(workspace.scriptLanguage);
  const langProfile = languageProfile(scriptLanguage);
  const unitLabel = langProfile.budgetUnitLabel;
  const chars = workspace.durationBudget.usedChars;
  const applyGate = canApplyStoryboard(workspace);
  const applyReady = applyGate.ok;
  const topicTitle = workspaceTopicTitle(workspace, workspace.intent === 'have-title' ? '未锁题' : '未选题');
  const titleValid = isLockedTitleValid(workspace.lockedTitle, scriptLanguage);
  const waitingAngles = waitingForTitleAngles(workspace);

  // Keep the planning budget in sync with the audio panel's effective TTS rate.
  useEffect(() => {
    const currentRate = workspace.durationBudget.speechRate || 1;
    if (Math.abs(currentRate - speechRate) < 0.001) return;
    onChange(refreshWorkspaceDerived({
      ...workspace,
      durationBudget: buildDurationBudget({ ...workspace.durationBudget, speechRate, scriptLanguage })
    }));
  }, [speechRate, workspace.durationBudget.speechRate]);

  const commit = (next: ScriptWorkspace) => {
    const committed = refreshWorkspaceDerived(next);
    onChange(committed);
    return committed;
  };

  const setStage = (stage: ScriptStage) => {
    if (stage === 'beats' && !canEnterOutline(workspace)) {
      setError('请先填写观众承诺。');
      commit({ ...workspace, stage: 'brief', gate: 'deep' });
      return;
    }
    commit({ ...workspace, stage, gate: 'deep' });
  };

  const handleFastGate = async () => {
    if (workspace.intent === 'have-title' && !titleValid) {
      setError(`标题 ${langProfile.titleMin}–${langProfile.titleMax} ${unitLabel}`);
      return;
    }
    if (waitingAngles) {
      setError('选出一张卡');
      return;
    }
    if (workspace.intent === 'have-script' && (workspace.fullNarration || workspace.intentNotes).trim()) {
      await handleDiagnose();
      return;
    }
    if (workspace.selectedTopicId && (selected || workspace.intentNotes.trim() || titleValid)) {
      await handleDraft();
      return;
    }
    if (workspace.intent === 'have-title' && titleValid) {
      handleLockTitle();
      return;
    }
    if (workspace.intent === 'reference' && workspace.referenceUrl.trim()) {
      await handleReference();
      return;
    }
    await handleScoutTopics();
  };

  const handleLockTitle = () => {
    if (!isLockedTitleValid(workspace.lockedTitle, scriptLanguage)) {
      setError(`标题 ${langProfile.titleMin}–${langProfile.titleMax} ${unitLabel}`);
      return;
    }
    const next = lockTitleFromIntent(workspace);
    onTopicChange(next.lockedTitle);
    commit(next);
    setStatus(`已锁定标题「${next.lockedTitle}」，写稿不会改这句。`);
    setError(null);
  };

  const handleTitleChange = (value: string) => {
    const next = applyLockedTitleEdit(workspace, value);
    const selectedLocked = next.topicCards.find((card) => card.id === next.selectedTopicId);
    if (selectedLocked?.hookType === 'locked-title' && isLockedTitleValid(next.lockedTitle, scriptLanguage)) {
      onTopicChange(next.lockedTitle.trim());
    }
    commit(next);
    setError(null);
  };

  const handleAdoptPastedScript = () => {
    const next = adoptPastedScriptFromTitle(workspace);
    commit(next);
    setStatus('已改走「已有文案」。把这段当口播诊断即可。');
    setError(null);
  };

  const handleScoutTopics = async () => {
    if (workspace.intent === 'have-title') {
      if (!isLockedTitleValid(workspace.lockedTitle, scriptLanguage)) {
        setError(`标题 ${langProfile.titleMin}–${langProfile.titleMax} ${unitLabel}`);
        return;
      }
    } else if (workspace.intent === 'direction' || workspace.intent === 'product' || workspace.intent === 'reference') {
      if (!workspace.intentNotes.trim()) {
        setError('先写一句话，再出选题卡');
        return;
      }
    }
    const seed = workspace.intent === 'have-title'
      ? (workspace.lockedTitle || '').trim()
      : workspace.intentNotes;
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
          lockedTitle: workspace.lockedTitle,
          platform: workspace.durationBudget.platform,
          pace: workspace.durationBudget.pace,
          researchNotes: workspace.researchNotes,
          researchBrief: workspace.researchBrief,
          genrePackId: workspace.genrePackId,
          llmApi: customLlmApi,
          scriptLanguage
        })
      });
      const data = await res.json().catch(() => ({}));
      let cards: TopicCard[] = Array.isArray(data?.cards) && data.cards.length > 0
        ? data.cards.slice(0, 3)
        : fallbackTopicCards(seed, workspace.intent, scriptLanguage);
      if (workspace.intent === 'have-title' && cards[0] && seed) {
        cards = [{ ...cards[0], title: seed }, ...cards.slice(1)];
      }
      commit({
        ...workspace,
        gate: 'fast',
        topicCards: cards,
        selectedTopicId: null,
        stage: 'topic'
      });
      setStatus('选出一张卡。点卡只锁题，不会写全文。');
    } catch {
      let cards = fallbackTopicCards(seed, workspace.intent, scriptLanguage);
      if (workspace.intent === 'have-title' && cards[0] && seed) {
        cards = [{ ...cards[0], title: seed }, ...cards.slice(1)];
      }
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
      conceptUsed: card.conceptCount,
      scriptLanguage
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
    if (!canEnterOutline(workspace)) { setError('请先填写观众承诺。'); setStage('brief'); return; }
    let source = workspace;
    let card = selected;
    if (workspace.intent === 'have-title' && !card && isLockedTitleValid(workspace.lockedTitle, scriptLanguage)) {
      source = lockTitleFromIntent(workspace);
      card = source.topicCards.find((item) => item.id === source.selectedTopicId) || null;
      onTopicChange(source.lockedTitle);
      source = commit(source);
    }
    const operation = bibleOperations.current.start(source);
    const topic = card?.title || source.lockedTitle.trim() || source.intentNotes.trim();
    if (!topic) {
      setError(workspace.intent === 'have-title' ? '先回意图页写标题' : '先选定选题，或在意图里写方向');
      return;
    }
    setBusy('draft');
    setError(null);
    const form = resolveScriptForm(source.durationBudget.targetSeconds, source.scriptFormOverride);
    setStatus(form === 'short'
      ? `按${unitLabel}数预算写节拍和口播...`
      : outlineConfirmationRequired(form) && source.outline?.status !== 'confirmed'
        ? `正在生成全片提纲（目标 ${source.durationBudget.targetSeconds}s）...`
        : `按${scriptFormLabel(form)}写稿（目标 ${source.durationBudget.targetSeconds}s）...`);
    try {
      const res = await fetch('/api/script/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          topicCard: card,
          intent: source.intent,
          intentNotes: source.intentNotes,
          lockedTitle: source.lockedTitle,
          researchNotes: source.researchNotes,
          budget: source.durationBudget,
          genrePack: genrePackById(source.genrePackId || card?.genre || null),
          llmApi: customLlmApi,
          stylePack,
          scriptLanguage,
          brief: source.brief,
          contentBrief: source.contentBrief,
          durationSpec: source.durationSpec,
          writingStyleId: source.contentBrief?.writingStyleId,
          writingStyles: source.writingStyles,
          outline: source.outline,
          sections: source.sections,
          scriptFormOverride: source.scriptFormOverride,
          confirmOutlineBeforeDraft: source.confirmOutlineBeforeDraft,
          projectId
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!operationIsCurrent(operation)) { discardBibleOperation(); return; }
      if (res.status === 409 && (data?.code === 'outline_required' || data?.code === 'outline_preview') && data?.outline) {
        commit({
          ...source,
          outline: data.outline,
          brief: data.brief || source.brief,
          scriptForm: form,
          stage: 'beats'
        });
        setStatus(data.code === 'outline_preview'
          ? '已生成轻提纲。可编辑后点「按提纲写稿」。'
          : '已生成全片提纲。确认后再逐章写稿。');
        return;
      }
      if (!res.ok || data?.source === 'fallback') {
        if (Array.isArray(data?.sections) && data.sections.length) {
          const lang = normalizeScriptLanguage(source.scriptLanguage);
          commit(rebuildForecast({
            ...source,
            sections: data.sections,
            beats: flattenSectionBeats(data.sections),
            fullNarration: joinSectionNarrations(data.sections, lang),
            outline: data.outline || source.outline,
            stage: 'beats'
          }));
        }
        const parts = [
          data?.error,
          data?.detail && data.detail !== data?.error ? `原因：${data.detail}` : '',
          data?.validationDetail && data.validationDetail !== data?.detail ? `校验：${data.validationDetail}` : '',
          data?.recommendation
        ].filter(Boolean);
        const message = parts.join(' ') || data?.warnings?.[0] || `写稿失败${res.ok ? '' : `（HTTP ${res.status}）`}，未套用短稿。`;
        setError(message);
        setStatus(message);
        return;
      }
      await applyDraftResult(data, topic, source, card, operation);
    } catch (err: any) {
      if (!operationIsCurrent(operation)) { discardBibleOperation(); return; }
      setError(err?.message || '写稿请求失败，未套用短稿。');
      setStatus('写稿请求失败，未套用短稿。');
    } finally {
      if (bibleOperations.current.isCurrent(operation, operation.workspace)) setBusy(null);
    }
  };

  const ensureVisualBible = async (base: ScriptWorkspace, narration: string, operation: BibleOperation): Promise<ScriptWorkspace | null> => {
    if (!operationIsCurrent(operation)) { discardBibleOperation(); return null; }
    if (countBudgetUnits(narration, scriptLanguage) < 8) return base;
    const src = workspaceBibleSource(base);
    const genre = src.genre;
    const bibleTitle = src.title;
    const intentNotes = src.intentNotes;
    const candidates = extractCastCandidates({ narration, title: bibleTitle, intentNotes });
    const groundOpts = { title: bibleTitle, intentNotes, candidates, language: src.language || base.scriptLanguage };
    const previousBible = base.visualBible || null;
    const requestId = `vb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      const res = await fetch('/api/script/visual-bible', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          narration,
          genre,
          title: bibleTitle,
          stylePack,
          llmApi: customLlmApi,
          previousBible,
          intentNotes,
          candidates,
          requestId,
          language: base.scriptLanguage
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!operationIsCurrent(operation)) { discardBibleOperation(); return null; }
      if (data?.diagnostics && !receiveVisualBibleResponse({
        narration,
        title: bibleTitle,
        intentNotes,
        genre,
        requestId,
        bibleRevision: base.visualBible?.bibleRevision,
        language: base.scriptLanguage
      }, data)) {
        discardBibleOperation();
        return null;
      }
      const incoming = normalizeVisualBible(data?.bible, visualBibleModeForGenre(genre));
      // 服务端已做整篇剧本解析并按规则收敛卡面时，本地不要再拿“挖掘候选”补角色，避免误卡复活。
      const groundCandidates = data?.analysisApplied ? [] : groundOpts.candidates;
      const bible = incoming
        ? groundVisualBible(mergeVisualBible(previousBible, incoming), narration, { ...groundOpts, candidates: groundCandidates, genre })
        : groundVisualBible(mergeVisualBible(previousBible, fallbackVisualBible({ narration, genre, title: bibleTitle, intentNotes, candidates })), narration, { ...groundOpts, genre });
      return { ...base, visualBible: bible };
    } catch {
      if (!operationIsCurrent(operation)) { discardBibleOperation(); return null; }
      return {
        ...base,
        visualBible: groundVisualBible(mergeVisualBible(previousBible, fallbackVisualBible({ narration, genre, title: bibleTitle, intentNotes, candidates })), narration, { ...groundOpts, genre })
      };
    }
  };

  const refineSpeechSpans = async (base: ScriptWorkspace, narration: string): Promise<ScriptWorkspace> => {
    const lang = normalizeScriptLanguage(base.scriptLanguage);
    const sentences = splitCompleteSentences(narration, lang, { keepShort: true });
    const batches = chunkItems(sentences.length ? sentences : [narration], SPAN_BATCH_SIZE);
    const collected: ScriptWorkspace['speechSpans'] = [];
    try {
      for (const batch of batches) {
        const part = batch.join(lang === 'en' ? ' ' : '');
        let data: any = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await fetch('/api/script/split-spans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              narration: part,
              llmApi: customLlmApi,
              visualBible: base.visualBible,
              genre: base.genrePackId || selected?.genre || null,
              scriptLanguage: lang
            })
          });
          data = await res.json().catch(() => ({}));
          if (Array.isArray(data?.spans) && data.spans.length > 0) break;
        }
        if (Array.isArray(data?.spans) && data.spans.length > 0) {
          collected.push(...data.spans);
        }
      }
      if (collected.length > 0 && splitCoversSource(collected.map((span) => span.text), narration)) {
        return rebuildForecast({ ...base, fullNarration: narration, speechSpans: collected });
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
      const patches: any[] = [];
      for (const batch of chunkItems(shots, COVERAGE_BATCH_SIZE)) {
        let data: any = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const res = await fetch('/api/script/coverage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              shots: batch.map((shot) => ({
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
          data = await res.json().catch(() => ({}));
          if (Array.isArray(data?.shots) && data.shots.length === batch.length) break;
        }
        if (Array.isArray(data?.shots) && data.shots.length === batch.length) {
          patches.push(...data.shots);
        }
      }
      if (patches.length === shots.length) {
        return { ...base, forecastShots: applyLlmCoverage(shots, patches, base.visualBible) };
      }
    } catch {
      // keep rule coverage from rebuildForecast
    }
    return base;
  };

  const applyDraftResult = async (
    data: any,
    topic: string,
    source: ScriptWorkspace,
    card: TopicCard | null,
    operation: BibleOperation
  ) => {
    const validation = validateDraftResult({
      fullNarration: data?.fullNarration,
      beats: data?.beats,
      sections: data?.sections,
      maxChars: source.durationBudget.maxChars,
      targetSeconds: source.durationBudget.targetSeconds,
      scriptLanguage: normalizeScriptLanguage(source.scriptLanguage),
      source: data?.source === 'fallback' ? 'fallback' : 'llm',
      durationMode: source.durationBudget.durationMode
    });
    if (!validation.ok || validation.source === 'fallback') {
      setError(data?.error || validation.warnings[0] || '写稿未通过校验，未套用短稿。');
      return;
    }
    const beats = Array.isArray(data?.beats) && data.beats.length >= 2 ? data.beats : [];
    const fullNarration = typeof data?.fullNarration === 'string' ? data.fullNarration.trim() : '';
    if (!fullNarration || beats.length < 2) {
      setError('写稿结果不完整，未套用短稿。');
      return;
    }
    const drafted: ScriptWorkspace = {
      ...source,
      beats: beats.map((beat: any, index: number) => ({
        id: beat.id || `beat-${index + 1}`,
        order: index + 1,
        function: beat.function || 'setup',
        intent: beat.intent || beatIntentLabel(beat.function || 'setup'),
        narration: beat.narration || '',
        targetSeconds: Number(beat.targetSeconds) || 0,
        energy: beat.energy || 'medium',
        visualIntent: beat.visualIntent || '',
        needsHold: Boolean(beat.needsHold),
        sectionId: beat.sectionId
      })),
      sections: Array.isArray(data?.sections) ? data.sections : undefined,
      outline: data?.outline || source.outline,
      brief: data?.brief || source.brief,
      scriptForm: data?.scriptForm || source.scriptForm,
      fullNarration,
      speechSpans: [],
      draftedTitle: topic,
      draftSource: 'llm',
      draftWarnings: Array.isArray(data?.warnings) ? data.warnings : validation.warnings,
      stage: 'copy',
      gate: 'fast'
    };
    const withBible = await ensureVisualBible(drafted, fullNarration, operation);
    if (!withBible) return;
    const spanned = await refineSpeechSpans(withBible, fullNarration);
    const next = await refineCoverage(spanned);
    if (!operationIsCurrent(operation)) { discardBibleOperation(); return; }
    const keepLockedTitle = card?.hookType === 'locked-title';
    if (!keepLockedTitle && typeof data?.title === 'string' && data.title.trim()) {
      onTopicChange(data.title.trim());
    }
    onChange(next);
    const used = countBudgetUnits(fullNarration, source.scriptLanguage);
    const overBudget = used > source.durationBudget.maxChars * 1.05;
    const underBudget = used < source.durationBudget.maxChars * FILL_RATIO_MIN;
    const warnText = Array.isArray(data?.warnings) && data.warnings.length ? ` ${data.warnings[0]}` : '';
    setStatus(
      overBudget
        ? `文案已保留，但预计口播超出当前目标时长；可延长视频或压缩文案。${warnText}`
        : underBudget
          ? `口播已写入，但只填了预算的 ${Math.round((used / Math.max(1, source.durationBudget.maxChars)) * 100)}%，目标是 90%–105%。${warnText}`
          : bibleHasNarrativeCast(withBible.visualBible)
            ? '已编画面圣经。有证据的角色会在叙事镜上镜，insert 默认无人。'
            : bibleHasCast(withBible.visualBible)
              ? '已编画面圣经。教程/说明型内容，锁定同一被加工对象的实物状态，按句图解。'
              : '口播按整句切开。未识别到可指认主体，按图解推进。'
    );
  };

  const handleDiagnose = async () => {
    const operation = bibleOperations.current.start(workspace);
    const pasted = narrationForDiagnose(workspace);
    if (countBudgetUnits(pasted, scriptLanguage) < 8) {
      setError('先把已有口播粘贴进来');
      return;
    }
    const previous = (workspace.fullNarration || '').replace(/\s+/g, '');
    const scriptChanged = previous !== pasted.replace(/\s+/g, '');
    setBusy('diagnose');
    setError(null);
    try {
      const diagnosed = diagnoseExistingScript({
        ...workspace,
        fullNarration: pasted,
        intentNotes: pasted,
        speechSpans: [],
        visualBible: workspace.visualBible,
        gate: 'fast'
      });
      const withBible = await ensureVisualBible(diagnosed, pasted, operation);
      if (!withBible) return;
      const spanned = await refineSpeechSpans(withBible, pasted);
      const next = await refineCoverage(spanned);
      if (!operationIsCurrent(operation)) { discardBibleOperation(); return; }
      onChange(next);
      setStatus(
        bibleHasNarrativeCast(withBible.visualBible)
          ? '已按整句切口播，并按文案证据编了角色卡。'
          : bibleHasCast(withBible.visualBible)
            ? '已按整句切口播；说明型内容，锁定实物状态按句图解。'
            : '已按整句切口播；未识别到可指认主体，按图解推进。'
      );
    } finally {
      if (bibleOperations.current.isCurrent(operation, operation.workspace)) setBusy(null);
    }
  };

  const applyMode = resolveStoryboardApplyMode({
    workspace,
    stylePack,
    clipCount: existingClips.length
  });

  const handleRebuildBible = async () => {
    const operation = bibleOperations.current.start(workspace);
    const narration = workspace.fullNarration.trim();
    if (countBudgetUnits(narration, scriptLanguage) < 8) {
      setError('先写出口播，再编画面圣经');
      return;
    }
    setBusy('bible');
    setError(null);
    try {
      const next = await ensureVisualBible({
        ...workspace,
        visualBible: workspace.visualBible ? { ...workspace.visualBible, pinned: false } : null
      }, narration, operation);
      if (!next) return;
      const covered = await refineCoverage(rebuildForecast(next));
      if (!operationIsCurrent(operation)) { discardBibleOperation(); return; }
      onChange(covered);
      setStatus(bibleHasNarrativeCast(next.visualBible) ? '画面圣经已按新口播重编。未上锁角色和参考图已清掉。' : '画面约束已更新。未发现叙事班底，按说明型/图解处理。');
    } finally {
      if (bibleOperations.current.isCurrent(operation, operation.workspace)) setBusy(null);
    }
  };

  const handleApply = async () => {
    if (!applyReady) return;
    setBusy('apply');
    try {
      const clips = forecastToClips(
        workspace.forecastShots,
        visualStyle,
        aspectRatio,
        stylePack,
        existingClips,
        workspace.visualBible,
        sentenceGap,
        outroHold,
        workspace.genrePackId
      );
      // 双语字幕：写入分镜时顺手把缺失/过期的翻译行按当前旁白补齐
      const translated = await translateClipsSecondary(clips, customLlmApi, scriptLanguage);
      const finalClips = translated.clips;
      commit(stampAppliedWorkspace(workspace, workspace.forecastShots, stylePack, finalClips.length));
      onNeedFullNarration?.(finalClips);
      if (translated.error) {
        setStatus(`已写入 ${finalClips.length} 镜。翻译行没生成全（${translated.error}），可在字幕面板补齐。`);
      } else if (translated.translated > 0) {
        setStatus(`已写入 ${finalClips.length} 镜，并生成翻译行（${translated.translated} 镜）。对照句同一口气配两图。`);
      } else {
        setStatus(`已写入 ${finalClips.length} 镜。机位已按全片设计，对照句同一口气配两图。`);
      }
      setError(null);
    } finally {
      setBusy(null);
    }
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
    const topic = selected?.title || workspace.lockedTitle.trim() || workspace.intentNotes.trim() || workspaceTopicTitle(workspace);
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
          llmApi: customLlmApi,
          scriptLanguage
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
          topic: selected?.title || workspace.lockedTitle || workspace.intentNotes,
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
          topic: selected?.title || workspace.lockedTitle || workspace.intentNotes,
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
          conceptUsed: card.conceptCount,
          scriptLanguage
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
    if (workspace.intent === 'have-title' && !titleValid) return '先写标题';
    if (waitingAngles) return '选出一张卡';
    if (workspace.intent === 'have-script' && (workspace.fullNarration || workspace.intentNotes).trim()) {
      return '诊断并拆分';
    }
    if (workspace.selectedTopicId) {
      const form = resolveScriptForm(workspace.durationBudget.targetSeconds, workspace.scriptFormOverride);
      if (form === 'medium' && (!workspace.outline || !workspace.outline.sections?.length)) return '生成轻提纲';
      if (outlineConfirmationRequired(form, workspace.confirmOutlineBeforeDraft) && workspace.outline?.status !== 'confirmed') return '生成全片提纲';
      return '按预算写稿';
    }
    if (workspace.intent === 'have-title' && titleValid) return '就按这句写';
    if (workspace.intent === 'reference' && workspace.referenceUrl.trim()) return '反拆对标';
    return '给我选题';
  }, [workspace, titleValid, waitingAngles]);

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
              先锁题，再定时长，最后写口播。预览已收起，把空间留给结构。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="hidden md:inline-flex text-[11px] px-2.5 py-1 rounded-full border bg-zinc-800 text-zinc-400 border-zinc-700 max-w-[220px] truncate">
            {topicTitle}
          </span>
          <div className="inline-flex rounded-lg border border-[#2b2b36] overflow-hidden text-[11px]">
            {(['zh', 'en'] as ScriptLanguage[]).map((lang) => (
              <button
                key={lang}
                id={`btn-script-lang-${lang}`}
                type="button"
                onClick={() => {
                  if (lang === scriptLanguage) return;
                  const dirty = Boolean(workspace.fullNarration.trim() || workspace.topicCards.length || workspace.beats.length);
                  if (dirty && !window.confirm('切换口播语言会清空当前选题、口播和翻译，确定？')) return;
                  commit(switchScriptLanguage(workspace, lang));
                  setStatus(lang === 'en' ? '口播语言已切到英文。双语字幕副行将是中文。' : '口播语言已切到中文。双语字幕副行将是英文。');
                  setError(null);
                }}
                className={`px-2.5 py-1.5 cursor-pointer ${
                  scriptLanguage === lang ? 'bg-amber-500 text-black' : 'text-zinc-300 hover:bg-[#1c1c24]'
                }`}
              >
                {lang === 'zh' ? '中文口播' : 'English'}
              </button>
            ))}
          </div>
          <button
            id="btn-script-fast-gate"
            type="button"
            onClick={handleFastGate}
            disabled={Boolean(busy) || (workspace.intent === 'have-title' && !titleValid) || waitingAngles}
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
          {stageNavMeta(resolveScriptForm(workspace.durationBudget.targetSeconds, workspace.scriptFormOverride)).map((item) => {
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
          <ScriptStageViewport
            stage={workspace.stage}
            canvases={{
              brief: <BriefStageCanvas><BriefStage workspace={workspace} onChange={(next) => {
                if (canEnterOutline(next)) setError(null);
                commit(next);
              }} customLlmApi={customLlmApi} projectId={projectId} /></BriefStageCanvas>,
              intent: <IntentStageCanvas><IntentStage
              workspace={workspace}
              busy={busy === 'topics' || busy === 'reference' || busy === 'diagnose'}
              focusTitle={focusTitle}
              onIntent={(intent) => commit(switchScriptIntent(workspace, intent))}
              onNotes={(intentNotes) => commit({ ...workspace, intentNotes })}
              onLockedTitle={handleTitleChange}
              onReferenceUrl={(referenceUrl) => commit({ ...workspace, referenceUrl })}
              onPlatform={(platform) => commit({ ...workspace, durationBudget: buildDurationBudget({ ...workspace.durationBudget, platform, scriptLanguage }) })}
              onPace={(pace) => commit({ ...workspace, durationSpec: workspace.durationSpec ? { ...workspace.durationSpec, pace } : undefined, durationBudget: buildDurationBudget({ ...workspace.durationBudget, pace, scriptLanguage }) })}
              onGenrePack={handleGenrePack}
              onScout={handleScoutTopics}
              onDiagnose={handleDiagnose}
              onReference={handleReference}
              onLockTitle={handleLockTitle}
              onAdoptScript={handleAdoptPastedScript}
            /></IntentStageCanvas>,
              topic: <TopicStageCanvas><TopicStage
              workspace={workspace}
              selectedId={workspace.selectedTopicId}
              busy={busy === 'topics' || busy === 'concepts'}
              onScout={handleScoutTopics}
              onSelect={handleSelectCard}
              onLockTitle={handleLockTitle}
              onGoDuration={() => setStage('duration')}
              onDropResearch={(topicId, key) => {
                onChange(applyResearchNoteToTopic(workspace, topicId, key));
                setStatus('钩子已换成这条调研笔记。');
              }}
              onMixChange={(conceptMix) => commit({ ...workspace, conceptMix })}
              onMix={handleMix}
            /></TopicStageCanvas>,
              research: <ResearchStageCanvas><ResearchStage
              workspace={workspace}
              busy={busy === 'research' || busy === 'concepts'}
              onChange={(researchNotes) => commit({ ...workspace, researchNotes })}
              onReferenceUrl={(referenceUrl) => commit({ ...workspace, referenceUrl })}
              onFillHook={handleFillHook}
              onResearch={handleResearch}
              onConcepts={handleConcepts}
            /></ResearchStageCanvas>,
              duration: <DurationStageCanvas><DurationStage
              workspace={workspace}
              selected={selected}
              busy={busy === 'draft'}
              onBudget={(durationBudget) => {
                const durationSpec = workspace.durationSpec && durationBudget.targetSeconds >= workspace.durationSpec.minSeconds && durationBudget.targetSeconds <= workspace.durationSpec.maxSeconds ? {
                  ...workspace.durationSpec, targetSeconds: durationBudget.targetSeconds, pace: durationBudget.pace,
                  minSeconds: Math.min(workspace.durationSpec.minSeconds, durationBudget.targetSeconds),
                  maxSeconds: Math.max(workspace.durationSpec.maxSeconds, durationBudget.targetSeconds)
                } : undefined;
                const next = { ...workspace, durationBudget, durationSpec, scriptFormOverride: durationSpec ? durationSpecForm(durationSpec) : workspace.durationSpec ? null : workspace.scriptFormOverride };
                onChange(workspace.fullNarration.trim() ? rebuildForecast(next) : refreshWorkspaceDerived(next));
              }}
              onDraft={handleDraft}
              onGenrePack={handleGenrePack}
              onWorkspacePatch={(patch) => {
                const next = { ...workspace, ...patch };
                onChange(workspace.fullNarration.trim() ? rebuildForecast(next) : refreshWorkspaceDerived(next));
              }}
            /></DurationStageCanvas>,
              beats: <BeatsStageCanvas>{resolveScriptForm(workspace.durationBudget.targetSeconds, workspace.scriptFormOverride) === 'short' ? (
              <BeatsStage
              workspace={workspace}
              onChange={(beats) => {
                const fullNarration = narrationFromBeats(beats, workspace.scriptLanguage);
                onChange(rebuildForecast({ ...workspace, beats, fullNarration }));
              }}
              onFillHook={handleFillHook}
            />
            ) : (
            <ScriptOutlineStage
              workspace={workspace}
              busy={busy === 'draft'}
              customLlmApi={customLlmApi}
              stylePack={stylePack}
              projectId={projectId}
              onChange={(next) => commit(next)}
              onStatus={(message, error) => {
                setStatus(message);
                setError(error || null);
              }}
            />
              )}</BeatsStageCanvas>,
              copy: <CopyStageCanvas><CopyStage
              workspace={workspace}
              customLlmApi={customLlmApi}
              onWorkspaceChange={(next) => commit(next)}
              onChange={(fullNarration) => {
                const beats = applyNarrationToBeats(workspace.beats, fullNarration, workspace.scriptLanguage);
                onChange(rebuildForecast({ ...workspace, fullNarration, beats }));
              }}
              onDraft={handleDraft}
              onDiagnose={handleDiagnose}
              onAdoptDuration={() => {
                const budget = workspace.durationBudget;
                const nextBudget = budgetFromWordCount(
                  Math.max(8, budget.usedChars),
                  budget.platform,
                  budget.pace,
                  budget.speechRate,
                  scriptLanguage
                );
                onChange(rebuildForecast({ ...workspace, durationBudget: nextBudget }));
                setStatus(`已把目标时长调整为约 ${nextBudget.targetSeconds}s，保留现有文案。`);
              }}
              busy={Boolean(busy)}
              onHoldChange={handleHoldChange}
              onFillHook={handleFillHook}
              onEditTitle={() => {
                setFocusTitle(true);
                setStage('intent');
              }}
            /></CopyStageCanvas>,
              rhythm: <RhythmStageCanvas><RhythmStage workspace={workspace} onHoldChange={handleHoldChange} /></RhythmStageCanvas>
            }}
            afterCanvas={(['beats', 'copy', 'rhythm'] as const).some(stage => stage === workspace.stage)
              ? <QualityPanel workspace={workspace} onChange={commit} customLlmApi={customLlmApi} projectId={projectId} />
              : null}
          />
        </div>

        <aside className="hidden xl:flex w-72 flex-shrink-0 border-l border-[#23232c] bg-[#14141a] flex-col overflow-hidden">
          <DirectorRail
            projectId={projectId}
            workspace={workspace}
            onChange={onChange}
            onRebuildBible={() => void handleRebuildBible()}
            onAdoptScript={handleAdoptPastedScript}
            bibleBusy={busy === 'bible'}
            onGenerateCharacterRef={onGenerateCharacterRef}
          onGenerateCharacterRefAll={onGenerateCharacterRefAll}
        />
        <UsagePanel projectId={projectId} />
      </aside>
      </div>

      <div className="xl:hidden border-t border-[#23232c] bg-[#14141a] px-5 py-3">
        <DirectorRail
          projectId={projectId}
          workspace={workspace}
          onChange={onChange}
          onRebuildBible={() => void handleRebuildBible()}
          onAdoptScript={handleAdoptPastedScript}
          bibleBusy={busy === 'bible'}
          compact
          onGenerateCharacterRef={onGenerateCharacterRef}
          onGenerateCharacterRefAll={onGenerateCharacterRefAll}
        />
        <UsagePanel projectId={projectId} />
      </div>

      <footer className="px-5 py-3 border-t border-[#23232c] bg-[#16161c] flex flex-wrap items-center gap-3 flex-shrink-0">
        <button
          id="btn-apply-storyboard"
          type="button"
          onClick={applyMode.mode === 'style-only' ? handleStyleOnly : () => { void handleApply(); }}
          disabled={!applyReady || isGeneratingNarration || isApplyingStyle || applyMode.mode === 'current' || busy === 'apply'}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-semibold bg-gradient-to-r from-amber-500 to-orange-500 text-black disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Clapperboard className="w-4 h-4" />
          {busy === 'apply'
            ? '正在写入并补英文…'
            : applyMode.mode === 'style-only'
              ? '只更新画面，旁白沿用'
              : applyMode.mode === 'current'
                ? '已是当前稿'
                : '写入分镜'}
        </button>
        {!applyReady && applyGate.reason && (
          <span className="text-[11px] text-rose-300 max-w-md leading-snug">{applyGate.reason}</span>
        )}
        {applyReady && applyMode.mode === 'current' && (
          <span className="text-[11px] text-zinc-500">结构和风格都已是当前稿。改口播后若按钮仍灰，点「按预算写稿」或在口播框再改一个字触发重算。</span>
        )}
        {applyMode.mode === 'style-only' && (
          <button
            type="button"
            onClick={() => { void handleApply(); }}
            disabled={!applyReady || isGeneratingNarration || busy === 'apply'}
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
  focusTitle,
  onIntent,
  onNotes,
  onLockedTitle,
  onReferenceUrl,
  onPlatform,
  onPace,
  onGenrePack,
  onScout,
  onDiagnose,
  onReference,
  onLockTitle,
  onAdoptScript
}: {
  workspace: ScriptWorkspace;
  busy: boolean;
  focusTitle?: boolean;
  onIntent: (intent: ScriptIntent) => void;
  onNotes: (value: string) => void;
  onLockedTitle: (value: string) => void;
  onReferenceUrl: (value: string) => void;
  onPlatform: (platform: ScriptPlatform) => void;
  onPace: (pace: ScriptPace) => void;
  onGenrePack: (genre: ScriptGenre) => void;
  onScout: () => void;
  onDiagnose: () => void;
  onReference: () => void;
  onLockTitle: () => void;
  onAdoptScript: () => void;
}) {
  const intent = workspace.intent;
  const lang = normalizeScriptLanguage(workspace.scriptLanguage);
  const titleLimit = titleMaxFor(lang);
  const titleCount = titleCharCount(workspace.lockedTitle, lang);
  const titleValid = isLockedTitleValid(workspace.lockedTitle, lang);
  const titleLooksLikeScript = looksLikeScript(workspace.lockedTitle, lang);
  const placeholder = intent === 'product'
    ? '产品是什么，卖给谁，最想强调哪一句'
    : intent === 'reference'
      ? '对标片讲了什么；有链接更好，没有就写钩子怎么开'
      : intent === 'have-script'
        ? '把整段口播贴在这里'
        : intent === 'direction'
          ? '比如：想讲咖啡因对睡眠的影响'
          : '可选：一个关键词，或直接给我选题';

  const chips = (
    <>
      <div className="flex flex-wrap gap-2">
        {GENRE_PACKS.map((pack) => (
          <Chip key={pack.id} active={workspace.genrePackId === pack.id} onClick={() => onGenrePack(pack.id)}>
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
          <Chip key={item.id} active={workspace.durationBudget.platform === item.id} onClick={() => onPlatform(item.id)}>
            {item.label}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.values(PACE_PRESETS) as typeof PACE_PRESETS[ScriptPace][]).map((item) => (
          <Chip key={item.id} active={workspace.durationBudget.pace === item.id} onClick={() => onPace(item.id)}>
            {item.label} · {item.hint}
          </Chip>
        ))}
      </div>
    </>
  );

  return (
    <div className="space-y-5 max-w-5xl">
      <SectionIntro title="从哪一步开始" desc="点一张入口卡。快闸会按这条路往下走，不会一上来写全文。" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
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

      {intent === 'have-title' && (
        <div className="space-y-3 rounded-2xl border border-[#2b2b36] bg-[#18181f] p-4">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="input-locked-title" className="text-[12px] text-zinc-400">标题</label>
            <span className={`text-[11px] tabular-nums ${titleCount > titleLimit ? 'text-rose-300' : 'text-zinc-500'}`}>
              {titleCount}/{titleLimit}
            </span>
          </div>
          <input
            id="input-locked-title"
            value={workspace.lockedTitle}
            onChange={(e) => onLockedTitle(e.target.value)}
            autoFocus={focusTitle}
            placeholder="就拍这句。例如：咖啡因不是让你清醒，是推迟你睡觉"
            className={`w-full bg-[#121217] border rounded-xl px-3 py-2.5 text-[13px] text-zinc-200 placeholder-zinc-600 focus:outline-none select-text ${
              titleCount > titleLimit ? 'border-rose-500/50' : 'border-[#2b2b36] focus:border-amber-500/50'
            }`}
          />
          <label htmlFor="input-title-insight" className="text-[12px] text-zinc-400">这一条要讲清什么（可空）</label>
          <input
            id="input-title-insight"
            value={workspace.intentNotes}
            onChange={(e) => onNotes(e.target.value)}
            placeholder="可空。空则写稿时推断，但不会改标题"
            className="w-full bg-[#121217] border border-[#2b2b36] rounded-xl px-3 py-2 text-[13px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 select-text"
          />
          {titleLooksLikeScript && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-100 leading-relaxed">
              这更像口播，不要塞进标题。
              <button type="button" onClick={onAdoptScript} className="ml-2 underline text-amber-300 cursor-pointer">
                改走已有文案
              </button>
            </div>
          )}
          {chips}
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton id="btn-lock-title" busy={busy} disabled={!titleValid} onClick={onLockTitle}>
              就按这句写
            </PrimaryButton>
            <button
              id="btn-title-scout-angles"
              type="button"
              disabled={!titleValid || busy}
              onClick={onScout}
              className="text-[12px] text-zinc-400 hover:text-amber-300 cursor-pointer disabled:opacity-40"
            >
              先看三个角度
            </button>
          </div>
        </div>
      )}

      {intent && intent !== 'have-title' && (
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
          {chips}
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
  onLockTitle,
  onGoDuration,
  onDropResearch,
  onMixChange,
  onMix
}: {
  workspace: ScriptWorkspace;
  selectedId: string | null;
  busy: boolean;
  onScout: () => void;
  onSelect: (card: TopicCard) => void;
  onLockTitle: () => void;
  onGoDuration: () => void;
  onDropResearch: (topicId: string, key: keyof ResearchNotes) => void;
  onMixChange: (mix: ScriptWorkspace['conceptMix']) => void;
  onMix: () => void;
}) {
  const lockedCard = workspace.topicCards.find((card) => card.hookType === 'locked-title');
  const angleCards = workspace.topicCards.filter((card) => card.hookType !== 'locked-title');
  const showingLockedOnly = workspace.intent === 'have-title' && Boolean(lockedCard) && angleCards.length === 0;
  const originalTitle = (workspace.lockedTitle || '').trim();

  return (
    <div className="space-y-5">
      <SectionIntro
        title={showingLockedOnly ? '标题已锁定' : '选出一个洞察'}
        desc={showingLockedOnly ? '写稿将按这句展开。也可以用这句再出三个角度。' : '三张卡必须不是同一个意思换标题。点卡只锁题，下一步才定时长。'}
      />
      {workspace.intent === 'have-title' && originalTitle && angleCards.length >= 2 && (
        <button
          type="button"
          onClick={onLockTitle}
          className="w-full text-left rounded-xl border border-amber-500/30 bg-amber-500/8 px-3.5 py-2.5 cursor-pointer hover:border-amber-500/50"
        >
          <div className="text-[10px] uppercase tracking-wide text-amber-400">原标题</div>
          <div className="mt-0.5 text-[13px] text-zinc-100">{originalTitle}</div>
          <div className="mt-1 text-[11px] text-zinc-500">点这里锁回这句</div>
        </button>
      )}
      {workspace.topicCards.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#2b2b36] p-8 text-center space-y-3">
          <p className="text-sm text-zinc-400">还没有选题卡。</p>
          {workspace.intent === 'have-title' ? (
            <PrimaryButton id="btn-lock-title" busy={busy} disabled={!isLockedTitleValid(workspace.lockedTitle, workspace.scriptLanguage)} onClick={onLockTitle}>
              就按这句写
            </PrimaryButton>
          ) : (
            <PrimaryButton id="btn-scout-topics" busy={busy} onClick={onScout}>给我选题</PrimaryButton>
          )}
        </div>
      ) : showingLockedOnly && lockedCard ? (
        <div className="space-y-3">
          <div
            id={`topic-card-${lockedCard.id}`}
            className="text-left rounded-2xl border border-amber-500/60 bg-amber-500/10 p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-amber-400/90">{lockedCard.genre} · 已锁定</span>
              <span className="text-[10px] text-zinc-500">{lockedCard.durationHint}s · {PACE_PRESETS[lockedCard.paceHint]?.label}</span>
            </div>
            <h3 className="mt-2 text-[14px] font-semibold text-zinc-100 leading-snug">{lockedCard.title}</h3>
            <p className="mt-2 text-[12px] text-zinc-400 leading-relaxed">{lockedCard.insight}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton id="btn-go-duration" onClick={onGoDuration}>去定时长</PrimaryButton>
            <button
              id="btn-title-scout-angles"
              type="button"
              disabled={busy}
              onClick={onScout}
              className="text-[12px] text-zinc-400 hover:text-amber-300 cursor-pointer disabled:opacity-40"
            >
              用这句再出三个角度
            </button>
          </div>
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

function DurationStage({
  workspace,
  selected,
  busy,
  onBudget,
  onDraft,
  onGenrePack,
  onWorkspacePatch
}: {
  workspace: ScriptWorkspace;
  selected: TopicCard | null;
  busy: boolean;
  onBudget: (budget: ScriptWorkspace['durationBudget']) => void;
  onDraft: () => void;
  onGenrePack: (genre: ScriptGenre) => void;
  onWorkspacePatch?: (patch: Partial<ScriptWorkspace>) => void;
}) {
  const budget = workspace.durationBudget;
  const rec = selected
    ? recommendDuration(budget.platform, selected.genre, selected.conceptCount)
    : workspace.intent === 'have-title'
      ? { reason: lockedTitleDurationReason(workspace), seconds: budget.targetSeconds, pace: budget.pace }
      : null;
  const estimate = estimatedShotCount(budget);
  const lockHint = lockedShotImplication(budget);
  const lang = normalizeScriptLanguage(workspace.scriptLanguage);
  const unit = budgetUnitLabel(lang);
  const canDraft = hasUsableDraftTopic(workspace);
  const plat = PLATFORM_OPTIONS.find((item) => item.id === budget.platform);
  const form = resolveScriptForm(budget.targetSeconds, workspace.scriptFormOverride);
  const length = lengthBudgetOf(budget);
  const lockMax = Math.min(Math.max(24, estimate.max), maxForecastShotsForDuration(budget.targetSeconds));
  const draftHint = workspace.intent === 'have-title' && !isLockedTitleValid(workspace.lockedTitle, lang) && !selected
    ? '先回意图页写标题'
    : undefined;

  return (
    <div className="space-y-5 max-w-4xl">
      <SectionIntro
        title="把时长当成预算"
        desc={rec ? rec.reason : `改平台、节奏、秒数，${unit}数和停留会立刻重算。体裁包会带上节拍骨架。平台范围是推荐值，不是硬上限。`}
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
        {plat && (
          <span className="text-[11px] text-zinc-500">推荐 {plat.min}–{plat.max}s · 最长 {MAX_VIDEO_SECONDS}s</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.values(PACE_PRESETS) as typeof PACE_PRESETS[ScriptPace][]).map((item) => (
          <Chip key={item.id} active={budget.pace === item.id} onClick={() => onBudget(buildDurationBudget({ ...budget, pace: item.id }))}>
            {item.label} {languageProfile(lang).paceUnitsPerSecond[item.id]}{unit}/秒
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {TARGET_SECONDS_PRESETS.map((seconds) => (
          <Chip key={seconds} active={budget.targetSeconds === seconds} onClick={() => onBudget(buildDurationBudget({ ...budget, targetSeconds: seconds }))}>
            {seconds}s
          </Chip>
        ))}
        <span className="text-[10px] px-2 py-1 rounded-lg bg-amber-500/15 text-amber-200 border border-amber-500/30">
          {scriptFormLabel(form)} · {budget.targetSeconds}s
        </span>
        {!workspace.durationSpec && (['auto', 'short', 'medium', 'long', 'extended'] as const).map((item) => (
          <Chip
            key={item}
            active={(workspace.scriptFormOverride || 'auto') === item}
            onClick={() => onWorkspacePatch?.({
              scriptFormOverride: item === 'auto' ? null : item,
              scriptForm: item === 'auto' ? scriptFormForSeconds(budget.targetSeconds) : item
            })}
          >
            {item === 'auto' ? '自动分层' : scriptFormLabel(item)}
          </Chip>
        ))}
        <label className="text-[11px] text-zinc-500 flex items-center gap-1.5">
          自定义
          <input
            type="number"
            min={MIN_VIDEO_SECONDS}
            max={MAX_VIDEO_SECONDS}
            value={budget.targetSeconds}
            onChange={(e) => {
              const next = clampVideoSeconds(Number(e.target.value), budget.targetSeconds);
              onBudget(buildDurationBudget({ ...budget, targetSeconds: next.seconds }));
            }}
            className="w-16 bg-[#18181f] border border-[#2b2b36] rounded-lg px-2 py-1 text-zinc-200 text-[12px]"
          />
        </label>
        <label className="text-[11px] text-zinc-500 flex items-center gap-1.5">
          锁镜数
          <input
            type="number"
            min={2}
            max={lockMax}
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
        <BudgetRing label={`目标口播${unit}数`} used={budget.usedChars} max={length.targetUnits} unit={unit} />
        <BudgetRing label="停留配额" used={Number((workspace.forecastShots.reduce((sum, shot) => sum + shot.holdDuration, 0)).toFixed(1))} max={length.visualHoldTargetSeconds} unit="s" />
        <BudgetRing label="概念" used={budget.conceptUsed || (selected ? selected.conceptCount : 0)} max={budget.conceptMax} unit="个" />
        {workspace.durationCalibration && <BudgetRing label="口播：估算 vs 实测" used={workspace.durationCalibration.actualSec ?? 0} max={workspace.durationCalibration.estimatedSec} unit="s" />}
      </div>
      {workspace.durationCalibration && <div aria-label="语速校准对比" className="rounded-xl border border-zinc-700 p-3 text-sm text-zinc-300 space-y-1">
        <p>估算 {workspace.durationCalibration.estimatedSec.toFixed(1)}s · 实测 {workspace.durationCalibration.actualSec?.toFixed(1) ?? '待合成 / 对齐'}{workspace.durationCalibration.actualSec == null ? '' : 's'} · 校准样本 {workspace.durationCalibration.sampleCount}</p>
        {workspace.durationCalibration.sections.map(item => <p key={item.sectionId}>
          {workspace.sections?.find(s => s.id === item.sectionId)?.title || item.sectionId}：估算 {item.estimatedSec.toFixed(1)}s · 实测 {item.actualSec?.toFixed(1) ?? '待合成 / 对齐'}{item.actualSec == null ? '' : 's'}
        </p>)}
        <p className="text-xs text-zinc-500">实测只统计对齐的口播，不含句间停留。合成前的估算保留用于对比，校准用于下一次估算。</p>
      </div>}

      <div className="text-[12px] text-zinc-400 flex flex-wrap items-center gap-2 leading-relaxed">
        <Clock className="w-3.5 h-3.5 text-amber-400" />
        目标 {length.targetUnits}{unit}（允许 {length.minUnits}–{length.maxUnits}）· 预计口播 {formatSeconds(length.speechTargetSeconds)} · 预计停留 {formatSeconds(length.visualHoldTargetSeconds)} · {budget.lockedShotCount ? `锁 ${budget.lockedShotCount} 镜` : `${estimate.min}–${estimate.max} 镜`}
        {budget.actualSpeechSeconds != null && (
          <span className="text-emerald-300">· 实测口播 {formatSeconds(budget.actualSpeechSeconds)}</span>
        )}
        {budget.actualTotalSeconds != null && (
          <span className="text-emerald-300">· 成片 {formatSeconds(budget.actualTotalSeconds)}</span>
        )}
      </div>

      <div className="space-y-1.5">
        <PrimaryButton id="btn-draft-from-budget" busy={busy} onClick={onDraft} disabled={!canDraft}>
          {outlineConfirmationRequired(form) && workspace.outline?.status !== 'confirmed' ? '生成全片提纲' : '按预算写稿'}
        </PrimaryButton>
        {form === 'medium' && (
          <label className="flex items-center gap-2 text-[12px] text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(workspace.confirmOutlineBeforeDraft)}
              onChange={(e) => onWorkspacePatch?.({ confirmOutlineBeforeDraft: e.target.checked })}
            />
            写稿前先确认提纲
          </label>
        )}
        {draftHint && <p className="text-[11px] text-zinc-500">{draftHint}</p>}
      </div>
    </div>
  );
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
  projectId,
  workspace,
  onChange,
  onRebuildBible,
  onAdoptScript,
  bibleBusy,
  compact,
  onGenerateCharacterRef,
  onGenerateCharacterRefAll
}: {
  projectId: string;
  workspace: ScriptWorkspace;
  onChange?: (workspace: ScriptWorkspace) => void;
  onRebuildBible?: () => void;
  onAdoptScript?: () => void;
  bibleBusy?: boolean;
  compact?: boolean;
  onGenerateCharacterRef?: (characterId: string, variant: CharacterCardVariant) => Promise<boolean>;
  onGenerateCharacterRefAll?: () => void;
}) {
  const [compactOpen, setCompactOpen] = useState(false);
  const latestWorkspace = useRef(workspace);
  latestWorkspace.current = workspace;
  const uploads = useRef(new Map<string, CharacterRefRequest>());
  useEffect(() => () => uploads.current.clear(), []);
  const [refBusyId, setRefBusyId] = useState<string | null>(null);
  const [cardBusyId, setCardBusyId] = useState<string | null>(null);
  const [cardVariant, setCardVariant] = useState<Record<string, CharacterCardVariant>>({});
  const budget = workspace.durationBudget;
  const notes = workspace.directorNotes;
  const bible = workspace.visualBible;
  const bibleSource = workspaceBibleSource(workspace);
  const sourceShift = visualBibleSourceShift(bible, bibleSource.narration, bibleSource.genre, bibleSource);
  const bibleDiff = previewBibleDiff(bible, {
    narration: workspace.fullNarration,
    title: bibleSource.title,
    intentNotes: bibleSource.intentNotes,
    genre: workspace.genrePackId
  });
  const showCards = !compact || compactOpen;
  const missingRefCount = (bible?.characters || [])
    .filter((character) => shouldOfferAutoCard(character) && !characterHasRef(character)).length;
  const patchBible = (next: VisualBible) => {
    if (!onChange) return;
    onChange(rebuildForecast({ ...workspace, visualBible: next }));
  };
  const handlePickRef = async (characterId: string, file: File) => {
    if (!bible) return;
    const character = bible.characters.find(item => item.id === characterId);
    if (!character) return;
    const request = captureCharacterRefRequest(projectId, bible, character);
    uploads.current.set(request.entityId, request);
    setRefBusyId(characterId);
    try {
      const ref = await prepareCharacterRefFile(file);
      const live = latestWorkspace.current;
      const next = live.visualBible && uploads.current.get(request.entityId) === request
        && live.fullNarration === workspace.fullNarration
        ? applyCharacterRefResponse(projectId, live.visualBible, request, ref) : null;
      if (!next) {
        showStatusToast('角色或参考图已更新，已忽略此前上传的图片', { tone: 'info', id: 'character-ref' });
        return;
      }
      onChange?.(rebuildForecast({ ...live, visualBible: next }));
      showStatusToast('已钉参考图，生图时会锁脸和服装', { tone: 'ok', id: 'character-ref' });
    } catch (err: any) {
      showStatusToast(err?.message || '参考图上传失败', { tone: 'error', id: 'character-ref' });
    } finally {
      setRefBusyId(null);
    }
  };
  const handleAutoRef = async (characterId: string) => {
    if (!onGenerateCharacterRef || !bible) return;
    const variant = cardVariant[characterId] || 'face';
    setCardBusyId(characterId);
    try {
      await onGenerateCharacterRef(characterId, variant);
    } finally {
      setCardBusyId(null);
    }
  };
  return (
    <div className={`p-4 space-y-3 ${compact ? '' : 'overflow-y-auto custom-scrollbar h-full'}`}>
      <div className="text-[12px] font-medium text-zinc-200">导演批注</div>
      <div className={`grid gap-2 ${compact ? 'grid-cols-3' : 'grid-cols-1'}`}>
        <MiniStat label={`${budgetUnitLabel(workspace.scriptLanguage)}数`} value={`${budget.usedChars}/${budget.maxChars}`} warn={budget.usedChars > budget.maxChars} />
        <MiniStat
          label="时长"
          value={`${budget.targetSeconds}s`}
          warn={workspace.forecastShots.reduce((sum, shot) => sum + shot.speechDuration + shot.holdDuration, 0) > budget.targetSeconds + 0.4}
        />
        <MiniStat label="预测" value={forecastSummary(workspace).split('·')[0]} />
      </div>
      {notes.length === 0 ? (
        <p className="text-[11px] text-zinc-500 leading-relaxed">还没有需要改的地方。{budgetUnitLabel(workspace.scriptLanguage)}数超了、钩子太长、节奏太平，会出现在这里。</p>
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
              {note.id === 'title-looks-script' && onAdoptScript && (
                <button type="button" onClick={onAdoptScript} className="mt-1 block underline text-amber-300 cursor-pointer">
                  改走已有文案
                </button>
              )}
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
          {bibleHasNarrativeCast(bible) ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-300">有班底</span>
          ) : bibleLocksObject(bible) || bibleHasCast(bible) ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-sky-500/30 text-sky-300">锁实物</span>
          ) : bible ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded border border-zinc-700 text-zinc-500">纯图解</span>
          ) : null}
        </div>
        {compact && (
          <button
            type="button"
            onClick={() => setCompactOpen((open) => !open)}
            className="w-full text-left text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
          >
            {bibleSummary(bible)}{sourceShift ? (bible?.pinned ? ' · 来源已变' : ' · 口播已改') : ''}{bibleHasCast(bible) ? ' · 点开钉参考图' : ''}
          </button>
        )}
        {showCards && (
          <>
            {!compact && (
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              {bible ? bibleSummary(bible) : '写稿后会按整段口播编角色和场景，而不是一句一换人。'}
            </p>
            )}
            {sourceShift && bible && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-200 leading-relaxed">
                {bible.pinned
                  ? '当前圣经与新口播来源不同。已钉住，不会自动重编。'
                  : '口播已改，圣经可能过时。'}
                {bibleDiff.summary ? <div className="mt-1 text-amber-100/80">{bibleDiff.summary}</div> : null}
              </div>
            )}
            {bible?.presentation === 'narrator_led' || (bible?.pendingCharacters || []).some((item) => item.kind === 'narrator') ? (
              <div className="space-y-1.5">
                <p className="text-[10px] text-zinc-500">第一人称：选择画面身份</p>
                <div className="flex flex-wrap gap-1">
                  {([
                    ['voiceover', '旁白声音'],
                    ['on_camera', '出镜讲解员'],
                    ['story_character', '剧情角色']
                  ] as Array<[NarratorMode, string]>).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => patchBible(applyNarratorMode(bible!, mode, {
                        narration: workspace.fullNarration,
                        title: bibleSource.title,
                        intentNotes: bibleSource.intentNotes,
                        genre: workspace.genrePackId
                      }))}
                      className={`px-2 py-1 rounded-lg text-[10px] border cursor-pointer ${
                        (bible?.narratorMode || 'voiceover') === mode
                          ? 'bg-amber-500/15 text-amber-200 border-amber-500/40'
                          : 'bg-[#18181f] text-zinc-400 border-[#2b2b36] hover:text-zinc-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {bible?.analysisReason ? (
              <p className="text-[10px] text-zinc-500 leading-relaxed">{bible.analysisReason}</p>
            ) : null}
            {onRebuildBible && (
              <button
                type="button"
                onClick={onRebuildBible}
                disabled={bibleBusy || countBudgetUnits(workspace.fullNarration, workspace.scriptLanguage) < 8}
                className="text-[11px] text-amber-400 hover:text-amber-300 cursor-pointer disabled:opacity-40"
              >
                {bibleBusy ? '正在编圣经…' : bible ? '按口播重编' : '编画面圣经'}
              </button>
            )}
            {showCards && onGenerateCharacterRefAll && missingRefCount > 0 && (
              <button
                type="button"
                onClick={onGenerateCharacterRefAll}
                disabled={bibleBusy || cardBusyId !== null}
                className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-300 hover:bg-amber-500/20 cursor-pointer disabled:opacity-40"
              >
                一键生成 {missingRefCount} 张缺参考图
              </button>
            )}
            {Object.values(bible?.overrides || {}).filter(override => override.decision === 'exclude').map(override => (
              <div key={override.entityId} className="flex items-center justify-between gap-2 text-[10px] text-zinc-500">
                <span>已排除：{override.displayName || override.decisionCard?.name || bible?.entityLedger?.entities.find(entity => entity.id === override.entityId)?.name}</span>
                <button type="button" className="text-amber-400" onClick={() => bible && patchBible(reduceBibleAction(bible, {
                  type: 'set_entity_decision', entityId: override.entityId, decision: 'auto'
                }))}>恢复自动</button>
              </div>
            ))}
            {(bible?.pendingCharacters || []).map((character) => (
              <div key={character.id} className="rounded-xl border border-dashed border-amber-500/30 bg-[#18181f] p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] text-zinc-100 font-medium">{character.name}</div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded border border-amber-500/30 text-amber-300">待确认</span>
                </div>
                <p className="text-[10px] text-zinc-500">{character.kind === 'narrator' ? '第一人称讲述者' : character.kind === 'anonymous' ? '匿名人物' : '待确认角色'} · 外形未知</p>
                {character.evidenceSpans?.[0] ? (
                  <p className="text-[10px] text-emerald-300/80 leading-relaxed">
                    {evidenceSourceLabel(character.evidenceSpans[0].source)} {character.evidenceSpans[0].start}–{character.evidenceSpans[0].end} 「{character.evidenceSpans[0].text}」
                  </p>
                ) : character.sourceEvidence?.[0] ? (
                  <p className="text-[10px] text-emerald-300/80 leading-relaxed">文案依据：{character.sourceEvidence[0]}</p>
                ) : null}
                {character.castReason ? <p className="text-[10px] text-zinc-500">{character.castReason}</p> : null}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => patchBible(confirmPendingCharacter(bible!, character.id))}
                    className="flex-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300 cursor-pointer"
                  >
                    确认为角色
                  </button>
                  <button
                    type="button"
                    onClick={() => patchBible(rejectPendingCharacter(bible!, character.id))}
                    className="flex-1 rounded-lg border border-[#2b2b36] px-2 py-1 text-[10px] text-zinc-400 cursor-pointer"
                  >
                    不建卡
                  </button>
                </div>
              </div>
            ))}
            {bible && bibleHasCast(bible) && bible.characters.map((character) => (
              <div key={character.id} className="rounded-xl border border-[#2b2b36] bg-[#18181f] p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <input
                    value={character.name}
                    onChange={(e) => patchBible(updateCharacterField(bible, character.id, { name: e.target.value }))}
                    className="bg-transparent text-[12px] text-zinc-100 font-medium min-w-0 flex-1 focus:outline-none"
                  />
                  {bible.overrides?.[character.entityId || character.candidateId || '']?.decision === 'include' && (
                    <button type="button" className="text-[10px] text-zinc-400"
                      onClick={() => patchBible(reduceBibleAction(bible, { type: 'set_entity_decision',
                        entityId: character.entityId || character.candidateId || character.id, decision: 'auto' }))}>
                      恢复自动
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-zinc-500">
                  {character.role === 'lead' ? '主角' : character.role === 'support' ? '配角' : '群众'}
                  {' · '}{character.ageBand}
                  {typeof character.confidence === 'number' ? ` · 置信 ${Math.round(character.confidence * 100)}%` : ''}
                </p>
                <div className="flex flex-wrap gap-1">
                  {([
                    ['identity', '锁身份', character.identityLocked],
                    ['appearance', '锁外形', character.appearanceLocked],
                    ['refs', '锁参考图', character.refsLocked]
                  ] as Array<['identity' | 'appearance' | 'refs', string, boolean | undefined]>).map(([flag, label, on]) => (
                    <button
                      key={flag}
                      type="button"
                      title={label}
                      onClick={() => patchBible(toggleCharacterLockFlag(bible, character.id, flag))}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border cursor-pointer ${
                        on ? 'text-amber-300 border-amber-500/40 bg-amber-500/10' : 'text-zinc-500 border-[#2b2b36] hover:text-zinc-300'
                      }`}
                    >
                      {on ? <Lock className="w-2.5 h-2.5" /> : <Unlock className="w-2.5 h-2.5" />}
                      {label}
                    </button>
                  ))}
                </div>
                {character.evidenceSpans?.[0] ? (
                  <p className="text-[10px] text-emerald-300/80 leading-relaxed">
                    {evidenceSourceLabel(character.evidenceSpans[0].source)} {character.evidenceSpans[0].start}–{character.evidenceSpans[0].end} 「{character.evidenceSpans[0].text}」
                  </p>
                ) : character.sourceEvidence?.length ? (
                  <p className="text-[10px] text-emerald-300/80 leading-relaxed">文案依据：{character.sourceEvidence[0]}</p>
                ) : (
                  <p className="text-[10px] text-amber-300/80 leading-relaxed">未找到明确文案依据，请先核对角色</p>
                )}
                {character.castReason ? (
                  <p className="text-[10px] text-zinc-500 leading-relaxed">{character.castReason}</p>
                ) : null}
                {character.appearanceUnknown ? (
                  <p className="text-[10px] text-zinc-500">外形未在文案中出现，请确认后再当生图硬约束。</p>
                ) : null}
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
                {shouldOfferAutoCard(character) && onGenerateCharacterRef && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <div className="flex rounded-lg border border-[#2b2b36] overflow-hidden flex-shrink-0">
                        {CHARACTER_CARD_VARIANTS.map((item) => {
                          const active = (cardVariant[character.id] || 'face') === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              aria-pressed={active}
                              disabled={cardBusyId === character.id}
                              onClick={() => setCardVariant((prev) => ({ ...prev, [character.id]: item.id }))}
                              title={item.hint}
                              className={`px-1.5 py-1 text-[10px] cursor-pointer disabled:opacity-40 ${
                                active ? 'bg-amber-500 text-black font-medium' : 'text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {item.label}
                            </button>
                          );
                        })}
                      </div>
                      <button
                        type="button"
                        disabled={cardBusyId === character.id}
                        onClick={() => void handleAutoRef(character.id)}
                        className="flex-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300 hover:bg-amber-500/20 cursor-pointer disabled:opacity-40"
                      >
                        {cardBusyId === character.id ? '正在生成…' : 'AI 生成参考图'}
                      </button>
                    </div>
                    {cardBusyId === character.id && (
                      <p className="text-[10px] text-amber-300">正在生成…完成后自动上锁</p>
                    )}
                  </div>
                )}
                <CharacterRefSlot
                  previewUrl={characterRefPreview(character)}
                  disabled={refBusyId === character.id || cardBusyId === character.id}
                  onPick={(file) => void handlePickRef(character.id, file)}
                  onClear={() => patchBible(clearCharacterRef(bible, character.id))}
                />
                {refBusyId === character.id && (
                  <p className="text-[10px] text-amber-300">正在保存参考图…</p>
                )}
                {characterHasRef(character) && (
                  <p className="text-[10px] text-zinc-600">
                    {character.refs?.[0]?.notes?.startsWith('generated') ? 'AI 生成参考图 · 已自动上锁' : '生图时会按这张图锁脸和服装'}
                  </p>
                )}
              </div>
            ))}
            {bibleSubjects(bible).map((subject) => (
              <div key={subject.id} className="rounded-xl border border-sky-500/20 bg-[#18181f] p-2.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[12px] text-zinc-100 font-medium">{subject.name}</div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded border border-sky-500/30 text-sky-300">实物锁</span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-relaxed">{subject.look}</p>
                {subject.evidenceSpans?.[0] ? (
                  <p className="text-[10px] text-emerald-300/80 leading-relaxed">
                    {evidenceSourceLabel(subject.evidenceSpans[0].source)} 「{subject.evidenceSpans[0].text}」
                  </p>
                ) : subject.sourceEvidence?.[0] ? (
                  <p className="text-[10px] text-emerald-300/80 leading-relaxed">文案依据：{subject.sourceEvidence[0]}</p>
                ) : null}
              </div>
            ))}
            {bible?.locations[0] && (
              <div className="text-[11px] text-zinc-500 leading-relaxed">
                场景 {bible.locations[0].name} · {bible.locations[0].timeOfDay}
              </div>
            )}
            {bible?.validation?.warnings?.length ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[10px] text-amber-200 leading-relaxed">
                {bible.validation.warnings.map((warning) => <div key={warning}>角色校验：{warning}</div>)}
              </div>
            ) : null}
            {!bibleHasNarrativeCast(bible) && bible?.paletteLock && (
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
