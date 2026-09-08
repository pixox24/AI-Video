import { ScriptGenre, StylePack, VisualBible } from '../types';
import { extractCastCandidates } from '../utils/castCandidates';
import {
  SCRIPT_ANALYSIS_SYSTEM,
  SCRIPT_ANALYSIS_USER,
  parseScriptAnalysis,
  needsScriptAnalysis,
  ScriptAnalysis
} from '../utils/scriptAnalysis';
import { buildEntityLedger } from '../utils/scriptEntity';
import { analysisCacheKey, buildAnalysisInput, bibleRevisionOf, currentSourceKey, sourceKey as keyOf } from '../utils/visualBibleSource';
import { presetStylePack, styleContractForPrompt } from '../utils/stylePack';
import {
  applyAnalysisToBible,
  extractNarrativeCharacterHints,
  fallbackVisualBible,
  groundVisualBible,
  hasNarrativeSignal,
  mergeVisualBible,
  narrativeEntityContract,
  normalizeVisualBible,
  visualBibleModeForGenre
} from '../utils/visualBible';
import { formatAnalysisContract } from '../utils/scriptAnalysis';

export interface CompileVisualBibleRequest {
  narration: string;
  genre?: ScriptGenre | string | null;
  title?: string;
  intentNotes?: string;
  previousBible?: VisualBible | null;
  candidates?: ReturnType<typeof extractCastCandidates>;
  forceReanalyse?: boolean;
  requestId?: string;
  stylePack?: unknown;
  language?: string | null;
  model?: string;
}

export interface CompileVisualBibleResult {
  bible: VisualBible;
  analysisApplied: boolean;
  fallback: boolean;
  diagnostics: {
    analysisCacheHit: boolean;
    analysisSource: 'llm' | 'rule_fallback' | 'cache';
    analysisCalls: number;
    compileCalls: number;
    sourceKey: string;
    requestId: string;
  };
}

export interface VisualBibleCompileDeps {
  analyze?: (input: { system: string; user: string }) => Promise<unknown>;
  compileCards?: (input: { system: string; user: string }) => Promise<unknown>;
  now?: () => number;
}

const analysisCache = new Map<string, ScriptAnalysis>();
const inflight = new Map<string, Promise<ScriptAnalysis | null>>();

export function resetVisualBibleServiceCache() {
  analysisCache.clear();
  inflight.clear();
}

