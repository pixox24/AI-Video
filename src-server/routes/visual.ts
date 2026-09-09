// @ts-nocheck — mechanical port of server.ts visual routes; behavior frozen.
import type { Express } from "express";
import fs from "fs";
import path from "path";
import { fetchOpenAiCompatibleModelList } from "../../src/utils/openAiModels";
import { sanitizeBearerKey, sanitizeHttpUrl } from "../http";
import { errorMessage, requestBody, toLoose, type Loose } from "../loose";
import { generatedDir } from "../paths";
import { materializeClientImageUrl } from "../media";

function extractImageUrlUniversal(data: unknown): string | null {
  if (!data) return null;

  // 1. Direct String handling
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (!trimmed) return null;

    // Direct data URL
    if (trimmed.startsWith('data:image/')) return trimmed;

    // Direct HTTP URL
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      // Ignore schema definitions
      if (!trimmed.includes('json-schema.org') && !trimmed.includes('w3.org')) {
        return trimmed;
      }
    }

    // Markdown image ![alt](url)
    const mdMatch = trimmed.match(/!\[.*?\]\((https?:\/\/[^\s\)\'\"]+)\)/i);
    if (mdMatch && mdMatch[1]) return mdMatch[1];

    // HTML img tag <img src="url">
    const htmlMatch = trimmed.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
    if (htmlMatch && htmlMatch[1]) return htmlMatch[1];

    // Base64 data URL inside string
    const b64DataMatch = trimmed.match(/(data:image\/[a-zA-Z0-9+]+;base64,[A-Za-z0-9+/=]+)/i);
    if (b64DataMatch && b64DataMatch[1]) return b64DataMatch[1];

    // Raw Base64 string check (JPEG / PNG / WEBP / GIF header)
    if (trimmed.length > 200) {
      if (trimmed.startsWith('/9j/')) return `data:image/jpeg;base64,${trimmed}`;
      if (trimmed.startsWith('iVBORw0KGgo')) return `data:image/png;base64,${trimmed}`;
      if (trimmed.startsWith('UklGR')) return `data:image/webp;base64,${trimmed}`;
      if (trimmed.startsWith('R0lGOD')) return `data:image/gif;base64,${trimmed}`;
    }

    // Image URL with extension inside string
    const extMatch = trimmed.match(/(https?:\/\/[^\s"'<>\[\]\(\)]+?\.(?:png|jpe?g|webp|gif|svg)(\?[^\s"'<>\[\]\(\)]*)?)/i);
    if (extMatch && extMatch[1]) return extMatch[1];

    // Standalone URL inside string
    const bareUrlMatch = trimmed.match(/(https:\/\/[^\s"'<>\[\]\(\)]+)/i);
    if (bareUrlMatch && bareUrlMatch[1] && !bareUrlMatch[1].includes('json-schema') && !bareUrlMatch[1].includes('w3.org')) {
      return bareUrlMatch[1];
    }
    return null;
  }

  // 2. Direct OpenAI and common provider fields
  if (data?.data?.[0]?.url && typeof data.data[0].url === 'string') return data.data[0].url;
  if (data?.data?.[0]?.b64_json) return `data:image/png;base64,${data.data[0].b64_json}`;
  // NewAPI / OneAPI wrap: { data: { data: [ { url | b64_json } ] } }
  if (data?.data?.data?.[0]?.url && typeof data.data.data[0].url === 'string') return data.data.data[0].url;
  if (data?.data?.data?.[0]?.b64_json) return `data:image/png;base64,${data.data.data[0].b64_json}`;
  if (data?.data?.[0]?.image) {
    const imgVal = data.data[0].image;
    if (typeof imgVal === 'string') {
      return imgVal.startsWith('http') || imgVal.startsWith('data:image') ? imgVal : `data:image/png;base64,${imgVal}`;
    }
  }
  if (data?.data?.[0]?.base64) return `data:image/png;base64,${data.data[0].base64}`;
  if (data?.data?.[0]?.b64) return `data:image/png;base64,${data.data[0].b64}`;
  if (data?.data?.[0]?.img_url) return data.data[0].img_url;
  if (data?.data?.[0]?.file_url) return data.data[0].file_url;
  if (typeof data?.data === 'string' && (data.data.startsWith('http') || data.data.startsWith('data:image'))) return data.data;
  if (data?.data?.url && typeof data.data.url === 'string') return data.data.url;
  if (data?.data?.image_url && typeof data.data.image_url === 'string') return data.data.image_url;
  if (data?.data?.image && typeof data.data.image === 'string') return data.data.image;

  // 3. Array of string URLs or image objects
  if (Array.isArray(data?.images) && data.images.length > 0) {
    const first = data.images[0];
    const url = typeof first === 'string' ? first : first?.url || first?.image || first?.b64_json;
    if (typeof url === 'string') {
      if (url.startsWith('http') || url.startsWith('data:image')) return url;
      if (url.length > 200) return `data:image/png;base64,${url}`;
    }
  }

  // 4. Output / Outputs format (Replicate, DashScope, Midjourney, etc.)
  if (Array.isArray(data?.output) && data.output.length > 0) {
    const first = data.output[0];
    const url = typeof first === 'string' ? first : first?.url || first?.image || first?.file_url;
    if (typeof url === 'string' && (url.startsWith('http') || url.startsWith('data:image'))) return url;
  }
  if (typeof data?.output === 'string' && (data.output.startsWith('http') || data.output.startsWith('data:image'))) return data.output;
  if (data?.output?.url) return data.output.url;
  if (data?.output?.image) return data.output.image;
  if (data?.output?.results?.[0]?.url) return data.output.results[0].url;

  // 5. Result / Results format
  if (typeof data?.result === 'string' && (data.result.startsWith('http') || data.result.startsWith('data:image'))) return data.result;
  if (data?.result?.url) return data.result.url;
  if (data?.result?.image) return data.result.image;
  if (Array.isArray(data?.result) && data.result.length > 0) {
    const first = data.result[0];
    const url = typeof first === 'string' ? first : first?.url || first?.image;
    if (url) return url;
  }
  if (Array.isArray(data?.results) && data.results.length > 0) {
    const first = data.results[0];
    const url = typeof first === 'string' ? first : first?.url || first?.image;
    if (url) return url;
  }

  // 6. Direct top-level fields
  if (data?.image_url && typeof data.image_url === 'string') return data.image_url;
  if (data?.imageUrl && typeof data.imageUrl === 'string') return data.imageUrl;
  if (data?.img_url && typeof data.img_url === 'string') return data.img_url;
  if (data?.url && typeof data.url === 'string' && data.url.startsWith('http') && !data.url.includes('json-schema')) return data.url;
  if (data?.image && typeof data.image === 'string') {
    if (data.image.startsWith('http') || data.image.startsWith('data:image')) return data.image;
    if (data.image.length > 200) return `data:image/png;base64,${data.image}`;
  }

  // 7. Chat completions format
  const chatContent = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || data?.choices?.[0]?.delta?.content;
  if (chatContent) {
    const fromChat = extractImageUrlUniversal(chatContent);
    if (fromChat) return fromChat;
  }

  // 8. Universal Deep Search across all keys/nested arrays
  try {
    const visited = new Set();
    function deepSearch(obj: unknown, depth = 0): string | null {
      if (!obj || depth > 5 || visited.has(obj)) return null;
      if (typeof obj === 'object') visited.add(obj);

      if (typeof obj === 'string') {
        const found = extractImageUrlUniversal(obj);
        if (found) return found;
      } else if (Array.isArray(obj)) {
        for (const item of obj) {
          const res = deepSearch(item, depth + 1);
          if (res) return res;
        }
      } else if (typeof obj === 'object') {
        for (const key of Object.keys(obj)) {
          // Priority keys first
          if (['url', 'imageUrl', 'image_url', 'image', 'b64_json', 'base64', 'file_url', 'src', 'link', 'output', 'result'].includes(key)) {
            const found = extractImageUrlUniversal(obj[key]);
            if (found) return found;
          }
        }
        for (const key of Object.keys(obj)) {
          const res = deepSearch(obj[key], depth + 1);
          if (res) return res;
        }
      }
      return null;
    }
    const deepFound = deepSearch(data);
    if (deepFound) return deepFound;
  } catch {
    // Ignore deep crawl exceptions
  }

  return null;
}

function isLikelyBusinessError(data: unknown): boolean {
  if (!data || typeof data !== "object" || data.code === undefined) return false;
  const successCodes: Array<string | number> = [0, 1, 200, "0", "1", "200", "success", "ok", "Success", "OK"];
  if (successCodes.includes(data.code)) return false;
  if (data.data || data.images || data.output || data.result) return false;
  return true;
}

function extractTaskId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;

  const candidates = [
    data.task_id,
    data.taskId,
    data.taskID,
    data.result,
    data.data?.task_id,
    data.data?.taskId,
    data.data?.id,
    data.data?.result,
    data.output?.task_id,
    data.output?.taskId,
    data.output?.id,
    typeof data.data === "string" ? data.data : null,
    typeof data.result === "string" ? data.result : null,
    data.id
  ];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (!value || value.length > 180) continue;
    if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) continue;
    if (/^\d{10,13}$/.test(value)) continue;
    return value;
  }
  return null;
}

// Helper: Polls async image task if provider returns a task_id
async function pollAsyncTask(taskId: string, rootBase: string, apiKey: string, maxWaitMs = 180000): Promise<string | null> {
  const startTime = Date.now();
  const candidateGets = [
    `${rootBase}/v1/images/tasks/${taskId}`,
    `${rootBase}/v1/images/generations/${taskId}`,
    `${rootBase}/v1/images/${taskId}`,
    `${rootBase}/v1/task/${taskId}`,
    `${rootBase}/v1/tasks/${taskId}`,
    `${rootBase}/api/v1/task/${taskId}`,
    `${rootBase}/api/task/${taskId}`,
    `${rootBase}/mj/task/${taskId}/fetch`,
    `${rootBase}/task/${taskId}`
  ];

  console.log(`[Custom Image API] Detected Async Task ID: ${taskId}. Polling ${rootBase} for up to ${Math.round(maxWaitMs / 1000)}s...`);

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(r => setTimeout(r, 2500));

    for (const pollUrl of candidateGets) {
      try {
        const res = await fetch(pollUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json"
          }
        });

        if (!res.ok) continue;
        const pollData = await res.json();
        const img = extractImageUrlUniversal(pollData);
        if (img) {
          console.log(`[Custom Image API] Async task ${taskId} completed via ${pollUrl}`);
          return img;
        }
        const status = String(
          pollData?.status ||
          pollData?.state ||
          pollData?.task_status ||
          pollData?.data?.status ||
          pollData?.output?.task_status ||
          ""
        ).toUpperCase();
        if (["FAILED", "FAILURE", "ERROR", "CANCELLED", "CANCELED"].includes(status)) {
          console.warn(`[Custom Image API] Async task ${taskId} returned status: ${status}`);
          return null;
        }
      } catch {
        // continue polling other endpoints
      }
    }
  }

  console.warn(`[Custom Image API] Async task ${taskId} timed out after ${Math.round((Date.now() - startTime) / 1000)}s`);
  return null;
}

async function resolveReferenceImageDataUrl(url: string): Promise<string | null> {
  const trimmed = String(url || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (trimmed.startsWith("/generated/")) {
    const filename = path.basename(trimmed);
    const full = path.join(generatedDir, filename);
    if (!full.startsWith(generatedDir) || !fs.existsSync(full)) return null;
    const buffer = fs.readFileSync(full);
    const ext = path.extname(filename).slice(1).toLowerCase();
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${buffer.toString("base64")}`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const res = await fetch(trimmed);
      if (!res.ok) return null;
      const buffer = Buffer.from(await res.arrayBuffer());
      const mime = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch {
      return null;
    }
  }
  return null;
}

// Convert a base64 image data URL into a Node Blob for multipart uploads.
function dataUrlToImageFile(dataUrl: string): { blob: Blob; filename: string } | null {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!match) return null;
  const mime = match[1] || "image/png";
  if (!mime.startsWith("image/")) return null;
  const buffer = Buffer.from(match[2], "base64");
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("gif") ? "gif" : "jpg";
  return {
    blob: new Blob([new Uint8Array(buffer)], { type: mime }),
    filename: `reference.${ext}`
  };
}

// Master Executor: Tries Images API with intelligent Chat Completions, Universal Parsing & Async Polling
async function executeCustomImageRequest(options: {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  size?: string;
  protocol?: 'auto' | 'images' | 'chat-completions';
  quality?: 'standard' | 'hd';
  timeoutMs?: number;
  referenceImage?: string;
}): Promise<{
  ok: boolean;
  imageUrl?: string;
  methodUsed?: string;
  endpointUsed?: string;
  referenceSent?: boolean;
  referenceAccepted?: boolean;
  referenceDropped?: boolean;
  error?: string;
  rawError?: string;
  diagnosis?: string;
  status?: number;
}> {
  const {
    endpoint,
    apiKey,
    model,
    prompt,
    size = '1024x1024',
    protocol = 'auto',
    quality,
    timeoutMs = 180000,
    referenceImage
  } = options;

  let cleanEndpoint = String(endpoint).trim().replace(/^["']|["']$/g, '');
  if (!cleanEndpoint.startsWith('http://') && !cleanEndpoint.startsWith('https://')) {
    cleanEndpoint = 'https://' + cleanEndpoint;
  }
  cleanEndpoint = cleanEndpoint.replace(/\/+$/, '');

  let cleanApiKey = String(apiKey).trim().replace(/^["']|["']$/g, '');
  if (cleanApiKey.toLowerCase().startsWith('bearer ')) {
    cleanApiKey = cleanApiKey.slice(7).trim();
  }

  // Determine base host and standard routes
  let rootBase = cleanEndpoint
    .replace(/\/v1\/images\/generations$/i, '')
    .replace(/\/images\/generations$/i, '')
    .replace(/\/v1\/chat\/completions$/i, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/v1$/i, '')
    .replace(/\/+$/, '');

  const imagesEndpoint = cleanEndpoint.includes('/images/generations')
    ? cleanEndpoint
    : `${rootBase}/v1/images/generations`;

  const chatEndpoint = cleanEndpoint.includes('/chat/completions')
    ? cleanEndpoint
    : `${rootBase}/v1/chat/completions`;

  // Reference-image (character lock) is sent through the official image-editing
  // endpoint as multipart/form-data, not as undocumented JSON fields. Only models
  // that support image editing (e.g. gpt-image series on relays / DALL·E 2 edits)
  // can actually follow the uploaded person reference.
  const editsEndpoint = cleanEndpoint.includes('/images/edits')
    ? cleanEndpoint
    : /\/v1\/images\/generations$/i.test(cleanEndpoint)
      ? cleanEndpoint.replace(/\/v1\/images\/generations$/i, '/v1/images/edits')
      : `${rootBase}/v1/images/edits`;

  const targetModel = model.trim();
  const targetSize = size === 'auto' ? '1024x1024' : size;

  let lastError = '';
  let lastRawError = '';
  let lastStatus = 0;
  let imagesJobAccepted = false;
  const referenceSent = Boolean(referenceImage);

  const useChatForReference = Boolean(referenceImage) && protocol !== 'images';
  // METHOD 0: Official Image-Editing endpoint (/v1/images/edits, multipart/form-data).
  // This is the only channel where most relays actually consume an uploaded person
  // reference (e.g. gpt-image / gpt-image-2 / DALL·E-2-edits). JSON image fields on
  // /images/generations are undocumented and silently ignored -> treated as text-only.
  if (Boolean(referenceImage) && protocol !== 'chat-completions') {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const file = dataUrlToImageFile(referenceImage!);
      if (file) {
        const form = new FormData();
        form.append('model', targetModel);
        form.append('prompt', prompt);
        form.append('n', '1');
        form.append('size', targetSize);
        if (quality) form.append('quality', quality);
        form.append('image', file.blob, file.filename);

        const res = await fetch(editsEndpoint, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cleanApiKey}` },
          body: form,
          signal: controller.signal
        });
        clearTimeout(timer);

        const contentType = res.headers.get('content-type') || '';
        if (res.ok) {
          if (contentType.startsWith('image/')) {
            const arrayBuf = await res.arrayBuffer();
            const b64 = Buffer.from(arrayBuf).toString('base64');
            const mime = contentType.split(';')[0] || 'image/png';
            return {
              ok: true,
              imageUrl: `data:${mime};base64,${b64}`,
              methodUsed: 'Image Edits (multipart /v1/images/edits)',
              endpointUsed: editsEndpoint,
              referenceSent,
              referenceAccepted: referenceSent,
              referenceDropped: false
            };
          }
          const rawText = await res.text();
          let data: unknown = null;
          try { data = JSON.parse(rawText); } catch { data = rawText; }
          const img = extractImageUrlUniversal(data);
          if (img) {
            return {
              ok: true,
              imageUrl: img,
              methodUsed: 'Image Edits (multipart /v1/images/edits)',
              endpointUsed: editsEndpoint,
              referenceSent,
              referenceAccepted: referenceSent,
              referenceDropped: false
            };
          }
          lastStatus = res.status || 200;
          lastError = '编辑接口已响应但未解析到图片';
          lastRawError = rawText.slice(0, 400);
        } else {
          lastStatus = res.status;
          const errText = await res.text();
          lastRawError = errText;
          try {
            const jsonErr = JSON.parse(errText);
            lastError = toLoose(toLoose(jsonErr).error).message || jsonErr?.message || errText;
          } catch {
            lastError = errText.slice(0, 300);
          }
          console.warn(`[Custom Image API] Edits endpoint ${editsEndpoint} status ${res.status}:`, lastError);
        }
      }
    } catch (e: unknown) {
      lastError = errorMessage(e) || 'Edits 请求异常';
      console.warn('[Custom Image API] Edits attempt exception:', lastError);
    }
  }

  // METHOD 1: Chat Completions Protocol (if requested, or when locking a character from a reference photo)
  if (protocol === 'chat-completions' || cleanEndpoint.includes('/chat/completions') || useChatForReference) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const userContent = referenceImage
        ? [
            { type: 'image_url', image_url: { url: referenceImage } },
            { type: 'text', text: prompt }
          ]
        : `Please generate and draw a high quality image based on this description:\n${prompt}\nReturn the image markdown or direct URL.`;

      const res = await fetch(chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanApiKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'user',
              content: userContent
            }
          ]
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (res.ok) {
        const data = await res.json();
        const img = extractImageUrlUniversal(data);
        if (img) {
          return {
            ok: true,
            imageUrl: img,
            methodUsed: 'Chat Completions (/v1/chat/completions)',
            endpointUsed: chatEndpoint,
            referenceSent,
            referenceAccepted: referenceSent,
            referenceDropped: false
          };
        }
      }
    } catch (e: unknown) {
      lastError = errorMessage(e) || 'Chat Completions 请求异常';
    }
  }

  // METHOD 2: Standard OpenAI Images API (/v1/images/generations)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Payload designed for broad compatibility (OpenAI, SiliconFlow, Midjourney, OneAPI)
    const requestBody: Record<string, unknown> = {
      model: targetModel,
      prompt: prompt,
      size: targetSize,
      image_size: targetSize,
      n: 1
    };
    if (quality) requestBody.quality = quality;
    if (referenceImage) {
      requestBody.image = referenceImage;
      requestBody.image_url = referenceImage;
      requestBody.images = [referenceImage];
    }

    let res = await fetch(imagesEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanApiKey}`
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    // Check if response is direct binary image
    const contentType = res.headers.get('content-type') || '';
    if (res.ok && contentType.startsWith('image/')) {
      clearTimeout(timer);
      const arrayBuf = await res.arrayBuffer();
      const b64 = Buffer.from(arrayBuf).toString('base64');
      const mime = contentType.split(';')[0] || 'image/png';
      return {
        ok: true,
        imageUrl: `data:${mime};base64,${b64}`,
        methodUsed: 'Direct Image Stream',
        endpointUsed: imagesEndpoint,
        referenceSent,
        referenceAccepted: referenceSent,
        referenceDropped: false
      };
    }

    // Retry with a minimal payload only when no reference is involved. Dropping a
    // reference image would make a successful response look like a reference-based
    // generation when it was actually text-only.
    if (res.status === 400 && !referenceImage) {
      console.log(`[Custom Image API] Retrying ${imagesEndpoint} with minimal payload...`);
      res = await fetch(imagesEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanApiKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          prompt: prompt
        }),
        signal: controller.signal
      });
    }

    clearTimeout(timer);

    if (res.ok) {
      const rawText = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(rawText);
      } catch {
        data = rawText;
      }

      // Check if provider returned custom business error code in HTTP 200 (e.g. { code: -1, msg: "..." })
      if (data && typeof data === 'object') {
        if (isLikelyBusinessError(data)) {
          lastError = data.msg || data.message || data.error || '服务商返回业务错误';
          lastRawError = rawText;
          lastStatus = 400;
        } else {
          imagesJobAccepted = true;

          // 1. Direct Universal URL Extraction
          const img = extractImageUrlUniversal(data);
          if (img) {
            return {
              ok: true,
              imageUrl: img,
              methodUsed: 'Images API (/v1/images/generations)',
              endpointUsed: imagesEndpoint,
              referenceSent,
              referenceAccepted: referenceSent,
              referenceDropped: false
            };
          }

          // 2. Check for Async Task ID (Midjourney Proxy / NewAPI / Task Queue)
          const taskId = extractTaskId(data);
          if (taskId) {
            const polledImg = await pollAsyncTask(taskId, rootBase, cleanApiKey, Math.max(timeoutMs, 180000));
            if (polledImg) {
              return {
                ok: true,
                imageUrl: polledImg,
                methodUsed: 'Async Image Task Polling',
                endpointUsed: imagesEndpoint,
                referenceSent,
                referenceAccepted: referenceSent,
                referenceDropped: false
              };
            }
            lastError = `异步生图任务 ${taskId} 已提交，但未在时限内取回图片`;
            lastRawError = rawText.slice(0, 500);
            lastStatus = 202;
          } else {
            console.warn('[Custom Image API] Images endpoint returned 200 OK, but could not extract image:', rawText.slice(0, 500));
            lastError = '接口已响应但未解析到图片地址';
            lastRawError = rawText.slice(0, 500);
            lastStatus = 200;
          }
        }
      } else if (typeof data === 'string') {
        const img = extractImageUrlUniversal(data);
        if (img) {
          return {
            ok: true,
            imageUrl: img,
            methodUsed: 'Images API (Text format)',
            endpointUsed: imagesEndpoint,
            referenceSent,
            referenceAccepted: referenceSent,
            referenceDropped: false
          };
        }
      }
    } else {
      lastStatus = res.status;
      lastRawError = await res.text();
      try {
        const jsonErr = JSON.parse(lastRawError);
        lastError = toLoose(toLoose(jsonErr).error).message || jsonErr?.message || lastRawError;
      } catch {
        lastError = lastRawError;
      }
    }
  } catch (err: unknown) {
    const aborted = (err instanceof Error ? err.name : '') === 'AbortError' || String(errorMessage(err) || '').toLowerCase().includes('abort');
    lastError = aborted
      ? '生图请求等待超时。供应商后台可能已经出图，但接口未在时限内返回。'
      : (errorMessage(err) || 'Images API 连接失败');
    if (aborted) lastStatus = 408;
  }

  // METHOD 3: Chat Completions fallback — only when Images 通道明确不可用.
  // Preserve the reference image; never silently fall back to text-only generation.
  // Never fallback after a job was already accepted, or after timeout: that would submit a second generation.
  const imagesChannelMissing =
    lastStatus === 404 ||
    lastStatus === 405 ||
    lastRawError.includes('Images API is not supported') ||
    lastRawError.includes('not supported for this platform') ||
    lastRawError.includes('not supported on the images');

  if (
    !imagesJobAccepted &&
    lastStatus !== 408 &&
    (protocol === 'chat-completions' || imagesChannelMissing || lastStatus === 400)
  ) {
    console.log(`[Custom Image API] Images endpoint returned ${lastStatus || 'error'}. Attempting auto-fallback to Chat Completions: ${chatEndpoint} (Model: ${targetModel})`);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const chatRes = await fetch(chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanApiKey}`
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [
            {
              role: 'user',
              content: referenceImage
                ? [
                    { type: 'image_url', image_url: { url: referenceImage } },
                    { type: 'text', text: prompt }
                  ]
                : `Please generate and draw an image based on this description. Return the image directly or as markdown:\n${prompt}`
            }
          ]
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      if (chatRes.ok) {
        const rawChatText = await chatRes.text();
        let chatData: unknown;
        try {
          chatData = JSON.parse(rawChatText);
        } catch {
          chatData = rawChatText;
        }

        const img = extractImageUrlUniversal(chatData);
        if (img) {
          console.log(`[Custom Image API] Auto-fallback to Chat Completions succeeded! Got image URL.`);
          return {
            ok: true,
            imageUrl: img,
            methodUsed: 'Chat-to-Image 自适应通道 (/v1/chat/completions)',
            endpointUsed: chatEndpoint,
            referenceSent,
            referenceAccepted: referenceSent,
            referenceDropped: false
          };
        } else {
          console.warn('[Custom Image API] Chat returned text but no image link parsed:', rawChatText.slice(0, 300));
          lastError = '接口已响应但未在回复内容中找到有效图片链接';
          lastRawError = rawChatText.slice(0, 300);
        }
      } else {
        lastStatus = chatRes.status;
        const chatErrText = await chatRes.text();
        lastRawError = chatErrText;
        try {
          const chatJson = JSON.parse(chatErrText);
          lastError = toLoose(toLoose(chatJson).error).message || chatJson?.message || chatErrText;
        } catch {
          lastError = chatErrText;
        }
        console.warn(`[Custom Image API] Chat fallback status ${chatRes.status}:`, lastError);
      }
    } catch (chatErr: unknown) {
      console.warn('[Custom Image API] Chat fallback exception:', errorMessage(chatErr));
      if (!lastError) lastError = errorMessage(chatErr) || 'Chat 对话通道连接异常';
    }
  }

  // Generate clear diagnostic guide for user
  let diagnosis = '';
  const lowerRaw = (lastRawError + ' ' + lastError).toLowerCase();

  if (
    lowerRaw.includes('no available compatible accounts') ||
    lowerRaw.includes('all available accounts exhausted') ||
    lowerRaw.includes('exhausted')
  ) {
    diagnosis = `【中转站上游无可用渠道 (HTTP 503)】中转站服务商后台为模型「${targetModel}」配置的所有上游账号当前均处于「离线、失效或额度耗尽」状态（服务端返回: No available compatible accounts）。建议：请在中转站控制台切换到有可用上游渠道的 API 分组，或更换为其他第三方生图平台（如 SiliconFlow 硅基流动、OpenAI 官方等）。`;
  } else if (lowerRaw.includes('model_not_found') || lowerRaw.includes('is not supported by any configured account')) {
    diagnosis = `【该令牌所在分组未配置该模型】当前 API 密钥对应的中转分组未开通模型「${targetModel}」的路由。建议：请在中转站后台确认该 Token 绑定的分组权限。`;
  } else if (lowerRaw.includes('not supported on the chat completions') || lowerRaw.includes('not supported for this platform')) {
    diagnosis = `【模型通道不匹配 (HTTP 400/404)】该模型「${targetModel}」未在中转站开启生图或对话通道。建议：请点击上方「🔄 自动拉取支持的模型列表」，选择平台真实支持的模型（例如 dall-e-3、flux 或 midjourney）。`;
  } else if (lowerRaw.includes('insufficient_quota') || lowerRaw.includes('quota') || lowerRaw.includes('余额不足') || lowerRaw.includes('arrears') || lowerRaw.includes('billing')) {
    diagnosis = '【账户额度不足】当前 API Key 在中转平台的账户余额已耗尽，请前往中转站控制台充值。';
  } else if (lastStatus === 401 || lastStatus === 403) {
    diagnosis = '【密钥验证失败】API Key 无效、已过期或无权访问该模型，请检查密钥是否正确并具有充足额度。';
  } else if (lastStatus === 400) {
    diagnosis = `【参数或模型错误 (HTTP 400)】服务商不支持模型名称「${targetModel}」或请求参数。请点击「自动拉取支持的模型列表」选择有效模型。`;
  } else if (lastStatus === 404) {
    diagnosis = `【接口路径 404 未找到】请求端点不存在，且自适应通道未匹配到该模型。请核对中转站模型名称。`;
  } else if (lastStatus === 429) {
    diagnosis = '【请求频率超限】超出中转站或上游平台的请求频率限制，请稍候重试。';
  } else if (lastStatus === 408 || lastError.includes('超时')) {
    diagnosis = '【等待超时】供应商后台可能已经生成完毕，但当前请求在等待回传时超时。请稍后重试一次，或在设置里确认模型是否为异步生图通道。';
  } else if (lastStatus === 202) {
    diagnosis = '【异步任务未取回】生图任务已提交且供应商可能已完成，但未能从任务查询接口拿到图片。请稍后重试。';
  } else if (lastStatus >= 500) {
    diagnosis = `【服务商上游服务异常 (HTTP ${lastStatus})】中转站或其上游接口暂时不可用。建议切换模型或稍后重试。`;
  } else {
    diagnosis = '【连接异常】未能从服务商接口获取到有效图片。请检查 API Key 权限、模型名称及网络连接。';
  }

  return {
    ok: false,
    status: lastStatus,
    endpointUsed: imagesEndpoint,
    referenceSent,
    referenceAccepted: false,
    referenceDropped: referenceSent,
    error: `[HTTP ${lastStatus || 'ERR'}] ${lastError || '请求失败'}`,
    rawError: lastRawError,
    diagnosis
  };
}


