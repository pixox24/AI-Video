import {
  BeatFunction,
  CastCandidate,
  CharacterLockFlag,
  ForecastShot,
  NarratorMode,
  OccupancyPlan,
  OccupancyReason,
  ScriptEntityLedger,
  ScriptEntityRecord,
  ScriptGenre,
  ScriptLanguage,
  TopicCard,
  VisualBible,
  VisualBibleDiff,
  VisualBibleMode,
  VisualCastPolicy,
  VisualCharacter,
  VisualCharacterKind,
  VisualCharacterRef,
  VisualContinuity,
  VisualLocation,
  VisualMotif,
  VisualSubject
} from '../types';
import { extractCastCandidates, formatCandidatesForPrompt, looksLikeFragmentPersonName } from './castCandidates';
import { deriveCastDecisionFromLedger } from './castStrategy';
import { ScriptAnalysis } from './scriptAnalysis';
import {
  UNKNOWN_AGE,
  UNKNOWN_LOOK,
  UNKNOWN_WARDROBE,
  analysisFromLedger,
  appearanceIsUnknown,
  assignUniqueIds,
  bibleSourceFingerprint,
  buildEntityLedger,
  confirmedCastEntities,
  evidenceBelongsToEntity,
  groundEvidenceList,
  isNarrativeKind,
  isObjectKind,
  ledgerToCandidates,
  matchLedgerEntity,
  namesEqual,
  nameMentionedIn,
  objectEntities,
  slugEntityId
} from './scriptEntity';
import { analysisInputFromFields, buildAnalysisInput, bibleRevisionOf, currentSourceKey } from './visualBibleSource';
import { migrateLockFlags, sameEntityIdentity } from './visualBibleMigration';
import {
  applyOverridesToLedger,
  bibleOverrides,
  excludedEntityIds,
  includedEntityIds,
  reduceBibleAction
} from './visualBibleState';

export { UNKNOWN_AGE, UNKNOWN_LOOK, UNKNOWN_WARDROBE };

export const STORY_BIBLE_GENRES: ScriptGenre[] = ['故事', '情绪'];

const CONTINUITY_PEEL = [
  '回收开场构图或母题，只改一处',
  '对照切换，主体可以不同',
  '同一人，景别或状态变了',
  '同一空间往前推',
  '这一拍才允许看见的新信息'
];

export function visualBibleModeForGenre(genre?: ScriptGenre | null): VisualBibleMode {
  return genre && STORY_BIBLE_GENRES.includes(genre) ? 'story' : 'expository';
}

