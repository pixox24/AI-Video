import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createExpressApp } from '../app';
import { qualityFailureMessage, qualityInputKey, qualityRequestSchema, qualityResponseSchema, type QualityInput } from '../../src/shared/quality';
import { groundedClaims, qualityRevisionActions, sectionIsLocked } from './quality';
import { assessProjectDuration, assessSectionDuration } from '../duration/engine';
import { OUTLINE_SYSTEM, SECTION_DRAFT_SYSTEM, SECTION_REVISE_SYSTEM } from '../../src/utils/scriptPrompts';

test('quality input identity ignores field order and secrets but detects content and locks', () => {
  const input = qualityFixture();
  const reordered = { ...input, sections: input.sections.map(s => Object.fromEntries(Object.entries(s).reverse())) };
  assert.equal(qualityInputKey(input), qualityInputKey(reordered));
  assert.equal(qualityInputKey(input), qualityInputKey({ ...input, llmApi: { apiKey: 'secret' }, repair: true }));
  assert.notEqual(qualityInputKey(input), qualityInputKey({ ...input, sections: input.sections.map(s => ({ ...s, status: 'locked' })) }));
  assert.notEqual(qualityInputKey(input), qualityInputKey({ ...input, sections: input.sections.map(s => ({ ...s, narration: s.narration + '改变' })) }));
  assert.equal(qualityInputKey({}), '');
});

export function qualityFixture(): QualityInput {
  const sections = ['hook', 'body', 'cta'].map((role, index) => ({
    id: `s${index + 1}`, order: index + 1, role, title: ['开头', '论证', '结尾'][index], targetSeconds: index === 1 ? 60 : 20,
    minUnits: index === 1 ? 216 : 72, maxUnits: index === 1 ? 252 : 84,
    narration: '用具体步骤帮助观众理解这个问题。'.repeat(20).slice(0, index === 1 ? 240 : 80), beats: [], status: 'ready'
  }));
  return qualityRequestSchema.parse({ sections, pace: 'medium', outline: { status: 'confirmed', version: 1, oneSentenceThesis: '具体步骤帮助理解',
    sections: sections.map(({ narration, beats, ...s }) => ({ ...s,
      audienceQuestion: '如何理解', promise: '给出可执行步骤', evidenceIds: [], bridgeFromPrevious: '', bridgeToNext: '',
      targetUnits: s.role === 'body' ? 240 : 80, narrationBudgetSec: s.targetSeconds * .85, visualHoldBudgetSec: s.targetSeconds * .15, retentionDevice: '展示步骤', transitionOut: '下一步' })) }
  });
}

test('duration engine boundary decisions preserve language rates and detect 40% deletion', () => {
  const section = qualityFixture().sections[1];
  assert.equal(assessSectionDuration(section.id, section.narration, 216, 252, 'zh', 'medium').verdict, 'in_range');
  assert.equal(assessSectionDuration(section.id, section.narration.slice(0,144), 216, 252, 'zh', 'medium').verdict, 'too_short');
  assert.equal(assessSectionDuration('en', 'one two three four five', 5, 5, 'en', 'medium').estimatedSec, 2);
  assert.equal(assessSectionDuration('over', '字'.repeat(253), 216, 252, 'zh', 'medium').verdict, 'too_long');
});

test('claims use exact evidence, distrust model sources and discard hallucinated spans', () => {
  const input = qualityFixture(); input.sections[1].narration = '研究证明，这款产品使记忆力提升98.7%。';
  const candidates = [{ id: 'fake', sectionId: 's2', text: input.sections[1].narration, kind: 'fact' as const, risk: 'high' as const, needsSource: false, sourceUrl: 'https://invented.invalid' },
    { id: 'absent', sectionId: 's2', text: '原文不存在', kind: 'fact' as const, risk: 'high' as const, needsSource: false }];
  const claims = groundedClaims(input, candidates);
  assert.ok(claims.length); assert.ok(claims.every(c => c.needsSource && c.kind === 'fact' && c.risk === 'high' && !c.sourceUrl));
  assert.ok(claims.every(c => input.sections[1].narration.includes(c.text)));
  input.claims = claims.map(c => ({ ...c, sourceNote: '用户提供的证据页及引用段落' }));
  assert.ok(groundedClaims(input, candidates).every(c => !c.needsSource));
});

