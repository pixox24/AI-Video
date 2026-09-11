import type { GenerationRun } from '../../src/types';

export type RunUsage = Pick<GenerationRun, 'inputTokens' | 'outputTokens' | 'costUsd' | 'costSource'>;

// ponytail: unknown prices stay unknown; configure endpoint/model rates when the provider omits USD cost.
export function readUsage(raw: unknown, endpoint: string, model: string): RunUsage {
  const data = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const inputTokens = number(data.prompt_tokens ?? data.promptTokenCount);
  const candidates = number(data.completion_tokens ?? data.candidatesTokenCount);
  const thoughts = number(data.thoughtsTokenCount) ?? 0;
  const outputTokens = candidates === null ? null : candidates + thoughts;
  const reportedCost = number(data.cost);
  if (reportedCost !== null) return { inputTokens, outputTokens, costUsd: reportedCost, costSource: 'provider' };
  let rates: Record<string, { input: number; cachedInput?: number; output: number; source: string }> = {};
  try { const parsed: unknown = JSON.parse(process.env.LLM_PRICING_JSON || '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) rates = parsed as typeof rates; } catch { /* Invalid configuration is not a zero price. */ }
  const rate = rates[`${endpoint.replace(/\/+$/, '')}|${model}`];
  const details = data.prompt_tokens_details as Record<string, unknown> | undefined;
  const cached = number(data.prompt_cache_hit_tokens ?? details?.cached_tokens ?? data.cachedContentTokenCount) ?? 0;
  if (inputTokens !== null && outputTokens !== null && rate?.source && number(rate.input) !== null && number(rate.output) !== null && cached <= inputTokens && (!cached || number(rate.cachedInput) !== null)) {
    return { inputTokens, outputTokens, costUsd: ((inputTokens - cached) * rate.input + cached * (rate.cachedInput ?? rate.input) + outputTokens * rate.output) / 1_000_000, costSource: rate.source };
  }
  return { inputTokens, outputTokens, costUsd: null, costSource: 'unavailable' };
}