export function legacyBibleSourceHash(narration: string, genre?: ScriptGenre | null, mode?: VisualBibleMode): string {
  const payload = `${(narration || '').replace(/\s+/g, '')}|${genre || ''}|${mode || visualBibleModeForGenre(genre)}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0;
  }
  return String(hash);
}

export function bibleSourceHash(
  narration: string,
  genre?: ScriptGenre | null,
  _mode?: VisualBibleMode,
  extras?: { title?: string; intentNotes?: string; candidateIds?: string[] }
): string {
  return currentSourceKey(narration, {
    title: extras?.title,
    intentNotes: extras?.intentNotes,
    genre
  });
}

export type BibleSourceExtras = {
  title?: string;
  intentNotes?: string;
  language?: ScriptLanguage | string | null;
};

/** Fields used to stamp and later re-check the bible source key. Must stay in lockstep. */
export function workspaceBibleSource(workspace?: {
  fullNarration?: string;
  intentNotes?: string;
  lockedTitle?: string;
  draftedTitle?: string;
  genrePackId?: ScriptGenre | null;
  scriptLanguage?: ScriptLanguage;
  topicCards?: Array<Pick<TopicCard, 'id' | 'title'> & { genre?: ScriptGenre }>;
  selectedTopicId?: string | null;
} | null): {
  narration: string;
  title: string;
  intentNotes: string;
  genre: ScriptGenre | null;
  language: ScriptLanguage | undefined;
} {
  const selected = workspace?.topicCards?.find((card) => card.id === workspace.selectedTopicId);
  return {
    narration: workspace?.fullNarration || '',
    title: String(selected?.title || workspace?.lockedTitle || workspace?.draftedTitle || '').trim(),
    intentNotes: workspace?.intentNotes || '',
    genre: workspace?.genrePackId || selected?.genre || null,
    language: workspace?.scriptLanguage
  };
}

export function isVisualBibleStale(
  bible: VisualBible | null | undefined,
  narration: string,
  genre?: ScriptGenre | null,
  extras?: BibleSourceExtras
): boolean {
  if (!bible) return true;
  if (bible.pinned) return false;
  return visualBibleSourceShift(bible, narration, genre, extras);
}

/** True even when the bible is pinned: the spoken copy no longer matches the locked source. */
export function visualBibleSourceShift(
  bible: VisualBible | null | undefined,
  narration: string,
  genre?: ScriptGenre | null,
  extras?: BibleSourceExtras
): boolean {
  if (!bible) return true;
  const next = currentSourceKey(narration, {
    title: extras?.title,
    intentNotes: extras?.intentNotes,
    genre,
    language: extras?.language || bible.analysisInput?.language
  });
  const current = bible.sourceKey || bible.sourceFingerprint || '';
  if (current) return current !== next;
  return bible.sourceHash !== legacyBibleSourceHash(narration, genre, bible.mode)
    && bible.sourceHash !== next;
}

/** Shot image generation. A stale or empty-cast bible is not a hard stop. */
export function shotImageGenerationBlockedByBible(workspace?: { visualBible?: VisualBible | null } | null): boolean {
  return visualBibleHasBlockingWarnings(workspace?.visualBible);
}

function cleanText(value: unknown, fallback = ''): string {
  return String(value ?? '').trim() || fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

export interface NarrativeCharacterHints {
  hasPerson: boolean;
  names: string[];
  gender: 'male' | 'female' | 'unknown';
  ageBand?: string;
  occupations: string[];
  evidence: string[];
}

const GENERIC_CHARACTER_NAMES = new Set(['主角', '角色', '人物', '讲解者', '我', '他', '她']);
const OCCUPATION_TERMS = ['程序员', '工程师', '老师', '教师', '医生', '护士', '学生', '记者', '摄影师', '律师', '厨师', '农民', '科学家'];

const NARRATION_SPEECH_VERB =
  /(?:他|她|它|我)[^。！？!?；;，,]{0,12}(说|问|答|喊|叫|嚷|唱|喊|道)|(?:说|问|答|喊|道)["“「]/;
const NARRATION_PERSON_ACTION =
  /(?:他|她)[^。！？!?；;]{0,10}(做|煎|炒|煮|切|拿|放|走|跑|笑|哭|读|写|画|跳|推|看|闻|尝)/;
const NARRATION_QUOTE = /["“「『]([^"”」』]{2,60})["”」』]/;
const ANTHROPOMORPHIC_NOTES =
  /拟人|童话|寓言|主角|角色|扮演|人格化|人格|动画角色|IP 角色|IP角色|会说话|小动物/;

/** 该文案是否存在「必须上叙事班底」的强信号（对话、人物行动、明确拟人意图）。 */
export function hasNarrativeSignal(
  narration: string,
  candidates: CastCandidate[] = [],
  notes = ''
): boolean {
  const text = String(narration || '').trim();
  if (!text && !notes) return false;
  if (ANTHROPOMORPHIC_NOTES.test(notes)) return true;
  if (NARRATION_QUOTE.test(text)) return true;
  if (NARRATION_SPEECH_VERB.test(text)) return true;
  if (NARRATION_PERSON_ACTION.test(text)) return true;
  // 有人物候选且其证据句带主动作/示范语义，通常是出镜讲解者而非虚拟角色。
  return candidates.some((candidate) => (
    candidate.kind === 'person'
    && candidate.evidence.some((sentence) => (
      NARRATION_PERSON_ACTION.test(sentence)
      || /教|示范|演示|出镜|讲解|介绍|带你|跟着/.test(sentence)
    ))
  ));
}

/** 被加工/道具类候选名（object），供 expository 锁实物状态时引用。 */
export function processedObjectNames(candidates: CastCandidate[] = []): string[] {
  return candidates
    .filter((candidate) => candidate.kind === 'object')
    .map((candidate) => candidate.name)
    .slice(0, 3);
}

/** Extract only high-signal character facts; this is a guardrail, not a full NER engine. */
export function extractNarrativeCharacterHints(narration: string): NarrativeCharacterHints {
  const text = String(narration || '').replace(/\s+/g, '').trim();
  const sentences = text.split(/[。！？!?；;\n]+/).map((item) => item.trim()).filter(Boolean);
  const hasMale = /男孩|男生|少年|男人|男性|小伙|他(?!们)/.test(text);
  const hasFemale = /女孩|女生|少女|女人|女性|姑娘|她(?!们)/.test(text);
  const occupations = OCCUPATION_TERMS.filter((term) => text.includes(term));
  const candidatePeople = extractCastCandidates({ narration })
    .filter((item) => item.kind === 'person')
    .map((item) => item.name);
  const explicitNames = [...text.matchAll(/(?:他|她|朋友|同学|孩子|人物)?(?:叫|名叫|名字是)([\u4e00-\u9fa5]{2,6})/g)]
    .map((match) => match[1])
    .filter((name) => name && !OCCUPATION_TERMS.includes(name));
  const names = Array.from(new Set([...candidatePeople, ...explicitNames]));
  const hasPerson = Boolean(
    names.length || occupations.length || /我(?!们)|他(?!们)|她(?!们)|男孩|女孩|男生|女生|男人|女人|少年|少女|朋友|同学|孩子|一个人/.test(text)
  );
  const evidenceCandidates = sentences.filter((sentence) => (
    names.some((name) => sentence.includes(name))
    || /我(?!们)|他(?!们)|她(?!们)|男孩|女孩|男生|女生|男人|女人|少年|少女|朋友|同学|孩子|程序员|工程师|老师|教师|医生|护士|学生|记者|摄影师|律师|厨师|农民|科学家/.test(sentence)
  ));
  const highSignalEvidence = evidenceCandidates.filter((sentence) => (
    names.some((name) => sentence.includes(name))
    || occupations.some((occupation) => sentence.includes(occupation))
    || /男孩|女孩|男生|女生|男人|女人|少年|少女|朋友|同学|孩子/.test(sentence)
  ));
  const evidence = (highSignalEvidence.length ? highSignalEvidence : evidenceCandidates).slice(0, 4);
  return {
    hasPerson,
    names,
    gender: hasMale && !hasFemale ? 'male' : hasFemale && !hasMale ? 'female' : 'unknown',
    ageBand: /男孩|女孩|孩子/.test(text) ? '儿童/未成年' : /少年|少女|高中|初中/.test(text) ? '青少年' : undefined,
    occupations,
    evidence: evidence.length ? evidence : (hasPerson && text ? [text.slice(0, 80)] : [])
  };
}

export function narrativeEntityContract(
  narration: string,
  opts?: { title?: string; intentNotes?: string; candidates?: CastCandidate[] }
): string {
  const candidates = opts?.candidates || extractCastCandidates({
    narration,
    title: opts?.title,
    intentNotes: opts?.intentNotes
  });
  const candidateBlock = formatCandidatesForPrompt(candidates);
  const hints = extractNarrativeCharacterHints(narration);
  if (!candidates.length && !hints.hasPerson) {
    return candidateBlock;
  }
  // 候选全是被加工对象（食材/产品）时，说明这是说明型内容，不要建角色卡。
  if (candidates.length && candidates.every((item) => item.kind === 'object') && !hints.hasPerson) {
    return [
      candidateBlock,
      '这些候选是被加工对象/道具（object），不是叙事角色。',
      'characters 必须输出 []，不得拟人化、不得给物体表情或动作。',
      '把它们的外观与状态一致性写进 paletteLock / continuityRule（同一实物，状态随步骤递进）。'
    ].filter(Boolean).join('\n');
  }
  if (!candidates.length) {
  const facts = [
    hints.names.length ? `人物名：${hints.names.join('、')}` : '',
    hints.gender !== 'unknown' ? `性别线索：${hints.gender === 'male' ? '男性' : '女性'}` : '性别线索：未明确，不得擅自猜测',
    hints.ageBand ? `年龄线索：${hints.ageBand}` : '',
    hints.occupations.length ? `身份/职业：${hints.occupations.join('、')}` : '',
    hints.evidence.length ? `原文证据：${hints.evidence.map((item) => `「${item}」`).join('；')}` : ''
  ].filter(Boolean);
    return [
      candidateBlock,
      '【人称线索】角色只能对应以下文案实体，不得凭空新增人物。',
      ...facts,
      '若角色卡无法给出对应原文证据，characters 输出 []。sourceEvidence 必须填写原文短句。'
    ].filter(Boolean).join('\n');
  }
  return candidateBlock;
}

function normalizeRefs(raw: unknown): VisualCharacterRef[] {
  if (!Array.isArray(raw)) return [];
  const refs: VisualCharacterRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const imageId = cleanText((item as VisualCharacterRef).imageId);
    if (!imageId) continue;
    const kind = (item as VisualCharacterRef).kind;
    refs.push({
      imageId,
      imageUrl: cleanText((item as VisualCharacterRef).imageUrl) || undefined,
      thumbDataUrl: cleanText((item as VisualCharacterRef).thumbDataUrl) || undefined,
      kind: kind === 'sheet' || kind === 'face' || kind === 'turnaround' ? kind : 'none',
      notes: cleanText((item as VisualCharacterRef).notes) || undefined
    });
  }
  return refs;
}

function fabricatedAge(value: string): boolean {
  return value === '成年' || value === '成年（文案未明示年龄）' || value === '成人';
}

function normalizeLockFlags(raw: any): Pick<VisualCharacter, 'locked' | 'identityLocked' | 'appearanceLocked' | 'refsLocked'> {
  return migrateLockFlags(raw);
}

function normalizeCharacter(raw: any, index: number): VisualCharacter | null {
  const name = cleanText(raw?.name);
  let look = cleanText(raw?.look);
  let wardrobe = cleanText(raw?.wardrobe);
  if (!name && !look && !wardrobe) return null;
  const role = raw?.role === 'support' || raw?.role === 'extra' ? raw.role : 'lead';
  const kind: VisualCharacterKind | undefined = raw?.kind === 'creature'
    || raw?.kind === 'object'
    || raw?.kind === 'person'
    || raw?.kind === 'anonymous'
    || raw?.kind === 'narrator'
    ? raw.kind as VisualCharacterKind
    : undefined;
  if (kind === 'object') {
    const anthropomorphic = /拟人|表情|会笑|会哭|会说话|有情绪|穿衣|戴帽|围巾|首饰/.test(`${look} ${wardrobe}`);
    look = anthropomorphic ? `${name || '该实物'}的可指认外观，全片保持同一实物与状态，禁止拟人化` : (look || `${name || '该实物'}的可指认外观`);
    wardrobe = anthropomorphic || /换装|穿衣/.test(wardrobe) ? '保持同一外观' : wardrobe;
  }
  const ageRaw = cleanText(raw?.ageBand);
  const ageBand = kind === 'object'
    ? '不适用'
    : (!ageRaw || fabricatedAge(ageRaw) ? UNKNOWN_AGE : ageRaw);
  const resolvedLook = kind === 'object' ? look : (look || UNKNOWN_LOOK);
  const resolvedWardrobe = kind === 'object' ? wardrobe : (wardrobe || UNKNOWN_WARDROBE);
  const locks = normalizeLockFlags(raw);
  return {
    id: cleanText(raw?.id) || slugEntityId(name || `role-${index + 1}`, new Set(), index, 'char'),
    name: name || (role === 'lead' ? '主角' : `角色${index + 1}`),
    role,
    ageBand,
    look: resolvedLook,
    wardrobe: resolvedWardrobe,
    signature: cleanText(raw?.signature) || undefined,
    sourceEvidence: asStringArray(raw?.sourceEvidence || raw?.evidence).slice(0, 4),
    evidenceSpans: Array.isArray(raw?.evidenceSpans) ? raw.evidenceSpans : undefined,
    confidence: Number.isFinite(Number(raw?.confidence))
      ? Math.max(0, Math.min(1, Number(raw.confidence)))
      : undefined,
    status: raw?.status === 'pending' || raw?.status === 'rejected' ? raw.status : 'confirmed',
    castReason: cleanText(raw?.castReason) || undefined,
    appearanceUnknown: Boolean(raw?.appearanceUnknown) || appearanceIsUnknown(resolvedLook, resolvedWardrobe),
    ...locks,
    refs: normalizeRefs(raw?.refs),
    seedHint: cleanText(raw?.seedHint) || undefined,
    kind,
    entityId: cleanText(raw?.entityId || raw?.candidateId) || undefined,
    candidateId: cleanText(raw?.candidateId || raw?.entityId) || undefined
  };
}

function normalizeSubject(raw: any, index: number): VisualSubject | null {
  const name = cleanText(raw?.name);
  const look = cleanText(raw?.look);
  if (!name && !look) return null;
  const locks = normalizeLockFlags(raw);
  return {
    id: cleanText(raw?.id) || slugEntityId(name || `object-${index + 1}`, new Set(), index, 'subj'),
    name: name || `实物${index + 1}`,
    kind: raw?.kind === 'product' ? 'product' : 'object',
    entityId: cleanText(raw?.entityId || raw?.candidateId) || undefined,
    look: look || `${name || '该实物'}的可指认外观，全片保持同一实物`,
    ...locks,
    refs: normalizeRefs(raw?.refs),
    sourceEvidence: asStringArray(raw?.sourceEvidence || raw?.evidence).slice(0, 4),
    evidenceSpans: Array.isArray(raw?.evidenceSpans) ? raw.evidenceSpans : undefined,
    confidence: Number.isFinite(Number(raw?.confidence)) ? Math.max(0, Math.min(1, Number(raw.confidence))) : undefined,
    castReason: cleanText(raw?.castReason) || undefined
  };
}

function characterToSubject(character: VisualCharacter, index: number): VisualSubject {
  return {
    id: character.id.startsWith('subj-') ? character.id : slugEntityId(character.name, new Set(), index, 'subj'),
    name: character.name,
    kind: 'object',
    entityId: character.entityId || character.candidateId,
    look: character.look || `${character.name}的可指认外观`,
    locked: character.locked,
    identityLocked: character.identityLocked,
    appearanceLocked: character.appearanceLocked,
    refsLocked: character.refsLocked,
    refs: character.refs || [],
    sourceEvidence: character.sourceEvidence,
    evidenceSpans: character.evidenceSpans,
    confidence: character.confidence,
    castReason: character.castReason || '实物锁，不是叙事角色'
  };
}

function normalizeCandidate(raw: any, index: number): CastCandidate | null {
  const name = cleanText(raw?.name);
  if (!name) return null;
  const kind: VisualCharacterKind = raw?.kind === 'creature' || raw?.kind === 'object' ? raw.kind : 'person';
  return {
    id: cleanText(raw?.id, `cand-${index + 1}`),
    name,
    kind,
    mentions: Math.max(1, Number(raw?.mentions) || 1),
    evidence: asStringArray(raw?.evidence).slice(0, 4),
    inTitle: Boolean(raw?.inTitle),
    inNotes: Boolean(raw?.inNotes)
  };
}

function normalizeLocation(raw: any, index: number): VisualLocation | null {
  const name = cleanText(raw?.name);
  const look = cleanText(raw?.look);
  if (!name && !look) return null;
  return {
    id: cleanText(raw?.id, `loc-${index + 1}`),
    name: name || `场景${index + 1}`,
    look: look || '全片反复出现的同一空间',
    timeOfDay: cleanText(raw?.timeOfDay, '同一时段'),
    locked: Boolean(raw?.locked),
    refs: normalizeRefs(raw?.refs)
  };
}

function normalizeMotif(raw: any): VisualMotif | null {
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanText(raw.name);
  const look = cleanText(raw.look);
  if (!name && !look) return null;
  const appears = asStringArray(raw.appearsIn).filter((item): item is VisualMotif['appearsIn'][number] => (
    item === 'hook' || item === 'reveal' || item === 'cta' || item === 'any'
  ));
  return {
    id: cleanText(raw.id, 'motif-1'),
    name: name || '回收物件',
    look: look || name,
    appearsIn: appears.length ? appears : ['hook', 'cta']
  };
}

export function emptyVisualBible(mode: VisualBibleMode, sourceHash = ''): VisualBible {
  return {
    version: 1,
    mode,
    logline: '',
    paletteLock: '',
    characters: [],
    subjects: [],
    pendingCharacters: [],
    rejectedCast: [],
    locations: [],
    motif: null,
    castPolicy: 'evidence',
    continuityRule: mode === 'story'
      ? '同一人同一空间推进；对照才换主体；收束回收开场'
      : '色板和道具材质保持一致，允许按句图解',
    sourceHash,
    sourceFingerprint: sourceHash,
    sourceKey: sourceHash,
    overrides: {},
    issues: [],
    retiredEntities: [],
    generatedAt: 0
  };
}

export function normalizeVisualBible(raw: unknown, fallbackMode: VisualBibleMode = 'expository'): VisualBible | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<VisualBible> & { characters?: unknown; locations?: unknown; subjects?: unknown };
  const mode: VisualBibleMode = data.mode === 'story' ? 'story' : data.mode === 'expository' ? 'expository' : fallbackMode;
  const parsedChars = (Array.isArray(data.characters) ? data.characters : [])
    .map((item, index) => normalizeCharacter(item, index))
    .filter((item): item is VisualCharacter => Boolean(item));
  const fromCards = parsedChars.filter((item) => !isObjectKind(item.kind));
  const migratedObjects = parsedChars.filter((item) => isObjectKind(item.kind));
  const parsedSubjects = (Array.isArray(data.subjects) ? data.subjects : [])
    .map((item, index) => normalizeSubject(item, index))
    .filter((item): item is VisualSubject => Boolean(item));
  const characters = assignUniqueIds(fromCards, 'char').slice(0, 3);
  const subjects = assignUniqueIds(
    [
      ...parsedSubjects,
      ...migratedObjects.map((item, index) => characterToSubject(item, index))
    ].filter((item, index, arr) => arr.findIndex((other) => namesEqual(other.name, item.name)) === index),
    'subj'
  ).slice(0, 4);
  const locations = (Array.isArray(data.locations) ? data.locations : [])
    .map((item, index) => normalizeLocation(item, index))
    .filter((item): item is VisualLocation => Boolean(item))
    .slice(0, 3);
  if (mode === 'story' && characters.length === 0 && subjects.length === 0 && locations.length === 0 && !cleanText(data.logline)) {
    return emptyVisualBible(mode, cleanText(data.sourceHash));
  }
  const pendingCharacters = assignUniqueIds(
    (Array.isArray(data.pendingCharacters) ? data.pendingCharacters : [])
      .map((item, index) => normalizeCharacter(item, index))
      .filter((item): item is VisualCharacter => item !== null && !isObjectKind(item.kind)),
    'pend'
  ).slice(0, 4);
  return {
    version: 1,
    mode,
    logline: cleanText(data.logline),
    paletteLock: cleanText(data.paletteLock),
    characters: characters.map(character => {
      const override = data.overrides?.[character.entityId || character.candidateId || character.id];
      return { ...character, name: override?.displayName ?? character.name,
        look: override?.appearance?.look ?? character.look, wardrobe: override?.appearance?.wardrobe ?? character.wardrobe,
        ageBand: override?.appearance?.ageBand ?? character.ageBand, signature: override?.appearance?.signature ?? character.signature };
    }),
    subjects,
    pendingCharacters,
    rejectedCast: Array.isArray(data.rejectedCast)
      ? data.rejectedCast.map((item) => ({ name: cleanText(item?.name), reason: cleanText(item?.reason) })).filter((item) => item.name)
      : [],
    locations,
    motif: normalizeMotif(data.motif),
    castPolicy: 'evidence' as VisualCastPolicy,
    candidates: (Array.isArray(data.candidates) ? data.candidates : [])
      .map((item, index) => normalizeCandidate(item, index))
      .filter((item): item is CastCandidate => Boolean(item))
      .slice(0, 8),
    entityLedger: data.entityLedger && typeof data.entityLedger === 'object' ? data.entityLedger : undefined,
    continuityRule: cleanText(
      data.continuityRule,
      mode === 'story' ? '同一人同一空间推进；对照才换主体；收束回收开场' : '色板和道具材质保持一致'
    ),
    sourceHash: cleanText(data.sourceHash),
    sourceFingerprint: cleanText(data.sourceFingerprint) || undefined,
    sourceKey: cleanText(data.sourceKey) || cleanText(data.sourceFingerprint) || undefined,
    bibleRevision: cleanText(data.bibleRevision) || undefined,
    analysisCacheKey: cleanText(data.analysisCacheKey) || undefined,
    analysisInput: data.analysisInput,
    analysisSnapshot: data.analysisSnapshot,
    overrides: (() => {
      const incoming = data.overrides && typeof data.overrides === 'object' ? { ...data.overrides } : {};
      for (const character of characters) {
        const entityId = character.entityId || character.candidateId || character.id;
        if (!entityId || incoming[entityId]) continue;
        if (character.identityLocked || character.appearanceLocked || character.refsLocked) {
          incoming[entityId] = {
            entityId,
            decision: 'auto',
            locks: {
              identity: Boolean(character.identityLocked),
              appearance: Boolean(character.appearanceLocked),
              refs: Boolean(character.refsLocked)
            }
          };
        }
      }
      return incoming;
    })(),
    retiredEntities: Array.isArray(data.retiredEntities) ? data.retiredEntities : [],
    issues: Array.isArray(data.issues) ? data.issues : [],
    pinned: Boolean(data.pinned),
    narratorMode: data.narratorMode === 'on_camera' || data.narratorMode === 'story_character' || data.narratorMode === 'voiceover'
      ? data.narratorMode
      : undefined,
    presentation: data.presentation,
    analysisReason: cleanText(data.analysisReason) || undefined,
    validation: data.validation && typeof data.validation === 'object'
      ? {
          status: data.validation.status === 'warning' ? 'warning' : 'ok',
          warnings: asStringArray(data.validation.warnings).slice(0, 8),
          checkedAt: Number(data.validation.checkedAt) || 0
        }
      : undefined,
    generatedAt: Number(data.generatedAt) || 0
  };
}

function cardFromEntity(
  entity: ScriptEntityRecord,
  index: number,
  role: VisualCharacter['role'],
  hints: NarrativeCharacterHints,
  reason: string,
  status: VisualCharacter['status'] = 'confirmed'
): VisualCharacter {
  const genderHint = hints.gender === 'male' ? '性别线索为男' : hints.gender === 'female' ? '性别线索为女' : '性别未在文案中写明';
  const look = entity.kind === 'creature'
    ? `拟人化的${entity.name}：外形待确认（只锁定物种与识别点，不编造五官）`
    : entity.kind === 'anonymous' || entity.kind === 'narrator'
      ? UNKNOWN_LOOK
      : `${genderHint}。${UNKNOWN_LOOK}`;
  const wardrobe = hints.occupations.length
    ? `符合${hints.occupations[0]}身份的服装，款式待确认`
    : UNKNOWN_WARDROBE;
  return {
    id: slugEntityId(entity.name, new Set(), index, status === 'pending' ? 'pend' : 'char'),
    name: entity.name,
    role,
    kind: entity.kind === 'object' ? 'person' : entity.kind,
    entityId: entity.id,
    candidateId: entity.id,
    ageBand: entity.kind === 'person' || entity.kind === 'anonymous' || entity.kind === 'narrator'
      ? (hints.ageBand || UNKNOWN_AGE)
      : '不适用',
    look,
    wardrobe: entity.kind === 'creature' ? '全片同一外形，不换装' : wardrobe,
    signature: undefined,
    sourceEvidence: entity.evidence.map((item) => item.text).slice(0, 4),
    evidenceSpans: entity.evidence,
    confidence: entity.confidence,
    status,
    castReason: reason,
    appearanceUnknown: true,
    locked: false,
    identityLocked: false,
    appearanceLocked: false,
    refsLocked: false,
    refs: []
  };
}

function subjectsFromLedger(ledger: ScriptEntityLedger, mode: VisualBibleMode): VisualSubject[] {
  const objects = objectEntities(ledger);
  if (!objects.length) return [];
  if (mode === 'story' && !objects.some((item) => item.mentions >= 2)) return [];
  return assignUniqueIds(objects.slice(0, 4).map((entity, index) => ({
    id: slugEntityId(entity.name, new Set(), index, 'subj'),
    name: entity.name,
    kind: entity.analysisType === 'product' ? 'product' as const : 'object' as const,
    entityId: entity.id,
    look: `${entity.name}的可指认外观，全片保持同一实物与状态`,
    locked: false,
    refs: [],
    sourceEvidence: entity.evidence.map((item) => item.text).slice(0, 4),
    evidenceSpans: entity.evidence,
    confidence: entity.confidence,
    castReason: '实物锁，不是叙事角色'
  })), 'subj');
}

export function fallbackVisualBible(opts: {
  narration: string;
  genre?: ScriptGenre | null;
  title?: string;
  intentNotes?: string;
  candidates?: CastCandidate[];
  analysis?: ScriptAnalysis | null;
  ledger?: ScriptEntityLedger | null;
  narratorMode?: NarratorMode;
}): VisualBible {
  const mode = visualBibleModeForGenre(opts.genre);
  const candidates = opts.candidates || extractCastCandidates({
    narration: opts.narration,
    title: opts.title,
    intentNotes: opts.intentNotes
  });
  const ledger = opts.ledger || buildEntityLedger({
    narration: opts.narration,
    title: opts.title,
    intentNotes: opts.intentNotes,
    candidates,
    analysis: opts.analysis
  });
  const hash = currentSourceKey(opts.narration, {
    title: opts.title,
    intentNotes: opts.intentNotes,
    genre: opts.genre
  });
  const hints = extractNarrativeCharacterHints(opts.narration);
  const decision = deriveCastDecisionFromLedger(ledger, opts.genre, {
    narratorMode: opts.narratorMode,
    analysis: opts.analysis || null
  });
  const people = decision.allowed.filter((item) => item.kind === 'person' || item.kind === 'anonymous' || item.kind === 'narrator');
  const leadBudget = Math.min(2, people.length);
  const characters = assignUniqueIds(decision.allowed.slice(0, 3).map((item, index) => {
    const entity = ledger.entities.find((row) => row.id === item.entityId);
    if (!entity) return null;
    const isLead = item.kind !== 'creature' ? index < Math.max(leadBudget, 1) : index === 0 && people.length === 0;
    return cardFromEntity(entity, index, isLead ? 'lead' : 'support', hints, item.reason || decision.reason, 'confirmed');
  }).filter((item): item is VisualCharacter => Boolean(item)), 'char');
  const pendingCharacters = assignUniqueIds(decision.pending.slice(0, 4).map((item, index) => {
    const entity = ledger.entities.find((row) => row.id === item.entityId);
    if (!entity) return null;
    return cardFromEntity(entity, index, 'support', hints, item.reason || '待确认', 'pending');
  }).filter((item): item is VisualCharacter => Boolean(item)), 'pend');
  const subjects = subjectsFromLedger(ledger, mode);
  const objects = subjects.map((item) => item.name);
  const needsStage = mode === 'story' || characters.length > 0;
  const expositoryContinuity = objects.length
    ? `同一批被加工对象（${objects.join('、')}）保持同一实物外观，状态随步骤递进（生→熟→成品），禁止每镜换成另一块；允许按句图解。`
    : '色板和道具材质保持一致，允许按句图解';
  const warnings = [
    characters.length ? '模型未返回可验证角色，已使用文案台账角色卡' : '',
    !characters.length && objects.length ? '教程/说明型文案未创建角色卡；已锁定同一被加工对象与实物状态保持一致' : '',
    !characters.length && !objects.length ? '文案未识别到可指认主体，未创建角色卡' : '',
    decision.reason && !characters.length ? decision.reason : ''
  ].filter(Boolean);
  const result = {
    version: 1 as const,
    mode,
    castPolicy: 'evidence' as const,
    candidates: ledgerToCandidates(ledger),
    entityLedger: ledger,
    logline: cleanText(opts.title) || (characters.length ? '同一主体把这件事走完' : ''),
    paletteLock: mode === 'expository'
      ? (objects.length ? '全片同一色温、材质与实物状态，不要无故换滤镜或换食材外观' : '全片同一色温与材质，不要无故换滤镜')
      : '全片同一时段、同一色温',
    characters,
    subjects,
    pendingCharacters,
    rejectedCast: decision.rejected,
    locations: needsStage ? [{
      id: 'loc-1',
      name: '主场景',
      look: '口播开始的那个空间，全片优先待在这里',
      timeOfDay: '同一时段',
      locked: false,
      refs: []
    }] : [],
    motif: null,
    continuityRule: characters.length
      ? '角色卡只锁全片不变量；单镜头是否上人由 occupancyPlan 决定，insert 默认无人'
      : expositoryContinuity,
    sourceHash: hash,
    sourceFingerprint: hash,
    sourceKey: hash,
    overrides: {},
    narratorMode: decision.narratorMode || opts.narratorMode,
    presentation: decision.presentation,
    analysisReason: decision.reason,
    validation: {
      status: 'warning' as const,
      warnings: warnings.slice(0, 8),
      checkedAt: Date.now()
    },
    generatedAt: Date.now()
  };
  return { ...result, bibleRevision: bibleRevisionOf(result) };
}

function characterMentionsFemale(character: VisualCharacter): boolean {
  return /女孩|女生|少女|女人|女性|姑娘|女童|女学生|水手服|裙子/.test(
    `${character.name} ${character.ageBand} ${character.look} ${character.wardrobe}`
  );
}

function characterMentionsMale(character: VisualCharacter): boolean {
  return /男孩|男生|少年|男人|男性|男童|男学生/.test(
    `${character.name} ${character.ageBand} ${character.look} ${character.wardrobe}`
  );
}

const FABRICATED_CAST_NAMES = new Set([
  ...GENERIC_CHARACTER_NAMES,
  '讲解员', '女孩', '男孩', '用户', '观众', '博主', '主播', '旁白'
]);

function nameAppearsInNarration(name: string, narration: string): boolean {
  const needle = String(name || '').trim();
  if (!needle || needle.length < 2) return false;
  return String(narration || '').includes(needle);
}

function promoteCharacterToCandidate(
  character: VisualCharacter,
  narration: string,
  index: number
): CastCandidate {
  const evidence = (character.sourceEvidence || []).filter(Boolean).slice(0, 4);
  return {
    id: character.candidateId || `cand-${character.name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-') || index + 1}`,
    name: character.name,
    kind: character.kind || 'person',
    mentions: Math.max(1, countNameMentions(narration, character.name)),
    evidence: evidence.length ? evidence : [character.name]
  };
}

