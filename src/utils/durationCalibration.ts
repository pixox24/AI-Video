import type { VideoProject } from '../types';
import type { CalibrationInput, CalibrationResult } from '../shared/calibration';
import { isNarrationTrackFresh } from './narrationTrack';
import { resolveTtsApi } from './presets';
import { resolveTtsVoiceId } from './ttsCatalog';

/** A read-only projection. No audio, clip or alignment object is modified. */
export function calibrationInputForProject(project: VideoProject): CalibrationInput | undefined {
  const workspace = project.scriptWorkspace;
  if (!workspace?.sections?.length) return undefined;
  const api = resolveTtsApi(project.settings.customTtsApi);
  const provider = api.provider === 'bailian' && api.enabled !== false && api.apiKey.trim() ? 'bailian' : 'edge';
  const track = isNarrationTrackFresh(project.audio, project.clips, api) ? project.audio.narrationTrack : undefined;
  return { projectId: project.id, provider,
    voice: provider === 'bailian' ? resolveTtsVoiceId(project.audio.voiceCharacter, api) : project.audio.voiceCharacter,
    pace: workspace.durationSpec?.pace || workspace.durationBudget.pace, language: workspace.scriptLanguage || 'zh',
    speechRate: project.audio.speechRate || 1,
    sections: workspace.sections.map(s => ({ id: s.id, narration: s.narration })),
    track: track?.alignment ? { sourceHash: track.sourceHash, generatedAt: track.generatedAt, duration: track.duration,
      alignment: { version: track.alignment.version, source: track.alignment.source,
        utterances: track.alignment.utterances.map(u => ({ text: u.text, audioStart: u.audioStart, audioEnd: u.audioEnd, source: u.source })) } } : undefined };
}
export function applyCalibrationResult(project: VideoProject, result?: CalibrationResult): VideoProject {
  const workspace = project.scriptWorkspace;
  if (!workspace) return project;
  return { ...project, scriptWorkspace: { ...workspace, durationCalibration: result,
    sections: workspace.sections?.map(section => {
      const { actualSec: _old, ...content } = section;
      const actualSec = result?.sections.find(s => s.sectionId === section.id)?.actualSec;
      return actualSec === undefined ? content : { ...content, actualSec };
    }) } };
}
