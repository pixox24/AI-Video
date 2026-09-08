import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileVisualBible, receiveVisualBibleResponse, resetVisualBibleServiceCache } from '../services/visualBibleService';
import { applyCharacterRefResponse, captureCharacterRefRequest, createBibleOperationGuard } from './visualBibleAsync';
import { applyOccupancyAfterCoverage, clearCharacterRef, confirmPendingCharacter, fallbackVisualBible, groundVisualBible,
  normalizeVisualBible, setCharacterRef, toggleCharacterLockFlag, updateCharacterField, isVisualBibleStale } from './visualBible';
import { createDefaultScriptWorkspace, normalizeScriptWorkspace } from './scriptWorkspace';
import { reduceBibleAction } from './visualBibleState';
import { bibleRevisionOf } from './visualBibleSource';
import { collectReferencedAssetUrls, projectForPersist } from './projectPersist';
import { ScriptWorkspace, VisualCharacterRef } from '../types';

const source = { narration: '王小明走进教室，王小明打开课本。', title: '开学', genre: '故事' as const };
const anonymous = { ...source, narration: '一个女孩走进房间，她拿起书本。' };
const ref: VisualCharacterRef = { imageId: 'new.png', imageUrl: '/generated/new.png', kind: 'face' };
const fresh = () => groundVisualBible(fallbackVisualBible(source), source.narration, source);
function workspace(bible = fresh()): ScriptWorkspace {
  return { ...createDefaultScriptWorkspace(), fullNarration: source.narration, lockedTitle: source.title,
    genrePackId: source.genre, visualBible: bible };
}
const analysis = { content_type: 'emotional_essay', narrative_perspective: 'first_person', confidence: 0.95,
  has_narrative_arc: true, entities: [] };

test('G01 有效响应版本变化仍可接收，旧请求及语言不符拒绝', async () => {
  const before = fresh();
  const response = await compileVisualBible({ ...source, previousBible: before, requestId: 'new' });
  assert.ok(receiveVisualBibleResponse({ ...source, requestId: 'new', bibleRevision: 'old-version' }, response));
  assert.equal(receiveVisualBibleResponse({ ...source, requestId: 'other' }, response), null);
  assert.equal(receiveVisualBibleResponse({ ...source, requestId: 'new', language: 'en' }, response), null);
});

test('G01 工作区异步操作：改稿/改锁/新请求/卸载都使旧提交无效', () => {
  const guard = createBibleOperationGuard();
  const original = workspace();
  const first = guard.start(original);
  assert.ok(guard.isCurrent(first, original));
  assert.equal(guard.isCurrent(first, { ...original, fullNarration: '另一篇稿' }), false);
  const locked = { ...original, visualBible: toggleCharacterLockFlag(original.visualBible!, original.visualBible!.characters[0].id, 'identity') };
  assert.equal(guard.isCurrent(first, locked), false);
  const second = guard.start(original);
  assert.equal(guard.isCurrent(first, original), false);
  assert.ok(guard.isCurrent(second, original));
  guard.cancel();
  assert.equal(guard.isCurrent(second, original), false);
});

test('G02 四个字段逐一修改、主动清空和 JSON 重载保持其余值', () => {
  const values = { look: '短发', wardrobe: '蓝衣', ageBand: '文案未明示', signature: '圆眼镜' };
  for (const key of Object.keys(values) as (keyof typeof values)[]) {
    let bible = fresh();
    const id = bible.characters[0].id;
    bible = updateCharacterField(bible, id, values);
    bible = updateCharacterField(bible, id, { [key]: '' });
    const loaded = normalizeScriptWorkspace(JSON.parse(JSON.stringify(workspace(bible)))).visualBible!;
    for (const field of Object.keys(values) as (keyof typeof values)[]) assert.equal(loaded.characters[0][field], field === key ? '' : values[field]);
    assert.equal(loaded.bibleRevision, bibleRevisionOf(loaded));
  }
});

test('G03 改显示名后，点名及后续代词都保留相同实体', () => {
  let bible = fresh();
  const id = bible.characters[0].id;
  bible = updateCharacterField(bible, id, { name: '小明同学' });
  const shots = ['王小明走进教室。', '他拿起课本。'].map((narration, i) => ({ id: String(i), narration, sliceText: narration,
    order: i + 1, start: 0, speechDuration: 2, holdDuration: 0, energy: 'medium', function: 'proof', coverageJob: 'evidence', visualIntent: '' } as any));
  const after = applyOccupancyAfterCoverage(shots, bible);
  assert.deepEqual(after.map(shot => shot.characterIds), [[id], [id]]);
});

