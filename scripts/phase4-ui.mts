// Isolated browser acceptance host. Never starts a real TTS or LLM request.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createExpressApp } from '../src-server/app';
import { createBlankProject } from '../src/utils/projectPersist';
import { createDefaultScriptWorkspace } from '../src/utils/scriptWorkspace';
import { calibrationInputSchema } from '../src/shared/calibration';
import { emptyContentBrief } from '../src/utils/contentBrief';
import { buildDurationBudget } from '../src/utils/scriptBudget';
import { SAMPLE_PROJECTS } from '../src/utils/presets';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (path.resolve(process.cwd()) === root || fs.existsSync('data')) throw new Error('Use an empty temporary working directory');
process.env.LLM_MOCK = 'true'; process.env.LLM_FIXTURES_DIR = path.join(root, 'tests/fixtures');
const fixture = calibrationInputSchema.parse(JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/calibration.json'), 'utf8')));
const project = createBlankProject(); project.id = 'phase4-acceptance'; project.title = 'Phase 4 语速校准验收';
project.clips = fixture.sections.map((s, i) => ({ ...SAMPLE_PROJECTS[0].clips[0], id: s.id, order: i + 1, narration: s.narration,
  imageUrl: '', videoUrl: undefined, voSlice: s.narration, voRole: 'start' as const, voSpanId: s.id, duration: 20 }));
project.scriptWorkspace = { ...createDefaultScriptWorkspace(), stage: 'duration', intent: 'have-title', lockedTitle: '语速校准验收',
  contentBrief: { ...emptyContentBrief('语速校准验收'), viewerPromise: '比较同一声音两次合成的估算误差' },
  sections: fixture.sections.map((s, i) => ({ ...s, order: i + 1, role: 'body' as const, title: `章节 ${i + 1}`, targetSeconds: 20,
    minUnits: 1, maxUnits: 100, status: 'locked' as const, beats: [{ id: `${s.id}-beat`, sectionId: s.id, order: i + 1,
      function: 'proof' as const, narration: s.narration, targetSeconds: 20, intent: '', visualIntent: '', energy: 'medium' as const, needsHold: false }] })),
  durationBudget: buildDurationBudget({ targetSeconds: 60, pace: 'medium' }), fullNarration: fixture.sections.map(s => s.narration).join('') };
project.scriptWorkspace.beats = project.scriptWorkspace.sections!.flatMap(s => s.beats);
fs.mkdirSync(`data/projects/${project.id}`, { recursive: true });
fs.writeFileSync(`data/projects/${project.id}/project.json`, JSON.stringify(project));
fs.writeFileSync('data/current-project.json', JSON.stringify(project));
fs.writeFileSync('data/current.json', JSON.stringify({ id: project.id }));
// 20-second PCM fixture. The real client decoding, assembly, alignment and reuse code still executes.
const sampleRate = 8000; const length = sampleRate * 20; const wav = Buffer.alloc(44 + length * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(length * 2, 40);
for (let i = 0; i < length; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / sampleRate) * 2000), 44 + i * 2);
const app = express(); app.use(express.json({ limit: '50mb' }));
app.get('/phase4-fixture.wav', (_req, res) => { res.type('wav').send(wav); });
app.post('/api/audio/tts', (_req, res) => { res.json({ audioUrl: '/phase4-fixture.wav', provider: 'edge', voice: 'fixture', words: [] }); });
app.use(createExpressApp()); app.use(express.static(path.join(root, 'dist')));
app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
app.listen(3007, '127.0.0.1', () => console.log('Phase 4 isolated fixture UI http://localhost:3007'));
