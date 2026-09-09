import type { ClientLlmApi } from "./types";
import { isLoose, toLoose } from "../loose";

export function isUsableLlmApi(llmApi: unknown): llmApi is ClientLlmApi {
  if (!llmApi || !isLoose(llmApi) || llmApi.provider === "builtin" || llmApi.enabled === false) return false;
  const api = toLoose(llmApi);
  return Boolean(
    typeof api.apiKey === "string" &&
      api.apiKey.trim().length > 0 &&
      typeof api.endpoint === "string" &&
      api.endpoint.trim().length > 0
  );
}

export function asClientLlmApi(llmApi: unknown): ClientLlmApi | null {
  if (!isLoose(llmApi)) return null;
  const api = toLoose(llmApi);
  return {
    enabled: api.enabled === false ? false : Boolean(api.enabled ?? true),
    provider: typeof api.provider === "string" ? api.provider : undefined,
    endpoint: typeof api.endpoint === "string" ? api.endpoint : undefined,
    apiKey: typeof api.apiKey === "string" ? api.apiKey : undefined,
    model: typeof api.model === "string" ? api.model : undefined
  };
}