test('G04 未变更的有效参考图请求正常落库，项目/实体/来源变化拒绝', () => {
  const bible = fresh();
  const character = bible.characters[0];
  const request = captureCharacterRefRequest('p1', bible, character);
  const accepted = applyCharacterRefResponse('p1', bible, request, ref)!;
  assert.ok(accepted);
  assert.equal(accepted.characters[0].refs[0].imageId, ref.imageId);
  assert.equal(accepted.characters[0].refsLocked, true);
  assert.equal(accepted.bibleRevision, bibleRevisionOf(accepted));
  assert.equal(applyCharacterRefResponse('p2', bible, request, ref), null);
  assert.equal(applyCharacterRefResponse('p1', { ...bible, sourceKey: 'other' }, request, ref), null);
  const swapped = { ...bible, characters: [{ ...character, entityId: 'another-person', candidateId: 'another-person' }] };
  assert.equal(applyCharacterRefResponse('p1', swapped, request, ref), null);
});

test('G04 请求中上传/清除参考图、改外形或切锁，旧图片不得写回', () => {
  const original = fresh();
  const id = original.characters[0].id;
  const bible = setCharacterRef(original, id, { ...ref, imageId: 'old.png' });
  const request = captureCharacterRefRequest('p1', bible, bible.characters[0]);
  const edits = [setCharacterRef(bible, id, ref), clearCharacterRef(bible, id),
    updateCharacterField(bible, id, { look: '新外形' }), toggleCharacterLockFlag(bible, id, 'identity')];
  for (const edited of edits) assert.equal(applyCharacterRefResponse('p1', edited, request, ref), null);
  const emptyRequest = captureCharacterRefRequest('p1', original, original.characters[0]);
  const backToEmpty = clearCharacterRef(setCharacterRef(original, id, ref), id);
  assert.equal(applyCharacterRefResponse('p1', backToEmpty, emptyRequest, ref), null);
});

test('G05 完整分析快照保存后重启缓存仍命中，换模型及强制重分析会重跑', async () => {
  resetVisualBibleServiceCache();
  const src = { ...source, narration: '我走进房间，然后我看向窗外。', model: 'a' };
  let calls = 0;
  const deps = { analyze: async () => { calls++; return analysis; } };
  const first = await compileVisualBible(src, deps);
  assert.equal(calls, 1);
  assert.ok(first.bible.analysisSnapshot);
  const saved = normalizeVisualBible(JSON.parse(JSON.stringify(first.bible)))!;
  resetVisualBibleServiceCache();
  await compileVisualBible({ ...src, previousBible: saved }, deps);
  assert.equal(calls, 1);
  await compileVisualBible({ ...src, model: 'b', previousBible: saved }, deps);
  assert.equal(calls, 2);
  await compileVisualBible({ ...src, forceReanalyse: true, previousBible: saved }, deps);
  assert.equal(calls, 3);
});

test('G05 分析失败明确降级且可重试，失败不得标记成功分析', async () => {
  resetVisualBibleServiceCache();
  const src = { ...source, narration: '我走进房间，然后我看向窗外。' };
  const failed = await compileVisualBible(src, { analyze: async () => { throw new Error('timeout'); } });
  assert.equal(failed.fallback, true);
  assert.equal(failed.diagnostics.analysisSource, 'rule_fallback');
  assert.equal(failed.bible.analysisSnapshot, undefined);
  const retry = await compileVisualBible({ ...src, previousBible: failed.bible }, { analyze: async () => analysis });
  assert.equal(retry.diagnostics.analysisCalls, 1);
  assert.equal(retry.diagnostics.analysisSource, 'llm');
});

test('G05 同时请求相同分析合并调用，完整实体快照不被丢弃', async () => {
  resetVisualBibleServiceCache();
  const src = { ...source, narration: '我遇到阿澈。阿澈打开房门，我走了进去。' };
  let resolve!: (value: unknown) => void;
  let calls = 0;
  const deps = { analyze: () => { calls++; return new Promise<unknown>(done => { resolve = done; }); } };
  const first = compileVisualBible(src, deps);
  const second = compileVisualBible(src, deps);
  assert.equal(calls, 1);
  resolve({ ...analysis, content_type: 'narrative_story', entities: [{ name: '阿澈', type: 'person', is_named: true,
    recurs_throughout: true, evidence: ['阿澈打开房门'] }] });
  const results = await Promise.all([first, second]);
  assert.ok(results.every(result => result.bible.analysisSnapshot?.entities.some(entity => entity.name === '阿澈')));
});

