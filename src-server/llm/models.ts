import type { ClientLlmApi, LlmRole } from "./types";

/** Role defaults; client model still wins when provided (existing behavior). */
export const ROLE_DEFAULT_MODELS: Record<LlmRole, string> = {
  planner: "deepseek-v4-flash",
  drafter: "deepseek-v4-flash",
  evaluator: "deepseek-v4-flash"
};

export const BUILTIN_GEMINI_MODEL = "gemini-3.7-flash";

export function resolveClientModel(client: ClientLlmApi | null, role: LlmRole): string {
  const provided = String(client?.model || "").trim();
  if (provided) return provided;
  const provider = String(client?.provider || "").toLowerCase();
  if (provider === "deepseek") return "deepseek-v4-flash";
  if (provider === "bailian") return "qwen-plus";
  return ROLE_DEFAULT_MODELS[role];
}
