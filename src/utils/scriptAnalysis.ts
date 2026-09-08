import { CastCandidate } from '../types';
import { groundEvidenceList, ScriptSources } from './scriptEntity';

/**
 * 剧本结构化分析（感知层）：LLM 只提取事实，不做“要不要上角色”的创作决策。
 * 决策由 castStrategy（规则引擎）完成。
 */
export const SCRIPT_ANALYSIS_SCHEMA_VERSION = 1;

export type ScriptContentType =
  | 'science_explainer'
  | 'narrative_story'
  | 'emotional_essay'
  | 'product_ad'
  | 'tutorial'
  | 'news_info'
  | 'vlog_presenter'
  | 'unknown';

export type ScriptPerspective =
  | 'first_person'
  | 'third_person'
  | 'omniscient'
  | 'none'
  | 'mixed';

export type ScriptEntityType =
  | 'person'
  | 'animal'
  | 'anthropomorphized'
  | 'product'
  | 'object'
  | 'occupation'
  | 'organization'
  | 'abstract';

export type ScriptVisualDensity = 'abstract_heavy' | 'concrete_visual' | 'mixed';

export interface ScriptEntity {
  id: string;
  name: string;
  type: ScriptEntityType;
  /** 是否为文案里的具名实体（真名/商品名/机构名）；匿名“一个用户/某女孩”不算。 */
  is_named: boolean;
  /** 是否贯穿全篇（在多个分句重复出现或承担结构性作用）。 */
  recurs_throughout: boolean;
  gender?: 'male' | 'female' | 'unknown';
  ageBand?: string;
  /** 必须引用原文；缺证据的实体视为低置信。 */
  evidence: string[];
}

export interface ScriptAnalysis {
  schema_version: number;
  content_type: ScriptContentType;
  narrative_perspective: ScriptPerspective;
  has_dialogue: boolean;
  has_narrative_arc: boolean;
  personification_detected: boolean;
  visual_density: ScriptVisualDensity;
  entities: ScriptEntity[];
  confidence: number;
}

export const EMPTY_ANALYSIS: ScriptAnalysis = {
  schema_version: SCRIPT_ANALYSIS_SCHEMA_VERSION,
  content_type: 'unknown',
  narrative_perspective: 'none',
  has_dialogue: false,
  has_narrative_arc: false,
  personification_detected: false,
  visual_density: 'concrete_visual',
  entities: [],
  confidence: 0
};

export const SCRIPT_ANALYSIS_SYSTEM = `你是影视前期策划里的剧本分析师。任务是从整篇口播文案里提取结构化事实，不做任何创作决策——不判断“要不要角色”、不设计画面、不改写文案。
只输出合法 JSON。JSON Schema 外的字段一律不要。

字段边界（必须严格遵守）：
- content_type：narrative_story=有情节/人物推进的故事；emotional_essay=第一人称情绪/哲思散文；science_explainer=科普原理；product_ad=产品种草/带货；tutorial=教程步骤；news_info=资讯/热点解读；vlog_presenter=主播/讲解员自我叙述；都不像再给 unknown。
- narrative_perspective：第一人称(我)/第三人称(他她它)/全知/无(none)/混用(mixed)。
- entities.type：person=真人；animal=动物(未拟人)；anthropomorphized=被拟人化的动物/物件/抽象概念(如“细胞小兵”)；product=商品/品牌/产品；object=被加工或反复出现的实物/道具(不一定是商品)；occupation=只以职业/身份出现、没有名字的人(如“工程师”“妈妈”只是关系称谓也算 occupation)；organization=机构；abstract=抽象概念。同一实体只进一条。
- name 只能填原文确实出现的真名或明确称谓。禁止把“走遍全城”“只为找”“张开嘴”这类动词/虚词短语当实体名。宁可少列，不要硬凑。
- evidence 必须逐字引用支撑该实体的一小句原文（<=40 字）。没有可引用原文的实体不要列。
- is_named：name 是专名(人名/商品名/机构名)=true；“一个用户”“某女孩”“妈妈”这类泛称或关系称谓=false。
- recurs_throughout：实体在开头、中段、结尾至少两处承担作用才算 true；只提一次=false。
- personification_detected：只有明显把非人写成有表情/会说话/会行动的角色才算 true（如“细胞像小兵一样战斗”）。仅仅作为被加工对象(食材/产品)不是拟人。
- visual_density：画面信息密度。abstract_heavy=全靠图表/文字/氛围，没有连续可拍主体。
- confidence：依据不足、可能误判时给低分(0-0.4)，不要硬猜。`;

