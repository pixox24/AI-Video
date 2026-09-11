import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyContentBrief, canEnterOutline, preserveBriefLocks } from './contentBrief';
import { contentBriefDraftSchema, contentBriefSchema, durationSpecSchema } from '../shared/contentBrief';
import { durationSpecForPreset, durationSpecForm, applyDurationSpec, estimateNarrationSeconds } from '../../src-server/duration/engine';
import { buildDurationBudget, PLATFORM_OPTIONS } from './scriptBudget';
import { createDefaultScriptWorkspace, normalizeScriptWorkspace, refreshWorkspaceDerived, stageCompleted } from './scriptWorkspace';
import { paceUnitsPerSecond } from './scriptLanguage';
import type { ScriptPace } from '../types';

test('promise gate rejects missing, empty and whitespace, accepts an explicit promise', () => {
  assert.equal(canEnterOutline({}), false);
  for (const viewerPromise of ['', '   ', '\n']) assert.equal(canEnterOutline({ contentBrief: { ...emptyContentBrief(), viewerPromise } }), false);
  assert.equal(canEnterOutline({ contentBrief: { ...emptyContentBrief(), viewerPromise: '学会制定计划' } }), true);
  assert.equal(emptyContentBrief('睡眠').topic, '睡眠');
});
test('strict schema distinguishes editable drafts from complete generated briefs', () => {
  assert.ok(contentBriefDraftSchema.safeParse(emptyContentBrief()).success);
  assert.equal(contentBriefSchema.safeParse(emptyContentBrief()).success, false);
  assert.equal(contentBriefDraftSchema.safeParse({ ...emptyContentBrief(), invented: 1 }).success, false);
  assert.equal(contentBriefDraftSchema.safeParse({ ...emptyContentBrief(), lockedFields: ['audience.roles'] }).success, false);
});
test('all supported brief locks survive regeneration and preserve the input', () => {
  const previous = { ...emptyContentBrief('旧主题'), audience: { roles: ['原受众'], knowledgeLevel: 'advanced' as const, primaryNeed: '需求' }, objective: '原目标', viewerPromise: '原承诺', mustCover: ['证据'], mustAvoid: ['杜撰'], writingStyleId: 'pundit', lockedFields: ['topic', 'audience', 'objective', 'viewerPromise', 'contentType', 'mustCover', 'mustAvoid', 'writingStyleId'] as const };
  const input = { ...previous, lockedFields: [...previous.lockedFields] };
  assert.deepEqual(preserveBriefLocks(input, emptyContentBrief('新主题')), input);
  const unlocked = preserveBriefLocks(undefined, { ...input });
  assert.deepEqual(unlocked.lockedFields, []);
  assert.equal(input.lockedFields.length, 8);
});
test('writingStyleId is a user choice: absent by default, lockable, and never overwritten by regeneration', () => {
  assert.equal('writingStyleId' in emptyContentBrief(), false);
  assert.equal(contentBriefDraftSchema.safeParse({ ...emptyContentBrief(), writingStyleId: 'pundit' }).success, true);
  assert.equal(contentBriefDraftSchema.safeParse({ ...emptyContentBrief(), writingStyleId: '' }).success, false);
  assert.equal(contentBriefDraftSchema.safeParse({ ...emptyContentBrief(), lockedFields: ['writingStyleId'] }).success, true);
  const generated = { ...emptyContentBrief('新主题'), viewerPromise: '新承诺' };
  assert.equal(preserveBriefLocks(undefined, generated).writingStyleId, undefined);
  const chosen = { ...generated, writingStyleId: 'analyst' };
  assert.equal(preserveBriefLocks(chosen, generated).writingStyleId, 'analyst');
  assert.equal(preserveBriefLocks({ ...chosen, lockedFields: ['writingStyleId'] }, generated).writingStyleId, 'analyst');
  assert.deepEqual(normalizeScriptWorkspace({ ...createDefaultScriptWorkspace(), contentBrief: chosen }).contentBrief, chosen);
});
test('duration presets map forms and reject invalid bounds, pace and extra fields', () => {
  assert.equal(durationSpecForm(durationSpecForPreset('insight')), 'long');
  assert.equal(durationSpecForm(durationSpecForPreset('deep_dive')), 'extended');
  assert.equal(durationSpecForm({ ...durationSpecForPreset('deep_dive'), targetSeconds: 600 }), 'long');
  assert.equal(durationSpecForm(durationSpecForPreset('tutorial')), 'extended');
  assert.equal(durationSpecForPreset('tutorial', 'slow', 'tutorial').narrationRatio, 0.65);
  const spec = durationSpecForPreset('deep_dive');
  for (const patch of [{ maxSeconds: 1801 }, { targetSeconds: 599 }, { minSeconds: 901 }, { narrationRatio: 0 }, { pace: 'standard' }, { extra: 1 }]) assert.equal(durationSpecSchema.safeParse({ ...spec, ...patch }).success, false);
});
test('new duration layer shares all five language rates and leaves the legacy budget intact', () => {
  const budget = buildDurationBudget({ targetSeconds: 750, pace: 'medium' });
  assert.equal(budget.speechSeconds, 637.5);
  const adapted = applyDurationSpec(budget, durationSpecForPreset('deep_dive'));
  assert.equal(adapted.speechSeconds, 600);
  assert.equal(adapted.maxChars, 2580);
  assert.equal(budget.speechSeconds, 637.5);
  for (const language of ['zh', 'en'] as const) for (const pace of ['ultrafast', 'fast', 'medium', 'slow', 'cinematic'] as ScriptPace[]) {
    const text = language === 'zh' ? '中文测试' : 'one two three four';
    assert.equal(estimateNarrationSeconds(text, language, pace), 4 / paceUnitsPerSecond(pace, language));
  }
  assert.equal(paceUnitsPerSecond('medium', 'zh'), 4.3);
  assert.equal(paceUnitsPerSecond('medium', 'en'), 2.5);
  assert.equal(estimateNarrationSeconds('', 'zh', 'medium'), 0);
});
test('workspace round trip retains both brief types, locks and spec', () => {
  const workspace = createDefaultScriptWorkspace();
  workspace.contentBrief = { ...emptyContentBrief('睡眠'), viewerPromise: '改善决策', lockedFields: ['viewerPromise'] };
  workspace.durationSpec = durationSpecForPreset('deep_dive');
  const restored = refreshWorkspaceDerived(normalizeScriptWorkspace(JSON.parse(JSON.stringify(workspace))));
  assert.deepEqual(restored.contentBrief, workspace.contentBrief);
  assert.deepEqual(restored.durationSpec, workspace.durationSpec);
  assert.equal(restored.durationBudget.targetSeconds, 750);
  assert.equal(stageCompleted(restored, 'brief'), true);
  assert.equal(restored.brief, workspace.brief);
});
test('only YouTube platform upper limit expands', () => {
  assert.deepEqual(PLATFORM_OPTIONS.map(p => [p.id, p.max]), [['douyin', 60], ['shipinhao', 60], ['reels', 45], ['bilibili', 90], ['youtube', 1800]]);
});
