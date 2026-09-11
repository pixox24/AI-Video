import type { GenerateStructuredResult } from "./types";

const cache = new Map<string, GenerateStructuredResult>();

export function getIdempotentResult(key: string | undefined): GenerateStructuredResult | undefined {
  if (!key) return undefined;
  return cache.get(key);
}

export function setIdempotentResult(key: string | undefined, result: GenerateStructuredResult): void {
  if (!key) return;
  cache.set(key, result);
}

export function clearIdempotencyCache(): void {
  cache.clear();
}
