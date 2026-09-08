import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCastCandidates } from './castCandidates';
import { parseScriptAnalysis } from './scriptAnalysis';
import { deriveCastDecision, deriveCastDecisionFromLedger } from './castStrategy';
import { buildEntityLedger, UNKNOWN_AGE } from './scriptEntity';
import {
  applyOccupancyAfterCoverage,
  fallbackVisualBible,
  groundVisualBible,
  normalizeVisualBible,
  planShotOccupancy,
  previewBibleDiff,
  bibleHasNarrativeCast,
  bibleSubjects,
  toggleCharacterLockFlag
} from './visualBible';
import { ForecastShot } from '../types';

function shot(over: Partial<ForecastShot> & { narration: string }): ForecastShot {
  return {
    id: over.id || 's1',
    order: over.order || 1,
    start: 0,
    speechDuration: 2,
    holdDuration: 0,
    energy: 'medium',
    function: over.function || 'setup',
    visualIntent: '',
    narration: over.narration,
    splitReason: over.splitReason || '',
    sliceText: over.sliceText || over.narration,
    coverageJob: over.coverageJob,
    continuity: over.continuity,
    voRole: over.voRole,
    characterIds: over.characterIds
  };
}

test('P0 错配 ID：李小红不能挂上王小明的 candidateId', () => {
  const narration = '王小明走进教室。';
  const candidates = extractCastCandidates({ narration, title: '开学' });
  const wang = candidates.find((item) => item.name === '王小明');
  assert.ok(wang, '应抽出王小明');
  const raw = normalizeVisualBible({
    mode: 'story',
    logline: '开学',
    paletteLock: '日光',
    characters: [
      {
        id: 'char-lead',
        name: '李小红',
        role: 'lead',
        kind: 'person',
        candidateId: wang!.id,
        ageBand: '成年',
        look: '长发',
        wardrobe: '校服',
        sourceEvidence: ['王小明走进教室'],
        locked: false,
        refs: []
      },
      {
        id: 'char-lead',
        name: '王小明',
        role: 'lead',
        kind: 'person',
        candidateId: wang!.id,
        look: '',
        wardrobe: '',
        sourceEvidence: ['王小明走进教室'],
        locked: false,
        refs: []
      }
    ],
    locations: [],
    motif: null,
    continuityRule: '同一主体'
  }, 'story');
  assert.ok(raw);
  const ids = raw!.characters.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, 'normalize 后 ID 必须唯一');
  const grounded = groundVisualBible(raw!, narration, { title: '开学', candidates });
  assert.equal(grounded.characters.some((item) => item.name === '李小红'), false, '错配卡必须丢弃');
  assert.ok(grounded.characters.some((item) => item.name === '王小明'), '王小明应保留或从台账补回');
  assert.ok(grounded.validation?.warnings?.some((item) => /错配|丢弃/.test(item)), `应有错配警告，实际：${grounded.validation?.warnings?.join(' | ')}`);
  assert.equal(new Set(grounded.characters.map((item) => item.id)).size, grounded.characters.length);
});

test('P0 重复 ID：多个缺省 id 不得都变成 char-lead', () => {
  const bible = normalizeVisualBible({
    mode: 'story',
    characters: [
      { name: '王小明', role: 'lead', kind: 'person', look: '短发', wardrobe: '校服', sourceEvidence: ['王小明走进教室'] },
      { name: '李小红', role: 'lead', kind: 'person', look: '长发', wardrobe: '校服', sourceEvidence: ['李小红打开课本'] }
    ]
  }, 'story');
  assert.ok(bible);
  const ids = bible!.characters.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.filter((id) => id === 'char-lead').length <= 1, true);
});

test('P0 object 出现在 story 时拆到 subjects，不算叙事角色', () => {
  const narration = '把番茄炒蛋盛出，再撒一点葱花。番茄炒蛋要趁热吃。';
  const bible = fallbackVisualBible({ narration, genre: '故事', title: '家常菜' });
  assert.equal(bible.characters.some((item) => item.kind === 'object' || item.name.includes('番茄')), false);
  assert.equal(bibleHasNarrativeCast(bible) && bible.characters.some((item) => item.kind === 'object'), false);
});

