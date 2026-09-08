import { ScriptWorkspace, VisualBible, VisualCharacter, VisualCharacterRef } from '../types';
import { fnv1a64Hex } from './scriptEntity';
import { stableSerialize } from './visualBibleSource';
import { setCharacterRef } from './visualBible';

/** An operation may only commit to the exact workspace it started from. */
export function createBibleOperationGuard() {
  let serial = 0;
  return {
    start(workspace: ScriptWorkspace) { return { id: ++serial, workspace }; },
    cancel() { serial += 1; },
    isCurrent(token: { id: number; workspace: ScriptWorkspace }, workspace: ScriptWorkspace) {
      return token.id === serial && token.workspace === workspace;
    }
  };
}

export function characterAssetVersion(character: VisualCharacter): string {
  return fnv1a64Hex(stableSerialize({
    entityId: character.entityId || character.candidateId,
    name: character.name, kind: character.kind, look: character.look, wardrobe: character.wardrobe,
    ageBand: character.ageBand, signature: character.signature, refs: character.refs,
    identityLocked: character.identityLocked, appearanceLocked: character.appearanceLocked, refsLocked: character.refsLocked
  }));
}

export interface CharacterRefRequest {
  projectId: string;
  entityId: string;
  sourceKey: string;
  version: string;
  /** Runtime identity also rejects an edit followed by undo/back-to-original values. */
  initialCharacter: VisualCharacter;
}

export function captureCharacterRefRequest(projectId: string, bible: VisualBible, character: VisualCharacter): CharacterRefRequest {
  return { projectId, entityId: character.entityId || character.candidateId || '',
    sourceKey: bible.sourceKey || bible.sourceHash, version: characterAssetVersion(character), initialCharacter: character };
}

/** No card-ID fallback: reused IDs do not prove that the person is the same. */
export function applyCharacterRefResponse(projectId: string, bible: VisualBible, request: CharacterRefRequest, ref: VisualCharacterRef): VisualBible | null {
  if (!request.entityId || projectId !== request.projectId || (bible.sourceKey || bible.sourceHash) !== request.sourceKey) return null;
  const character = bible.characters.find(item => (item.entityId || item.candidateId) === request.entityId);
  if (!character || character !== request.initialCharacter || characterAssetVersion(character) !== request.version) return null;
  return setCharacterRef(bible, character.id, ref);
}
