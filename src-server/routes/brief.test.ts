import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createExpressApp } from '../app';
import { emptyContentBrief } from '../../src/utils/contentBrief';
import { durationSpecForPreset } from '../duration/engine';
import { contentBriefSchema } from '../../src/shared/contentBrief';
import { clearIdempotencyCache } from '../llm/idempotency';
import { generateStructured } from '../llm/gateway';

test('Brief API validates, preserves locks, gates outline and logs zero-cost mock calls', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase1-'));
  process.env.LLM_MOCK = 'true';
  process.env.GENERATION_RUNS_PATH = path.join(dir, 'runs.jsonl');
  clearIdempotencyCache();
  const server = createServer(createExpressApp());
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => {
    assert.ok(String(url).startsWith(base + '/'), 'external model call forbidden');
    return originalFetch(url, init);
  };
  const post = (endpoint: string, body: unknown) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const request = { input: '睡眠与判断力', llmApi: { provider: 'custom', endpoint: 'https://never-call.invalid', apiKey: 'phase1-sentinel-secret', model: 'unreachable' } };
    const response = await post('/api/script/brief', request);
    assert.equal(response.status, 200);
    const data = await response.json() as { contentBrief: unknown; run: { id: string } };
    const contentBrief = contentBriefSchema.parse(data.contentBrief);
    const repeat = await post('/api/script/brief', request);
    assert.equal((await repeat.json()).run.id, data.run.id);
    const locked = { ...contentBrief, viewerPromise: '用户锁定承诺', lockedFields: ['viewerPromise'] };
    const regenerated = await post('/api/script/brief', { input: '完全改题', contentBrief: locked });
    assert.equal((await regenerated.json()).contentBrief.viewerPromise, locked.viewerPromise);
    assert.equal((await post('/api/script/brief', { input: ' ' })).status, 400);
    assert.equal((await post('/api/script/brief', { input: '主题', invented: 1 })).status, 400);
    assert.equal((await post('/api/script/brief', { input: '主题', contentBrief: { ...emptyContentBrief(), lockedFields: ['viewerPromise'] } })).status, 409);
    assert.equal((await post('/api/script/outline', { contentBrief: emptyContentBrief() })).status, 409);
    assert.equal((await post('/api/script/draft', { contentBrief: emptyContentBrief() })).status, 409);
    const outline = await post('/api/script/outline', { topic: '睡眠', contentBrief, durationSpec: durationSpecForPreset('deep_dive') });
    assert.equal(outline.status, 200);
    assert.equal((await outline.json()).scriptForm, 'extended');
    assert.equal((await post('/api/script/outline', { contentBrief, durationSpec: { ...durationSpecForPreset('deep_dive'), pace: 'standard' } })).status, 400);
    const revise = await post('/api/script/section-revise', { action: { sectionId: 's1', action: 'expand' }, sections: [{ id: 's1', status: 'locked' }] });
    assert.equal(revise.status, 409);
    const logs = fs.readFileSync(process.env.GENERATION_RUNS_PATH, 'utf8');
    assert.ok(!logs.includes('phase1-sentinel-secret') && !logs.includes('apiKey'));
    for (const line of logs.trim().split('\n')) { const row = JSON.parse(line); assert.equal(row.model, 'mock'); assert.equal(row.costUsd, 0); }
    // A malformed fixture must fail the same schema as a provider response.
    process.env.LLM_FIXTURES_DIR = dir;
    fs.writeFileSync(path.join(dir, 'brief.json'), JSON.stringify({ viewerPromise: 'insufficient shape' }));
    const bad = await generateStructured({ stage: 'brief', role: 'planner', system: '', user: '', schema: contentBriefSchema });
    assert.equal(bad.data, null);
    assert.equal(bad.run.status, 'failed');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LLM_FIXTURES_DIR;
    delete process.env.LLM_MOCK;
    delete process.env.GENERATION_RUNS_PATH;
    clearIdempotencyCache();
    await new Promise<void>(resolve => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
