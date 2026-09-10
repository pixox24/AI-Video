import { ScriptBrief, ScriptLanguage, ScriptOutlineSection, ScriptRevisionAction } from '../types';
import { normalizeScriptLanguage } from './scriptLanguage';

export const OUTLINE_SYSTEM = `你是长视频编导与结构编辑，不是一次性文案续写器。
先规划观众获得信息的顺序，再写章节。
不得把用户未提供或未确认的事实写成事实；不确定的内容标为观点或待核实。
每章只完成一个明确任务，并且必须给观众带来新的信息、证据、步骤或因果推进。
不得为了填满时长重复题目、重复结论或写空泛过渡。
只输出指定 JSON，禁止 Markdown。

【Phase 2 追加约束】必须围绕 viewerPromise 规划唯一核心命题；每段输出 narrationBudgetSec、visualHoldBudgetSec、retentionDevice、transitionOut。口播预算合计须在全片预算 ±10%，hook 总预算不超过 35 秒，30 秒内交付第一份实质信息。`;

export const SECTION_DRAFT_SYSTEM = `你只写指定章节，不能改题、不能改全片结论、不能改变其他章节。
本章必须兑现 promise，并且仅使用列出的 evidenceIds 对应事实；没有证据时使用“观点/经验”表达，禁止伪造来源、数据、人物和案例。
不要重复已讲内容。用 bridgeFromPrevious 自然承接，但不要重新复述上一章。
不要预告下一章的完整答案，只留下能推动观看的必要衔接。
每个 beat 必须给可拍的 visualIntent；不得使用“很有氛围”“电影感”等抽象占位词。
只输出 JSON。`;

export const SECTION_REVISE_SYSTEM = `你是精确编辑，只改指定章节以修正时长偏差。
保持章节承诺、事实、术语、角色、前后衔接和已有 beat 顺序。
压缩时优先删除重复修饰、重复举例和可替代过渡；扩写时优先补具体例子、必要解释、因果链或用户可执行步骤。
输出完整修订后的该章 JSON，而不是 diff、建议或 Markdown。

【Phase 3 追加】仅按本章的质量问题定向修复，禁止全文重写。扩写只允许证据、案例、推导、演示、反例、可执行步骤；不得伪造来源、数据、人物或案例。压缩不得删除结论成立所必需的论证。无来源高风险事实应删去或明确标为待核实，不得捏造引文。`;

export function outlineUserPrompt(input: {
  title: string;
  brief: ScriptBrief;
  contextBlock: string;
  plans: Array<{ id: string; order: number; title: string; role: string; targetSeconds: number; minUnits: number; maxUnits: number }>;
  unitName: string;
  notesRule?: string;
  viewerPromise?: string;
}): string {
  const evidence = input.brief.evidence.length
    ? input.brief.evidence.map((item) => `${item.id}: ${item.claim}${item.source ? `（${item.source}）` : ''}`).join('\n')
    : '（用户未提供证据。不得编造事实、数据、来源或案例。）';
  return `根据创作简报规划全片提纲，不要写口播正文。
硬约束：
- 必须按下面的章节方案输出，不得合并或删章
- promise 必须具体，禁止“继续讲解”“展开说明”
- evidenceIds 只能引用下面已有证据 ID
${input.notesRule || ''}

${input.contextBlock}
【观众承诺】${input.viewerPromise || '（未填）'}

【核心问题】${input.brief.coreQuestion || '（未填）'}
【目标受众】${input.brief.audience || '（未填）'}
【核心结论】${input.brief.coreConclusion || '（未填）'}
【行动目标】${input.brief.callToAction || '（未填）'}
【禁区】${input.brief.forbiddenClaims.join('；') || '（无）'}
【术语】${input.brief.requiredTerms.join('、') || '（无）'}
【证据账本】
${evidence}

【章节方案】
${input.plans.map((plan) => `${plan.order}. ${plan.id} ${plan.title} ${plan.role} ${plan.targetSeconds}s ${plan.minUnits}–${plan.maxUnits}${input.unitName}`).join('\n')}

只输出 JSON：{"oneSentenceThesis":string,"sections":[{"id","title","audienceQuestion","promise","evidenceIds","bridgeFromPrevious","bridgeToNext","narrationBudgetSec","visualHoldBudgetSec","retentionDevice","transitionOut"}]}`;
}

