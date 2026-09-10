import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUsage } from './usage';

test('usage preserves provider billing, cache rates, Gemini thoughts and unknown values', () => {
  const previous = process.env.LLM_PRICING_JSON;
  try {
    assert.deepEqual(readUsage({ prompt_tokens: 12, completion_tokens: 3, cost: 0.001 }, '', ''), { inputTokens: 12, outputTokens: 3, costUsd: 0.001, costSource: 'provider' });
    process.env.LLM_PRICING_JSON = JSON.stringify({ 'https://test|model': { input: 1, cachedInput: 0.1, output: 2, source: 'test price' } });
    assert.equal(readUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 50 }, 'https://test/', 'model').costUsd, 0.000095);
    assert.equal(readUsage({ promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6 }, 'https://test', 'model').outputTokens, 10);
    assert.equal(readUsage({ prompt_tokens: 12, completion_tokens: 3 }, 'unknown', 'unknown').costUsd, null);
    assert.equal(readUsage({ prompt_tokens: -1, completion_tokens: '20' }, '', '').inputTokens, null);
    assert.equal(readUsage(null, '', '').outputTokens, null);
  } finally {
    if (previous === undefined) delete process.env.LLM_PRICING_JSON; else process.env.LLM_PRICING_JSON = previous;
  }
});
