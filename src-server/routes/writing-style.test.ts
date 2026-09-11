import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import { createExpressApp } from '../app';
import { BUILTIN_WRITING_STYLES, findWritingStyleProfile } from '../../src/shared/writingStyle';
import { qualityInputKey, qualityRequestSchema, qualityResponseSchema, type QualityInput } from '../../src/shared/quality';
import { outlineSchema } from '../../src/shared/contentBrief';
import { writingStyleBlock } from '../style/writingStyle';
import { QUALITY_STYLE_APPENDIX, QUALITY_SYSTEM } from '../llm/prompts/quality';
import { SECTION_DRAFT_SYSTEM, SECTION_REVISE_SYSTEM } from '../../src/utils/scriptPrompts';
import { assessSectionDuration } from '../duration/engine';
import { inferResponseSchema, saveResponseSchema } from './writing-style';
import { clearIdempotencyCache } from '../llm/idempotency';
import type { CustomLlmApiConfig, ScriptOutlineSection, ScriptSectionRole } from '../../src/types';

const pundit = BUILTIN_WRITING_STYLES.find(profile => profile.id === 'pundit')!;
const analyst = BUILTIN_WRITING_STYLES.find(profile => profile.id === 'analyst')!;
const SENTINEL_KEY = 'phase7-sentinel-secret';
/** planScriptSections ids are `section-<order>`; the draft endpoints re-stamp the outline through them. */
const sid = (order: number) => `section-${order}`;

const modelCallSchema = z.object({
  model: z.string(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })).min(2)
}).passthrough();
type ModelCall = z.infer<typeof modelCallSchema>;
type Prompt = { system: string; user: string };

/**
 * Runs the real Express app and the real gateway. LLM_MOCK stays OFF so drafter/evaluator requests
 * genuinely leave the gateway; a local OpenAI-compatible upstream records them and replies.
 */
async function withApp<T>(
  run: (ctx: {
    post: (endpoint: string, body: unknown) => Promise<{ status: number; body: unknown }>;
    get: (endpoint: string) => Promise<{ status: number; body: unknown }>;
    llmApi: CustomLlmApiConfig;
    calls: ModelCall[];
    prompts: () => Prompt[];
    dir: string;
    runs: string;
  }) => Promise<T>,
  options: { reply: string | ((call: ModelCall) => string); fixtures?: (dir: string) => void }
): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase7-'));
  const prior = { mock: process.env.LLM_MOCK, fixtures: process.env.LLM_FIXTURES_DIR, runs: process.env.GENERATION_RUNS_PATH };
  delete process.env.LLM_MOCK;
  const runs = path.join(dir, 'runs.jsonl');
  process.env.GENERATION_RUNS_PATH = runs;
  options.fixtures?.(dir);
  if (options.fixtures) process.env.LLM_FIXTURES_DIR = dir;

  const calls: ModelCall[] = [];
  const reply = options.reply;
  const upstream: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      const parsed = modelCallSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      if (!parsed.success) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'malformed request' } }));
        return;
      }
      calls.push(parsed.data);
      const content = typeof reply === 'function' ? reply(parsed.data) : reply;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 11, completion_tokens: 7 } }));
    });
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const llmApi: CustomLlmApiConfig = { enabled: true, provider: 'custom', endpoint: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`, apiKey: SENTINEL_KEY, model: 'unreachable' };

  clearIdempotencyCache();
  const server: Server = createServer(createExpressApp());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = async (endpoint: string, init: RequestInit) => {
    const response = await fetch(base + endpoint, init);
    return { status: response.status, body: await response.json().catch(() => null) as unknown };
  };
  try {
    return await run({
      post: (endpoint, body) => request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      get: endpoint => request(endpoint, { method: 'GET' }),
      llmApi, calls,
      prompts: () => calls.map(call => ({ system: call.messages[0].content, user: call.messages[1].content })),
      dir, runs
    });
  } finally {
    if (prior.mock !== undefined) process.env.LLM_MOCK = prior.mock;
    if (prior.fixtures === undefined) delete process.env.LLM_FIXTURES_DIR; else process.env.LLM_FIXTURES_DIR = prior.fixtures;
    if (prior.runs === undefined) delete process.env.GENERATION_RUNS_PATH; else process.env.GENERATION_RUNS_PATH = prior.runs;
    clearIdempotencyCache();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => upstream.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeFixture(dir: string, stage: string, payload: unknown): void {
  fs.writeFileSync(path.join(dir, `${stage}.json`), JSON.stringify(payload));
}

/** Reads the frozen Phase 0 baseline so append-only assertions compare against the original sentences. */
function promptBaseline(name: string): string {
  const raw = fs.readFileSync('tests/fixtures/prompt-baseline.md', 'utf8').replace(/\r\n/g, '\n');
  const start = raw.indexOf(`## ${name}`);
  assert.ok(start >= 0, `missing baseline section ${name}`);
  return raw.slice(start).split('```')[1].trim();
}

