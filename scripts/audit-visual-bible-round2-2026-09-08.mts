// Independent acceptance audit: actual domain functions and extracted production route.
// No external API calls, no generated images, no saved project mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as vb from '../src/utils/visualBible.ts';
import * as se from '../src/utils/scriptEntity.ts';
import * as sa from '../src/utils/scriptAnalysis.ts';
import * as cc from '../src/utils/castCandidates.ts';
import * as vs from '../src/utils/visualBibleSource.ts';
import * as vbs from '../src/services/visualBibleService.ts';
import { createDefaultScriptWorkspace, rebuildForecast, normalizeScriptWorkspace } from '../src/utils/scriptWorkspace.ts';
import { compileImagePrompt } from '../src/utils/imagePrompt.ts';
import { presetStylePack } from '../src/utils/stylePack.ts';

const results: any[] = [];
async function check(id: string, name: string, run: () => unknown | Promise<unknown>) {
  try { results.push({ id, name, pass: true, details: await run() }); }
  catch (error: any) { results.push({ id, name, pass: false, error: error.message }); }
}
const source = { narration: '王小明走进教室，王小明打开课本。', title: '开学', genre: '故事' as const };
function fresh(src = source) { return vb.groundVisualBible(vb.fallbackVisualBible(src), src.narration, src); }
function shot(narration: string, id: string): any {
  return { id, order: Number(id) || 1, start: 0, speechDuration: 2, holdDuration: 0,
    energy: 'medium', function: 'proof', visualIntent: '', narration, sliceText: narration, coverageJob: 'evidence' };
}
const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const start = server.indexOf('app.post("/api/script/visual-bible"');
const end = server.indexOf('// 2.1 Polish', start);
assert.ok(start >= 0 && end > start, 'Production route delimiters missing');
const routeSource = server.slice(start, end);
let handler: any;
let modelCalls = 0;
const bindings = {
  ...vb, ...se, ...sa, ...cc, ...vs, ...vbs,
  app: { post: (_path: string, fn: any) => { handler = fn; } },
  incomingStyleContract: () => '',
  isUsableLlmApi: (api: any) => Boolean(api?.enabled),
  runScriptLlmJson: async () => { modelCalls += 1; return { mode: 'story', paletteLock: '暖色', characters: [] }; }
};
new Function(...Object.keys(bindings), transformSync(routeSource, { loader: 'ts', format: 'cjs' }).code)(...Object.values(bindings));
async function route(body: any) {
  let result: any;
  const res: any = { status: () => res, json: (value: any) => { result = value; return res; } };
  await handler({ body }, res);
  assert.ok(result?.bible, 'Route did not return a Bible');
  return result;
}

