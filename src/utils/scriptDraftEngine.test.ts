import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDurationBudget } from './scriptBudget';
import { planScriptSections } from './scriptSections';
import { outlineFromPlans, validateSectionAgainstOutline } from './scriptOutline';
import { draftGate, draftOneSection, runSectionedDraft, seedSectionsFromOutline } from './scriptDraftEngine';
import { SECTION_DRAFT_SYSTEM, sectionDraftUserPrompt, sectionReviseUserPrompt } from './scriptPrompts';

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
      if (plan.order === 4) return { narration: '正文', beats: [{ narration: '遗漏正文', function: 'setup' }] };
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


test('104字草稿以软提示保留；空正文、证据、节拍错误仍拒绝；最后一次重试可采用', async () => {
  const plans = planScriptSections({ targetSeconds: 240, maxChars: 1000 });
  const outline = outlineFromPlans(plans);
  const planned = { ...outline.sections[1], minUnits: 130, maxUnits: 152 };
  const section = { ...seedSectionsFromOutline(plans, outline, [])[1], minUnits: 130, maxUnits: 152 };
  const narration = '字'.repeat(104);
  const piece = { narration, usedEvidenceIds: [], beats: [{ function: beatFn(planned.role), narration }] };
  const brief = { audience: '', coreQuestion: '', coreConclusion: '', evidence: [], forbiddenClaims: [], requiredTerms: [] };
  let calls = 0;
  const input = { planned, section, brief, prompt: '本章任务', system: SECTION_DRAFT_SYSTEM, language: 'zh' as const, maxTokens: 1024 };
  const saved = await draftOneSection({ ...input, ask: async () => { calls++; return piece; } });
  assert.equal(calls, 1); assert.equal(saved.failed, false); assert.equal(saved.section?.narration, narration);
  assert.match(saved.warnings.join(''), /104.*参考预算 130–152/);
  assert.equal(validateSectionAgainstOutline({ ...saved.section!, usedEvidenceIds: ['invented'] }, planned, brief, 'zh').ok, false);
  assert.equal(validateSectionAgainstOutline({ ...saved.section!, id: 'other' }, planned, brief, 'zh').ok, false);
  calls = 0;
  const retry = await draftOneSection({ ...input, ask: async () => {
    calls++; return calls === 3 ? piece : { ...piece, beats: [{ function: beatFn(planned.role), narration: '不匹配' }] };
  } });
  assert.equal(calls, 3); assert.equal(retry.failed, false); assert.equal(retry.section?.narration, narration);
  calls = 0;
  const empty = await draftOneSection({ ...input, ask: async () => { calls++; return { narration: '' }; } });
  assert.equal(calls, 3); assert.equal(empty.failed, true);
  for (const language of ['zh', 'en'] as const) {
    const prompt = sectionDraftUserPrompt({ language, section: planned, sectionIndex: 1, sectionCount: plans.length, brief, thesis: '', summaries: '', contextBlock: '', styleContract: '', unitName: '字' });
    const revise = sectionReviseUserPrompt({ language, section, brief, unitName: '字', action: { sectionId: section.id, action: 'replace-transition', targetDeltaUnits: 0, instruction: '解释可控的含义' } });
    assert.doesNotMatch(prompt + revise, /汉字数必须在|word count must be between|口播仍须在/);
    assert.match(prompt, /参考篇幅|Reference length/);
    assert.match(revise, /不强制增减字数/);
  }
});
