// Run from an empty temporary directory, never from the project checkout.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { createExpressApp } from '../src-server/app';
import { createBlankProject } from '../src/utils/projectPersist';
import { createDefaultScriptWorkspace } from '../src/utils/scriptWorkspace';
import { qualityRequestSchema } from '../src/shared/quality';
import { emptyContentBrief } from '../src/utils/contentBrief';
import { flattenSectionBeats, joinSectionNarrations } from '../src/utils/scriptSections';
import { buildDurationBudget } from '../src/utils/scriptBudget';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (path.resolve(process.cwd()) === root || fs.existsSync('data')) throw new Error('Use an empty temporary working directory');
process.env.LLM_MOCK = 'true'; process.env.LLM_FIXTURES_DIR = path.join(root, 'tests/fixtures');
const evidence = z.object({ trace: z.array(z.object({ request: z.unknown() })) }).parse(JSON.parse(fs.readFileSync(path.join(root, 'docs/acceptance/phase3-http.json'), 'utf8')));
const input = qualityRequestSchema.parse(evidence.trace[1].request);
const sections = input.sections.map(s => ({ ...s, beats: [{ id: `${s.id}-beat`, sectionId: s.id, order: 1,
  function: s.role === 'body' ? 'proof' as const : s.role === 'hook' ? 'hook' as const : 'cta' as const,
  narration: s.narration, targetSeconds: s.targetSeconds, intent: '解释步骤', visualIntent: '桌面操作演示', energy: 'medium' as const, needsHold: false }] }));
const project = createBlankProject(); project.id = 'phase3-acceptance'; project.title = 'Phase 3 质量闭环验收';
project.scriptWorkspace = { ...createDefaultScriptWorkspace(), stage: 'copy', intent: 'have-title', lockedTitle: '具体步骤帮助理解',
  contentBrief: { ...emptyContentBrief('具体步骤帮助理解'), viewerPromise: '学会用具体步骤解释问题' }, sections,
  outline: { ...input.outline, sections: input.outline.sections.map(s => ({ ...s, narrationBudgetSec: s.narrationBudgetSec || 0, visualHoldBudgetSec: s.visualHoldBudgetSec || 0, retentionDevice: s.retentionDevice || '', transitionOut: s.transitionOut || '' })) },
  scriptFormOverride: 'long', durationBudget: buildDurationBudget({ targetSeconds: 100, pace: 'medium' }),
  beats: flattenSectionBeats(sections), fullNarration: joinSectionNarrations(sections, 'zh') };
fs.mkdirSync('data/projects/phase3-acceptance', { recursive: true });
fs.writeFileSync('data/projects/phase3-acceptance/project.json', JSON.stringify(project));
fs.writeFileSync('data/current-project.json', JSON.stringify(project));
fs.writeFileSync('data/current.json', JSON.stringify({ id: project.id }));
const app = createExpressApp();
app.use(express.static(path.join(root, 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
app.listen(3006, '127.0.0.1', () => console.log('Phase 3 isolated Mock UI http://localhost:3006'));
