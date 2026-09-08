import {
  AnonymousKind,
  CastCandidate,
  ScriptEntityLedger,
  ScriptEntityRecord,
  ScriptEvidenceSource,
  ScriptEvidenceSpan,
  VisualCharacterKind
} from '../types';
import type { ScriptAnalysis, ScriptEntity as AnalysisEntity } from './scriptAnalysis';
import { extractCastCandidates } from './castCandidates';

export const SCRIPT_ENTITY_SCHEMA_VERSION = 1;
export const CAST_CONFIDENCE_HARD = 0.55;
export const CAST_CONFIDENCE_PENDING = 0.35;

export const UNKNOWN_AGE = '文案未明示';
export const UNKNOWN_LOOK = '外形待确认（文案未描述）';
export const UNKNOWN_WARDROBE = '服装待确认（文案未描述）';

export interface ScriptSources {
  narration: string;
  title?: string;
  intentNotes?: string;
}

export interface BibleFingerprintInput {
  narration: string;
  genre?: string | null;
  mode?: string | null;
  title?: string;
  intentNotes?: string;
  candidateIds?: string[];
  analysisVersion?: number;
}

export function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

function compactText(value: unknown): string {
  return String(value || '').replace(/\s+/g, '');
}

export function bibleSourceFingerprint(input: BibleFingerprintInput): string {
  // Input fingerprint only. Generated entity / candidate IDs must never flow back in.
  const payload = {
    narration: String(input.narration || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(),
    title: String(input.title || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(),
    intentNotes: String(input.intentNotes || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(),
    genre: String(input.genre || ''),
    analysisVersion: String(input.analysisVersion || SCRIPT_ENTITY_SCHEMA_VERSION)
  };
  return fnv1a64Hex(JSON.stringify(payload));
}

export function namesEqual(a: string, b: string): boolean {
  const left = String(a || '').replace(/\s+/g, '').toLowerCase();
  const right = String(b || '').replace(/\s+/g, '').toLowerCase();
  return Boolean(left) && left === right;
}

export function isNarrativeKind(kind?: VisualCharacterKind | string | null): boolean {
  return kind === 'person' || kind === 'creature' || kind === 'anonymous' || kind === 'narrator';
}

export function isObjectKind(kind?: VisualCharacterKind | string | null): boolean {
  return kind === 'object';
}

export function kindsCompatible(cardKind?: string | null, entityKind?: string | null): boolean {
  if (!cardKind || !entityKind) return true;
  if (cardKind === entityKind) return true;
  if (cardKind === 'person' && (entityKind === 'anonymous' || entityKind === 'narrator')) return true;
  if ((cardKind === 'anonymous' || cardKind === 'narrator') && entityKind === 'person') return true;
  return false;
}

export function slugEntityId(name: string, used: Set<string>, fallbackIndex: number, prefix = 'ent'): string {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  const base = `${prefix}-${slug || fallbackIndex + 1}`;
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

export function assignUniqueIds<T extends { id: string; name: string }>(items: T[], prefix: string): T[] {
  const used = new Set<string>();
  return items.map((item, index) => {
    const incoming = String(item.id || '').trim();
    if (incoming && !used.has(incoming)) {
      used.add(incoming);
      return item;
    }
    return { ...item, id: slugEntityId(item.name, used, index, prefix) };
  });
}

function sourceText(sources: ScriptSources, source: ScriptEvidenceSource): string {
  if (source === 'title') return String(sources.title || '');
  if (source === 'intentNotes') return String(sources.intentNotes || '');
  return String(sources.narration || '');
}

function mapCompactRange(original: string, compactStart: number, compactLen: number): { start: number; end: number } | null {
  let compactIndex = 0;
  let start = -1;
  let end = -1;
  for (let i = 0; i < original.length; i++) {
    if (/\s/.test(original[i])) continue;
    if (compactIndex === compactStart) start = i;
    compactIndex += 1;
    if (compactIndex === compactStart + compactLen) {
      end = i + 1;
      break;
    }
  }
  if (start < 0 || end < 0) return null;
  return { start, end };
}

/** Locate an evidence quote as an actual substring of title / notes / narration. */
export function locateEvidence(quote: string, sources: ScriptSources): ScriptEvidenceSpan | null {
  const needle = String(quote || '').replace(/\s+/g, ' ').trim();
  if (needle.length < 2) return null;
  const order: ScriptEvidenceSource[] = ['narration', 'title', 'intentNotes'];
  const compactNeedle = needle.replace(/\s+/g, '');
  for (const source of order) {
    const hay = sourceText(sources, source);
    if (!hay) continue;
    const exact = hay.indexOf(needle);
    if (exact >= 0) {
      return { text: hay.slice(exact, exact + needle.length), source, start: exact, end: exact + needle.length };
    }
    if (compactNeedle.length < 2) continue;
    const compactHay = hay.replace(/\s+/g, '');
    const compactAt = compactHay.indexOf(compactNeedle);
    if (compactAt < 0) continue;
    const mapped = mapCompactRange(hay, compactAt, compactNeedle.length);
    if (!mapped) continue;
    return { text: hay.slice(mapped.start, mapped.end), source, start: mapped.start, end: mapped.end };
  }
  return null;
}

export function groundEvidenceList(quotes: string[] | undefined, sources: ScriptSources, limit = 4): ScriptEvidenceSpan[] {
  const out: ScriptEvidenceSpan[] = [];
  const seen = new Set<string>();
  for (const quote of quotes || []) {
    const hit = locateEvidence(quote, sources);
    if (!hit) continue;
    const key = `${hit.source}:${hit.start}:${hit.end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
    if (out.length >= limit) break;
  }
  return out;
}

export function evidenceInNarration(spans: ScriptEvidenceSpan[] | undefined): boolean {
  return Boolean(spans?.some((span) => span.source === 'narration'));
}

function isCjk(ch: string | undefined): boolean {
  return Boolean(ch && /[\u4e00-\u9fff]/.test(ch));
}

/** Exact mention: 李明 must not match 李明哲; English uses word boundaries. */
export function nameMentionedIn(haystack: string, name: string): boolean {
  const text = String(haystack || '');
  const needle = String(name || '').trim();
  if (!needle || needle.length < 2) return false;
  if (/[A-Za-z]/.test(needle) && !/[\u4e00-\u9fff]/.test(needle)) {
    const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    return re.test(text);
  }
  let from = 0;
  while (from <= text.length) {
    const at = text.indexOf(needle, from);
    if (at < 0) return false;
    const before = text[at - 1];
    // 李明哲 contains 李明: reject mid-name hits. Conjunctions like 和/与 are delimiters.
    if (!isCjk(before) || /[和与跟同、，,的]/.test(before)) return true;
    from = at + needle.length;
  }
  return false;
}

const ANON_EVIDENCE: Record<string, RegExp> = {
  '匿名女孩': /一个女孩|有个女孩|那位女孩|一个少女/,
  '匿名男孩': /一个男孩|有个男孩|那位男孩|一个少年/,
  '匿名女人': /一个女人|一位女士|一个姑娘/,
  '匿名男人': /一个男人|一位男士|一个小伙/,
  '匿名孩子': /一个孩子|有个孩子/,
  '第一人称讲述者': /(?<![A-Za-z\u4e00-\u9fff])我(?!们)/,
  '出镜讲解员': /(?<![A-Za-z\u4e00-\u9fff])我(?!们)/
};

export function evidenceBelongsToEntity(
  name: string,
  kind: string | undefined,
  evidence: Array<{ text: string; source?: string }>,
  sources?: ScriptSources
): boolean {
  const joined = evidence.map((item) => item.text).join('｜');
  const narration = sources?.narration || '';
  if (kind === 'narrator' || name === '第一人称讲述者' || name === '出镜讲解员') {
    return ANON_EVIDENCE['第一人称讲述者'].test(joined) || ANON_EVIDENCE['第一人称讲述者'].test(narration);
  }
  const anon = ANON_EVIDENCE[name];
  if (anon || kind === 'anonymous') {
    if (anon) return anon.test(joined) || anon.test(narration);
    return /一个|有个|那位|一位/.test(joined);
  }
  if (!nameMentionedIn(joined, name)) return false;
  if (sources?.narration && !nameMentionedIn(sources.narration, name) && !nameMentionedIn(sources.title || '', name)) {
    return false;
  }
  return true;
}

const ANON_PATTERNS: Array<{ re: RegExp; name: string; anonymousKind: AnonymousKind }> = [
  { re: /一个女孩|有个女孩|那位女孩|一个少女/, name: '匿名女孩', anonymousKind: 'unnamed_person' },
  { re: /一个男孩|有个男孩|那位男孩|一个少年/, name: '匿名男孩', anonymousKind: 'unnamed_person' },
  { re: /一个女人|一位女士|一个姑娘/, name: '匿名女人', anonymousKind: 'unnamed_person' },
  { re: /一个男人|一位男士|一个小伙/, name: '匿名男人', anonymousKind: 'unnamed_person' },
  { re: /一个孩子|有个孩子/, name: '匿名孩子', anonymousKind: 'unnamed_person' }
];

function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/[。！？!?；;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function firstPersonPresent(narration: string): boolean {
  return /(?<![A-Za-z\u4e00-\u9fff])我(?!们)/.test(narration);
}

function analysisKind(type: string | undefined): VisualCharacterKind | null {
  if (type === 'person' || type === 'occupation') return 'person';
  if (type === 'animal' || type === 'anthropomorphized') return 'creature';
  if (type === 'product' || type === 'object') return 'object';
  return null;
}

function candidateConfidence(candidate: CastCandidate, narration: string): number {
  const inNarration = String(narration || '').includes(candidate.name);
  if (!inNarration && (candidate.inTitle || candidate.inNotes)) return 0.2;
  if (candidate.kind === 'person' && candidate.mentions >= 2) return 0.9;
  if (candidate.kind === 'person') return 0.82;
  if (candidate.kind === 'creature') return candidate.mentions >= 2 ? 0.8 : 0.7;
  if (candidate.kind === 'object') return candidate.mentions >= 2 ? 0.75 : 0.62;
  return 0.5;
}

function toRecordFromCandidate(
  candidate: CastCandidate,
  sources: ScriptSources,
  used: Set<string>,
  index: number
): ScriptEntityRecord | null {
  const narration = sources.narration || '';
  const inNarration = narration.includes(candidate.name);
  if (!inNarration && !candidate.inNotes) {
    // Title-only names stay in the ledger as rejected so they cannot become hard cards.
    if (candidate.inTitle) {
      return {
        id: candidate.id || slugEntityId(candidate.name, used, index),
        name: candidate.name,
        kind: candidate.kind,
        isNamed: candidate.kind === 'person',
        evidence: groundEvidenceList(candidate.evidence, sources),
        confidence: 0.2,
        mentions: candidate.mentions,
        inTitle: true,
        inNotes: Boolean(candidate.inNotes),
        origin: 'rule',
        status: 'rejected',
        analysisType: candidate.kind
      };
    }
    return null;
  }
  const evidence = groundEvidenceList(
    candidate.evidence.length ? candidate.evidence : [candidate.name],
    sources
  );
  if (!evidence.length) return null;
  const confidence = candidate.confidence ?? candidateConfidence(candidate, narration);
  const status: ScriptEntityRecord['status'] = confidence >= CAST_CONFIDENCE_HARD
    ? 'confirmed'
    : confidence >= CAST_CONFIDENCE_PENDING
      ? 'pending'
      : 'rejected';
  return {
    id: candidate.id || slugEntityId(candidate.name, used, index),
    name: candidate.name,
    kind: candidate.kind,
    isNamed: candidate.kind === 'person' || Boolean(candidate.name && candidate.name.length >= 2 && candidate.kind !== 'object'),
    evidence,
    confidence,
    mentions: candidate.mentions,
    inTitle: Boolean(candidate.inTitle),
    inNotes: Boolean(candidate.inNotes),
    origin: 'rule',
    status: candidate.kind === 'object' ? 'confirmed' : status,
    analysisType: candidate.kind
  };
}

function toRecordFromAnalysis(
  entity: AnalysisEntity,
  sources: ScriptSources,
  used: Set<string>,
  index: number,
  docConfidence: number
): ScriptEntityRecord | null {
  const kind = analysisKind(entity.type);
  if (!kind && entity.type !== 'occupation') return null;
  const resolvedKind: VisualCharacterKind = entity.type === 'occupation' ? 'anonymous' : (kind || 'person');
  const evidence = groundEvidenceList(entity.evidence.length ? entity.evidence : [entity.name], sources);
  if (!evidence.length) return null;
  const belongs = evidenceBelongsToEntity(entity.name, resolvedKind, evidence, sources);
  if (!belongs) {
    return {
      id: entity.id || slugEntityId(entity.name, used, index),
      name: entity.name,
      kind: resolvedKind,
      isNamed: Boolean(entity.is_named),
      evidence,
      confidence: 0.2,
      mentions: entity.recurs_throughout ? 2 : 1,
      origin: 'llm',
      status: 'rejected',
      analysisType: entity.type
    };
  }
  let confidence = Math.min(1, Math.max(0.2, (Number.isFinite(docConfidence) ? docConfidence : 0.6) * (entity.recurs_throughout ? 1 : 0.85)));
  if (!entity.is_named && resolvedKind === 'person') confidence = Math.min(confidence, 0.48);
  if (entity.type === 'occupation') confidence = Math.min(confidence, 0.45);
  const status: ScriptEntityRecord['status'] = confidence >= CAST_CONFIDENCE_HARD
    ? 'confirmed'
    : confidence >= CAST_CONFIDENCE_PENDING
      ? 'pending'
      : 'rejected';
  return {
    id: entity.id || slugEntityId(entity.name, used, index),
    name: entity.name,
    kind: entity.type === 'occupation' ? 'anonymous' : resolvedKind,
    isNamed: Boolean(entity.is_named),
    anonymousKind: entity.type === 'occupation' ? 'occupation' : (!entity.is_named && resolvedKind === 'person' ? 'unnamed_person' : undefined),
    evidence,
    confidence,
    mentions: entity.recurs_throughout ? 2 : 1,
    origin: 'llm',
    status,
    analysisType: entity.type
  };
}

function detectAnonymous(sources: ScriptSources, used: Set<string>): ScriptEntityRecord[] {
  const narration = sources.narration || '';
  const out: ScriptEntityRecord[] = [];
  for (const pattern of ANON_PATTERNS) {
    const match = pattern.re.exec(narration);
    if (!match) continue;
    const evidence = locateEvidence(match[0], sources);
    if (!evidence) continue;
    out.push({
      id: slugEntityId(pattern.name, used, out.length),
      name: pattern.name,
      kind: 'anonymous',
      isNamed: false,
      anonymousKind: pattern.anonymousKind,
      evidence: [evidence],
      confidence: 0.46,
      mentions: 1,
      origin: 'rule',
      status: 'pending',
      analysisType: 'person'
    });
  }
  if (firstPersonPresent(narration)) {
    const sentence = splitSentences(narration).find((item) => /(?<![A-Za-z\u4e00-\u9fff])我(?!们)/.test(item));
    const evidence = sentence ? locateEvidence(sentence.slice(0, 40), sources) : locateEvidence('我', sources);
    if (evidence) {
      out.push({
        id: slugEntityId('第一人称讲述者', used, out.length),
        name: '第一人称讲述者',
        kind: 'narrator',
        isNamed: false,
        anonymousKind: 'first_person',
        evidence: [evidence],
        confidence: 0.42,
        mentions: 2,
        origin: 'rule',
        status: 'pending',
        analysisType: 'person'
      });
    }
  }
  return out;
}

function mergeRecords(existing: ScriptEntityRecord, incoming: ScriptEntityRecord): ScriptEntityRecord {
  const evidence = [...existing.evidence];
  for (const span of incoming.evidence) {
    if (!evidence.some((item) => item.source === span.source && item.start === span.start && item.end === span.end)) {
      evidence.push(span);
    }
  }
  const confidence = Math.max(existing.confidence, incoming.confidence);
  const status = existing.status === 'rejected' && incoming.status !== 'rejected'
    ? incoming.status
    : incoming.status === 'rejected' && existing.status !== 'rejected'
      ? existing.status
      : (confidence >= CAST_CONFIDENCE_HARD ? 'confirmed' : existing.status === 'pending' || incoming.status === 'pending' ? 'pending' : existing.status);
  return {
    ...existing,
    kind: isNarrativeKind(existing.kind) ? existing.kind : incoming.kind,
    isNamed: existing.isNamed || incoming.isNamed,
    evidence: evidence.slice(0, 4),
    confidence,
    mentions: Math.max(existing.mentions, incoming.mentions),
    inTitle: existing.inTitle || incoming.inTitle,
    inNotes: existing.inNotes || incoming.inNotes,
    origin: existing.origin === 'user' ? 'user' : incoming.origin === 'llm' ? 'llm' : existing.origin,
    status,
    analysisType: existing.analysisType || incoming.analysisType
  };
}

export function buildEntityLedger(opts: {
  narration: string;
  title?: string;
  intentNotes?: string;
  candidates?: CastCandidate[];
  analysis?: ScriptAnalysis | null;
}): ScriptEntityLedger {
  const sources: ScriptSources = {
    narration: String(opts.narration || ''),
    title: opts.title,
    intentNotes: opts.intentNotes
  };
  const candidates = opts.candidates || extractCastCandidates({
    narration: sources.narration,
    title: sources.title,
    intentNotes: sources.intentNotes
  });
  const used = new Set<string>();
  const byName = new Map<string, ScriptEntityRecord>();
  const add = (record: ScriptEntityRecord | null) => {
    if (!record) return;
    used.add(record.id);
    const key = record.name.replace(/\s+/g, '').toLowerCase();
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, record);
      return;
    }
    byName.set(key, mergeRecords(prev, record));
  };

  candidates.forEach((candidate, index) => add(toRecordFromCandidate(candidate, sources, used, index)));
  if (opts.analysis) {
    opts.analysis.entities.forEach((entity, index) => {
      add(toRecordFromAnalysis(entity, sources, used, index, opts.analysis?.confidence ?? 0.5));
    });
  }
  detectAnonymous(sources, used).forEach(add);

  const entities = [...byName.values()];
  const fingerprint = bibleSourceFingerprint({
    narration: sources.narration,
    title: sources.title,
    intentNotes: sources.intentNotes,
    genre: opts.analysis ? undefined : undefined,
    analysisVersion: SCRIPT_ENTITY_SCHEMA_VERSION
  });
  return {
    version: SCRIPT_ENTITY_SCHEMA_VERSION,
    fingerprint,
    sourceKey: fingerprint,
    entities,
    contentType: opts.analysis?.content_type,
    contentConfidence: opts.analysis?.confidence,
    perspective: opts.analysis?.narrative_perspective,
    hasDialogue: opts.analysis?.has_dialogue,
    hasNarrativeArc: opts.analysis?.has_narrative_arc,
    personificationDetected: opts.analysis?.personification_detected,
    visualDensity: opts.analysis?.visual_density,
    provenance: opts.analysis ? 'llm' : 'rule_fallback',
    generatedAt: Date.now()
  };
}

export function matchLedgerEntity(
  ledger: ScriptEntityLedger | null | undefined,
  card: { candidateId?: string; entityId?: string; name: string; kind?: string }
): { entity: ScriptEntityRecord | null; mismatch: string | null } {
  if (!ledger) return { entity: null, mismatch: null };
  const id = String(card.entityId || card.candidateId || '').trim();
  if (id) {
    const entity = ledger.entities.find((item) => item.id === id) || null;
    if (!entity) return { entity: null, mismatch: `角色「${card.name}」引用的台账 ID「${id}」不存在` };
    if (!namesEqual(entity.name, card.name)) {
      return { entity, mismatch: `角色「${card.name}」与台账「${entity.name}」ID 错配` };
    }
    if (!kindsCompatible(card.kind, entity.kind)) {
      return { entity: null, mismatch: `角色「${card.name}」的类型与台账「${entity.kind}」不一致` };
    }
    return { entity, mismatch: null };
  }
  const entity = ledger.entities.find((item) => namesEqual(item.name, card.name)) || null;
  if (entity && card.kind && !kindsCompatible(card.kind, entity.kind)) {
    return { entity: null, mismatch: `角色「${card.name}」的类型与台账「${entity.kind}」不一致` };
  }
  return { entity, mismatch: null };
}

export function ledgerToCandidates(ledger: ScriptEntityLedger | null | undefined): CastCandidate[] {
  if (!ledger) return [];
  return ledger.entities
    .filter((entity) => entity.status !== 'rejected')
    .map((entity) => ({
      id: entity.id,
      name: entity.name,
      kind: entity.kind === 'anonymous' || entity.kind === 'narrator' ? 'person' : entity.kind,
      mentions: entity.mentions,
      evidence: entity.evidence.map((item) => item.text),
      inTitle: entity.inTitle,
      inNotes: entity.inNotes,
      confidence: entity.confidence
    }));
}

export function confirmedCastEntities(ledger: ScriptEntityLedger | null | undefined): ScriptEntityRecord[] {
  if (!ledger) return [];
  return ledger.entities.filter((entity) => (
    isNarrativeKind(entity.kind)
    && entity.kind !== 'narrator'
    && entity.status === 'confirmed'
    && entity.confidence >= CAST_CONFIDENCE_HARD
    && evidenceInNarration(entity.evidence)
    && entity.isNamed
  ));
}

export function pendingCastEntities(ledger: ScriptEntityLedger | null | undefined): ScriptEntityRecord[] {
  if (!ledger) return [];
  return ledger.entities.filter((entity) => (
    isNarrativeKind(entity.kind)
    && entity.status === 'pending'
    && entity.confidence >= CAST_CONFIDENCE_PENDING
  ));
}

export function objectEntities(ledger: ScriptEntityLedger | null | undefined): ScriptEntityRecord[] {
  if (!ledger) return [];
  return ledger.entities.filter((entity) => entity.kind === 'object' && entity.status !== 'rejected');
}

export function analysisFromLedger(ledger: ScriptEntityLedger | null | undefined): import('./scriptAnalysis').ScriptAnalysis | null {
  if (!ledger?.contentType) return null;
  const content = ledger.contentType as import('./scriptAnalysis').ScriptContentType;
  return {
    schema_version: 1,
    content_type: content,
    narrative_perspective: (ledger.perspective as import('./scriptAnalysis').ScriptPerspective) || 'none',
    has_dialogue: Boolean(ledger.hasDialogue),
    has_narrative_arc: Boolean(ledger.hasNarrativeArc),
    personification_detected: Boolean(ledger.personificationDetected),
    visual_density: ledger.visualDensity === 'abstract_heavy' || ledger.visualDensity === 'mixed'
      ? ledger.visualDensity
      : 'concrete_visual',
    entities: [],
    confidence: ledger.contentConfidence ?? 0
  };
}

export function narratorEntities(ledger: ScriptEntityLedger | null | undefined): ScriptEntityRecord[] {
  if (!ledger) return [];
  return ledger.entities.filter((entity) => entity.kind === 'narrator' && entity.status !== 'rejected');
}

export function appearanceIsUnknown(look?: string, wardrobe?: string): boolean {
  const text = `${look || ''} ${wardrobe || ''}`;
  return !look
    || look === UNKNOWN_LOOK
    || /待确认|未描述|不得擅自|不擅自推断/.test(text);
}