test('P0 标题造角色：标题里的李小红不能进入角色卡', () => {
  const narration = '王小明走进教室，坐下打开课本。';
  const candidates = extractCastCandidates({ narration, title: '李小红的一天', intentNotes: '' });
  assert.equal(candidates.some((item) => item.name === '李小红'), false, `标题人名不应单独成候选：${candidates.map((i) => i.name).join(',')}`);
  const bible = fallbackVisualBible({ narration, genre: '故事', title: '李小红的一天', candidates });
  assert.equal(bible.characters.some((item) => item.name === '李小红'), false);
  assert.ok(bible.characters.some((item) => item.name === '王小明'));
});

test('P0 伪造 evidence 不能建卡', () => {
  const narration = '王小明走进教室。';
  const parsed = parseScriptAnalysis({
    schema_version: 1,
    content_type: 'narrative_story',
    narrative_perspective: 'third_person',
    has_dialogue: false,
    has_narrative_arc: true,
    personification_detected: false,
    visual_density: 'concrete_visual',
    confidence: 0.9,
    entities: [
      { name: '李小红', type: 'person', is_named: true, recurs_throughout: true, evidence: ['李小红在操场跑步'] }
    ]
  }, { narration, title: '开学' });
  assert.ok(!parsed?.entities.some((item) => item.name === '李小红') || (parsed && parsed.entities.every((item) => item.evidence.every((ev) => narration.includes(ev)))), '伪造证据实体应被丢掉');

  const raw = normalizeVisualBible({
    mode: 'story',
    characters: [{
      name: '幽灵',
      role: 'lead',
      kind: 'person',
      look: '白衣',
      wardrobe: '白衣',
      sourceEvidence: ['这段文字根本不在口播里'],
      locked: false,
      refs: []
    }]
  }, 'story');
  const grounded = groundVisualBible(raw!, narration, { title: '开学' });
  assert.equal(grounded.characters.some((item) => item.name === '幽灵'), false);
});

test('P2 年龄缺省不得写成成年', () => {
  const narration = '王小明走进教室，王小明坐下。';
  const bible = fallbackVisualBible({ narration, genre: '故事', title: '开学' });
  const wang = bible.characters.find((item) => item.name === '王小明');
  assert.ok(wang);
  assert.equal(wang!.ageBand.includes('成年'), false, `年龄被写成：${wang!.ageBand}`);
  assert.equal(wang!.ageBand, UNKNOWN_AGE);
  assert.equal(wang!.appearanceUnknown, true);
});

test('P1 匿名人物进入待确认，不直接做硬角色', () => {
  const narration = '一个女孩走进房间，把灯打开。';
  const ledger = buildEntityLedger({ narration, title: '夜访' });
  assert.ok(ledger.entities.some((item) => item.name === '匿名女孩' && item.status === 'pending'));
  const bible = fallbackVisualBible({ narration, genre: '故事', title: '夜访', ledger });
  assert.equal(bible.characters.some((item) => item.name === '匿名女孩'), false);
  assert.ok((bible.pendingCharacters || []).some((item) => item.name === '匿名女孩'));
});

test('P1 普通实物能进 object 锁', () => {
  const narration = '先把咖啡煮好，药片配温水服下。咖啡凉了就不好喝，药片也不要嚼碎。';
  const candidates = extractCastCandidates({ narration, title: '晨间习惯' });
  const names = candidates.map((item) => item.name);
  assert.ok(names.includes('咖啡') || names.includes('药片'), `应抽出咖啡/药片：${names.join(',')}`);
  const bible = fallbackVisualBible({ narration, genre: '教程', title: '晨间习惯', candidates });
  const subjects = bibleSubjects(bible).map((item) => item.name);
  assert.ok(subjects.includes('咖啡') || subjects.includes('药片'), `subjects=${subjects.join(',')}`);
  assert.equal(bible.characters.length, 0);
});

test('P1 sourceFingerprint 含标题，改标题会判定来源变化', () => {
  const narration = '王小明走进教室，王小明坐下。';
  const bible = fallbackVisualBible({ narration, genre: '故事', title: '开学第一天' });
  const same = previewBibleDiff(bible, { narration, title: '开学第一天', genre: '故事' });
  const changed = previewBibleDiff(bible, { narration, title: '完全另一个题目', genre: '故事' });
  assert.equal(same.sourceChanged, false);
  assert.equal(changed.sourceChanged, true);
});

