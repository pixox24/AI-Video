import { LLM_JSON_MAX_TOKENS } from "../../src/utils/scriptDuration";
import { z } from 'zod';
import type { GenerationRun } from "../../src/types";
import { errorMessage } from "../loose";
import { promiseWithTimeout } from "../http";
import { isUsableLlmApi, asClientLlmApi } from "./client-api";
import { getGeminiClient } from "./gemini";
import { getIdempotentResult, setIdempotentResult } from "./idempotency";
import { isLlmMock, loadMockPayload } from "./mock";
import { BUILTIN_GEMINI_MODEL, resolveClientModel } from "./models";
import { callOpenAiCompatibleChat } from "./openai-compatible";
import { cleanAndParseJSON, compactLlmFailureReason, endpointHost } from "./parse";
import { appendGenerationRun, createRunId, promptHash } from "./runs";
import type {
  GenerateStructuredInput,
  GenerateStructuredResult,
  ScriptLlmJsonAttempt
} from "./types";

function finishRun(partial: Omit<GenerationRun, "createdAt">): GenerationRun {
  const run: GenerationRun = {
    ...partial,
    createdAt: new Date().toISOString()
  };
  appendGenerationRun(run);
  return run;
}

async function callModelJson(opts: {
  clientLlmApi: unknown;
  role: GenerateStructuredInput["role"];
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
  json?: boolean;
}): Promise<{ data: unknown; text?: string; reason?: string; model: string; host?: string }> {
  const failures: string[] = [];
  const client = asClientLlmApi(opts.clientLlmApi);
  const customConfigured = isUsableLlmApi(opts.clientLlmApi);
  const json = opts.json !== false;
  if (customConfigured && client) {
    const model = resolveClientModel(client, opts.role);
    const llmResult = await callOpenAiCompatibleChat({
      endpoint: String(client.endpoint),
      apiKey: String(client.apiKey),
      model,
      provider: client.provider,
      system: opts.system,
      user: opts.user,
      temperature: opts.temperature ?? 0.6,
      json,
      timeoutMs: opts.timeoutMs,
      maxTokens: opts.maxTokens || LLM_JSON_MAX_TOKENS
    });
    const host = endpointHost(client.endpoint);
    if (llmResult.ok && llmResult.text) {
      if (!json) return { data: llmResult.text, text: llmResult.text, model, host };
      const data = cleanAndParseJSON(llmResult.text);
      if (data) return { data, text: llmResult.text, model, host };
      failures.push("自定义 LLM 返回的内容不是有效 JSON");
    } else {
      const reason = compactLlmFailureReason(llmResult.error);
      console.warn("[Script LLM] custom failed:", reason);
      failures.push(`自定义 LLM：${reason}`);
    }
    return {
      data: null,
      reason: failures.join("；") || "自定义 LLM 没有返回可用 JSON",
      model,
      host
    };
  }
  const ai = getGeminiClient();
  if (ai) {
    try {
      const response = await promiseWithTimeout(ai.models.generateContent({
        model: BUILTIN_GEMINI_MODEL,
        contents: opts.user,
        config: {
          systemInstruction: opts.system,
          temperature: opts.temperature ?? 0.6,
          responseMimeType: json ? "application/json" : undefined,
          maxOutputTokens: opts.maxTokens || LLM_JSON_MAX_TOKENS
        }
      }), opts.timeoutMs || 60000);
      const text = response.text;
      if (!json) return { data: text, text, model: BUILTIN_GEMINI_MODEL };
      const data = cleanAndParseJSON(text);
      if (data) return { data, text, model: BUILTIN_GEMINI_MODEL };
      failures.push("内置 Gemini 返回的内容不是有效 JSON");
    } catch (err: unknown) {
      const reason = compactLlmFailureReason(errorMessage(err));
      console.warn("[Script LLM] gemini failed:", reason);
      failures.push(`内置 Gemini：${reason}`);
    }
  } else if (!isUsableLlmApi(opts.clientLlmApi)) {
    failures.push("未配置可用的自定义 LLM，且内置 Gemini 不可用");
  }
  return {
    data: null,
    reason: failures.join("；") || "模型没有返回可用结果",
    model: customConfigured && client ? resolveClientModel(client, opts.role) : BUILTIN_GEMINI_MODEL,
    host: customConfigured && client ? endpointHost(client.endpoint) : undefined
  };
}

