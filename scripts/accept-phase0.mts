import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import ts from 'typescript';
import { createExpressApp } from '../src-server/app';

process.env.LLM_MOCK = 'true';
process.env.GENERATION_RUNS_PATH = 'data/phase0-acceptance.jsonl';
const nativeFetch = globalThis.fetch;
let externalCalls = 0;
globalThis.fetch = async () => { externalCalls++; throw new Error('Network disabled for acceptance'); };
const main = execFileSync('git', ['show', 'main:server.ts'], { encoding: 'utf8', maxBuffer: 4_000_000 });
const current = fs.readFileSync('src-server/routes/script.ts', 'utf8') + fs.readFileSync('src-server/routes/visual.ts', 'utf8');
const endpoints = ['/api/script/draft', '/api/script/outline', '/api/script/section-revise', '/api/visual/generate', '/api/script/split-text'];
function contracts(source: string, endpoint: string): string[] {
  const file = ts.createSourceFile('routes.ts', source, ts.ScriptTarget.Latest, true);
  const results: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === endpoint) {
      function responses(child: ts.Node): void {
        if (ts.isCallExpression(child) && /^res(?:\.status\([^)]*\))?\.json$/.test(child.expression.getText(file))) {
          const arg = child.arguments[0];
          const keys = arg && ts.isObjectLiteralExpression(arg)
            ? arg.properties.map(p => p.name?.getText(file) || 'spread').sort().join(',')
            : arg?.getText(file);
          results.push(`${child.expression.getText(file)}:${keys}`);
        }
        ts.forEachChild(child, responses);
      }
      responses(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...new Set(results)].sort();
}
for (const endpoint of endpoints) {
  const before = contracts(main, endpoint);
  assert.ok(before.length);
  assert.deepEqual(contracts(current, endpoint), before);
  console.log(`MAIN CONTRACT MATCH ${endpoint}: ${before.join(' | ')}`);
}
// These local builders produce the variable responses above; compare their bodies too.
for (const name of ['stampDraft', 'pinDraftTitle', 'splitFallback']) {
  function builder(source: string): string[] {
    const file = ts.createSourceFile('routes.ts', source, ts.ScriptTarget.Latest, true);
    const result: string[] = [];
    function visit(node: ts.Node): void {
      if (ts.isVariableDeclaration(node) && node.name.getText(file) === name && node.initializer && ts.isArrowFunction(node.initializer)) result.push(node.initializer.body.getText(file).replace(/\s+/g, ''));
      ts.forEachChild(node, visit);
    }
    visit(file); return result;
  }
  assert.ok(builder(main).length);
  assert.deepEqual(builder(current), builder(main));
  console.log(`MAIN RESPONSE BUILDER MATCH ${name}`);
}
const server = createServer(createExpressApp());
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  async function post(endpoint: string, body: unknown): Promise<Record<string, unknown>> {
    // Async curl leaves the event loop free to serve the request.
    const { execFile } = await import('node:child_process');
    const output = await new Promise<string>((resolve, reject) => execFile('curl.exe', ['-sS', '--max-time', '20', '-w', '\n%{http_code}', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body), base + endpoint], (err, stdout) => err ? reject(err) : resolve(stdout)));
    const cut = output.lastIndexOf('\n');
    const data = JSON.parse(output.slice(0, cut)) as Record<string, unknown>;
    console.log(`CURL ${endpoint} ${output.slice(cut + 1)} keys=${Object.keys(data).sort().join(',')}`);
    return data;
  }
  const draft = await post(endpoints[0], { topic: '睡眠与判断力', budget: { targetSeconds: 30 } });
  assert.match(String(draft.fullNarration), /模拟口播/);
  await post(endpoints[1], { topic: '睡眠与判断力', budget: { targetSeconds: 240, maxChars: 1000 } });
  await post(endpoints[2], { action: { sectionId: 's1', action: 'expand' }, sections: [{ id: 's1', title: '判断力', narration: '模拟口播', minUnits: 40, maxUnits: 120, status: 'ready' }] });
  await post(endpoints[3], {});
  await post(endpoints[4], { rawText: '睡眠影响判断。充足休息帮助恢复。' });
  const rows = fs.readFileSync(process.env.GENERATION_RUNS_PATH, 'utf8').trim().split('\n');
  for (const line of rows) {
    const row = JSON.parse(line) as Record<string, unknown>;
    for (const field of ['stage', 'model', 'inputTokens', 'outputTokens', 'costUsd', 'promptHash']) assert.ok(field in row);
    assert.ok(!/apiKey/i.test(line));
    assert.equal(row.model, 'mock');
    assert.ok(row.status === 'mocked' || (row.stage === 'split_text' && row.status === 'failed'));
  }
  assert.equal(externalCalls, 0);
  console.log(`MOCK fixture=script_draft.json; external calls=${externalCalls}; JSONL records=${rows.length}; required fields verified; apiKey absent; split_text missing fixture logs failed and uses deterministic fallback`);
} finally {
  globalThis.fetch = nativeFetch;
  await new Promise<void>(resolve => server.close(() => resolve()));
}
