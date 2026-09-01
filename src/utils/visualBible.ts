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
  return {
    version: 1,
    mode: 'story',
    logline: cleanText(opts.title) || '同一个人把这件事走完',
    paletteLock: '全片同一时段、同一色温',
    characters: [{
      id: 'char-lead',
      name: '主角',
      role: 'lead',
      ageBand: '成年',
      look: '可被连续认出的同一张脸和发型，全片不改五官',
      wardrobe: '全片不换装',
      locked: false,
      refs: []
    }],
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
    generatedAt: Date.now()
  };
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
    `- ${item.id} ${item.name}（${item.role}，${item.ageBand}）：外形 ${item.look}；服装 ${item.wardrobe}${item.signature ? `；识别物 ${item.signature}` : ''}。禁止无故换脸、换发型、换装。`
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
  const char = bible.characters.find((item) => shot.characterIds?.includes(item.id)) || leadCharacter(bible);
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
  const chars = (characterIds?.length
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
  if (characterIds?.length) {
    const hit = bible.characters.find((item) => characterIds.includes(item.id));
    if (hit) return hit;
  }
  return leadCharacter(bible);
}

export function storyLeadMissingRef(bible?: VisualBible | null): boolean {
  if (!bible || bible.mode !== 'story') return false;
  const lead = leadCharacter(bible);
  return Boolean(lead && !characterHasRef(lead));
}
