import { VideoProject } from '../types';
import { isNarrationTrackFresh, joinClipsForTts } from './narrationTrack';
import { resolveTtsApi } from './presets';
import { isStudioFontReady, resolveSubtitleFontId, studioFontById } from './subtitleFonts';

export type ExportIssueLevel = 'block' | 'warn';

export interface ExportIssue {
  id: string;
  level: ExportIssueLevel;
  text: string;
}

export function buildExportChecklist(project: VideoProject): ExportIssue[] {
  const issues: ExportIssue[] = [];
  const clips = project.clips || [];
  if (clips.length === 0) {
    issues.push({ id: 'no-clips', level: 'block', text: '还没有分镜，无法导出' });
    return issues;
  }

  const missing = clips.filter((clip) => !clip.imageUrl).length;
  const failed = clips.filter((clip) => clip.imageStatus === 'failed').length;
  if (missing > 0) {
    issues.push({ id: 'missing-images', level: 'warn', text: `${missing} 镜没有画面，导出时会显示占位` });
  }
  if (failed > 0) {
    issues.push({ id: 'failed-images', level: 'warn', text: `${failed} 镜生图失败，可先只重试失败项` });
  }

  const hasNarration = Boolean(joinClipsForTts(clips));
  const ttsApi = resolveTtsApi(project.settings.customTtsApi);
  const fresh = isNarrationTrackFresh(project.audio, clips, ttsApi);
  if (hasNarration && !project.audio.narrationTrack) {
    issues.push({ id: 'no-vo', level: 'warn', text: '还没生成旁白，导出将没有口播' });
  } else if (hasNarration && !fresh) {
    issues.push({ id: 'stale-vo', level: 'warn', text: '旁白和分镜不一致，建议先重配音' });
  }

  const font = studioFontById(resolveSubtitleFontId(project.subtitles));
  if (font.url && !isStudioFontReady(font.id)) {
    issues.push({ id: 'font', level: 'warn', text: `字幕字体「${font.name}」还在加载，未就绪会先用系统字体` });
  }

  return issues;
}
