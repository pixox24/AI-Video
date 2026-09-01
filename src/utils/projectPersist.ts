import { ProjectSettings, VideoProject, VisualBible } from '../types';
import { DEFAULT_AUDIO_CONFIG, DEFAULT_SUBTITLE_CONFIG, SAMPLE_PROJECTS } from './presets';
import { stripProjectSecrets } from './appSettings';
import { createDefaultScriptWorkspace } from './scriptWorkspace';
import { showStatusToast } from './statusToast';

const PROJECT_KEY = 'ai_video_current_project';
const SAVED_KEY = 'ai_video_saved_projects';
const MAX_INLINE_IMAGE = 8000;

export function clipImageForPersist(imageUrl?: string): string | undefined {
  if (!imageUrl) return undefined;
  if (imageUrl.startsWith('data:') && imageUrl.length > MAX_INLINE_IMAGE) return undefined;
  return imageUrl;
}

function slimThumb<T extends { thumbDataUrl?: string }>(item: T): T {
  if (!item.thumbDataUrl || item.thumbDataUrl.length <= MAX_INLINE_IMAGE) return item;
  return { ...item, thumbDataUrl: undefined };
}

function slimBible(bible?: VisualBible): VisualBible | undefined {
  if (!bible) return bible;
  return {
    ...bible,
    characters: (bible.characters || []).map((character) => ({
      ...character,
      refs: (character.refs || []).map((ref) => slimThumb(ref))
    })),
    locations: (bible.locations || []).map((location) => ({
      ...location,
      refs: (location.refs || []).map((ref) => slimThumb(ref))
    }))
  };
}

export function isSampleProjectId(id?: string): boolean {
  return SAMPLE_PROJECTS.some((item) => item.id === id);
}

export function isLibraryProject(project: VideoProject): boolean {
  if (isSampleProjectId(project.id)) return projectHasLocalWork(project);
  return true;
}

export function projectForPersist(project: VideoProject): VideoProject {
  const track = project.audio?.narrationTrack;
  const audioUrl = track?.audioUrl && track.audioUrl.startsWith('data:') ? undefined : track?.audioUrl;
  const slimmed: VideoProject = {
    ...project,
    clips: (project.clips || []).map((clip) => ({
      ...clip,
      imageUrl: clipImageForPersist(clip.imageUrl),
      isGeneratingImage: false,
      imageStatus: clip.imageStatus === 'generating' || clip.imageStatus === 'queued' ? 'idle' : clip.imageStatus
    })),
    audio: {
      ...project.audio,
      narrationTrack: track
        ? { ...track, audioUrl: audioUrl || track.audioUrl }
        : track
    },
    scriptWorkspace: project.scriptWorkspace
      ? { ...project.scriptWorkspace, visualBible: slimBible(project.scriptWorkspace.visualBible) }
      : project.scriptWorkspace,
    settings: {
      ...project.settings,
      activeStylePack: project.settings.activeStylePack
        ? {
            ...project.settings.activeStylePack,
            reference: project.settings.activeStylePack.reference
              ? slimThumb(project.settings.activeStylePack.reference)
              : undefined
          }
        : project.settings.activeStylePack
    }
  };
  return stripProjectSecrets(slimmed);
}

export async function storeImageDataUrl(dataUrl: string): Promise<string> {
  const res = await fetch('/api/image-store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl: dataUrl })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.imageUrl) {
    throw new Error(data?.error || '本地图片未能存盘');
  }
  return String(data.imageUrl);
}

export const RESET_TO_SAMPLE_KEY = 'ai_video_reset_to_sample';

export type PersistStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface PersistSnapshot {
  status: PersistStatus;
  at: number;
  error?: string;
}

export interface GeneratedAsset {
  name: string;
  url: string;
  bytes: number;
  mtime: number;
  kind: 'image' | 'audio' | 'char-ref' | 'narration' | string;
}

type PersistListener = (snapshot: PersistSnapshot) => void;

let persistWarned = false;
let diskWriteGen = 0;
let lastSavedRevision = 0;