export function sectionDraftUserPrompt(input: {
  language: ScriptLanguage;
  section: ScriptOutlineSection;
  sectionIndex: number;
  sectionCount: number;
  brief: ScriptBrief;
  thesis: string;
  summaries: string;
  contextBlock: string;
  styleContract: string;
  unitName: string;
  notesRule?: string;
}): string {
  const lang = normalizeScriptLanguage(input.language);
  const countRule = lang === 'en'
    ? `Section narration word count must be between ${input.section.minUnits} and ${input.section.maxUnits}.`
    : `本章口播汉字数必须在 ${input.section.minUnits}–${input.section.maxUnits} 之间。`;
  const evidence = input.brief.evidence
    .filter((item) => input.section.evidenceIds.includes(item.id))
    .map((item) => `${item.id}: ${item.claim}`)
    .join('\n') || '（本章无已确认证据，只能写观点/经验，禁止伪造事实。）';
  return `按这一章的时长预算写口播，不要写其他章。
硬约束：
- ${countRule}
- 节拍口播按顺序拼接后必须逐字覆盖本章正文
- 只写这一章，兑现 promise，不要重复标题，不要预告下一章完整答案
- beats 1 到 4 个，function 必须属于本章角色 ${input.section.role}
- visualIntent 写看得见的画面
${input.notesRule || ''}

${input.styleContract}
${input.contextBlock}

【全片结论】${input.brief.coreConclusion || input.thesis || '（未填）'}
【受众】${input.brief.audience || '（未填）'}
【本章】${input.section.order}/${input.sectionCount} ${input.section.title} ${input.section.role} ${input.section.targetSeconds}s
【观众问题】${input.section.audienceQuestion || '按角色写清这一段'}
【章节承诺】${input.section.promise || '按角色写清这一段'}
【承接】${input.section.bridgeFromPrevious || '（开篇）'}
【衔接到下一章】${input.section.bridgeToNext || '不要剧透下一章'}
【可用证据】
${evidence}
【已完成章节摘要】
${input.summaries}

只输出 JSON：{"narration":string,"usedEvidenceIds":string[],"beats":[{"id","order","function","intent","narration","energy","visualIntent","needsHold"}]}`;
}

export function sectionReviseUserPrompt(input: {
  language: ScriptLanguage;
  section: { title: string; narration: string; minUnits: number; maxUnits: number; beats?: unknown };
  action: ScriptRevisionAction;
  unitName: string;
  brief: ScriptBrief;
}): string {
  const lang = normalizeScriptLanguage(input.language);
  return `只修订这一章。
硬约束：
- 本次目标是 ${input.action.action === 'compress' ? '压缩' : input.action.action === 'expand' ? '扩写' : '改过渡'}约 ${input.action.targetDeltaUnits} ${input.unitName}
- 修订后口播仍须在 ${input.section.minUnits}–${input.section.maxUnits} ${input.unitName}
- 不能改变本章核心结论，也不得修改其他章节
- beats.narration 按顺序完整拼接成 narration
${input.action.instruction}

【核心结论】${input.brief.coreConclusion || '（保持原结论）'}
【本章标题】${input.section.title}
【当前正文】${input.section.narration}

${lang === 'en' ? `Section narration word count must be between ${input.section.minUnits} and ${input.section.maxUnits}.` : `本章口播汉字数必须在 ${input.section.minUnits}–${input.section.maxUnits} 之间。`}

只输出 JSON：{"narration":string,"usedEvidenceIds":string[],"beats":[{"id","order","function","intent","narration","energy","visualIntent","needsHold"}]}`;
}
