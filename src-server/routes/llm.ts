import type { Express } from "express";
import {
  classifyLlmChatModels,
  fetchOpenAiCompatibleModelList,
  resolveBailianLlmEndpoint
} from "../../src/utils/openAiModels";
import { fetchGeminiNativeModelList } from "../../src/utils/geminiNative";
import { generateStructured } from "../llm/gateway";
import { cleanAndParseJSON } from "../llm/parse";
import { errorMessage, requestBody, toLoose } from "../loose";

export function registerLlmRoutes(app: Express): void {
  app.post("/api/llm/test", async (req, res) => {
    const startTime = Date.now();
    const body = requestBody(req.body as unknown);
    const endpoint = body.endpoint;
    const apiKey = body.apiKey;
    const model = body.model || "";
    const provider = body.provider || "deepseek";
    const providerId = String(provider || "").toLowerCase();

    if (!endpoint || typeof endpoint !== "string" || !endpoint.trim()) {
      return res.status(400).json({ ok: false, error: "请输入 API 接口地址" });
    }
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return res.status(400).json({ ok: false, error: "请输入 API 密钥" });
    }
    if (providerId !== "deepseek" && providerId !== "bailian" && !String(model || "").trim()) {
      return res.status(400).json({ ok: false, error: "请填写或选择模型" });
    }

    try {
      const result = await generateStructured({
        stage: "llm_test",
        role: "drafter",
        clientLlmApi: {
          enabled: true,
          endpoint,
          apiKey,
          model: String(model || (providerId === "bailian" ? "qwen-plus" : "deepseek-v4-flash")),
          provider: typeof provider === "string" ? provider : "deepseek"
        },
        system: "You are a concise API connectivity checker. Reply with JSON only.",
        user: 'Reply with JSON: {"ok":true,"message":"LLM ready"}',
        temperature: 0,
        json: true,
        timeoutMs: 20000,
        maxTokens: 256
      });
      const latencyMs = Date.now() - startTime;
      const text = result.text || (typeof result.data === "string" ? result.data : result.data ? JSON.stringify(result.data) : "");

      if (result.data != null || text) {
        const parsed = typeof result.data === "object" && result.data ? toLoose(result.data) : toLoose(cleanAndParseJSON(text));
        return res.json({
          ok: true,
          latencyMs,
          model: result.run.model,
          preview: parsed.message || text.slice(0, 80)
        });
      }

      return res.status(400).json({
        ok: false,
        latencyMs,
        error: result.reason
      });
    } catch (err: unknown) {
      return res.status(500).json({
        ok: false,
        latencyMs: Date.now() - startTime,
        error: errorMessage(err, "LLM 测试请求失败")
      });
    }
  });

  app.post("/api/llm/fetch-models", async (req, res) => {
    const body = requestBody(req.body as unknown);
    const endpoint = body.endpoint;
    const apiKey = body.apiKey;
    const provider = body.provider;
    if (!endpoint || typeof endpoint !== "string" || !endpoint.trim()) {
      return res.status(400).json({ ok: false, error: "请输入 API 接口地址" });
    }
    if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
      return res.status(400).json({ ok: false, error: "请输入 API 密钥" });
    }

    const providerId = String(provider || "").toLowerCase();
    const listEndpoint = providerId === "bailian" ? resolveBailianLlmEndpoint(endpoint) : endpoint;
    const result = providerId === "gemini"
      ? await fetchGeminiNativeModelList(endpoint, apiKey)
      : await fetchOpenAiCompatibleModelList(listEndpoint, apiKey);
    if (result.ok === false) {
      const failure = result;
      return res.status(failure.status || 500).json({
        ok: false,
        error: `无法从端点获取模型列表: ${failure.error}`,
        diagnosis: failure.status === 401
          ? providerId === "bailian"
            ? "API Key 无效。请用百炼控制台（北京地域）复制的 sk- Key，并确认与接口地域一致。"
            : "API Key 无效或未授权访问模型列表接口。"
          : providerId === "gemini"
            ? "该 Gemini 服务商可能未开放 /models 接口。您仍可以直接手动填入模型 id。"
            : providerId === "bailian"
              ? "无法从百炼 /compatible-mode/v1/models 拉取列表。请确认地址是 compatible-mode/v1，模型仍可手动填写。"
              : "该服务商可能未开放 /v1/models 接口，或端点地址不正确。您仍可以直接手动填入聊天模型 id。"
      });
    }

    const { chatModels, skipped } = classifyLlmChatModels(result.models);
    return res.json({
      ok: true,
      models: result.models,
      chatModels,
      skippedCount: skipped.length,
      totalCount: result.models.length,
      modelUrlUsed: result.modelUrlUsed
    });
  });
}