export function registerVisualRoutes(app: Express): void {
app.post("/api/assets/image", (req, res) => {
  const dataUrl = String(req.body?.dataUrl || "").trim();
  const prefix = String(req.body?.prefix || "asset").replace(/[^a-z0-9-]/gi, "").slice(0, 24) || "asset";
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) {
    return res.status(400).json({ error: "需要图片 data URL" });
  }
  const mime = match[1] || "image/jpeg";
  if (!mime.startsWith("image/")) {
    return res.status(400).json({ error: "只接受图片文件" });
  }
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > 8 * 1024 * 1024) {
      return res.status(400).json({ error: "图片超过 8MB" });
    }
    fs.writeFileSync(path.join(generatedDir, filename), buffer);
    return res.json({ url: `/generated/${filename}` });
  } catch (err: unknown) {
    return res.status(500).json({ error: errorMessage(err) || "参考图写入失败" });
  }
});

app.post("/api/visual/generate", async (req, res) => {
  try {
    const { prompt, visualStyle = "cinematic", aspectRatio = "16:9", seed, customApi, styleRender, characterRef } = requestBody(req.body as unknown);

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // Determine dimensions based on aspect ratio
    let width = 1280;
    let height = 720;
    let standardSize = "1792x1024";

    if (aspectRatio === "9:16") {
      width = 720;
      height = 1280;
      standardSize = "1024x1792";
    } else if (aspectRatio === "1:1") {
      width = 1024;
      height = 1024;
      standardSize = "1024x1024";
    } else if (aspectRatio === "4:5") {
      width = 864;
      height = 1080;
      standardSize = "1024x1280";
    }

    // Style prompt enhancer
    const styleEnhancers: Record<string, string> = {
      photorealistic: "photorealistic, 35mm photograph, master composition, natural lighting, 8k resolution",
      cinematic: "cinematic lighting, 35mm film photograph, master composition, photorealistic, 8k resolution, dramatic shadows",
      anime: "modern anime aesthetic, Makoto Shinkai style, vibrant colors, detailed anime background, crisp lines",
      cyberpunk: "cyberpunk city, neon lighting, volumetric glow, futuristic metropolis, hyperdetailed sci-fi concept art",
      vintage: "vintage 1970s retro film photo, nostalgic warm tones, Kodachrome color palette, analog grain",
      "3d_animation": "Pixar and Disney 3D animation style, octane render, soft subsurface scattering, charming character design, cute lighting",
      "3d-render": "Pixar and Disney 3D animation style, octane render, soft subsurface scattering, charming character design, cute lighting",
      ink_wash: "traditional Chinese ink wash painting, Shan Shui aesthetic, poetic atmospheric mist, artistic brush strokes",
      "chinese-ink": "traditional Chinese ink wash painting, Shan Shui aesthetic, poetic atmospheric mist, artistic brush strokes",
      "vintage-film": "vintage 1990s 35mm Kodak Portra film photograph, warm tones, subtle film grain",
      "vector-art": "modern vector illustration, clean lines, minimalist flat art, elegant color palette, high contrast"
    };

    const modelName = String(customApi?.model || "");
    const keepStructure = /gpt-image|gpt-4o|gpt-4\.1|chatgpt-image|dall-?e-3/i.test(modelName)
      || customApi?.promptProfile === "gpt-image";
    const cleanedPrompt = keepStructure
      ? String(prompt).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
      : String(prompt).replace(/[^\w\s\u4e00-\u9fa5,.-]/g, " ").trim();
    const requestedRender = typeof styleRender === "string" ? styleRender.trim() : "";
    const fallbackRender = styleEnhancers[visualStyle] || "";
    const extras = keepStructure ? [] : (requestedRender || fallbackRender)
      .split(",")
      .map((item: string) => item.trim())
      .filter((item: string) => {
        if (!item) return false;
        const needle = item.toLowerCase().slice(0, 18);
        return needle.length > 0 && !cleanedPrompt.toLowerCase().includes(needle);
      })
      .slice(0, 2);
    const scenePrompt = extras.length ? `${cleanedPrompt}, ${extras.join(", ")}` : cleanedPrompt;
    const refName = String(characterRef?.name || "").trim();
    const refLock = characterRef?.url
      ? `Image 1 is a new-camera identity lock${refName ? ` for ${refName}` : ""}: keep the same face and costume, change pose and framing to this shot, do not copy the reference composition.`
      : "";
    const finalPrompt = refLock
      ? (keepStructure ? `${refLock}\n${scenePrompt}` : `${refLock} Scene: ${scenePrompt}`)
      : scenePrompt;
    const referenceImage = characterRef?.url ? await resolveReferenceImageDataUrl(String(characterRef.url)) : null;
    if (characterRef?.url && !referenceImage) {
      return res.status(400).json({
        ok: false,
        error: '角色参考图无法读取，已停止本次生图',
        diagnosis: '参考图没有成功送入服务端，未执行无参考图降级。请重新上传角色图。',
        referenceSent: false,
        referenceAccepted: false,
        referenceDropped: true
      });
    }

    // =========================================================================
    // PRIORITY 1: User-configured Custom Image Generation Provider API
    // (SiliconFlow / OpenAI DALL-E / OneAPI / NewAPI / Midjourney / Chat-to-Image)
    // =========================================================================
    const hasProvider = Boolean(
      customApi &&
      customApi.provider !== "builtin" &&
      customApi.enabled !== false &&
      customApi.apiKey?.trim() &&
      customApi.endpoint?.trim()
    );

    if (!hasProvider) {
      return res.status(400).json({
        ok: false,
        error: "请先在设置里配置生图供应商和 API Key",
        diagnosis: "已取消内置免费引擎。主通道填好接口地址、密钥和模型后才能出图。",
        referenceSent: false,
        referenceAccepted: false,
        referenceDropped: Boolean(referenceImage)
      });
    }

    if (hasProvider) {
      try {
        const chosenSize = customApi.size === 'auto' || !customApi.size ? standardSize : customApi.size;
        const targetModel = customApi.model ? customApi.model.trim() : '';
        if (!targetModel) {
          return res.status(400).json({
            ok: false,
            error: "请填写生图模型名称",
            diagnosis: "可在设置里拉取模型列表，或手动填入供应商提供的模型 id。",
            referenceSent: false,
            referenceAccepted: false,
            referenceDropped: Boolean(referenceImage)
          });
        }

        console.log(`[Custom Image API] Requesting ${customApi.endpoint} with model "${targetModel}"...`);
        const customResult = await executeCustomImageRequest({
          endpoint: customApi.endpoint,
          apiKey: customApi.apiKey,
          model: targetModel,
          prompt: finalPrompt,
          size: chosenSize,
          protocol: customApi.protocol || 'auto',
          quality: customApi.quality,
          referenceImage: referenceImage || undefined
        });

        if (customResult.ok && customResult.imageUrl) {
          const clientImageUrl = materializeClientImageUrl(customResult.imageUrl);
          console.log(`[Custom Image API] Successfully generated via ${customResult.methodUsed} (${customResult.endpointUsed}) -> ${clientImageUrl}`);
          return res.json({
            imageUrl: clientImageUrl,
            source: 'custom-provider-api',
            model: targetModel,
            provider: customApi.provider || 'custom',
            protocolUsed: customResult.methodUsed,
            referenceSent: Boolean(customResult.referenceSent),
            referenceAccepted: Boolean(customResult.referenceAccepted),
            referenceDropped: Boolean(customResult.referenceDropped)
          });
        } else {
          console.warn('[Custom Image API] Generation failed:', customResult.error, customResult.diagnosis);
          // Return the actual provider error so the user and UI clearly understand why the supplier failed
          return res.status(400).json({
            ok: false,
            error: customResult.error || '供应商生图请求失败',
            diagnosis: customResult.diagnosis || '请检查供应商 API 密钥有效性、账户余额或模型名称',
            rawError: customResult.rawError,
            provider: customApi.provider || 'custom',
            model: targetModel,
            referenceSent: Boolean(customResult.referenceSent),
            referenceAccepted: Boolean(customResult.referenceAccepted),
            referenceDropped: Boolean(customResult.referenceDropped)
          });
        }
      } catch (customApiErr: unknown) {
        console.error('[Custom Image API Exception]:', errorMessage(customApiErr) || customApiErr);
        return res.status(500).json({
          ok: false,
          error: `供应商接口调用异常: ${errorMessage(customApiErr) || customApiErr}`,
          diagnosis: '连接第三方供应商服务超时或网络中断，请检查 Endpoint 连通性',
          referenceSent: Boolean(referenceImage),
          referenceAccepted: false,
          referenceDropped: Boolean(referenceImage)
        });
      }
    }

    return res.status(400).json({
      ok: false,
      error: "请先在设置里配置生图供应商和 API Key",
      diagnosis: "已取消内置免费引擎。主通道填好接口地址、密钥和模型后才能出图。",
      referenceSent: false,
      referenceAccepted: false,
      referenceDropped: Boolean(referenceImage)
    });
  } catch (error: unknown) {
    console.error("Visual generation error:", error);
    return res.status(500).json({
      ok: false,
      error: errorMessage(error) || "生图失败",
      diagnosis: "请求未能完成。请检查供应商接口或稍后重试。"
    });
  }
});

