import {
  AspectRatio,
  CustomImageApiConfig,
  ScriptGenre,
  StoryboardClip,
  StylePack,
  VisualBeat,
  VisualBible
} from '../types';
import { clipShotNarration } from './narrationTrack';
import { styleDetailsForShot, usesStyleDna } from './stylePack';
import {
  bibleHasNarrativeCast,
  characterHasRef,
  isQuotedDialogueLine,
  leadCharacter,
  resolveShotCharacter,
  shotCharacterLockEnglish,
  speakerCharacterFromLine,
  stripBiblePrefix
} from './visualBible';
import { coverageFramingLine } from './shotCoverage';

export type ImagePromptProfile = 'gpt-image';

export type ImagePromptClip = Pick<
  StoryboardClip,
  | 'narration'
  | 'voSlice'
  | 'visualPrompt'
  | 'visualBibleHash'
  | 'chineseVisualPrompt'
  | 'visualBeat'
  | 'promptPinned'
  | 'characterIds'
  | 'locationId'
  | 'continuity'
  | 'cameraMotion'
  | 'order'
  | 'shotSize'
  | 'cameraAngle'
  | 'shotComposition'
  | 'coverageJob'
>;

const BEAT_HINTS: { test: RegExp; setting: string; subject: string; action: string }[] = [
  {
    test: /眼|干涩|护眼|头疼|头痛|手机|屏幕/,
    setting: '黑暗室内，唯一光源是手机屏幕的冷白光',
    subject: '一双因盯屏幕而干涩发红的眼睛，眼睑被光切开',
    action: '近看发亮的手机，没有出现任何字幕'
  },
  {
    test: /细胞|基因|DNA|病毒|细菌|显微镜/,
    setting: '深色科学示意空间，没有界面文字',
    subject: '被点亮的微观结构（细胞或病原体）',
    action: '结构正在发生口播所说的变化'
  },
  {
    test: /地球|宇宙|星球|深空|星系/,
    setting: '深空，远处有微弱星光',
    subject: '口播里的那颗星球或天体',
    action: '缓慢穿过画面，尺度要清楚'
  },
  {
    test: /钱|消费|欲望|冲动|购买/,
    setting: '被压暗的当代室内或橱窗',
    subject: '一只伸向亮着的屏幕或货架的手',
    action: '动作停在即将点下的瞬间'
  }
];

export function resolveImagePromptProfile(
  model?: string,
  override?: CustomImageApiConfig['promptProfile']
): ImagePromptProfile {
  if (override === 'gpt-image') return override;
  return 'gpt-image';
}

function compact(text: string): string {
  return (text || '').replace(/\s+/g, '').replace(/[。！？.!?…，,、]/g, '');
}

export function looksLikeSpokenLine(scene: string, spoken: string): boolean {
  const a = compact(scene);
  const b = compact(spoken);
  if (!a) return true;
  if (!b) return false;
  if (a === b) return true;
  if (b.includes(a) && a.length >= 6) return true;
  if (a.includes(b) && b.length >= 6) return true;
  return false;
}

function beatFromHint(spoken: string): VisualBeat | null {
  const hit = BEAT_HINTS.find((item) => item.test.test(spoken));
  return hit ? { setting: hit.setting, subject: hit.subject, action: hit.action } : null;
}

function beatFromProse(scene: string): VisualBeat {
  const cleaned = stripBiblePrefix(scene).replace(/^画面表现[：:]/, '').trim();
  if (!cleaned) return {};
  const parts = cleaned.split(/[。；;]/).map((item) => item.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return { setting: parts[0], subject: parts[1], action: parts.slice(2).join('，') };
  }
  if (parts.length === 2) {
    return { setting: parts[0], subject: parts[1] };
  }
  return { subject: cleaned };
}

