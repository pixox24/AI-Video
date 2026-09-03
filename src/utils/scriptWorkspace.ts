import {
  AspectRatio,
  ConceptMix,
  DirectorNote,
  ForecastShot,
  NarrativeStructure,
  ResearchNotes,
  ScriptBeat,
  ScriptGenre,
  ScriptIntent,
  ScriptLanguage,
  ScriptPace,
  ScriptWorkspace,
  StoryboardClip,
  TopicCard,
  TransitionType,
  StylePack,
  VideoProject,
  VisualBible,
  VisualStyle
} from '../types';
import { generateProceduralArtwork } from './visualGenerator';
import { presetStylePack } from './stylePack';
import { beatToChinese, compileImagePrompt } from './imagePrompt';
import { cameraMotionForCoverage, withCoverage } from './shotCoverage';
import {
  groundVisualBible,
  normalizeVisualBible,
  stampShotsWithBible,
  stripBiblePrefix,
  visualBibleModeForGenre
} from './visualBible';
import { ensureUniqueClipIds, joinClipNarrations, newClipId, repairClipSlices } from './narrationTrack';
import {
  countBudgetUnits,
  languageProfile,
  normalizeScriptLanguage,
  titleUnitCount
} from './scriptLanguage';
import { clampOutroHold, clampSentenceGap, SENTENCE_GAP_DEFAULT } from './sentenceGap';
import {
  applyHoldToShots,
  applyPinnedHolds,
  beatsFromNarration,
  buildDurationBudget,
  budgetFromWordCount,
  estimatedShotCount,
  genrePackById,
  narrationFromBeats,
  PLATFORM_OPTIONS,
  predictShots,
  validateForecast
} from './scriptBudget';
import { buildSpeechSpans, gateSpeechSpans, normalizeSpeechSpans } from './speechSpans';

export const EMPTY_RESEARCH: ResearchNotes = {
  competitor: '',
  audienceQuestion: '',
  fact: '',
  visualRef: ''
};

export const EMPTY_MIX: ConceptMix = { hookFromId: null, structureFromId: null };

export const TITLE_MIN_CHARS = 2;
export const TITLE_MAX_CHARS = 24;

export function createDefaultScriptWorkspace(): ScriptWorkspace {
  const durationBudget = buildDurationBudget({ platform: 'douyin', pace: 'medium', targetSeconds: 30, scriptLanguage: 'zh' });
  return {
    stage: 'intent',
    gate: 'deep',
    scriptLanguage: 'zh',
    intent: null,
    intentNotes: '',
    lockedTitle: '',
    topicCards: [],
    selectedTopicId: null,
    researchNotes: { ...EMPTY_RESEARCH },
    durationBudget,
    beats: [],
    fullNarration: '',
    speechSpans: [],
    forecastShots: [],
    directorNotes: [],
    referenceUrl: '',
    researchBrief: null,
    referenceBreakdown: null,
    conceptMix: { ...EMPTY_MIX },
    genrePackId: null
  };
}

export function hydrateScriptWorkspace(project: VideoProject): ScriptWorkspace {
  if (project.scriptWorkspace) {
    return refreshWorkspaceDerived(normalizeScriptWorkspace(project.scriptWorkspace));
  }

  const narration = joinClipNarrations(project.clips || []);
  const scriptLanguage = normalizeScriptLanguage(project.scriptWorkspace?.scriptLanguage);
  const hasCopy = countBudgetUnits(narration, scriptLanguage) >= 8;
  const totalDuration = (project.clips || []).reduce((sum, clip) => sum + (clip.duration || 0), 0);
  const durationBudget = buildDurationBudget({
    platform: 'douyin',
    pace: 'medium',
    durationMode: hasCopy ? 'content-driven' : 'target-driven',
    targetSeconds: totalDuration > 6 ? Math.round(totalDuration) : 30,
    usedChars: countBudgetUnits(narration, scriptLanguage),
    conceptUsed: 1,
    scriptLanguage
  });

  const topicTitle = (project.topic || project.title || '').trim();
  const beats = hasCopy ? beatsFromClips(project.clips) : [];
  const forecastShots = hasCopy
    ? (project.clips.length >= 2 ? shotsFromClips(project.clips) : predictShots({ narration, beats, budget: durationBudget }))
    : [];

  if (hasCopy) {
    const card = topicTitle ? seedTopicCard(topicTitle) : null;
    return refreshWorkspaceDerived({
      ...createDefaultScriptWorkspace(),
      scriptLanguage,
      stage: 'copy',
      gate: 'deep',
      intent: 'have-script',
      intentNotes: topicTitle,
      topicCards: card ? [card] : [],
      selectedTopicId: card?.id || null,
      durationBudget,
      beats,
      fullNarration: narration,
      forecastShots
    });
  }

  if (topicTitle) {
    return refreshWorkspaceDerived(lockTitleFromIntent({
      ...createDefaultScriptWorkspace(),
      scriptLanguage,
      intent: 'have-title',
      lockedTitle: topicTitle,
      durationBudget,
      stage: 'intent'
    }, { jumpToDuration: false }));
  }

  return refreshWorkspaceDerived({
    ...createDefaultScriptWorkspace(),
    scriptLanguage,
    durationBudget
  });
}