export const SCRIPT_ANALYSIS_USER = (opts: {
  narration: string;
  genre?: string | null;
  title?: string;
  intentNotes?: string;
}): string => {
  const lines = [
    '把下面的整篇口播做一次全局结构化解析（整篇看，不按单句）。',
    '实体证据必须引用原文，能复核。',
    `【体裁】${opts.genre || ''}`,
    `【题目】${opts.title || ''}`,
    `【要讲清什么】${opts.intentNotes || '（空）'}`,
    '【口播】',
    opts.narration,
    '',
    '只输出 JSON：',
    '{',
    '  "schema_version": 1,',
    '  "content_type": "science_explainer | narrative_story | emotional_essay | product_ad | tutorial | news_info | vlog_presenter | unknown",',
    '  "narrative_perspective": "first_person | third_person | omniscient | none | mixed",',
    '  "has_dialogue": true,',
    '  "has_narrative_arc": true,',
    '  "personification_detected": false,',
    '  "visual_density": "abstract_heavy | concrete_visual | mixed",',
    '  "entities": [{"name": "", "type": "person | animal | anthropomorphized | product | object | occupation | organization | abstract", "is_named": true, "recurs_throughout": true, "gender": "unknown", "ageBand": "", "evidence": ["原文"]}],',
    '  "confidence": 0.8',
    '}'
  ];
  return lines.join('\n');
};

const PERSON_TYPES: ScriptEntityType[] = ['person', 'animal', 'anthropomorphized'];

export function analysisEntityKind(type: ScriptEntityType): 'person' | 'creature' | 'object' | null {
  if (type === 'person') return 'person';
  if (type === 'animal' || type === 'anthropomorphized') return 'creature';
  if (type === 'product' || type === 'object') return 'object';
  return null;
}

/** 能被视觉圣经作为角色卡认领的实体（person/动物/拟人）。 */
export function castableAnalysisEntities(analysis: ScriptAnalysis | null | undefined): ScriptEntity[] {
  if (!analysis) return [];
  return analysis.entities.filter((entity) => PERSON_TYPES.includes(entity.type));
}

