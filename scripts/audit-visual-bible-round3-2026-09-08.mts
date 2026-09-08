// Independent round 3 acceptance. No HTTP server, external models or saved project writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';
import * as vb from '../src/utils/visualBible.ts';
import * as svc from '../src/services/visualBibleService.ts';
import { bibleRevisionOf } from '../src/utils/visualBibleSource.ts';
import { reduceBibleAction } from '../src/utils/visualBibleState.ts';
import { presetStylePack } from '../src/utils/stylePack.ts';
import { applyCharacterRefResponse, captureCharacterRefRequest } from '../src/utils/visualBibleAsync.ts';

const results: any[] = [];
async function check(id: string, name: string, work: () => unknown | Promise<unknown>) {
  try { results.push({ id, name, pass: true, detail: await work() }); }
  catch (e: any) { results.push({ id, name, pass: false, error: e.message }); }
}
const source = { narration: '王小明走进教室，王小明打开课本。', title: '开学', genre: '故事' as const };
function fresh() { return vb.groundVisualBible(vb.fallbackVisualBible(source), source.narration, source); }
function shot(narration: string, id: string): any {
  return { id, narration, sliceText: narration, order: Number(id), function: 'proof', coverageJob: 'evidence',
    start: 0, speechDuration: 2, holdDuration: 0, energy: 'medium', visualIntent: '' };
}
const server = readFileSync(new URL('../server.ts', import.meta.url), 'utf8');
const start = server.indexOf('app.post("/api/script/visual-bible"');
const end = server.indexOf('// 2.1 Polish', start);
assert.ok(start >= 0 && end > start);
let handler: any;
let capturedPrompt = '';
const bindings = {
  ...svc,
  app: { post: (_: string, fn: any) => { handler = fn; } },
  isUsableLlmApi: () => false,
  runScriptLlmJson: async ({ user }: any) => {
    capturedPrompt = user;
    return { mode: 'story', paletteLock: 'NEW_PALETTE_FROM_MODEL', characters: [] };
  }
};
new Function(...Object.keys(bindings), transformSync(server.slice(start, end), { loader: 'ts', format: 'cjs' }).code)(...Object.values(bindings));
async function route(body: any) {
  let response: any;
  const res: any = { status: () => res, json: (data: any) => { response = data; return res; } };
  await handler({ body }, res);
  assert.ok(response?.bible, 'Production route must return Bible');
  return response;
}

await check('S01', '生产路由原样传递 requestId', async () => {
  const out = await route({ ...source, requestId: 'client-request-42' });
  assert.equal(out.diagnostics.requestId, 'client-request-42');
});
await check('S02', '已有圣经正常重编的有效响应应被 UI 接受', async () => {
  const before = fresh();
  before.paletteLock = 'OLD_PALETTE_FROM_PREVIOUS_COMPILATION';
  before.bibleRevision = bibleRevisionOf(before);
  const out = await route({ ...source, previousBible: before, requestId: 'client-rebuild' });
  assert.notEqual(out.bible.bibleRevision, before.bibleRevision, 'fixture must change compiled constraints');
  const accepted = svc.receiveVisualBibleResponse({ ...source, requestId: 'client-rebuild', bibleRevision: before.bibleRevision }, out);
  assert.ok(accepted, '来源未变、请求有效，但路由自造 requestId 与新结果版本联合导致合法重编被拒绝');
});
await check('S03', '只改 look 不得清空 wardrobe、ageBand、signature', () => {
  const bible = fresh();
  const id = bible.characters[0].id;
  bible.characters[0] = { ...bible.characters[0], wardrobe: '蓝色校服', ageBand: '文案未明示', signature: '圆框眼镜' };
  const changed = vb.updateCharacterField(bible, id, { look: '黑色短发' });
  assert.equal(changed.characters[0].wardrobe, '蓝色校服', 'look-only patch 把 wardrobe 改成 undefined');
  assert.equal(changed.characters[0].ageBand, '文案未明示');
  assert.equal(changed.characters[0].signature, '圆框眼镜');
  assert.equal(changed.bibleRevision, bibleRevisionOf(changed), 'stored revision must equal final state');
});
await check('S04', '改显示名后仍按原文 canonical 名识别上镜', () => {
  const before = fresh();
  const id = before.characters[0].id;
  const renamed = vb.updateCharacterField(before, id, { name: '小明同学' });
  const grounded = vb.groundVisualBible(renamed, source.narration, source);
  assert.equal(grounded.characters[0].name, '小明同学');
  const plans = vb.applyOccupancyAfterCoverage([shot('王小明走进教室。', '1')], grounded);
  assert.deepEqual(plans[0].characterIds, [id], 'occupancy 只匹配展示名，小明同学改名导致原文王小明无人');
});
await check('S05', '切换分析模型不能从 previousBible 绕过版本化缓存', async () => {
  svc.resetVisualBibleServiceCache();
  const src = { ...source, narration: '我走进房间，然后我看向窗外。' };
  let calls = 0;
  const deps = { analyze: async () => {
    calls += 1;
    return { content_type: 'narrative_story', narrative_perspective: 'first_person', has_narrative_arc: true,
      confidence: 0.95, entities: [] };
  } };
  const before = await svc.compileVisualBible({ ...src, model: 'model-A' }, deps);
  assert.equal(calls, 1);
  const after = await svc.compileVisualBible({ ...src, model: 'model-B', previousBible: before.bible }, deps);
  assert.equal(after.diagnostics.analysisCalls, 1, 'cachedFromPrev 只核 sourceKey/provenance，换模型仍跳过分析');
});
await check('S06', '正式编卡提示词保留传入风格约束', async () => {
  const stylePack = { ...presetStylePack('cinematic'), label: 'STYLE_ACCEPTANCE_MARKER' };
  await route({ ...source, stylePack });
  assert.match(capturedPrompt, /STYLE_ACCEPTANCE_MARKER/, '路由传 stylePack，但领域服务从未用于编卡提示词');
});
await check('S07', '已明确性别时不能把他指向最近的女性', () => {
  const src = { ...source, narration: '王小明和李小红走进教室，王小明坐下，李小红打开课本。' };
  const bible = vb.groundVisualBible(vb.fallbackVisualBible(src), src.narration, src);
  const wang = bible.characters.find(c => c.name === '王小明');
  const li = bible.characters.find(c => c.name === '李小红');
  assert.ok(wang && li);
  wang.look = '男孩'; li.look = '女孩';
  const plans = vb.applyOccupancyAfterCoverage([
    shot('王小明走进教室。', '1'), shot('李小红坐下。', '2'), shot('他打开课本。', '3')
  ], bible);
  assert.deepEqual(plans[2].characterIds, [wang.id], '性别过滤结果为空时继续使用上一句女性');
});