export function normalizeScriptWorkspace(raw: ScriptWorkspace): ScriptWorkspace {
  const base = createDefaultScriptWorkspace();
  const scriptLanguage = normalizeScriptLanguage(raw.scriptLanguage || raw.durationBudget?.scriptLanguage);
  const durationBudget = buildDurationBudget({
    ...base.durationBudget,
    ...(raw.durationBudget || {}),
    durationMode: raw.durationBudget?.durationMode || (raw.intent === 'have-script' ? 'content-driven' : 'target-driven'),
    speechRate: raw.durationBudget?.speechRate || 1,
    usedChars: countBudgetUnits(raw.fullNarration || '', scriptLanguage),
    conceptUsed: raw.durationBudget?.conceptUsed || raw.topicCards?.find((card) => card.id === raw.selectedTopicId)?.conceptCount || 0,
    scriptLanguage
  });
  return {
    ...base,
    ...raw,
    scriptLanguage,
    researchNotes: { ...EMPTY_RESEARCH, ...(raw.researchNotes || {}) },
    durationBudget,
    topicCards: Array.isArray(raw.topicCards) ? raw.topicCards : [],
    beats: Array.isArray(raw.beats) ? raw.beats : [],
    speechSpans: Array.isArray(raw.speechSpans) ? raw.speechSpans : [],
    forecastShots: Array.isArray(raw.forecastShots) ? raw.forecastShots : [],
    directorNotes: Array.isArray(raw.directorNotes) ? raw.directorNotes : [],
    fullNarration: raw.fullNarration || '',
    intentNotes: raw.intentNotes || '',
    lockedTitle: raw.lockedTitle || '',
    draftedTitle: raw.draftedTitle,
    referenceUrl: raw.referenceUrl || '',
    researchBrief: raw.researchBrief || null,
    referenceBreakdown: raw.referenceBreakdown || null,
    conceptMix: { ...EMPTY_MIX, ...(raw.conceptMix || {}) },
    genrePackId: raw.genrePackId || null,
    hookPreviewUrl: raw.hookPreviewUrl,
    visualBible: (() => {
      const bible = normalizeVisualBible(raw.visualBible, visualBibleModeForGenre(raw.genrePackId));
      return bible && raw.fullNarration
        ? groundVisualBible(bible, raw.fullNarration, {
          title: raw.lockedTitle || raw.draftedTitle,
          intentNotes: raw.intentNotes
        })
        : bible;
    })()
  };
}

export function refreshWorkspaceDerived(workspace: ScriptWorkspace): ScriptWorkspace {
  const scriptLanguage = normalizeScriptLanguage(workspace.scriptLanguage);
  const usedChars = countBudgetUnits(workspace.fullNarration, scriptLanguage);
  const selected = workspace.topicCards.find((card) => card.id === workspace.selectedTopicId);
  const durationBudget = buildDurationBudget({
    ...workspace.durationBudget,
    usedChars,
    conceptUsed: selected?.conceptCount || workspace.durationBudget.conceptUsed,
    scriptLanguage
  });
  const directorNotes = [
    ...titleDirectorNotes({ ...workspace, scriptLanguage, durationBudget }),
    ...validateForecast({
      budget: durationBudget,
      shots: workspace.forecastShots,
      beats: workspace.beats,
      scriptLanguage
    })
  ];
  return { ...workspace, durationBudget, directorNotes };
}

/** Intent-stage paste lives in intentNotes; the copy editor is fullNarration. */
export function narrationForDiagnose(workspace: ScriptWorkspace): string {
  const notes = (workspace.intentNotes || '').trim();
  const full = (workspace.fullNarration || '').trim();
  const lateStage = workspace.stage === 'copy' || workspace.stage === 'beats' || workspace.stage === 'rhythm';
  if (lateStage) return full || notes;
  if (countBudgetUnits(notes, workspace.scriptLanguage) >= 8) return notes;
  return full || notes;
}

export function diagnoseExistingScript(workspace: ScriptWorkspace): ScriptWorkspace {
  const narration = (workspace.fullNarration || narrationForDiagnose(workspace)).trim();
  const scriptLanguage = normalizeScriptLanguage(workspace.scriptLanguage);
  const chars = countBudgetUnits(narration, scriptLanguage);
  const durationBudget = budgetFromWordCount(
    Math.max(chars, 8),
    workspace.durationBudget.platform,
    workspace.durationBudget.pace,
    workspace.durationBudget.speechRate,
    scriptLanguage
  );
  const beats = beatsFromNarration(narration, durationBudget);
  return rebuildForecast({
    ...workspace,
    fullNarration: narration,
    beats,
    durationBudget: { ...durationBudget, usedChars: chars, durationMode: 'content-driven' },
    stage: 'copy'
  });
}

export function rebuildForecast(workspace: ScriptWorkspace): ScriptWorkspace {
  const scriptLanguage = normalizeScriptLanguage(workspace.scriptLanguage);
  const usedChars = countBudgetUnits(workspace.fullNarration, scriptLanguage);
  const selected = workspace.topicCards.find((card) => card.id === workspace.selectedTopicId);
  const durationBudget = buildDurationBudget({
    ...workspace.durationBudget,
    usedChars,
    conceptUsed: selected?.conceptCount || workspace.durationBudget.conceptUsed,
    scriptLanguage
  });
  const joinedSpans = (workspace.speechSpans || []).map((span) => span.text).join('').replace(/\s+/g, '');
  const joinedNarration = (workspace.fullNarration || '').replace(/\s+/g, '');
  const spansFresh = Boolean(workspace.speechSpans?.length) && joinedSpans === joinedNarration;
  const speechSpans = spansFresh
    ? normalizeSpeechSpans(workspace.speechSpans, workspace.fullNarration, scriptLanguage)
    : buildSpeechSpans(workspace.fullNarration, workspace.beats, scriptLanguage);
  const forecastShots = withCoverage(
    stampShotsWithBible(
      applyPinnedHolds(
        predictShots({
          narration: workspace.fullNarration,
          beats: workspace.beats,
          budget: durationBudget,
          spans: speechSpans,
          scriptLanguage
        }),
        workspace.forecastShots
      ),
      workspace.visualBible
    ),
    workspace.visualBible,
    workspace.forecastShots
  );
  const next = { ...workspace, durationBudget, speechSpans, forecastShots };
  const directorNotes = [
    ...titleDirectorNotes(next),
    ...validateForecast({ budget: durationBudget, shots: forecastShots, beats: workspace.beats }),
    ...gateSpeechSpans(speechSpans).map((message, index) => ({
      id: `span-gate-${index}`,
      level: 'warn' as const,
      target: 'shot' as const,
      message
    }))
  ];
  return { ...next, directorNotes };
}

export function applyHoldToWorkspace(workspace: ScriptWorkspace, shotId: string, holdDuration: number): ScriptWorkspace {
  const target = workspace.forecastShots.find((shot) => shot.id === shotId);
  const lastOfSpan = target?.spanId
    ? [...workspace.forecastShots].reverse().find((shot) => shot.spanId === target.spanId)
    : target;
  const applyId = lastOfSpan?.id || shotId;
  const forecastShots = applyHoldToShots(workspace.forecastShots, applyId, holdDuration);
  return refreshWorkspaceDerived({ ...workspace, forecastShots });
}

