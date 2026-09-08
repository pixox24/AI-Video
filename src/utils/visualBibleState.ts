import {
  EntityUserOverride,
  NarratorMode,
  ScriptEntityLedger,
  ScriptEntityRecord,
  UserDecision,
  VisualBible,
  VisualCharacter,
  VisualCharacterRef
} from '../types';
import { assignUniqueIds, namesEqual, UNKNOWN_AGE, UNKNOWN_LOOK, UNKNOWN_WARDROBE } from './scriptEntity';
import { bibleRevisionOf } from './visualBibleSource';

export type BibleAction =
  | { type: 'set_entity_decision'; entityId: string; decision: UserDecision }
  | { type: 'set_narrator_mode'; mode: NarratorMode }
  | { type: 'set_entity_display_name'; entityId: string; displayName: string }
  | { type: 'set_entity_appearance'; entityId: string; patch: Partial<Pick<VisualCharacter, 'look' | 'wardrobe' | 'ageBand' | 'signature'>> }
  | { type: 'set_entity_lock'; entityId: string; field: 'identity' | 'appearance' | 'refs'; value: boolean }
  | { type: 'set_entity_refs'; entityId: string; refs: VisualCharacterRef[] };

export function emptyOverride(entityId: string): EntityUserOverride {
  return {
    entityId,
    decision: 'auto',
    locks: { identity: false, appearance: false, refs: false }
  };
}

export function bibleOverrides(bible?: VisualBible | null): Record<string, EntityUserOverride> {
  return { ...(bible?.overrides || {}) };
}

export function upsertOverride(
  bible: VisualBible,
  entityId: string,
  patch: Partial<EntityUserOverride>
): VisualBible {
  if (!entityId) return bible;
  const current = bible.overrides?.[entityId] || emptyOverride(entityId);
  const next: EntityUserOverride = {
    ...current,
    ...patch,
    entityId,
    locks: { ...current.locks, ...(patch.locks || {}) }
  };
  return {
    ...bible,
    overrides: { ...bible.overrides, [entityId]: next }
  };
}

export function applyOverridesToLedger(ledger: ScriptEntityLedger, overrides?: Record<string, EntityUserOverride> | null): ScriptEntityLedger {
  if (!overrides) return ledger;
  return {
    ...ledger,
    entities: ledger.entities.map((entity) => {
      const decision = overrides[entity.id]?.decision;
      const analysisStatus = entity.analysisStatus ?? entity.status;
      return { ...entity, analysisStatus, status: decision === 'include' ? 'confirmed' as const
        : decision === 'exclude' ? 'rejected' as const : analysisStatus };
    })
  };
}

export function excludedEntityIds(bible?: VisualBible | null): Set<string> {
  const ids = new Set<string>();
  Object.values(bible?.overrides || {}).forEach((item) => {
    if (item.decision === 'exclude') ids.add(item.entityId);
  });
  (bible?.rejectedCast || []).forEach((item) => {
    const match = bible?.entityLedger?.entities.find((entity) => namesEqual(entity.name, item.name));
    if (match && !bible?.overrides?.[match.id]) ids.add(match.id);
  });
  return ids;
}

export function includedEntityIds(bible?: VisualBible | null): Set<string> {
  const ids = new Set<string>();
  Object.values(bible?.overrides || {}).forEach((item) => {
    if (item.decision === 'include') ids.add(item.entityId);
  });
  return ids;
}

function stamped(bible: VisualBible): VisualBible {
  return { ...bible, bibleRevision: bibleRevisionOf(bible) };
}

