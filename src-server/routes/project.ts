// @ts-nocheck — mechanical port of server.ts project routes; behavior frozen.
import type { Express } from "express";
import fs from "fs";
import path from "path";
import { errorMessage, requestBody, toLoose, toLooseList, type Loose } from "../loose";
import {
  currentPointerFile,
  currentProjectFile,
  previousProjectFile,
  projectsDir
} from "../paths";

function readProjectFile(filePath: string): { project: unknown; savedAt: number; bytes: number } | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const project = JSON.parse(raw);
    if (!project || typeof project !== "object") return null;
    const stat = fs.statSync(filePath);
    return { project, savedAt: stat.mtimeMs, bytes: stat.size };
  } catch (err: unknown) {
    console.warn("[Project Store] Failed to read", path.basename(filePath), errorMessage(err));
    return null;
  }
}

function writeProjectFile(filePath: string, project: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(project));
  try {
    fs.copyFileSync(tmp, filePath);
    fs.unlinkSync(tmp);
  } catch {
    fs.writeFileSync(filePath, JSON.stringify(project));
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

function sanitizeProjectId(id: unknown): string | null {
  const value = String(id || "").trim();
  if (!value || value.includes("..") || value.includes("/") || value.includes("\\")) return null;
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(value)) return null;
  return value;
}

function projectJsonPath(id: string): string {
  return path.join(projectsDir, id, "project.json");
}

function coverFromProject(project: unknown): string | undefined {
  const clip = Array.isArray(project?.clips) ? project.clips.find((item: Loose) => item?.imageUrl) : null;
  return clip?.imageUrl ? String(clip.imageUrl) : undefined;
}

function summarizeProject(project: unknown, savedAt: number) {
  const clips = Array.isArray(project?.clips) ? project.clips : [];
  return {
    id: String(project.id || ""),
    title: String(project.title || "未命名工程"),
    topic: String(project.topic || ""),
    createdAt: Number(project.createdAt) || savedAt,
    updatedAt: Number(project.updatedAt) || savedAt,
    savedAt,
    clipCount: clips.length,
    duration: clips.reduce((sum: number, clip: unknown) => sum + (Number(clip?.duration) || 0), 0),
    aspectRatio: String(project.settings?.aspectRatio || "16:9"),
    coverUrl: coverFromProject(project),
    saveRevision: Number(project.saveRevision) || 0
  };
}

function readPointer(): string | null {
  try {
    if (!fs.existsSync(currentPointerFile)) return null;
    const raw = JSON.parse(fs.readFileSync(currentPointerFile, "utf8"));
    return sanitizeProjectId(raw?.id);
  } catch {
    return null;
  }
}

function writePointer(id: string) {
  writeProjectFile(currentPointerFile, { id, updatedAt: Date.now() });
}

function isSampleProjectId(id?: string): boolean {
  return id === "project-universe" || id === "project-ai-future";
}

function projectHasGeneratedAssets(project: unknown): boolean {
  return (Array.isArray(project?.clips) ? project.clips : []).some((clip: Loose) =>
    String(clip?.imageUrl || "").includes("/generated/")
    || String(clip?.voiceAudioUrl || "").includes("/generated/")
  );
}

function stripProjectSecrets(project: unknown) {
  if (!project || typeof project !== "object") return project;
  const settings = project.settings && typeof project.settings === "object" ? { ...project.settings } : {};
  delete settings.customImageApi;
  delete settings.customLlmApi;
  delete settings.customTtsApi;
  delete settings.customVideoApi;
  delete settings.customStyleVisionApi;
  return { ...project, settings };
}

function writeLibraryProject(project: unknown) {
  const id = sanitizeProjectId(project?.id);
  if (!id) throw new Error("工程 id 无效");
  const next = stripProjectSecrets({ ...project, id });
  writeProjectFile(projectJsonPath(id), next);
  writePointer(id);
  return readProjectFile(projectJsonPath(id));
}

function migrateLegacyCurrentProject() {
  try {
    const existing = fs.existsSync(projectsDir)
      ? fs.readdirSync(projectsDir).filter((name) => fs.existsSync(projectJsonPath(name)))
      : [];
    if (existing.length > 0) return;
    const legacy = readProjectFile(currentProjectFile);
    if (!legacy?.project || !Array.isArray(legacy.project.clips)) return;
    let id = sanitizeProjectId(legacy.project.id);
    if (!id || isSampleProjectId(id)) {
      if (!projectHasGeneratedAssets(legacy.project) && isSampleProjectId(String(legacy.project.id || ""))) return;
      id = `project-migrated-${Date.now()}`;
      legacy.project.id = id;
    }
    writeLibraryProject(legacy.project);
    console.log(`[Project Store] Migrated session project to library ${id}`);
  } catch (err: unknown) {
    console.warn("[Project Store] Legacy migrate failed:", errorMessage(err));
  }
}

function stashCurrentProject(): boolean {
  const pointer = readPointer();
  const library = pointer ? readProjectFile(projectJsonPath(pointer)) : null;
  const current = library || readProjectFile(currentProjectFile);
  if (!current) return false;
  writeProjectFile(previousProjectFile, current.project);
  return true;
}

function readCurrentProject() {
  migrateLegacyCurrentProject();
  const session = readProjectFile(currentProjectFile);
  if (session) return session;
  const pointer = readPointer();
  if (pointer) {
    const stored = readProjectFile(projectJsonPath(pointer));
    if (stored) return stored;
  }
  return null;
}