export const RESEARCH_FIELDS: { key: keyof ResearchNotes; label: string; placeholder: string; into: 'narration' | 'visual' }[] = [
  { key: 'competitor', label: '对标', placeholder: '同类片子怎么开场、切多碎、讲了什么', into: 'narration' },
  { key: 'audienceQuestion', label: '真问题', placeholder: '他们在搜或在评论里问什么', into: 'narration' },
  { key: 'fact', label: '事实', placeholder: '数字、机制、日期，有出处更好', into: 'narration' },
  { key: 'visualRef', label: '画面', placeholder: '这个题材别人怎么画，你想避开什么烂图', into: 'visual' }
];

export const RESEARCH_DRAG_MIME = 'application/x-ai-video-research';

export function formatResearchHook(key: keyof ResearchNotes, value: string): string {
  const text = value.trim();
  if (!text) return '';
  if (key === 'fact') return /[。！？.!?]$/.test(text) ? text : `先记住这个：${text}。`;
  if (key === 'audienceQuestion') return /[？?]$/.test(text) ? text : `${text}？`;
  if (key === 'competitor') return `别人都在讲「${text}」，我们不走这条。`;
  return text;
}

export function applyResearchNoteToHook(workspace: ScriptWorkspace, key: keyof ResearchNotes): ScriptWorkspace {
  const value = (workspace.researchNotes[key] || '').trim();
  if (!value) return workspace;
  const formatted = formatResearchHook(key, value);
  const intoVisual = key === 'visualRef';
  let beats = workspace.beats.slice();
  if (beats.length === 0 && workspace.fullNarration.trim()) {
    beats = beatsFromNarration(workspace.fullNarration, workspace.durationBudget);
  }
  if (beats.length === 0) {
    beats = [{
      id: 'beat-1',
      order: 1,
      function: 'hook',
      intent: '前 3 秒制造缺口',
      narration: intoVisual ? '' : formatted,
      targetSeconds: 3,
      energy: 'fast',
      visualIntent: intoVisual ? formatted : '',
      needsHold: false
    }];
  } else {
    const hookIndex = Math.max(0, beats.findIndex((beat) => beat.function === 'hook'));
    beats = beats.map((beat, index) => {
      if (index !== hookIndex) return beat;
      return {
        ...beat,
        function: 'hook',
        narration: intoVisual ? beat.narration : formatted,
        visualIntent: intoVisual ? formatted : beat.visualIntent
      };
    });
  }
  const fullNarration = intoVisual ? (workspace.fullNarration || narrationFromBeats(beats)) : narrationFromBeats(beats);
  return rebuildForecast({ ...workspace, beats, fullNarration });
}

export function applyResearchNoteToTopic(
  workspace: ScriptWorkspace,
  topicId: string,
  key: keyof ResearchNotes
): ScriptWorkspace {
  const value = (workspace.researchNotes[key] || '').trim();
  if (!value) return workspace;
  const formatted = formatResearchHook(key, value);
  if (key === 'visualRef') return workspace;
  const topicCards = workspace.topicCards.map((card) => (
    card.id === topicId ? { ...card, hook: formatted } : card
  ));
  return { ...workspace, topicCards };
}

export function applyGenrePack(workspace: ScriptWorkspace, genre: ScriptGenre): ScriptWorkspace {
  const pack = genrePackById(genre);
  if (!pack) return { ...workspace, genrePackId: genre };
  const durationBudget = buildDurationBudget({
    ...workspace.durationBudget,
    pace: pack.pace,
    targetSeconds: pack.durationHint,
    usedChars: workspace.durationBudget.usedChars,
    conceptUsed: pack.maxConcepts,
    lockedShotCount: workspace.durationBudget.lockedShotCount,
    scriptLanguage: normalizeScriptLanguage(workspace.scriptLanguage)
  });
  return { ...workspace, genrePackId: genre, durationBudget };
}

export function mixTopicCards(workspace: ScriptWorkspace): ScriptWorkspace {
  const hookCard = workspace.topicCards.find((card) => card.id === workspace.conceptMix.hookFromId);
  const structCard = workspace.topicCards.find((card) => card.id === workspace.conceptMix.structureFromId);
  if (!hookCard || !structCard) return workspace;
  const mixed: TopicCard = {
    ...structCard,
    id: `topic-mix-${Date.now()}`,
    title: `${hookCard.title.slice(0, 10)} × ${structCard.genre}`,
    hook: hookCard.hook,
    hookType: hookCard.hookType,
    insight: structCard.insight,
    structure: structCard.structure,
    whyThisWorks: `钩子来自「${hookCard.title}」，结构来自「${structCard.title}」`,
    completionFit: `${hookCard.completionFit} / ${structCard.completionFit}`
  };
  return {
    ...workspace,
    topicCards: [...workspace.topicCards.filter((card) => !card.id.startsWith('topic-mix-')), mixed],
    selectedTopicId: mixed.id
  };
}

export function hookPreviewText(workspace: ScriptWorkspace): string {
  const hookBeat = workspace.beats.find((beat) => beat.function === 'hook');
  const source = (hookBeat?.narration || workspace.fullNarration || '').trim();
  if (!source) return '';
  const lang = normalizeScriptLanguage(workspace.scriptLanguage);
  const maxChars = Math.max(lang === 'en' ? 8 : 12, Math.round(8 * workspace.durationBudget.charsPerSecond));
  const compact = source.replace(/\s+/g, '');
  if (countBudgetUnits(source, lang) <= maxChars) return source;
  let used = 0;
  let out = '';
  for (const ch of source) {
    if (/\s/.test(ch)) {
      out += ch;
      continue;
    }
    if (used >= maxChars) break;
    out += ch;
    used += 1;
  }
  return out.trim() || compact.slice(0, maxChars);
}

export function seedTopicCard(title: string): TopicCard {
  return {
    id: `topic-seed-${slugId(title)}`,
    title,
    hook: title,
    insight: title,
    genre: '科普',
    whyNow: '来自当前工程已有主题',
    durationHint: 30,
    paceHint: 'medium',
    conceptCount: 1,
    risk: '',
    completionFit: '沿用已有旁白',
    hookType: 'existing'
  };
}

