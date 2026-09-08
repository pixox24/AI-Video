import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDurationBudget,
  budgetFromWordCount,
  estimatedShotCount,
  narrationFromBeats,
  predictShots
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
  maxUniqueScenesForDuration
} from './scriptDuration';
import { buildSpeechSpans, splitCompleteSentences } from './speechSpans';
import { fitTextChunksToCount, splitCoversSource, splitPastedNarration } from './scriptSplit';
import { planScriptSections } from './scriptSections';
import { validateDraftResult } from './scriptDraft';
import type { ScriptBeat } from '../types';

function chineseSentences(count: number): string {
  return Array.from({ length: count }, (_, index) => `这是第${index + 1}句用来测试长视频拆句和节拍映射的口播。`).join('');
}

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

test('章节字数和 beat 覆盖不合格时必须拒绝', () => {
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
  assert.equal(result.ok, false);
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
  const shots = predictShots({ narration, budget, scriptLanguage: 'zh' });
  assert.ok(shots.length <= MAX_FORECAST_SHOTS);
  assert.ok(new Set(shots.map((shot) => shot.sceneId)).size <= maxUniqueScenesForDuration(1800));
});

test('目标驱动稿件超出 105% 也不能通过校验', () => {
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
  assert.equal(result.ok, false);
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
  const scenes = new Set(shots.map((shot) => shot.sceneId).filter(Boolean));
  assert.ok(scenes.size > 0);
});