/** One beat whose narration IS the section narration: the coverage rule requires that. */
const DRAFT_NARRATION = '先把结论说清楚：不是自律不够，是诱惑太便宜。手机就在手边，三秒一次反馈。把手机放到另一个房间，专注时长会明显变长。所以别改意志，改距离。';
const DRAFT_MODEL_JSON = JSON.stringify({
  narration: DRAFT_NARRATION, usedEvidenceIds: [],
  beats: [{ id: 'beat-1', order: 1, function: 'proof', intent: '给出可执行做法', narration: DRAFT_NARRATION, energy: 'medium', visualIntent: '手机被放到隔壁房间的桌上', needsHold: false }]
});

/** Style-clean revision output, so the loop resolves after the first round. */
const REVISED_NARRATION = '结论先给：问题不在自律，在诱惑太便宜。手机就在手边，三秒一次反馈，大脑当然选它。把手机放另一个房间，专注时长翻倍。别改意志，改距离。环境设计比意志力可靠。距离一改，选择就变。先把手机拿走，再谈坚持。顺序错了，努力白费。改环境，不改人。';
const REVISED_MODEL_JSON = JSON.stringify({
  narration: REVISED_NARRATION, usedEvidenceIds: [],
  beats: [{ id: 'beat-1', order: 1, function: 'proof', intent: '给出可执行做法', narration: REVISED_NARRATION, energy: 'medium', visualIntent: '手机被放到隔壁房间的桌上', needsHold: false }]
});

const QUALITY_EMPTY_JSON = JSON.stringify({ issues: [], claims: [] });
const isQualityCall = (call: ModelCall) => call.messages[0].content.includes('质量评估器');
const isRevisionCall = (call: ModelCall) => call.messages[0].content.startsWith('你是精确编辑');

function outlineSection(id: string, order: number, role: ScriptSectionRole, title: string, promise: string): ScriptOutlineSection {
  return { id, order, title, role, audienceQuestion: '为什么会这样', promise, evidenceIds: [], bridgeFromPrevious: '', bridgeToNext: '',
    targetSeconds: 60, targetUnits: 240, minUnits: 180, maxUnits: 300, status: 'ready',
    narrationBudgetSec: 51, visualHoldBudgetSec: 9, retentionDevice: '反问', transitionOut: '下一章' };
}

const CLEAN_BASE = '别再谈自律了。问题不是自律，是诱惑太便宜。手机就在手边，短视频三秒给一次反馈，你让大脑怎么选？把手机放到另一个房间，专注时长会明显变长。别改意志，改距离。';
/** 231 units (the 3× base sentence), inside the 180–300 budget. */
const CLEAN_NARRATION = CLEAN_BASE.repeat(3);
const VIOLATING_BASE = '众所周知，自律是成功的唯一路径。总的来说，只要足够自律，任何目标都能达成，这一点毋庸置疑。';
/** 180 units (the 4× base sentence), inside the 180–300 budget and dense with banned words. */
const VIOLATING_NARRATION = VIOLATING_BASE.repeat(4);

