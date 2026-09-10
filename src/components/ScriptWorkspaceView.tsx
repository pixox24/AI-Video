import React from 'react';
import type { ClipsChange, VideoProject } from '../types';
import { resolveLlmApi, resolveTtsApi } from '../utils/presets';
import { hydrateActiveStylePack } from '../utils/stylePack';
import { resolveSentenceGap } from '../utils/sentenceGap';
import { resolveOutro } from '../utils/outro';
import { hydrateScriptWorkspace } from '../utils/scriptWorkspace';
import { isNarrationTrackFresh } from '../utils/narrationTrack';
import { ScriptPanel } from './ScriptPanel';
import { VideoPlayerStage } from './VideoPlayerStage';

export function ScriptWorkspaceView({
  project,
  onProjectChange,
  onClipsChange,
  onSelectClip,
  onOpenStoryboard,
  onNeedFullNarration,
  onGenerateCharacterRef,
  onGenerateCharacterRefAll,
  onApplyStyleOnly,
  isApplyingStyle,
  isGeneratingNarration,
  narrationError,
  isPlaying,
  currentTime,
  onTimeUpdate,
  onTogglePlay,
  selectedClipId
}: {
  project: VideoProject;
  onProjectChange: (updates: Partial<VideoProject>) => void;
  onClipsChange: (clips: ClipsChange) => void;
  onSelectClip: (clipId: string) => void;
  onOpenStoryboard: () => void;
  onNeedFullNarration: (clips: VideoProject['clips']) => void;
  onGenerateCharacterRef: Parameters<typeof ScriptPanel>[0]['onGenerateCharacterRef'];
  onGenerateCharacterRefAll: () => void;
  onApplyStyleOnly: () => void;
  isApplyingStyle: boolean;
  isGeneratingNarration: boolean;
  narrationError: string | null;
  isPlaying: boolean;
  currentTime: number;
  onTimeUpdate: (time: number) => void;
  onTogglePlay: () => void;
  selectedClipId: string | null;
}) {
  const ttsApi = resolveTtsApi(project.settings.customTtsApi);
  const narrationFresh = isNarrationTrackFresh(project.audio, project.clips, ttsApi);
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <ScriptPanel
        key={project.id}
        projectId={project.id}
        workspace={project.scriptWorkspace || hydrateScriptWorkspace(project)}
        onChange={(scriptWorkspace) => onProjectChange({ scriptWorkspace })}
        onTopicChange={(topic) => onProjectChange({ topic, title: topic ? topic.slice(0, 20) : project.title })}
        onClipsChange={onClipsChange}
        existingClips={project.clips}
        visualStyle={project.settings.visualStyle}
        stylePack={hydrateActiveStylePack(project.settings)}
        aspectRatio={project.settings.aspectRatio}
        customLlmApi={resolveLlmApi(project.settings.customLlmApi)}
        customTtsApi={ttsApi}
        voiceCharacter={project.audio.voiceCharacter}
        speechRate={project.audio.speechRate}
        onSelectClip={onSelectClip}
        onOpenStoryboard={onOpenStoryboard}
        onNeedFullNarration={onNeedFullNarration}
        sentenceGap={resolveSentenceGap(project.audio)}
        outroHold={resolveOutro(project.settings).hold}
        onGenerateCharacterRef={onGenerateCharacterRef}
        onGenerateCharacterRefAll={onGenerateCharacterRefAll}
        onApplyStyleOnly={onApplyStyleOnly}
        isApplyingStyle={isApplyingStyle}
        isGeneratingNarration={isGeneratingNarration}
        narrationError={narrationError}
        narrationFresh={narrationFresh}
        isPlaying={isPlaying}
        currentTime={currentTime}
        onTogglePlay={onTogglePlay}
        onRecommendBgm={(trackId) => {
          onProjectChange({
            audio: project.audio.bgmTrackId === 'custom-uploaded'
              ? project.audio
              : { ...project.audio, bgmEnabled: true, bgmTrackId: trackId }
          });
        }}
      />
      <div className="h-0 w-0 overflow-hidden" aria-hidden>
        <VideoPlayerStage
          clips={project.clips}
          subtitles={project.subtitles}
          audio={project.audio}
          settings={project.settings}
          currentTime={currentTime}
          onTimeUpdate={onTimeUpdate}
          isPlaying={isPlaying}
          onTogglePlay={onTogglePlay}
          selectedClipId={selectedClipId}
          onSelectClip={onSelectClip}
          isGeneratingNarration={isGeneratingNarration}
          narrationError={narrationError}
        />
      </div>
    </div>
  );
}