export function resolveVisualBeat(clip: ImagePromptClip): VisualBeat {
  if (clip.visualBeat && (clip.visualBeat.subject || clip.visualBeat.setting || clip.visualBeat.action)) {
    return clip.visualBeat;
  }
  const spoken = clipShotNarration(clip) || clip.narration || '';
  const scene = stripBiblePrefix(
    (clip.chineseVisualPrompt || '').trim() || (clip.visualPrompt || '').trim()
  );
  const looksLikeDna = /Transfer only the visual system|Keep a consistent color grade|color palette|Impasto|Charcoal Sketch/i.test(scene);
  if (scene && !looksLikeDna) {
    if (!looksLikeSpokenLine(scene, spoken) || scene.length > Math.max(24, spoken.length * 0.8)) {
      return beatFromProse(scene);
    }
  }
  const hinted = beatFromHint(spoken || scene);
  if (hinted) return hinted;
  if (scene && !looksLikeDna) {
    return { action: scene };
  }
  if (spoken) {
    return {
      action: spoken.replace(/[。！？!?]+$/g, '')
    };
  }
  return { subject: scene || '一个清楚的主体' };
}

function looksLikeLocationLock(text: string | undefined): boolean {
  const value = String(text || '').trim();
  return /^【/.test(value)
    || /^同一空间/.test(value)
    || /^同一人/.test(value)
    || /CHARACTER LOCK|OBJECT LOCK|same character identity/i.test(value)
    || /拟人化的|全片保持同一外形|全片不换装/.test(value);
}

const LOCK_STOP = /^(the|and|with|from|that|this|same|into|onto|over|under|for|its|his|her|a|an|of|in|on|to|as|if|or)$/i;

