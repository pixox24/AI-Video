import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDurationBudget,
  budgetFromWordCount,
  estimatedShotCount,
  narrationFromBeats,
  predictShots,
  redistributeHolds,
  assignSceneIds
} from './scriptBudget';
import {
  MAX_VIDEO_SECONDS,
  MAX_FORECAST_SHOTS,
  MIN_VIDEO_SECONDS,
  TARGET_SECONDS_PRESETS,
  TRANSLATE_BATCH_SIZE,
  chunkItems,
  clampVideoSeconds,
  fillRatio,
  fillStatus,
  isLongForm,
  maxForecastShotsForDuration,
  maxUniqueScenesForDuration,
  outlineConfirmationRequired,
  resolveScriptForm,
  scriptFormForSeconds
} from './scriptDuration';
import { buildSpeechSpans, splitCompleteSentences } from './speechSpans';
import { fitTextChunksToCount, splitCoversSource, splitPastedNarration } from './scriptSplit';
import { planScriptSections } from './scriptSections';
import { coerceLlmDraftPayload, describeDraftPayloadGap, normalizeDraftBeats, validateDraftResult } from './scriptDraft';
import {
  addOutlineSection,
  buildRevisionPlan,
  draftNeedsOutlinePreview,
  draftRequiresOutline,
  mergeSectionIntoWorkspaceSections,
  moveOutlineSection,
  outlineFromPlans,
  removeOutlineSection,
  stampOutlineBudgets,
  updateOutlineSection,
  validateOutline
} from './scriptOutline';
import { createDefaultScriptWorkspace, normalizeScriptWorkspace, resumeLongformWorkspace } from './scriptWorkspace';
import type { ForecastShot, ScriptBeat } from '../types';

function maxSceneRun(shots: ForecastShot[]): number {
  let max = 0;
  let run = 0;
  let current: string | undefined;
  shots.forEach((shot) => {
    if (shot.sceneId === current) {
      run += 1;
    } else {
      current = shot.sceneId;
      run = 1;
    }
    if (run > max) max = run;
  });
  return max;
}

function chineseSentences(count: number): string {
  return Array.from({ length: count }, (_, index) => `这是第${index + 1}句用来测试长视频拆句和节拍映射的口播。`).join('');
}

test('ScriptForm 在 60/61/180/181/600/601 秒分层正确', () => {
  assert.equal(scriptFormForSeconds(60), 'short');
  assert.equal(scriptFormForSeconds(61), 'medium');
  assert.equal(scriptFormForSeconds(180), 'medium');
  assert.equal(scriptFormForSeconds(181), 'long');
  assert.equal(scriptFormForSeconds(600), 'long');
  assert.equal(scriptFormForSeconds(601), 'extended');
  assert.equal(outlineConfirmationRequired('long'), true);
  assert.equal(outlineConfirmationRequired('medium'), false);
  assert.equal(draftRequiresOutline('long', { status: 'draft', version: 1, oneSentenceThesis: '', sections: [] }), true);
  assert.equal(draftRequiresOutline('long', { status: 'confirmed', version: 1, oneSentenceThesis: '', sections: [] }), false);
  assert.equal(resolveScriptForm(30, 'long'), 'long');
  assert.equal(resolveScriptForm(240, null), 'long');
  assert.equal(draftNeedsOutlinePreview('medium', undefined), true);
  assert.equal(draftNeedsOutlinePreview('medium', { status: 'draft', version: 1, oneSentenceThesis: '', sections: [{ id: 'section-1' } as any] }), false);
  assert.equal(draftRequiresOutline('medium', { status: 'draft', version: 1, oneSentenceThesis: '', sections: [] }, true), true);
});