export function titleMaxFor(language?: ScriptLanguage): number {
  return languageProfile(language).titleMax;
}

export function titleCharCount(text: string, language?: ScriptLanguage): number {
  return titleUnitCount(text, language);
}

export function isLockedTitleValid(title: string | undefined, language?: ScriptLanguage): boolean {
  const profile = languageProfile(language);
  const n = titleUnitCount(title, language);
  return n >= profile.titleMin && n <= profile.titleMax;
}

export function looksLikeScript(text: string | undefined, language?: ScriptLanguage): boolean {
  const value = (text || '').trim();
  const lang = normalizeScriptLanguage(language);
  if (countBudgetUnits(value, lang) >= (lang === 'en' ? 18 : 40)) return true;
  return (value.match(/[。！？!?]/g) || []).length >= 2;
}

export function isShortTitleCandidate(text: string | undefined, language?: ScriptLanguage): boolean {
  const value = (text || '').trim();
  const max = titleMaxFor(language);
  return titleUnitCount(value, language) > 0 && titleUnitCount(value, language) < max && !/[。！？!?]/.test(value);
}

export function waitingForTitleAngles(workspace: ScriptWorkspace): boolean {
  if (workspace.intent !== 'have-title' || workspace.selectedTopicId) return false;
  return workspace.topicCards.filter((card) => card.hookType !== 'locked-title').length >= 2;
}

export function hasUsableDraftTopic(workspace: ScriptWorkspace): boolean {
  if (workspace.topicCards.some((card) => card.id === workspace.selectedTopicId)) return true;
  if (workspace.intent === 'have-script' && (workspace.fullNarration || workspace.intentNotes).trim()) return true;
  if (workspace.intent === 'have-title' && isLockedTitleValid(workspace.lockedTitle, workspace.scriptLanguage)) return true;
  return Boolean(workspace.intentNotes.trim());
}

export function lockedTitleDurationReason(workspace: ScriptWorkspace): string {
  const plat = PLATFORM_OPTIONS.find((item) => item.id === workspace.durationBudget.platform);
  const label = plat?.label || workspace.durationBudget.platform;
  return `建议 ${workspace.durationBudget.targetSeconds} 秒，因为平台「${label}」。标题已锁定，改秒数不会改标题。`;
}

export function seedLockedTopicCard(title: string, opts?: {
  insight?: string;
  genre?: ScriptGenre;
  durationHint?: number;
  paceHint?: ScriptPace;
  conceptCount?: number;
  structure?: NarrativeStructure;
}): TopicCard {
  const trimmed = title.trim();
  return {
    id: `topic-locked-${slugId(trimmed)}`,
    title: trimmed,
    hook: trimmed,
    insight: (opts?.insight || '').trim() || trimmed,
    genre: opts?.genre || '科普',
    whyNow: '用户锁定标题，按这句展开，不换角度。',
    durationHint: opts?.durationHint || 30,
    paceHint: opts?.paceHint || 'medium',
    conceptCount: opts?.conceptCount || 1,
    risk: '标题还不是洞察；若口播只是复述标题，要补一句机制。',
    completionFit: '锁题后定时长再写稿，不经过三张角度卡。',
    hookType: 'locked-title',
    structure: opts?.structure,
    whyThisWorks: '用户已提交标题，写稿不得改题。'
  };
}

export function lockTitleFromIntent(
  workspace: ScriptWorkspace,
  options?: { jumpToDuration?: boolean }
): ScriptWorkspace {
  const title = (workspace.lockedTitle || '').trim();
  if (!isLockedTitleValid(title, workspace.scriptLanguage)) return workspace;
  const pack = genrePackById(workspace.genrePackId);
  const genre = pack?.id || '科普';
  const durationHint = pack?.durationHint || workspace.durationBudget.targetSeconds || 30;
  const paceHint = pack?.pace || workspace.durationBudget.pace || 'medium';
  const card = seedLockedTopicCard(title, {
    insight: workspace.intentNotes,
    genre,
    durationHint,
    paceHint,
    conceptCount: pack?.maxConcepts || 1,
    structure: pack?.structure
  });
  const durationBudget = buildDurationBudget({
    platform: workspace.durationBudget.platform,
    pace: paceHint,
    targetSeconds: durationHint,
    usedChars: countBudgetUnits(workspace.fullNarration, workspace.scriptLanguage),
    conceptUsed: card.conceptCount,
    lockedShotCount: workspace.durationBudget.lockedShotCount,
    scriptLanguage: normalizeScriptLanguage(workspace.scriptLanguage)
  });
  return {
    ...workspace,
    lockedTitle: title,
    topicCards: [card],
    selectedTopicId: card.id,
    durationBudget,
    stage: options?.jumpToDuration === false ? workspace.stage : 'duration',
    gate: workspace.gate
  };
}

export function applyLockedTitleEdit(workspace: ScriptWorkspace, nextTitle: string): ScriptWorkspace {
  const selected = workspace.topicCards.find((card) => card.id === workspace.selectedTopicId);
  const trimmed = nextTitle.trim();
  const topicCards = selected?.hookType === 'locked-title'
    ? workspace.topicCards.map((card) => {
      if (card.id !== selected.id) return card;
      const insight = card.insight === selected.title ? (trimmed || card.insight) : card.insight;
      const hook = card.hook === selected.title ? (trimmed || card.hook) : card.hook;
      return { ...card, title: trimmed || card.title, hook, insight };
    })
    : workspace.topicCards;
  return { ...workspace, lockedTitle: nextTitle, topicCards };
}