test('baseline system prompts retain every original character as prefix', () => {
  const baseline = fs.readFileSync('tests/fixtures/prompt-baseline.md', 'utf8').replace(/\r\n/g, '\n');
  const constants = { OUTLINE_SYSTEM, SECTION_DRAFT_SYSTEM, SECTION_REVISE_SYSTEM };
  const evidence: string[] = [];
  for (const [name, value] of Object.entries(constants)) {
    const marker = `## ${name}`;
    const block = baseline.slice(baseline.indexOf(marker)).split('```')[1].trim();
    assert.ok(value.startsWith(block), name);
    evidence.push(`${name}: exact original prefix preserved (${block.length} chars)\nAPPENDED:\n${value.slice(block.length) || '(none)'}`);
  }
  if (process.env.PHASE3_EVIDENCE === 'true') fs.writeFileSync('docs/acceptance/phase3-prompt-diff.txt', evidence.join('\n\n'));
});

test('HTTP quality loop: deletion → issue → in_range; locked 409; risk; two-round bound; strict failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase3-quality-'));
  const prior = { mock: process.env.LLM_MOCK, fixtures: process.env.LLM_FIXTURES_DIR, runs: process.env.GENERATION_RUNS_PATH };
  const runs = path.join(dir, 'runs.jsonl');
  process.env.LLM_MOCK = 'true'; process.env.GENERATION_RUNS_PATH = runs;
  const server = createServer(createExpressApp());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const nativeFetch = globalThis.fetch; let externalCalls = 0;
  globalThis.fetch = (url, init) => { if (!String(url).startsWith(base + '/')) { externalCalls++; throw new Error('External network forbidden'); } return nativeFetch(url, init); };
  const trace: unknown[] = [];
  async function post(endpoint: string, body: unknown) {
    const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json: unknown = await response.json(); trace.push({ endpoint, request: body, status: response.status, response: json });
    return { status: response.status, body: json };
  }
  try {
    const input = qualityFixture();
    const before = qualityResponseSchema.parse((await post('/api/script/quality-check', input)).body);
    assert.equal(before.report.verdict, 'in_range');
    const legacy = { ...input, sections: input.sections.map(s => ({ ...s, beats: [{ id: `${s.id}-beat`, order: 1, function: 'proof', intent: '', narration: s.narration, targetSeconds: 1, energy: '高', visualIntent: '', needsHold: false }] })) };
    const legacySnapshot = JSON.stringify(legacy);
    const compatible = await post('/api/script/quality-check', legacy);
    assert.equal(compatible.status, 200);
    const compatibleResult = qualityResponseSchema.parse(compatible.body);
    assert.ok(compatibleResult.sections.every(s => s.beats[0].energy === 'fast' && s.beatLabelWarnings?.length));
    assert.deepEqual(compatibleResult.sections.map(s => s.narration), legacy.sections.map(s => s.narration));
    assert.equal(JSON.stringify(legacy), legacySnapshot);
    assert.equal(qualityRequestSchema.safeParse({ ...legacy, sections: legacy.sections.map(s => ({ ...s, narration: null })) }).success, false);

    const offset = structuredClone(input);
    offset.sections[0].narration = '字'.repeat(30); offset.sections[1].narration = '字'.repeat(290);
    const balanced = qualityResponseSchema.parse((await post('/api/script/quality-check', { ...offset, repair: true })).body);
    assert.equal(balanced.report.verdict, 'in_range'); assert.equal(balanced.rounds, 0); assert.deepEqual(balanced.sections, offset.sections);
    const partial = qualityResponseSchema.parse((await post('/api/script/quality-check', { ...input, sections: input.sections.slice(0, 1), repair: true })).body);
    assert.equal(partial.report.projectDuration?.complete, false); assert.equal(partial.rounds, 0); assert.equal(partial.report.issues.length, 0);
    input.sections[1].narration = input.sections[1].narration.slice(0,144);
    const shortened = qualityResponseSchema.parse((await post('/api/script/quality-check', input)).body);
    assert.equal(shortened.report.verdict, 'too_short');
    assert.ok(shortened.report.issues.some(i => !i.sectionId && i.kind === 'duration' && i.severity === 'medium'));
    assert.equal(shortened.report.issues.some(i => i.sectionId === 's2'), false);
    const advisory = qualityResponseSchema.parse((await post('/api/script/quality-check', { ...input, repair: true })).body);
    assert.equal(advisory.rounds, 0); assert.deepEqual(advisory.sections, input.sections);
    const actions = qualityRevisionActions(input, { ...shortened.report, issues: [...shortened.report.issues, { sectionId: 's2', kind: 'pacing', severity: 'medium', message: '承接断裂', suggestedFix: '连接上一章' }] });
    assert.equal(actions.length, 1); assert.equal(actions[0].targetDeltaUnits, 0); assert.equal(actions[0].action, 'replace-transition'); assert.match(actions[0].instruction, /pacing/);
    fs.copyFileSync('tests/fixtures/section_revise.json', path.join(dir, 'section_revise.json'));
    fs.writeFileSync(path.join(dir, 'quality.json'), JSON.stringify({ issues: [{ sectionId: 's2', severity: 'medium', kind: 'architecture', message: '章节承诺给出可执行步骤，正文未说明第一步', suggestedFix: '补充第一步的操作示例，只使用已知材料' }], claims: [] }));
    process.env.LLM_FIXTURES_DIR = dir;
    const repaired = qualityResponseSchema.parse((await post('/api/script/quality-check', { ...input, repair: true })).body);
    assert.equal(repaired.report.verdict, 'in_range'); assert.equal(repaired.rounds, 2);
    assert.equal(repaired.stoppedReason, 'round_limit'); // Persistent content issue, not a byte-count loop.
    if (prior.fixtures === undefined) delete process.env.LLM_FIXTURES_DIR; else process.env.LLM_FIXTURES_DIR = prior.fixtures;
    assert.deepEqual(repaired.sections[0], input.sections[0]); assert.deepEqual(repaired.sections[2], input.sections[2]);
    assert.notEqual(repaired.sections[1].narration, input.sections[1].narration);
    // Both lock representations must block the shared revision execution and the quality action.
    for (const location of ['section', 'outline'] as const) {
      const locked = structuredClone(input);
      if (location === 'section') locked.sections[1].status = 'locked'; else locked.outline.sections[1].status = 'locked';
      assert.equal(sectionIsLocked(locked, 's2'), true);
      const snapshot = JSON.stringify(locked);
      for (let attempt = 0; attempt < 3; attempt++) {
        assert.equal((await post('/api/script/section-revise', { sections: locked.sections, outline: locked.outline, action: actions[0] })).status, 409);
        assert.equal((await post('/api/script/quality-check', { ...locked, repair: true, sectionIds: ['s2'] })).status, 409);
      }
      const skipped = qualityResponseSchema.parse((await post('/api/script/quality-check', { ...locked, repair: true })).body);
      assert.deepEqual(skipped.sections, locked.sections); assert.equal(skipped.rounds, 0);
      assert.equal(JSON.stringify(locked), snapshot);
    }
    const fake = qualityFixture(); fake.sections[1].narration = '研究证明，这款产品使记忆力提升98.7%。';
    const risk = qualityResponseSchema.parse((await post('/api/script/quality-check', fake)).body);
    assert.ok(risk.report.claims.some(c => c.kind === 'fact' && c.risk === 'high' && c.needsSource));
    assert.ok(risk.report.issues.some(i => i.kind === 'fact_risk' && i.sectionId === 's2'));
    // Persistent fixture issue remains even after repair: must stop at exactly two rounds.
    fs.copyFileSync('tests/fixtures/section_revise.json', path.join(dir, 'section_revise.json'));
    fs.writeFileSync(path.join(dir, 'quality.json'), JSON.stringify({ issues: [{ sectionId: 's2', severity: 'medium', kind: 'pacing', message: '持续问题', suggestedFix: '改善承接' }], claims: [] }));
    process.env.LLM_FIXTURES_DIR = dir;
    const bounded = qualityResponseSchema.parse((await post('/api/script/quality-check', { ...input, repair: true })).body);
    assert.equal(bounded.rounds, 2); assert.equal(bounded.history.length, 3); assert.equal(bounded.stoppedReason, 'round_limit');
    assert.deepEqual(bounded.sections[0], input.sections[0]); assert.deepEqual(bounded.sections[2], input.sections[2]);
    assert.equal((await post('/api/script/quality-check', { ...input, rounds: 99 })).status, 400);
    assert.equal((await post('/api/script/quality-check', { ...input, sectionIds: ['unknown'] })).status, 400);
    fs.writeFileSync(path.join(dir, 'quality.json'), '{"issues":"invalid","claims":[]}');
    assert.equal((await post('/api/script/quality-check', input)).status, 503);
    assert.equal(externalCalls, 0);
    const log = fs.readFileSync(runs, 'utf8');
    assert.ok(!log.includes('apiKey'));
    if (process.env.PHASE3_EVIDENCE === 'true') {
      fs.writeFileSync('docs/acceptance/phase3-http.json', JSON.stringify({ externalCalls, trace }, null, 2));
      fs.writeFileSync('docs/acceptance/phase3-generation-runs.jsonl', log);
    }
  } finally {
    globalThis.fetch = nativeFetch;
    for (const [key, value] of Object.entries({ LLM_MOCK: prior.mock, LLM_FIXTURES_DIR: prior.fixtures, GENERATION_RUNS_PATH: prior.runs })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});


