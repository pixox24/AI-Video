import type { ContentBrief, ScriptWorkspace } from '../types';

export function emptyContentBrief(topic = ''): ContentBrief {
  return { topic, audience: { roles: [], knowledgeLevel: 'beginner', primaryNeed: '' }, objective: '', viewerPromise: '', contentType: 'analysis', mustCover: [], mustAvoid: [], lockedFields: [] };
}
export function canEnterOutline(workspace: Pick<ScriptWorkspace, 'contentBrief'>): boolean {
  return Boolean(workspace.contentBrief?.viewerPromise.trim());
}
export function preserveBriefLocks(previous: ContentBrief | undefined, generated: ContentBrief): ContentBrief {
  if (!previous) return { ...generated, lockedFields: [] };
  const next = { ...generated, lockedFields: [...previous.lockedFields] };
  // The writing style is a user choice, never an LLM output; it always survives regeneration.
  next.writingStyleId = previous.writingStyleId;
  for (const field of previous.lockedFields) {
    // Explicit union avoids unsafe indexed writes across unrelated field types.
    switch (field) {
      case 'topic': next.topic = previous.topic; break;
      case 'audience': next.audience = structuredClone(previous.audience); break;
      case 'objective': next.objective = previous.objective; break;
      case 'viewerPromise': next.viewerPromise = previous.viewerPromise; break;
      case 'contentType': next.contentType = previous.contentType; break;
      case 'mustCover': next.mustCover = [...previous.mustCover]; break;
      case 'mustAvoid': next.mustAvoid = [...previous.mustAvoid]; break;
      case 'writingStyleId': next.writingStyleId = previous.writingStyleId; break;
    }
  }
  return next;
}