export function switchScriptIntent(workspace: ScriptWorkspace, intent: ScriptIntent): ScriptWorkspace {
  let lockedTitle = workspace.lockedTitle || '';
  let selectedTopicId = workspace.selectedTopicId;
  let topicCards = workspace.topicCards;
  if (intent === 'have-title') {
    if (!lockedTitle.trim() && isShortTitleCandidate(workspace.intentNotes, workspace.scriptLanguage)) {
      lockedTitle = workspace.intentNotes.trim();
    }
    const selected = topicCards.find((card) => card.id === selectedTopicId);
    if (selected?.hookType === 'locked-title') {
      if (!lockedTitle.trim()) lockedTitle = selected.title;
    } else {
      selectedTopicId = null;
      topicCards = topicCards.filter((card) => card.hookType === 'locked-title');
    }
  }
  let intentNotes = workspace.intentNotes;
  if (intent === 'have-script' && countBudgetUnits(intentNotes, workspace.scriptLanguage) < 8 && countBudgetUnits(workspace.fullNarration, workspace.scriptLanguage) >= 8) {
    intentNotes = workspace.fullNarration;
  }
  return {
    ...workspace,
    intent,
    lockedTitle,
    selectedTopicId,
    topicCards,
    intentNotes,
    durationBudget: buildDurationBudget({
      ...workspace.durationBudget,
      durationMode: intent === 'have-script' ? 'content-driven' : 'target-driven',
      scriptLanguage: normalizeScriptLanguage(workspace.scriptLanguage)
    })
  };
}

export function adoptPastedScriptFromTitle(workspace: ScriptWorkspace): ScriptWorkspace {
  const pasted = (workspace.lockedTitle || '').trim();
  if (!pasted) return workspace;
  return {
    ...workspace,
    intent: 'have-script',
    intentNotes: pasted,
    fullNarration: pasted,
    lockedTitle: '',
    selectedTopicId: null,
    topicCards: [],
    durationBudget: buildDurationBudget({
      ...workspace.durationBudget,
      durationMode: 'content-driven',
      scriptLanguage: normalizeScriptLanguage(workspace.scriptLanguage)
    }),
    stage: 'intent'
  };
}

function titleDirectorNotes(workspace: ScriptWorkspace): DirectorNote[] {
  if (workspace.intent !== 'have-title') return [];
  const notes: DirectorNote[] = [];
  const selected = workspace.topicCards.find((card) => card.id === workspace.selectedTopicId);
  const title = (selected?.title || workspace.lockedTitle || '').trim();
  if (selected?.hookType === 'locked-title' && title) {
    notes.push({
      id: 'title-locked',
      level: 'info',
      target: 'hook',
      message: `已锁定标题「${title}」，写稿不会改这句。`
    });
  }
  if (looksLikeScript(workspace.lockedTitle, workspace.scriptLanguage)) {
    notes.push({
      id: 'title-looks-script',
      level: 'warn',
      target: 'hook',
      message: '这更像口播。可改走「已有文案」做诊断拆分。'
    });
  }
  const drafted = (workspace.draftedTitle || '').trim();
  const current = (workspace.lockedTitle || '').trim();
  if (countBudgetUnits(workspace.fullNarration, workspace.scriptLanguage) >= 8 && drafted && current && current !== drafted) {
    notes.push({
      id: 'title-dirty',
      level: 'warn',
      target: 'hook',
      message: '标题已改，口播还是旧的。要点「按预算写稿」才会按新标题重写。'
    });
  }
  return notes;
}

function beatsFromClips(clips: StoryboardClip[]): ScriptBeat[] {
  const functions: ScriptBeat['function'][] = ['hook', 'setup', 'turn', 'proof', 'reveal', 'cta'];
  return (clips || []).map((clip, index) => ({
    id: `beat-clip-${clip.id}`,
    order: index + 1,
    function: functions[Math.min(index, functions.length - 1)] || 'setup',
    intent: clip.chineseVisualPrompt || '',
    narration: clip.narration || '',
    targetSeconds: clip.duration || 3.5,
    energy: index === 0 ? 'fast' : index === clips.length - 1 ? 'hold' : 'medium',
    visualIntent: clip.chineseVisualPrompt || clip.visualPrompt || '',
    needsHold: (clip.holdDuration || 0) > 0.4 || index === clips.length - 1
  }));
}

function shotsFromClips(clips: StoryboardClip[]): ForecastShot[] {
  let cursor = 0;
  return (clips || []).map((clip, index) => {
    const speech = clip.speechDuration ?? Math.max(0.4, (clip.duration || 3.5) * 0.82);
    const hold = clip.holdDuration ?? Math.max(0, (clip.duration || 3.5) - speech);
    const shot: ForecastShot = {
      id: `shot-clip-${clip.id}`,
      order: index + 1,
      start: cursor,
      speechDuration: speech,
      holdDuration: hold,
      energy: index === 0 ? 'fast' : index === clips.length - 1 ? 'hold' : 'medium',
      function: index === 0 ? 'hook' : index === clips.length - 1 ? 'cta' : 'setup',
      visualIntent: clip.chineseVisualPrompt || '',
      narration: clip.narration || '',
      splitReason: '从已有分镜还原'
    };
    cursor += speech + hold;
    return shot;
  });
}

function hashPayload(payload: string): string {
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0;
  }
  return String(hash);
}

export function forecastScriptHash(shots: ForecastShot[]): string {
  const payload = shots
    .map((shot) =>
      [
        shot.spanId || shot.id,
        shot.visualIndex ?? '',
        shot.voRole || '',
        (shot.narration || '').trim(),
        (shot.sliceText || '').trim(),
        (shot.visualIntent || '').trim(),
        String(shot.speechDuration),
        shot.holdPinned ? String(shot.holdDuration) : '0'
      ].join('\u0001')
    )
    .join('\u0002');
  return hashPayload(payload);
}

export function stylePackFingerprint(pack?: StylePack): string {
  if (!pack) return '';
  return [
    pack.id,
    pack.source,
    pack.label,
    pack.contemporaryPolicy,
    pack.world.era,
    pack.world.wardrobe,
    pack.world.space,
    (pack.world.must || []).join(','),
    (pack.world.dont || []).join(','),
    pack.render.medium,
    pack.render.lighting,
    pack.render.lens,
    pack.render.quality,
    (pack.transferModules || []).join(','),
    (pack.contentToIgnore || []).join(','),
    JSON.stringify(pack.dna || {})
  ].join('|');
}

export function stampAppliedWorkspace(
  workspace: ScriptWorkspace,
  shots: ForecastShot[],
  stylePack?: StylePack,
  clipCount?: number
): ScriptWorkspace {
  return {
    ...workspace,
    appliedShotCount: clipCount ?? shots.length,
    appliedAt: Date.now(),
    appliedScriptHash: forecastScriptHash(shots),
    appliedStyleFingerprint: stylePackFingerprint(stylePack)
  };
}

