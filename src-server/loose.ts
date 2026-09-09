/** Recursive JSON bag for request bodies and loosely-parsed LLM output. Not `any`. */
export type LooseValue = string | number | boolean | null | undefined | Loose | LooseValue[];

export interface Loose {
  [key: string]: LooseValue;
}

export function isLoose(value: unknown): value is Loose {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function toLoose(value: unknown): Loose {
  return isLoose(value) ? value : {};
}

export function toLooseList(value: unknown): Loose[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toLoose(item));
}

export function errorMessage(err: unknown, fallback = "未知错误"): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

export function looseString(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return String(value);
  return fallback;
}

export function requestBody(body: unknown): Loose {
  return toLoose(body);
}

export function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = looseString(value);
    if (text) return text;
  }
  return "";
}

export function asNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function asBoolean(value: unknown): boolean {
  return Boolean(value);
}