await check('R01', '真实 API 必须委托被测试的领域服务', () => {
  assert.match(routeSource, /compileVisualBible\s*\(/, 'server.ts 路由未调用 compileVisualBible；专项服务测试不覆盖线上入口');
});
await check('R02', '界面改外形后结果版本变化，旧 pinned prompt 不复用', () => {
  const before = fresh();
  const changed = vb.updateCharacterField(before, before.characters[0].id, { look: '银色短发，左脸有一道细疤' });
  const workspace = rebuildForecast({ ...createDefaultScriptWorkspace(), fullNarration: source.narration,
    lockedTitle: source.title, genrePackId: source.genre, visualBible: changed });
  const after = workspace.visualBible!;
  const oldPrompt = 'OLD_PINNED_CHARACTER_APPEARANCE_PROMPT';
  const compiled = compileImagePrompt({ clip: { narration: source.narration, visualPrompt: oldPrompt,
    visualBibleHash: before.bibleRevision, promptPinned: true } as any, pack: presetStylePack('cinematic'),
    bible: after, clipIndex: 0, clipCount: 1 });
  assert.notEqual(compiled.prompt, oldPrompt, `改外形后仍复用旧提示词；revision=${after.bibleRevision}`);
  assert.notEqual(after.bibleRevision, before.bibleRevision);
  assert.equal(after.sourceKey, before.sourceKey);
});
await check('R03', '已上传参考图，再开身份锁不应关闭参考图锁', () => {
  let bible = fresh();
  const id = bible.characters[0].id;
  bible = vb.setCharacterRef(bible, id, { imageId: 'face-a', imageUrl: '/generated/face-a.png', kind: 'face' });
  assert.equal(bible.characters[0].refsLocked, true);
  bible = vb.toggleCharacterLockFlag(bible, id, 'identity');
  assert.equal(bible.characters[0].refsLocked, true, '点击身份锁把原 refsLocked=true 改成 false');
});
await check('R04', '已迁移的外形锁不应被首次切换身份锁清除', () => {
  const bible = fresh();
  bible.characters[0] = { ...bible.characters[0], appearanceLocked: true, locked: true };
  const migrated = vb.normalizeVisualBible(bible)!;
  const next = vb.toggleCharacterLockFlag(migrated, migrated.characters[0].id, 'identity');
  assert.equal(next.characters[0].appearanceLocked, true, '缺少 override 时新锁从全 false 开始，旧外形锁丢失');
});
await check('R05', '用户显示名应写入持久 override 并能通过校验', () => {
  const before = fresh();
  const changed = vb.updateCharacterField(before, before.characters[0].id, { name: '小明同学' });
  const grounded = vb.groundVisualBible(changed, source.narration, source);
  assert.equal(grounded.characters[0]?.name, '小明同学', '用户显示名被当成实体错配，恢复原名');
});
await check('R06', '两人同句后她应只关联明确的女性人物', () => {
  // Isolate occupancy using two established named cards; extraction is tested separately.
  const src = { ...source, narration: '王小明和李小红走进教室，王小明坐下，李小红打开课本。' };
  const bible = fresh(src);
  const li = bible.characters.find(c => c.name === '李小红');
  const wang = bible.characters.find(c => c.name === '王小明');
  assert.ok(li && wang, 'fixture 必须有两个角色');
  const plans = vb.applyOccupancyAfterCoverage([shot('男孩王小明与女孩李小红走进教室。', '1'), shot('她打开课本。', '2')], bible);
  assert.deepEqual(plans[1].characterIds, [li.id], '当前回溯把上一句所有人都赋给她');
});
await check('R07', '他看向窗外仍然是人物动作镜', () => {
  const src = { ...source, narration: '王小明走进教室。他看向窗外。' };
  const bible = fresh(src);
  const plans = vb.applyOccupancyAfterCoverage([shot('王小明走进教室。', '1'), shot('他看向窗外。', '2')], bible);
  assert.equal(plans[1].occupancyPlan?.onCamera, true, '窗外关键词把人物动作误判为空镜');
});
await check('R08', '英文 He 动作句应继承已确认主语', () => {
  const bible = fresh();
  bible.characters[0] = { ...bible.characters[0], name: 'John' };
  const plans = vb.applyOccupancyAfterCoverage([shot('John enters the room.', '1'), shot('He opens the book.', '2')], bible);
  assert.equal(plans[1].occupancyPlan?.onCamera, true, '代词规则未覆盖英文 He');
});
await check('R09', 'pinned 旧稿在重载新稿时保持原始来源键', () => {
  const bible = { ...fresh(), pinned: true };
  const workspace = normalizeScriptWorkspace({ ...createDefaultScriptWorkspace(),
    fullNarration: '李小红走进操场，李小红开始跑步。', lockedTitle: source.title, genrePackId: source.genre, visualBible: bible });
  assert.equal(workspace.visualBible?.sourceKey, bible.sourceKey, 'normalizeScriptWorkspace 重载时把旧 pinned 快照盖成新稿 sourceKey');
});
await check('R10', '用户确认匿名人物后整篇分析仍必须尊重 include', () => {
  const src = { ...source, narration: '一个女孩走进房间，她拿起书本。' };
  const before = vb.fallbackVisualBible(src);
  assert.ok(before.pendingCharacters?.length);
  const confirmed = vb.confirmPendingCharacter(before, before.pendingCharacters![0].id);
  const analysis = sa.parseScriptAnalysis({ content_type: 'narrative_story', narrative_perspective: 'third_person',
    has_narrative_arc: true, confidence: 0.95, entities: [] }, src)!;
  const after = vb.applyAnalysisToBible(confirmed, analysis, src.genre, src);
  assert.ok(after.characters.some(c => c.name === '匿名女孩'), 'applyAnalysisToBible 重新构建无 override 台账，撤销 include');
});
await check('R11', '规则降级后接入可用模型，真实 API 应重新分析', async () => {
  const src = { ...source, narration: '我走进房间，然后我看向窗外。' };
  const previous = vb.fallbackVisualBible(src);
  assert.ok(previous.entityLedger);
  const callsBefore = modelCalls;
  await route({ ...src, previousBible: previous, llmApi: { enabled: true } });
  assert.equal(modelCalls - callsBefore, 2, '实际只调用编卡；任意同 sourceKey 台账都被缓存，规则降级结果阻止正式分析');
});
await check('R12', 'structured blocking issue 应阻止相关生成动作', () => {
  const bible = fresh();
  bible.validation = { status: 'ok', warnings: [], checkedAt: Date.now() };
  bible.issues = [{ code: 'ENTITY_ID_MISMATCH', severity: 'error', targetType: 'character',
    message: '活动角色 ID 不属于当前台账', blocks: ['generate_image'] }];
  assert.equal(vb.visualBibleHasBlockingWarnings(bible), true, '门禁仅读取中文 warnings 正则，忽略 issues.blocks');
});
await check('R13', '新故事不应把已消失的旧锁定角色保留在 active', () => {
  let old = fresh();
  old = vb.toggleCharacterLockFlag(old, old.characters[0].id, 'appearance');
  const src = { ...source, narration: '李小红走进操场，李小红开始跑步。' };
  const after = vb.groundVisualBible(vb.mergeVisualBible(old, fresh(src)), src.narration, src);
  assert.equal(after.characters.some(c => c.name === '王小明'), false, '旧人仍在 active，未归档 retired');
});
await check('R14', '实物名称和已存在 entityId 也必须对应同一实体', () => {
  const src = { narration: '咖啡煮好后倒入水杯。咖啡趁热喝。', title: '早餐', genre: '教程' as const };
  const baseline = vb.fallbackVisualBible(src);
  const cup = baseline.subjects?.find(s => s.name === '水杯');
  const coffee = baseline.subjects?.find(s => s.name === '咖啡');
  assert.ok(cup?.entityId && coffee?.entityId && cup.entityId !== coffee.entityId, 'fixture 需要两个不同实物实体');
  const incoming = { ...baseline, subjects: [{ ...coffee, entityId: cup.entityId }] };
  const grounded = vb.groundVisualBible(incoming, src.narration, src);
  assert.equal(grounded.subjects?.some(s => s.name === '咖啡' && s.entityId === cup.entityId), false,
    '咖啡卡引用水杯 ID 仍通过校验；检查了 ID 存在，没有检查 ID 与名称的关系');
});

console.log(JSON.stringify({ scope: 'deterministic local acceptance, production route extracted with mocked model',
  total: results.length, passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results }, null, 2));
process.exitCode = results.some(r => !r.pass) ? 1 : 0;
