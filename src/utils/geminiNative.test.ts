import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  buildGeminiRequestBody,
  callGeminiNativeChat,
  fetchGeminiNativeModelList,
  parseGeminiModelsPayload,
  resolveGeminiGenerateContentUrl,
  resolveGeminiModelsUrl
} from './geminiNative';

test('Gemini native URLs normalize base URLs and model names', () => {
  assert.equal(
    resolveGeminiGenerateContentUrl('https://example.com/v1beta/', 'models/gemini-3.7-flash'),
    'https://example.com/v1beta/models/gemini-3.7-flash:generateContent'
  );
  assert.equal(resolveGeminiModelsUrl('https://example.com/v1beta'), 'https://example.com/v1beta/models');
});

test('Gemini native request uses generateContent format and x-goog-api-key', async () => {
  const server = http.createServer(async (req, res) => {
    assert.equal(req.method, 'POST');
    assert.equal(req.url, '/v1beta/models/gemini-3.7-flash:generateContent');
    assert.equal(req.headers['x-goog-api-key'], 'sk-test');
    let body = '';
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body);
    assert.equal(parsed.systemInstruction.parts[0].text, 'system');
    assert.equal(parsed.contents[0].parts[0].text, 'user');
    assert.equal(parsed.generationConfig.responseMimeType, 'application/json');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const result = await callGeminiNativeChat({
      endpoint: `http://127.0.0.1:${address.port}/v1beta`,
      apiKey: 'Bearer sk-test',
      model: 'gemini-3.7-flash',
      system: 'system',
      user: 'user',
      json: true,
      timeoutMs: 1000
    });
    assert.deepEqual(result, { ok: true, text: '{"ok":true}', model: 'gemini-3.7-flash', status: 200 });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('Gemini native model list keeps generateContent models only', () => {
  assert.deepEqual(parseGeminiModelsPayload({
    models: [
      { name: 'models/gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
      { name: 'gemini-3.7-flash', supportedGenerationMethods: ['generateContent'] }
    ]
  }), ['gemini-3.7-flash']);
});

test('Gemini native model list sends the native API key header', async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/v1beta/models');
    assert.equal(req.headers['x-goog-api-key'], 'sk-test');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ models: [{ name: 'models/gemini-3.7-flash' }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const result = await fetchGeminiNativeModelList(`http://127.0.0.1:${address.port}/v1beta`, 'sk-test');
    assert.equal(result.ok, true);
    if (result.ok) assert.deepEqual(result.models, ['gemini-3.7-flash']);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('Gemini request builder omits JSON mime when a model rejects it', () => {
  const body = buildGeminiRequestBody({ system: 's', user: 'u', json: true }, false);
  assert.equal('responseMimeType' in body.generationConfig, false);
});
