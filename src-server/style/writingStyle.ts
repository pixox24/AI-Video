import { z } from 'zod';
import type { WritingStyleProfile } from '../../src/shared/writingStyle';
import { styleLint } from './lint';

/**
 * Renders the append-only style block injected into SECTION_DRAFT_SYSTEM / its user prompt.
 * The three original system prompts stay verbatim; style only ever appends.
 */
export function writingStyleBlock(profile: WritingStyleProfile, rules?: string[]): string {
  const active = (rules && rules.length ? rules : profile.rules).filter(Boolean);
  return [
    `【写作风格】按「${profile.label}」执行：`,
    ...active.map((rule, index) => `${index + 1}. ${rule}`),
    `禁止表达：${profile.bannedPatterns.join('、')}`,
    `范例（就照这个语感写）：「${profile.exemplar}」`,
    `反例（不要写成这样）：「${profile.counterExemplar}」`,
    '风格约束不改变本章 promise、证据约束与时长预算；冲突时内容与时长优先。'
  ].join('\n');
}

export function styleGuidelineList(profile: WritingStyleProfile): string {
  return profile.rules.map((rule, index) => `${index + 1}. ${rule}`).join('\n');
}

/** Picks the archive rules a finding actually breaks, so the revision prompt names them. */
export function violatedStyleRules(profile: WritingStyleProfile, findings: { message: string; evidence?: string }[]): string[] {
  const found = findings
    .map(finding => profile.rules.find(rule => finding.message.includes(rule) || (finding.evidence || '').includes(rule)))
    .filter((rule): rule is string => Boolean(rule));
  return [...new Set(found)];
}

function revisionRules(profile: WritingStyleProfile, findings: { message: string; evidence?: string }[]): string[] {
  const hit = violatedStyleRules(profile, findings);
  return hit.length ? hit : profile.rules;
}

/**
 * The exact style-violation records a section produced. Used for the pre/post acceptance
 * comparison: every violation must disappear after the style revision.
 */
export function sectionStyleViolations(profile: WritingStyleProfile, narration: string, language: 'zh' | 'en' = 'zh') {
  return styleLint(narration, profile, { language });
}

export function styleRevisionInstruction(profile: WritingStyleProfile, findings: { message: string; suggestedFix: string; evidence?: string }[]): string {
  const active = revisionRules(profile, findings);
  return [
    `【风格修复】本次修订需使本章符合「${profile.label}」：${active.join('；')}`,
    '只调整表达方式，不改变事实、论证结构与时长预算。',
    ...findings.map(finding => `- 需修正：${finding.evidence ? `「${finding.evidence}」` : finding.message}。${finding.suggestedFix}`)
  ].join('\n');
}

export const STYLE_INFER_SYSTEM = `你是文案风格归纳器，只归纳用户样例里真实存在的写法。
exemplarIndex / counterExemplarIndex 必须指向 samples 数组的下标，不得输出样例以外的句子，不得改写样例原文。
禁止自创规则、禁止形容词堆砌。只输出严格 JSON。`;

export const styleInferModelSchema = z.object({
  label: z.string().trim().min(1).max(24),
  description: z.string().trim().min(1).max(160),
  rules: z.array(z.string().trim().min(1)).min(3).max(10),
  bannedPatterns: z.array(z.string().trim().min(1)).max(12),
  /** Index into the submitted samples; the endpoint copies the verbatim excerpt itself. */
  exemplarIndex: z.number().int().nonnegative(),
  counterExemplarIndex: z.number().int().nonnegative()
}).strict();
export type StyleInferModelOutput = z.infer<typeof styleInferModelSchema>;

export interface StyleInferRequest {
  samples: string[];
  label?: string;
  description?: string;
  /** Optional counter-example the user provides; otherwise the least typical sample is used. */
  counterExemplar?: string;
}

export const styleInferRequestSchema = z.object({
  samples: z.array(z.string().trim().min(40)).min(2).max(3),
  label: z.string().trim().min(1).max(24).optional(),
  description: z.string().trim().min(1).max(160).optional(),
  counterExemplar: z.string().trim().min(1).max(600).optional()
}).strict();
export type StyleInferRequestInput = z.infer<typeof styleInferRequestSchema>;

export function styleInferUserPrompt(input: StyleInferRequest, banned: string[]): string {
  return `请从下面 ${input.samples.length} 篇用户历史文案中归纳写作风格档案。
硬约束：
- rules 只写样例里能验证的句式、密度、视角约束，3–8 条，禁止形容词堆砌
- bannedPatterns 写样例里刻意回避的套话；若样例未体现，可只从下面的通用禁令里挑选命中的
- exemplarIndex 选最能代表该风格的一篇的下标；counterExemplarIndex 选最不典型的一篇的下标，两者必须不同
- 不得编造样例以外的句子，也不得改写样例原文

【通用禁令参考】${banned.join('、')}
${input.label ? `【用户给定名称】${input.label}` : ''}${input.description ? `\n【用户给定说明】${input.description}` : ''}

【样例】
${input.samples.map((sample, index) => `--- 样例 ${index} ---\n${sample}`).join('\n')}

只输出 JSON：{"label":string,"description":string,"rules":string[],"bannedPatterns":string[],"exemplarIndex":number,"counterExemplarIndex":number}`;
}

export interface StyleInferDraft {
  label: string;
  description: string;
  rules: string[];
  bannedPatterns: string[];
  exemplar: string;
  counterExemplar: string;
}

/**
 * Converts model output into a draft whose exemplar/counterExemplar are verbatim substrings of the
 * submitted samples. Returns null when the indices cannot satisfy that contract.
 */
export function materializeStyleInferDraft(input: StyleInferRequest, output: StyleInferModelOutput): StyleInferDraft | null {
  const samples = input.samples.map(sample => String(sample).trim()).filter(Boolean);
  const pick = (index: number) => (Number.isInteger(index) && index >= 0 && index < samples.length ? samples[index] : '');
  const exemplar = pick(output.exemplarIndex);
  if (!exemplar) return null;
  const counter = input.counterExemplar?.trim() || pick(output.counterExemplarIndex);
  if (!counter) return null;
  return {
    label: output.label,
    description: output.description,
    rules: output.rules,
    bannedPatterns: output.bannedPatterns,
    exemplar,
    counterExemplar: counter
  };
}