test('P1 低置信进入待确认', () => {
  const analysis = parseScriptAnalysis({
    schema_version: 1,
    content_type: 'narrative_story',
    narrative_perspective: 'third_person',
    has_dialogue: true,
    has_narrative_arc: true,
    personification_detected: false,
    visual_density: 'concrete_visual',
    confidence: 0.3,
    entities: [
      { name: '路人甲', type: 'person', is_named: false, recurs_throughout: false, evidence: ['一个路人甲走过。'] }
    ]
  }, { narration: '一个路人甲走过。' });
  const decision = deriveCastDecision(analysis, '故事');
  assert.equal(decision.hasCast, false);
});

test('P3 分镜 occupancy 不默认绑 lead', () => {
  const narration = '王小明和李小红走进教室，王小明坐下，李小红打开课本。窗外的树在摇。';
  const bible = fallbackVisualBible({ narration, genre: '故事', title: '开学' });
  const shots = [
    shot({ id: 'a', order: 1, narration: '王小明走进教室。', coverageJob: 'hook' }),
    shot({ id: 'b', order: 2, narration: '李小红打开课本。', coverageJob: 'evidence' }),
    shot({ id: 'c', order: 3, narration: '窗外的树在摇。', coverageJob: 'insert' })
  ];
  const occupied = applyOccupancyAfterCoverage(shots, bible);
  const wang = bible.characters.find((item) => item.name === '王小明');
  const li = bible.characters.find((item) => item.name === '李小红');
  assert.ok(wang && li);
  assert.deepEqual(occupied[0].characterIds, [wang!.id]);
  assert.deepEqual(occupied[1].characterIds, [li!.id]);
  assert.deepEqual(occupied[2].characterIds, []);
  assert.equal(occupied[2].occupancyPlan?.onCamera, false);
  const emptyPlan = planShotOccupancy(shots[2], bible, 2, shots);
  assert.equal(emptyPlan.reason === 'empty' || emptyPlan.reason === 'insert-object', true);
});

test('P4 三把锁互相独立', () => {
  const narration = '王小明走进教室，王小明坐下。';
  let bible = fallbackVisualBible({ narration, genre: '故事', title: '开学' });
  const id = bible.characters[0].id;
  bible = toggleCharacterLockFlag(bible, id, 'identity');
  assert.equal(bible.characters[0].identityLocked, true);
  assert.equal(bible.characters[0].appearanceLocked, false);
  assert.equal(bible.characters[0].refsLocked, false);
  bible = toggleCharacterLockFlag(bible, id, 'appearance');
  assert.equal(bible.characters[0].appearanceLocked, true);
  assert.equal(bible.characters[0].identityLocked, true);
  bible = toggleCharacterLockFlag(bible, id, 'refs');
  assert.equal(bible.characters[0].refsLocked, true);
  assert.equal(bible.characters[0].locked, true);
});

test('体裁必须传到决策层：Gemini 空卡也不能把故事编没', () => {
  const narration = '王小明走进教室。';
  const empty = normalizeVisualBible({
    mode: 'expository',
    paletteLock: '日光',
    characters: [],
    locations: [],
    motif: null,
    continuityRule: '图解'
  }, 'expository');
  const grounded = groundVisualBible(empty!, narration, { title: '开学', genre: '故事' });
  assert.ok(grounded.characters.some((item) => item.name === '王小明'), `应补回王小明，实际 ${grounded.characters.map((i) => i.name).join(',')}`);
});

test('决策层：第一人称默认旁白，不把 object 当角色', () => {
  const ledger = buildEntityLedger({
    narration: '我来到这里，把咖啡喝完。我再看一眼窗外。',
    title: '独白'
  });
  const decision = deriveCastDecisionFromLedger(ledger, '情绪');
  assert.equal(decision.presentation === 'narrator_led' || decision.hasCast === false, true);
  assert.equal(decision.allowed.some((item) => item.kind === 'object' as never), false);
});
