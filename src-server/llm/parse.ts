export function cleanAndParseJSON<T = unknown>(rawText: string | undefined): T | null {
  if (!rawText || typeof rawText !== "string") return null;

  let text = rawText.trim();

  if (text.includes("```")) {
    text = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  }

  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    const lastBrace = text.lastIndexOf("}");
    if (lastBrace > firstBrace) {
      text = text.substring(firstBrace, lastBrace + 1);
    }
  } else if (firstBracket !== -1) {
    const lastBracket = text.lastIndexOf("]");
    if (lastBracket > firstBracket) {
      text = text.substring(firstBracket, lastBracket + 1);
    }
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    try {
      const relaxed = text
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
      return JSON.parse(relaxed) as T;
    } catch (secondErr: unknown) {
      console.warn("[JSON Parser] Failed to parse sanitized string:", secondErr);
      return null;
    }
  }
}

export function compactLlmFailureReason(raw: unknown): string {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  if (!text) return "模型没有返回可用结果";
  if (/location is not supported|user location/i.test(text)) {
    return "内置 Gemini 在当前网络或地区不可用";
  }
  if (/abort|timeout|timed out|请求超时/i.test(text)) return "模型请求超时";
  return text.slice(0, 240);
}

export function endpointHost(endpoint?: string): string | undefined {
  const raw = String(endpoint || "").trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return url.hostname;
  } catch {
    return undefined;
  }
}
