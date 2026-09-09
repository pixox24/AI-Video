import fs from "fs";
import path from "path";
import { errorMessage } from "./loose";
import { generatedDir } from "./paths";

export function materializeClientAudioUrl(audioUrl: string): string {
  if (!audioUrl || typeof audioUrl !== "string") return audioUrl;
  const trimmed = audioUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("/")) {
    return trimmed;
  }
  const dataMatch = trimmed.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!dataMatch) return trimmed;
  const mime = dataMatch[1] || "audio/mpeg";
  const ext = mime.includes("wav") ? "wav" : mime.includes("ogg") ? "ogg" : "mp3";
  const filename = `narration-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    const buffer = Buffer.from(dataMatch[2], "base64");
    fs.writeFileSync(path.join(generatedDir, filename), buffer);
    console.log(`[Audio Store] Saved ${filename} (${Math.round(buffer.length / 1024)} KB)`);
    return `/generated/${filename}`;
  } catch (err: unknown) {
    console.warn("[Audio Store] Failed to persist narration audio:", errorMessage(err));
    return trimmed;
  }
}

export function materializeClientImageUrl(imageUrl: string): string {
  if (!imageUrl || typeof imageUrl !== "string") return imageUrl;

  const trimmed = imageUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return `/api/image-proxy?url=${encodeURIComponent(trimmed)}`;
  }

  const dataMatch = trimmed.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!dataMatch) return trimmed;

  const mime = dataMatch[1] || "image/png";
  const ext = mime.includes("jpeg") || mime.includes("jpg")
    ? "jpg"
    : mime.includes("webp")
      ? "webp"
      : mime.includes("gif")
        ? "gif"
        : "png";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  try {
    const buffer = Buffer.from(dataMatch[2], "base64");
    fs.writeFileSync(path.join(generatedDir, filename), buffer);
    console.log(`[Image Store] Saved ${filename} (${Math.round(buffer.length / 1024)} KB)`);
    return `/generated/${filename}`;
  } catch (err: unknown) {
    console.warn("[Image Store] Failed to persist generated image:", errorMessage(err));
    return trimmed;
  }
}
