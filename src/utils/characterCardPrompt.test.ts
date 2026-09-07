import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VisualCharacter } from '../types';
import {
  buildCharacterCardPromptFor,
  CHARACTER_CARD_VARIANTS,
  shouldOfferAutoCard
} from './characterCardPrompt';

function char(over: Partial<VisualCharacter>): VisualCharacter {
  return {
    id: 'char-1',
    name: '许野',
    role: 'lead',
    kind: 'person',
    ageBand: '成年',
    look: '利落短发，眼神平静，脸型偏方',
    wardrobe: '深灰风衣配黑裤',
    signature: '左肩一枚银色胸针',
    locked: false,
    refs: [],
    ...over
  } as VisualCharacter;
}

test('face / sheet 变体的尺寸与 refKind 正确', () => {
  const face = buildCharacterCardPromptFor(char({}), 'face');
  assert.equal(face.aspectRatio, '1:1');
  assert.equal(face.refKind, 'face');

  const sheet = buildCharacterCardPromptFor(char({ kind: 'creature', name: '细胞小兵' }), 'sheet');
  assert.equal(sheet.aspectRatio, '9:16');
  assert.equal(sheet.refKind, 'sheet');
  assert.match(sheet.prompt, /anthropomorphic creature/);
  assert.match(sheet.prompt, /full-body|feet/);
});

test('中性棚拍：注入外观字段、不注入美术介质词', () => {
  const character = char({
    look: '利落短发，眼神平静，脸型偏方',
    wardrobe: '深灰风衣配黑裤',
    signature: '左肩一枚银色胸针'
  });
  const out = buildCharacterCardPromptFor(character, 'face');
  assert.ok(out.prompt.includes('利落短发'));
  assert.ok(out.prompt.includes('深灰风衣'));
  assert.ok(out.prompt.includes('银色胸针'));
  assert.match(out.prompt, /seamless studio backdrop|studio backdrop/);
  assert.match(out.prompt, /no readable text/);
  assert.equal(/cinematic|anime|8k|photorealistic/i.test(out.prompt), false, '不应带美术介质词');
});

test('object / 空卡不提供 AI 自动参考图入口', () => {
  assert.equal(shouldOfferAutoCard(char({ kind: 'person' })), true);
  assert.equal(shouldOfferAutoCard(char({ kind: 'creature' })), true);
  assert.equal(shouldOfferAutoCard(char({ kind: 'object' })), false);
  assert.equal(shouldOfferAutoCard(null), false);
  assert.equal(CHARACTER_CARD_VARIANTS.length, 2);
});
