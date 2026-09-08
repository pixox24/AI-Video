import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOccupancyAfterCoverage,
  confirmPendingCharacter,
  fallbackVisualBible,
  groundVisualBible,
  isVisualBibleStale,
  bibleHasNarrativeCast,
  shotImageGenerationBlockedByBible,
  workspaceBibleSource,
  mergeVisualBible,
  normalizeVisualBible,
  rejectPendingCharacter,
  toggleCharacterLockFlag,
  updateCharacterField
} from './visualBible';
import { parseScriptAnalysis } from './scriptAnalysis';
import { compileVisualBible, resetVisualBibleServiceCache } from '../services/visualBibleService';
import { migrateLockFlags } from './visualBibleMigration';
import { currentSourceKey } from './visualBibleSource';
import { nameMentionedIn } from './scriptEntity';

function shot(narration: string, job = 'evidence') {
  return {
    id: narration.slice(0, 8),
    order: 1,
    start: 0,
    speechDuration: 2,
    holdDuration: 0,
    energy: 'medium' as const,
    function: 'proof' as const,
    visualIntent: '',
    narration,
    splitReason: '',
    sliceText: narration,
    coverageJob: job as any
  };
}

test('选题卡标题编圣经后，不因 lockedTitle 为空误报过期', () => {
  const narration = '先把油热起来，再下鸡蛋，最后盛盘。';
  const workspace = {
    fullNarration: narration,
    intentNotes: '',
    lockedTitle: '',
    draftedTitle: '',
    genrePackId: null,
    topicCards: [{ id: 't1', title: '十分钟煎蛋', genre: '教程' as const }],
    selectedTopicId: 't1'
  };
  const src = workspaceBibleSource(workspace);
  const bible = fallbackVisualBible({ narration: src.narration, title: src.title, intentNotes: src.intentNotes, genre: src.genre });
  assert.equal(isVisualBibleStale(bible, src.narration, src.genre, src), false);
  assert.equal(bibleHasNarrativeCast(bible), false);
  assert.equal(shotImageGenerationBlockedByBible({ visualBible: bible }), false);
  const oldCheck = isVisualBibleStale(bible, narration, workspace.genrePackId, {
    title: workspace.lockedTitle,
    intentNotes: workspace.intentNotes
  });
  assert.equal(oldCheck, true);
});

test('无班底圣经即使来源偏移也不阻拦镜头生图', () => {
  const bible = fallbackVisualBible({ narration: '先热油再下蛋。', title: '煎蛋', genre: '教程' });
  assert.equal(bibleHasNarrativeCast(bible), false);
  assert.equal(shotImageGenerationBlockedByBible({ visualBible: bible }), false);
  assert.equal(shotImageGenerationBlockedByBible({ visualBible: { ...bible, sourceKey: 'other' } }), false);
});

test('T01 刚生成不误报过期', async () => {
  resetVisualBibleServiceCache();
  const src = { narration: '我走进房间，然后我看向窗外。', genre: '情绪' as const, title: '独白', intentNotes: '' };
  const result = await compileVisualBible(src, {
    analyze: async () => ({ content_type: 'emotional_essay', narrative_perspective: 'first_person', has_narrative_arc: true, confidence: 0.9, entities: [] }),
    compileCards: async () => ({ mode: 'story', characters: [], locations: [], paletteLock: '日光', logline: '独白' })
  });
  const bible = result.bible;
  assert.equal(isVisualBibleStale(bible, src.narration, '情绪', src), false);
  assert.equal(bible.sourceKey, currentSourceKey(src.narration, src));
});

test('T02 相同输入缓存分析', async () => {
  resetVisualBibleServiceCache();
  const src = { narration: '我走进房间，然后我看向窗外。', genre: '情绪' as const, title: '独白', intentNotes: '' };
  const analyze = async () => ({ content_type: 'emotional_essay', narrative_perspective: 'first_person', confidence: 0.9, entities: [] });
  const first = await compileVisualBible(src, { analyze, compileCards: async () => ({ paletteLock: '日光' }) });
  const second = await compileVisualBible({ ...src, previousBible: first.bible }, { analyze, compileCards: async () => ({ paletteLock: '日光' }) });
  assert.equal(first.diagnostics.analysisCalls, 1);
  assert.equal(second.diagnostics.analysisCalls, 0);
  assert.equal(second.diagnostics.analysisCacheHit, true);
});