test('时长 120/180/181/300 秒不会被静默截回 180', () => {
  for (const seconds of [120, 180, 181, 240, 300]) {
    const budget = buildDurationBudget({ platform: 'douyin', pace: 'medium', targetSeconds: seconds });
    assert.equal(budget.targetSeconds, seconds, `${seconds}s 被改成了 ${budget.targetSeconds}`);
  }
  const clamped = clampVideoSeconds(2000);
  assert.equal(clamped.seconds, MAX_VIDEO_SECONDS);
  assert.equal(clamped.clamped, true);
  const low = clampVideoSeconds(3);
  assert.equal(low.seconds, MIN_VIDEO_SECONDS);
  assert.ok(TARGET_SECONDS_PRESETS.includes(180));
  assert.ok(TARGET_SECONDS_PRESETS.includes(300));
});

test('平台推荐范围不是硬上限', () => {
  const budget = buildDurationBudget({ platform: 'douyin', pace: 'medium', targetSeconds: 300 });
  assert.equal(budget.targetSeconds, 300);
  assert.equal(isLongForm(300), true);
  assert.equal(isLongForm(60), false);
});

test('内容反推时长也不再封顶 180 秒', () => {
  const chars = 2000;
  const budget = budgetFromWordCount(chars, 'douyin', 'medium', 1, 'zh');
  assert.ok(budget.targetSeconds > 180, `反推只有 ${budget.targetSeconds}s`);
  assert.ok(budget.targetSeconds <= MAX_VIDEO_SECONDS);
});

test('英文句号能拆成两句，且不会变成双句号', () => {
  const sentences = splitCompleteSentences('First sentence. Second sentence.', 'en');
  assert.deepEqual(sentences, ['First sentence.', 'Second sentence.']);
  const spans = buildSpeechSpans('First sentence. Second sentence.', undefined, 'en');
  assert.equal(spans.length, 2);
  assert.equal(spans[0].text, 'First sentence.');
  assert.equal(spans[1].text, 'Second sentence.');
});

test('5 句话配 2 个节拍时第 2–5 句不会全部变成 cta', () => {
  const narration = '第一句钩子。第二句铺垫。第三句转折。第四句证据。第五句收束。';
  const beats: ScriptBeat[] = [
    { id: 'beat-1', order: 1, function: 'hook', intent: '', narration: '第一句钩子。第二句铺垫。第三句转折。', targetSeconds: 10, energy: 'fast', visualIntent: '', needsHold: false },
    { id: 'beat-2', order: 2, function: 'cta', intent: '', narration: '第四句证据。第五句收束。', targetSeconds: 8, energy: 'hold', visualIntent: '', needsHold: true }
  ];
  const spans = buildSpeechSpans(narration, beats, 'zh');
  assert.equal(spans.length, 5);
  assert.equal(spans[0].function, 'hook');
  assert.equal(spans[1].function, 'hook');
  assert.equal(spans[2].function, 'hook');
  assert.equal(spans[3].function, 'cta');
  assert.equal(spans[4].function, 'cta');
});

test('80 句配 6 个节拍时后文不会全部变成 cta', () => {
  const narration = chineseSentences(80);
  const beats: ScriptBeat[] = [
    { id: 'beat-1', order: 1, function: 'hook', intent: '', narration: '', targetSeconds: 20, energy: 'fast', visualIntent: '', needsHold: false },
    { id: 'beat-2', order: 2, function: 'setup', intent: '', narration: '', targetSeconds: 30, energy: 'medium', visualIntent: '', needsHold: false },
    { id: 'beat-3', order: 3, function: 'turn', intent: '', narration: '', targetSeconds: 30, energy: 'fast', visualIntent: '', needsHold: false },
    { id: 'beat-4', order: 4, function: 'proof', intent: '', narration: '', targetSeconds: 40, energy: 'medium', visualIntent: '', needsHold: false },
    { id: 'beat-5', order: 5, function: 'reveal', intent: '', narration: '', targetSeconds: 30, energy: 'slow', visualIntent: '', needsHold: true },
    { id: 'beat-6', order: 6, function: 'cta', intent: '', narration: '', targetSeconds: 30, energy: 'hold', visualIntent: '', needsHold: true }
  ];
  const spans = buildSpeechSpans(narration, beats, 'zh');
  assert.equal(spans.length, 80);
  const ctaCount = spans.filter((span) => span.function === 'cta').length;
  assert.ok(ctaCount < 20, `cta 过多：${ctaCount}`);
  assert.equal(spans[0].function, 'hook');
  assert.ok(spans[20].function !== 'cta');
  assert.ok(spans[40].beatId);
});

