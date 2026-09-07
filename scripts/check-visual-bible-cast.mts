import assert from 'node:assert/strict';
import { extractCastCandidates } from '../src/utils/castCandidates.ts';
import {
  fallbackVisualBible,
  groundVisualBible,
  normalizeVisualBible
} from '../src/utils/visualBible.ts';

const narration = `许野和苏黎在亚马逊丛林迷了路。指南针不停打转，最后指向一只戴草帽的巨嘴鸟。巨嘴鸟清了清嗓子，说：“想出去，先交出你们最没用的东西。”

许野掏出没信号的手机，苏黎递上一支断掉的口红。巨嘴鸟摇头：“不够没用。”

夜里，他们被一群猴子请去参加婚礼，新郎是一条穿西装的森蚺，新娘竟是一台会唱歌的榨汁机。许野喝了一口婚宴果汁，突然长出满脸绿叶；苏黎打了个喷嚏，变成半人高的蘑菇。

第二天，巨嘴鸟终于飞来，说出口就在瀑布后面。两人冲进去，却发现瀑布后是一家便利店。收银员是那条森蚺，它扫着条码问：“袋子要吗？”

苏黎看着许野头上的叶子，平静地说：“不要，我们已经够环保了。”`;

const candidates = extractCastCandidates({ narration, title: '丛林便利店' });
const names = candidates.map((item) => item.name);

assert.ok(names.includes('许野'), `missing 许野 in ${names.join(',')}`);
assert.ok(names.includes('苏黎'), `missing 苏黎 in ${names.join(',')}`);
assert.ok(names.includes('巨嘴鸟'), `missing 巨嘴鸟 in ${names.join(',')}`);
assert.ok(!names.includes('马'), `false positive 马 from 亚马逊 in ${names.join(',')}`);
assert.ok(!names.includes('平静地'), `false positive 平静地 in ${names.join(',')}`);
assert.equal(candidates.find((item) => item.name === '许野')?.kind, 'person');
assert.equal(candidates.find((item) => item.name === '苏黎')?.kind, 'person');
assert.equal(candidates.find((item) => item.name === '巨嘴鸟')?.kind, 'creature');
assert.ok(names.indexOf('许野') < names.indexOf('巨嘴鸟'), 'people should rank before speaking creatures');
assert.ok(names.indexOf('苏黎') < names.indexOf('巨嘴鸟'), 'people should rank before speaking creatures');

const fallback = fallbackVisualBible({
  narration,
  genre: '故事',
  title: '丛林便利店',
  candidates
});
const fallbackPeople = fallback.characters.filter((item) => item.kind === 'person');
const fallbackToucan = fallback.characters.find((item) => item.name === '巨嘴鸟');
assert.ok(fallbackPeople.some((item) => item.name === '许野' && item.role === 'lead'));
assert.ok(fallbackPeople.some((item) => item.name === '苏黎' && item.role === 'lead'));
assert.ok(fallbackToucan);
assert.equal(fallbackToucan?.role, 'support');
assert.equal(fallbackToucan?.kind, 'creature');

const modelOnlyToucan = normalizeVisualBible({
  mode: 'story',
  logline: '丛林求生',
  paletteLock: '绿与暖黄',
  characters: [
    {
      id: 'char-lead',
      name: '巨嘴鸟',
      role: 'lead',
      kind: 'creature',
      candidateId: candidates.find((item) => item.name === '巨嘴鸟')?.id,
      ageBand: '不适用',
      look: '戴草帽的巨嘴鸟',
      wardrobe: '草帽',
      signature: '草帽',
      sourceEvidence: ['一只戴草帽的巨嘴鸟'],
      locked: false,
      refs: []
    }
  ],
  locations: [],
  motif: null,
  continuityRule: '同一主体推进'
}, 'story');

assert.ok(modelOnlyToucan);
const groundedBad = groundVisualBible(modelOnlyToucan!, narration, {
  title: '丛林便利店',
  candidates
});
assert.ok(groundedBad.characters.some((item) => item.name === '许野'));
assert.ok(groundedBad.characters.some((item) => item.name === '苏黎'));

const modelPeople = normalizeVisualBible({
  mode: 'story',
  logline: '丛林求生',
  paletteLock: '绿与暖黄',
  characters: [
    {
      id: 'char-lead',
      name: '许野',
      role: 'lead',
      kind: 'person',
      ageBand: '成年',
      look: '男性，短发',
      wardrobe: '探险服',
      signature: '没信号手机',
      sourceEvidence: ['许野掏出没信号的手机'],
      locked: false,
      refs: []
    },
    {
      id: 'char-2',
      name: '苏黎',
      role: 'lead',
      kind: 'person',
      ageBand: '成年',
      look: '女性，短发',
      wardrobe: '探险服',
      signature: '断掉的口红',
      sourceEvidence: ['苏黎递上一支断掉的口红'],
      locked: false,
      refs: []
    },
    {
      id: 'char-3',
      name: '巨嘴鸟',
      role: 'support',
      kind: 'creature',
      ageBand: '不适用',
      look: '戴草帽的巨嘴鸟',
      wardrobe: '草帽',
      signature: '草帽',
      sourceEvidence: ['一只戴草帽的巨嘴鸟'],
      locked: false,
      refs: []
    }
  ],
  locations: [],
  motif: null,
  continuityRule: '同一主体推进'
}, 'story');

assert.ok(modelPeople);
const groundedGood = groundVisualBible(modelPeople!, narration, {
  title: '丛林便利店',
  candidates: candidates.filter((item) => item.name === '巨嘴鸟')
});
assert.ok(groundedGood.characters.some((item) => item.name === '许野'));
assert.ok(groundedGood.characters.some((item) => item.name === '苏黎'));
assert.ok(groundedGood.characters.some((item) => item.name === '巨嘴鸟' && item.role === 'support'));

console.log('check-visual-bible-cast: ok');
console.log(JSON.stringify({
  candidates: candidates.map((item) => `${item.name}:${item.kind}:${item.mentions}`),
  fallback: fallback.characters.map((item) => `${item.name}:${item.role}:${item.kind}`)
}, null, 2));