/** Quality input with one chapter that violates "pundit" copy rules and two clean chapters. */
function styleQualityInput(writingStyleId?: string): QualityInput {
  const narrations = [CLEAN_NARRATION, VIOLATING_NARRATION, CLEAN_NARRATION];
  const roles = ['hook', 'body', 'cta'] as const;
  const titles = ['钩子', '论证', '收束'];
  const sections = narrations.map((narration, index) => ({
    id: sid(index + 1), order: index + 1, role: roles[index], title: titles[index],
    targetSeconds: 60, minUnits: 180, maxUnits: 300, narration, beats: [], status: 'ready' as const
  }));
  const outline = outlineSchema.parse({ status: 'confirmed', version: 1, oneSentenceThesis: '自律不是重点，降低诱惑成本才是',
    sections: sections.map(section => outlineSection(section.id, section.order, section.role, section.title, '给出可执行做法')) });
  return qualityRequestSchema.parse({ sections, outline, pace: 'medium', ...(writingStyleId ? { writingStyleId } : {}) });
}

function sectionDraftBody(input: QualityInput, llmApi: CustomLlmApiConfig, writingStyleId?: string) {
  return {
    topic: '为什么自律没用', budget: { targetSeconds: 240, maxChars: 1000, pace: 'medium' },
    outline: input.outline, sections: input.sections, sectionId: sid(2),
    contentBrief: { topic: '自律', audience: { roles: ['职场人'], knowledgeLevel: 'beginner', primaryNeed: '提高专注' }, objective: '给方法', viewerPromise: '学会降低诱惑成本', contentType: 'analysis', mustCover: [], mustAvoid: [], lockedFields: [] },
    ...(writingStyleId ? { writingStyleId } : {}),
    brief: { audience: '职场人', coreQuestion: '为什么自律没用', coreConclusion: '降低诱惑成本', evidence: [], forbiddenClaims: [], requiredTerms: [] },
    llmApi
  };
}

const STYLE_FINDING = { sectionId: sid(2), kind: 'style', severity: 'medium', message: '命中「犀利观点」档案的禁用表达：众所周知', suggestedFix: '改写含「众所周知」的这句' };

test('acceptance 1: an unselected style produces byte-identical prompts across two runs', async () => {
  const input = styleQualityInput();
  const captured: Prompt[][] = [];
  for (const _ of [0, 1]) {
    await withApp(async ({ post, llmApi, prompts }) => {
      const response = await post('/api/script/section-draft', sectionDraftBody(input, llmApi));
      assert.equal(response.status, 200);
      captured.push(prompts());
    }, { reply: DRAFT_MODEL_JSON, fixtures: dir => writeFixture(dir, 'script_section', { narration: '模拟章节口播。' }) });
  }
  assert.equal(captured[0].length, 1, 'exactly one drafter call');
  // Byte-identical prompts across two independent runs of the same unselected request.
  assert.deepEqual(captured[0], captured[1]);
  assert.equal(captured[0][0].system.includes('【写作风格】'), false);
  assert.equal(captured[0][0].user.includes('【写作风格】'), false);
  assert.ok(captured[0][0].user.includes('只写这一章，优先兑现章节承诺。'));
  // Append-only: the frozen Phase 0 sentences are preserved verbatim as a prefix of what the provider receives.
  assert.equal(captured[0][0].system.startsWith(promptBaseline('SECTION_DRAFT_SYSTEM')), true,
    `system prompt does not start with the frozen baseline; got: ${captured[0][0].system.slice(0, 80)}`);
  assert.equal(captured[0][0].system.includes('你只写指定章节'), true);
  assert.equal(captured[0][0].system.includes('【Phase 7 追加】'), true);
  assert.equal(captured[0][0].system.includes('\n【写作风格】'), false);
});

