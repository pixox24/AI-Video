import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  classifyLlmChatModels,
  fetchOpenAiCompatibleModelList,
  isLikelyChatModel,
  parseOpenAiModelsPayload,
  resolveOpenAiModelsUrls,
  sanitizeOpenAiApiKey,
  sanitizeOpenAiEndpoint
} from './openAiModels';
import { LLM_PROVIDER_PRESETS } from './presets';

test('sanitize strips quotes, bearer prefix and trailing slash', () => {
  assert.equal(sanitizeOpenAiEndpoint('"https://api.example.com/v1/"'), 'https://api.example.com/v1');
  assert.equal(sanitizeOpenAiEndpoint('api.example.com/v1'), 'https://api.example.com/v1');
  assert.equal(sanitizeOpenAiApiKey('Bearer sk-test'), 'sk-test');
});

test('resolveOpenAiModelsUrls covers root, /v1 and chat completions endpoints', () => {
  assert.deepEqual(resolveOpenAiModelsUrls('https://api.openai.com/v1'), [
    'https://api.openai.com/v1/models',
    'https://api.openai.com/models'
  ]);
  assert.ok(resolveOpenAiModelsUrls('https://gateway.example.com').includes('https://gateway.example.com/v1/models'));
  assert.ok(resolveOpenAiModelsUrls('https://proxy.example.com/v1/chat/completions').includes('https://proxy.example.com/v1/models'));
});

test('parseOpenAiModelsPayload accepts data/models/array shapes', () => {
  assert.deepEqual(parseOpenAiModelsPayload({
    data: [{ id: 'gpt-4o' }, { name: 'deepseek-chat' }, { id: 'gpt-4o' }]
  }), ['gpt-4o', 'deepseek-chat']);
  assert.deepEqual(parseOpenAiModelsPayload({ models: ['qwen-max', { model: 'qwen-plus' }] }), ['qwen-max', 'qwen-plus']);
  assert.deepEqual(parseOpenAiModelsPayload(['llama-3']), ['llama-3']);
});

test('classifyLlmChatModels drops image/audio/embedding ids and keeps chat models', () => {
  const { chatModels, skipped } = classifyLlmChatModels([
    'gpt-4o-mini',
    'deepseek-v4-flash',
    'text-embedding-3-small',
    'dall-e-3',
    'whisper-1',
    'qwen-max'
  ]);
  assert.deepEqual(chatModels, ['gpt-4o-mini', 'deepseek-v4-flash', 'qwen-max']);
  assert.ok(skipped.includes('dall-e-3'));
  assert.equal(isLikelyChatModel('moonshot-v1-8k'), true);
  assert.equal(isLikelyChatModel('flux-schnell'), false);
});

test('classifyLlmChatModels falls back to the full list when nothing looks like chat', () => {
  const { chatModels, skipped } = classifyLlmChatModels(['alpha-1', 'beta-2']);
  assert.deepEqual(chatModels, ['alpha-1', 'beta-2']);
  assert.deepEqual(skipped, []);
});

test('LLM 自定义兼容接口已开放且可拉取模型', () => {
  const custom = LLM_PROVIDER_PRESETS.find((item) => item.id === 'custom');
  assert.equal(custom?.available, true);
  assert.equal(custom?.badge, '自建');
  assert.ok((custom?.docHint || '').includes('拉取模型'));
});

test('fetchOpenAiCompatibleModelList 读取 /v1/models 并带上 Bearer', async () => {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      assert.equal(req.headers.authorization, 'Bearer sk-test');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          { id: 'gpt-4o-mini' },
          { id: 'dall-e-3' },
          { id: 'text-embedding-3-small' }
        ]
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const result = await fetchOpenAiCompatibleModelList(`http://127.0.0.1:${address.port}/v1`, 'sk-test');
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.models, ['gpt-4o-mini', 'dall-e-3', 'text-embedding-3-small']);
      const classified = classifyLlmChatModels(result.models);
      assert.deepEqual(classified.chatModels, ['gpt-4o-mini']);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