export function resolveStoryboardApplyMode(opts: {
  workspace: ScriptWorkspace;
  stylePack?: StylePack;
  clipCount: number;
}): { mode: 'full' | 'style-only' | 'current'; scriptDirty: boolean; styleDirty: boolean } {
  const { workspace, stylePack, clipCount } = opts;
  const scriptHash = forecastScriptHash(workspace.forecastShots);
  const styleFp = stylePackFingerprint(stylePack);
  const hasExisting = clipCount >= 2;
  const scriptDirty = !hasExisting || workspace.appliedScriptHash !== scriptHash;
  const styleDirty = !workspace.appliedStyleFingerprint || workspace.appliedStyleFingerprint !== styleFp;
  if (!hasExisting || scriptDirty) {
    return { mode: 'full', scriptDirty: true, styleDirty };
  }
  if (styleDirty) {
    return { mode: 'style-only', scriptDirty: false, styleDirty: true };
  }
  return { mode: 'current', scriptDirty: false, styleDirty: false };
}

function previousClipKey(clip: StoryboardClip, spanCursor: Map<string, number>): string {
  const span = clip.voSpanId || `order:${clip.order}`;
  const index = spanCursor.get(span) ?? 0;
  spanCursor.set(span, index + 1);
  return `${span}#${index}`;
}

export function forecastToClips(
  shots: ForecastShot[],
  visualStyle: VisualStyle,
  aspectRatio: AspectRatio,
  stylePack?: StylePack,
  previousClips: StoryboardClip[] = [],
  visualBible?: VisualBible | null,
  sentenceGap: number = SENTENCE_GAP_DEFAULT,
  outroHold: number = 0
): StoryboardClip[] {
  const pack = stylePack || presetStylePack(visualStyle);
  const prevByKey = new Map<string, StoryboardClip>();
  const spanCursor = new Map<string, number>();
  previousClips.forEach((clip) => {
    prevByKey.set(previousClipKey(clip, spanCursor), clip);
  });

  const usedIds = new Set<string>();
  const clips = shots.map((shot, index) => {
    const motion = cameraMotionForCoverage(shot);
    // 片尾渐隐由 Outro 收束负责，尾镜入镜统一 crossfade，避免结尾双黑场
    const transition: TransitionType = 'crossfade';
    const visual = stripBiblePrefix(shot.visualIntent || shot.sliceText || shot.narration || `scene ${index + 1}`);
    const chineseVisual = visual;
    const voRole = shot.voRole || 'start';
    const span = shot.spanId || `order:${shot.order}`;
    // Only reuse a previous clip when this exact utterance-visual slot matches.
    // Positional previousClips[index] collides once a continue shot is inserted.
    const prev = prevByKey.get(`${span}#${shot.visualIndex ?? 0}`);
    const previousPromptMatchesBible = !visualBible || prev?.visualBibleHash === visualBible.sourceHash;
    const id = prev?.id && !usedIds.has(prev.id) ? prev.id : newClipId(index, usedIds);
    usedIds.add(id);
    const nextShot = shots[index + 1];
    const isTail = !nextShot || nextShot.voRole !== 'continue';
    const isFilmTail = index === shots.length - 1;
    const holdDuration = shot.holdPinned
      ? shot.holdDuration
      : isTail
        ? Math.max(clampSentenceGap(sentenceGap), isFilmTail ? clampOutroHold(outroHold) : 0)
        : 0;
    const draft = {
      narration: voRole === 'start' ? shot.narration : '',
      voSlice: shot.sliceText,
      chineseVisualPrompt: chineseVisual,
      characterIds: shot.characterIds,
      locationId: shot.locationId,
      continuity: shot.continuity,
      cameraMotion: prev?.cameraMotion || motion,
      order: index + 1,
      promptPinned: Boolean(prev?.promptPinned && previousPromptMatchesBible),
      visualPrompt: prev?.promptPinned && previousPromptMatchesBible ? (prev.visualPrompt || '') : '',
      shotSize: shot.shotSize,
      cameraAngle: shot.cameraAngle,
      shotComposition: shot.shotComposition,
      coverageJob: shot.coverageJob,
      coverageLink: shot.coverageLink,
      coverageSource: shot.coverageSource,
      visualBibleHash: visualBible?.sourceHash
    };
    const compiled = compileImagePrompt({
      clip: draft,
      pack,
      bible: visualBible,
      aspectRatio,
      clipIndex: index,
      clipCount: shots.length
    });
    return {
      id,
      order: index + 1,
      speechDuration: shot.speechDuration,
      holdDuration,
      holdPinned: Boolean(shot.holdPinned),
      characterIds: shot.characterIds,
      locationId: shot.locationId,
      continuity: shot.continuity,
      duration: Math.max(0.05, shot.speechDuration + holdDuration),
      narration: draft.narration,
      // Reuse the previous translation line for the same utterance slot; the primary-hash check
      // in secondaryText.ts will flag it stale if the narration actually changed.
      secondaryText: prev?.secondaryText ?? (shot.sliceText || shot.narration),
      secondaryHash: prev?.secondaryHash,
      voSpanId: shot.spanId,
      voRole,
      voSlice: shot.sliceText,
      visualBibleHash: visualBible?.sourceHash,
      visualBeat: compiled.beat,
      visualPrompt: compiled.prompt,
      chineseVisualPrompt: stripBiblePrefix(beatToChinese(compiled.beat) || chineseVisual),
      promptPinned: draft.promptPinned,
      shotSize: shot.shotSize,
      cameraAngle: shot.cameraAngle,
      shotComposition: shot.shotComposition,
      coverageJob: shot.coverageJob,
      coverageLink: shot.coverageLink,
      coverageSource: shot.coverageSource,
      cameraMotion: draft.cameraMotion,
      transition: prev?.transition || transition,
      imageUrl: prev?.imageUrl || generateProceduralArtwork(shot.narration || visual, visualStyle, aspectRatio, index),
      isGeneratingImage: false,
      imageStatus: prev?.imageUrl ? (prev.imageStatus || 'success') : 'idle',
      imageError: undefined
    };
  });
  return ensureUniqueClipIds(repairClipSlices(clips));
}

