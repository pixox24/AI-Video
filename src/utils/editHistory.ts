import { VideoProject } from '../types';

const MAX_STEPS = 40;

export function cloneProject(project: VideoProject): VideoProject {
  return structuredClone(project);
}

export function createEditHistory() {
  const past: VideoProject[] = [];
  const future: VideoProject[] = [];

  return {
    push(current: VideoProject) {
      past.push(cloneProject(current));
      if (past.length > MAX_STEPS) past.shift();
      future.length = 0;
    },
    undo(current: VideoProject): VideoProject | null {
      const prev = past.pop();
      if (!prev) return null;
      future.push(cloneProject(current));
      return prev;
    },
    redo(current: VideoProject): VideoProject | null {
      const next = future.pop();
      if (!next) return null;
      past.push(cloneProject(current));
      return next;
    },
    clear() {
      past.length = 0;
      future.length = 0;
    },
    canUndo() {
      return past.length > 0;
    },
    canRedo() {
      return future.length > 0;
    }
  };
}

export type EditHistory = ReturnType<typeof createEditHistory>;