export async function generateStructured<T = unknown>(
  opts: GenerateStructuredInput<T>
): Promise<GenerateStructuredResult<T>> {
  const started = Date.now();
  const system = opts.schema ? `${opts.system}\nOutput must match this JSON Schema: ${JSON.stringify(z.toJSONSchema(opts.schema))}` : opts.system;
  const cached = getIdempotentResult(opts.idempotencyKey);
  if (cached) {
    return cached as GenerateStructuredResult<T>;
  }

  if (isLlmMock()) {
    const loaded = loadMockPayload(opts.stage, opts.user);
    const validated = !loaded.missing && opts.schema ? opts.schema.safeParse(loaded.data) : undefined;
    const invalid = validated?.success === false;
    const run = finishRun({
      id: createRunId(),
      projectId: opts.projectId,
      stage: opts.stage,
      model: "mock",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: Date.now() - started,
      status: loaded.missing || invalid ? "failed" : "mocked",
      promptHash: promptHash(system, opts.user)
    });
    const result: GenerateStructuredResult<T> = {
      data: loaded.missing || invalid ? null : validated?.success ? validated.data : (loaded.data as T),
      reason: loaded.missing ? `缺少 Mock fixture：${opts.stage}` : validated?.success === false ? validated.error.message : undefined,
      run
    };
    if (!opts.schema || result.data !== null) setIdempotentResult(opts.idempotencyKey, result);
    return result;
  }

  let user = opts.user;
  let called: Awaited<ReturnType<typeof callModelJson>>;
  for (let attempt = 0; ; attempt++) {
    called = await callModelJson({
    clientLlmApi: opts.clientLlmApi,
    role: opts.role,
    system,
    user,
    temperature: opts.temperature,
    timeoutMs: opts.timeoutMs,
    maxTokens: opts.maxTokens,
    json: opts.json
    });
    if (!opts.schema) break;
    const parsed = opts.schema.safeParse(called.data);
    if (parsed.success) { called.data = parsed.data; break; }
    called.data = null;
    called.reason = `Schema validation failed: ${parsed.error.message}`;
    if (attempt >= 2) break;
    finishRun({ id: createRunId(), projectId: opts.projectId, stage: opts.stage, model: called.model,
      endpointHost: called.host, inputTokens: 0, outputTokens: 0, costUsd: 0,
      durationMs: Date.now() - started, status: 'failed', promptHash: promptHash(system, user) });
    user = `${opts.user}\nPrevious output failed validation. Correct these errors: ${parsed.error.message}`;
  }
  const ok = called.data != null;
  const run = finishRun({
    id: createRunId(),
    projectId: opts.projectId,
    stage: opts.stage,
    model: called.model,
    endpointHost: called.host,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    durationMs: Date.now() - started,
    status: ok ? "success" : "failed",
    promptHash: promptHash(system, user)
  });
  const result: GenerateStructuredResult<T> = {
    data: ok ? (called.data as T) : null,
    reason: called.reason,
    run,
    text: called.text
  };
  if (!opts.schema || result.data !== null) setIdempotentResult(opts.idempotencyKey, result);
  return result;
}