test('快速拆镜不再静默丢掉后文', () => {
  const text = chineseSentences(24);
  const split = splitPastedNarration(text, 'zh');
  assert.equal(splitCoversSource(split.chunks, text), true);
  assert.ok(split.chunks.length > 8, `只剩 ${split.chunks.length} 段`);
  assert.ok(split.chunks.join('').includes('第24句'));
});

test('镜数范围不再倒置，锁镜数会真正切到目标数', () => {
  const medium120 = estimatedShotCount(buildDurationBudget({ pace: 'medium', targetSeconds: 120 }));
  const medium180 = estimatedShotCount(buildDurationBudget({ pace: 'medium', targetSeconds: 180 }));
  assert.ok(medium120.min <= medium120.max, `120s 范围倒置 ${medium120.min}-${medium120.max}`);
  assert.ok(medium180.min <= medium180.max, `180s 范围倒置 ${medium180.min}-${medium180.max}`);
  assert.ok(medium180.axis >= 40 && medium180.axis <= 55, `180s 中轴 ${medium180.axis} 不在 40–55`);

  const locked = buildDurationBudget({ pace: 'medium', targetSeconds: 90, lockedShotCount: 12 });
  const estimate = estimatedShotCount(locked);
  assert.deepEqual(estimate, { axis: 12, min: 12, max: 12 });
  const narration = chineseSentences(18);
  const shots = predictShots({
    narration,
    budget: { ...locked, usedChars: narration.replace(/\s+/g, '').length }
  });
  assert.equal(shots.length, 12);
});

test('超过 60 条翻译会按 24 条分批', () => {
  const batches = chunkItems(Array.from({ length: 80 }, (_, index) => index), TRANSLATE_BATCH_SIZE);
  assert.equal(batches.length, 4);
  assert.equal(batches[0].length, 24);
  assert.equal(batches[3].length, 8);
});

test('长视频进入章节模式，短稿 fallback 不能当成功稿', () => {
  const plans = planScriptSections({ targetSeconds: 180, maxChars: 658 });
  assert.ok(plans.length >= 6);
  assert.ok(plans[0].role === 'hook');
  assert.ok(plans[plans.length - 1].role === 'cta');
  const seconds = plans.reduce((sum, plan) => sum + plan.targetSeconds, 0);
  assert.ok(Math.abs(seconds - 180) < 2, `章节秒数合计 ${seconds}`);

  const rejected = validateDraftResult({
    fullNarration: '你以为你懂这件事，其实关键不在那儿。先把最常见的误会拿掉。',
    beats: [
      { id: 'a', order: 1, function: 'hook', intent: '', narration: '钩子。', targetSeconds: 3, energy: 'fast', visualIntent: '', needsHold: false },
      { id: 'b', order: 2, function: 'cta', intent: '', narration: '收束。', targetSeconds: 3, energy: 'hold', visualIntent: '', needsHold: true }
    ],
    maxChars: 658,
    targetSeconds: 180,
    source: 'llm'
  });
  assert.equal(rejected.ok, false);
  assert.ok(fillRatio(80, 658) < 0.9);
  assert.equal(fillStatus(658, 658), 'ok');
});