test('acceptance 2: with pundit selected the draft prompt carries the complete style block (snapshot)', async () => {
  const input = styleQualityInput('pundit');
  const expectedBlock = writingStyleBlock(pundit);
  await withApp(async ({ post, llmApi, prompts }) => {
    const draft = await post('/api/script/section-draft', sectionDraftBody(input, llmApi, 'pundit'));
    assert.equal(draft.status, 200);
    const revised = await post('/api/script/section-revise', { ...sectionDraftBody(input, llmApi, 'pundit'),
      action: { sectionId: sid(2), action: 'expand' }, styleFindings: [STYLE_FINDING] });
    assert.equal(revised.status, 200);
    const draftPrompt = prompts().find(prompt => prompt.user.includes('【写作风格】'))!;
    const revisionPrompt = prompts().find(prompt => prompt.user.includes('【风格修复】'))!;
    // Snapshot: the exact spec template is present in full, verbatim.
    assert.ok(draftPrompt.user.includes(expectedBlock), 'draft prompt must contain the full style block');
    for (const rule of pundit.rules) assert.ok(draftPrompt.user.includes(rule), `missing rule: ${rule}`);
    assert.ok(draftPrompt.user.includes(`禁止表达：${pundit.bannedPatterns.join('、')}`));
    assert.ok(draftPrompt.user.includes(`范例（就照这个语感写）：「${pundit.exemplar}」`));
    assert.ok(draftPrompt.user.includes(`反例（不要写成这样）：「${pundit.counterExemplar}」`));
    assert.ok(draftPrompt.user.includes('风格约束不改变本章 promise、证据约束与时长预算；冲突时内容与时长优先。'));
    // Append-only: the system prompts still begin with their original baseline sentences.
    assert.ok(draftPrompt.system.startsWith(promptBaseline('SECTION_DRAFT_SYSTEM')));
    assert.ok(revisionPrompt.system.startsWith(promptBaseline('SECTION_REVISE_SYSTEM')));
    assert.ok(draftPrompt.system.includes('【Phase 7 追加】'));
    assert.ok(revisionPrompt.system.includes('【Phase 7 追加】'));
    assert.ok(revisionPrompt.user.includes('只调整表达方式，不改变事实、论证结构与时长预算。'));
    assert.ok(revisionPrompt.user.includes('命中「犀利观点」档案的禁用表达：众所周知'));
    assert.ok(revisionPrompt.user.includes(pundit.rules[0]), 'the violated rule is named in the repair block');
    if (process.env.PHASE7_EVIDENCE === 'true') {
      fs.mkdirSync('docs/acceptance', { recursive: true });
      fs.writeFileSync('docs/acceptance/phase7-prompt-snapshot.txt', [
        '=== SECTION_DRAFT_SYSTEM (system prompt, verbatim) ===', draftPrompt.system,
        '\n=== SECTION_REVISE_SYSTEM (system prompt, verbatim) ===', revisionPrompt.system,
        '\n=== appended style block (verbatim) ===', expectedBlock,
        '\n=== draft user prompt (style block in context) ===', draftPrompt.user,
        '\n=== style repair instruction (verbatim) ===',
        revisionPrompt.user.slice(revisionPrompt.user.indexOf('【风格修复】'), revisionPrompt.user.indexOf('【风格修复】') + 480)
      ].join('\n'));
    }
  }, { reply: call => isRevisionCall(call) ? REVISED_MODEL_JSON : DRAFT_MODEL_JSON, fixtures: dir => writeFixture(dir, 'script_section', { narration: '模拟章节口播。' }) });
});

test('acceptance 4: the evaluator returns kind=style issues from both the model and the deterministic lint', async () => {
  const input = styleQualityInput('pundit');
  const modelFinding = { sectionId: sid(1), severity: 'medium', kind: 'style', message: '第 1 章连用两个反问，不符合「犀利观点」每段至多一个反问', suggestedFix: '删去第二个反问，改为陈述判断' };
  await withApp(async ({ post, llmApi }) => {
    const result = qualityResponseSchema.parse((await post('/api/script/quality-check', { ...input, llmApi })).body);
    const styleIssues = result.report.issues.filter(issue => issue.kind === 'style');
    assert.ok(styleIssues.some(issue => issue.sectionId === sid(2) && issue.message.includes('众所周知')), 'deterministic lint issue expected');
    assert.ok(styleIssues.some(issue => issue.sectionId === sid(1) && issue.message.includes('每段至多一个反问')), 'evaluator issue expected');
    assert.ok(styleIssues.every(issue => issue.severity === 'medium' || issue.severity === 'low'), 'style severity never exceeds medium');
    assert.deepEqual(result.report.durations.map(item => item.verdict), ['in_range', 'in_range', 'in_range']);
    assert.equal(result.report.claims.length, 0);
    // Every chapter sits inside its 180–300 budget, so the only global finding is the全文 verdict of this fixture.
    assert.equal(result.report.projectDuration?.complete, true);
    if (process.env.PHASE7_EVIDENCE === 'true') {
      fs.mkdirSync('docs/acceptance', { recursive: true });
      fs.writeFileSync('docs/acceptance/phase7-style-issues.json', JSON.stringify({
        writingStyleId: input.writingStyleId, modelFinding, report: result.report
      }, null, 2));
    }
  }, { reply: JSON.stringify({ issues: [modelFinding], claims: [] }) });
});

