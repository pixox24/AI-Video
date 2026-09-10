import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateOutline } from './scriptOutline';
import { budgetOutlineSections } from '../../src-server/duration/engine';
import { outlineFromPlans } from './scriptOutline';
import { planScriptSections } from './scriptSections';
import { buildDurationBudget } from './scriptBudget';

test('Phase 2 outline section budgets stay within ten percent and hook is capped', () => {
  const budget = buildDurationBudget({ targetSeconds: 750, pace: 'medium' });
  const plans = planScriptSections({ targetSeconds: 750, maxChars: budget.maxChars, form: 'extended' });
  const outline = outlineFromPlans(plans, { status: 'draft', thesis: '命题' });
  const sections = budgetOutlineSections(outline.sections, 750, budget.speechSeconds / 750);
  const narration = sections.reduce((sum, s) => sum + s.narrationBudgetSec, 0);
  const total = sections.reduce((sum, s) => sum + s.narrationBudgetSec + s.visualHoldBudgetSec, 0);
  assert.ok(Math.abs(narration - budget.speechSeconds) <= budget.speechSeconds * .1);
  assert.ok(Math.abs(total - 750) <= 75);
  assert.ok(sections[0].narrationBudgetSec + sections[0].visualHoldBudgetSec <= 35);
  assert.equal(validateOutline({ ...outline, sections }, undefined, budget).ok, true);
});