export function workspaceTopicTitle(workspace: ScriptWorkspace, fallback = ''): string {
  const selected = workspace.topicCards.find((card) => card.id === workspace.selectedTopicId);
  return selected?.title || (workspace.lockedTitle || '').trim() || workspace.intentNotes.trim() || fallback;
}

export function canApplyStoryboard(workspace: ScriptWorkspace): { ok: boolean; reason?: string } {
  const blocked = workspace.directorNotes.find((note) => note.level === 'block');
  if (blocked) return { ok: false, reason: blocked.message };
  if (countBudgetUnits(workspace.fullNarration, workspace.scriptLanguage) < 8) {
    return { ok: false, reason: '口播太短，先写一段完整旁白' };
  }
  if (workspace.forecastShots.length < 2) {
    return { ok: false, reason: '还没有预测镜。在口播页改完文案后等节奏带出现，或点「按预算写稿 / 重新诊断」' };
  }
  return { ok: true };
}

export function stageCompleted(workspace: ScriptWorkspace, stage: ScriptWorkspace['stage']): boolean | 'skipped' {
  switch (stage) {
    case 'intent':
      return Boolean(workspace.intent);
    case 'topic':
      if (workspace.intent === 'have-script') return 'skipped';
      return Boolean(workspace.selectedTopicId);
    case 'research': {
      const notes = workspace.researchNotes;
      return Boolean(
        notes.competitor ||
        notes.audienceQuestion ||
        notes.fact ||
        notes.visualRef ||
        workspace.researchBrief ||
        workspace.referenceBreakdown
      );
    }
    case 'duration':
      return workspace.durationBudget.targetSeconds > 0;
    case 'beats':
      return workspace.beats.length >= 2;
    case 'copy':
      return countBudgetUnits(workspace.fullNarration, workspace.scriptLanguage) >= 8;
    case 'rhythm':
      return workspace.forecastShots.length >= 2;
    default:
      return false;
  }
}

export function forecastSummary(workspace: ScriptWorkspace): string {
  const shots = workspace.forecastShots;
  if (shots.length === 0) {
    const estimate = estimatedShotCount(workspace.durationBudget);
    return `预测 ${estimate.min}–${estimate.max} 镜（中轴 ${estimate.axis}）`;
  }
  const total = shots.reduce((sum, shot) => sum + shot.speechDuration + shot.holdDuration, 0);
  const speech = shots.reduce((sum, shot) => sum + shot.speechDuration, 0);
  const hold = shots.reduce((sum, shot) => sum + shot.holdDuration, 0);
  return `${shots.length} 镜 · 总长 ${total.toFixed(1)}s（口播 ${speech.toFixed(1)}s + 停留 ${hold.toFixed(1)}s）`;
}

function slugId(text: string): string {
  return text.replace(/\s+/g, '').slice(0, 12) || String(Date.now());
}

export function switchScriptLanguage(workspace: ScriptWorkspace, language: ScriptLanguage): ScriptWorkspace {
  const next = normalizeScriptLanguage(language);
  const current = normalizeScriptLanguage(workspace.scriptLanguage);
  if (next === current) return workspace;
  return refreshWorkspaceDerived({
    ...workspace,
    scriptLanguage: next,
    durationBudget: buildDurationBudget({
      ...workspace.durationBudget,
      scriptLanguage: next,
      usedChars: 0
    }),
    topicCards: [],
    selectedTopicId: null,
    beats: [],
    fullNarration: '',
    speechSpans: [],
    forecastShots: [],
    directorNotes: [],
    draftedTitle: undefined,
    appliedShotCount: undefined,
    appliedAt: undefined,
    appliedScriptHash: undefined,
    visualBible: workspace.visualBible?.pinned ? workspace.visualBible : null,
    stage: workspace.intent ? 'intent' : workspace.stage
  });
}

