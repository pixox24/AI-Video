import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import { createExpressApp } from "../app";
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