export function reduceBibleAction(state: VisualBible, action: BibleAction): VisualBible {
  if (action.type === 'set_narrator_mode') {
    return stamped({ ...state, narratorMode: action.mode });
  }
  const entityId = 'entityId' in action ? action.entityId : '';
  if (!entityId) return state;
  if (action.type === 'set_entity_decision') {
    const originalEntity = state.entityLedger?.entities.find(entity => entity.id === entityId);
    const currentCard = [...state.characters, ...(state.pendingCharacters || [])]
      .find(item => (item.entityId || item.candidateId || item.id) === entityId)
      || state.overrides?.[entityId]?.decisionCard
      || (originalEntity && originalEntity.kind !== 'object' ? {
        id: `char-${originalEntity.id}`, entityId, candidateId: entityId,
        name: originalEntity.name, kind: originalEntity.kind, role: 'support' as const,
        status: originalEntity.analysisStatus || originalEntity.status,
        ageBand: UNKNOWN_AGE, look: UNKNOWN_LOOK, wardrobe: UNKNOWN_WARDROBE,
        sourceEvidence: originalEntity.evidence.map(span => span.text), evidenceSpans: originalEntity.evidence,
        locked: false, identityLocked: false, appearanceLocked: false, refsLocked: false, refs: []
      } : undefined);
    let next = upsertOverride(state, entityId, {
      decision: action.decision,
      decisionCard: currentCard || state.overrides?.[entityId]?.decisionCard
    });
    next = {
      ...next,
      entityLedger: next.entityLedger ? applyOverridesToLedger(next.entityLedger, next.overrides) : next.entityLedger
    };
    if (action.decision === 'include') {
      const pending = (next.pendingCharacters || []).find((item) => (item.entityId || item.candidateId) === entityId || item.id === entityId)
        || next.overrides?.[entityId]?.decisionCard;
      const existing = next.characters.find((item) => (item.entityId || item.candidateId) === entityId);
      if (!existing && pending) {
        const card: VisualCharacter = {
          ...pending,
          status: 'confirmed',
          role: next.characters.some((item) => item.role === 'lead') ? 'support' : 'lead',
          castReason: '用户确认为角色'
        };
        next = {
          ...next,
          characters: assignUniqueIds([...next.characters, card], 'char').slice(0, 8),
          pendingCharacters: (next.pendingCharacters || []).filter((item) => item.id !== pending.id)
        };
      }
      next = {
        ...next,
        rejectedCast: (next.rejectedCast || []).filter((item) => {
          const entity = next.entityLedger?.entities.find((row) => row.id === entityId);
          return !entity || !namesEqual(entity.name, item.name);
        })
      };
      return stamped(next);
    }
    if (action.decision === 'exclude') {
      const entity = next.entityLedger?.entities.find((row) => row.id === entityId);
      const dropped = next.characters.find((item) => (item.entityId || item.candidateId) === entityId)
        || (next.pendingCharacters || []).find((item) => (item.entityId || item.candidateId) === entityId);
      return stamped({
        ...next,
        characters: next.characters.filter((item) => (item.entityId || item.candidateId) !== entityId),
        pendingCharacters: (next.pendingCharacters || []).filter((item) => (item.entityId || item.candidateId) !== entityId),
        rejectedCast: [
          ...(next.rejectedCast || []).filter((item) => !entity || !namesEqual(entity.name, item.name)),
          { name: entity?.name || dropped?.name || entityId, reason: '用户选择不建卡' }
        ]
      });
    }
    // Auto is derived from the preserved analysis status, not from the last decision.
    const entity = next.entityLedger?.entities.find(item => item.id === entityId);
    const card = currentCard || next.overrides?.[entityId]?.decisionCard;
    const characters = next.characters.filter(item => (item.entityId || item.candidateId || item.id) !== entityId);
    const pendingCharacters = (next.pendingCharacters || []).filter(item => (item.entityId || item.candidateId || item.id) !== entityId);
    if (card && entity?.status === 'confirmed') characters.push({ ...card, status: 'confirmed' });
    if (card && entity?.status === 'pending') pendingCharacters.push({ ...card, status: 'pending' });
    return stamped({ ...next, characters, pendingCharacters,
      rejectedCast: (next.rejectedCast || []).filter(item => !entity || !namesEqual(item.name, entity.name)) });
  }
  if (action.type === 'set_entity_display_name') {
    return stamped({
      ...upsertOverride(state, entityId, { displayName: action.displayName }),
      characters: state.characters.map((item) => (
        (item.entityId || item.candidateId) === entityId || item.id === entityId ? { ...item, name: action.displayName } : item
      )),
      pendingCharacters: (state.pendingCharacters || []).map((item) => (
        (item.entityId || item.candidateId) === entityId || item.id === entityId ? { ...item, name: action.displayName } : item
      ))
    });
  }
  if (action.type === 'set_entity_appearance') {
    const card = state.characters.find((item) => (item.entityId || item.candidateId) === entityId || item.id === entityId);
    const patch = Object.fromEntries(Object.entries(action.patch).filter(([, value]) => value !== undefined));
    return stamped({
      ...upsertOverride(state, entityId, {
        appearance: {
          look: action.patch.look ?? card?.look ?? '',
          wardrobe: action.patch.wardrobe ?? card?.wardrobe ?? '',
          ageBand: action.patch.ageBand ?? card?.ageBand,
          signature: action.patch.signature ?? card?.signature,
          source: 'user'
        }
      }),
      characters: state.characters.map((item) => (
        (item.entityId || item.candidateId) === entityId || item.id === entityId ? { ...item, ...patch } : item
      ))
    });
  }
  if (action.type === 'set_entity_lock') {
    const card = state.characters.find((item) => (item.entityId || item.candidateId) === entityId || item.id === entityId);
    const existing = state.overrides?.[entityId];
    const locks = {
      identity: existing ? Boolean(existing.locks.identity) : Boolean(card?.identityLocked),
      appearance: existing ? Boolean(existing.locks.appearance) : Boolean(card?.appearanceLocked),
      refs: existing ? Boolean(existing.locks.refs) : Boolean(card?.refsLocked)
    };
    locks[action.field] = action.value;
    const locked = locks.identity || locks.appearance || locks.refs;
    const next = {
      ...upsertOverride(state, entityId, { locks }),
      characters: state.characters.map((item) => (
        (item.entityId || item.candidateId) === entityId || item.id === entityId
          ? {
              ...item,
              identityLocked: locks.identity,
              appearanceLocked: locks.appearance,
              refsLocked: locks.refs,
              locked
            }
          : item
      ))
    };
    return { ...next, bibleRevision: bibleRevisionOf(next) };
  }
  if (action.type === 'set_entity_refs') {
    const card = state.characters.find((item) => (item.entityId || item.candidateId) === entityId || item.id === entityId);
    const existing = state.overrides?.[entityId];
    const locks = {
      identity: existing ? Boolean(existing.locks.identity) : Boolean(card?.identityLocked),
      appearance: existing ? Boolean(existing.locks.appearance) : Boolean(card?.appearanceLocked),
      refs: true
    };
    const next = {
      ...upsertOverride(state, entityId, { locks }),
      characters: state.characters.map((item) => (
        (item.entityId || item.candidateId) === entityId || item.id === entityId
          ? { ...item, refs: action.refs, refsLocked: true, locked: true }
          : item
      ))
    };
    return { ...next, bibleRevision: bibleRevisionOf(next) };
  }
  return { ...state, bibleRevision: bibleRevisionOf(state) };
}

export function ledgerEntityById(ledger: ScriptEntityLedger | null | undefined, id: string): ScriptEntityRecord | undefined {
  return ledger?.entities.find((item) => item.id === id);
}