export function rememberSaveRevision(revision?: number) {
  lastSavedRevision = Number(revision) || 0;
}
let persistSnapshot: PersistSnapshot = { status: 'idle', at: 0 };
const persistListeners = new Set<PersistListener>();

function emitPersist() {
  persistListeners.forEach((listener) => {
    try {
      listener(persistSnapshot);
    } catch {
      // ignore subscriber errors
    }
  });
}

function setPersistSnapshot(status: PersistStatus, error?: string) {
  persistSnapshot = { status, at: Date.now(), error };
  emitPersist();
}

export function getPersistSnapshot(): PersistSnapshot {
  return persistSnapshot;
}

export function subscribePersistStatus(listener: PersistListener): () => void {
  persistListeners.add(listener);
  listener(persistSnapshot);
  return () => {
    persistListeners.delete(listener);
  };
}

export function readLocalCurrentProject(): VideoProject | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.clips)) return null;
    return parsed as VideoProject;
  } catch {
    return null;
  }
}

export function writeCurrentProject(project: VideoProject): boolean {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(projectForPersist(project)));
    persistWarned = false;
    return true;
  } catch (err) {
    console.warn('[Project Persist] Failed to save current project:', err);
    if (!persistWarned) {
      persistWarned = true;
      showStatusToast('浏览器存档空间不足，大图未写入本地。生成图请用服务器路径，刷新前不要关页。', {
        tone: 'warn',
        id: 'persist',
        durationMs: 4200
      });
    }
    return false;
  }
}

export async function fetchDiskCurrentProject(): Promise<{ project: VideoProject; savedAt: number } | null> {
  try {
    const res = await fetch('/api/project/current');
    if (res.status === 404) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.project || !Array.isArray(data.project.clips)) return null;
    return { project: data.project as VideoProject, savedAt: Number(data.savedAt) || 0 };
  } catch (err) {
    console.warn('[Project Persist] Failed to read disk project:', err);
    return null;
  }
}

export async function fetchPreviousProject(): Promise<{ project: VideoProject; savedAt: number } | null> {
  try {
    const res = await fetch('/api/project/previous');
    if (res.status === 404) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.project || !Array.isArray(data.project.clips)) return null;
    return { project: data.project as VideoProject, savedAt: Number(data.savedAt) || 0 };
  } catch {
    return null;
  }
}

