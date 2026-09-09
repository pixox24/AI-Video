import type { Express } from "express";
import { readGenerationRuns } from "../llm/runs";
import { firstString } from "../loose";

export function registerUsageRoutes(app: Express): void {
  app.get("/api/usage", (req, res) => {
    const projectId = firstString(req.query.projectId);
    const runs = readGenerationRuns(projectId || undefined);
    return res.json({
      ok: true,
      runs,
      total: runs.length
    });
  });
}