test('合法节拍可跨章节角色组合，不因标签组合拒绝', () => {
  const plans = planScriptSections({ targetSeconds: 180, maxChars: 658 });
  const sections = plans.map((plan, index) => ({
    ...plan,
    narration: index === 0 ? '短章' : '长内容。'.repeat(Math.ceil(plan.maxUnits / 4)),
    beats: [{
      id: `${plan.id}-beat`,
      order: 1,
      function: 'setup' as const,
      intent: '',
      narration: index === 0 ? '短章' : '长内容。'.repeat(Math.ceil(plan.maxUnits / 4)),
      targetSeconds: plan.targetSeconds,
      energy: 'medium' as const,
      visualIntent: '',
      needsHold: false,
      sectionId: plan.id
    }]
  }));
  const fullNarration = sections.map((section) => section.narration).join('');
  const result = validateDraftResult({
    fullNarration,
    beats: sections.flatMap((section) => section.beats),
    sections,
    maxChars: 658,
    targetSeconds: 180,
    scriptLanguage: 'zh',
    source: 'llm'
  });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => warning.includes('第 1 章')));
});

test('有章节时不应把 7 章误报成短视频节拍', () => {
  const plans = planScriptSections({ targetSeconds: 180, maxChars: 658 });
  const sections = plans.map((plan) => ({
    ...plan,
    narration: '完整章节口播。'.repeat(Math.ceil(plan.maxUnits / 7)),
    beats: [{
      id: `${plan.id}-beat`,
      order: 1,
      function: 'setup' as const,
      intent: '',
      narration: '完整章节口播。'.repeat(Math.ceil(plan.maxUnits / 7)),
      targetSeconds: plan.targetSeconds,
      energy: 'medium' as const,
      visualIntent: '',
      needsHold: false,
      sectionId: plan.id
    }]
  }));
  const result = validateDraftResult({
    fullNarration: sections.map((section) => section.narration).join(''),
    beats: sections.flatMap((section) => section.beats),
    sections,
    maxChars: 658,
    targetSeconds: 180,
    scriptLanguage: 'zh',
    source: 'llm'
  });
  assert.ok(!result.warnings.some((warning) => warning.includes('短视频节拍数量')));
});

test('故事型长视频会使用转折章节而不是通用证明模板', () => {
  const generic = planScriptSections({ targetSeconds: 180, maxChars: 658, genre: '科普' });
  const story = planScriptSections({ targetSeconds: 180, maxChars: 658, genre: '故事' });
  assert.equal(generic.some((section) => section.role === 'turn'), false);
  assert.equal(story.some((section) => section.role === 'turn'), true);
});

test('目标镜头数拆分保持全文覆盖并受资源上限保护', () => {
  const source = chineseSentences(24);
  const split = splitPastedNarration(source, 'zh');
  const fitted = fitTextChunksToCount(split.chunks, 12, 'zh');
  assert.equal(fitted.length, 12);
  assert.equal(splitCoversSource(fitted, source), true);
  assert.ok(maxForecastShotsForDuration(1800) <= MAX_FORECAST_SHOTS);
  const narration = chineseSentences(400);
  const budget = buildDurationBudget({ pace: 'medium', targetSeconds: 1800, usedChars: narration.length });
  const shots = assignSceneIds(predictShots({ narration, budget, scriptLanguage: 'zh' }), budget);
  assert.ok(shots.length <= MAX_FORECAST_SHOTS);
  const stride = Math.max(2, Math.ceil(shots.length / maxUniqueScenesForDuration(1800)));
  assert.ok(maxSceneRun(shots) <= stride, `同场景连续镜 ${maxSceneRun(shots)} 超过硬上限 ${stride}`);
});

