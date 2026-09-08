import {
  CastPresentation,
  NarratorMode,
  ScriptEntityLedger,
  ScriptEntityRecord,
  ScriptGenre
} from '../types';
import { ScriptAnalysis, ScriptEntity, castableAnalysisEntities, analysisEntityKind } from './scriptAnalysis';
import {
  CAST_CONFIDENCE_HARD,
  confirmedCastEntities,
  isNarrativeKind,
  narratorEntities,
  pendingCastEntities
} from './scriptEntity';

export type { CastPresentation };

export interface CastDecisionAllowed {
  name: string;
  kind: 'person' | 'creature' | 'anonymous' | 'narrator';
  candidateId: string;
  entityId: string;
  recurs: boolean;
  confidence: number;
  status: 'confirmed' | 'pending';
  reason?: string;
}

export interface CastDecision {
  hasCast: boolean;
  presentation: CastPresentation;
  allowed: CastDecisionAllowed[];
  pending: CastDecisionAllowed[];
  rejected: Array<{ name: string; reason: string }>;
  narratorMode?: NarratorMode;
  /** 未被采纳的“真人/动物”候选，供 UI 提示“为何没有上角色”。 */
  reason: string;
  confidence: number;
}

function toAllowed(entity: ScriptEntityRecord, status: 'confirmed' | 'pending', reason?: string): CastDecisionAllowed {
  const kind = entity.kind === 'creature'
    ? 'creature'
    : entity.kind === 'narrator'
      ? 'narrator'
      : entity.kind === 'anonymous'
        ? 'anonymous'
        : 'person';
  return {
    name: entity.name,
    kind,
    candidateId: entity.id,
    entityId: entity.id,
    recurs: entity.mentions >= 2,
    confidence: entity.confidence,
    status,
    reason
  };
}

function emptyDecision(reason: string, presentation: CastPresentation = 'montage', confidence = 0): CastDecision {
  return {
    hasCast: false,
    presentation,
    allowed: [],
    pending: [],
    rejected: [],
    reason,
    confidence
  };
}

/**
 * Decision layer only. Entity recognition lives in the ScriptEntity ledger;
 * this function chooses who becomes a hard card, who stays pending, and why.
 */
