import {
  BeatFunction,
  CastCandidate,
  ForecastShot,
  ScriptGenre,
  VisualBible,
  VisualBibleMode,
  VisualCastPolicy,
  VisualCharacter,
  VisualCharacterKind,
  VisualCharacterRef,
  VisualContinuity,
  VisualLocation,
  VisualMotif
} from '../types';
import { candidateByName, extractCastCandidates, formatCandidatesForPrompt } from './castCandidates';

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

export function bibleSourceHash(narration: string, genre?: ScriptGenre | null, mode?: VisualBibleMode): string {
  const payload = `${(narration || '').replace(/\s+/g, '')}|${genre || ''}|${mode || visualBibleModeForGenre(genre)}`;
  let hash = 0;
  for (let i = 0; i < payload.length; i++) {
    hash = (hash * 31 + payload.charCodeAt(i)) | 0;
  }
  return String(hash);
}

export function isVisualBibleStale(
  bible: VisualBible | null | undefined,
  narration: string,
  genre?: ScriptGenre | null
): boolean {
  if (!bible) return true;
  if (bible.pinned) return false;
  return bible.sourceHash !== bibleSourceHash(narration, genre, bible.mode);
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
  const names = Array.from(new Set(
    [...text.matchAll(/(?:他|她|朋友|同学|孩子|人物)?(?:叫|名叫|名字是)([\u4e00-\u9fa5]{2,6})/g)]
      .map((match) => match[1])
      .filter((name) => name && !OCCUPATION_TERMS.includes(name))
  ));
  const hasPerson = Boolean(
    names.length || occupations.length || /我(?!们)|他(?!们)|她(?!们)|男孩|女孩|男生|女生|男人|女人|少年|少女|朋友|同学|孩子|一个人/.test(text)
  );
  const evidenceCandidates = sentences.filter((sentence) => (
    /我(?!们)|他(?!们)|她(?!们)|男孩|女孩|男生|女生|男人|女人|少年|少女|朋友|同学|孩子|程序员|工程师|老师|教师|医生|护士|学生|记者|摄影师|律师|厨师|农民|科学家/.test(sentence)
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
    ageBand: /男孩|女孩|孩子/.test(text) ? '儿童/未成年' : /少年|少女|高中|初中/.test(text) ? '青少年' : hasPerson ? '成年（文案未明示年龄）' : undefined,
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

function normalizeCharacter(raw: any, index: number): VisualCharacter | null {
  const name = cleanText(raw?.name);
  let look = cleanText(raw?.look);
  let wardrobe = cleanText(raw?.wardrobe);
  if (!name && !look && !wardrobe) return null;
  const role = raw?.role === 'support' || raw?.role === 'extra' ? raw.role : 'lead';
  const kind: VisualCharacterKind | undefined = raw?.kind === 'creature' || raw?.kind === 'object' || raw?.kind === 'person'
    ? raw.kind as VisualCharacterKind
    : undefined;
  // object 是被加工对象/道具：即使模型写错成拟人文案，也中和为实物描述，绝不上拟人班底。
  if (kind === 'object') {
    const anthropomorphic = /拟人|表情|会笑|会哭|会说话|有情绪|穿衣|戴帽|围巾|首饰/.test(`${look} ${wardrobe}`);
    look = anthropomorphic ? `${name || '该实物'}的可指认外观，全片保持同一实物与状态，禁止拟人化` : (look || `${name || '该实物'}的可指认外观`);
    wardrobe = anthropomorphic || /换装|穿衣/.test(wardrobe) ? '保持同一外观' : wardrobe;
  }
  return {
    id: cleanText(raw?.id, role === 'lead' ? 'char-lead' : `char-${index + 1}`),
    name: name || (role === 'lead' ? '主角' : `角色${index + 1}`),
    role,
    ageBand: kind === 'object' ? '不适用' : cleanText(raw?.ageBand, '成年'),
    look: kind === 'object'
      ? look
      : (look || '可被连续认出的体型、头型、主色与一个固定识别点，全片不换发型'),
    wardrobe: kind === 'object' ? wardrobe : (wardrobe || '全片固定同一套服装，不换装'),
    signature: cleanText(raw?.signature) || undefined,
    sourceEvidence: asStringArray(raw?.sourceEvidence || raw?.evidence).slice(0, 4),
    confidence: Number.isFinite(Number(raw?.confidence))
      ? Math.max(0, Math.min(1, Number(raw.confidence)))
      : undefined,
    locked: Boolean(raw?.locked),
    refs: normalizeRefs(raw?.refs),
    seedHint: cleanText(raw?.seedHint) || undefined,
    kind,
    candidateId: cleanText(raw?.candidateId) || undefined
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
    locations: [],
    motif: null,
    castPolicy: 'evidence',
    continuityRule: mode === 'story'
      ? '同一人同一空间推进；对照才换主体；收束回收开场'
      : '色板和道具材质保持一致，允许按句图解',
    sourceHash,
    generatedAt: 0
  };
}

export function normalizeVisualBible(raw: unknown, fallbackMode: VisualBibleMode = 'expository'): VisualBible | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Partial<VisualBible> & { characters?: unknown; locations?: unknown };
  const mode: VisualBibleMode = data.mode === 'story' ? 'story' : data.mode === 'expository' ? 'expository' : fallbackMode;
  const characters = (Array.isArray(data.characters) ? data.characters : [])
    .map((item, index) => normalizeCharacter(item, index))
    .filter((item): item is VisualCharacter => Boolean(item))
    .slice(0, 3);
  const locations = (Array.isArray(data.locations) ? data.locations : [])
    .map((item, index) => normalizeLocation(item, index))
    .filter((item): item is VisualLocation => Boolean(item))
    .slice(0, 3);
  if (mode === 'story' && characters.length === 0 && locations.length === 0 && !cleanText(data.logline)) {
    return emptyVisualBible(mode, cleanText(data.sourceHash));
  }
  return {
    version: 1,
    mode,
    logline: cleanText(data.logline),
    paletteLock: cleanText(data.paletteLock),
    characters,
    locations,
    motif: normalizeMotif(data.motif),
    castPolicy: 'evidence' as VisualCastPolicy,
    candidates: (Array.isArray((data as VisualBible).candidates) ? (data as VisualBible).candidates : [])
      .map((item, index) => normalizeCandidate(item, index))
      .filter((item): item is CastCandidate => Boolean(item))
      .slice(0, 6),
    continuityRule: cleanText(
      data.continuityRule,
      mode === 'story' ? '同一人同一空间推进；对照才换主体；收束回收开场' : '色板和道具材质保持一致'
    ),
    sourceHash: cleanText(data.sourceHash),
    pinned: Boolean(data.pinned),
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

export function fallbackVisualBible(opts: {
  narration: string;
  genre?: ScriptGenre | null;
  title?: string;
  intentNotes?: string;
  candidates?: CastCandidate[];
}): VisualBible {
  const mode = visualBibleModeForGenre(opts.genre);
  const hash = bibleSourceHash(opts.narration, opts.genre, mode);
  const candidates = opts.candidates || extractCastCandidates({
    narration: opts.narration,
    title: opts.title,
    intentNotes: opts.intentNotes
  });
  const notes = String(opts.intentNotes || '').trim();
  const hints = extractNarrativeCharacterHints(opts.narration);
  const narrativeSignal = mode === 'story' || hasNarrativeSignal(opts.narration, candidates, notes);
  const objects = processedObjectNames(candidates);
  // story 叙事体裁：保留原行为，候选前两名建卡（含以物件为主角的故事）。
  // expository（教程/科普/带货等）默认不建叙事角色卡：
  // 只有原文带人物对话、人物行动或明确拟人意图时才允许上人物/生物角色；被加工对象不进角色卡。
  const castCandidates = mode === 'story'
    ? candidates.slice(0, 2)
    : narrativeSignal
      ? candidates.filter((candidate) => candidate.kind === 'person' || candidate.kind === 'creature').slice(0, 2)
      : [];
  const characters: VisualCharacter[] = castCandidates.map((candidate, index) => ({
    id: index === 0 ? 'char-lead' : 'char-support',
    name: candidate.name,
    role: index === 0 ? 'lead' : 'support',
    kind: candidate.kind,
    candidateId: candidate.id,
    ageBand: candidate.kind === 'person' ? (hints.ageBand || '文案未明确年龄') : '不适用',
    look: candidate.kind === 'creature'
      ? `拟人化的${candidate.name}：可指认体型、头/吻形状、眼睛颜色、主色与腹部颜色、一个固定识别点；全片同一外形`
      : candidate.kind === 'object'
        ? `${candidate.name}的可指认外观，全片保持同一实物，不更换`
        : `${hints.gender === 'male' ? '男性' : hints.gender === 'female' ? '女性' : '性别不擅自推断'}，可指认体型、发型、五官与一个固定识别点；全片不改五官和发型`,
    wardrobe: candidate.kind === 'object'
      ? '保持同一外观'
      : hints.occupations.length
        ? `符合${hints.occupations[0]}身份的固定服装，全片不换装`
        : '全片固定同一套服装，不换装',
    signature: candidate.kind === 'object' ? undefined : '一个跨镜头可认出的固定识别点（斑纹、配饰或道具）',
    sourceEvidence: candidate.evidence.slice(0, 4),
    confidence: 0.6,
    locked: false,
    refs: []
  }));
  const needsStage = mode === 'story' || characters.length > 0;
  const expositoryContinuity = objects.length
    ? `同一批被加工对象（${objects.join('、')}）保持同一实物外观，状态随步骤递进（生→熟→成品），禁止每镜换成另一块；允许按句图解。`
    : '色板和道具材质保持一致，允许按句图解';
  return {
    version: 1,
    mode,
    castPolicy: 'evidence',
    candidates,
    logline: cleanText(opts.title) || (characters.length ? '同一主体把这件事走完' : ''),
    paletteLock: mode === 'expository'
      ? (objects.length ? '全片同一色温、材质与实物状态，不要无故换滤镜或换食材外观' : '全片同一色温与材质，不要无故换滤镜')
      : '全片同一时段、同一色温',
    characters,
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
      ? '有角色的镜子同一主体推进；insert 默认无人；对照才换主体；收束回收开场'
      : expositoryContinuity,
    sourceHash: hash,
    validation: {
      status: 'warning',
      warnings: characters.length
        ? ['模型未返回可验证角色，已使用文案候选角色卡']
        : objects.length
          ? ['教程/说明型文案未创建角色卡；已锁定同一被加工对象与实物状态保持一致']
          : ['文案未识别到可指认主体，未创建角色卡'],
      checkedAt: Date.now()
    },
    generatedAt: Date.now()
  };
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

/** Validate model output against explicit narration facts before it becomes a hard constraint. */
export function validateVisualBibleAgainstNarration(
  bible: VisualBible | null | undefined,
  narration: string,
  opts?: { title?: string; intentNotes?: string; candidates?: CastCandidate[] }
): string[] {
  if (!bible) return [];
  const hints = extractNarrativeCharacterHints(narration);
  const candidates = opts?.candidates || bible.candidates || extractCastCandidates({
    narration,
    title: opts?.title || bible.logline,
    intentNotes: opts?.intentNotes
  });
  const warnings: string[] = [];
  if (!candidates.length && !hints.hasPerson && bible.characters.length > 0) {
    warnings.push('文案没有明确人物，但画面圣经创建了角色卡');
  }
  bible.characters.forEach((character) => {
    if (character.locked) return;
    const hit = character.candidateId
      ? candidates.find((item) => item.id === character.candidateId)
      : candidateByName(candidates, character.name);
    if (candidates.length && !hit) {
      warnings.push(`角色「${character.name}」不在文案候选名单中`);
    }
  });
  if (hints.gender === 'male' && bible.characters.some(characterMentionsFemale)) {
    warnings.push('文案出现男性线索，但角色卡包含女性外形/服装描述');
  }
  if (hints.gender === 'female' && bible.characters.some(characterMentionsMale)) {
    warnings.push('文案出现女性线索，但角色卡包含男性外形描述');
  }
  if (hints.ageBand === '儿童/未成年' && bible.characters.some((item) => /成年|中年|老年/.test(item.ageBand))) {
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
  opts?: { title?: string; intentNotes?: string; candidates?: CastCandidate[] }
): VisualBible {
  const candidates = opts?.candidates || bible.candidates || extractCastCandidates({
    narration,
    title: opts?.title || bible.logline,
    intentNotes: opts?.intentNotes
  });
  const filtered = {
    ...bible,
    castPolicy: 'evidence' as const,
    candidates,
    characters: bible.characters.filter((character) => {
      if (character.locked) return true;
      if (!candidates.length) return false;
      return Boolean(
        (character.candidateId && candidates.some((item) => item.id === character.candidateId))
        || candidateByName(candidates, character.name)
      );
    }).map((character) => {
      const hit = character.candidateId
        ? candidates.find((item) => item.id === character.candidateId)
        : candidateByName(candidates, character.name);
      if (!hit) return character;
      return {
        ...character,
        candidateId: character.candidateId || hit.id,
        kind: character.kind || hit.kind,
        sourceEvidence: character.sourceEvidence?.length ? character.sourceEvidence : hit.evidence
      };
    })
  };
  // 只有当文案确实有叙事班底信号时，才用候选把空角色卡补上。
  const narrativeSignal = hasNarrativeSignal(narration, candidates, String(opts?.intentNotes || ''));
  const withCast = filtered.characters.length === 0 && candidates.length > 0 && !bible.pinned && narrativeSignal
    ? {
      ...filtered,
      ...(() => {
        const filled = fallbackVisualBible({
          narration,
          genre: bible.mode === 'story' ? '故事' : null,
          title: opts?.title || bible.logline,
          intentNotes: opts?.intentNotes,
          candidates
        });
        return {
          characters: filled.characters,
          locations: filtered.locations.length ? filtered.locations : filled.locations,
          continuityRule: filled.continuityRule,
          logline: filtered.logline || filled.logline
        };
      })()
    }
    : filtered;
  const warnings = validateVisualBibleAgainstNarration(withCast, narration, { ...opts, candidates });
  if (warnings.length === 0) {
    return {
      ...withCast,
      validation: { status: 'ok', warnings: [], checkedAt: Date.now() }
    };
  }
  const hardWarnings = warnings.filter((warning) => (
    /没有明确人物，但画面圣经创建了角色卡|出现男性线索，但角色卡包含女性|出现女性线索，但角色卡包含男性|年龄被写成成年/.test(warning)
  ));
  if (hardWarnings.length === 0) {
    const hints = extractNarrativeCharacterHints(narration);
    const enriched = {
      ...withCast,
      characters: withCast.characters.map((character) => {
        const nameGrounded = hints.names.includes(character.name) || GENERIC_CHARACTER_NAMES.has(character.name);
        if (!nameGrounded || character.sourceEvidence?.length || !hints.evidence.length) return character;
        return {
          ...character,
          sourceEvidence: hints.evidence.slice(0, 4),
          confidence: character.confidence ?? 0.65
        };
      })
    };
    const remainingWarnings = validateVisualBibleAgainstNarration(enriched, narration);
    return {
      ...enriched,
      validation: { status: remainingWarnings.length ? 'warning' : 'ok', warnings: remainingWarnings, checkedAt: Date.now() }
    };
  }
  const hasUserLock = bible.pinned || bible.characters.some((item) => item.locked);
  if (hasUserLock) {
    return {
      ...withCast,
      validation: { status: 'warning', warnings, checkedAt: Date.now() }
    };
  }
  const safe = fallbackVisualBible({
    narration,
    genre: bible.mode === 'story' ? '故事' : null,
    title: opts?.title || bible.logline,
    intentNotes: opts?.intentNotes,
    candidates
  });
  const repairedWarnings = validateVisualBibleAgainstNarration(safe, narration);
  return {
    ...bible,
    characters: safe.characters,
    validation: {
      status: 'warning',
      warnings: Array.from(new Set([
        ...repairedWarnings,
        '模型角色与文案实体不一致，已替换为保守角色卡；请在画面圣经中确认外形'
      ])),
      checkedAt: Date.now()
    }
  };
}

/** Only hard narrative conflicts should stop image generation. Informational
 * warnings (for example, a conservative fallback card) remain actionable but
 * do not make the project unusable. */
export function visualBibleHasBlockingWarnings(bible?: VisualBible | null): boolean {
  if (!bible?.validation?.warnings?.length) return false;
  return bible.validation.warnings.some((warning) => {
    if (/没有明确人物，但画面圣经创建了角色卡/.test(warning) && bible.characters.length === 0) return false;
    return /没有明确人物，但画面圣经创建了角色卡|出现男性线索，但角色卡包含女性|出现女性线索，但角色卡包含男性|年龄被写成成年|人物「.+」没有出现在角色卡证据中|文案职业「.+」未进入角色卡|不在文案候选名单中/.test(warning);
  });
}

function carryCharacter(previous: VisualCharacter | undefined, incoming: VisualCharacter): VisualCharacter {
  if (!previous) return { ...incoming, refs: incoming.refs || [], locked: Boolean(incoming.locked) };
  if (previous.locked) {
    return {
      ...previous,
      candidateId: incoming.candidateId || previous.candidateId,
      kind: previous.kind || incoming.kind,
      sourceEvidence: incoming.sourceEvidence?.length ? incoming.sourceEvidence : previous.sourceEvidence,
      confidence: incoming.confidence ?? previous.confidence
    };
  }
  return {
    ...incoming,
    refs: [],
    locked: false
  };
}

export function lockedCastOnly(bible?: VisualBible | null): VisualBible | null {
  if (!bible) return null;
  if (bible.pinned) return bible;
  const locked = (bible.characters || []).filter((item) => item.locked);
  const lockedLoc = (bible.locations || []).filter((item) => item.locked);
  if (locked.length === 0 && lockedLoc.length === 0) return null;
  return {
    ...bible,
    characters: locked,
    locations: lockedLoc.length ? lockedLoc : bible.locations,
    pinned: false
  };
}

export function mergeVisualBible(previous: VisualBible | null | undefined, incoming: VisualBible): VisualBible {
  if (!previous) return incoming;
  if (previous.pinned) {
    return { ...previous, sourceHash: incoming.sourceHash };
  }
  const prevById = new Map(previous.characters.map((item) => [item.id, item]));
  const prevByName = new Map(previous.characters.map((item) => [item.name, item]));
  const used = new Set<string>();
  const characters = incoming.characters.map((item) => {
    const prev = prevById.get(item.id) || prevByName.get(item.name);
    if (prev) used.add(prev.id);
    return carryCharacter(prev, item);
  });
  previous.characters.forEach((prev) => {
    if (used.has(prev.id)) return;
    if (prev.locked) characters.unshift(prev);
  });
  const lockedLoc = new Map(previous.locations.filter((item) => item.locked).map((item) => [item.id, item]));
  const locations = incoming.locations.map((item) => lockedLoc.get(item.id) || item);
  return {
    ...incoming,
    pinned: previous.pinned,
    characters: characters.slice(0, 3),
    locations: locations.slice(0, 3),
    motif: previous.motif?.name && incoming.motif == null ? previous.motif : incoming.motif
  };
}

export function bibleHasCast(bible?: VisualBible | null): boolean {
  return Boolean(bible && bible.characters.length > 0);
}

/** 是否存在真正的叙事班底。story 体裁任何卡都算；expository 纯 object 卡是实物锁而非班底。 */
export function bibleHasNarrativeCast(bible?: VisualBible | null): boolean {
  if (!bible || !bible.characters.length) return false;
  if (bible.mode === 'story') return true;
  return bible.characters.some((item) => item.kind !== 'object');
}

/** 若只有 object 卡，返回它们的实物锁定描述，供说明型画面文法引用。 */
export function bibleObjectLock(bible?: VisualBible | null): string {
  if (!bible) return '';
  const objects = bible.characters.filter((item) => item.kind === 'object');
  if (!objects.length) return '';
  const names = objects.map((item) => item.name).join('、');
  return `同一被加工对象（${names}）保持同一实物外观与状态，状态随步骤递进，禁止每镜换另一块；允许按句图解。`;
}

/** expository 下是否在锁实物（有 object 卡，或连续性规则提到了被加工对象）。 */
export function bibleLocksObject(bible?: VisualBible | null): boolean {
  if (!bible) return false;
  if (bible.mode !== 'expository') return false;
  if (bible.characters.some((item) => item.kind === 'object')) return true;
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

export function speakerCharacterFromLine(
  bible: VisualBible | null | undefined,
  line: string
): VisualCharacter | null {
  if (!bibleHasCast(bible) || !line) return null;
  const text = line.toLowerCase();
  const quoted = /["“']([^"”']{2,120})["”']/.exec(line);
  const quote = (quoted?.[1] || '').toLowerCase();
  const quoteAt = quoted ? line.toLowerCase().indexOf(quote) : -1;
  const afterQuote = quoteAt >= 0 ? text.slice(quoteAt + quote.length) : '';
  const beforeQuote = quoteAt >= 0 ? text.slice(0, quoteAt) : '';
  const attribution = `${afterQuote} ${beforeQuote}`.trim() || text;
  const scored = bible!.characters.map((character) => {
    const tokens = characterNameTokens(character);
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
  if (!bible) return null;
  return bible.characters.find((item) => item.role === 'lead') || bible.characters[0] || null;
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
  const chars = bible.characters.map((item) => (
    `- ${item.id} ${item.name}（${item.role}，${item.ageBand}）：外形 ${item.look}；服装 ${item.wardrobe}${item.signature ? `；识别物 ${item.signature}` : ''}${item.sourceEvidence?.length ? `；文案依据「${item.sourceEvidence[0]}」` : ''}。外形必须落到体型、头型、主色、识别点，禁止只写物种名。禁止无故换脸、换发型、换装。`
  ));
  const locs = bible.locations.map((item) => (
    `- ${item.id} ${item.name}：${item.look}；时间 ${item.timeOfDay}`
  ));
  return [
    '【画面文法】叙事型：先服从圣经，再画这一拍的动作。',
    bible.logline ? `【一条线】${bible.logline}` : '',
    chars.length ? `【角色卡】\n${chars.join('\n')}` : '',
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
  // 纯 object 卡是「实物锁」，不是叙事班底，不参与同人推进。
  const cast = bibleHasNarrativeCast(bible) ? bible.characters : [];
  const lead = cast.find((item) => item.role === 'lead') || cast[0] || null;
  const support = cast.find((item) => item.role === 'support') || null;
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
    const spoken = shot.sliceText || shot.narration || '';
    const speaker = speakerCharacterFromLine(bible, spoken);
    const useSupport = isContrast && support;
    const characterIds = speaker
      ? [speaker.id]
      : (lead ? (useSupport ? [support!.id] : [lead.id]) : []);
    return {
      ...shot,
      characterIds,
      locationId: loc && characterIds.length && continuity !== 'contrast' ? loc.id : shot.locationId,
      continuity
    };
  });
}

export function applyOccupancyAfterCoverage(shots: ForecastShot[], bible?: VisualBible | null): ForecastShot[] {
  if (!bible) return shots;
  const cast = bibleHasNarrativeCast(bible) ? bible.characters : [];
  const lead = cast.find((item) => item.role === 'lead') || cast[0] || null;
  const support = cast.find((item) => item.role === 'support') || null;
  const validIds = new Set(cast.map((item) => item.id));
  return shots.map((shot, index) => {
    const prev = shots[index - 1];
    const contrast = shot.splitReason?.includes('对照') || shot.continuity === 'contrast' || shot.voRole === 'continue';
    let characterIds = Array.isArray(shot.characterIds)
      ? shot.characterIds.filter((id) => validIds.has(id))
      : [];
    const spoken = shot.sliceText || shot.narration || '';
    const speaker = speakerCharacterFromLine(bible, spoken);
    const dialogue = isQuotedDialogueLine(spoken);
    if (shot.coverageJob === 'insert' && !dialogue) {
      characterIds = [];
    } else if (speaker) {
      characterIds = [speaker.id];
    } else if (!characterIds.length && lead) {
      if (shot.coverageJob === 'hook' || shot.coverageJob === 'establish' || shot.coverageJob === 'callback' || shot.function === 'cta') {
        characterIds = [lead.id];
      } else if (contrast && support) {
        characterIds = [support.id];
      }
    }
    if (
      prev
      && characterIds.length
      && (prev.characterIds || []).length
      && characterIds[0] !== prev.characterIds![0]
      && shot.coverageJob !== 'contrast'
      && !contrast
      && !speaker
    ) {
      characterIds = prev.characterIds || [];
    }
    const loc = bible.locations[0] || null;
    return {
      ...shot,
      characterIds,
      locationId: loc && characterIds.length && shot.continuity !== 'contrast' ? loc.id : (characterIds.length ? shot.locationId : undefined)
    };
  });
}

export function composeShotVisualIntent(shot: ForecastShot, bible?: VisualBible | null): string {
  const action = stripBiblePrefix(shot.visualIntent || shot.sliceText || shot.narration || '');
  if (!bible) return action;
  if (bible.mode === 'expository' && !bibleHasNarrativeCast(bible)) {
    return action;
  }
  const hasExplicitCharacterSelection = Array.isArray(shot.characterIds);
  const char = hasExplicitCharacterSelection
    ? bible.characters.find((item) => shot.characterIds?.includes(item.id))
    : leadCharacter(bible);
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
  return `CHARACTER LOCK — same ${kind} "${character.name}": ${character.look}, wearing ${character.wardrobe}${signature}. Same face, body proportions, colors, and outfit in every frame.`;
}

export function resolveShotCharacter(
  bible: VisualBible | null | undefined,
  clip: { coverageJob?: string; characterIds?: string[] },
  spoken = ''
): VisualCharacter | null {
  if (!bible) return null;
  if (clip.coverageJob === 'insert' && (!clip.characterIds || clip.characterIds.length === 0)) return null;
  const speaker = speakerCharacterFromLine(bible, spoken);
  const hasExplicitCharacterSelection = Array.isArray(clip.characterIds);
  const char = speaker
    || (hasExplicitCharacterSelection
      ? bible.characters.find((item) => clip.characterIds!.includes(item.id))
      : (bible.mode === 'expository' && !bible.characters.length ? null : leadCharacter(bible)));
  return char || null;
}

export function shotCharacterLockEnglish(
  bible: VisualBible | null | undefined,
  clip: { coverageJob?: string; characterIds?: string[] },
  spoken = ''
): string {
  if (!bible) return '';
  if (bible.mode === 'expository' && !bibleHasNarrativeCast(bible)) {
    const objects = (Array.isArray(clip.characterIds)
      ? bible.characters.filter((item) => clip.characterIds!.includes(item.id) && item.kind === 'object')
      : bible.characters.filter((item) => item.kind === 'object')
    );
    return objects.map((item) => characterIdentityEnglish(item)).join(' ');
  }
  const char = resolveShotCharacter(bible, clip, spoken);
  if (!char) return '';
  if (char.kind === 'object' && bible.mode === 'expository') return characterIdentityEnglish(char);
  return characterIdentityEnglish(char);
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
  return {
    ...bible,
    characters: bible.characters.map((item) => (
      item.id === characterId ? { ...item, locked: !item.locked } : item
    ))
  };
}

export function updateCharacterField(
  bible: VisualBible,
  characterId: string,
  patch: Partial<Pick<VisualCharacter, 'name' | 'look' | 'wardrobe' | 'ageBand' | 'signature'>>
): VisualBible {
  return {
    ...bible,
    characters: bible.characters.map((item) => (
      item.id === characterId ? { ...item, ...patch } : item
    ))
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
  // 无叙事班底（空卡或仅 object 实物锁）：按说明型措辞展示。
  if (!bibleHasNarrativeCast(bible)) {
    const objects = bible.characters.filter((item) => item.kind === 'object').map((item) => item.name).filter(Boolean);
    if (objects.length) return `锁实物：${objects.join('、')}`;
    const lock = bible.continuityRule || bible.paletteLock || '';
    return lock ? `图解 · ${lock}` : '纯图解：锁色板，不编主角';
  }
  const names = bible.characters.map((item) => item.name).filter(Boolean);
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
  return {
    ...bible,
    characters: bible.characters.map((item) => (
      item.id === characterId
        ? { ...item, refs: [ref] }
        : item
    ))
  };
}

export function clearCharacterRef(bible: VisualBible, characterId: string): VisualBible {
  return {
    ...bible,
    characters: bible.characters.map((item) => (
      item.id === characterId ? { ...item, refs: [] } : item
    ))
  };
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
  if (!bibleHasCast(bible)) return false;
  const lead = leadCharacter(bible);
  return Boolean(lead && !characterHasRef(lead));
}
