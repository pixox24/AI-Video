import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import { generateStructured } from './gateway';
import { clearIdempotencyCache } from './idempotency';

test('schema retry feeds errors back, stops after two retries, and permits retry after a failed request', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-retry-'));
  const previousMock = process.env.LLM_MOCK;
  const nativeFetch = globalThis.fetch;
  const prompts: string[] = [];
  let validOnAttempt = 3;
  // Exercise the provider adapter using an in-memory transport. No network or real model.
  globalThis.fetch = async (_url, init) => {
    prompts.push(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(prompts.length === validOnAttempt ? { promise: '结果' } : { promise: '' }) } }] }), { status: 200 });
  };
  process.env.LLM_MOCK = 'false';
  process.env.GENERATION_RUNS_PATH = path.join(dir, 'runs.jsonl');
  const opts = { stage: 'brief', role: 'planner' as const, system: 'system', user: 'user', schema: z.object({ promise: z.string().min(1) }).strict(), clientLlmApi: { endpoint: 'https://transport.invalid/v1', apiKey: 'fake', model: 'mock-transport' }, idempotencyKey: 'schema-retry' };
  try {
    clearIdempotencyCache();
    const result = await generateStructured(opts);
    assert.deepEqual(result.data, { promise: '结果' });
    assert.equal(prompts.length, 3);
    assert.match(prompts[0], /JSON Schema/);
    assert.match(prompts[1], /Correct these errors/);
    const runs = fs.readFileSync(process.env.GENERATION_RUNS_PATH, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { status: string; promptHash: string });
    assert.deepEqual(runs.map(run => run.status), ['failed', 'failed', 'success']);
    assert.notEqual(runs[0].promptHash, runs[1].promptHash);
    clearIdempotencyCache(); prompts.length = 0; validOnAttempt = 99;
    assert.equal((await generateStructured(opts)).data, null);
    assert.equal(prompts.length, 3);
    validOnAttempt = 4;
    assert.ok((await generateStructured(opts)).data);
    assert.equal(prompts.length, 4);
  } finally {
    globalThis.fetch = nativeFetch;
    if (previousMock === undefined) delete process.env.LLM_MOCK; else process.env.LLM_MOCK = previousMock;
    delete process.env.GENERATION_RUNS_PATH;
    clearIdempotencyCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
