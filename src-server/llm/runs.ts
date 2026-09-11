import fs from "fs";
import path from "path";
import { createHash, randomUUID } from "crypto";
import type { GenerationRun } from "../../src/types";
import { dataDir, generationRunsPath } from "../paths";

export function promptHash(system: string, user: string): string {
  return createHash("sha256").update(`${system}\n${user}`).digest("hex").slice(0, 16);
}

export function createRunId(): string {
  return randomUUID();
}

export function appendGenerationRun(run: GenerationRun): void {
  const file = generationRunsPath();
  try {
    fs.mkdirSync(path.dirname(file) || dataDir, { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(run)}\n`, "utf8");
  } catch (err: unknown) {
    console.warn("[GenerationRun] failed to append JSONL:", err);
  }
}

export function readGenerationRuns(projectId?: string): GenerationRun[] {
  const file = generationRunsPath();
  if (!fs.existsSync(file)) return [];
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  const rows: GenerationRun[] = [];
  for (const line of lines) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object") continue;
      const row = parsed as GenerationRun;
      if (projectId && row.projectId !== projectId) continue;
      rows.push(row);
    } catch {
      // skip malformed lines
    }
  }
  return rows;
}