test('acceptance 4b: without a selected style the evaluator payload and system prompt stay Phase 6 identical', async () => {
  const input = styleQualityInput();
  await withApp(async ({ post, llmApi, calls, prompts }) => {
    const response = await post('/api/script/quality-check', { ...input, llmApi });
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1, 'exactly one evaluator call');
    const user = JSON.parse(prompts()[0].user) as Record<string, unknown>;
    assert.equal('writingStyle' in user, false);
    assert.equal('writingStyles' in user, false);
    assert.equal('styleFindings' in user, false);
    assert.equal(prompts()[0].system.includes('style：'), false);
    // Byte-identical prefix: the Phase 6 QUALITY_SYSTEM is followed only by the gateway's schema suffix.
    assert.equal(prompts()[0].system.startsWith(QUALITY_SYSTEM), true);
    assert.equal(prompts()[0].system.includes(QUALITY_STYLE_APPENDIX), false);
    assert.equal(prompts()[0].system.slice(QUALITY_SYSTEM.length).startsWith('\nOutput must match this JSON Schema:'), true);
    assert.notEqual(qualityInputKey({ ...input, writingStyleId: 'pundit' }), qualityInputKey(input));
    const runs = fs.readFileSync(process.env.GENERATION_RUNS_PATH || '', 'utf8');
    assert.equal(runs.includes(SENTINEL_KEY), false, 'no credential is ever logged');
    assert.equal(runs.includes('apiKey'), false);
    for (const line of runs.trim().split('\n')) assert.equal(JSON.parse(line).stage, 'quality');
  }, { reply: QUALITY_EMPTY_JSON });
});

