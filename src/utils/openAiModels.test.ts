import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  classifyLlmChatModels,
  extractOpenAiChatText,
  fetchOpenAiCompatibleModelList,
  isLikelyChatModel,
  parseOpenAiModelsPayload,
  resolveBailianLlmEndpoint,
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

test('extractOpenAiChatText 兼容字符串、分段和 reasoning_content', () => {
  assert.equal(extractOpenAiChatText({
    choices: [{ message: { content: '{"ok":true}' } }]
  }), '{"ok":true}');
  assert.equal(extractOpenAiChatText({
    choices: [{ message: { content: [{ type: 'text', text: '{"a":1}' }] } }]
  }), '{"a":1}');
  assert.equal(extractOpenAiChatText({
    choices: [{ message: { content: '', reasoning_content: '{"ok":true,"from":"reasoning"}' } }]
  }), '{"ok":true,"from":"reasoning"}');
});

test('LLM 自定义兼容接口已开放且可拉取模型', () => {
  const custom = LLM_PROVIDER_PRESETS.find((item) => item.id === 'custom');
  assert.equal(custom?.available, true);
  assert.equal(custom?.badge, '自建');
  assert.ok((custom?.docHint || '').includes('拉取模型'));
});

test('LLM 百炼已接入且可拉取模型', () => {
  const bailian = LLM_PROVIDER_PRESETS.find((item) => item.id === 'bailian');
  assert.equal(bailian?.available, true);
  assert.equal(bailian?.defaultEndpoint, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(bailian?.defaultModel, 'qwen-plus');
  assert.ok((bailian?.docHint || '').includes('拉取模型'));
  assert.ok(bailian?.popularModels.some((item) => item.id === 'qwen-plus'));
});

test('resolveBailianLlmEndpoint 归一到 compatible-mode/v1', () => {
  assert.equal(resolveBailianLlmEndpoint(''), 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(
    resolveBailianLlmEndpoint('https://dashscope.aliyuncs.com'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1'
  );
  assert.equal(
    resolveBailianLlmEndpoint('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'),
    'https://dashscope.aliyuncs.com/compatible-mode/v1'
  );
  assert.equal(
    resolveBailianLlmEndpoint('https://dashscope-intl.aliyuncs.com/api/v1'),
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
  );
  assert.equal(
    resolveBailianLlmEndpoint('https://ws-demo.ap-southeast-1.maas.aliyuncs.com'),
    'https://ws-demo.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1'
  );
});

test('百炼模型列表保留千问聊天、去掉语音和向量', () => {
  const { chatModels, skipped } = classifyLlmChatModels([
    'qwen-plus',
    'qwen-max',
    'qwen3.7-plus',
    'text-embedding-v3',
    'qwen-image-plus',
    'cosyvoice-v3',
    'wanx-v1'
  ]);
  assert.deepEqual(chatModels, ['qwen-plus', 'qwen-max', 'qwen3.7-plus']);
  assert.ok(skipped.includes('cosyvoice-v3'));
  assert.ok(skipped.includes('text-embedding-v3'));
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
