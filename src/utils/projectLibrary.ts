import { ProjectLibraryItem, VideoProject } from '../types';
import { stripProjectSecrets } from './appSettings';
import { createBlankProject, isSampleProjectId, projectForPersist } from './projectPersist';

const MIGRATED_KEY = 'ai_video_library_migrated';

export { isSampleProjectId };

export function copyTemplateProject(template: VideoProject, from?: VideoProject): VideoProject {
  const now = Date.now();
  const clone = structuredClone(template);
  return {
    ...clone,
    id: `project-${now}`,
    createdAt: now,
    updatedAt: now,
    saveRevision: 0,
    settings: {
      ...clone.settings,
      customImageApi: from?.settings.customImageApi || clone.settings.customImageApi,
      customLlmApi: from?.settings.customLlmApi || clone.settings.customLlmApi,
      customTtsApi: from?.settings.customTtsApi || clone.settings.customTtsApi,
      customVideoApi: from?.settings.customVideoApi || clone.settings.customVideoApi,
      customStyleVisionApi: from?.settings.customStyleVisionApi || clone.settings.customStyleVisionApi
    }
  };
}

export async function fetchProjectLibrary(): Promise<{ items: ProjectLibraryItem[]; currentId: string | null }> {
  try {
    const res = await fetch('/api/projects');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(data?.items)) return { items: [], currentId: null };
    return {
      items: data.items as ProjectLibraryItem[],
      currentId: typeof data.currentId === 'string' ? data.currentId : null
    };
  } catch {
    return { items: [], currentId: null };
  }
}

export async function fetchLibraryProject(id: string): Promise<VideoProject | null> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.project || !Array.isArray(data.project.clips)) return null;
    return data.project as VideoProject;
  } catch {
    return null;
  }
}

export async function createLibraryProject(project: VideoProject): Promise<VideoProject | null> {
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: stripProjectSecrets(projectForPersist(project)) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.project) return null;
    return data.project as VideoProject;
  } catch {
    return null;
  }
}

export async function duplicateLibraryProject(id: string, title?: string): Promise<VideoProject | null> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}/duplicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.project) throw new Error(data?.error || '另存失败');
    return data.project as VideoProject;
  } catch (err: any) {
    throw new Error(err?.message || '另存失败');
  }
}

export async function deleteLibraryProject(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return res.ok;
  } catch {
    return false;
  }
}

export async function migrateBrowserCopiesToLibrary(): Promise<number> {
  try {
    if (localStorage.getItem(MIGRATED_KEY) === '1') return 0;
  } catch {
    return 0;
  }

  let copies: VideoProject[] = [];
  try {
    const raw = localStorage.getItem('ai_video_saved_projects');
    copies = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(copies)) copies = [];
  } catch {
    copies = [];
  }

  const { items } = await fetchProjectLibrary();
  const existing = new Set(items.map((item) => item.id));
  let migrated = 0;
  for (const copy of copies) {
    if (!copy || !Array.isArray(copy.clips) || isSampleProjectId(copy.id) || existing.has(copy.id)) continue;
    const created = await createLibraryProject(copy);
    if (created) {
      existing.add(created.id);
      migrated += 1;
    }
  }

  try {
    localStorage.setItem(MIGRATED_KEY, '1');
    localStorage.removeItem('ai_video_saved_projects');
  } catch {
    // ignore
  }
  return migrated;
}

export function newBlankLibraryProject(from?: VideoProject): VideoProject {
  return createBlankProject(from);
}