test('预算字段迁移出 targetUnits/minUnits/maxUnits', () => {
  const zh = buildDurationBudget({ platform: 'douyin', pace: 'medium', targetSeconds: 30, scriptLanguage: 'zh' });
  assert.equal(zh.targetUnits, zh.maxChars);
  assert.ok((zh.minUnits || 0) <= (zh.targetUnits || 0));
  assert.ok((zh.maxUnits || 0) >= (zh.targetUnits || 0));
  const en = buildDurationBudget({ platform: 'youtube', pace: 'medium', targetSeconds: 30, scriptLanguage: 'en' });
  assert.ok((en.targetUnits || 0) < (zh.targetUnits || 0));
  const old = normalizeScriptWorkspace({
    ...createDefaultScriptWorkspace(),
    durationBudget: { ...zh, maxChars: 120 }
  });
  assert.equal(old.scriptForm, 'short');
  assert.equal(old.durationBudget.targetUnits, old.durationBudget.maxChars);
});

test('章节预算总和与全片目标误差不超过 1', () => {
  for (const seconds of [90, 180, 181, 300, 600]) {
    const budget = buildDurationBudget({ platform: 'douyin', pace: 'medium', targetSeconds: seconds });
    const plans = planScriptSections({ targetSeconds: seconds, maxChars: budget.maxChars, genre: '科普' });
    const sum = plans.reduce((total, plan) => total + plan.targetUnits, 0);
    assert.ok(Math.abs(sum - budget.maxChars) <= 1, `${seconds}s 合计 ${sum} vs ${budget.maxChars}`);
    assert.ok(plans[0].role === 'hook');
    assert.ok(plans[plans.length - 1].role === 'cta');
    assert.ok(plans[0].targetSeconds <= 12, `${seconds}s 钩子过长 ${plans[0].targetSeconds}`);
  }
});

test('outline 缺章、未知 evidence、预算失衡必须失败', () => {
  const budget = buildDurationBudget({ targetSeconds: 240, pace: 'medium' });
  const plans = planScriptSections({ targetSeconds: 240, maxChars: budget.maxChars, genre: '科普' });
  const outline = outlineFromPlans(plans, { status: 'draft' });
  const missing = { ...outline, sections: outline.sections.slice(1) };
  assert.equal(validateOutline(missing, undefined, budget).ok, false);
  const dup = { ...outline, sections: [...outline.sections, outline.sections[0]] };
  assert.equal(validateOutline(dup, undefined, budget).ok, false);
  const badEvidence = {
    ...outline,
    sections: outline.sections.map((section, index) => index === 0 ? { ...section, evidenceIds: ['missing-1'] } : section)
  };
  assert.equal(validateOutline(badEvidence, { audience: '', coreQuestion: '', coreConclusion: '', evidence: [], forbiddenClaims: [], requiredTerms: [] }, budget).ok, false);
  const stamped = stampOutlineBudgets(outline, plans, plans.map((plan) => ({ id: plan.id, title: plan.title })));
  const ok = validateOutline(stamped, { audience: '', coreQuestion: '', coreConclusion: '', evidence: [], forbiddenClaims: [], requiredTerms: [] }, budget);
  assert.equal(ok.ok, true, ok.warnings.join(';'));
});

test('locked 章节不会进入 revision plan', () => {
  const budget = buildDurationBudget({ targetSeconds: 240, pace: 'medium' });
  const plans = planScriptSections({ targetSeconds: 240, maxChars: budget.maxChars, genre: '科普' });
  const outline = outlineFromPlans(plans);
  outline.sections = outline.sections.map((section) => (
    section.role === 'body' || section.role === 'proof'
      ? { ...section, status: section.order === 3 ? 'locked' : 'ready' }
      : section
  ));
  const plan = buildRevisionPlan({
    measuredSeconds: 260,
    targetSeconds: 240,
    outline
  });
  assert.ok(!plan.sectionActions.some((action) => action.sectionId === 'section-3'));
  assert.ok(!plan.sectionActions.some((action) => {
    const section = outline.sections.find((item) => item.id === action.sectionId);
    return section?.role === 'hook' || section?.role === 'cta';
  }));
  assert.ok(plan.sectionActions.length > 0);
});

