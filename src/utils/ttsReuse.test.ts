import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planUtteranceTts, ttsReuseSummary } from './ttsReuse';
import type { NarrationTrack } from '../types';

test('未改动的旁白句会复用上一轨音频，改动句才新合成', () => {
  const track: NarrationTrack = {
    audioUrl: '/generated/full.wav',
    duration: 12,
    voiceCharacter: 'magnetic-male',
    speechRate: 1,
    sourceHash: 'abc',
    generatedAt: 1,
    clips: [],
    alignment: {
      version: 2,
      source: 'per-utterance',
      utterances: [
        { text: '第一句钩子。', audioStart: 0, audioEnd: 2, clipIds: ['c1'], source: 'per-utterance', audioUrl: '/generated/u1.wav' },
        { text: '第二句铺垫。', audioStart: 2, audioEnd: 5, clipIds: ['c2'], source: 'per-utterance', audioUrl: '/generated/u2.wav' },
        { text: '第三句收束。', audioStart: 5, audioEnd: 8, clipIds: ['c3'], source: 'per-utterance' }
      ]
    }
  };
  const jobs = planUtteranceTts(
    ['第一句钩子。', '第二句被改了。', '第三句收束。'],
    track,
    'magnetic-male',
    1
  );
  const summary = ttsReuseSummary(jobs);
  assert.equal(jobs[0].reuse, true);
  assert.equal(jobs[0].audioUrl, '/generated/u1.wav');
  assert.equal(jobs[1].reuse, false);
  assert.equal(jobs[2].reuse, true);
  assert.deepEqual(jobs[2].slice, { start: 5, end: 8 });
  assert.equal(summary.reuse, 2);
  assert.equal(summary.fresh, 1);
});

test('换音色后不复用旧句音频', () => {
  const track: NarrationTrack = {
    audioUrl: '/generated/full.wav',
    duration: 4,
    voiceCharacter: 'old-voice',
    speechRate: 1,
    sourceHash: 'abc',
    generatedAt: 1,
    clips: [],
    alignment: {
      version: 2,
      source: 'per-utterance',
      utterances: [
        { text: '同一句。', audioStart: 0, audioEnd: 2, clipIds: ['c1'], source: 'per-utterance', audioUrl: '/generated/u1.wav' }
      ]
    }
  };
  const jobs = planUtteranceTts(['同一句。'], track, 'new-voice', 1);
  assert.equal(jobs[0].reuse, false);
});