function overlapsLock(text: string | undefined, lock: string): boolean {
  const a = compact(text);
  const b = compact(lock);
  if (!a || !b) return false;
  if (a === b) return true;
  if (b.includes(a) && a.length >= 8) return true;
  if (a.includes(b) && b.length >= 8) return true;
  const tokens = String(text || '')
    .split(/[，,；;。.\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && !LOCK_STOP.test(item));
  return tokens.filter((token) => lock.toLowerCase().includes(token.toLowerCase())).length >= 2;
}

function looksLikeSettingProse(text: string | undefined): boolean {
  const value = String(text || '');
  if (!value) return false;
  if (/张嘴|开口|吸气|唱歌|lean|forming|mouth|sound-seed|glowing seed/i.test(value)) return false;
  return /森林|室内|空间|街道|房间|树叶|植被|蘑菇|forest|landscape|honey-colored leaves|glowing forest|vegetation/i.test(value);
}

const WEAK_HOOK_ACTION = /张嘴|开口|想唱歌|尝试唱歌|open(s|ing)? (his|her|its)? mouth|mouth open|trying to sing|as if (to sing|trying)/i;

function isWeakHookAction(action: string | undefined, spoken: string): boolean {
  const value = String(action || '').trim();
  if (!value) return true;
  if (looksLikeSpokenLine(value, spoken) && value.length <= Math.max(24, spoken.length)) return true;
  if (WEAK_HOOK_ACTION.test(value) && !/glow|forming|尚未|未完成|未释放|lean/i.test(value)) return true;
  return value.length < 12;
}

function hookActionFallback(): string {
  return 'caught mid-action before the result: an unfinished visible change is forming, and the surrounding world is just beginning to respond; do not complete the event in this still';
}

function isGenericBeatText(text: string | undefined): boolean {
  const value = String(text || '').trim();
  return /干净的说明性画面|一个能看见的具体主体|一个清楚的主体|可被院线镜头拍到/.test(value);
}

function bibleCharacterLock(bible: VisualBible | null | undefined, clip: ImagePromptClip): string {
  const spoken = clipShotNarration(clip) || clip.narration || '';
  return shotCharacterLockEnglish(bible, clip, spoken);
}

function bibleLocationLock(bible: VisualBible | null | undefined, clip: ImagePromptClip): string {
  if (!bible || clip.continuity === 'contrast') return '';
  const loc = clip.locationId
    ? bible.locations.find((item) => item.id === clip.locationId)
    : null;
  if (!loc) return '';
  const motif = clip.continuity === 'callback' && bible.motif
    ? `回收看见${bible.motif.name}：${bible.motif.look}`
    : '';
  return [`同一空间「${loc.name}」：${loc.look}，${loc.timeOfDay}`, motif].filter(Boolean).join('；');
}

function constraintsFor(
  bible: VisualBible | null | undefined,
  pack: StylePack,
  clip: ImagePromptClip
): string[] {
  const hasCharacterRef = Boolean(characterHasRef(resolveShotCharacter(bible, clip, clipShotNarration(clip) || clip.narration || ''))
    || (bibleHasNarrativeCast(bible) && characterHasRef(leadCharacter(bible))));
  const hasStyleRef = Boolean(pack.reference?.imageId || pack.reference?.thumbDataUrl || pack.reference?.notes);
  const lines = [
    'No readable text, subtitles, logos, watermarks, signage, or letters',
    'Paint only this shot\'s own subject and space'
  ];
  if (hasCharacterRef) {
    lines.push('Image 1 is character-identity reference only: preserve face, body proportions, scale pattern, and fixed costume; do not copy its composition or background');
  } else {
    lines.push('If a character reference is attached, lock the same face and costume only; do not copy its composition or background');
  }
  if (hasStyleRef) {
    lines.push('Image 2 is style reference only: transfer medium, color harmony, texture, and lighting mood; do not copy people, clothing, props, composition, street, or background');
  } else {
    lines.push('Do not copy people, clothing, props, or streets from any style reference');
  }
  if (bible?.characters?.length && clip.continuity !== 'contrast' && bibleHasNarrativeCast(bible)) {
    lines.push('Do not change face, clothes, or room without a coverage reason');
  }
  if (bible?.mode === 'expository' || bible?.paletteLock) {
    lines.push('Keep the same palette and medium throughout the film; do not change the filter in this frame');
  }
  if (!usesStyleDna(pack) && pack.world?.dont?.length) {
    lines.push(`Do not include: ${pack.world.dont.slice(0, 3).join(', ')}`);
  }
  return lines;
}

function useLine(
  aspectRatio: AspectRatio | undefined,
  genre: ScriptGenre | string | null | undefined,
  clipIndex: number,
  clipCount: number
): string {
  const ratio = aspectRatio || '16:9';
  const frame = `frame ${clipIndex + 1} of ${Math.max(1, clipCount)}`;
  const kind = genre === '故事' || genre === '情绪' ? 'story short video' : (genre ? `${genre} short video` : 'short video');
  const beat = clipIndex === 0 ? 'hook' : '';
  return [ratio, kind, frame, beat].filter(Boolean).join(', ');
}

export function compileImagePrompt(input: {
  clip: ImagePromptClip;
  pack: StylePack;
  bible?: VisualBible | null;
  aspectRatio?: AspectRatio;
  genre?: ScriptGenre | string | null;
  clipIndex: number;
  clipCount: number;
  model?: string;
  promptProfile?: CustomImageApiConfig['promptProfile'];
}): { prompt: string; profile: ImagePromptProfile; beat: VisualBeat } {
  const profile = resolveImagePromptProfile(input.model, input.promptProfile);
  const bibleHashMatches = !input.bible || input.clip.visualBibleHash === input.bible.sourceHash;
  if (input.clip.promptPinned && bibleHashMatches && (input.clip.visualPrompt || '').trim().length > 8) {
    return { prompt: input.clip.visualPrompt!.trim(), profile, beat: resolveVisualBeat(input.clip) };
  }

  // A stale pinned prompt must not leak back through resolveVisualBeat's prose
  // fallback when the Bible has changed. Rebuild from narration/structured beat.
  const beat = resolveVisualBeat(bibleHashMatches
    ? input.clip
    : { ...input.clip, visualPrompt: '', chineseVisualPrompt: '', promptPinned: false });
  const spokenLine = clipShotNarration(input.clip) || input.clip.narration || '';
  const characterLock = bibleCharacterLock(input.bible, input.clip);
  const locationLock = bibleLocationLock(input.bible, input.clip);
  const framing = coverageFramingLine(input.clip);
  const settingExtra = looksLikeLocationLock(beat.setting)
    || isGenericBeatText(beat.setting)
    || overlapsLock(beat.setting, locationLock)
    || (Boolean(locationLock) && looksLikeSettingProse(beat.setting))
    ? ''
    : beat.setting;
  const worldSpace = usesStyleDna(input.pack) || isGenericBeatText(input.pack.world?.space)
    ? ''
    : input.pack.world?.space;
  const setting = [
    framing,
    locationLock,
    settingExtra,
    overlapsLock(worldSpace, locationLock) ? '' : worldSpace
  ].filter(Boolean).join('；');
  let subjectExtra = looksLikeLocationLock(beat.subject)
    || isGenericBeatText(beat.subject)
    || overlapsLock(beat.subject, characterLock)
    || (Boolean(locationLock) && looksLikeSettingProse(beat.subject))
    ? ''
    : beat.subject;
  let action = looksLikeLocationLock(beat.action)
    || (Boolean(locationLock) && looksLikeSettingProse(beat.action))
    ? ''
    : (beat.action || '');
  if (looksLikeSpokenLine(action, spokenLine) && action.length <= Math.max(24, spokenLine.length)) {
    action = '';
  }
  if (isQuotedDialogueLine(spokenLine) && speakerCharacterFromLine(input.bible, spokenLine)) {
    const speaker = speakerCharacterFromLine(input.bible, spokenLine);
    action = `${speaker!.name} is speaking this line: reacting in the moment, face and body leading. Do not make a dental close-up or object insert the main subject.`;
  } else if ((input.clip.coverageJob === 'hook' || input.clipIndex === 0) && isWeakHookAction(action, spokenLine)) {
    action = hookActionFallback();
    if (isWeakHookAction(subjectExtra, spokenLine) || looksLikeSettingProse(subjectExtra)) {
      subjectExtra = '';
    }
  }
  const subject = [characterLock.replace(/[.。]+$/g, ''), subjectExtra].filter(Boolean).join(' ');
  const details = styleDetailsForShot(input.pack, input.clip);
  const constraints = constraintsFor(input.bible, input.pack, input.clip);

  const prompt = [
    `Use: ${useLine(input.aspectRatio, input.genre, input.clipIndex, input.clipCount)}.`,
    `Scene: ${setting || '简单空间，为这个主体服务'}.`,
    `Subject: ${subject || 'a clear subject'}.${action ? ` ${action}.` : ''}`,
    `Details: ${details}.`,
    `Constraints: ${constraints.join('; ')}.`
  ].join('\n');

  return { prompt, profile, beat };
}

export function beatToChinese(beat: VisualBeat): string {
  return [beat.setting, beat.subject, beat.action].filter(Boolean).join('。');
}

/** First-clip gold: 护眼口播 + 说明型圣经 + 厚涂 DNA → Scene/Subject 是眼睛，不是口播原句。 */
export const GOLD_EYE_STRAIN_SPOKEN = '别等到眼睛又干又涩、看手机一会儿就头疼，才知道护眼有多重要。';

export function clipImagePromptArgs(
  clip: ImagePromptClip,
  index: number,
  total: number,
  pack: StylePack,
  bible: VisualBible | null | undefined,
  settings: { aspectRatio?: AspectRatio; customImageApi?: CustomImageApiConfig },
  genre?: ScriptGenre | string | null
) {
  return compileImagePrompt({
    clip,
    pack,
    bible,
    aspectRatio: settings.aspectRatio,
    genre,
    clipIndex: index,
    clipCount: total,
    model: settings.customImageApi?.model,
    promptProfile: settings.customImageApi?.promptProfile
  });
}
