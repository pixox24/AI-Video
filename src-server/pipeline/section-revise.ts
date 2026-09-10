import { BEAT_FUNCTIONS, normalizeBeatFunction } from '../../src/utils/scriptSections';
import { z } from 'zod';
import type { ScriptBrief, ScriptSection, ScriptRevisionAction, ScriptOutlineSection, ScriptLanguage } from '../../src/types';
import { mergeSectionIntoWorkspaceSections } from '../../src/utils/scriptOutline';
import { SECTION_REVISE_SYSTEM, sectionReviseUserPrompt } from '../../src/utils/scriptPrompts';
import { generateStructured } from '../llm/gateway';
import { LLM_LONGFORM_MAX_TOKENS, llmTimeoutMsForSeconds } from '../../src/utils/scriptDuration';
import { toLoose, toLooseList } from '../loose';
import { splitCoversSource } from '../../src/utils/scriptSplit';

const revisionSchema = z.object({ narration: z.string().trim().min(1), usedEvidenceIds: z.array(z.string()),
  beats: z.array(z.object({ id: z.string().optional(), order: z.number().optional(), function: z.unknown().optional().describe(`节拍标签，优先使用 ${BEAT_FUNCTIONS.join(', ')}；标签异常会在本地修正`),
    intent: z.string(), narration: z.string(), energy: z.enum(['fast','medium','slow','hold']), visualIntent: z.string(), needsHold: z.boolean()
  }).strict()).min(1)
}).strict();
export type RevisionInput = { sections: ScriptSection[]; planned?: Pick<ScriptOutlineSection, 'status' | 'minUnits' | 'maxUnits'>;
  action: ScriptRevisionAction; language: ScriptLanguage; brief: ScriptBrief; targetSeconds: number; llmApi?: unknown; strict?: boolean; projectId?: string };
export type RevisionResult = { status: number; section?: ScriptSection; sections: ScriptSection[]; code?: string; error?: string };

/** One implementation shared by the existing endpoint and the quality loop. */
export async function executeSectionRevision(input: RevisionInput): Promise<RevisionResult> {
  const { sections, action, planned } = input;
  const current = sections.find(s => String(s.id) === String(action.sectionId));
  if (!current) return { status: 400, sections, error: '找不到要修订的章节。' };
  if (current.status === 'locked' || planned?.status === 'locked') return { status: 409, sections, code: 'draft_contract_failed', error: '锁定章节不会被自动回修。' };
  try {
    const result = await generateStructured({ stage: 'section_revise', role: 'drafter', clientLlmApi: input.llmApi,
      schema: input.strict ? revisionSchema : undefined, projectId: input.projectId, system: SECTION_REVISE_SYSTEM,
      user: sectionReviseUserPrompt({ language: input.language, section: { title: current.title, narration: current.narration,
        minUnits: planned?.minUnits || current.minUnits, maxUnits: planned?.maxUnits || current.maxUnits }, action,
        unitName: input.language === 'en' ? '词' : '字', brief: input.brief }),
      temperature: 0.4, timeoutMs: llmTimeoutMsForSeconds(input.targetSeconds), maxTokens: LLM_LONGFORM_MAX_TOKENS });
    const parsed = toLoose(result.data);
    const narration = String(parsed.narration || '').trim();
    if (!narration) return { status: 503, sections, code: 'llm_response_invalid', error: '修订结果没有口播。' };
    if (!splitCoversSource(toLooseList(parsed.beats).map(b => String(b.narration || '')), narration)) {
      return { status: 503, sections, code: 'draft_contract_failed', error: '修订节拍未覆盖本章口播。' };
    }
    const beatLabelWarnings: string[] = [];
    const section: ScriptSection = { ...current, narration, status: 'ready', beatLabelWarnings,
      beats: Array.isArray(parsed.beats) && parsed.beats.length ? toLooseList(parsed.beats).map((beat, index) => {
        const label = normalizeBeatFunction(beat.function, current.role);
        if (label.warning) beatLabelWarnings.push(`第 ${current.order} 章第 ${index + 1} 个节拍：${label.warning}`);
        return ({
        ...(current.beats?.[index] || {}), id: `${current.id}-beat-${index + 1}`, order: index + 1,
        function: label.function,
        intent: String(beat.intent || current.beats?.[index]?.intent || ''), narration: String(beat.narration || '').trim(),
        visualIntent: String(beat.visualIntent || current.beats?.[index]?.visualIntent || ''),
        energy: (beat.energy || current.beats?.[index]?.energy || 'medium') as ScriptSection['beats'][number]['energy'],
        needsHold: Boolean(beat.needsHold), sectionId: current.id, targetSeconds: current.targetSeconds
      }); }) : current.beats };
    return { status: 200, section, sections: mergeSectionIntoWorkspaceSections(sections, section) };
  } catch (error: unknown) { return { status: 503, sections, code: 'llm_response_invalid', error: error instanceof Error ? error.message : '章节回修失败。' }; }
}
