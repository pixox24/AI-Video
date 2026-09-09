import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDurationBudget } from './scriptBudget';
import { planScriptSections } from './scriptSections';
import { outlineFromPlans } from './scriptOutline';
import { draftGate, runSectionedDraft, seedSectionsFromOutline } from './scriptDraftEngine';
import { SECTION_DRAFT_SYSTEM } from './scriptPrompts';

function beatFn(role: string) {
  if (role === 'hook') return 'hook';
  if (role === 'cta') return 'cta';
  if (role === 'reveal') return 'reveal';
  if (role === 'turn') return 'turn';
  if (role === 'proof' || role === 'body') return 'proof';
  return 'setup';
}

function validPiece(plan: { minUnits: number; maxUnits: number; title: string; role: string }, extra = '') {
  const unit = '这是一句可拍的口播内容。';
  let narration = `${plan.title}。`;
  while (narration.length < plan.minUnits) narration += unit;
  if (narration.length > plan.maxUnits) narration = narration.slice(0, plan.maxUnits);
  return {
    narration,
    usedEvidenceIds: [],
    beats: [{ function: beatFn(plan.role), narration, energy: 'medium', visualIntent: '主体站在窗边看着外面的雨', needsHold: false }]
  };
}

test('draftGate：短视频直写，中视频先提纲，长视频未确认拦截', () => {
  assert.equal(draftGate({ form: 'short' }).action, 'short');
  assert.equal(draftGate({ form: 'medium', outline: null }).action, 'outline_preview');
  const plans = planScriptSections({ targetSeconds: 120, maxChars: 400 });
  const outline = outlineFromPlans(plans, { status: 'draft' });
  assert.equal(draftGate({ form: 'medium', outline }).action, 'write-sections');
  assert.equal(draftGate({ form: 'long', outline }).action, 'outline_required');
  assert.equal(draftGate({ form: 'long', outline: { ...outline, status: 'confirmed' } }).action, 'write-sections');
});

test('mock LLM：第 4 章失败时前三章仍保留', async () => {
  const budget = buildDurationBudget({ targetSeconds: 240, pace: 'medium' });
  const plans = planScriptSections({ targetSeconds: 240, maxChars: budget.maxChars, genre: '科普' });
  const outline = { ...outlineFromPlans(plans), status: 'confirmed' as const };
  let calls = 0;
  const result = await runSectionedDraft({
    ask: async (user, _tokens, system) => {
      assert.equal(system, SECTION_DRAFT_SYSTEM);
      const plan = plans.find((item) => user.includes(item.id)) || plans[Math.min(calls, plans.length - 1)];
      calls += 1;
      if (plan.order === 4) return { narration: '短', beats: [{ narration: '短', function: 'setup' }] };
      return validPiece(plan);
    },
    plans,
    outline,
    maxTokens: 1024,
    system: SECTION_DRAFT_SYSTEM,
    language: 'zh',
    buildPrompt: (section) => `写 ${section.id}`
  });
  assert.equal(result.ok, false);
  assert.equal(result.failedSectionId, 'section-4');
  assert.ok(result.sections.length >= 3, `只剩 ${result.sections.length} 章`);
  assert.ok(result.sections.every((section) => section.id !== 'section-4' || section.status === 'failed'));
  assert.ok(result.sections.filter((section) => section.status === 'ready').length >= 3);
});

test('seedSectionsFromOutline 不覆盖 locked 章', () => {
  const plans = planScriptSections({ targetSeconds: 180, maxChars: 600, genre: '科普' });
  const outline = outlineFromPlans(plans);
  const locked = {
    ...seedSectionsFromOutline(plans, outline, [])[0],
    narration: '锁定正文。'.repeat(8),
    status: 'locked' as const
  };
  const seeded = seedSectionsFromOutline(plans, outline, [locked]);
  assert.equal(seeded[0].narration, locked.narration);
  assert.equal(seeded[0].status, 'locked');
});