function pickEvidence(sentence: string): string {
  return String(sentence || '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

export function parseScriptAnalysis(raw: unknown, sources?: ScriptSources): ScriptAnalysis | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as ScriptAnalysis;
  const allowedContent: ScriptContentType[] = [
    'science_explainer', 'narrative_story', 'emotional_essay', 'product_ad',
    'tutorial', 'news_info', 'vlog_presenter', 'unknown'
  ];
  const content_type = allowedContent.includes(data.content_type) ? data.content_type : 'unknown';
  const entities: ScriptEntity[] = Array.isArray(data.entities)
    ? data.entities.map((item, index): ScriptEntity | null => {
        if (!item || typeof item !== 'object') return null;
        const name = String((item as ScriptEntity).name || '').trim();
        if (!name) return null;
        const type: ScriptEntityType = ['person', 'animal', 'anthropomorphized', 'product', 'object', 'occupation', 'organization', 'abstract']
          .includes((item as ScriptEntity).type)
          ? (item as ScriptEntity).type
          : 'abstract';
        const quoted = Array.isArray((item as ScriptEntity).evidence)
          ? (item as ScriptEntity).evidence.map(pickEvidence).filter(Boolean).slice(0, 2)
          : [];
        const grounded = sources
          ? groundEvidenceList(quoted.length ? quoted : [name], sources).map((span) => span.text)
          : quoted;
        if (sources && !grounded.length) return null;
        return {
          id: `an-${index + 1}`,
          name,
          type,
          is_named: Boolean((item as ScriptEntity).is_named),
          recurs_throughout: Boolean((item as ScriptEntity).recurs_throughout),
          gender: (item as ScriptEntity).gender === 'male' || (item as ScriptEntity).gender === 'female'
            ? (item as ScriptEntity).gender
            : 'unknown',
          ageBand: String((item as ScriptEntity).ageBand || '').trim() || undefined,
          evidence: grounded
        };
      }).filter((item): item is ScriptEntity => Boolean(item)).slice(0, 8)
    : [];
  const confidence = Number.isFinite(Number(data.confidence))
    ? Math.max(0, Math.min(1, Number(data.confidence)))
    : 0.5;
  if (!entities.length && confidence < 0.4) return null;
  return {
    schema_version: SCRIPT_ANALYSIS_SCHEMA_VERSION,
    content_type,
    narrative_perspective: ['first_person', 'third_person', 'omniscient', 'none', 'mixed'].includes(data.narrative_perspective)
      ? data.narrative_perspective
      : 'none',
    has_dialogue: Boolean(data.has_dialogue),
    has_narrative_arc: Boolean(data.has_narrative_arc),
    personification_detected: Boolean(data.personification_detected),
    visual_density: data.visual_density === 'abstract_heavy' || data.visual_density === 'mixed'
      ? data.visual_density
      : 'concrete_visual',
    entities,
    confidence
  };
}

/** 生成为画面圣经 prompt 注入的“可认领名单”。 */
export function formatAnalysisContract(analysis: ScriptAnalysis | null | undefined, genre?: string | null): string {
  if (!analysis || !castableAnalysisEntities(analysis).length) {
    const fallback = !analysis
      ? '【整篇剧本解析】本片未识别到贯穿的真人/拟人实体。'
      : '【整篇剧本解析】未识别到可作为一致角色的真人/动物/拟人实体。';
    return `${fallback}
characters 必须输出 []。若正文是说明/教程/带货，把产品与实物当被加工对象写进 paletteLock/continuityRule；禁止拟人化、禁止给物体表情动作。`;
  }
  const lines = castableAnalysisEntities(analysis).map((entity) => (
    `- ${entity.id} 「${entity.name}」（${entity.type}${entity.is_named ? '，具名' : '，非具名'}${entity.recurs_throughout ? '，贯穿全篇' : '，非贯穿'}）${entity.evidence[0] ? ` 证据：${entity.evidence[0]}` : ''}`
  ));
  const narrative = analysis.content_type === 'narrative_story' || analysis.content_type === 'emotional_essay';
  return [
    '【整篇剧本解析 · 可认领实体】只能从下列实体认领人物/动物角色，禁止发明名单外的人或动物。',
    '每张卡必须带 sourceEvidence（引用原文）、candidateId 与 entityId，且三者对应同一台账实体。',
    '优先选「贯穿全篇」的实体作主角；只出现一次的具名实体若承担收束可作配角。',
    narrative
      ? '本片为叙事型：角色必须做一致性锁定（同一脸/服装/识别点）。'
      : '本片为说明型：默认 characters=[]；只有当实体有明显对话或贯穿的可见行动时才建卡，否则把外观一致性写进 paletteLock。',
    ...lines
  ].join('\n');
}

/**
 * 何时需要再做一次轻量 LLM 全局解析？默认不调；只有规则挖掘“模棱两可”时才调，避免每次重编都多一次请求。
 */
export function needsScriptAnalysis(input: {
  mode: 'story' | 'expository';
  hasNarrativeSignal: boolean;
  hasPersonReference: boolean;
  candidates: CastCandidate[];
}): boolean {
  const strongCast = input.candidates.some((candidate) => (
    (candidate.kind === 'person' || candidate.kind === 'creature')
    && (candidate.mentions >= 2 || candidate.inTitle || candidate.inNotes)
  ));
  if (strongCast) return false;
  if (input.mode === 'story') {
    // 故事类：有人称/对话但没能锁到具名主体 → 交给 LLM 判定，别用规则硬造。
    return input.hasNarrativeSignal || input.hasPersonReference;
  }
  // 说明类：有叙事信号但缺可指认主体（潜在出镜讲解者）才值得分析一次。
  return input.hasNarrativeSignal && input.hasPersonReference && !strongCast;
}