export function deriveCastDecisionFromLedger(
  ledger: ScriptEntityLedger | null | undefined,
  genre?: ScriptGenre | string | null,
  opts?: { narratorMode?: NarratorMode; analysis?: ScriptAnalysis | null }
): CastDecision {
  if (!ledger) return emptyDecision('无实体台账，走保守规则');
  const analysis = opts?.analysis;
  const narratorMode = opts?.narratorMode;
  const confidence = analysis?.confidence
    ?? Math.max(0, ...ledger.entities.map((item) => item.confidence), 0);
  const storyGenre = genre === '故事' || genre === '情绪';
  const contentType = analysis?.content_type || ledger.contentType;
  const perspective = analysis?.narrative_perspective || ledger.perspective;
  const narrativeContent = contentType === 'narrative_story' || contentType === 'emotional_essay';
  // Genre is a prior for coverage, not a second fact source that can override
  // a confident explainer/product analysis into a story cast.
  const analysisOverridesGenre = Boolean(analysis && analysis.confidence >= 0.6 && contentType && contentType !== 'unknown');
  const isNarrative = analysisOverridesGenre ? narrativeContent : (narrativeContent || storyGenre);

  const confirmed = confirmedCastEntities(ledger);
  const pending = pendingCastEntities(ledger);
  const narrators = narratorEntities(ledger);
  const personified = ledger.entities.filter((entity) => (
    entity.kind === 'creature' && (entity.analysisType === 'anthropomorphized' || entity.isNamed || entity.mentions >= 2)
  ));

  if (analysis?.personification_detected || personified.some((entity) => entity.analysisType === 'anthropomorphized')) {
    const allowed = (confirmed.length ? confirmed : personified.filter((item) => item.status === 'confirmed'))
      .filter((entity) => isNarrativeKind(entity.kind) && entity.kind !== 'narrator')
      .slice(0, 3)
      .map((entity) => toAllowed(entity, 'confirmed', '拟人化对象，锁定为一致角色'));
    const waiting = pending.filter((entity) => entity.kind === 'creature' || entity.kind === 'anonymous').map((entity) => (
      toAllowed(entity, 'pending', '拟人线索不足，待确认')
    ));
    return {
      hasCast: allowed.length > 0,
      presentation: 'character_driven',
      allowed,
      pending: waiting,
      rejected: [],
      narratorMode,
      reason: allowed.length ? '检测到拟人化对象，已锁定为一致角色' : '检测到拟人化但实体未贯穿，不上硬角色卡',
      confidence
    };
  }

  const productFocus = contentType === 'product_ad'
    || ledger.entities.some((entity) => entity.kind === 'object' && entity.mentions >= 2 && entity.analysisType === 'product');
  if (productFocus && !isNarrative) {
    return {
      ...emptyDecision('产品/带货内容：产品是画面主体，用实物锁定而非人物角色', 'product_showcase', confidence),
      pending: pending.filter((entity) => entity.kind === 'person' || entity.kind === 'anonymous').map((entity) => (
        toAllowed(entity, 'pending', '产品片中的人物待确认')
      )),
      narratorMode
    };
  }

  if (isNarrative) {
    const allowed = confirmed.slice(0, 3).map((entity) => toAllowed(entity, 'confirmed', '叙事型内容，具名实体有原文证据'));
    const waiting = pending.slice(0, 4).map((entity) => toAllowed(entity, 'pending', entity.kind === 'anonymous'
      ? '匿名人物：外形未知，待确认后才能作硬约束'
      : entity.kind === 'narrator'
        ? '第一人称讲述者：请选择旁白 / 出镜 / 剧情角色'
        : '置信不足，待确认'));
    if (allowed.length > 0) {
      return {
        hasCast: true,
        presentation: 'character_driven',
        allowed,
        pending: waiting.filter((item) => !allowed.some((other) => other.entityId === item.entityId)),
        rejected: [],
        narratorMode,
        reason: `叙事型内容，已锁定 ${allowed.map((item) => item.name).join('、')} 为一致角色`,
        confidence
      };
    }
    if (narrators.length && !confirmed.length) {
      return decideNarrator(narrators, pending, narratorMode, confidence, '叙事信号不足或缺少贯穿的真人/动物实体');
    }
    return {
      hasCast: false,
      presentation: 'montage',
      allowed: [],
      pending: waiting,
      rejected: [],
      narratorMode,
      reason: '叙事信号不足或缺少贯穿的真人/动物实体，未锁定角色',
      confidence
    };
  }

  if (perspective === 'first_person' || narrators.length) {
    return decideNarrator(narrators, pending, narratorMode, confidence, '第一人称内容');
  }

  if (analysis?.visual_density === 'abstract_heavy' || confirmed.length === 0) {
    return {
      ...emptyDecision(
        analysis?.visual_density === 'abstract_heavy' ? '抽象为主：走信息图/动态图形' : '未识别到可指认人物实体',
        analysis?.visual_density === 'abstract_heavy' ? 'motion_graphics' : 'montage',
        confidence
      ),
      pending: pending.map((entity) => toAllowed(entity, 'pending', '未达建卡阈值')),
      narratorMode
    };
  }

  return {
    ...emptyDecision('兜底：不建一致性角色', 'montage', confidence),
    pending: pending.map((entity) => toAllowed(entity, 'pending', '兜底待确认')),
    narratorMode
  };
}

function decideNarrator(
  narrators: ScriptEntityRecord[],
  pending: ScriptEntityRecord[],
  narratorMode: NarratorMode | undefined,
  confidence: number,
  prefix: string
): CastDecision {
  const waiting = [
    ...narrators.map((entity) => toAllowed(entity, 'pending', '第一人称讲述者，等待选择出镜方式')),
    ...pending.filter((entity) => entity.kind !== 'narrator').map((entity) => toAllowed(entity, 'pending', '待确认'))
  ];
  if (narratorMode === 'on_camera' || narratorMode === 'story_character') {
    const allowed = (narrators.length ? narrators : pending.filter((entity) => entity.kind === 'anonymous' || entity.kind === 'narrator'))
      .slice(0, 1)
      .map((entity) => toAllowed(
        { ...entity, kind: 'narrator', name: narratorMode === 'on_camera' ? '出镜讲解员' : entity.name },
        'confirmed',
        narratorMode === 'on_camera' ? '用户选择作出镜讲解员' : '用户选择作剧情角色'
      ));
    return {
      hasCast: allowed.length > 0,
      presentation: narratorMode === 'on_camera' ? 'narrator_led' : 'character_driven',
      allowed,
      pending: waiting.filter((item) => !allowed.some((other) => other.entityId === item.entityId)),
      rejected: [],
      narratorMode,
      reason: narratorMode === 'on_camera' ? `${prefix}：已选作出镜讲解员` : `${prefix}：已选作剧情角色`,
      confidence
    };
  }
  return {
    hasCast: false,
    presentation: 'narrator_led',
    allowed: [],
    pending: waiting,
    rejected: [],
    narratorMode: narratorMode || 'voiceover',
    reason: `${prefix}：默认为旁白声音，可改为出镜讲解员或剧情角色`,
    confidence
  };
}