function countNameMentions(haystack: string, name: string): number {
  const source = String(haystack || '');
  const needle = String(name || '');
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (from <= source.length) {
    const at = source.indexOf(needle, from);
    if (at < 0) break;
    count += 1;
    from = at + needle.length;
  }
  return count;
}

function mergeCandidates(...lists: CastCandidate[][]): CastCandidate[] {
  const merged = new Map<string, CastCandidate>();
  for (const list of lists) {
    for (const item of list) {
      const key = item.name.toLowerCase();
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, item);
        continue;
      }
      merged.set(key, {
        ...prev,
        mentions: Math.max(prev.mentions, item.mentions),
        evidence: Array.from(new Set([...(prev.evidence || []), ...(item.evidence || [])])).slice(0, 4),
        inTitle: prev.inTitle || item.inTitle,
        inNotes: prev.inNotes || item.inNotes,
        kind: prev.kind === 'person' || item.kind === 'person'
          ? 'person'
          : prev.kind === 'creature' || item.kind === 'creature'
            ? 'creature'
            : prev.kind
      });
    }
  }
  return [...merged.values()].slice(0, 8);
}

/** Validate model output against explicit narration facts before it becomes a hard constraint. */
function cardKeptOnRebuild(character: VisualCharacter): boolean {
  return Boolean(character.locked || character.identityLocked || character.appearanceLocked || character.refsLocked);
}

