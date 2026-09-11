import type { Express } from "express";
import { isConfiguredSecret } from "../http";

export function registerHealthRoutes(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", hasApiKey: isConfiguredSecret(process.env.GEMINI_API_KEY) });
  });
}