test('全文预算允许章节互补、支持 DurationSpec，部分草稿不能判为全文完成', () => {
  const input = qualityFixture();
  input.sections[0].narration = '字'.repeat(30);
  input.sections[1].narration = '字'.repeat(290);
  input.sections[2].narration = '字'.repeat(80);
  const full = assessProjectDuration(input.sections, input.outline, 'zh', 'medium');
  assert.equal(full.complete, true); assert.equal(full.verdict, 'in_range');
  assert.equal(assessSectionDuration('s1', input.sections[0].narration, 72, 84, 'zh', 'medium').verdict, 'too_short');
  assert.equal(assessProjectDuration(input.sections.slice(0, 1), input.outline, 'zh', 'medium').complete, false);
  const spec = { preset: 'insight' as const, targetSeconds: 100, minSeconds: 90, maxSeconds: 110, narrationRatio: 0.8, pace: 'medium' as const };
  const timed = assessProjectDuration(input.sections, input.outline, 'zh', 'medium', spec);
  assert.equal(timed.minSec, 72); assert.equal(timed.maxSec, 88); assert.equal(timed.verdict, 'too_long');
  assert.equal(assessProjectDuration([{ id: 's', narration: 'one two three four five' }], { sections: [{ id: 's', minUnits: 5, maxUnits: 5 }] }, 'en', 'medium').verdict, 'in_range');
});