test('T03 确认匿名角色后 ground 保持 include', () => {
  const src = { narration: '一个女孩走进房间，她拿起书本。', title: '夜访', genre: '故事' as const };
  const base = fallbackVisualBible(src);
  const confirmed = confirmPendingCharacter(base, base.pendingCharacters![0].id);
  const patched = groundVisualBible(confirmed, src.narration, src);
  assert.ok(patched.characters.some((item) => item.name === '匿名女孩'));
  assert.equal(patched.overrides?.[patched.characters[0].entityId || '']?.decision, 'include');
});

test('T04 拒绝匿名角色后不再回到 pending', () => {
  const src = { narration: '一个女孩走进房间，她拿起书本。', title: '夜访', genre: '故事' as const };
  const base = fallbackVisualBible(src);
  const patched = groundVisualBible(rejectPendingCharacter(base, base.pendingCharacters![0].id), src.narration, src);
  assert.equal(patched.characters.some((item) => item.name === '匿名女孩'), false);
  assert.equal(patched.pendingCharacters?.some((item) => item.name === '匿名女孩'), false);
});

test('T05 高置信科普 no-cast 前后端一致', async () => {
  resetVisualBibleServiceCache();
  const src = { narration: '王小明说：“看这里，这是细胞分裂的三个阶段。”', genre: '故事' as const, title: '细胞分裂' };
  const data = await compileVisualBible(src, {
    analyze: async () => ({
      content_type: 'science_explainer',
      narrative_perspective: 'third_person',
      has_dialogue: true,
      confidence: 0.95,
      entities: [{ name: '王小明', type: 'person', is_named: true, recurs_throughout: false, evidence: [src.narration] }]
    }),
    compileCards: async () => ({ mode: 'story', characters: [], paletteLock: '日光' })
  });
  const client = groundVisualBible(normalizeVisualBible(data.bible)!, src.narration, { ...src, candidates: [] });
  assert.equal(data.bible.characters.length, 0);
  assert.equal(client.characters.length, 0);
});

test('T06 真实句子不能证明不存在的人', () => {
  const src = { narration: '王小明走进教室。', title: '开学', genre: '故事' as const };
  const analysis = parseScriptAnalysis({
    content_type: 'narrative_story',
    narrative_perspective: 'third_person',
    has_narrative_arc: true,
    confidence: 0.95,
    entities: [{ name: '李小红', type: 'person', is_named: true, recurs_throughout: true, evidence: ['王小明走进教室。'] }]
  }, src);
  const bible = groundVisualBible(fallbackVisualBible({ ...src, analysis }), src.narration, { ...src, analysis });
  assert.ok(bible.characters.some((item) => item.name === '王小明'));
  assert.equal(bible.characters.some((item) => item.name === '李小红'), false);
});

test('T07 同卡 ID 不同实体不串脸', () => {
  const srcA = { narration: '王小明走进教室。', title: '开学', genre: '故事' as const };
  const srcB = { narration: '李小红走进教室。', title: '开学', genre: '故事' as const };
  const a = fallbackVisualBible(srcA);
  const b = fallbackVisualBible(srcB);
  a.characters[0] = { ...a.characters[0], id: 'char-lead', appearanceLocked: true, locked: true, look: '王小明特有的旧外形' };
  b.characters[0] = { ...b.characters[0], id: 'char-lead', look: '李小红的新外形' };
  const merged = groundVisualBible(mergeVisualBible(a, b), srcB.narration, srcB);
  const li = merged.characters.find((item) => item.name === '李小红');
  assert.ok(li);
  assert.notEqual(li!.look, '王小明特有的旧外形');
});