export function validateVisualBibleAgainstNarration(
  bible: VisualBible | null | undefined,
  narration: string,
  opts?: { title?: string; intentNotes?: string; candidates?: CastCandidate[]; ledger?: ScriptEntityLedger | null }
): string[] {
  if (!bible) return [];
  const hints = extractNarrativeCharacterHints(narration);
  const sources = { narration, title: opts?.title || bible.logline, intentNotes: opts?.intentNotes };
  const ledger = opts?.ledger || bible.entityLedger || buildEntityLedger({
    narration,
    title: sources.title,
    intentNotes: sources.intentNotes,
    candidates: opts?.candidates || bible.candidates
  });
  const warnings: string[] = [];
  const namedPeople = ledger.entities.filter((entity) => entity.kind === 'person' && entity.isNamed && entity.status !== 'rejected');
  if (!namedPeople.length && !hints.hasPerson && bible.characters.some((item) => !cardKeptOnRebuild(item))) {
    warnings.push('文案没有明确人物，但画面圣经创建了角色卡');
  }
  bible.characters.forEach((character) => {
    if (cardKeptOnRebuild(character)) return;
    if (isObjectKind(character.kind)) {
      warnings.push(`角色「${character.name}」是实物，不应出现在角色卡中`);
      return;
    }
    const matched = matchLedgerEntity(ledger, character);
    if (matched.mismatch) {
      warnings.push(matched.mismatch);
      return;
    }
    if (!matched.entity && !nameAppearsInNarration(character.name, narration)) {
      warnings.push(`角色「${character.name}」不在文案台账中`);
    }
    const spans = character.evidenceSpans?.length
      ? character.evidenceSpans
      : groundEvidenceList(character.sourceEvidence, sources);
    if (!spans.length) {
      warnings.push(`角色「${character.name}」缺少可复核的原文证据`);
    }
  });
  const ids = bible.characters.map((item) => item.id);
  if (new Set(ids).size !== ids.length) {
    warnings.push('角色卡存在重复 ID');
  }
  if (hints.gender === 'male' && bible.characters.some(characterMentionsFemale)) {
    warnings.push('文案出现男性线索，但角色卡包含女性外形/服装描述');
  }
  if (hints.gender === 'female' && bible.characters.some(characterMentionsMale)) {
    warnings.push('文案出现女性线索，但角色卡包含男性外形描述');
  }
  if (hints.ageBand === '儿童/未成年' && bible.characters.some((item) => /^(成年|中年|老年)$/.test(item.ageBand))) {
    warnings.push('文案出现男孩/女孩/孩子，但角色卡年龄被写成成年或以上');
  }
  if (hints.names.length > 0 && bible.characters.length > 0) {
    const names = new Set(hints.names);
    const hasNamedCard = bible.characters.some((item) => names.has(item.name));
    if (!hasNamedCard && bible.characters.every((item) => !item.sourceEvidence?.some((evidence) => hints.names.some((name) => evidence.includes(name))))) {
      warnings.push(`文案中的人物「${hints.names.join('、')}」没有出现在角色卡证据中`);
    }
  }
  if (hints.occupations.length > 0 && bible.characters.length > 0) {
    const hasOccupation = bible.characters.some((item) => (
      hints.occupations.some((occupation) => `${item.name} ${item.look} ${item.wardrobe} ${item.sourceEvidence?.join(' ') || ''}`.includes(occupation))
    ));
    if (!hasOccupation) warnings.push(`文案职业「${hints.occupations.join('、')}」未进入角色卡`);
  }
  return Array.from(new Set(warnings));
}

/** Repair only unpinned model output; user-locked cards remain visible and are warned on. */
export function groundVisualBible(
  bible: VisualBible,
  narration: string,
  opts?: { title?: string; intentNotes?: string; candidates?: CastCandidate[]; analysis?: ScriptAnalysis | null; genre?: ScriptGenre | null; language?: string | null }
): VisualBible {
  if (bible.pinned) return bible;
  const sources = { narration, title: opts?.title || bible.logline, intentNotes: opts?.intentNotes };
  const genre = opts?.genre || (bible.mode === 'story' ? '故事' : null);
  const language = opts?.language || bible.analysisInput?.language;
  const inputKey = currentSourceKey(narration, { title: sources.title, intentNotes: sources.intentNotes, genre, language });
  const freshCandidates = opts?.candidates || extractCastCandidates({
    narration,
    title: sources.title,
    intentNotes: sources.intentNotes
  });
  const analysis = opts?.analysis || analysisFromLedger(bible.entityLedger);
  const reuseLedger = Boolean(
    bible.entityLedger
    && (bible.sourceKey === inputKey || bible.entityLedger.sourceKey === inputKey || bible.entityLedger.contentType)
    && (analysis || bible.entityLedger.contentType)
    && (bible.sourceKey === inputKey || bible.sourceFingerprint === inputKey || !bible.sourceKey)
  );
  const builtLedger = reuseLedger && bible.entityLedger && analysis
    ? bible.entityLedger
    : buildEntityLedger({
      narration,
      title: sources.title,
      intentNotes: sources.intentNotes,
      candidates: mergeCandidates(freshCandidates, bible.candidates || []),
      analysis
    });
  const ledger = applyOverridesToLedger({
    ...builtLedger,
    contentType: builtLedger.contentType || analysis?.content_type,
    contentConfidence: builtLedger.contentConfidence ?? analysis?.confidence,
    perspective: builtLedger.perspective || analysis?.narrative_perspective,
    hasDialogue: builtLedger.hasDialogue ?? analysis?.has_dialogue,
    hasNarrativeArc: builtLedger.hasNarrativeArc ?? analysis?.has_narrative_arc,
    personificationDetected: builtLedger.personificationDetected ?? analysis?.personification_detected,
    visualDensity: builtLedger.visualDensity || analysis?.visual_density,
    sourceKey: inputKey
  }, bible.overrides);
  const excluded = excludedEntityIds(bible);
  const included = includedEntityIds(bible);
  const dropReasons: string[] = [];
  const keptSubjects = [
    ...(bible.subjects || []),
    ...bible.characters.filter((item) => isObjectKind(item.kind)).map((item, index) => characterToSubject(item, index))
  ];
  const groundedChars: VisualCharacter[] = [];
  for (const character of bible.characters) {
    if (isObjectKind(character.kind)) continue;
    if (cardKeptOnRebuild(character)) {
      const stillPresent = nameAppearsInNarration(character.name, narration)
        || included.has(character.entityId || character.candidateId || '')
        || Boolean(bible.overrides?.[character.entityId || character.candidateId || '']?.displayName && namesEqual(bible.overrides[character.entityId || character.candidateId || ''].displayName || '', character.name));
      if (!stillPresent) {
        dropReasons.push(`角色「${character.name}」已不在当前口播，已归档`);
        continue;
      }
      const matched = matchLedgerEntity(ledger, character);
      groundedChars.push({
        ...character,
        entityId: matched.entity?.id || character.entityId || character.candidateId,
        candidateId: matched.entity?.id || character.candidateId || character.entityId,
        evidenceSpans: character.evidenceSpans?.length
          ? character.evidenceSpans
          : groundEvidenceList(character.sourceEvidence, sources)
      });
      if (matched.mismatch) dropReasons.push(`${matched.mismatch}（已上锁，仅警告）`);
      continue;
    }
    if (character.kind === 'person' && looksLikeFragmentPersonName(character.name)) {
      dropReasons.push(`角色「${character.name}」像口播碎片，已丢弃`);
      continue;
    }
    if (FABRICATED_CAST_NAMES.has(character.name) && !nameAppearsInNarration(character.name, narration)) {
      dropReasons.push(`角色「${character.name}」为编造名，已丢弃`);
      continue;
    }
    const displayName = bible.overrides?.[character.entityId || character.candidateId || '']?.displayName;
    const matched = matchLedgerEntity(ledger, character);
    const renamedByUser = Boolean(displayName && (displayName === character.name || namesEqual(displayName, character.name)));
    if (matched.mismatch && !renamedByUser) {
      dropReasons.push(`${matched.mismatch}，已丢弃该卡`);
      continue;
    }
    const entity = matched.entity;
    if (!entity && !nameAppearsInNarration(character.name, narration)) {
      dropReasons.push(`角色「${character.name}」不在台账中，已丢弃`);
      continue;
    }
    if (entity?.status === 'rejected' && !included.has(entity.id)) {
      dropReasons.push(`角色「${character.name}」被台账拒绝（标题/低置信），已丢弃`);
      continue;
    }
    const entityId = entity?.id || character.entityId || character.candidateId || '';
    if (entityId && excluded.has(entityId)) continue;
    const spans = groundEvidenceList(
      character.sourceEvidence?.length ? character.sourceEvidence : (entity?.evidence.map((item) => item.text) || [character.name]),
      sources
    );
    if (!spans.length) {
      dropReasons.push(`角色「${character.name}」的证据无法在原文中复核，已丢弃`);
      continue;
    }
    if (!evidenceBelongsToEntity(character.name, character.kind || entity?.kind, spans, sources) && !included.has(entityId)) {
      dropReasons.push(`角色「${character.name}」的证据不属于该实体，已丢弃`);
      continue;
    }
    const ageRaw = cleanText(character.ageBand);
    groundedChars.push({
      ...character,
      entityId: entity?.id || character.entityId || character.candidateId,
      candidateId: entity?.id || character.candidateId || character.entityId,
      kind: character.kind && isNarrativeKind(character.kind) ? character.kind : (entity?.kind === 'object' ? 'person' : entity?.kind),
      sourceEvidence: spans.map((item) => item.text),
      evidenceSpans: spans,
      ageBand: !ageRaw || fabricatedAge(ageRaw) ? (entity?.kind === 'person' ? UNKNOWN_AGE : character.ageBand || UNKNOWN_AGE) : ageRaw,
      appearanceUnknown: character.appearanceUnknown || appearanceIsUnknown(character.look, character.wardrobe),
      confidence: character.confidence ?? entity?.confidence,
      status: entity?.status === 'pending' ? 'pending' : 'confirmed'
    });
  }

  const pendingFromBible = (bible.pendingCharacters || []).filter((item) => {
    if (isObjectKind(item.kind)) return false;
    const id = item.entityId || item.candidateId || '';
    if (id && excluded.has(id)) return false;
    if (id && included.has(id)) return false;
    return true;
  });
  let next: VisualBible = {
    ...bible,
    castPolicy: 'evidence',
    entityLedger: ledger,
    candidates: ledgerToCandidates(ledger),
    characters: assignUniqueIds(
      groundedChars.filter((item) => item.status !== 'pending' || included.has(item.entityId || item.candidateId || '')),
      'char'
    ).slice(0, 8),
    pendingCharacters: assignUniqueIds([
      ...groundedChars.filter((item) => item.status === 'pending' && !included.has(item.entityId || item.candidateId || '')),
      ...pendingFromBible
    ].filter((item, index, arr) => arr.findIndex((other) => namesEqual(other.name, item.name)) === index), 'pend').slice(0, 8),
    subjects: assignUniqueIds(
      keptSubjects.filter((item, index, arr) => {
        if (arr.findIndex((other) => namesEqual(other.name, item.name)) !== index) return false;
        if (item.locked || item.identityLocked) return true;
        const spans = groundEvidenceList(item.sourceEvidence, sources);
        if (!spans.length) {
          dropReasons.push(`实物「${item.name}」缺少可复核原文证据，已丢弃`);
          return false;
        }
        if (item.entityId && item.entityId !== 'missing') {
          const entity = ledger.entities.find((row) => row.id === item.entityId);
          if (!entity) {
            dropReasons.push(`实物「${item.name}」引用的台账 ID 不存在，已丢弃`);
            return false;
          }
          if (!namesEqual(entity.name, item.name) || (entity.kind !== 'object' && entity.analysisType !== 'product')) {
            dropReasons.push(`实物「${item.name}」与台账「${entity.name}」ID 错配，已丢弃`);
            return false;
          }
        }
        if (item.entityId === 'missing' || !evidenceBelongsToEntity(item.name, 'object', spans, sources)) {
          dropReasons.push(`实物「${item.name}」证据无效，已丢弃`);
          return false;
        }
        return true;
      }),
      'subj'
    ).slice(0, 8)
  };

  const decision = deriveCastDecisionFromLedger(ledger, genre, {
    narratorMode: bible.narratorMode,
    analysis
  });
  if (!bible.pinned && decision.hasCast) {
    const present = new Set(next.characters.map((item) => item.name));
    const missing = decision.allowed.filter((item) => !present.has(item.name));
    if (next.characters.length === 0 || missing.length) {
      const filled = fallbackVisualBible({
        narration,
        genre,
        title: sources.title,
        intentNotes: sources.intentNotes,
        candidates: freshCandidates,
        analysis: opts?.analysis,
        ledger,
        narratorMode: bible.narratorMode
      });
      if (next.characters.length === 0) {
        next = {
          ...next,
          characters: filled.characters,
          pendingCharacters: filled.pendingCharacters,
          subjects: next.subjects?.length ? next.subjects : filled.subjects,
          locations: next.locations.length ? next.locations : filled.locations,
          continuityRule: filled.continuityRule,
          logline: next.logline || filled.logline,
          presentation: filled.presentation,
          analysisReason: filled.analysisReason
        };
      } else if (missing.length) {
        const extras = filled.characters.filter((item) => missing.some((row) => namesEqual(row.name, item.name)));
        next = {
          ...next,
          characters: assignUniqueIds(
            [...next.characters, ...extras].filter((item, index, arr) => arr.findIndex((other) => namesEqual(other.name, item.name)) === index).slice(0, 3),
            'char'
          ),
          pendingCharacters: next.pendingCharacters?.length ? next.pendingCharacters : filled.pendingCharacters,
          subjects: next.subjects?.length ? next.subjects : filled.subjects
        };
      }
    }
  }

  if (!decision.hasCast) {
    next = {
      ...next,
      characters: next.characters.filter((item) => included.has(item.entityId || item.candidateId || '') || cardKeptOnRebuild(item)),
      pendingCharacters: assignUniqueIds(
        decision.pending
          .filter((item) => !excluded.has(item.entityId) && !included.has(item.entityId))
          .map((item, index) => {
            const entity = ledger.entities.find((row) => row.id === item.entityId);
            if (!entity) return null;
            return cardFromEntity(entity, index, 'support', extractNarrativeCharacterHints(narration), item.reason || '待确认', 'pending');
          })
          .filter((item): item is VisualCharacter => Boolean(item)),
        'pend'
      )
    };
  }

  if ((!next.subjects || next.subjects.length === 0) && objectEntities(ledger).length) {
    next = { ...next, subjects: subjectsFromLedger(ledger, next.mode) };
  }

  const hash = currentSourceKey(narration, { title: sources.title, intentNotes: sources.intentNotes, genre, language });
  const retired = [
    ...(bible.retiredEntities || []),
    ...bible.characters.filter((character) => (
      cardKeptOnRebuild(character)
      && !next.characters.some((item) => item.id === character.id || namesEqual(item.name, character.name))
    )).map((character) => ({
      entityId: character.entityId || character.candidateId || character.id,
      name: character.name,
      kind: character.kind,
      character,
      override: bible.overrides?.[character.entityId || character.candidateId || character.id],
      reason: '当前口播已无此实体'
    }))
  ];
  const sourceFields = bible.pinned
    ? {
      sourceHash: bible.sourceHash,
      sourceFingerprint: bible.sourceFingerprint,
      sourceKey: bible.sourceKey || bible.sourceFingerprint || bible.sourceHash
    }
    : { sourceHash: hash, sourceFingerprint: hash, sourceKey: hash };
  next = {
    ...next,
    ...sourceFields,
    analysisInput: buildAnalysisInput({ narration, title: sources.title, intentNotes: sources.intentNotes, genre, language }),
    pinned: Boolean(bible.pinned),
    presentation: next.presentation || decision.presentation,
    analysisReason: next.analysisReason || decision.reason,
    overrides: bible.overrides || {},
    retiredEntities: retired.filter((item, index, arr) => arr.findIndex((other) => other.entityId === item.entityId) === index)
  };
  next.characters = next.characters.map((character) => {
    const entityId = character.entityId || character.candidateId || '';
    const displayName = next.overrides?.[entityId]?.displayName;
    const appearance = next.overrides?.[entityId]?.appearance;
    return {
      ...character,
      name: displayName || character.name,
      look: appearance?.look ?? character.look,
      wardrobe: appearance?.wardrobe ?? character.wardrobe,
      ageBand: appearance?.ageBand ?? character.ageBand,
      signature: appearance?.signature ?? character.signature
    };
  });
  next = { ...next, bibleRevision: bibleRevisionOf(next) };

  const warnings = [
    ...dropReasons,
    ...validateVisualBibleAgainstNarration(next, narration, { ...opts, candidates: ledgerToCandidates(ledger), ledger })
  ];
  const uniqueWarnings = Array.from(new Set(warnings)).slice(0, 8);
  const hardWarnings = uniqueWarnings.filter((warning) => (
    /没有明确人物，但画面圣经创建了角色卡|出现男性线索，但角色卡包含女性|出现女性线索，但角色卡包含男性|年龄被写成成年/.test(warning)
  ));
  if (hardWarnings.length && !bible.pinned && !bible.characters.some(cardKeptOnRebuild)) {
    const safe = fallbackVisualBible({
      narration,
      genre,
      title: sources.title,
      intentNotes: sources.intentNotes,
      candidates: freshCandidates,
      analysis: opts?.analysis,
      ledger,
      narratorMode: bible.narratorMode
    });
    return {
      ...next,
      characters: safe.characters,
      subjects: safe.subjects,
      pendingCharacters: safe.pendingCharacters,
      validation: {
        status: 'warning',
        warnings: Array.from(new Set([
          ...uniqueWarnings,
          '模型角色与文案实体不一致，已替换为保守角色卡；请在画面圣经中确认外形'
        ])).slice(0, 8),
        checkedAt: Date.now()
      }
    };
  }
  return {
    ...next,
    validation: { status: uniqueWarnings.length ? 'warning' : 'ok', warnings: uniqueWarnings, checkedAt: Date.now() }
  };
}