export function registerProjectRoutes(app: Express): void {
app.get("/api/project/current", (_req, res) => {
  const stored = readCurrentProject();
  if (!stored) {
    return res.status(404).json({ error: "还没有磁盘工程" });
  }
  return res.json(stored);
});

app.put("/api/project/current", (req, res) => {
  const project = req.body?.project && typeof req.body.project === "object"
    ? req.body.project
    : req.body;
  const intoLibrary = req.body?.library !== false;
  if (!project || typeof project !== "object" || !Array.isArray(project.clips)) {
    return res.status(400).json({ error: "工程格式无效" });
  }
  try {
    const existing = readCurrentProject();
    if (existing?.project?.id && project.id && existing.project.id !== project.id) {
      stashCurrentProject();
    }
    writeProjectFile(currentProjectFile, stripProjectSecrets(project));
    let librarySaved = false;
    const id = sanitizeProjectId(project.id);
    if (intoLibrary && id && !isSampleProjectId(id)) {
      const storedLibrary = writeLibraryProject(project);
      librarySaved = Boolean(storedLibrary);
    }
    const stored = readProjectFile(currentProjectFile);
    return res.json({
      ok: true,
      savedAt: stored?.savedAt || Date.now(),
      bytes: stored?.bytes || 0,
      saveRevision: Number(project.saveRevision) || 0,
      currentId: readPointer(),
      library: librarySaved
    });
  } catch (err: unknown) {
    console.warn("[Project Store] Failed to write current project:", errorMessage(err));
    return res.status(500).json({ error: errorMessage(err) || "工程未能写入磁盘" });
  }
});

app.get("/api/project/previous", (_req, res) => {
  const stored = readProjectFile(previousProjectFile);
  if (!stored) {
    return res.status(404).json({ error: "没有上一份备份" });
  }
  return res.json({
    savedAt: stored.savedAt,
    bytes: stored.bytes,
    project: stored.project
  });
});

app.post("/api/project/stash", (_req, res) => {
  try {
    const ok = stashCurrentProject();
    return res.json({ ok, savedAt: ok ? Date.now() : null });
  } catch (err: unknown) {
    return res.status(500).json({ error: errorMessage(err) || "备份失败" });
  }
});

app.get("/api/projects", (_req, res) => {
  try {
    migrateLegacyCurrentProject();
    if (!fs.existsSync(projectsDir)) {
      return res.json({ items: [], currentId: readPointer() });
    }
    const items: ReturnType<typeof summarizeProject>[] = [];
    for (const name of fs.readdirSync(projectsDir)) {
      const id = sanitizeProjectId(name);
      if (!id) continue;
      const stored = readProjectFile(projectJsonPath(id));
      if (!stored) continue;
      items.push(summarizeProject({ ...stored.project, id: stored.project.id || id }, stored.savedAt));
    }
    items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return res.json({ items, currentId: readPointer() });
  } catch (err: unknown) {
    return res.status(500).json({ error: errorMessage(err) || "无法列出工程库" });
  }
});

app.get("/api/projects/:id", (req, res) => {
  const id = sanitizeProjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "工程 id 无效" });
  const stored = readProjectFile(projectJsonPath(id));
  if (!stored) return res.status(404).json({ error: "工程不存在" });
  return res.json({
    project: stored.project,
    savedAt: stored.savedAt,
    bytes: stored.bytes,
    summary: summarizeProject(stored.project, stored.savedAt)
  });
});

app.post("/api/projects", (req, res) => {
  const incoming = req.body?.project && typeof req.body.project === "object" ? req.body.project : req.body;
  if (!incoming || typeof incoming !== "object" || !Array.isArray(incoming.clips)) {
    return res.status(400).json({ error: "工程格式无效" });
  }
  try {
    const now = Date.now();
    const requestedId = sanitizeProjectId(incoming.id);
    const id = requestedId && !isSampleProjectId(requestedId) ? requestedId : `project-${now}`;
    const project = {
      ...incoming,
      id,
      createdAt: Number(incoming.createdAt) || now,
      updatedAt: now,
      saveRevision: Number(incoming.saveRevision) || 1
    };
    const stored = writeLibraryProject(project);
    return res.json({
      ok: true,
      project: stored?.project || project,
      savedAt: stored?.savedAt || now,
      summary: summarizeProject(stored?.project || project, stored?.savedAt || now)
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: errorMessage(err) || "无法创建工程" });
  }
});

app.post("/api/projects/:id/duplicate", (req, res) => {
  const id = sanitizeProjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "工程 id 无效" });
  const stored = readProjectFile(projectJsonPath(id));
  if (!stored) return res.status(404).json({ error: "工程不存在" });
  try {
    const now = Date.now();
    const titleHint = String(req.body?.title || "").trim();
    const project = {
      ...stored.project,
      id: `project-${now}`,
      title: titleHint || `${stored.project.title || "未命名工程"} (副本)`,
      createdAt: now,
      updatedAt: now,
      saveRevision: 1
    };
    const copied = writeLibraryProject(project);
    return res.json({
      ok: true,
      project: copied?.project || project,
      savedAt: copied?.savedAt || now,
      summary: summarizeProject(copied?.project || project, copied?.savedAt || now)
    });
  } catch (err: unknown) {
    return res.status(500).json({ error: errorMessage(err) || "另存失败" });
  }
});

app.delete("/api/projects/:id", (req, res) => {
  const id = sanitizeProjectId(req.params.id);
  if (!id) return res.status(400).json({ error: "工程 id 无效" });
  const root = path.resolve(projectsDir);
  const folder = path.resolve(root, id);
  if (folder === root || !folder.startsWith(root + path.sep)) {
    return res.status(400).json({ error: "工程路径无效" });
  }
  try {
    if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
    if (readPointer() === id) {
      try { fs.unlinkSync(currentPointerFile); } catch { /* ignore */ }
    }
    return res.json({ ok: true });
  } catch (err: unknown) {
    return res.status(500).json({ error: errorMessage(err) || "删除失败" });
  }
});
}
