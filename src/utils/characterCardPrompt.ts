import { VisualCharacter } from '../types';

/**
 * 角色卡“身份锚参考图”的提示词构建：走中性棚拍路线，
 * 只负责把一张干净可锁的角色参考图交给画面圣经，不携带美术世界介质/调色
 * （美术风格在每一镜生图时才由 clip prompt 加回，避免背景/渲染污染分镜）。
 */

export type CharacterCardVariant = 'face' | 'sheet';

export interface CharacterCardPromptOutput {
  prompt: string;
  aspectRatio: '1:1' | '9:16';
  refKind: 'face' | 'sheet';
}

export const CHARACTER_CARD_VARIANTS: { id: CharacterCardVariant; label: string; hint: string }[] = [
  { id: 'face', label: '半身正脸', hint: '锁脸为主，1:1' },
  { id: 'sheet', label: '全身正面', hint: '锁服装体型，9:16' }
];

/** 只有可上镜叙事的人/拟人动物才提供自动参考图；object（实物/道具）走 paletteLock 或手动实物图。 */
export function shouldOfferAutoCard(character: VisualCharacter | null | undefined): boolean {
  return character?.kind === 'person' || character?.kind === 'creature';
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function subjectKind(character: VisualCharacter): string {
  if (character.kind === 'creature') return 'an anthropomorphic creature';
  return 'a character';
}

function appearanceFields(character: VisualCharacter): string[] {
  const parts: string[] = [];
  const look = clean(character.look);
  const wardrobe = clean(character.wardrobe);
  const signature = clean(character.signature);
  const age = clean(character.ageBand);
  const ageNote = age && age !== '成年' && age !== '文案未明确年龄' && !age.includes('成年（')
    ? `Age description: ${age}.`
    : '';
  if (look) parts.push(`Face and body: ${look}.`);
  if (wardrobe) parts.push(`Clothing (fixed outfit, do not change): ${wardrobe}.`);
  if (signature) parts.push(`Recognizable signature detail that must stay consistent: ${signature}.`);
  return [ageNote, ...parts].filter(Boolean);
}

function layoutFor(variant: CharacterCardVariant, character: VisualCharacter): string {
  const isCreature = character.kind === 'creature';
  if (variant === 'face') {
    return 'Front-facing head-and-shoulders portrait, the face centered and clearly readable, neutral calm expression, entire head and shoulders visible, no hands covering the face.';
  }
  const base = isCreature
    ? 'Full-body front view of the creature standing upright, complete body visible from head to feet.'
    : 'Full-body standing pose facing the camera, complete figure visible from head to feet so the entire outfit reads clearly.';
  return `${base} Arms relaxed at the sides or lightly posed, nothing cropped.`;
}

export function buildCharacterCardPromptFor(
  character: VisualCharacter,
  variant: CharacterCardVariant
): CharacterCardPromptOutput {
  const name = clean(character.name) || 'the character';
  const kindLabel = subjectKind(character);
  const fields = appearanceFields(character).join(' ');
  const layout = layoutFor(variant, character);
  const aspectRatio: '1:1' | '9:16' = variant === 'face' ? '1:1' : '9:16';
  const refKind: 'face' | 'sheet' = variant;

  const prompt = [
    `Clean neutral character reference image of ${kindLabel} named "${name}". ${fields}`,
    layout,
    'Background: plain light-gray seamless studio backdrop, soft even lighting, subject centered, sharp focus, high clarity.',
    'Constraints: single subject only, no other people, no readable text, no watermark, no logo, no distracting props, no clothing brand marks, do not add speech bubbles.'
  ].join(' ');

  return { prompt, aspectRatio, refKind };
}
