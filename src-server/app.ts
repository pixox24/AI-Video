import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { ensureAppDirs, generatedDir } from "./paths";
import { registerHealthRoutes } from "./routes/health";
import { registerScriptRoutes } from "./routes/script";
import { registerStyleRoutes } from "./routes/style";
import { registerVisualRoutes } from "./routes/visual";
import { registerLlmRoutes } from "./routes/llm";
import { registerTopicsRoutes } from "./routes/topics";
import { registerAudioRoutes } from "./routes/audio";
import { registerProjectRoutes } from "./routes/project";
import { registerAssetsRoutes } from "./routes/assets";
import { registerUsageRoutes } from "./routes/usage";
import { registerBriefRoutes } from './routes/brief';
import { validateContentInput } from './routes/content-input';
import { registerQualityRoutes } from './routes/quality';
import { registerCalibrationRoutes } from './routes/calibration';

export function createExpressApp(): express.Express {
  ensureAppDirs();
  const app = express();
  app.use(express.json({ limit: "50mb" }));
  app.use("/generated", express.static(generatedDir));
  registerHealthRoutes(app);
  registerBriefRoutes(app);
  registerQualityRoutes(app);
  registerCalibrationRoutes(app);
  app.post(['/api/script/outline', '/api/script/draft'], validateContentInput);
  registerScriptRoutes(app);
  registerStyleRoutes(app);
  registerVisualRoutes(app);
  registerLlmRoutes(app);
  registerTopicsRoutes(app);
  registerAudioRoutes(app);
  registerProjectRoutes(app);
  registerAssetsRoutes(app);
  registerUsageRoutes(app);
  return app;
}

export async function startServer(): Promise<void> {
  const app = createExpressApp();
  const PORT = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa"
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Video Studio server running on http://localhost:${PORT}`);
  });
}