test('修订标签归一化通过严格质量 schema；未知标签不重试，漏文仍拒绝，锁定不调用', async () => {
  const { executeSectionRevision } = await import('./section-revise');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-revise-'));
  const priorMock = process.env.LLM_MOCK, priorRuns = process.env.GENERATION_RUNS_PATH;
  const nativeFetch = globalThis.fetch;
  let calls = 0;
  let label: unknown = 'body';
  let omitText = false;
  const narration = '重新定义可控，是指行动可选择，并不保证结果。';
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ narration, usedEvidenceIds: [],
      beats: [{ function: label, narration: omitText ? '漏文' : narration, intent: '解释', energy: 'peak', visualIntent: '桌上两张卡片', needsHold: false }] }) } }] }));
  };
  process.env.LLM_MOCK = 'false'; process.env.GENERATION_RUNS_PATH = path.join(dir, 'runs.jsonl');
  try {
    const input = qualityFixture();
    const opts = { sections: input.sections, planned: input.outline.sections[1], action: { sectionId: 's2', action: 'replace-transition' as const, targetDeltaUnits: 0, instruction: '解释概念' }, language: 'zh' as const,
      brief: { audience: '', coreQuestion: '', coreConclusion: '', evidence: [], forbiddenClaims: [], requiredTerms: [] }, targetSeconds: 100,
      llmApi: { endpoint: 'https://transport.invalid/v1', apiKey: 'test', model: 'test' }, strict: true };
    for (label of ['body', 'unknown', null, 'setup']) {
      const before = calls;
      const result = await executeSectionRevision(opts);
      assert.equal(result.status, 200); assert.equal(calls, before + 1);
      assert.equal(result.section?.narration, narration);
      assert.equal(result.section?.beats[0].narration, narration);
      assert.equal(result.section?.beats[0].energy, 'medium');
      assert.match(result.section?.beatLabelWarnings?.join('') || '', /默认节奏/);
      assert.equal(result.section?.beats[0].function, label === 'setup' ? 'setup' : 'proof');
      assert.ok(qualityRequestSchema.safeParse({ ...input, sections: result.sections }).success);
      assert.deepEqual(result.sections[0], input.sections[0]);
    }
    omitText = true;
    for (const strict of [true, false]) assert.equal((await executeSectionRevision({ ...opts, strict })).status, 503);
    const before = calls;
    assert.equal((await executeSectionRevision({ ...opts, planned: { ...opts.planned, status: 'locked' } })).status, 409);
    assert.equal(calls, before);
  } finally {
    globalThis.fetch = nativeFetch;
    if (priorMock === undefined) delete process.env.LLM_MOCK; else process.env.LLM_MOCK = priorMock;
    if (priorRuns === undefined) delete process.env.GENERATION_RUNS_PATH; else process.env.GENERATION_RUNS_PATH = priorRuns;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('质量失败提示保留具体原因、输入路径及非 JSON 状态', () => {
  assert.match(qualityFailureMessage(400, { issues: [{ path: ['sections', 0, 'beats', 0, 'energy'], message: 'invalid' }] }), /sections.0.beats.0.energy/);
  assert.match(qualityFailureMessage(503, { error: '模型超时' }), /模型超时/);
  assert.match(qualityFailureMessage(502, null), /502/);
  assert.match(qualityFailureMessage(409, {}), /锁定/);
});
