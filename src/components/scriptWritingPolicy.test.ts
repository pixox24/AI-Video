import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScriptOutlineStage } from './ScriptOutlineStage';
import { QualityPanel } from './QualityPanel';
import { createDefaultScriptWorkspace } from '../utils/scriptWorkspace';
import { planScriptSections } from '../utils/scriptSections';
import { outlineFromPlans } from '../utils/scriptOutline';
import { seedSectionsFromOutline } from '../utils/scriptDraftEngine';
import { assessProjectDuration, assessSectionDuration } from '../../src-server/duration/engine';

test('已保存的104字草稿显示软提示；未写完只显示当前估算，不显示全文失败', () => {
  const workspace = createDefaultScriptWorkspace();
  const plans = planScriptSections({ targetSeconds: 240, maxChars: 1000 });
  const outline = outlineFromPlans(plans, { status: 'confirmed' });
  outline.sections[1] = { ...outline.sections[1], minUnits: 130, maxUnits: 152, status: 'ready' };
  const section = { ...seedSectionsFromOutline(plans, outline, [])[1], narration: '字'.repeat(104), status: 'ready' as const };
  workspace.outline = outline; workspace.sections = [{ ...section, beatLabelWarnings: ['第 2 章第 1 个节拍：body 已修正为 proof，正文未改写。'] }];
  const html = renderToStaticMarkup(createElement(ScriptOutlineStage, { workspace, busy: false, onChange: () => {}, onStatus: () => {} }));
  assert.match(html, /草稿 104字/); assert.match(html, /参考 130–152字/); assert.match(html, /草稿已保留/);
  assert.doesNotMatch(html, /已通过/); assert.match(html, /body 已修正为 proof/);
  workspace.qualityReport = { id: 'test', stage: 'quality', createdAt: new Date(0).toISOString(), issues: [], claims: [], verdict: 'too_short',
    durations: [assessSectionDuration(section.id, section.narration, 130, 152, 'zh', 'medium')],
    projectDuration: assessProjectDuration([section], outline, 'zh', 'medium') };
  const quality = renderToStaticMarkup(createElement(QualityPanel, { workspace, onChange: () => {} }));
  assert.match(quality, /章节尚未写完，暂不作全文判定/); assert.match(quality, /不要求凑字或自动重写/);
  assert.doesNotMatch(quality, /一键修复未锁定问题/);
});
