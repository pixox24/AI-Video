import {
  AspectRatio,
  CustomImageApiConfig,
  ScriptGenre,
  StoryboardClip,
  StylePack,
  VisualBeat,
  VisualBible,
  VisualContinuity
} from '../types';
import { clipShotNarration } from './narrationTrack';
import { dnaTransferText, renderLine, usesStyleDna } from './stylePack';
import { leadCharacter, stripBiblePrefix } from './visualBible';
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
  if (scene && !looksLikeDna && !looksLikeSpokenLine(scene, spoken)) {
    return beatFromProse(scene);
  }
  const hinted = beatFromHint(spoken || scene);
  if (hinted) return hinted;
  if (spoken) {
    return {
      setting: '干净的说明性画面，没有字幕、没有界面文字',
      subject: '一个能看见的具体主体，用来图解这句口播，不要把台词写在画面上',
      action: spoken.replace(/[。！？!?]+$/g, '').slice(0, 24)
    };
  }
  return { subject: scene || '一个清楚的主体' };
}

function styleDetails(pack: StylePack): string {
  if (usesStyleDna(pack)) {
    return dnaTransferText(pack).replace(/;\s*/g, '; ');
  }
  return renderLine(pack);
}

function bibleSubjectLock(bible: VisualBible | null | undefined, clip: ImagePromptClip): string {
  if (!bible || bible.mode !== 'story') return '';
  // `undefined` means the shot has no explicit binding and may use the lead;
  // an explicit empty array means this shot intentionally contains no character.
  const hasExplicitCharacterSelection = Array.isArray(clip.characterIds);
  const char = hasExplicitCharacterSelection
    ? bible.characters.find((item) => clip.characterIds!.includes(item.id))
    : leadCharacter(bible);
  const loc = bible.locations.find((item) => item.id === clip.locationId) || bible.locations[0];
  const parts: string[] = [];
  if (char) {
    parts.push(`同一人「${char.name}」：${char.look}，${char.wardrobe}${char.signature ? `，带着${char.signature}` : ''}`);
  }
  if (loc && clip.continuity !== 'contrast') {
    parts.push(`同一空间「${loc.name}」：${loc.look}，${loc.timeOfDay}`);
  }
  if (clip.continuity === 'callback' && bible.motif) {
    parts.push(`回收看见${bible.motif.name}：${bible.motif.look}`);
  }
  return parts.join('；');
}

function constraintsFor(
  bible: VisualBible | null | undefined,
  pack: StylePack,
  continuity?: VisualContinuity
): string[] {
  const lines = [
    '画面上不要出现可读文字、字幕、Logo 或口播原句',
    '不要把风格参考图里的人物、服装、道具或街道画进来',
    '只画这一镜自己的主体和空间'
  ];
  if (bible?.mode === 'expository') {
    lines.push('全片用同一套色和介质，这一镜不要换滤镜');
  } else if (bible?.mode === 'story' && continuity !== 'contrast') {
    lines.push('不要无故换脸、换装、换房间');
  }
  if (!usesStyleDna(pack) && pack.world?.dont?.length) {
    lines.push(`不要出现：${pack.world.dont.slice(0, 3).join('、')}`);
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
  const kind = genre ? `${genre} short video` : 'short video';
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
  const identity = bibleSubjectLock(input.bible, input.clip);
  const framing = coverageFramingLine(input.clip);
  const setting = [framing, beat.setting, usesStyleDna(input.pack) ? '' : input.pack.world?.space]
    .filter(Boolean)
    .join('；');
  const subject = [identity, beat.subject].filter(Boolean).join('；');
  const details = styleDetails(input.pack);
  const constraints = constraintsFor(input.bible, input.pack, input.clip.continuity);

  const prompt = [
    `Use: ${useLine(input.aspectRatio, input.genre, input.clipIndex, input.clipCount)}.`,
    `Scene: ${setting || '简单空间，为这个主体服务'}。`,
    `Subject: ${subject || '一个清楚的主体'}。${beat.action ? ` ${beat.action}。` : ''}`,
    `Details: ${details}。`,
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