// Universal High-Performance Image Proxy (Resolves CORS & Canvas Tainting for External Image URLs)
app.get("/api/image-proxy", async (req, res) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    return res.status(400).send("url query param required");
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(response.status).send(`Failed to fetch image: HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (err: unknown) {
    return res.status(500).send(`Proxy fetch error: ${errorMessage(err)}`);
  }
});


app.post("/api/visual/test-custom-api", async (req, res) => {
  const startTime = Date.now();
  const { endpoint, apiKey, model = '', size = '1024x1024', protocol = 'auto' } = requestBody(req.body as unknown);

  if (!endpoint || typeof endpoint !== 'string' || !endpoint.trim()) {
    return res.status(400).json({ ok: false, error: '请输入 API 接口地址 (Endpoint URL)' });
  }
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ ok: false, error: '请输入 API 密钥 (API Key / Token)' });
  }

  const testPrompt = 'Cinematic breathtaking crystal neon city at golden hour, futuristic sci-fi architecture, highly detailed, masterwork 8k wallpaper';
  const targetSize = size === 'auto' ? '1024x1024' : size;
  const targetModel = model.trim();

  try {
    const result = await executeCustomImageRequest({
      endpoint,
      apiKey,
      model: targetModel,
      prompt: testPrompt,
      size: targetSize,
      protocol: protocol as "auto" | "images" | "chat-completions",
      timeoutMs: 180000
    });

    const latencyMs = Date.now() - startTime;

    if (result.ok && result.imageUrl) {
      return res.json({
        ok: true,
        latencyMs,
        imageUrl: materializeClientImageUrl(result.imageUrl),
        model: targetModel,
        endpoint: result.endpointUsed,
        methodUsed: result.methodUsed
      });
    }

    return res.status(result.status && result.status >= 400 ? result.status : 400).json({
      ok: false,
      status: result.status,
      latencyMs,
      endpointUsed: result.endpointUsed,
      error: result.error,
      diagnosis: result.diagnosis
    });
  } catch (err: unknown) {
    const latencyMs = Date.now() - startTime;
    const isTimeout = (err instanceof Error ? err.name : '') === 'AbortError' || String(errorMessage(err) || '').includes('timeout') || String(errorMessage(err) || '').includes('abort');

    return res.status(500).json({
      ok: false,
      latencyMs,
      endpointUsed: endpoint,
      error: isTimeout ? '请求超时 (40s 超时)' : `网络连接异常: ${errorMessage(err) || '无法连接到目标服务'}`,
      diagnosis: isTimeout
        ? '【请求超时】服务商生成耗时过长或网络连接缓慢，请检查该服务商节点状态或更换更轻量的 schnell 模型。'
        : '【网络不可达】无法连接到指定 API 域名，请检查 URL 是否正确无误，或服务商是否要求特定网络环境。'
    });
  }
});

// 3.2 Fetch available models list from provider (/v1/models)
app.post("/api/visual/fetch-models", async (req, res) => {
  const { endpoint, apiKey } = requestBody(req.body as unknown);

  if (!endpoint || typeof endpoint !== 'string' || !endpoint.trim()) {
    return res.status(400).json({ ok: false, error: '请输入 API 接口地址 (Endpoint URL)' });
  }
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ ok: false, error: '请输入 API 密钥 (API Key / Token)' });
  }

  const result = await fetchOpenAiCompatibleModelList(endpoint, apiKey);
  if (result.ok === false) {
    const failure = result as Extract<typeof result, { ok: false }>;
    return res.status(failure.status || 500).json({
      ok: false,
      error: `无法从端点获取模型列表: ${failure.error}`,
      diagnosis: failure.status === 401
        ? 'API Key 无效或未授权访问 /v1/models 接口。'
        : '该服务商可能未开放 /v1/models 接口，或端点地址不正确。您仍可以直接手动填入模型名称进行生图。'
    });
  }

  const imageKeywords = [
    'flux', 'dall', 'sd', 'stable-diffusion', 'midjourney', 'mj',
    'image', 'recraft', 'ideogram', 'cogview', 'kolors', 'canvas',
    'kling', 'runway', 'sora', 'luma', 'doubao-image', 'qwen-vl', 'seed', 'animagine'
  ];
  const imageModels = result.models.filter((id) => {
    const lower = id.toLowerCase();
    return imageKeywords.some((keyword) => lower.includes(keyword));
  });

  return res.json({
    ok: true,
    models: result.models,
    imageModels,
    totalCount: result.models.length,
    modelUrlUsed: result.modelUrlUsed
  });
});
}
