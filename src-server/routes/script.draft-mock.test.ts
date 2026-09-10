import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { createExpressApp } from "../app";
import { qualityRequestSchema } from '../../src/shared/quality';
import { clearIdempotencyCache } from "../llm/idempotency";

async function withServer(run: (base: string) => Promise<void>): Promise<void> {
  const app = createExpressApp();
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
}

test("frozen contracts: health / generate 410 / generate 400", async () => {
  process.env.LLM_MOCK = "true";
  await withServer(async (base) => {
    const health = await fetch(`${base}/api/health`);
    const healthJson = await health.json() as { status: string; hasApiKey: boolean };
    assert.equal(health.status, 200);
    assert.equal(healthJson.status, "ok");
    assert.equal(typeof healthJson.hasApiKey, "boolean");

    const gone = await fetch(`${base}/api/script/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: "黑洞", targetDuration: 180 })
    });
    assert.equal(gone.status, 410);
    const goneJson = await gone.json() as { error: string; code: string };
    assert.equal(goneJson.code, "legacy_shortform_endpoint");

    const bad = await fetch(`${base}/api/script/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    assert.equal(bad.status, 400);
  });
  delete process.env.LLM_MOCK;
});

test("LLM_MOCK draft longform goes through fixtures with zero real LLM", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-runs-"));
  const runsFile = path.join(dir, "generation-runs.jsonl");
  process.env.LLM_MOCK = "true";
  process.env.GENERATION_RUNS_PATH = runsFile;
  clearIdempotencyCache();

  await withServer(async (base) => {
    const preview = await fetch(`${base}/api/script/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "为什么睡眠债会拖垮判断力",
        budget: { targetSeconds: 240, maxChars: 1000, pace: "medium" }
      })
    });
    assert.equal(preview.status, 409);
    const previewJson = await preview.json() as {
      code: string;
      outline: { sections: unknown[] };
      scriptForm: string;
    };
    assert.equal(previewJson.code, "outline_required");
    assert.ok(Array.isArray(previewJson.outline.sections));
    assert.ok(previewJson.outline.sections.length >= 6);
    assert.equal(previewJson.scriptForm, "long");

    const confirmed = {
      ...previewJson.outline,
      status: "confirmed"
    };
    const drafted = await fetch(`${base}/api/script/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "为什么睡眠债会拖垮判断力",
        budget: { targetSeconds: 240, maxChars: 1000, pace: "medium" },
        outline: confirmed
      })
    });
    assert.equal(drafted.status, 200, await drafted.clone().text());
    const draftJson = await drafted.json() as { source: string; sections: unknown[]; fullNarration: string };
    assert.equal(draftJson.source, "llm");
    assert.ok(Array.isArray(draftJson.sections) && draftJson.sections.length >= 6);
    assert.ok(String(draftJson.fullNarration).length > 20);
  });

  const lines = fs.readFileSync(runsFile, "utf8").trim().split("\n").filter(Boolean);
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    const row = JSON.parse(line) as { status: string; model: string };
    assert.equal(row.status, "mocked");
    assert.equal(row.model, "mock");
  }
  delete process.env.LLM_MOCK;
  delete process.env.GENERATION_RUNS_PATH;
  clearIdempotencyCache();
});


test('HTTP 单章与整篇：字数偏差不丢稿，采用第3次结构重试，锁定不调用模型', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-policy-'));
  const previousMock = process.env.LLM_MOCK;
  const previousRuns = process.env.GENERATION_RUNS_PATH;
  const nativeFetch = globalThis.fetch;
  process.env.GENERATION_RUNS_PATH = path.join(dir, 'runs.jsonl');
  process.env.LLM_MOCK = 'true';
  const requests = new Map<number, number>();
  try {
    await withServer(async base => {
      const budget = { targetSeconds: 240, maxChars: 1000, pace: 'medium' };
      const send = async (endpoint: string, body: unknown) => {
        const response = await fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        return { status: response.status, data: await response.json() };
      };
      const preview = await send('/api/script/outline', { topic: '桌面整理方法', budget });
      assert.equal(preview.status, 200);
      const outline = { ...preview.data.outline, status: 'confirmed' };
      process.env.LLM_MOCK = 'false';
      globalThis.fetch = async (url, init) => {
        if (String(url).startsWith(base + '/')) return nativeFetch(url, init);
        assert.equal(String(url), 'https://draft-policy.invalid/v1/chat/completions');
        const body = JSON.parse(String(init?.body));
        const prompt = body.messages[1].content as string;
        const chapter = prompt.match(/【本章】(\d+)\/[^\n]*?\s(hook|setup|body|turn|proof|reveal|cta)\s/)!;
        assert.ok(chapter, prompt);
        const order = Number(chapter[1]);
        const calls = (requests.get(order) || 0) + 1; requests.set(order, calls);
        const narration = `第${order}章讲清第${order}个具体任务。`;
        const role = chapter[2] === 'body' ? 'proof' : chapter[2];
        const content = { narration, usedEvidenceIds: [], beats: [{ function: role, narration: calls < 3 ? '覆盖错误' : narration, energy: 'medium', visualIntent: '桌面物品', needsHold: false }] };
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status: 200 });
      };
      const common = { topic: '桌面整理方法', budget, outline, llmApi: { endpoint: 'https://draft-policy.invalid/v1', apiKey: 'test-only', model: 'transport' } };
      const single = await send('/api/script/section-draft', { ...common, sectionId: outline.sections[1].id, sections: [] });
      assert.equal(single.status, 200, JSON.stringify(single.data));
      assert.equal(requests.get(2), 3); assert.match(single.data.warnings.join(''), /参考预算/);
      assert.match(single.data.section.narration, /第2章/);
      assert.ok(qualityRequestSchema.safeParse({ outline, sections: [single.data.section] }).success, '单章结果必须能直接进入质量检查');
      const saved = { ...single.data.section, status: 'locked' };
      const locked = await send('/api/script/section-draft', { ...common, sectionId: saved.id, sections: [saved] });
      assert.equal(locked.status, 409); assert.equal(requests.get(2), 3);
      requests.clear();
      const full = await send('/api/script/draft', { ...common, sections: [saved] });
      assert.equal(full.status, 200, JSON.stringify(full.data));
      assert.equal(full.data.sections.length, outline.sections.length);
      assert.deepEqual(full.data.sections.find((s: { id: string }) => s.id === saved.id), saved);
      assert.equal(requests.has(2), false);
      assert.ok([...requests.values()].every(count => count === 3));
      assert.ok(full.data.warnings.length > 0);
    });
  } finally {
    globalThis.fetch = nativeFetch;
    if (previousMock === undefined) delete process.env.LLM_MOCK; else process.env.LLM_MOCK = previousMock;
    if (previousRuns === undefined) delete process.env.GENERATION_RUNS_PATH; else process.env.GENERATION_RUNS_PATH = previousRuns;
    clearIdempotencyCache(); fs.rmSync(dir, { recursive: true, force: true });
  }
});
