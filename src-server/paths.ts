import fs from "fs";
import path from "path";

export const generatedDir = path.join(process.cwd(), "public", "generated");
export const dataDir = path.join(process.cwd(), "data");
export const projectsDir = path.join(dataDir, "projects");
export const currentProjectFile = path.join(dataDir, "current-project.json");
export const previousProjectFile = path.join(dataDir, "previous-project.json");
export const currentPointerFile = path.join(dataDir, "current.json");

export function ensureAppDirs(): void {
  try {
    fs.mkdirSync(generatedDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.mkdirSync(projectsDir, { recursive: true });
  } catch {
    // directory may already exist
  }
}

export function generationRunsPath(): string {
  return process.env.GENERATION_RUNS_PATH || path.join(dataDir, "generation-runs.jsonl");
}

export function llmFixturesDir(): string {
  return process.env.LLM_FIXTURES_DIR || path.join(process.cwd(), "tests", "fixtures");
}