test('G05 英文来源语言、CRLF 和重复粘贴规范化保持一致', async () => {
  const src = { narration: 'John enters the room.\r\nHe opens the book.', title: 'Day', genre: '故事' as const, language: 'en' };
  const first = await compileVisualBible({ ...src, intentNotes: src.narration });
  const second = await compileVisualBible({ ...src, narration: src.narration.replace(/\r\n/g, '\n'), intentNotes: '' });
  assert.equal(first.bible.sourceKey, second.bible.sourceKey);
  assert.equal(first.bible.analysisCacheKey, second.bible.analysisCacheKey);
  assert.equal(isVisualBibleStale(first.bible, src.narration, src.genre, { title: src.title, intentNotes: src.narration }), false);
  assert.equal(first.bible.bibleRevision, bibleRevisionOf(first.bible));
});

test('G08 include/exclude/auto 多次切换并重载保留基础 pending 事实', () => {
  let bible = fallbackVisualBible(anonymous);
  const entityId = bible.pendingCharacters![0].entityId!;
  for (const decision of ['include', 'exclude', 'auto', 'include', 'auto'] as const) {
    bible = reduceBibleAction(bible, { type: 'set_entity_decision', entityId, decision });
    bible = normalizeVisualBible(JSON.parse(JSON.stringify(bible)))!;
    assert.equal(bible.entityLedger!.entities.find(entity => entity.id === entityId)!.analysisStatus, 'pending');
    assert.equal(bible.characters.some(card => card.entityId === entityId), decision === 'include');
    assert.equal(bible.pendingCharacters!.some(card => card.entityId === entityId), decision === 'auto');
  }
});

test('G08 旧工程没有基础状态字段时从原文恢复，已拒绝匿名角色可恢复自动', () => {
  let bible = fallbackVisualBible(anonymous);
  const pending = bible.pendingCharacters![0];
  bible = confirmPendingCharacter(bible, pending.id);
  bible.entityLedger!.entities.forEach(entity => { delete entity.analysisStatus; });
  const loaded = normalizeScriptWorkspace({ ...workspace(bible), fullNarration: anonymous.narration }).visualBible!;
  const restored = reduceBibleAction(loaded, { type: 'set_entity_decision', entityId: pending.entityId!, decision: 'auto' });
  assert.equal(restored.characters.length, 0);
  assert.ok(restored.pendingCharacters!.some(card => card.entityId === pending.entityId));
});

test('G08 排除角色的参考图保持资产引用，恢复自动仍可找回', () => {
  let bible = fresh();
  const id = bible.characters[0].id;
  const entityId = bible.characters[0].entityId!;
  bible = setCharacterRef(bible, id, ref);
  bible = reduceBibleAction(bible, { type: 'set_entity_decision', entityId, decision: 'exclude' });
  const project = projectForPersist({ id: 'p1', clips: [], audio: {}, settings: {}, scriptWorkspace: workspace(bible) } as any);
  assert.ok(collectReferencedAssetUrls(project).has('/generated/new.png'));
  const restored = reduceBibleAction(normalizeVisualBible(project.scriptWorkspace!.visualBible)!, { type: 'set_entity_decision', entityId, decision: 'auto' });
  assert.equal(restored.characters.find(card => card.entityId === entityId)!.refs[0].imageId, ref.imageId);
});

test('钉住快照换稿时保持完整事实和来源，显式重编才解钉', async () => {
  const bible = { ...normalizeVisualBible(fresh())!, pinned: true };
  let calls = 0;
  const result = await compileVisualBible({ ...source, narration: '李小红走进操场。', previousBible: bible }, {
    compileCards: async () => { calls++; return {}; }
  });
  assert.equal(calls, 0);
  assert.equal(result.bible.sourceKey, bible.sourceKey);
  assert.deepEqual(result.bible.entityLedger, bible.entityLedger);
  assert.deepEqual(result.bible.characters, bible.characters);
});
