export function isConfiguredSecret(value?: string | null): boolean {
  const v = String(value || "").trim().replace(/^["']|["']$/g, "");
  if (!v) return false;
  if (/^(MY_|YOUR_|placeholder|changeme|xxx)/i.test(v)) return false;
  if (v.includes("<") || v.includes(">")) return false;
  return true;
}

export function sanitizeHttpUrl(raw: string): string {
  let val = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (val && !val.startsWith("http://") && !val.startsWith("https://")) {
    val = "https://" + val;
  }
  return val.replace(/\/+$/, "");
}

export function sanitizeBearerKey(raw: string): string {
  let val = String(raw || "").trim().replace(/^["']|["']$/g, "");
  if (val.toLowerCase().startsWith("bearer ")) {
    val = val.slice(7).trim();
  }
  return val;
}

export async function fetchWithTimeout(url: string, ms = 8000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AI-VideoResearch/1.0)",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

export function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("请求超时")), Math.max(1, timeoutMs));
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }).catch((error: unknown) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
