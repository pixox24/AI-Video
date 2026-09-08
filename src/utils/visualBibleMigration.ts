import { VisualBible, VisualCharacter, VisualSubject } from '../types';
import { analysisFromLedger, buildEntityLedger, namesEqual } from './scriptEntity';

/** Recover pre-override statuses for projects saved before analysisStatus existed. */
export function migrateDecisionFacts(bible: VisualBible, sources: { narration: string; title?: string; intentNotes?: string }): VisualBible {
  if (!bible.entityLedger?.entities.some(entity => !entity.analysisStatus && bible.overrides?.[entity.id])) return bible;
  const facts = buildEntityLedger({ ...sources, analysis: bible.analysisSnapshot || analysisFromLedger(bible.entityLedger) });
  return { ...bible, entityLedger: { ...bible.entityLedger, entities: bible.entityLedger.entities.map(entity => {
    const original = facts.entities.find(item => item.id === entity.id || namesEqual(item.name, entity.name));
    return { ...entity, analysisStatus: entity.analysisStatus || original?.status || entity.status };
  }) } };
}

function hasOwn(raw: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

export interface NormalizedLocks {
  locked: boolean;
  identityLocked: boolean;
  appearanceLocked: boolean;
  refsLocked: boolean;
}

/**
 * One-shot lock migration.
 * - No new lock fields, locked=true → all three true (legacy whole-card lock).
 * - No new lock fields, locked=false → all three false.
 * - Any new lock field present → respect explicit booleans; missing ones default false.
 *   Do not re-derive from aggregate locked.
 */
export function migrateLockFlags(raw: any): NormalizedLocks {
  if (!raw || typeof raw !== 'object') {
    return { locked: false, identityLocked: false, appearanceLocked: false, refsLocked: false };
  }
  const hasIdentity = hasOwn(raw, 'identityLocked');
  const hasAppearance = hasOwn(raw, 'appearanceLocked');
  const hasRefs = hasOwn(raw, 'refsLocked');
  const hasAnyNew = hasIdentity || hasAppearance || hasRefs;
  if (!hasAnyNew) {
    const all = Boolean(raw.locked);
    return { locked: all, identityLocked: all, appearanceLocked: all, refsLocked: all };
  }
  const identityLocked = hasIdentity ? Boolean(raw.identityLocked) : false;
  const appearanceLocked = hasAppearance ? Boolean(raw.appearanceLocked) : false;
  const refsLocked = hasRefs ? Boolean(raw.refsLocked) : false;
  return {
    identityLocked,
    appearanceLocked,
    refsLocked,
    locked: identityLocked || appearanceLocked || refsLocked
  };
}

export function locksEqual(a: NormalizedLocks, b: NormalizedLocks): boolean {
  return a.identityLocked === b.identityLocked
    && a.appearanceLocked === b.appearanceLocked
    && a.refsLocked === b.refsLocked;
}

export function cardEntityKey(card: Pick<VisualCharacter, 'entityId' | 'candidateId' | 'id' | 'name'>): string {
  return String(card.entityId || card.candidateId || '').trim();
}

export function sameEntityIdentity(
  previous: Pick<VisualCharacter, 'entityId' | 'candidateId' | 'name' | 'kind'>,
  incoming: Pick<VisualCharacter, 'entityId' | 'candidateId' | 'name' | 'kind'>
): boolean {
  const prevId = String(previous.entityId || previous.candidateId || '').trim();
  const nextId = String(incoming.entityId || incoming.candidateId || '').trim();
  if (prevId && nextId) return prevId === nextId;
  if (prevId && nextId && prevId !== nextId) return false;
  const prevName = String(previous.name || '').replace(/\s+/g, '');
  const nextName = String(incoming.name || '').replace(/\s+/g, '');
  if (!prevName || !nextName || prevName !== nextName) return false;
  if (previous.kind && incoming.kind && previous.kind !== incoming.kind) return false;
  return true;
}

export function subjectEntityKey(subject: Pick<VisualSubject, 'entityId' | 'id' | 'name'>): string {
  return String(subject.entityId || '').trim();
}
