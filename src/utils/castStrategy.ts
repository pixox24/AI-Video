import { ScriptAnalysis, ScriptEntity, castableAnalysisEntities, analysisEntityKind } from './scriptAnalysis';

export type CastPresentation =
  | 'character_driven'
  | 'product_showcase'
  | 'narrator_led'
  | 'motion_graphics'
  | 'montage';

export interface CastDecisionAllowed {
  name: string;
  kind: 'person' | 'creature';
  candidateId: string;
  recurs: boolean;
}

export interface CastDecision {
  hasCast: boolean;
  presentation: CastPresentation;
  allowed: CastDecisionAllowed[];
  /** 未被采纳的“真人/动物”候选，供 UI 提示“为何没有上角色”。 */
  reason: string;
  confidence: number;
}

export function deriveCastDecision(analysis: ScriptAnalysis | null | undefined, genre?: string | null): CastDecision {
  if (!analysis) {
    return { hasCast: false, presentation: 'montage', allowed: [], reason: '无剧本解析，走保守规则', confidence: 0 };
  }
  const confidence = analysis.confidence ?? 0;

  // 1) 拟人：先于内容类型判定，拟人科普也是角色班底。
  const castable = castableAnalysisEntities(analysis);
  if (analysis.personification_detected || castable.some((entity) => entity.type === 'anthropomorphized')) {
    const allowed = castable
      .filter((entity) => entity.recurs_throughout || entity.is_named)
      .map(toAllowed)
      .slice(0, 3);
    return {
      hasCast: allowed.length > 0,
      presentation: 'character_driven',
      allowed,
      reason: allowed.length
        ? '检测到拟人化对象，已锁定为一致角色'
        : '检测到拟人化但实体未贯穿，不上角色卡',
      confidence
    };
  }

  const narrative = analysis.content_type === 'narrative_story' || analysis.content_type === 'emotional_essay';
  const storyGenre = genre === '故事' || genre === '情绪';
  const isNarrative = narrative || storyGenre;

  // 2) 叙事/情绪：有对话或情节弧线且有人物实体 → 一致性班底。
  if (isNarrative) {
    const wantsCast = analysis.has_dialogue || analysis.has_narrative_arc || analysis.narrative_perspective === 'first_person';
    const persons = castable.filter((entity) => entity.recurs_throughout || entity.is_named);
    if (wantsCast && persons.length > 0) {
      const allowed = persons.slice(0, 3).map(toAllowed);
      return {
        hasCast: true,
        presentation: 'character_driven',
        allowed,
        reason: `叙事型内容，已锁定 ${allowed.map((item) => item.name).join('、')} 为一致角色`,
        confidence
      };
    }
    // 叙事体裁却没有贯穿实体：宁可不上角色，避免把口播词头硬造角色。
    return {
      hasCast: false,
      presentation: persons.length ? 'montage' : 'montage',
      allowed: [],
      reason: '叙事信号不足或缺少贯穿的真人/动物实体，未锁定角色',
      confidence
    };
  }

  // 3) 产品/带货：产品是被展示主体，不是叙事角色。
  const productFocus = analysis.content_type === 'product_ad'
    || analysis.entities.some((entity) => entity.type === 'product' && entity.recurs_throughout);
  if (productFocus) {
    return {
      hasCast: false,
      presentation: 'product_showcase',
      allowed: [],
      reason: '产品/带货内容：产品是画面主体，用实物锁定而非人物角色',
      confidence
    };
  }

  // 4) 第一人称教学/观点输出：讲解员为可选项，默认不上剧情角色。
  if (analysis.narrative_perspective === 'first_person') {
    return {
      hasCast: false,
      presentation: 'narrator_led',
      allowed: [],
      reason: '第一人称内容：讲解员可选，不上剧情角色卡',
      confidence
    };
  }

  // 5) 抽象为主 → 动态图形。
  if (analysis.visual_density === 'abstract_heavy' || castable.length === 0) {
    return {
      hasCast: false,
      presentation: analysis.visual_density === 'abstract_heavy' ? 'motion_graphics' : 'montage',
      allowed: [],
      reason: analysis.visual_density === 'abstract_heavy'
        ? '抽象为主：走信息图/动态图形'
        : '未识别到可指认人物实体',
      confidence
    };
  }

  return { hasCast: false, presentation: 'montage', allowed: [], reason: '兜底：不建一致性角色', confidence };
}

function toAllowed(entity: ScriptEntity): CastDecisionAllowed {
  return {
    name: entity.name,
    kind: analysisEntityKind(entity.type) === 'creature' ? 'creature' : 'person',
    candidateId: entity.id,
    recurs: entity.recurs_throughout
  };
}

export function decisionAllowsName(decision: CastDecision | null | undefined, name: string): boolean {
  if (!decision?.hasCast) return false;
  const needle = String(name || '').trim();
  return decision.allowed.some((item) => item.name === needle);
}