test('acceptance 5: the style repair keeps promise, evidence ids and duration untouched', async () => {
  const input = styleQualityInput('pundit');
  const original = input.sections.find(section => section.id === sid(2))!;
  const plan = input.outline.sections.find(section => section.id === sid(2))!;
  const beforeDuration = assessSectionDuration(original.id, original.narration, plan.minUnits, plan.maxUnits, 'zh', 'medium');
  await withApp(async ({ post, llmApi, prompts, calls }) => {
    const checked = qualityResponseSchema.parse((await post('/api/script/quality-check', { ...input, llmApi })).body);
    assert.equal(checked.rounds, 0, 'a check without repair performs no revision');
    const repair = qualityResponseSchema.parse((await post('/api/script/quality-check', { ...input, repair: true, sectionIds: [sid(2)], llmApi })).body);
    const revised = repair.sections.find(section => section.id === sid(2))!;
    const afterDuration = assessSectionDuration(revised.id, revised.narration, plan.minUnits, plan.maxUnits, 'zh', 'medium');
    assert.equal(repair.rounds, 1);
    assert.equal(afterDuration.minSec, beforeDuration.minSec);
    assert.ok(afterDuration.estimatedSec > 0);
    // Style repair must not become a hidden length lever: the chapter stays in the same size band.
    const units = (text: string) => (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
    const share = units(revised.narration) / units(original.narration);
    assert.ok(share > 0.5 && share < 1.5, `style repair changed length by ${(share * 100).toFixed(0)}%`);
    // The provider revision output is applied: the banned word is gone and the copy got shorter.
    assert.equal(revised.narration.includes('众所周知'), false, 'the banned word is gone after the repair');
    assert.ok(revised.narration.length < original.narration.length, 'the repair rewrote the chapter');
    assert.ok(revised.narration.includes('改距离'), 'the closing judgement survives');
    // Content invariants the style repair must not touch.
    assert.equal(revised.promise, original.promise);
    assert.equal(revised.audienceQuestion, original.audienceQuestion);
    assert.equal(revised.role, original.role);
    assert.equal(revised.targetSeconds, original.targetSeconds);
    assert.deepEqual(revised.usedEvidenceIds, original.usedEvidenceIds);
    assert.deepEqual(input.outline.sections.find(section => section.id === sid(2)), plan, 'outline promise/budget unchanged');
    assert.deepEqual(repair.sections.filter(section => section.id !== sid(2)), input.sections.filter(section => section.id !== sid(2)), 'other chapters untouched');
    assert.equal(repair.history.length, 2, 'check + repair history retained');
    assert.equal(repair.report.issues.some(issue => issue.sectionId === sid(2) && issue.kind === 'style'), false, 'style issues resolved after the repair');
    // After the style repair nothing per-chapter is left to fix; only a sectionId-less global advisory may remain.
    assert.ok(['resolved', 'no_editable_issues'].includes(repair.stoppedReason));
    const remaining = repair.report.issues.filter(issue => issue.sectionId);
    assert.deepEqual(remaining, [], 'no per-chapter issue survives the style repair');
    const revisionCall = calls.find(isRevisionCall)!;
    assert.ok(revisionCall.messages[1].content.includes('命中「犀利观点」档案的禁用表达：众所周知'));
    assert.ok(prompts().some(prompt => prompt.user.includes('【风格修复】')));
    if (process.env.PHASE7_EVIDENCE === 'true') {
      fs.mkdirSync('docs/acceptance', { recursive: true });
      fs.writeFileSync('docs/acceptance/phase7-repair-before-after.json', JSON.stringify({
        before: { narration: original.narration, estimatedSec: beforeDuration.estimatedSec, verdict: beforeDuration.verdict, promise: original.promise, usedEvidenceIds: original.usedEvidenceIds, role: original.role, targetSeconds: original.targetSeconds },
        after: { narration: revised.narration, estimatedSec: afterDuration.estimatedSec, verdict: afterDuration.verdict, promise: revised.promise, usedEvidenceIds: revised.usedEvidenceIds, role: revised.role, targetSeconds: revised.targetSeconds },
        rounds: repair.rounds, stoppedReason: repair.stoppedReason, historyLength: repair.history.length,
        styleIssueBefore: checked.report.issues.filter(issue => issue.kind === 'style').map(issue => issue.message),
        styleIssueAfter: repair.report.issues.filter(issue => issue.kind === 'style').map(issue => issue.message)
      }, null, 2));
    }
  }, { reply: call => isQualityCall(call) ? QUALITY_EMPTY_JSON : REVISED_MODEL_JSON });
});

test('acceptance 5b: a locked chapter is never style-repaired and reports no revision', async () => {
  const input = styleQualityInput('pundit');
  const lockedInput = { ...input, sections: input.sections.map(section => section.id === sid(2) ? { ...section, status: 'locked' as const } : section) };
  await withApp(async ({ post, llmApi }) => {
    const blocked = await post('/api/script/quality-check', { ...lockedInput, repair: true, sectionIds: [sid(2)], llmApi });
    assert.equal(blocked.status, 409);
    const report = qualityResponseSchema.parse((await post('/api/script/quality-check', { ...lockedInput, llmApi })).body);
    assert.ok(report.report.issues.some(issue => issue.sectionId === sid(2) && issue.kind === 'style'));
    assert.equal(report.rounds, 0);
    assert.deepEqual(report.sections.find(section => section.id === sid(2)), lockedInput.sections.find(section => section.id === sid(2)));
  }, { reply: QUALITY_EMPTY_JSON });
});

test('acceptance 7: the infer endpoint satisfies its Zod schema with an exemplar taken from the samples', async () => {
  const samples = [
    '结论先给：睡眠不足不是意志力问题，而是前额叶资源被优先削减。连续两周睡不到六小时，工作记忆成绩平均下降约 15%。',
    '很多人以为熬夜只是困。真正的代价是判断力：你会在第二天把重要决定做得更差，而且自己感觉不到。'
  ];
  await withApp(async ({ post, get, llmApi }) => {
    const response = await post('/api/writing-styles/infer', { samples, label: '冷读式', llmApi });
    assert.equal(response.status, 200);
    const parsed = inferResponseSchema.parse(response.body);
    assert.ok(samples.some(sample => sample.includes(parsed.draft.exemplar)), 'exemplar must be a verbatim excerpt of the samples');
    assert.ok(samples.some(sample => sample.includes(parsed.draft.counterExemplar)));
    assert.equal(parsed.sampleCount, 2);
    assert.equal((await post('/api/writing-styles/infer', { samples: ['太短'] })).status, 400);
    assert.equal((await post('/api/writing-styles/infer', { samples: [samples[0], samples[0], samples[0], samples[0]] })).status, 400);
    const list = (await get('/api/writing-styles')).body as { builtin: { id: string }[] };
    assert.deepEqual(list.builtin.map(profile => profile.id), ['analyst', 'narrator', 'pundit']);
    if (process.env.PHASE7_EVIDENCE === 'true') {
      fs.mkdirSync('docs/acceptance', { recursive: true });
      fs.writeFileSync('docs/acceptance/phase7-infer.json', JSON.stringify({ samples, response: parsed, exemplarIsVerbatim: samples.some(sample => sample.includes(parsed.draft.exemplar)) }, null, 2));
    }
  }, { reply: JSON.stringify({ label: '冷读式', description: '先给判断再给机制与数字', rules: ['开头三句给判断', '每段一个判断', '每 3–5 句给数字'], bannedPatterns: ['众所周知'], exemplarIndex: 0, counterExemplarIndex: 1 }) });
});

test('acceptance 7b: an out-of-range exemplar index is refused; a verbatim draft saves, locks and then resists rewrite', async () => {
  const samples = [
    '结论先给：睡眠不足不是意志力问题，而是前额叶资源被优先削减。连续两周睡不到六小时，工作记忆成绩平均下降约 15%。',
    '很多人以为熬夜只是困。真正的代价是判断力：你会在第二天把重要决定做得更差，而且自己感觉不到。'
  ];
  const reply = JSON.stringify({ label: '冷读式', description: '先给判断再给机制与数字', rules: ['开头三句给判断', '每段一个判断', '给数字'], bannedPatterns: ['众所周知'], exemplarIndex: 0, counterExemplarIndex: 1 });
  await withApp(async ({ post, llmApi }) => {
    const draft = await post('/api/writing-styles/infer', { samples, llmApi });
    assert.equal(draft.status, 200, `infer failed: ${JSON.stringify(draft.body).slice(0, 200)}`);
    const parsed = inferResponseSchema.parse(draft.body);
    const saved = await post('/api/writing-styles', { profile: { ...parsed.draft, derivedFromSamples: true, locked: true, samples } });
    assert.equal(saved.status, 200);
    const profile = saveResponseSchema.parse(saved.body).profile;
    assert.match(profile.id, /^custom-\d+$/);
    assert.equal(profile.kind, 'custom');
    assert.equal(profile.locked, true);
    assert.ok(samples.some(sample => sample.includes(profile.exemplar)));
    assert.equal((await post('/api/writing-styles', { profile: { ...profile, samples }, existing: [profile] })).status, 409);
    assert.equal((await post('/api/writing-styles', { profile: { ...parsed.draft, rules: ['a', 'b', 'c'], exemplar: '样例里没有的句子', derivedFromSamples: true, locked: false, samples } })).status, 422);
    assert.equal((await post('/api/writing-styles', { profile: { ...parsed.draft, rules: [], derivedFromSamples: true, locked: false } })).status, 400);
    assert.equal((await post('/api/writing-styles', { profile: { ...parsed.draft, rules: ['a', 'b', 'c'], derivedFromSamples: true, locked: false, samples, invented: 1 } })).status, 400);
  }, { reply });
  // An exemplar index outside the submitted samples must be refused outright.
  await withApp(async ({ post, llmApi }) => {
    const refused = await post('/api/writing-styles/infer', { samples, llmApi });
    assert.equal(refused.status, 422, `expected refusal, got ${JSON.stringify(refused.body).slice(0, 200)}`);
  }, { reply: JSON.stringify({ label: '越界风', description: '越界', rules: ['a', 'b', 'c'], bannedPatterns: [], exemplarIndex: 5, counterExemplarIndex: 0 }) });
});

test('custom archives resolve by id and built-ins stay built-in', () => {
  const profile = { ...analyst, id: 'custom-1700000000000', kind: 'custom' as const, derivedFromSamples: true, locked: true, provisional: undefined };
  assert.equal(findWritingStyleProfile('custom-1700000000000', [profile])?.label, '冷静拆解');
  assert.equal(findWritingStyleProfile('custom-1700000000000'), undefined);
  assert.deepEqual([...new Set(BUILTIN_WRITING_STYLES.map(item => item.kind))], ['builtin']);
});