/** Only hard narrative conflicts should stop image generation. Informational
 * warnings (for example, a conservative fallback card) remain actionable but
 * do not make the project unusable. */
export function visualBibleHasBlockingWarnings(bible?: VisualBible | null): boolean {
  if (bible?.issues?.some((issue) => issue.blocks?.includes('generate_image') && (issue.severity === 'error' || issue.severity === 'warning'))) {
    return true;
  }
  if (!bible?.validation?.warnings?.length) return false;
  return bible.validation.warnings.some((warning) => {
    if (/没有明确人物，但画面圣经创建了角色卡/.test(warning) && bible.characters.length === 0) return false;
    if (/已丢弃/.test(warning)) return false;
    return /没有明确人物，但画面圣经创建了角色卡|出现男性线索，但角色卡包含女性|出现女性线索，但角色卡包含男性|年龄被写成成年|人物「.+」没有出现在角色卡证据中|文案职业「.+」未进入角色卡|不在文案台账中|ID 错配/.test(warning);
  });
}

/**
 * 决策层落库：LLM 先做整篇剧本解析（感知），这里用规则决策收敛成最终的卡。
 */
export function applyAnalysisToBible(
  bible: VisualBible,
  analysis: ScriptAnalysis,
  genre?: ScriptGenre | null,
  opts?: { narration?: string; title?: string; intentNotes?: string }
): VisualBible {
  const narration = opts?.narration || '';
  const built = buildEntityLedger({
    narration,
    title: opts?.title || bible.logline,
    intentNotes: opts?.intentNotes,
    candidates: bible.candidates,
    analysis
  });
  const ledger = applyOverridesToLedger(built, bible.overrides);
  const decision = deriveCastDecisionFromLedger(ledger, genre, {
    narratorMode: bible.narratorMode,
    analysis
  });
  const hints = extractNarrativeCharacterHints(narration);
  const allowedIds = new Set(decision.allowed.map((item) => item.entityId));
  const included = includedEntityIds(bible);
  const excluded = excludedEntityIds(bible);
  const existingChars = bible.characters.filter((character) => {
    const entityId = character.entityId || character.candidateId || '';
    if (excluded.has(entityId)) return false;
    if (included.has(entityId) || cardKeptOnRebuild(character)) return true;
    if (isObjectKind(character.kind)) return false;
    return decision.hasCast && (
      allowedIds.has(character.entityId || '')
      || allowedIds.has(character.candidateId || '')
      || decision.allowed.some((item) => namesEqual(item.name, character.name))
    );
  });
  let characters = existingChars;
  if (decision.hasCast) {
    const missing = decision.allowed.filter((item) => !characters.some((row) => namesEqual(row.name, item.name) || row.entityId === item.entityId));
    if (missing.length) {
      const extras = missing.map((item, index) => {
        const entity = ledger.entities.find((row) => row.id === item.entityId);
        if (!entity) return null;
        return cardFromEntity(entity, index, item.kind === 'creature' ? 'support' : 'lead', hints, item.reason || decision.reason);
      }).filter((item): item is VisualCharacter => Boolean(item));
      characters = assignUniqueIds(
        [...characters, ...extras]
          .filter((item, index, arr) => arr.findIndex((other) => namesEqual(other.name, item.name) || other.entityId === item.entityId) === index)
          .slice(0, 8),
        'char'
      );
    }
  } else {
    characters = existingChars.filter((item) => included.has(item.entityId || item.candidateId || '') || cardKeptOnRebuild(item) || !isNarrativeKind(item.kind));
  }
  for (const entityId of included) {
    if (characters.some((item) => (item.entityId || item.candidateId) === entityId)) continue;
    const pending = (bible.pendingCharacters || []).find((item) => (item.entityId || item.candidateId) === entityId);
    const entity = ledger.entities.find((row) => row.id === entityId);
    if (pending) characters.push({ ...pending, status: 'confirmed', castReason: '用户确认为角色' });
    else if (entity) characters.push(cardFromEntity(entity, characters.length, 'lead', hints, '用户确认为角色'));
  }
  const pendingCharacters = assignUniqueIds(decision.pending.map((item, index) => {
    if (included.has(item.entityId) || excluded.has(item.entityId)) return null;
    const entity = ledger.entities.find((row) => row.id === item.entityId);
    if (!entity) return null;
    return cardFromEntity(entity, index, 'support', hints, item.reason || '待确认', 'pending');
  }).filter((item): item is VisualCharacter => Boolean(item)), 'pend');
  const subjects = subjectsFromLedger(ledger, bible.mode);
  const removedCount = bible.characters.length - characters.length;
  const warn = removedCount > 0
    ? `已按整篇剧本解析收起 ${removedCount} 张非贯穿角色卡；如需保留请上锁后手动补回`
    : decision.reason;
  return {
    ...bible,
    entityLedger: ledger,
    characters,
    subjects: bible.subjects?.length ? bible.subjects : subjects,
    pendingCharacters,
    rejectedCast: decision.rejected,
    candidates: ledgerToCandidates(ledger),
    presentation: decision.presentation,
    analysisReason: decision.reason,
    narratorMode: decision.narratorMode || bible.narratorMode,
    validation: warn
      ? { status: 'warning' as const, warnings: Array.from(new Set([...(bible.validation?.warnings || []), warn])).slice(0, 8), checkedAt: Date.now() }
      : bible.validation
  };
}