// Execute the actual functional updater installed by generateCharacterCard in App.tsx.
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const generatorStart = appSource.indexOf('const generateCharacterCard = async');
const updaterStart = appSource.indexOf('setProject((prev) => {', generatorStart);
const updaterEnd = appSource.indexOf('\n      });', updaterStart);
assert.ok(generatorStart >= 0 && updaterStart > generatorStart && updaterEnd > updaterStart);
const updaterCode = transformSync(appSource.slice(updaterStart, updaterEnd + '\n      });'.length), { loader: 'tsx', format: 'cjs' }).code;
function lateImageResult(liveBible: any, original: any) {
  // Bind request-time context used by the production updater; preserve both negative assertions.
  const workspace = { fullNarration: source.narration, visualBible: { ...fresh(), characters: [original] } };
  let project: any = { id: 'audit-project', scriptWorkspace: { fullNarration: source.narration, visualBible: liveBible } };
  const refRequest = captureCharacterRefRequest(project.id, workspace.visualBible, original);
  const requestKey = `${project.id}/${refRequest.entityId}`;
  const environment = {
    setProject: (fn: any) => { project = fn(project); }, setCharacterRef: vb.setCharacterRef,
    characterId: original.id, character: original, workspace, refRequest, requestKey,
    characterRefRequests: { current: new Map([[requestKey, refRequest]]) }, applyCharacterRefResponse,
    ref: { imageId: 'late-old-image', imageUrl: '/generated/late-old-image.png', kind: 'face' }
  };
  new Function(...Object.keys(environment), updaterCode)(...Object.values(environment));
  return project.scriptWorkspace.visualBible;
}
await check('S08', '旧生图完成不得覆盖期间手动上传的新参考图', () => {
  const bible = fresh();
  const original = bible.characters[0];
  const live = vb.setCharacterRef(bible, original.id, { imageId: 'new-user-ref', imageUrl: '/generated/new-user-ref.png', kind: 'face' });
  const result = lateImageResult(live, original);
  assert.equal(result.characters[0].refs[0].imageId, 'new-user-ref', '读取最新 project 仍无版本条件，旧生成图覆盖用户新图');
});
await check('S09', '旧生图完成不得按重用卡 ID 绑定另一实体', () => {
  const old = fresh().characters[0];
  const src = { ...source, narration: '李小红走进操场，李小红开始跑步。' };
  const live = vb.fallbackVisualBible(src);
  assert.ok(live.characters[0].entityId !== old.entityId);
  live.characters[0].id = old.id;
  const after = lateImageResult(live, old);
  assert.equal(after.characters[0].refs.length, 0, '先按卡 ID 匹配而未核 entityId，给李小红装入王小明的迟到图');
});
await check('S10', '用户恢复 auto 后重新派生原始 pending 状态', () => {
  const src = { ...source, narration: '一个女孩走进房间，她拿起书本。' };
  let bible = vb.fallbackVisualBible(src);
  const pending = bible.pendingCharacters![0];
  assert.ok(pending);
  bible = vb.confirmPendingCharacter(bible, pending.id);
  bible = reduceBibleAction(bible, { type: 'set_entity_decision', entityId: pending.entityId!, decision: 'auto' });
  assert.equal(bible.characters.some(c => c.entityId === pending.entityId), false, 'auto 只改 override，已改写的 confirmed 台账和展示未还原');
  assert.ok(bible.pendingCharacters?.some(c => c.entityId === pending.entityId));
});
await check('S11', '未知旧请求即使结果版本相同也应拒绝', async () => {
  const response = await route({ ...source });
  const received = svc.receiveVisualBibleResponse({ ...source, requestId: 'newer-request', bibleRevision: response.bible.bibleRevision }, response);
  assert.equal(received, null, 'requestId 不同却因结果版本相等接受旧响应');
});
console.log(JSON.stringify({ scope: 'deterministic local third review', total: results.length,
  passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results }, null, 2));
process.exitCode = results.some(r => !r.pass) ? 1 : 0;