test('T08 refsLocked=false 重编不清回 true', () => {
  const src = { narration: '王小明走进教室，王小明打开课本。', title: '开学', genre: '故事' as const };
  let bible = fallbackVisualBible(src);
  bible = {
    ...bible,
    characters: bible.characters.map((item) => ({
      ...item,
      refs: [{ imageId: 'old.png', imageUrl: '/generated/old.png', kind: 'face' as const }],
      identityLocked: true,
      appearanceLocked: false,
      refsLocked: false,
      locked: true
    }))
  };
  const merged = mergeVisualBible(bible, fallbackVisualBible(src));
  assert.equal(merged.characters[0].refsLocked, false);
  assert.equal(merged.characters[0].refs.length, 0);
});

test('T09 代词连续动作三镜都上王小明', () => {
  const bible = fallbackVisualBible({ narration: '王小明走进教室。他拿起课本。随后他坐下读书。', genre: '故事' });
  const plans = applyOccupancyAfterCoverage([
    shot('王小明走进教室。', 'hook'),
    shot('他拿起课本。'),
    shot('随后他坐下读书。')
  ], bible);
  assert.ok(plans.every((item) => item.occupancyPlan?.onCamera));
  const wang = bible.characters.find((item) => item.name === '王小明');
  assert.ok(wang);
  assert.ok(plans.every((item) => item.occupancyPlan?.characterIds.includes(wang!.id)));
});

test('T10 虚构产品不进入 subjects', () => {
  const src = { narration: '咖啡煮好后倒入水杯。咖啡趁热喝。', genre: '教程' as const };
  const raw = normalizeVisualBible({
    mode: 'expository',
    subjects: [{ id: 'subj-fake', name: '虚构产品', entityId: 'missing', look: '红色', sourceEvidence: ['不存在的句子'] }],
    characters: [],
    paletteLock: '暖色'
  });
  const grounded = groundVisualBible(raw!, src.narration, src);
  assert.equal(grounded.subjects?.some((item) => item.name === '虚构产品'), false);
  assert.ok(grounded.subjects?.some((item) => item.name === '咖啡'));
});

test('T12 英文词边界与 CRLF 规范化', () => {
  assert.equal(nameMentionedIn('a part of the story', 'apart'), false);
  assert.equal(nameMentionedIn('They stood apart', 'apart'), true);
  const keyA = currentSourceKey('hello\r\nworld', { title: 'A' });
  const keyB = currentSourceKey('hello\nworld', { title: 'A' });
  assert.equal(keyA, keyB);
});

test('T18 锁迁移：旧 locked=true 与显式 refs=false', () => {
  const legacy = migrateLockFlags({ locked: true });
  assert.equal(legacy.identityLocked && legacy.appearanceLocked && legacy.refsLocked, true);
  const explicit = migrateLockFlags({ locked: true, identityLocked: true, appearanceLocked: false, refsLocked: false });
  assert.equal(explicit.refsLocked, false);
  assert.equal(explicit.identityLocked, true);
  assert.equal(explicit.locked, true);
});

test('T23 窗外树木 insert 必须无人', () => {
  const bible = fallbackVisualBible({ narration: '王小明走进教室。窗外的树在摇。', genre: '故事' });
  const plans = applyOccupancyAfterCoverage([
    shot('王小明走进教室。', 'hook'),
    shot('窗外的树在摇。', 'insert')
  ], bible);
  assert.equal(plans[1].occupancyPlan?.onCamera, false);
});

test('T26 改外形后 bibleRevision 变、sourceKey 不变', () => {
  const src = { narration: '王小明走进教室，王小明坐下。', title: '开学', genre: '故事' as const };
  const a = fallbackVisualBible(src);
  const b = updateCharacterField(a, a.characters[0].id, { look: '新的短发造型' });
  assert.equal(a.sourceKey, b.sourceKey);
  assert.ok(a.bibleRevision);
  assert.ok(b.bibleRevision);
  assert.notEqual(a.bibleRevision, b.bibleRevision);
});