function carryCharacter(previous: VisualCharacter | undefined, incoming: VisualCharacter): VisualCharacter {
  if (!previous) return { ...incoming, refs: incoming.refs || [], locked: Boolean(incoming.locked) };
  if (!sameEntityIdentity(previous, incoming)) {
    return { ...incoming, refs: incoming.refs || [], locked: Boolean(incoming.locked) };
  }
  const identityLocked = Boolean(previous.identityLocked);
  const appearanceLocked = Boolean(previous.appearanceLocked);
  const refsLocked = Boolean(previous.refsLocked);
  if (identityLocked || appearanceLocked || refsLocked) {
    return {
      ...incoming,
      id: incoming.id,
      name: identityLocked ? previous.name : incoming.name,
      role: identityLocked ? previous.role : incoming.role,
      kind: incoming.kind || previous.kind,
      entityId: incoming.entityId || previous.entityId,
      candidateId: incoming.candidateId || previous.candidateId,
      look: appearanceLocked ? previous.look : incoming.look,
      wardrobe: appearanceLocked ? previous.wardrobe : incoming.wardrobe,
      ageBand: appearanceLocked ? previous.ageBand : incoming.ageBand,
      signature: appearanceLocked ? previous.signature : incoming.signature,
      refs: refsLocked ? previous.refs : (incoming.refs || []),
      locked: identityLocked || appearanceLocked || refsLocked,
      identityLocked,
      appearanceLocked,
      refsLocked,
      sourceEvidence: incoming.sourceEvidence?.length ? incoming.sourceEvidence : previous.sourceEvidence,
      evidenceSpans: incoming.evidenceSpans?.length ? incoming.evidenceSpans : previous.evidenceSpans,
      confidence: incoming.confidence ?? previous.confidence
    };
  }
  return {
    ...incoming,
    refs: incoming.refs || [],
    locked: false,
    identityLocked: false,
    appearanceLocked: false,
    refsLocked: false
  };
}

export function lockedCastOnly(bible?: VisualBible | null): VisualBible | null {
  if (!bible) return null;
  if (bible.pinned) return bible;
  const locked = (bible.characters || []).filter(cardKeptOnRebuild);
  const lockedLoc = (bible.locations || []).filter((item) => item.locked);
  const lockedSubjects = (bible.subjects || []).filter((item) => item.locked || item.identityLocked || item.appearanceLocked || item.refsLocked);
  if (locked.length === 0 && lockedLoc.length === 0 && lockedSubjects.length === 0) return null;
  return {
    ...bible,
    characters: locked,
    subjects: lockedSubjects.length ? lockedSubjects : bible.subjects,
    locations: lockedLoc.length ? lockedLoc : bible.locations,
    pinned: false
  };
}

export function mergeVisualBible(previous: VisualBible | null | undefined, incoming: VisualBible): VisualBible {
  if (!previous) return incoming;
  if (previous.pinned) {
    return previous;
  }
  const prevByEntity = new Map(
    previous.characters
      .filter((item) => item.entityId || item.candidateId)
      .map((item) => [String(item.entityId || item.candidateId), item])
  );
  const used = new Set<string>();
  const characters = incoming.characters.map((item) => {
    const entityKey = String(item.entityId || item.candidateId || '');
    const prev = (entityKey && prevByEntity.get(entityKey))
      || previous.characters.find((row) => sameEntityIdentity(row, item))
      || undefined;
    if (prev) used.add(prev.id);
    return carryCharacter(prev, item);
  });
  const retiredFromPrev: VisualBible['retiredEntities'] = [...(incoming.retiredEntities || []), ...(previous.retiredEntities || [])];
  previous.characters.forEach((prev) => {
    if (used.has(prev.id)) return;
    if (!cardKeptOnRebuild(prev)) return;
    retiredFromPrev.push({
      entityId: prev.entityId || prev.candidateId || prev.id,
      name: prev.name,
      kind: prev.kind,
      character: prev,
      override: previous.overrides?.[prev.entityId || prev.candidateId || prev.id],
      reason: '未出现在新稿活动角色中'
    });
  });
  const lockedLoc = new Map(previous.locations.filter((item) => item.locked).map((item) => [item.id, item]));
  const locations = incoming.locations.map((item) => lockedLoc.get(item.id) || item);
  const prevSubjects = previous.subjects || [];
  const incomingSubjects = incoming.subjects || [];
  const subjectById = new Map(prevSubjects.map((item) => [item.id, item]));
  const subjects = incomingSubjects.map((item) => {
    const prev = subjectById.get(item.id) || prevSubjects.find((row) => namesEqual(row.name, item.name));
    if (prev && (prev.locked || prev.identityLocked || prev.appearanceLocked || prev.refsLocked)) return prev;
    return item;
  });
  return {
    ...incoming,
    pinned: previous.pinned,
    narratorMode: previous.narratorMode || incoming.narratorMode,
    overrides: { ...(previous.overrides || {}), ...(incoming.overrides || {}) },
    retiredEntities: (retiredFromPrev || []).filter((item, index, arr) => arr.findIndex((other) => other.entityId === item.entityId) === index),
    characters: assignUniqueIds(characters, 'char').slice(0, 8),
    subjects: assignUniqueIds(subjects, 'subj').slice(0, 4),
    pendingCharacters: incoming.pendingCharacters,
    locations: locations.slice(0, 3),
    motif: previous.motif?.name && incoming.motif == null ? previous.motif : incoming.motif
  };
}

export function bibleHasCast(bible?: VisualBible | null): boolean {
  return Boolean(bible && bible.characters.some((item) => isNarrativeKind(item.kind) || !item.kind));
}

export function bibleSubjects(bible?: VisualBible | null): VisualSubject[] {
  if (!bible) return [];
  const fromField = bible.subjects || [];
  const migrated = bible.characters.filter((item) => isObjectKind(item.kind)).map((item, index) => characterToSubject(item, index));
  return [...fromField, ...migrated].filter((item, index, arr) => arr.findIndex((other) => namesEqual(other.name, item.name)) === index);
}

/** 是否存在真正的叙事班底。object 即使在 story 模式下也不算角色。 */
export function bibleHasNarrativeCast(bible?: VisualBible | null): boolean {
  if (!bible || !bible.characters.length) return false;
  return bible.characters.some((item) => isNarrativeKind(item.kind) || !item.kind);
}

/** 若有实物锁，返回它们的锁定描述，供说明型画面文法引用。 */
export function bibleObjectLock(bible?: VisualBible | null): string {
  if (!bible) return '';
  const objects = bibleSubjects(bible);
  if (!objects.length) return '';
  const names = objects.map((item) => item.name).join('、');
  return `同一被加工对象（${names}）保持同一实物外观与状态，状态随步骤递进，禁止每镜换另一块；允许按句图解。`;
}

/** 是否在锁实物（subjects，或连续性规则提到了被加工对象）。 */
export function bibleLocksObject(bible?: VisualBible | null): boolean {
  if (!bible) return false;
  if (bibleSubjects(bible).length) return true;
  const text = `${bible.continuityRule || ''} ${bible.paletteLock || ''}`;
  return /被加工对象|实物外观|同一实物|食材外观/.test(text);
}

function characterNameTokens(character: VisualCharacter): string[] {
  const raw = [character.name, character.kind === 'creature' ? character.name : '']
    .join(' ')
    .toLowerCase();
  const tokens = raw.split(/[\s/_-]+/).map((item) => item.trim()).filter((item) => item.length >= 2);
  const extras: string[] = [];
  if (/\bfox\b/i.test(character.name)) extras.push('fox');
  if (/\bcrocodile\b/i.test(character.name) || /鳄/.test(character.name)) extras.push('crocodile', 'croc');
  if (/\brabbit\b/i.test(character.name) || /兔/.test(character.name)) extras.push('rabbit', 'bunny');
  return Array.from(new Set([...tokens, ...extras]));
}

export function narrativeCharacters(bible?: VisualBible | null): VisualCharacter[] {
  if (!bible) return [];
  return bible.characters.filter((item) => isNarrativeKind(item.kind) || !item.kind);
}

export function charactersMentionedInLine(cast: VisualCharacter[], line: string, ledger?: ScriptEntityLedger): VisualCharacter[] {
  const text = String(line || '');
  if (!text) return [];
  return cast.filter((character) => {
    const canonical = ledger?.entities.find(entity => entity.id === (character.entityId || character.candidateId))?.name;
    return [canonical, character.name].some(name => name && !FABRICATED_CAST_NAMES.has(name)
      && (/[\u4e00-\u9fff]/.test(name) ? text.includes(name) : nameMentionedIn(text, name)));
  });
}

export function subjectsMentionedInLine(subjects: VisualSubject[], line: string): VisualSubject[] {
  const text = String(line || '');
  if (!text) return [];
  return subjects.filter((subject) => subject.name && text.includes(subject.name));
}

export function occupancyReasonLabel(reason?: OccupancyReason): string {
  if (reason === 'named-in-line') return '文案点名';
  if (reason === 'dialogue') return '对白';
  if (reason === 'insert-object') return '只拍实物';
  if (reason === 'establish-lead') return '建立主角';
  if (reason === 'contrast-support') return '对照配角';
  if (reason === 'pronoun-continue') return '代词延续';
  if (reason === 'empty') return '无人';
  if (reason === 'user') return '手动';
  return '';
}

export function planShotOccupancy(
  shot: ForecastShot,
  bible: VisualBible | null | undefined,
  index: number,
  shots: ForecastShot[]
): OccupancyPlan {
  const empty: OccupancyPlan = { onCamera: false, characterIds: [], subjectIds: [], reason: 'empty' };
  if (!bible) return empty;
  const cast = narrativeCharacters(bible);
  const subjects = bibleSubjects(bible);
  const spoken = shot.sliceText || shot.narration || '';
  const mentioned = charactersMentionedInLine(cast, spoken, bible.entityLedger);
  const mentionedSubjects = subjectsMentionedInLine(subjects, spoken);
  const speaker = speakerCharacterFromLine(bible, spoken);
  const dialogue = isQuotedDialogueLine(spoken);
  const contrast = shot.splitReason?.includes('对照') || shot.continuity === 'contrast' || shot.coverageJob === 'contrast' || shot.voRole === 'continue';
  const lead = cast.find((item) => item.role === 'lead') || null;
  const support = cast.find((item) => item.role === 'support') || null;
  const leads = cast.filter((item) => item.role === 'lead');

  if (shot.coverageJob === 'insert' && !dialogue) {
    return {
      onCamera: false,
      characterIds: [],
      subjectIds: mentionedSubjects.map((item) => item.id),
      reason: mentionedSubjects.length ? 'insert-object' : 'empty'
    };
  }
  if (mentioned.length) {
    return {
      onCamera: true,
      characterIds: mentioned.map((item) => item.id),
      subjectIds: mentionedSubjects.map((item) => item.id),
      reason: dialogue ? 'dialogue' : 'named-in-line'
    };
  }
  const femalePronoun = /她(?!们)|\bShe\b|\bshe\b/.test(spoken);
  const malePronoun = /他(?!们)|\bHe\b|\bhe\b/.test(spoken);
  const groupPronoun = /他们|她们|两人|\bThey\b|\bthey\b/.test(spoken);
  const pronounSubject = femalePronoun || malePronoun || groupPronoun
    || /(?:^|[。！？!?；;\s])(他|她|它)(?:拿|坐|走|跑|看|说|问|读|写|打开|坐下|走进|站|笑|哭|看向)/.test(spoken)
    || /随后(他|她|它)/.test(spoken);
  const environmentOnly = shot.coverageJob === 'insert'
    || (/树|窗外|风景|天空/.test(spoken) && !pronounSubject && !mentioned.length);
  if (pronounSubject && !environmentOnly) {
    const gender = femalePronoun && !malePronoun ? 'female' : malePronoun && !femalePronoun ? 'male' : 'unknown';
    const resolveGender = (character: VisualCharacter, context: string) => {
      if (characterMentionsFemale(character)) return 'female';
      if (characterMentionsMale(character)) return 'male';
      const canonical = bible.entityLedger?.entities.find(entity => entity.id === (character.entityId || character.candidateId))?.name;
      const name = (canonical || character.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`女孩${name}|${name}女孩`).test(context)) return 'female';
      if (new RegExp(`男孩${name}|${name}男孩`).test(context)) return 'male';
      return 'unknown';
    };
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const prevSpoken = shots[cursor]?.sliceText || shots[cursor]?.narration || '';
      let prevMentioned = charactersMentionedInLine(cast, prevSpoken, bible.entityLedger);
      if (!prevMentioned.length) continue;
      if (gender !== 'unknown' && !groupPronoun) {
        const gendered = prevMentioned.filter((item) => resolveGender(item, prevSpoken) === gender);
        prevMentioned = gendered.length ? gendered : prevMentioned.filter(item => resolveGender(item, prevSpoken) === 'unknown');
        if (!prevMentioned.length) continue;
      }
      if (!groupPronoun && prevMentioned.length > 1) return empty;
      return {
        onCamera: true,
        characterIds: prevMentioned.map((item) => item.id),
        subjectIds: mentionedSubjects.map((item) => item.id),
        reason: 'pronoun-continue'
      };
    }
    const genderedCast = gender === 'unknown' || groupPronoun
      ? cast
      : cast.filter((item) => resolveGender(item, spoken) === gender || resolveGender(item, spoken) === 'unknown');
    const fallbackCast = genderedCast;
    if (fallbackCast.length === 1 || (gender !== 'unknown' && fallbackCast.length === 1)) {
      return {
        onCamera: true,
        characterIds: [fallbackCast[0].id],
        subjectIds: mentionedSubjects.map((item) => item.id),
        reason: 'pronoun-continue'
      };
    }
    if (fallbackCast.length === 1) {
      return {
        onCamera: true,
        characterIds: [fallbackCast[0].id],
        subjectIds: mentionedSubjects.map((item) => item.id),
        reason: 'pronoun-continue'
      };
    }
  }
  if (speaker) {
    return {
      onCamera: true,
      characterIds: [speaker.id],
      subjectIds: mentionedSubjects.map((item) => item.id),
      reason: 'dialogue'
    };
  }
  if (contrast && support && mentioned.length) {
    return {
      onCamera: true,
      characterIds: [support.id],
      subjectIds: mentionedSubjects.map((item) => item.id),
      reason: 'contrast-support'
    };
  }
  const first = index === 0 || shot.coverageJob === 'hook';
  if (first && leads.length && /他|她|他们|两人|我/.test(spoken)) {
    return {
      onCamera: true,
      characterIds: leads.map((item) => item.id),
      subjectIds: mentionedSubjects.map((item) => item.id),
      reason: 'establish-lead'
    };
  }
  if ((shot.coverageJob === 'hook' || shot.coverageJob === 'establish') && leads.length === 1 && /他|她|我/.test(spoken)) {
    return {
      onCamera: true,
      characterIds: [lead!.id],
      subjectIds: mentionedSubjects.map((item) => item.id),
      reason: 'establish-lead'
    };
  }
  if (mentionedSubjects.length) {
    return {
      onCamera: false,
      characterIds: [],
      subjectIds: mentionedSubjects.map((item) => item.id),
      reason: 'insert-object'
    };
  }
  return empty;
}