test('content-driven 低于目标预算不会被当成生成失败', () => {
  const result = validateDraftResult({
    fullNarration: '已有文案先保留。第二句把机制讲完。',
    beats: [
      { id: 'a', order: 1, function: 'hook', narration: '已有文案先保留。' },
      { id: 'b', order: 2, function: 'cta', narration: '第二句把机制讲完。' }
    ],
    maxChars: 658,
    targetSeconds: 180,
    scriptLanguage: 'zh',
    source: 'llm',
    durationMode: 'content-driven'
  } as any);
  assert.equal(result.ok, true);
});

test('目标驱动稿件超出 105% 保留草稿并提示', () => {
  const result = validateDraftResult({
    fullNarration: '字'.repeat(720),
    beats: [
      { id: 'a', order: 1, function: 'hook', narration: '字'.repeat(360) },
      { id: 'b', order: 2, function: 'cta', narration: '字'.repeat(360) }
    ],
    maxChars: 658,
    targetSeconds: 180,
    scriptLanguage: 'zh',
    source: 'llm'
  } as any);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some(warning => warning.includes('超出预算')));
});

test('60秒短视频超预算7%只警告不整稿丢弃', () => {
  const maxChars = 200;
  const used = Math.round(maxChars * 1.07);
  const narration = '字'.repeat(used);
  const mid = Math.floor(used / 2);
  const result = validateDraftResult({
    fullNarration: narration,
    beats: [
      { id: 'a', order: 1, function: 'hook', narration: narration.slice(0, mid) },
      { id: 'b', order: 2, function: 'cta', narration: narration.slice(mid) }
    ],
    maxChars,
    targetSeconds: 60,
    scriptLanguage: 'zh',
    source: 'llm',
    durationMode: 'target-driven'
  } as any);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((item) => /超出预算/.test(item)));
});

test('英文 beat 合并时保留词间空格', () => {
  const narration = narrationFromBeats([
    { id: 'a', order: 1, function: 'hook', intent: '', narration: 'First sentence.', targetSeconds: 3, energy: 'fast', visualIntent: '', needsHold: false },
    { id: 'b', order: 2, function: 'cta', intent: '', narration: 'Second sentence.', targetSeconds: 3, energy: 'hold', visualIntent: '', needsHold: true }
  ], 'en');
  assert.equal(narration, 'First sentence. Second sentence.');
});

test('预测镜会带停留，口播加停留才能靠近目标时长', () => {
  const narration = '钩子先抛出一个缺口。中间把机制讲清楚。最后回收开场那一句。';
  const budget = buildDurationBudget({
    pace: 'medium',
    targetSeconds: 30,
    usedChars: 0
  });
  const shots = predictShots({
    narration,
    budget: { ...budget, usedChars: budget.maxChars, durationMode: 'target-driven' }
  });
  const hold = shots.reduce((sum, shot) => sum + shot.holdDuration, 0);
  const speech = shots.reduce((sum, shot) => sum + shot.speechDuration, 0);
  assert.ok(hold > 0.4, `停留仍是 0：${hold}`);
  assert.ok(speech + hold > speech, '总长应大于纯口播');
  const scenes = new Set(assignSceneIds(shots, budget).map((shot) => shot.sceneId).filter(Boolean));
  assert.ok(scenes.size > 0);
});