export function fallbackTopicCards(seed: string, intent: ScriptWorkspace['intent'], language?: ScriptLanguage): TopicCard[] {
  const lang = normalizeScriptLanguage(language);
  if (lang === 'en') {
    const topic = seed.trim() || 'a short video worth shooting';
    const short = topic.split(/\s+/).slice(0, 6).join(' ');
    const variants: Array<Omit<TopicCard, 'id'>> = [
      {
        title: intent === 'have-title' ? topic : short,
        hook: `Everyone has ${short} backwards.`,
        insight: 'Break one common myth, then leave one mechanism people can take away.',
        genre: intent === 'product' ? '带货' : '反常识',
        whyNow: 'Search and comments keep asking the same why.',
        durationHint: 30,
        paceHint: 'medium',
        conceptCount: 1,
        risk: 'If you only dunk on the myth, it becomes a rant.',
        completionFit: 'Hook is a flip. Show the contrast in 3 seconds.',
        hookType: 'misconception',
        structure: 'myth_busting',
        whyThisWorks: 'Myth first, then a mechanism — not a tutorial or a scene.'
      },
      {
        title: `Do ${short} in three steps`,
        hook: `From now on, ${short} is three steps.`,
        insight: 'Turn the topic into actions, not a list of opinions.',
        genre: '教程',
        whyNow: 'Most videos stay conceptual. Step-by-step is still a gap.',
        durationHint: 30,
        paceHint: 'fast',
        conceptCount: 1,
        risk: 'More than 3 steps will not fit 15–30 seconds.',
        completionFit: 'Fast pace. One action per shot.',
        hookType: 'outcome',
        structure: 'tutorial',
        whyThisWorks: 'Executable steps, not a recap of opinions.'
      },
      {
        title: `The 3 seconds inside ${short}`,
        hook: 'The part that decides the outcome is not the opening. It is the middle 3 seconds.',
        insight: 'Put the theme in one concrete moment the camera can see.',
        genre: intent === 'blank' ? '情绪' : '故事',
        whyNow: 'Competitors state the conclusion. Few people stage it.',
        durationHint: 45,
        paceHint: 'slow',
        conceptCount: 1,
        risk: 'If the scene is vague, image gen will miss.',
        completionFit: 'Slow pace. Hold after the line.',
        hookType: 'mystery',
        structure: 'story',
        whyThisWorks: 'A scene carries the theme, unlike a tutorial or a myth flip.'
      }
    ];
    return variants.map((card, index) => ({
      ...card,
      id: `topic-fb-${index + 1}-${Date.now()}`
    }));
  }
  const topic = seed.trim() || '一个值得拍的短视频主题';
  const variants: Array<Omit<TopicCard, 'id'>> = [
    {
      title: intent === 'have-title' ? topic : (topic.length > 18 ? topic.slice(0, 18) : topic),
      hook: `${topic.replace(/[。！？!?]$/, '')}，但大多数人搞反了顺序。`,
      insight: '先拆一个常见误解，再给一个能带走的机制。',
      genre: intent === 'product' ? '带货' : '反常识',
      whyNow: '评论区和搜索里反复出现同一句「为什么」，正缺一条把机制讲清的片子。',
      durationHint: 30,
      paceHint: 'medium',
      conceptCount: 1,
      risk: '如果只骂误解不给机制，会变成抬杠。',
      completionFit: '钩子是翻转认知，3 秒内要抛出反差。',
      hookType: 'misconception',
      structure: 'myth_busting',
      whyThisWorks: '误解先行，和另外两张的步骤/场面不是同一洞察。'
    },
    {
      title: `跟着走一遍：${topic.slice(0, 12)}`,
      hook: `从现在起 ${topic.slice(0, 10)} 只做三步。`,
      insight: '把主题收成可执行步骤，而不是观点清单。',
      genre: intent === 'product' ? '教程' : '教程',
      whyNow: '同类内容停在概念层，步骤向的讲解仍是缺口。',
      durationHint: 30,
      paceHint: 'fast',
      conceptCount: 1,
      risk: '步骤超过 3 个，15–30 秒会装不下。',
      completionFit: '快节奏，每步一镜。',
      hookType: 'outcome',
      structure: 'tutorial',
      whyThisWorks: '可执行步骤，不是观点复述。'
    },
    {
      title: `${topic.slice(0, 10)}的那 3 秒`,
      hook: `真正决定结果的，不是开头，是中间那 3 秒。`,
      insight: '用一个具体瞬间当故事容器，主题变成可看见的场面。',
      genre: intent === 'blank' ? '情绪' : '故事',
      whyNow: '对标片多在讲结论，少有人用一个场面把结论演出来。',
      durationHint: 45,
      paceHint: 'slow',
      conceptCount: 1,
      risk: '场面选得太虚，下游生图会对不准。',
      completionFit: '慢节奏，金句后要敢停。',
      hookType: 'mystery',
      structure: 'story',
      whyThisWorks: '用场面装主题，和教程、误解翻转都不同。'
    }
  ];
  return variants.map((card, index) => ({
    ...card,
    id: `topic-fb-${index + 1}-${Date.now()}`
  }));
}

export function fallbackDraft(input: {
  topic: string;
  hook?: string;
  insight?: string;
  genre?: string;
  maxChars: number;
  scriptLanguage?: ScriptLanguage;
}): { title: string; fullNarration: string; beats: ScriptBeat[] } {
  const lang = normalizeScriptLanguage(input.scriptLanguage);
  const topic = input.topic.trim() || (lang === 'en' ? 'this' : '这件事');
  const insight = (input.insight || '').trim();
  const hook = input.hook?.trim() || (lang === 'en'
    ? `You think you understand ${topic}. You don't.`
    : `你以为你懂${topic}，其实关键不在那儿。`);
  const setup = insight
    ? (lang === 'en' ? `Here is the point: ${insight}.` : `先把这件事讲清：${insight}。`)
    : (lang === 'en' ? 'The usual story is backwards.' : '先把最常见的误会拿掉：它不是看起来那样运作的。');
  const sentences = lang === 'en'
    ? [
      hook,
      setup,
      'The part that actually matters is the change you missed.',
      'Once you see that, the next choice gets simple.',
      `Keep your attention on ${topic} itself.`
    ]
    : [
      hook,
      setup,
      `真正起作用的，是中间那一下你没注意到的变化。`,
      `看清这一点之后，后面的选择会简单很多。`,
      `记住这一句就够：把注意力放回${topic}本身。`
    ];
  let fullNarration = '';
  for (const sentence of sentences) {
    const next = fullNarration ? `${fullNarration}${lang === 'en' ? ' ' : ''}${sentence}` : sentence;
    if (countBudgetUnits(next, lang) > input.maxChars && fullNarration) break;
    fullNarration = next;
  }
  const beats: ScriptBeat[] = [
    { id: 'beat-1', order: 1, function: 'hook', intent: '前 3 秒制造缺口', narration: sentences[0], targetSeconds: 3, energy: 'fast', visualIntent: '特写一张被打断的日常画面，主体正看向镜头外', needsHold: false },
    { id: 'beat-2', order: 2, function: 'setup', intent: '为什么要看下去', narration: sentences[1], targetSeconds: 6, energy: 'medium', visualIntent: '把误解画成一个简单对比：左边常见做法，右边被划掉', needsHold: false },
    { id: 'beat-3', order: 3, function: 'turn', intent: '转折', narration: sentences[2], targetSeconds: 8, energy: 'fast', visualIntent: '镜头推进到被忽略的细节，光线刚好落在变化发生的位置', needsHold: false },
    { id: 'beat-4', order: 4, function: 'reveal', intent: '关键一句', narration: sentences[3], targetSeconds: 7, energy: 'slow', visualIntent: '细节展开后的全貌，主体停住，环境安静', needsHold: true },
    { id: 'beat-5', order: 5, function: 'cta', intent: '收束', narration: sentences[4], targetSeconds: 6, energy: 'hold', visualIntent: '回到开场同一构图，只改一处细节作为回收', needsHold: true }
  ];
  const used = beats.map((beat) => beat.narration);
  let joined = '';
  const fitted = beats.map((beat, index) => {
    const piece = used[index];
    const next = joined ? `${joined}${lang === 'en' ? ' ' : ''}${piece}` : piece;
    if (countBudgetUnits(next, lang) > input.maxChars && index > 0) {
      return { ...beat, narration: '' };
    }
    joined = next;
    return { ...beat, narration: piece };
  }).filter((beat) => beat.narration);
  return {
    title: topic.slice(0, 20),
    fullNarration: narrationFromBeats(fitted.length >= 2 ? fitted : beats),
    beats: fitted.length >= 2 ? fitted : beats
  };
}
