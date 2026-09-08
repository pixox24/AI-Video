import assert from 'node:assert/strict';
// Acceptance audit. Does not call external models or write project data.
import * as vb from '../src/utils/visualBible.ts';
import * as se from '../src/utils/scriptEntity.ts';
import * as sa from '../src/utils/scriptAnalysis.ts';
import { compileVisualBible, resetVisualBibleServiceCache } from '../src/services/visualBibleService.ts';

const results: any[] = [];
function compact(b: any) {
  return {
    characters: b.characters.map((c: any) => ({ name: c.name, status: c.status, entityId: c.entityId })),
    pending: b.pendingCharacters?.map((c: any) => c.name),
    ledger: b.entityLedger?.entities.map((e: any) => ({ name: e.name, status: e.status, origin: e.origin })),
    warnings: b.validation?.warnings
  };
}
function shot(narration: string, job = 'evidence') {
  return {
    id: 's',
    order: 1,
    start: 0,
    speechDuration: 2,
    holdDuration: 0,
    energy: 'medium',
    function: 'proof',
    visualIntent: '',
    narration,
    sliceText: narration,
    coverageJob: job
  } as any;
}

const anonSource = { narration: '一个女孩走进房间，她拿起书本。', title: '夜访', genre: '故事' as const };
{
  const b = vb.fallbackVisualBible(anonSource);
  const confirmed = vb.confirmPendingCharacter(b, b.pendingCharacters![0].id);
  const patched = vb.groundVisualBible(confirmed, anonSource.narration, anonSource);
  results.push({
    name: '确认匿名角色后执行真实 UI 的 ground 流程',
    before: compact(b),
    afterConfirm: compact(confirmed),
    afterPatch: compact(patched),
    pass: patched.characters.some((c: any) => c.name === '匿名女孩')
  });
}
{
  const b = vb.fallbackVisualBible(anonSource);
  const rejected = vb.rejectPendingCharacter(b, b.pendingCharacters![0].id);
  const patched = vb.groundVisualBible(rejected, anonSource.narration, anonSource);
  results.push({
    name: '拒绝匿名角色后执行真实 UI 的 ground 流程',
    after: compact(patched),
    rejected: patched.rejectedCast,
    pass: !patched.pendingCharacters?.some((c: any) => c.name === '匿名女孩') && !patched.characters.some((c: any) => c.name === '匿名女孩')
  });
}
{
  const src = { narration: '王小明走进教室，王小明打开课本。', title: '开学', genre: '故事' as const };
  let b = vb.fallbackVisualBible(src);
  b = {
    ...b,
    characters: b.characters.map((c) => ({
      ...c,
      refs: [{ imageId: 'old.png', imageUrl: '/generated/old.png', kind: 'face' as const }],
      identityLocked: true,
      appearanceLocked: false,
      refsLocked: false,
      locked: true
    }))
  };
  const m = vb.mergeVisualBible(b, vb.fallbackVisualBible(src));
  results.push({
    name: '仅关闭参考图锁后重编',
    before: { identityLocked: true, refsLocked: false },
    after: { refsLocked: m.characters[0].refsLocked, refs: m.characters[0].refs },
    pass: !m.characters[0].refsLocked && m.characters[0].refs.length === 0
  });
}
{
  const b = vb.fallbackVisualBible({ narration: '王小明走进教室。他拿起课本。随后他坐下读书。', genre: '故事' });
  const ss = [shot('王小明走进教室。', 'hook'), shot('他拿起课本。'), shot('随后他坐下读书。')];
  const plans = vb.applyOccupancyAfterCoverage(ss, b).map((s) => s.occupancyPlan);
  results.push({ name: '连续动作中的代词是否上镜', plans, pass: plans.every((p) => p?.onCamera) });
}
{
  const src = { narration: '王小明走进教室。', title: '开学', genre: '故事' as const };
  const a = sa.parseScriptAnalysis({
    content_type: 'narrative_story',
    narrative_perspective: 'third_person',
    has_narrative_arc: true,
    confidence: 0.95,
    entities: [{ name: '李小红', type: 'person', is_named: true, recurs_throughout: true, evidence: ['王小明走进教室。'] }]
  }, src)!;
  const b = vb.groundVisualBible(vb.fallbackVisualBible({ ...src, analysis: a }), src.narration, { ...src, analysis: a });
  results.push({
    name: 'LLM 借用真实句子为虚构人名作证据',
    after: compact(b),
    pass: !b.characters.some((c) => c.name === '李小红') && b.characters.some((c) => c.name === '王小明')
  });
}
{
  const src = { narration: '咖啡煮好后倒入水杯。咖啡趁热喝。', genre: '教程' as const };
  const b = vb.normalizeVisualBible({
    mode: 'expository',
    subjects: [{ id: 'subj-fake', name: '虚构产品', entityId: 'missing', look: '红色限量版', sourceEvidence: ['不存在的句子'] }],
    characters: [],
    paletteLock: '暖色'
  })!;
  const g = vb.groundVisualBible(b, src.narration, src);
  results.push({
    name: '没有原文依据的产品 subject 校验',
    subjects: g.subjects,
    warnings: g.validation?.warnings,
    pass: !g.subjects?.some((s) => s.name === '虚构产品')
  });
}
{
  const srcA = { narration: '王小明走进教室。', title: '开学', genre: '故事' as const };
  const srcB = { narration: '李小红走进教室。', title: '开学', genre: '故事' as const };
  const a = vb.fallbackVisualBible(srcA);
  const b = vb.fallbackVisualBible(srcB);
  assert.equal(a.characters.length, 1);
  assert.equal(b.characters.length, 1);
  a.characters[0] = { ...a.characters[0], id: 'char-lead', appearanceLocked: true, locked: true, look: '王小明特有的旧外形', refs: [] };
  b.characters[0] = { ...b.characters[0], id: 'char-lead', look: '李小红的新外形' };
  const g = vb.groundVisualBible(vb.mergeVisualBible(a, b), srcB.narration, srcB);
  results.push({
    name: '不同角色使用相同卡 ID，外形锁是否串人',
    characters: g.characters.map((c) => ({ name: c.name, look: c.look, entityId: c.entityId })),
    warnings: g.validation?.warnings,
    pass: !g.characters.some((c) => c.name === '李小红' && c.look === '王小明特有的旧外形')
  });
}

