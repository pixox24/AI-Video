// Isolated browser acceptance host. Run with a temporary cwd to keep user projects untouched.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExpressApp } from '../src-server/app';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.LLM_MOCK = 'true';
process.env.LLM_FIXTURES_DIR = path.join(root, 'tests/fixtures');
const app = express();
app.use(express.json({ limit: '50mb' }));
app.use((req, _res, next) => {
  if (req.path === '/api/script/outline' || req.path === '/api/script/brief') {
    const body = req.body as Record<string, unknown>;
    fs.appendFileSync('ui-requests.jsonl', JSON.stringify({ endpoint: req.path, contentBrief: body.contentBrief, durationSpec: body.durationSpec }) + '\n');
  }
  next();
});
app.use(createExpressApp());
app.use(express.static(path.join(root, 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
app.listen(3005, '127.0.0.1', () => console.log('Phase 1 isolated Mock UI: http://localhost:3005'));