export function speakerCharacterFromLine(
  bible: VisualBible | null | undefined,
  line: string
): VisualCharacter | null {
  if (!bibleHasNarrativeCast(bible) || !line) return null;
  const text = line.toLowerCase();
  const quoted = /["“']([^"”']{2,120})["”']/.exec(line);
  const quote = (quoted?.[1] || '').toLowerCase();
  const quoteAt = quoted ? line.toLowerCase().indexOf(quote) : -1;
  const afterQuote = quoteAt >= 0 ? text.slice(quoteAt + quote.length) : '';
  const beforeQuote = quoteAt >= 0 ? text.slice(0, quoteAt) : '';
  const attribution = `${afterQuote} ${beforeQuote}`.trim() || text;
  const scored = narrativeCharacters(bible).map((character) => {
    const canonical = bible?.entityLedger?.entities.find(entity => entity.id === (character.entityId || character.candidateId))?.name;
    const tokens = [...characterNameTokens(character), ...(canonical ? characterNameTokens({ ...character, name: canonical }) : [])];
    const inAttribution = tokens.some((token) => attribution.includes(token));
    const inQuote = quote ? tokens.some((token) => quote.includes(token)) : false;
    const inLine = tokens.some((token) => text.includes(token));
    let score = 0;
    if (inAttribution && quote) score += 6;
    if (inLine) score += 2;
    if (inQuote) score -= 3;
    return { character, score };
  }).filter((item) => item.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.character || null;
}

export function isQuotedDialogueLine(line: string): boolean {
  return /["“'][^"”']{2,120}["”']/.test(line || '');
}

export function leadCharacter(bible?: VisualBible | null): VisualCharacter | null {
  const cast = narrativeCharacters(bible);
  return cast.find((item) => item.role === 'lead') || cast[0] || null;
}

export function bibleContractForPrompt(bible?: VisualBible | null): string {
  if (!bible) return '';
  if (bible.mode === 'expository' && !bibleHasNarrativeCast(bible)) {
    return [
      '【画面文法】说明型：允许按句图解，不要硬拍成一部戏。',
      bible.paletteLock ? `【色板锁定】${bible.paletteLock}` : '',
      bibleObjectLock(bible) || (bible.continuityRule ? `【连续】${bible.continuityRule}` : '')
    ].filter(Boolean).join('\n');
  }
  const chars = narrativeCharacters(bible).map((item) => (
    `- ${item.id} ${item.name}（${item.role}，${item.ageBand}）：外形 ${item.look}；服装 ${item.wardrobe}${item.signature ? `；识别物 ${item.signature}` : ''}${item.sourceEvidence?.length ? `；文案依据「${item.sourceEvidence[0]}」` : ''}。角色卡只描述全片不变量。禁止无故换脸、换发型、换装。`
  ));
  const subjectLines = bibleSubjects(bible).map((item) => (
    `- ${item.id} ${item.name}：${item.look}${item.sourceEvidence?.length ? `；文案依据「${item.sourceEvidence[0]}」` : ''}`
  ));
  const locs = bible.locations.map((item) => (
    `- ${item.id} ${item.name}：${item.look}；时间 ${item.timeOfDay}`
  ));
  return [
    '【画面文法】叙事型：先服从圣经，再画这一拍的动作。',
    bible.logline ? `【一条线】${bible.logline}` : '',
    chars.length ? `【角色卡】\n${chars.join('\n')}` : '',
    subjectLines.length ? `【实物锁】\n${subjectLines.join('\n')}` : '',
    locs.length ? `【场景卡】\n${locs.join('\n')}` : '',
    bible.motif ? `【母题】${bible.motif.name}：${bible.motif.look}。钩子和收束要看见它。` : '',
    bible.paletteLock ? `【色板】${bible.paletteLock}` : '',
    `【连续】${bible.continuityRule || '同一人同一空间推进；对照才换主体；收束回收开场'}`,
    '【禁】每拍换一个新主角、无动机换房间、用情绪形容词代替可见物。'
  ].filter(Boolean).join('\n');
}

export function stripBiblePrefix(intent: string): string {
  let text = String(intent || '').trim();
  if (!text) return '';
  const chunks = text.split('【').map((chunk, index) => (index === 0 ? chunk : `【${chunk}`));
  const kept: string[] = [];
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('【')) {
      const close = trimmed.indexOf('】');
      if (close > 0) {
        let rest = trimmed.slice(close + 1);
        for (const label of CONTINUITY_PEEL) {
          const at = rest.indexOf(label);
          if (at >= 0) rest = rest.slice(at + label.length);
        }
        rest = rest.replace(/^[。,，、.\s]+/, '').trim();
        if (rest && !rest.startsWith('【')) kept.push(rest);
        continue;
      }
    }
    let rest = trimmed;
    for (const label of CONTINUITY_PEEL) {
      if (rest.startsWith(label)) rest = rest.slice(label.length).replace(/^[。,，、.\s]+/, '').trim();
    }
    if (rest) kept.push(rest);
  }
  text = kept.join('。').replace(/^[。,，、.\s]+/, '').trim();
  const parts = text.split(/[。]/).map((part) => part.trim()).filter(Boolean);
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const part of parts) {
    const key = part.replace(/\s+/g, ' ').toLowerCase();
    if (!key || seen.has(key)) continue;
    if (CONTINUITY_PEEL.includes(part)) continue;
    seen.add(key);
    unique.push(part);
  }
  return unique.join('。');
}

function continuityLabel(kind?: VisualContinuity): string {
  if (kind === 'callback') return '回收开场构图或母题，只改一处';
  if (kind === 'contrast') return '对照切换，主体可以不同';
  if (kind === 'same-subject') return '同一人，景别或状态变了';
  if (kind === 'same-space') return '同一空间往前推';
  if (kind === 'new-info') return '这一拍才允许看见的新信息';
  return '';
}

export function assignShotContinuity(shots: ForecastShot[], bible?: VisualBible | null): ForecastShot[] {
  if (!bible) return shots;
  const loc = bible.locations[0] || null;
  return shots.map((shot, index) => {
    const isContrast = shot.splitReason?.includes('对照') || shot.visualCount === 2 && (shot.visualIndex || 0) > 0;
    const isCallback = shot.function === 'cta' || (index === shots.length - 1);
    const continuity: VisualContinuity = isCallback
      ? 'callback'
      : isContrast
        ? 'contrast'
        : index === 0
          ? 'new-info'
          : 'same-space';
    const occupancy = planShotOccupancy({ ...shot, continuity }, bible, index, shots);
    return {
      ...shot,
      occupancyPlan: occupancy,
      characterIds: occupancy.characterIds,
      subjectIds: occupancy.subjectIds,
      locationId: loc && occupancy.onCamera && continuity !== 'contrast' ? loc.id : shot.locationId,
      continuity
    };
  });
}

export function applyOccupancyAfterCoverage(shots: ForecastShot[], bible?: VisualBible | null): ForecastShot[] {
  if (!bible) return shots;
  const loc = bible.locations[0] || null;
  return shots.map((shot, index) => {
    const occupancy = planShotOccupancy(shot, bible, index, shots);
    return {
      ...shot,
      occupancyPlan: occupancy,
      characterIds: occupancy.characterIds,
      subjectIds: occupancy.subjectIds,
      locationId: loc && occupancy.onCamera && shot.continuity !== 'contrast' ? loc.id : (occupancy.onCamera ? shot.locationId : undefined)
    };
  });
}

export function composeShotVisualIntent(shot: ForecastShot, bible?: VisualBible | null): string {
  const action = stripBiblePrefix(shot.visualIntent || shot.sliceText || shot.narration || '');
  if (!bible) return action;
  if (bible.mode === 'expository' && !bibleHasNarrativeCast(bible)) {
    return action;
  }
  const occupancyIds = shot.occupancyPlan?.characterIds || (Array.isArray(shot.characterIds) ? shot.characterIds : undefined);
  const char = Array.isArray(occupancyIds)
    ? bible.characters.find((item) => occupancyIds.includes(item.id) && isNarrativeKind(item.kind || 'person'))
    : null;
  const loc = shot.locationId
    ? bible.locations.find((item) => item.id === shot.locationId)
    : (char ? bible.locations[0] : null);
  const parts: string[] = [];
  if (char) {
    parts.push(`【${char.name}】${char.look}，${char.wardrobe}${char.signature ? `，带着${char.signature}` : ''}`);
  }
  if (loc && shot.continuity !== 'contrast') {
    parts.push(`【${loc.name}】${loc.look}，${loc.timeOfDay}`);
  }
  if (shot.continuity === 'callback' && bible.motif) {
    parts.push(`【回收】再次看见${bible.motif.name}：${bible.motif.look}`);
  }
  const cont = continuityLabel(shot.continuity);
  if (cont) parts.push(cont);
  if (action) parts.push(action);
  return parts.join('。');
}

export function stampShotsWithBible(shots: ForecastShot[], bible?: VisualBible | null): ForecastShot[] {
  return assignShotContinuity(shots, bible).map((shot) => ({
    ...shot,
    visualIntent: composeShotVisualIntent(shot, bible)
  }));
}