test('同场景连续镜受硬上限保护，location/continuity 变化会切场景', () => {
  const makeShot = (over: Partial<ForecastShot>): ForecastShot => ({
    id: 'shot',
    order: 1,
    start: 0,
    speechDuration: 2,
    holdDuration: 0,
    energy: 'medium',
    function: 'setup',
    visualIntent: '',
    narration: '',
    splitReason: '',
    ...over
  });
  const budget = buildDurationBudget({ pace: 'medium', targetSeconds: 30 });
  const flat = Array.from({ length: 10 }, (_, index) => makeShot({ id: `s${index}`, order: index + 1 }));
  const grouped = assignSceneIds(flat, budget);
  const stride = Math.max(2, Math.ceil(flat.length / maxUniqueScenesForDuration(30)));
  assert.ok(maxSceneRun(grouped) <= stride, `同场景连续镜 ${maxSceneRun(grouped)} 超过硬上限 ${stride}`);

  const moved = assignSceneIds([
    makeShot({ id: 'a', order: 1, locationId: 'loc-a' }),
    makeShot({ id: 'b', order: 2, locationId: 'loc-a' }),
    makeShot({ id: 'c', order: 3, locationId: 'loc-b' })
  ], budget);
  assert.equal(moved[0].sceneId, moved[1].sceneId);
  assert.notEqual(moved[1].sceneId, moved[2].sceneId);

  const contrast = assignSceneIds([
    makeShot({ id: 'a', order: 1, locationId: 'loc-a' }),
    makeShot({ id: 'b', order: 2, locationId: 'loc-a', continuity: 'contrast' })
  ], budget);
  assert.notEqual(contrast[0].sceneId, contrast[1].sceneId);
});

test('提纲可上移增删并重算预算，锁定章编辑不改状态', () => {
  const budget = buildDurationBudget({ targetSeconds: 240, pace: 'medium' });
  const plans = planScriptSections({ targetSeconds: 240, maxChars: budget.maxChars, genre: '科普' });
  let outline = outlineFromPlans(plans);
  const before = outline.sections[0].id;
  outline = moveOutlineSection(outline, outline.sections[1].id, -1, budget);
  assert.equal(outline.sections[0].order, 1);
  const added = addOutlineSection(outline, outline.sections[0].id, budget);
  assert.ok(added.sections.length === outline.sections.length + 1);
  const sum = added.sections.reduce((total, section) => total + section.targetUnits, 0);
  assert.ok(Math.abs(sum - budget.maxChars) <= 1);
  const locked = { ...outline, sections: outline.sections.map((section, index) => index === 0 ? { ...section, status: 'locked' as const } : section) };
  const edited = updateOutlineSection(locked, locked.sections[0].id, { title: '新标题' });
  assert.equal(edited.sections[0].status, 'locked');
  const removed = removeOutlineSection(added, added.sections[1].id, budget);
  assert.ok(removed.sections.length === added.sections.length - 1);
  void before;
});

test('停留二次分配不给无口播镜头补时长，needsHold 权重更高', () => {
  const budget = buildDurationBudget({ targetSeconds: 30, pace: 'medium' });
  const shots = redistributeHolds([
    { id: 'shot-1', order: 1, start: 0, speechDuration: 3, holdDuration: 0, energy: 'fast', function: 'hook', visualIntent: '', narration: '钩子', splitReason: '', beatId: 'a' },
    { id: 'shot-2', order: 2, start: 3, speechDuration: 0, holdDuration: 8, energy: 'hold', function: 'setup', visualIntent: '', narration: '', splitReason: 'empty' },
    { id: 'shot-3', order: 3, start: 3, speechDuration: 4, holdDuration: 0, energy: 'medium', function: 'cta', visualIntent: '', narration: '收束', splitReason: '', beatId: 'b' }
  ] as any, budget, [
    { id: 'a', order: 1, function: 'hook', intent: '', narration: '钩子', targetSeconds: 3, energy: 'fast', visualIntent: '', needsHold: false },
    { id: 'b', order: 2, function: 'cta', intent: '', narration: '收束', targetSeconds: 4, energy: 'hold', visualIntent: '', needsHold: true }
  ]);
  assert.equal(shots[1].holdDuration, 0);
  assert.ok(shots[2].holdDuration > shots[0].holdDuration);
});

