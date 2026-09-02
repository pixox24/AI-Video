import {
  BeatFunction,
  ForecastShot,
  ScriptGenre,
  VisualBible,
  VisualBibleMode,
  VisualCharacter,
  VisualCharacterRef,
  VisualContinuity,
  VisualLocation,
  VisualMotif
} from '../types';

export const STORY_BIBLE_GENRES: ScriptGenre[] = ['故事', '情绪'];

const BIBLE_PREFIX = /^(?:【[^】]{1,16}】[^。\n]*。[ \t]*)+/;

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

export function narrativeEntityContract(narration: string): string {
  const hints = extractNarrativeCharacterHints(narration);
  if (!hints.hasPerson) {
    return '【文案实体硬约束】未识别到明确人物。characters 必须输出 []，不得新增女孩、男孩、学生或其他主角。';
  }
  const facts = [
    hints.names.length ? `人物名：${hints.names.join('、')}` : '',
    hints.gender !== 'unknown' ? `性别线索：${hints.gender === 'male' ? '男性' : '女性'}` : '性别线索：未明确，不得擅自猜测',
    hints.ageBand ? `年龄线索：${hints.ageBand}` : '',
    hints.occupations.length ? `身份/职业：${hints.occupations.join('、')}` : '',
    hints.evidence.length ? `原文证据：${hints.evidence.map((item) => `「${item}」`).join('；')}` : ''
  ].filter(Boolean);
  return [
    '【文案实体硬约束】角色只能对应以下文案实体，不得凭空新增人物。',
    ...facts,
    '若角色卡无法给出对应原文证据，characters 输出 []。sourceEvidence 必须填写原文短句。'
  ].join('\n');
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
  const look = cleanText(raw?.look);
  const wardrobe = cleanText(raw?.wardrobe);
  if (!name && !look && !wardrobe) return null;
  const role = raw?.role === 'support' || raw?.role === 'extra' ? raw.role : 'lead';
  return {
    id: cleanText(raw?.id, role === 'lead' ? 'char-lead' : `char-${index + 1}`),
    name: name || (role === 'lead' ? '主角' : `角色${index + 1}`),
    role,
    ageBand: cleanText(raw?.ageBand, '成年'),
    look: look || '可被连续认出的外形，全片不换发型',
    wardrobe: wardrobe || '全片不换装',
    signature: cleanText(raw?.signature) || undefined,
    sourceEvidence: asStringArray(raw?.sourceEvidence || raw?.evidence).slice(0, 4),
    confidence: Number.isFinite(Number(raw?.confidence))
      ? Math.max(0, Math.min(1, Number(raw.confidence)))
      : undefined,
    locked: Boolean(raw?.locked),
    refs: normalizeRefs(raw?.refs),
    seedHint: cleanText(raw?.seedHint) || undefined
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
}): VisualBible {
  const mode = visualBibleModeForGenre(opts.genre);
  const hash = bibleSourceHash(opts.narration, opts.genre, mode);
  if (mode === 'expository') {
    return {
      ...emptyVisualBible(mode, hash),
      logline: cleanText(opts.title),
      paletteLock: '全片同一色温与材质，不要无故换滤镜',
      generatedAt: Date.now()
    };
  }
  const hints = extractNarrativeCharacterHints(opts.narration);
  const hasPerson = hints.hasPerson;
  const primaryName = hints.names[0] || '文案人物';
  const evidence = hints.evidence.length ? hints.evidence : ['文案明确出现人物，但未给出更多外形信息'];
  return {
    version: 1,
    mode: 'story',
    logline: cleanText(opts.title) || '同一个人把这件事走完',
    paletteLock: '全片同一时段、同一色温',
    characters: hasPerson ? [{
      id: 'char-lead',
      name: primaryName,
      role: 'lead',
      ageBand: hints.ageBand || '文案未明确年龄',
      look: `${hints.gender === 'male' ? '男性' : hints.gender === 'female' ? '女性' : '性别不擅自推断'}，外形由用户确认；全片不改五官和发型`,
      wardrobe: hints.occupations.length ? `符合${hints.occupations[0]}身份的服装，全片不换装` : '符合文案身份的服装，全片不换装',
      sourceEvidence: evidence,
      confidence: 0.55,
      locked: false,
      refs: []
    }] : [],
    locations: [{
      id: 'loc-1',
      name: '主场景',
      look: '口播开始的那个空间，全片优先待在这里',
      timeOfDay: '同一时段',
      locked: false,
      refs: []
    }],
    motif: null,
    continuityRule: '同一人同一空间推进；对照才换主体；收束回收开场构图或物件',
    sourceHash: hash,
    validation: {
      status: 'warning',
      warnings: hasPerson ? ['模型未返回可验证角色，已使用文案保守角色卡'] : ['文案未识别到明确人物，未创建角色卡'],
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
  narration: string
): string[] {
  if (!bible || bible.mode !== 'story') return [];
  const hints = extractNarrativeCharacterHints(narration);
  const warnings: string[] = [];
  if (!hints.hasPerson && bible.characters.length > 0) {
    warnings.push('文案没有明确人物，但画面圣经创建了角色卡');
  }
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
  narration: string
): VisualBible {
  const warnings = validateVisualBibleAgainstNarration(bible, narration);
  if (warnings.length === 0) {
    return {
      ...bible,
      validation: { status: 'ok', warnings: [], checkedAt: Date.now() }
    };
  }
  const hardWarnings = warnings.filter((warning) => (
    /没有明确人物，但画面圣经创建了角色卡|出现男性线索，但角色卡包含女性|出现女性线索，但角色卡包含男性|年龄被写成成年/.test(warning)
  ));
  if (hardWarnings.length === 0) {
    const hints = extractNarrativeCharacterHints(narration);
    const enriched = {
      ...bible,
      characters: bible.characters.map((character) => {
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
  const hasUserLock = bible.pinned || bible.characters.some((item) => item.locked || item.refs.length > 0);
  if (hasUserLock) {
    return {
      ...bible,
      validation: { status: 'warning', warnings, checkedAt: Date.now() }
    };
  }
  const safe = fallbackVisualBible({ narration, genre: bible.mode === 'story' ? '故事' : null, title: bible.logline });
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
    return /没有明确人物，但画面圣经创建了角色卡|出现男性线索，但角色卡包含女性|出现女性线索，但角色卡包含男性|年龄被写成成年|人物「.+」没有出现在角色卡证据中|文案职业「.+」未进入角色卡/.test(warning);
  });
}

function carryCharacter(previous: VisualCharacter | undefined, incoming: VisualCharacter): VisualCharacter {
  if (!previous) return incoming;
  const refs = incoming.refs.length ? incoming.refs : previous.refs;
  const keepIdentity = previous.locked || refs.length > 0;
  return {
    ...incoming,
    refs,
    locked: incoming.locked || previous.locked || refs.length > 0,
    name: keepIdentity && previous.name ? previous.name : incoming.name,
    look: keepIdentity && previous.look ? previous.look : incoming.look,
    wardrobe: keepIdentity && previous.wardrobe ? previous.wardrobe : incoming.wardrobe,
    ageBand: keepIdentity && previous.ageBand ? previous.ageBand : incoming.ageBand,
    signature: keepIdentity ? (previous.signature || incoming.signature) : incoming.signature,
    sourceEvidence: incoming.sourceEvidence?.length ? incoming.sourceEvidence : previous.sourceEvidence,
    confidence: incoming.confidence ?? previous.confidence,
    seedHint: previous.seedHint || incoming.seedHint
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
    if (prev.locked || prev.refs.length > 0) characters.unshift(prev);
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

export function leadCharacter(bible?: VisualBible | null): VisualCharacter | null {
  if (!bible) return null;
  return bible.characters.find((item) => item.role === 'lead') || bible.characters[0] || null;
}

export function bibleContractForPrompt(bible?: VisualBible | null): string {
  if (!bible) return '';
  if (bible.mode === 'expository') {
    return [
      '【画面文法】说明型：允许按句图解，不要硬拍成一部戏。',
      bible.paletteLock ? `【色板锁定】${bible.paletteLock}` : '',
      bible.continuityRule ? `【连续】${bible.continuityRule}` : ''
    ].filter(Boolean).join('\n');
  }
  const chars = bible.characters.map((item) => (
    `- ${item.id} ${item.name}（${item.role}，${item.ageBand}）：外形 ${item.look}；服装 ${item.wardrobe}${item.signature ? `；识别物 ${item.signature}` : ''}${item.sourceEvidence?.length ? `；文案依据「${item.sourceEvidence[0]}」` : ''}。禁止无故换脸、换发型、换装。`
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
  return String(intent || '').replace(BIBLE_PREFIX, '').trim();
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
  const lead = leadCharacter(bible);
  const support = bible.characters.find((item) => item.role === 'support') || null;
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
    const useSupport = isContrast && support;
    const characterIds = bible.mode === 'story'
      ? (useSupport ? [support.id] : lead ? [lead.id] : [])
      : [];
    return {
      ...shot,
      characterIds,
      locationId: loc && bible.mode === 'story' && continuity !== 'contrast' ? loc.id : shot.locationId,
      continuity
    };
  });
}

export function composeShotVisualIntent(shot: ForecastShot, bible?: VisualBible | null): string {
  const action = stripBiblePrefix(shot.visualIntent || shot.sliceText || shot.narration || '');
  if (!bible) return action;
  if (bible.mode === 'expository') {
    return action;
  }
  const hasExplicitCharacterSelection = Array.isArray(shot.characterIds);
  const char = hasExplicitCharacterSelection
    ? bible.characters.find((item) => shot.characterIds?.includes(item.id))
    : leadCharacter(bible);
  const loc = bible.locations.find((item) => item.id === shot.locationId) || bible.locations[0];
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

export function characterLockEnglish(bible?: VisualBible | null, characterIds?: string[]): string {
  if (!bible || bible.mode !== 'story' || bible.characters.length === 0) {
    return bible?.paletteLock ? `Keep a consistent color grade: ${bible.paletteLock}.` : '';
  }
  const chars = (Array.isArray(characterIds)
    ? bible.characters.filter((item) => characterIds.includes(item.id))
    : [leadCharacter(bible)]
  ).filter((item): item is VisualCharacter => Boolean(item));
  const lines = chars.map((item) => (
    `same character identity "${item.name}": ${item.look}, wearing ${item.wardrobe}. Do not change face, hair, age, or clothes.`
  ));
  if (bible.locations[0]) {
    lines.push(`same location "${bible.locations[0].name}": ${bible.locations[0].look}, ${bible.locations[0].timeOfDay}.`);
  }
  return lines.join(' ');
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
  if (bible.mode === 'expository') return bible.paletteLock || '说明型：按句图解，锁色板';
  const char = leadCharacter(bible);
  const loc = bible.locations[0];
  return [char ? char.name : '', loc ? loc.name : '', bible.motif?.name]
    .filter(Boolean)
    .join(' · ') || bible.logline || '叙事圣经';
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
        ? { ...item, refs: [ref], locked: true }
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
  if (!bible || bible.mode !== 'story') return null;
  if (Array.isArray(characterIds)) {
    return bible.characters.find((item) => characterIds.includes(item.id)) || null;
  }
  return leadCharacter(bible);
}

export function storyLeadMissingRef(bible?: VisualBible | null): boolean {
  if (!bible || bible.mode !== 'story') return false;
  const lead = leadCharacter(bible);
  return Boolean(lead && !characterHasRef(lead));
}
