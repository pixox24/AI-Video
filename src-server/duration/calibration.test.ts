import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { calibrationInputSchema, calibrationResultSchema, type CalibrationInput } from '../../src/shared/calibration';
import { alignmentMeasurements, averageScale, bucketKey, calibrate, CALIBRATION_WINDOW, rateTableSchema, type RateTable } from './calibration';
import { estimateNarrationSeconds, measuredSpeechSeconds } from './engine';
import { registerCalibrationRoutes } from '../routes/calibration';
import { calibrationInputForProject, applyCalibrationResult } from '../../src/utils/durationCalibration';
import { createBlankProject } from '../../src/utils/projectPersist';
import { createDefaultScriptWorkspace } from '../../src/utils/scriptWorkspace';
import { narrationSourceHash } from '../../src/utils/narrationTrack';
import { resolveTtsApi } from '../../src/utils/presets';
import { ttsSourceKey } from '../../src/utils/ttsCatalog';

export function calibrationFixture(): CalibrationInput {
  return calibrationInputSchema.parse(JSON.parse(fs.readFileSync('tests/fixtures/calibration.json', 'utf8')));
}
test('measured sections exclude holds; changed content and fallback/invalid alignment cannot train rates', () => {
  const input = calibrationFixture(); const before = structuredClone(input);
  assert.deepEqual([...alignmentMeasurements(input)], [['s1', 20], ['s2', 20]]);
  assert.deepEqual(input, before);
  assert.equal(measuredSpeechSeconds([{ audioStart: 0, audioEnd: 20 }, { audioStart: 25, audioEnd: 45 }]), 40);
  assert.equal(estimateNarrationSeconds('one two three four five', 'en', 'medium', 1, 1), 2);
  for (const mutate of [
    (i: CalibrationInput) => { i.sections[0].narration += '已改'; },
    (i: CalibrationInput) => { i.track!.alignment.source = 'char-fallback'; },
    (i: CalibrationInput) => { i.track!.alignment.utterances[0].source = 'char-fallback'; },
    (i: CalibrationInput) => { i.track!.alignment.utterances[1].audioStart = 10; },
    (i: CalibrationInput) => { i.track!.alignment.utterances[0].audioEnd = 0; },
    (i: CalibrationInput) => { i.track!.duration = 30; },
    (i: CalibrationInput) => { i.sections[0].narration += i.sections[1].narration.slice(0, 1); i.sections[1].narration = i.sections[1].narration.slice(1); }
  ]) { const invalid = structuredClone(input); mutate(invalid); assert.equal(alignmentMeasurements(invalid).size, 0); }
  assert.equal(alignmentMeasurements({ ...input, track: undefined }).size, 0);
});
test('rolling window, idempotency, provider/voice/pace buckets and speed normalization', () => {
  const input = calibrationFixture(); const empty: RateTable = { version: 1, buckets: {} };
  const first = calibrate(input, empty);
  assert.equal(first.result.estimatedSec, 20); assert.equal(first.result.actualSec, 40);
  assert.deepEqual(empty.buckets, {});
  const duplicate = calibrate(input, first.table);
  assert.equal(duplicate.result.recorded, false); assert.equal(duplicate.result.estimatedSec, 20);
  const second = calibrate({ ...input, track: { ...input.track!, generatedAt: 2 } }, first.table);
  assert.equal(second.result.estimatedSec, 40);
  for (const variant of [{ provider: 'bailian' }, { voice: 'other' }, { pace: 'fast' as const }]) {
    const isolated = calibrate({ ...input, ...variant, track: undefined }, second.table);
    assert.equal(isolated.result.rateScale, 1); assert.equal(isolated.result.sampleCount, 0);
  }
  const faster = calibrate({ ...input, speechRate: 2, track: undefined }, second.table);
  assert.equal(faster.result.estimatedSec, 20);
  let table = first.table;
  for (let i = 2; i <= 25; i++) table = calibrate({ ...input, track: { ...input.track!, generatedAt: i } }, table).table;
  assert.equal(table.buckets[bucketKey(input)].samples.length, CALIBRATION_WINDOW);
  assert.equal(averageScale(table.buckets[bucketKey(input)].samples), 0.5);
  assert.equal(averageScale([{ scale: 0.5 }, { scale: 1.5 }]), 1); assert.equal(averageScale([]), 1);
  assert.notDeepEqual(table.buckets[bucketKey(input)].samples[0], first.table.buckets[bucketKey(input)].samples[0]);
  const oldReplay = calibrate(input, table);
  assert.equal(oldReplay.result.recorded, false); assert.strictEqual(oldReplay.table, table);
});
test('HTTP persisted calibration: same voice second generation reduces error, strict schema and disk failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase4-calibration-'));
  const filename = path.join(dir, 'data/rate-table.json');
  const app = express(); app.use(express.json()); registerCalibrationRoutes(app, filename);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const trace: unknown[] = [];
  async function post(input: unknown) {
    const response = await fetch(base + '/api/script/calibration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const body: unknown = await response.json(); trace.push({ input, status: response.status, body }); return { status: response.status, body };
  }
  try {
    const input = calibrationFixture();
    const first = calibrationResultSchema.parse((await post(input)).body);
    const duplicate = calibrationResultSchema.parse((await post(input)).body);
    assert.equal(duplicate.recorded, false);
    const second = calibrationResultSchema.parse((await post({ ...input, track: { ...input.track!, generatedAt: 2 } })).body);
    const firstError = Math.abs(first.estimatedSec - first.actualSec!);
    const secondError = Math.abs(second.estimatedSec - second.actualSec!);
    assert.ok(secondError < firstError); assert.equal(second.sampleCount, 2);
    assert.ok(second.sections.every(s => s.actualSec === 20));
    const table = rateTableSchema.parse(JSON.parse(fs.readFileSync(filename, 'utf8')));
    assert.equal(table.buckets[bucketKey(input)].samples.length, 2);
    assert.equal((await post({ ...input, apiKey: 'forbidden' })).status, 400);
    assert.equal((await post({ ...input, speechRate: 0 })).status, 400);
    fs.writeFileSync(filename, 'corrupt');
    assert.equal((await post(input)).status, 503); assert.equal(fs.readFileSync(filename, 'utf8'), 'corrupt');
    if (process.env.PHASE4_EVIDENCE === 'true') {
      fs.writeFileSync('docs/acceptance/phase4-http.json', JSON.stringify({ firstError, secondError, trace }, null, 2));
      fs.writeFileSync('docs/acceptance/phase4-rate-table.json', JSON.stringify(table, null, 2));
    }
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('project sidecar preserves locked content, audio, alignment and clips; stale tracks never train', () => {
  const input = calibrationFixture(); const project = createBlankProject();
  project.scriptWorkspace = { ...createDefaultScriptWorkspace(), sections: input.sections.map((s, i) => ({ ...s, order: i + 1,
    role: 'body', title: s.id, targetSeconds: 20, minUnits: 1, maxUnits: 100, beats: [], status: 'locked' })) };
  project.clips = input.sections.map((s, i) => ({ ...project.clips[0], id: s.id, order: i + 1, narration: s.narration }));
  project.audio.narrationTrack = { ...input.track!, audioUrl: '/generated/fixture.wav', voiceCharacter: project.audio.voiceCharacter,
    speechRate: project.audio.speechRate, clips: input.sections.map((s, i) => ({ clipId: s.id, audioStart: i * 25, audioEnd: i * 25 + 20 })),
    alignment: { ...input.track!.alignment, utterances: input.track!.alignment.utterances.map((u, i) => ({ ...u, clipIds: [input.sections[i].id] })) },
    sourceHash: narrationSourceHash(project.clips, project.audio.voiceCharacter, project.audio.speechRate, ttsSourceKey(resolveTtsApi(project.settings.customTtsApi), project.audio.voiceCharacter)) };
  const snapshot = structuredClone(project);
  const projected = calibrationInputForProject(project)!;
  assert.ok(projected.track); assert.ok(!JSON.stringify(projected).includes('apiKey'));
  const updated = applyCalibrationResult(project, calibrate(projected, { version: 1, buckets: {} }).result);
  assert.equal(updated.scriptWorkspace?.sections?.[0].actualSec, 20);
  assert.strictEqual(updated.audio, project.audio); assert.strictEqual(updated.clips, project.clips);
  assert.deepEqual(updated.scriptWorkspace?.sections?.map(({ actualSec, ...s }) => s), project.scriptWorkspace.sections);
  assert.deepEqual(project, snapshot);
  const cleared = applyCalibrationResult(updated);
  assert.equal(cleared.scriptWorkspace?.sections?.[0].actualSec, undefined);
  project.clips[0].narration += 'changed'; assert.equal(calibrationInputForProject(project)?.track, undefined);
  project.scriptWorkspace = undefined; assert.equal(calibrationInputForProject(project), undefined); assert.strictEqual(applyCalibrationResult(project), project);
});