/** Compatibility wrapper: existing runScriptLlmJsonDetailed behavior. */
export async function runScriptLlmJsonDetailed(opts: {
  llmApi: unknown;
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
  stage?: string;
  role?: GenerateStructuredInput["role"];
  projectId?: string;
}): Promise<ScriptLlmJsonAttempt> {
  const result = await generateStructured({
    stage: opts.stage || "script_draft",
    role: opts.role || "drafter",
    clientLlmApi: opts.llmApi,
    system: opts.system,
    user: opts.user,
    temperature: opts.temperature,
    timeoutMs: opts.timeoutMs,
    maxTokens: opts.maxTokens,
    projectId: opts.projectId
  });
  return { data: result.data, reason: result.reason };
}

export async function runScriptLlmJson(opts: {
  llmApi: unknown;
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
  stage?: string;
  role?: GenerateStructuredInput["role"];
  projectId?: string;
}): Promise<unknown> {
  return (await runScriptLlmJsonDetailed(opts)).data;
}

type GeminiSchemaJsonInput = {
  stage: string;
  role?: GenerateStructuredInput["role"];
  system: string;
  user: string;
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
  models?: string[];
  responseSchema?: unknown;
  projectId?: string;
};

/** Builtin Gemini path with optional responseSchema / model fallbacks (existing generate/split-text/polish). */
export async function generateGeminiJson(opts: GeminiSchemaJsonInput): Promise<GenerateStructuredResult> {
  const started = Date.now();
  if (isLlmMock()) {
    const loaded = loadMockPayload(opts.stage, opts.user);
    const run = finishRun({
      id: createRunId(),
      projectId: opts.projectId,
      stage: opts.stage,
      model: "mock",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: Date.now() - started,
      status: loaded.missing ? "failed" : "mocked",
      promptHash: promptHash(opts.system, opts.user)
    });
    return {
      data: loaded.missing ? null : loaded.data,
      reason: loaded.missing ? `缺少 Mock fixture：${opts.stage}` : undefined,
      run,
      text: typeof loaded.data === "string" ? loaded.data : JSON.stringify(loaded.data)
    };
  }

  const ai = getGeminiClient();
  const models = opts.models && opts.models.length > 0 ? opts.models : [BUILTIN_GEMINI_MODEL];
  const failures: string[] = [];
  if (!ai) {
    const run = finishRun({
      id: createRunId(),
      projectId: opts.projectId,
      stage: opts.stage,
      model: models[0],
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: Date.now() - started,
      status: "failed",
      promptHash: promptHash(opts.system, opts.user)
    });
    return { data: null, reason: "未配置可用的自定义 LLM，且内置 Gemini 不可用", run };
  }

  let lastError = "";
  for (const modelName of models) {
    try {
      const response = await promiseWithTimeout(ai.models.generateContent({
        model: modelName,
        contents: opts.user,
        config: {
          systemInstruction: opts.system,
          temperature: opts.temperature ?? 0.6,
          responseMimeType: "application/json",
          maxOutputTokens: opts.maxTokens || LLM_JSON_MAX_TOKENS,
          ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {})
        }
      }), opts.timeoutMs || 60000);
      const text = response.text;
      const data = cleanAndParseJSON(text);
      if (data) {
        const run = finishRun({
          id: createRunId(),
          projectId: opts.projectId,
          stage: opts.stage,
          model: modelName,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          durationMs: Date.now() - started,
          status: "success",
          promptHash: promptHash(opts.system, opts.user)
        });
        return { data, run, text };
      }
      failures.push(`${modelName}: 内置 Gemini 返回的内容不是有效 JSON`);
    } catch (err: unknown) {
      lastError = compactLlmFailureReason(errorMessage(err));
      failures.push(`${modelName}: ${lastError}`);
      console.warn(`[Script LLM] gemini ${modelName} failed:`, lastError);
    }
  }

  const run = finishRun({
    id: createRunId(),
    projectId: opts.projectId,
    stage: opts.stage,
    model: models[0],
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    durationMs: Date.now() - started,
    status: "failed",
    promptHash: promptHash(opts.system, opts.user)
  });
  return { data: null, reason: failures.join("；") || lastError || "模型没有返回可用结果", run };
}