test('锁定章节不会被后续 merge 覆盖，失败隔离成立', () => {
  const locked = {
    id: 'section-1',
    order: 1,
    role: 'hook' as const,
    title: '钩子',
    targetSeconds: 8,
    minUnits: 12,
    maxUnits: 40,
    narration: '已锁定正文。',
    beats: [],
    status: 'locked' as const
  };
  const incoming = { ...locked, narration: '不该写进去。', status: 'ready' as const };
  const merged = mergeSectionIntoWorkspaceSections([locked], incoming);
  assert.equal(merged[0].narration, '已锁定正文。');
  assert.equal(merged[0].status, 'locked');
});

test('刷新后恢复到未完成章节而不是意图页', () => {
  const budget = buildDurationBudget({ targetSeconds: 240, pace: 'medium' });
  const plans = planScriptSections({ targetSeconds: 240, maxChars: budget.maxChars, genre: '科普' });
  const outline = outlineFromPlans(plans);
  outline.status = 'confirmed';
  outline.sections[0] = { ...outline.sections[0], status: 'ready' };
  const workspace = resumeLongformWorkspace({
    ...createDefaultScriptWorkspace(),
    durationBudget: budget,
    scriptForm: 'long',
    stage: 'copy',
    outline,
    sections: [{
      id: 'section-1',
      order: 1,
      role: 'hook',
      title: '开场钩子',
      targetSeconds: 8,
      minUnits: 12,
      maxUnits: 40,
      narration: '已写完的钩子口播在这里。'.repeat(2),
      beats: [],
      status: 'ready'
    }]
  });
  assert.equal(workspace.stage, 'beats');
  assert.equal(workspace.activeSectionId, 'section-2');
});

test('短稿兼容自定义 LLM 的别名字段和缺 beats', () => {
  const narration = '你以为这事很简单，其实关键在中间那一下。看清这一点，后面就好办。';
  const snake = coerceLlmDraftPayload({
    title: '别名稿',
    full_narration: narration,
    scenes: [
      { text: '你以为这事很简单，其实关键在中间那一下。' },
      { line: '看清这一点，后面就好办。' }
    ]
  });
  assert.ok(snake);
  assert.equal(snake?.fullNarration, narration);
  assert.ok((snake?.beats.length || 0) >= 2);

  const nested = coerceLlmDraftPayload({
    data: {
      title: '嵌套稿',
      narration,
      clips: [
        { content: '你以为这事很简单，其实关键在中间那一下。' },
        { 口播: '看清这一点，后面就好办。' }
      ]
    }
  });
  assert.ok(nested);
  assert.equal(nested?.title, '嵌套稿');
  assert.ok((nested?.beats.length || 0) >= 2);

  const onlyCopy = coerceLlmDraftPayload({ script: narration });
  assert.ok(onlyCopy);
  assert.equal(onlyCopy?.fullNarration, narration);
  assert.ok((onlyCopy?.beats.length || 0) >= 2);
  assert.equal(
    splitCoversSource(onlyCopy!.beats.map((beat) => beat.narration), onlyCopy!.fullNarration),
    true
  );

  const onlyBeats = coerceLlmDraftPayload({
    beats: [
      { narration: '你以为这事很简单，其实关键在中间那一下。' },
      { narration: '看清这一点，后面就好办。' }
    ]
  });
  assert.ok(onlyBeats);
  assert.ok(onlyBeats!.fullNarration.includes('你以为这事很简单'));
  assert.equal(onlyBeats!.beats.length, 2);

  const aliasedBeats = normalizeDraftBeats([{ text: '钩子口播。' }, { content: '收束口播。' }]);
  assert.equal(aliasedBeats.length, 2);
  assert.equal(aliasedBeats[0].function, 'hook');

  const gap = describeDraftPayloadGap({ title: '空壳', summary: '没有稿' });
  assert.match(gap, /没有口播和节拍字段/);
  assert.match(gap, /title/);
  assert.equal(coerceLlmDraftPayload({ title: '空壳' }), null);
});
