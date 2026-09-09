import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { cleanAndParseJSON, compactLlmFailureReason } from "./parse";
import { isUsableLlmApi } from "./client-api";
import { promptHash } from "./runs";
import { generateStructured } from "./gateway";
import { clearIdempotencyCache } from "./idempotency";
import { loadMockPayload } from "./mock";
import { countBudgetUnits } from "../../src/utils/scriptLanguage";

test("cleanAndParseJSON strips fences and trailing commas", () => {
  const parsed = cleanAndParseJSON<{ ok: boolean }>("```json\n{\"ok\":true,}\n```");
  assert.deepEqual(parsed, { ok: true });
});

test("compactLlmFailureReason maps region and timeout", () => {
  assert.equal(compactLlmFailureReason("User location is not supported"), "内置 Gemini 在当前网络或地区不可用");
  assert.equal(compactLlmFailureReason("AbortError: timed out"), "模型请求超时");
});

test("isUsableLlmApi rejects builtin and incomplete configs", () => {
  assert.equal(isUsableLlmApi({ provider: "builtin", endpoint: "https://x", apiKey: "k" }), false);
  assert.equal(isUsableLlmApi({ endpoint: "https://x", apiKey: "k" }), true);
  assert.equal(isUsableLlmApi({ endpoint: "https://x", apiKey: "" }), false);
});

test("promptHash is stable", () => {
  assert.equal(promptHash("s", "u"), promptHash("s", "u"));
  assert.notEqual(promptHash("s", "u"), promptHash("s", "u2"));
});

test("mock script_section fills unit range from prompt", () => {
  const user = "本章口播汉字数必须在 80–120 之间。";
  const loaded = loadMockPayload("script_section", user);
  assert.equal(loaded.missing, false);
  const rec = loaded.data as { narration: string };
  const used = countBudgetUnits(rec.narration, "zh");
  assert.ok(used >= 80 && used <= 120, `got ${used}`);
});

test("generateStructured mock writes JSONL and honors idempotency", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gen-runs-"));
  const runsFile = path.join(dir, "generation-runs.jsonl");
  process.env.LLM_MOCK = "true";
  process.env.GENERATION_RUNS_PATH = runsFile;
  clearIdempotencyCache();
  const first = await generateStructured({
    stage: "blueprint",
    role: "planner",
    system: "sys",
    user: "user",
    idempotencyKey: "k1"
  });
  assert.equal(first.run.status, "mocked");
  assert.ok(first.data);
  const second = await generateStructured({
    stage: "blueprint",
    role: "planner",
    system: "sys",
    user: "user",
    idempotencyKey: "k1"
  });
  assert.equal(second.run.id, first.run.id);
  const lines = fs.readFileSync(runsFile, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  delete process.env.LLM_MOCK;
  delete process.env.GENERATION_RUNS_PATH;
  clearIdempotencyCache();
});