export function deriveCastDecision(
  analysis: ScriptAnalysis | null | undefined,
  genre?: string | null,
  opts?: { ledger?: ScriptEntityLedger | null; narratorMode?: NarratorMode }
): CastDecision {
  if (opts?.ledger) {
    return deriveCastDecisionFromLedger(opts.ledger, genre, { narratorMode: opts.narratorMode, analysis: analysis || null });
  }
  if (!analysis) {
    return emptyDecision('无剧本解析，走保守规则');
  }
  const confidence = analysis.confidence ?? 0;

  const castable = castableAnalysisEntities(analysis);
  if (analysis.personification_detected || castable.some((entity) => entity.type === 'anthropomorphized')) {
    const allowed = castable
      .filter((entity) => entity.recurs_throughout || entity.is_named)
      .map((entity) => fromAnalysisEntity(entity, confidence))
      .slice(0, 3);
    return {
      hasCast: allowed.length > 0,
      presentation: 'character_driven',
      allowed,
      pending: [],
      rejected: [],
      reason: allowed.length
        ? '检测到拟人化对象，已锁定为一致角色'
        : '检测到拟人化但实体未贯穿，不上角色卡',
      confidence
    };
  }

  const narrative = analysis.content_type === 'narrative_story' || analysis.content_type === 'emotional_essay';
  const storyGenre = genre === '故事' || genre === '情绪';
  const analysisOverridesGenre = analysis.confidence >= 0.6 && analysis.content_type !== 'unknown';
  const isNarrative = analysisOverridesGenre ? narrative : (narrative || storyGenre);

  if (isNarrative) {
    const persons = analysis.confidence < CAST_CONFIDENCE_HARD
      ? []
      : castable.filter((entity) => entity.recurs_throughout || entity.is_named);
    if ((analysis.has_dialogue || analysis.has_narrative_arc || analysis.narrative_perspective === 'first_person') && persons.length > 0) {
      const allowed = persons.slice(0, 3).map((entity) => fromAnalysisEntity(entity, confidence));
      return {
        hasCast: true,
        presentation: 'character_driven',
        allowed,
        pending: [],
        rejected: [],
        reason: `叙事型内容，已锁定 ${allowed.map((item) => item.name).join('、')} 为一致角色`,
        confidence
      };
    }
    return {
      hasCast: false,
      presentation: 'montage',
      allowed: [],
      pending: [],
      rejected: [],
      reason: '叙事信号不足或缺少贯穿的真人/动物实体，未锁定角色',
      confidence
    };
  }

  const productFocus = analysis.content_type === 'product_ad'
    || analysis.entities.some((entity) => entity.type === 'product' && entity.recurs_throughout);
  if (productFocus) {
    return {
      ...emptyDecision('产品/带货内容：产品是画面主体，用实物锁定而非人物角色', 'product_showcase', confidence)
    };
  }

  if (analysis.narrative_perspective === 'first_person') {
    return {
      ...emptyDecision('第一人称内容：默认为旁白声音，不上剧情角色卡', 'narrator_led', confidence),
      narratorMode: 'voiceover'
    };
  }

  if (analysis.visual_density === 'abstract_heavy' || castable.length === 0) {
    return emptyDecision(
      analysis.visual_density === 'abstract_heavy' ? '抽象为主：走信息图/动态图形' : '未识别到可指认人物实体',
      analysis.visual_density === 'abstract_heavy' ? 'motion_graphics' : 'montage',
      confidence
    );
  }

  return emptyDecision('兜底：不建一致性角色', 'montage', confidence);
}

function fromAnalysisEntity(entity: ScriptEntity, confidence: number): CastDecisionAllowed {
  return {
    name: entity.name,
    kind: analysisEntityKind(entity.type) === 'creature' ? 'creature' : 'person',
    candidateId: entity.id,
    entityId: entity.id,
    recurs: entity.recurs_throughout,
    confidence,
    status: 'confirmed'
  };
}

export function decisionAllowsName(decision: CastDecision | null | undefined, name: string): boolean {
  if (!decision?.hasCast) return false;
  const needle = String(name || '').trim();
  return decision.allowed.some((item) => item.name === needle);
}
