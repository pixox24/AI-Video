// @ts-nocheck — mechanical port of server.ts asset listing; behavior frozen.
import type { Express } from "express";
import fs from "fs";
import path from "path";
import { errorMessage } from "../loose";
import { generatedDir } from "../paths";

export function registerAssetsRoutes(app: Express): void {
app.get("/api/assets/generated", (req, res) => {
  const kind = String(req.query.kind || "image");
  try {
    if (!fs.existsSync(generatedDir)) {
      return res.json({ items: [], total: 0, dir: "public/generated" });
    }
    const names = fs.readdirSync(generatedDir);
    const items: Array<{
      name: string;
      url: string;
      bytes: number;
      mtime: number;
      kind: string;
    }> = [];
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext);
      const isAudio = [".wav", ".mp3", ".ogg", ".m4a"].includes(ext);
      if (kind === "image" && !isImage) continue;
      if (kind === "audio" && !isAudio) continue;
      if (kind !== "all" && kind !== "image" && kind !== "audio") continue;
      if (kind === "all" && !isImage && !isAudio) continue;
      const full = path.join(generatedDir, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      const assetKind = name.startsWith("char-ref-")
        ? "char-ref"
        : name.startsWith("narration-")
          ? "narration"
          : isAudio
            ? "audio"
            : "image";
      items.push({
        name,
        url: `/generated/${name}`,
        bytes: stat.size,
        mtime: stat.mtimeMs,
        kind: assetKind
      });
    }
    items.sort((a, b) => b.mtime - a.mtime);
    return res.json({
      items: items.slice(0, 300),
      total: items.length,
      dir: "public/generated"
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: errorMessage(err) || "无法列出生成文件" });
  }
});
}
