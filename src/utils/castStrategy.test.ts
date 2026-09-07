import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCastCandidates, looksLikeFragmentPersonName } from './castCandidates';
import { fallbackVisualBible } from './visualBible';
import { deriveCastDecision } from './castStrategy';
import { needsScriptAnalysis, parseScriptAnalysis } from './scriptAnalysis';

test('「只为找」这类口播片段不再被挖成人名', () => {
  const narrations = [
    '他走遍全城，只为找到那家老店。',
    '他深夜写信，只为找到你留下的地址。',
    '他加班到凌晨，只为找到那个 bug 的根源。'
  ];
  for (const narration of narrations) {
    const candidates = extractCastCandidates({ narration, title: '寻店', intentNotes: '' });
    const names = candidates.map((item) => item.name);
    assert.equal(names.some((name) => name.includes('只为找')), false, `出现误卡：${names.join(',')}`);
    assert.equal(names.some((name) => name.includes('遍全城') || name.includes('路打听')), false);
    for (const item of candidates) {
      assert.equal(looksLikeFragmentPersonName(item.name), false, `候选「${item.name}」本身像碎片`);
    }
  }
});

test('回归：整段“走遍全城，只为找到…”成不了角色卡', () => {
  const narration = '他走遍全城，只为找到那家老店。';
  const bible = fallbackVisualBible({ narration, genre: '故事' });
  assert.equal(bible.characters.some((card) => card.name === '只为找'), false, '「只为找」不应成为角色卡');
  assert.equal(bible.characters.some((card) => card.name === '遍全城'), false);
});

test('真正具名的人物仍能建卡', () => {
  const narration = '王小明和李小红走进教室，王小明坐下，李小红打开课本。';
  const candidates = extractCastCandidates({ narration, title: '开学', intentNotes: '' });
  const names = candidates.map((item) => item.name);
  assert.ok(names.includes('王小明'), `缺少王小明：${names.join(',')}`);
  assert.ok(names.includes('李小红'), `缺少李小红：${names.join(',')}`);
  assert.ok(names.every((name) => name.length >= 2));

  const bible = fallbackVisualBible({ narration, genre: '故事', title: '开学', candidates });
  const cardNames = bible.characters.map((item) => item.name);
  assert.ok(cardNames.includes('王小明'), `故事卡缺少王小明：${cardNames.join(',')}`);
  assert.ok(cardNames.includes('李小红'));
  assert.ok(cardNames.every((name) => !name.includes('只为')));
});

test('looksLikeFragmentPersonName 判定', () => {
  assert.equal(looksLikeFragmentPersonName('只为找'), true);
  assert.equal(looksLikeFragmentPersonName('遍全城'), true);
  assert.equal(looksLikeFragmentPersonName('到深夜'), true);
  assert.equal(looksLikeFragmentPersonName('王小明'), false);
  assert.equal(looksLikeFragmentPersonName('小美'), false);
  assert.equal(looksLikeFragmentPersonName('阿强'), false);
});

test('决策层：拟人/叙事/产品/讲解员分别落到正确策略', () => {
  const narrative = parseScriptAnalysis({
    schema_version: 1,
    content_type: 'narrative_story',
    narrative_perspective: 'third_person',
    has_dialogue: true,
    has_narrative_arc: true,
    personification_detected: false,
    visual_density: 'concrete_visual',
    confidence: 0.9,
    entities: [
      { name: '许野', type: 'person', is_named: true, recurs_throughout: true, evidence: ['许野推开老店的木门。'] }
    ]
  });
  const narrativeDecision = deriveCastDecision(narrative, '故事');
  assert.equal(narrativeDecision.hasCast, true);
  assert.equal(narrativeDecision.allowed.some((item) => item.name === '许野'), true);

  const personify = parseScriptAnalysis({
    schema_version: 1,
    content_type: 'science_explainer',
    narrative_perspective: 'none',
    has_dialogue: false,
    has_narrative_arc: false,
    personification_detected: true,
    visual_density: 'mixed',
    confidence: 0.8,
    entities: [
      { name: '细胞小兵', type: 'anthropomorphized', is_named: true, recurs_throughout: true, evidence: ['免疫细胞像小兵一样去战斗。'] }
    ]
  });
  const personifyDecision = deriveCastDecision(personify, '科普');
  assert.equal(personifyDecision.hasCast, true);
  assert.equal(personifyDecision.presentation, 'character_driven');

  const product = parseScriptAnalysis({
    schema_version: 1,
    content_type: 'product_ad',
    narrative_perspective: 'none',
    has_dialogue: false,
    has_narrative_arc: false,
    personification_detected: false,
    visual_density: 'concrete_visual',
    confidence: 0.85,
    entities: [
      { name: '榨汁机', type: 'product', is_named: true, recurs_throughout: true, evidence: ['这台榨汁机三个小时出汁。'] }
    ]
  });
  const productDecision = deriveCastDecision(product, '带货');
  assert.equal(productDecision.hasCast, false);
  assert.equal(productDecision.presentation, 'product_showcase');

  const lecturer = parseScriptAnalysis({
    schema_version: 1,
    content_type: 'tutorial',
    narrative_perspective: 'first_person',
    has_dialogue: false,
    has_narrative_arc: false,
    personification_detected: false,
    visual_density: 'concrete_visual',
    confidence: 0.8,
    entities: [
      { name: '我', type: 'occupation', is_named: false, recurs_throughout: true, evidence: ['我带你看一遍。'] }
    ]
  });
  assert.equal(deriveCastDecision(lecturer, '教程').presentation, 'narrator_led');
});

test('触发判定：强挖掘命中不触发分析，故事缺名触发，纯说明不触发', () => {
  const strong = extractCastCandidates({ narration: '王小明和李小红走进教室，王小明坐下，李小红打开课本。' });
  assert.equal(needsScriptAnalysis({
    mode: 'story',
    hasNarrativeSignal: true,
    hasPersonReference: true,
    candidates: strong
  }), false);

  assert.equal(needsScriptAnalysis({
    mode: 'story',
    hasNarrativeSignal: true,
    hasPersonReference: true,
    candidates: []
  }), true);

  assert.equal(needsScriptAnalysis({
    mode: 'expository',
    hasNarrativeSignal: false,
    hasPersonReference: true,
    candidates: []
  }), false);
});