export async function compileVisualBible(
  request: CompileVisualBibleRequest,
  deps: VisualBibleCompileDeps = {}
): Promise<CompileVisualBibleResult> {
  const input = buildAnalysisInput(request);
  const text = input.narration;
  const titleText = input.title;
  const notes = input.intentNotes;
  const genre = request.genre as ScriptGenre | null;
  const mode = visualBibleModeForGenre(genre);
  const requestId = request.requestId || `vb-${(deps.now || Date.now)()}`;
  const prev = normalizeVisualBible(request.previousBible, mode);
  const resolvedCandidates = Array.isArray(request.candidates) && request.candidates.length
    ? request.candidates
    : extractCastCandidates({ narration: text, title: titleText, intentNotes: notes });
  const sourceKey = keyOf(input);
  const cacheKey = analysisCacheKey(input, { model: request.model });
  if (prev?.pinned) return {
    bible: prev, analysisApplied: Boolean(prev.analysisSnapshot), fallback: false,
    diagnostics: { analysisCacheHit: Boolean(prev.analysisSnapshot && prev.analysisCacheKey === cacheKey && prev.sourceKey === sourceKey), analysisSource: prev.analysisSnapshot ? 'cache' : 'rule_fallback',
      analysisCalls: 0, compileCalls: 0, sourceKey, requestId }
  };
  const hints = extractNarrativeCharacterHints(text);
  const needsAnalysis = needsScriptAnalysis({
    mode,
    hasNarrativeSignal: hasNarrativeSignal(text, resolvedCandidates, notes),
    hasPersonReference: hints.hasPerson,
    candidates: resolvedCandidates
  });

  let analysisCalls = 0;
  let compileCalls = 0;
  let analysis: ScriptAnalysis | null = null;
  let analysisSource: 'llm' | 'rule_fallback' | 'cache' = 'rule_fallback';
  const previousIsLlm = prev?.entityLedger?.provenance === 'llm';
  const cachedFromPrev = !request.forceReanalyse && previousIsLlm
    && prev?.sourceKey === sourceKey && prev.analysisCacheKey === cacheKey && prev.analysisSnapshot
    ? parseScriptAnalysis(prev.analysisSnapshot, { narration: text, title: titleText, intentNotes: notes })
    : null;
  const cached = cachedFromPrev || (!request.forceReanalyse ? analysisCache.get(cacheKey) : null) || null;
  const analysisCacheHit = Boolean(cached && cached.content_type && cached.content_type !== 'unknown');
  if (analysisCacheHit) {
    analysis = cached;
    analysisSource = 'cache';
  } else if (needsAnalysis && deps.analyze) {
    const running = !request.forceReanalyse && inflight.get(cacheKey);
    if (running) {
      analysis = await running;
      analysisSource = 'cache';
    } else {
      const job = (async () => {
        analysisCalls += 1;
        try {
          const raw = await deps.analyze!({
            system: SCRIPT_ANALYSIS_SYSTEM,
            user: SCRIPT_ANALYSIS_USER({ narration: text, genre: genre as string, title: titleText, intentNotes: notes })
          });
          const parsed = parseScriptAnalysis(raw, { narration: text, title: titleText, intentNotes: notes });
          return parsed?.content_type !== 'unknown' ? parsed : null;
        } catch { return null; }
      })();
      inflight.set(cacheKey, job);
      try {
        analysis = await job;
        if (analysis) {
          analysisCache.set(cacheKey, analysis);
          if (analysisCache.size > 32) {
            const first = analysisCache.keys().next().value;
            if (first) analysisCache.delete(first);
          }
        }
        analysisSource = analysis ? 'llm' : 'rule_fallback';
      } finally {
        if (inflight.get(cacheKey) === job) inflight.delete(cacheKey);
      }
    }
  }

  const ledger = buildEntityLedger({
      narration: text,
      title: titleText,
      intentNotes: notes,
      candidates: resolvedCandidates,
      analysis
    });

  const stamp = (bible: VisualBible): VisualBible => {
    if (bible.pinned) return bible;
    const next: VisualBible = {
    ...bible,
    entityLedger: {
      ...(bible.entityLedger || ledger),
      sourceKey: bible.pinned ? (bible.sourceKey || sourceKey) : sourceKey,
      provenance: analysisSource === 'llm' || analysisSource === 'cache' ? 'llm' : 'rule_fallback'
    },
    sourceHash: bible.pinned ? (bible.sourceHash || sourceKey) : sourceKey,
    sourceFingerprint: bible.pinned ? (bible.sourceFingerprint || sourceKey) : sourceKey,
    sourceKey: bible.pinned ? (bible.sourceKey || sourceKey) : sourceKey,
    analysisCacheKey: cacheKey,
    analysisInput: input,
    analysisSnapshot: analysis || undefined,
    generatedAt: (deps.now || Date.now)()
    };
    return { ...next, bibleRevision: bibleRevisionOf(next) };
  };

  const entityContract = analysis
    ? formatAnalysisContract(analysis, genre as string)
    : narrativeEntityContract(text, { title: titleText, intentNotes: notes, candidates: resolvedCandidates });
  const pack = request.stylePack as StylePack | undefined;
  const style = styleContractForPrompt(pack?.world && pack?.render ? pack : presetStylePack('cinematic'));
  const compilePrompt = `根据整段口播编译「画面圣经 VisualBible」。有原文证据才能建角色；没有证据必须 characters=[]。有角色不等于每镜都上人。
硬规则：
- mode=${mode} 只影响画面先验，不决定是否创建角色。科普、教程、带货默认不建叙事人物。
- 角色 0 到 3 个，只能从下方台账认领；entityId、candidateId、name、kind 必须对应同一实体。禁止编造人名。
- 并列人物可作为共同主角。拟人动物为 creature；普通实物必须进入 subjects，禁止拟人化。
- sourceEvidence 必须逐字引用支撑该实体的口播片段，禁止拿另一个实体的真实句子作证。
- 未写明的年龄、服装和外形不得编成文案事实；留空或标明文案未明示。设计服装和场景须遵守下方风格约束。
- 场景 0 到 2 个，有人物时可给出共同场景；paletteLock 与 continuityRule 必填。
- 所有 refs=[]、locked=false；不要输出用户选择、overrides、entityLedger、分析快照或来源字段。不要改口播。
${style}
${entityContract}
【体裁】${genre || ''}
【题目】${titleText}
【创作意图】${notes}
【语言】${input.language}
【口播】
${text}
只输出 JSON：{"mode":"${mode}","logline":"","paletteLock":"","characters":[{"id":"char-1","entityId":"","candidateId":"","name":"","role":"lead","kind":"person","ageBand":"","look":"","wardrobe":"","signature":"","sourceEvidence":[],"locked":false,"refs":[]}],"subjects":[{"id":"subj-1","entityId":"","name":"","kind":"object","look":"","sourceEvidence":[],"locked":false,"refs":[]}],"locations":[{"id":"loc-1","name":"","look":"","timeOfDay":"","locked":false,"refs":[]}],"motif":null,"continuityRule":""}`;

  let fallback = analysisSource === 'rule_fallback' && needsAnalysis;
  let incoming: VisualBible;
  if (deps.compileCards) {
    compileCalls += 1;
    try {
      const parsed = await deps.compileCards({
        system: '你只输出合法 JSON。画面圣经是可钉的约束。candidateId 必须与 name 对应同一实体。',
        user: compilePrompt
      });
      const normalized = normalizeVisualBible(parsed, mode);
      if (normalized) {
        // The model supplies design fields only. Facts and user choices are server-owned.
        normalized.entityLedger = ledger;
        normalized.overrides = {};
        normalized.retiredEntities = [];
        normalized.issues = [];
        normalized.pinned = false;
        normalized.characters = normalized.characters.map(card => ({ ...card, refs: [], locked: false,
          identityLocked: false, appearanceLocked: false, refsLocked: false }));
        normalized.subjects = normalized.subjects?.map(subject => ({ ...subject, refs: [], locked: false,
          identityLocked: false, appearanceLocked: false, refsLocked: false }));
        normalized.locations = normalized.locations.map(location => ({ ...location, refs: [], locked: false }));
      }
      if (!normalized || !(normalized.characters.length || normalized.subjects?.length || normalized.paletteLock)) fallback = true;
      incoming = normalized && (normalized.characters.length > 0 || normalized.subjects?.length || normalized.paletteLock)
        ? stamp(normalized)
        : stamp(fallbackVisualBible({ narration: text, genre, title: titleText, intentNotes: notes, candidates: resolvedCandidates, analysis, ledger }));
    } catch {
      fallback = true;
      incoming = stamp(fallbackVisualBible({ narration: text, genre, title: titleText, intentNotes: notes, candidates: resolvedCandidates, analysis, ledger }));
    }
  } else {
    incoming = stamp(fallbackVisualBible({ narration: text, genre, title: titleText, intentNotes: notes, candidates: resolvedCandidates, analysis, ledger }));
  }

  const merged = groundVisualBible(mergeVisualBible(prev, incoming), text, {
    title: titleText,
    intentNotes: notes,
    candidates: resolvedCandidates,
    analysis,
    genre,
    language: input.language
  });
  const withAnalysis = analysis
    ? applyAnalysisToBible(merged, analysis, genre, { narration: text, title: titleText, intentNotes: notes })
    : merged;

  return {
    bible: stamp(withAnalysis),
    analysisApplied: Boolean(analysis),
    fallback,
    diagnostics: {
      analysisCacheHit,
      analysisSource,
      analysisCalls,
      compileCalls,
      sourceKey,
      requestId
    }
  };
}

export function receiveVisualBibleResponse(
  current: {
    narration: string;
    title?: string;
    intentNotes?: string;
    genre?: ScriptGenre | string | null;
    requestId?: string;
    bibleRevision?: string;
    language?: string | null;
  },
  incoming: CompileVisualBibleResult
): CompileVisualBibleResult | null {
  const liveKey = currentSourceKey(current.narration, {
    title: current.title,
    intentNotes: current.intentNotes,
    genre: current.genre,
    language: current.language
  });
  if (incoming.diagnostics.sourceKey !== liveKey) return null;
  if (current.requestId && current.requestId !== incoming.diagnostics.requestId) return null;
  return incoming;
}