resetVisualBibleServiceCache();
{
  const src = { narration: '我走进房间，然后我看向窗外。', genre: '情绪' as const, title: '独白', intentNotes: '' };
  const analysisResult = {
    content_type: 'emotional_essay',
    narrative_perspective: 'first_person',
    has_narrative_arc: true,
    confidence: 0.9,
    entities: []
  };
  const modelBible = { mode: 'story', characters: [], locations: [], paletteLock: '日光', logline: '独白' };
  const first = await compileVisualBible(src, {
    analyze: async () => analysisResult,
    compileCards: async () => modelBible
  });
  const g = vb.groundVisualBible(vb.normalizeVisualBible(first.bible)!, src.narration, { ...src, genre: '情绪' });
  const stale = vb.isVisualBibleStale(g, src.narration, '情绪', src);
  results.push({
    name: '真实 API 刚生成、文案未变，是否误报过期',
    stale,
    pass: !stale,
    sourceFingerprint: g.sourceFingerprint,
    recomputed: se.bibleSourceFingerprint({ ...src, mode: g.mode }),
    calls: first.diagnostics.analysisCalls + first.diagnostics.compileCalls
  });
  const prior = { ...g, characters: g.characters.map((c) => ({ ...c, locked: true })), pinned: true };
  const second = await compileVisualBible({ ...src, previousBible: prior }, {
    analyze: async () => analysisResult,
    compileCards: async () => modelBible
  });
  results.push({
    name: '相同输入缓存整篇分析',
    additionalCalls: second.diagnostics.analysisCalls,
    pass: second.diagnostics.analysisCalls === 0 && second.diagnostics.analysisCacheHit === true
  });
}
{
  const src = { narration: '王小明说：“看这里，这是细胞分裂的三个阶段。”', genre: '故事' as const, title: '细胞分裂', intentNotes: '' };
  const analysisResult = {
    content_type: 'science_explainer',
    narrative_perspective: 'third_person',
    has_dialogue: true,
    has_narrative_arc: false,
    confidence: 0.95,
    entities: [{ name: '王小明', type: 'person', is_named: true, recurs_throughout: false, evidence: [src.narration] }]
  };
  const data = await compileVisualBible(src, {
    analyze: async () => analysisResult,
    compileCards: async () => ({ mode: 'story', characters: [], locations: [], paletteLock: '日光', logline: src.title })
  });
  const g = vb.groundVisualBible(vb.normalizeVisualBible(data.bible)!, src.narration, {
    ...src,
    genre: '故事',
    candidates: data.analysisApplied ? [] : undefined
  });
  results.push({
    name: '服务端判定不建角色，前端是否保留该决定',
    analysisApplied: data.analysisApplied,
    server: compact(data.bible),
    client: compact(g),
    pass: g.characters.length === data.bible.characters.length
  });
}

console.log(JSON.stringify(results, null, 2));
process.exitCode = results.every((result) => result.pass === true) ? 0 : 1;