export function characterIdentityEnglish(character: VisualCharacter): string {
  if (character.kind === 'object') {
    return `OBJECT LOCK — same real object "${character.name}": ${character.look}. It may change doneness/stage across shots, but never swap in a different specimen.`;
  }
  const kind = character.kind === 'creature' ? 'anthropomorphic character' : 'character';
  const signature = character.signature ? `, identifying detail: ${character.signature}` : '';
  const appearance = character.appearanceUnknown
    ? `identity "${character.name}" only; appearance is unconfirmed, do not invent a specific face`
    : `${character.look}, wearing ${character.wardrobe}${signature}. Same face, body proportions, colors, and outfit in every frame`;
  return `CHARACTER LOCK — same ${kind} "${character.name}": ${appearance}.`;
}

export function resolveShotCharacter(
  bible: VisualBible | null | undefined,
  clip: { coverageJob?: string; characterIds?: string[]; occupancyPlan?: OccupancyPlan },
  spoken = ''
): VisualCharacter | null {
  if (!bible) return null;
  const occupancyIds = clip.occupancyPlan?.characterIds || clip.characterIds;
  if (clip.coverageJob === 'insert' && (!occupancyIds || occupancyIds.length === 0)) return null;
  if (Array.isArray(occupancyIds) && occupancyIds.length === 0) return null;
  const speaker = speakerCharacterFromLine(bible, spoken);
  if (speaker && (!occupancyIds || occupancyIds.includes(speaker.id))) return speaker;
  if (Array.isArray(occupancyIds)) {
    return narrativeCharacters(bible).find((item) => occupancyIds.includes(item.id)) || null;
  }
  return null;
}

export function shotCharacterLockEnglish(
  bible: VisualBible | null | undefined,
  clip: { coverageJob?: string; characterIds?: string[]; occupancyPlan?: OccupancyPlan; subjectIds?: string[] },
  spoken = ''
): string {
  if (!bible) return '';
  const occupancyIds = clip.occupancyPlan?.characterIds || clip.characterIds;
  const subjectIds = clip.occupancyPlan?.subjectIds || clip.subjectIds;
  const subjects = bibleSubjects(bible);
  const shotSubjects = Array.isArray(subjectIds)
    ? subjects.filter((item) => subjectIds.includes(item.id))
    : (occupancyIds?.length ? [] : subjects);
  const objectLock = shotSubjects.map((item) => (
    `OBJECT LOCK — same real object "${item.name}": ${item.look}. It may change doneness/stage across shots, but never swap in a different specimen.`
  )).join(' ');
  if (!bibleHasNarrativeCast(bible) || (Array.isArray(occupancyIds) && occupancyIds.length === 0)) {
    return objectLock;
  }
  const used = narrativeCharacters(bible).filter((item) => occupancyIds?.includes(item.id));
  const charLock = used.map((item) => characterIdentityEnglish(item)).join(' ');
  return [charLock, objectLock].filter(Boolean).join(' ');
}

export function characterLockEnglish(bible?: VisualBible | null, characterIds?: string[]): string {
  if (!bible) return '';
  return shotCharacterLockEnglish(bible, { characterIds }, '');
}

export function applyBibleToChineseIntent(
  intent: string,
  bible?: VisualBible | null,
  shot?: Pick<ForecastShot, 'characterIds' | 'locationId' | 'continuity'> & { function?: BeatFunction }
): string {
  if (!bible) return intent;
  return composeShotVisualIntent({
    visualIntent: intent,
    characterIds: shot?.characterIds,
    locationId: shot?.locationId,
    continuity: shot?.continuity,
    function: shot?.function || 'setup'
  } as ForecastShot, bible);
}

export function applyBibleToEnglishPrompt(
  prompt: string,
  bible?: VisualBible | null,
  characterIds?: string[]
): string {
  const lock = characterLockEnglish(bible, characterIds);
  if (!lock) return prompt;
  if (prompt.includes('same character identity') || prompt.includes('Keep a consistent color grade')) return prompt;
  return `${prompt.replace(/[,，\s]+$/g, '')}. ${lock}`;
}

export function toggleCharacterLock(bible: VisualBible, characterId: string): VisualBible {
  return toggleCharacterLockFlag(bible, characterId, 'identity');
}

export function toggleCharacterLockFlag(bible: VisualBible, characterId: string, flag: CharacterLockFlag): VisualBible {
  const character = bible.characters.find((item) => item.id === characterId);
  if (!character) return bible;
  const entityId = character.entityId || character.candidateId || character.id;
  const current = flag === 'identity' ? Boolean(character.identityLocked) : flag === 'appearance' ? Boolean(character.appearanceLocked) : Boolean(character.refsLocked);
  return reduceBibleAction(bible, { type: 'set_entity_lock', entityId, field: flag, value: !current });
}

export function updateCharacterField(
  bible: VisualBible,
  characterId: string,
  patch: Partial<Pick<VisualCharacter, 'name' | 'look' | 'wardrobe' | 'ageBand' | 'signature'>>
): VisualBible {
  const character = bible.characters.find((item) => item.id === characterId);
  if (!character) return bible;
  const entityId = character.entityId || character.candidateId || character.id;
  let next = bible;
  if (patch.name && patch.name !== character.name) {
    next = reduceBibleAction(next, { type: 'set_entity_display_name', entityId, displayName: patch.name });
  }
  const appearancePatch = {
    look: patch.look,
    wardrobe: patch.wardrobe,
    ageBand: patch.ageBand,
    signature: patch.signature
  };
  if (appearancePatch.look != null || appearancePatch.wardrobe != null || appearancePatch.ageBand != null || appearancePatch.signature != null) {
    next = reduceBibleAction(next, { type: 'set_entity_appearance', entityId, patch: appearancePatch });
  }
  return {
    ...next,
    characters: next.characters.map((item) => (
      item.id === characterId
        ? { ...item, appearanceUnknown: appearanceIsUnknown(item.look, item.wardrobe) }
        : item
    )),
    bibleRevision: bibleRevisionOf(next)
  };
}

export function continuityShortLabel(kind?: VisualContinuity): string {
  if (kind === 'callback') return '回收';
  if (kind === 'contrast') return '对照';
  if (kind === 'same-space') return '同场';
  if (kind === 'same-subject') return '同人';
  if (kind === 'new-info') return '新信息';
  return '';
}

export function bibleSummary(bible?: VisualBible | null): string {
  if (!bible) return '还没有画面圣经';
  if (!bibleHasNarrativeCast(bible)) {
    const objects = bibleSubjects(bible).map((item) => item.name).filter(Boolean);
    if (objects.length) return `锁实物：${objects.join('、')}`;
    const lock = bible.continuityRule || bible.paletteLock || '';
    return lock ? `图解 · ${lock}` : '纯图解：锁色板，不编主角';
  }
  const names = narrativeCharacters(bible).map((item) => item.name).filter(Boolean);
  const loc = bible.locations[0];
  return [...names, loc ? loc.name : '', bible.motif?.name]
    .filter(Boolean)
    .join(' · ') || bible.logline || '有班底';
}

export function characterHasRef(character?: VisualCharacter | null): boolean {
  return Boolean(characterRefUrl(character));
}

export function characterRefUrl(character?: VisualCharacter | null): string | null {
  const ref = character?.refs?.[0];
  if (!ref) return null;
  return ref.imageUrl || ref.thumbDataUrl || null;
}

export function characterRefPreview(character?: VisualCharacter | null): string | null {
  const ref = character?.refs?.[0];
  if (!ref) return null;
  return ref.thumbDataUrl || ref.imageUrl || null;
}

export function setCharacterRef(bible: VisualBible, characterId: string, ref: VisualCharacterRef): VisualBible {
  const character = bible.characters.find((item) => item.id === characterId);
  if (!character) return bible;
  const entityId = character.entityId || character.candidateId || character.id;
  return reduceBibleAction(bible, { type: 'set_entity_refs', entityId, refs: [ref] });
}

export function clearCharacterRef(bible: VisualBible, characterId: string): VisualBible {
  const character = bible.characters.find((item) => item.id === characterId);
  if (!character) return bible;
  const entityId = character.entityId || character.candidateId || character.id;
  const unlocked = reduceBibleAction(bible, { type: 'set_entity_lock', entityId, field: 'refs', value: false });
  const next = {
    ...unlocked,
    characters: unlocked.characters.map((item) => (
      item.id === characterId ? { ...item, refs: [] } : item
    ))
  };
  return { ...next, bibleRevision: bibleRevisionOf(next) };
}

export function characterForShot(
  bible?: VisualBible | null,
  characterIds?: string[]
): VisualCharacter | null {
  if (!bibleHasCast(bible)) return null;
  if (Array.isArray(characterIds)) {
    if (characterIds.length === 0) return null;
    return bible!.characters.find((item) => characterIds.includes(item.id)) || null;
  }
  return leadCharacter(bible);
}

export function storyLeadMissingRef(bible?: VisualBible | null): boolean {
  if (!bibleHasNarrativeCast(bible)) return false;
  const lead = leadCharacter(bible);
  if (lead?.appearanceUnknown || lead?.status === 'pending') return false;
  return Boolean(lead && !characterHasRef(lead));
}

export function previewBibleDiff(
  bible: VisualBible | null | undefined,
  opts: { narration: string; title?: string; intentNotes?: string; genre?: ScriptGenre | null }
): VisualBibleDiff {
  const sourceChanged = visualBibleSourceShift(bible, opts.narration, opts.genre, {
    title: opts.title,
    intentNotes: opts.intentNotes
  });
  if (!bible) {
    return { sourceChanged: true, pinned: false, addedNames: [], removedNames: [], pendingNames: [], summary: '还没有画面圣经' };
  }
  const ledger = buildEntityLedger({
    narration: opts.narration,
    title: opts.title,
    intentNotes: opts.intentNotes,
    candidates: bible.candidates
  });
  const nextNames = new Set(confirmedCastEntities(ledger).map((item) => item.name));
  const currentNames = new Set(narrativeCharacters(bible).map((item) => item.name));
  const addedNames = [...nextNames].filter((name) => !currentNames.has(name));
  const removedNames = [...currentNames].filter((name) => !nextNames.has(name));
  const pendingNames = (bible.pendingCharacters || []).map((item) => item.name);
  const parts = [
    sourceChanged ? (bible.pinned ? '当前圣经与新口播来源不同（已钉住，未自动重编）' : '口播来源已变') : '',
    addedNames.length ? `将新增 ${addedNames.join('、')}` : '',
    removedNames.length ? `将移除 ${removedNames.join('、')}` : '',
    pendingNames.length ? `待确认 ${pendingNames.join('、')}` : ''
  ].filter(Boolean);
  return {
    sourceChanged,
    pinned: Boolean(bible.pinned),
    addedNames,
    removedNames,
    pendingNames,
    summary: parts.join(' · ') || '与当前口播一致'
  };
}

export function confirmPendingCharacter(bible: VisualBible, pendingId: string): VisualBible {
  const pending = (bible.pendingCharacters || []).find((item) => item.id === pendingId);
  if (!pending) return bible;
  const entityId = pending.entityId || pending.candidateId || pending.id;
  return reduceBibleAction(bible, { type: 'set_entity_decision', entityId, decision: 'include' });
}

export function rejectPendingCharacter(bible: VisualBible, pendingId: string): VisualBible {
  const pending = (bible.pendingCharacters || []).find((item) => item.id === pendingId);
  if (!pending) return bible;
  const entityId = pending.entityId || pending.candidateId || pending.id;
  return reduceBibleAction(bible, { type: 'set_entity_decision', entityId, decision: 'exclude' });
}

export function applyNarratorMode(bible: VisualBible, narratorMode: NarratorMode, opts: {
  narration: string;
  title?: string;
  intentNotes?: string;
  genre?: ScriptGenre | null;
}): VisualBible {
  const ledger = bible.entityLedger || buildEntityLedger({
    narration: opts.narration,
    title: opts.title,
    intentNotes: opts.intentNotes,
    candidates: bible.candidates
  });
  const filled = fallbackVisualBible({
    narration: opts.narration,
    genre: opts.genre,
    title: opts.title,
    intentNotes: opts.intentNotes,
    ledger,
    narratorMode
  });
  return mergeVisualBible({ ...bible, narratorMode }, filled);
}

export function evidenceSourceLabel(source?: string): string {
  if (source === 'title') return '标题';
  if (source === 'intentNotes') return '创作意图';
  return '口播';
}