export async function stashPreviousProject(): Promise<boolean> {
  try {
    const res = await fetch('/api/project/stash', { method: 'POST' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function writeDiskCurrentProject(project: VideoProject): Promise<boolean> {
  const gen = ++diskWriteGen;
  setPersistSnapshot('saving');
  const revision = lastSavedRevision + 1;
  const payload = projectForPersist({ ...project, saveRevision: revision });
  try {
    const res = await fetch('/api/project/current', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project: payload,
        library: isLibraryProject(project)
      })
    });
    const data = await res.json().catch(() => ({}));
    if (gen !== diskWriteGen) return true;
    if (!res.ok) throw new Error(data?.error || '工程未能写入磁盘');
    rememberSaveRevision(Number(data?.saveRevision) || revision);
    setPersistSnapshot('saved');
    persistWarned = false;
    return true;
  } catch (err: any) {
    if (gen !== diskWriteGen) return false;
    const message = err?.message || '工程未能写入磁盘';
    setPersistSnapshot('error', message);
    if (!persistWarned) {
      persistWarned = true;
      showStatusToast('工程未能写入磁盘，刷新可能丢稿。请确认本地服务还在跑。', {
        tone: 'error',
        id: 'persist-disk',
        durationMs: 5200
      });
    }
    return false;
  }
}

export async function fetchGeneratedAssets(kind: 'image' | 'audio' | 'all' = 'image'): Promise<GeneratedAsset[]> {
  try {
    const res = await fetch(`/api/assets/generated?kind=${encodeURIComponent(kind)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data?.items)) return [];
    return data.items as GeneratedAsset[];
  } catch {
    return [];
  }
}

export function toGeneratedPath(url?: string): string | null {
  if (!url) return null;
  const cleaned = url.trim().split('?')[0];
  if (!cleaned) return null;
  const match = cleaned.match(/\/generated\/[^/]+$/);
  if (match) return match[0];
  if (/^(char-ref-)?[\w.-]+\.(png|jpg|jpeg|webp|gif|wav|mp3|ogg|m4a)$/i.test(cleaned)) {
    return `/generated/${cleaned}`;
  }
  return null;
}

export function collectReferencedAssetUrls(project: VideoProject): Set<string> {
  const urls = new Set<string>();
  const add = (url?: string) => {
    const path = toGeneratedPath(url);
    if (path) urls.add(path);
  };

  for (const clip of project.clips || []) {
    add(clip.imageUrl);
    add(clip.voiceAudioUrl);
  }
  add(project.audio?.narrationTrack?.audioUrl);
  add(project.audio?.customBgmUrl);

  const bible = project.scriptWorkspace?.visualBible;
  for (const character of bible?.characters || []) {
    for (const ref of character.refs || []) {
      add(ref.imageUrl);
      add(ref.imageId);
    }
  }
  for (const location of bible?.locations || []) {
    for (const ref of location.refs || []) {
      add(ref.imageUrl);
      add(ref.imageId);
    }
  }

  const styleRef = project.settings?.activeStylePack?.reference;
  add(styleRef?.imageId);
  add((styleRef as { imageUrl?: string } | undefined)?.imageUrl);
  return urls;
}

export function projectHasLocalWork(project: VideoProject): boolean {
  if ((project.clips || []).some((clip) => toGeneratedPath(clip.imageUrl) || toGeneratedPath(clip.voiceAudioUrl))) {
    return true;
  }
  if (toGeneratedPath(project.audio?.narrationTrack?.audioUrl)) return true;
  if ((project.scriptWorkspace?.fullNarration || '').trim().length > 8) return true;
  if ((project.scriptWorkspace?.forecastShots || []).length > 0) return true;
  if (new Set(['project-universe', 'project-ai-future']).has(String(project.id || ''))) return false;
  if ((project.clips || []).some((clip) => (clip.narration || '').trim().length > 0)) return true;
  return Boolean((project.topic || '').trim());
}

function settingsFrom(project?: VideoProject): ProjectSettings {
  const settings = project?.settings;
  return {
    aspectRatio: settings?.aspectRatio || '16:9',
    canvasBackground: settings?.canvasBackground || '#0a0a0c',
    visualStyle: settings?.visualStyle || 'cinematic',
    activeStylePack: settings?.activeStylePack,
    customStyleVisionApi: settings?.customStyleVisionApi,
    styleShelf: settings?.styleShelf,
    safeMargin: settings?.safeMargin ?? false,
    exportQuality: settings?.exportQuality || '1080p',
    frameRate: settings?.frameRate || 30,
    customImageApi: settings?.customImageApi,
    customLlmApi: settings?.customLlmApi,
    customTtsApi: settings?.customTtsApi,
    customVideoApi: settings?.customVideoApi
  };
}

export function createBlankProject(from?: VideoProject): VideoProject {
  const now = Date.now();
  return {
    id: `project-${now}`,
    title: '未命名工程',
    topic: '',
    createdAt: now,
    updatedAt: now,
    clips: [],
    subtitles: from?.subtitles ? { ...from.subtitles } : { ...DEFAULT_SUBTITLE_CONFIG },
    audio: {
      ...(from?.audio || DEFAULT_AUDIO_CONFIG),
      narrationTrack: undefined
    },
    settings: settingsFrom(from),
    scriptWorkspace: createDefaultScriptWorkspace()
  };
}

export function writeSavedProjects(projects: VideoProject[]): boolean {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(projects.map(projectForPersist)));
    return true;
  } catch (err) {
    console.warn('[Project Persist] Failed to save project list:', err);
    showStatusToast('工程列表存档失败，大图已尽量剔除。请少存几份或先清掉本地大图。', {
      tone: 'warn',
      id: 'persist-library',
      durationMs: 4200
    });
    return false;
  }
}
