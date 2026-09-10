import type { GenerationRun } from "../../src/types";
import type { z } from "zod";

export type { GenerationRun };

export type LlmRole = "planner" | "drafter" | "evaluator";

export type LlmStage =
  | "brief"
  | "blueprint"
  | "script_section"
  | "section_revise"
  | "quality"
  | "script_draft"
  | "script_generate"
  | "topics"
  | "research"
  | "reference"
  | "concepts"
  | "coverage"
  | "split_spans"
  | "visual_bible"
  | "polish_narration"
  | "translate_secondary"
  | "split_text"
  | "style_infer"
  | "style_rewrite"
  | "style_vision"
  | "llm_test"
  | "topics_suggest";

export type ClientLlmApi = {
  enabled?: boolean;
  provider?: string;
  endpoint?: string;
  apiKey?: string;
  model?: string;
};

export type ChatCallResult = {
  ok: boolean;
  text?: string;
  model?: string;
  error?: string;
  status?: number;
};

export type ScriptLlmJsonAttempt = {
  data: unknown;
  reason?: string;
};

export type GenerateStructuredInput<T = unknown> = {
  stage: string;
  role: LlmRole;
  clientLlmApi?: unknown;
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
  json?: boolean;
  idempotencyKey?: string;
  projectId?: string;
  /** Opt-in strict schema; legacy callers retain their existing coerce behavior. */
  schema?: z.ZodType<T>;
};

export type GenerateStructuredResult<T = unknown> = {
  data: T | null;
  reason?: string;
  run: GenerationRun;
  text?: string;
};
