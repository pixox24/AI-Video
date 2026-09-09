import {
  BeatFunction,
  ScriptBeat,
  ScriptLanguage,
  ScriptSection,
  ScriptSectionRole,
  ShotEnergy
} from '../types';
import { countBudgetUnits, normalizeScriptLanguage } from './scriptLanguage';
import { scriptFormForSeconds, usesSectionWorkflow } from './scriptDuration';
import { splitCompleteSentences } from './speechSpans';

function intentFor(fn: BeatFunction): string {
  switch (fn) {
    case 'hook': return '前 3 秒制造缺口';
    case 'setup': return '为什么要看下去';
    case 'turn': return '转折 / 误解被拆';
    case 'proof': return '例子或机制';
    case 'reveal': return '关键一句';
    case 'cta': return '收束或行动';
    default: return '';
  }
}

export interface ScriptSectionPlan {
  id: string;
  order: number;
  role: ScriptSectionRole;
  title: string;
  targetSeconds: number;
  targetUnits: number;
  minUnits: number;
  maxUnits: number;
  beatFunctions: BeatFunction[];
}

const ROLE_WEIGHT: Record<ScriptSectionRole, number> = {
  hook: 1,
  setup: 1.4,
  body: 2.4,
  turn: 1.2,
  proof: 2,
  reveal: 1.2,
  cta: 1
};

const ROLE_TITLE: Record<ScriptSectionRole, string> = {
  hook: '开场钩子',
  setup: '铺垫',
  body: '展开',
  turn: '转折',
  proof: '证据 / 步骤',
  reveal: '关键一句',
  cta: '收束'
};

function rolesForDuration(seconds: number, genre?: string | null, formInput?: import('../types').ScriptForm | null): ScriptSectionRole[] {
  const narrative = /故事|情绪|story|narrative|emotion/i.test(String(genre || ''));
  const form = formInput || scriptFormForSeconds(seconds);
  if (form === 'extended' || seconds >= 601) {
    return narrative
      ? ['hook', 'setup', 'body', 'turn', 'body', 'proof', 'body', 'turn', 'reveal', 'cta']
      : ['hook', 'setup', 'body', 'body', 'body', 'turn', 'proof', 'body', 'reveal', 'cta'];
  }
  if (form === 'long' || seconds >= 181) {
    if (seconds >= 300) {
      return narrative
        ? ['hook', 'setup', 'body', 'turn', 'body', 'proof', 'reveal', 'cta']
        : ['hook', 'setup', 'body', 'body', 'turn', 'proof', 'reveal', 'cta'];
    }
    return narrative
      ? ['hook', 'setup', 'body', 'turn', 'body', 'reveal', 'cta']
      : ['hook', 'setup', 'body', 'body', 'proof', 'reveal', 'cta'];
  }
  if (seconds >= 120) {
    return narrative
      ? ['hook', 'setup', 'body', 'turn', 'reveal', 'cta']
      : ['hook', 'setup', 'body', 'proof', 'reveal', 'cta'];
  }
  if (seconds >= 90) {
    return narrative
      ? ['hook', 'setup', 'turn', 'cta']
      : ['hook', 'setup', 'body', 'proof', 'cta'];
  }
  return narrative
    ? ['hook', 'setup', 'reveal', 'cta']
    : ['hook', 'setup', 'body', 'cta'];
}

function chapterUnitWindow(units: number, role: ScriptSectionRole): { minUnits: number; maxUnits: number } {
  if (role === 'hook' || role === 'cta') {
    return {
      minUnits: Math.max(8, Math.ceil(units * 0.5)),
      maxUnits: Math.max(24, Math.ceil(units * 1.25), Math.round(units) + 12)
    };
  }
  return {
    minUnits: Math.max(8, Math.ceil(units * 0.9)),
    maxUnits: Math.max(8, Math.ceil(units * 1.05))
  };
}

function beatsForRole(role: ScriptSectionRole): BeatFunction[] {
  switch (role) {
    case 'hook': return ['hook'];
    case 'setup': return ['setup'];
    case 'body': return ['proof'];
    case 'turn': return ['turn'];
    case 'proof': return ['proof'];
    case 'reveal': return ['reveal'];
    case 'cta': return ['cta'];
    default: return ['setup'];
  }
}

function energyForRole(role: ScriptSectionRole): ShotEnergy {
  if (role === 'hook' || role === 'turn') return 'fast';
  if (role === 'cta') return 'hold';
  if (role === 'reveal') return 'slow';
  return 'medium';
}

export function planScriptSections(input: {
  targetSeconds: number;
  maxChars: number;
  genre?: string | null;
  form?: import('../types').ScriptForm | null;
}): ScriptSectionPlan[] {
  const seconds = Math.max(8, Number(input.targetSeconds) || 30);
  const maxChars = Math.max(8, Number(input.maxChars) || 80);
  const form = input.form || scriptFormForSeconds(seconds);
  const roles = rolesForDuration(seconds, input.genre, form);
  const weightSum = roles.reduce((sum, role) => sum + ROLE_WEIGHT[role], 0) || 1;
  const hookMax = form === 'extended' ? 12 : 8;
  const ctaMax = form === 'extended' ? 14 : 10;
  const desired = roles.map((role) => Math.max(3, seconds * (ROLE_WEIGHT[role] / weightSum)));
  let overflow = 0;
  const capped = desired.map((value, index) => {
    const role = roles[index];
    if (role === 'hook' && value > hookMax) {
      overflow += value - hookMax;
      return hookMax;
    }
    if (role === 'cta' && value > ctaMax) {
      overflow += value - ctaMax;
      return ctaMax;
    }
    return value;
  });
  const expandable = roles
    .map((role, index) => (role === 'body' || role === 'proof' || role === 'setup' || role === 'turn' ? index : -1))
    .filter((index) => index >= 0);
  if (overflow > 0 && expandable.length > 0) {
    const extra = overflow / expandable.length;
    expandable.forEach((index) => {
      capped[index] += extra;
    });
  }
  let usedSeconds = 0;
  let usedUnits = 0;
  return roles.map((role, index) => {
    const last = index === roles.length - 1;
    const targetSeconds = last
      ? Math.max(3, Math.round((seconds - usedSeconds) * 10) / 10)
      : Math.max(3, Math.round(capped[index] * 10) / 10);
    const share = targetSeconds / Math.max(1, seconds);
    const units = last
      ? Math.max(8, maxChars - usedUnits)
      : Math.max(8, Math.round(maxChars * share));
    usedSeconds += targetSeconds;
    usedUnits += units;
    const window = chapterUnitWindow(units, role);
    const order = index + 1;
    return {
      id: `section-${order}`,
      order,
      role,
      title: ROLE_TITLE[role] + (role === 'body' && roles.filter((item) => item === 'body').length > 1
        ? ` ${roles.slice(0, index + 1).filter((item) => item === 'body').length}`
        : ''),
      targetSeconds,
      targetUnits: units,
      minUnits: window.minUnits,
      maxUnits: window.maxUnits,
      beatFunctions: beatsForRole(role)
    };
  });
}

export function emptySectionFromPlan(plan: ScriptSectionPlan): ScriptSection {
  const beats: ScriptBeat[] = plan.beatFunctions.map((fn, index) => ({
    id: `${plan.id}-beat-${index + 1}`,
    order: index + 1,
    function: fn,
    intent: intentFor(fn),
    narration: '',
    targetSeconds: plan.targetSeconds / Math.max(1, plan.beatFunctions.length),
    energy: energyForRole(plan.role),
    visualIntent: '',
    needsHold: fn === 'cta' || fn === 'reveal',
    sectionId: plan.id
  }));
  return {
    id: plan.id,
    order: plan.order,
    role: plan.role,
    title: plan.title,
    outline: '',
    targetSeconds: plan.targetSeconds,
    minUnits: plan.minUnits,
    maxUnits: plan.maxUnits,
    narration: '',
    beats
  };
}

export function joinSectionNarrations(sections: Array<{ narration?: string }>, language?: ScriptLanguage): string {
  const lang = normalizeScriptLanguage(language);
  const glue = lang === 'en' ? ' ' : '';
  return sections
    .map((section) => (section.narration || '').trim())
    .filter(Boolean)
    .join(glue);
}

export function flattenSectionBeats(sections: ScriptSection[]): ScriptBeat[] {
  const beats: ScriptBeat[] = [];
  sections.forEach((section) => {
    (section.beats || []).forEach((beat) => {
      if (!(beat.narration || '').trim()) return;
      beats.push({
        ...beat,
        id: beat.id || `${section.id}-beat-${beats.length + 1}`,
        sectionId: section.id,
        order: beats.length + 1
      });
    });
  });
  return beats.map((beat, index) => ({ ...beat, order: index + 1 }));
}

export function beatsFromSectionPlans(
  narration: string,
  plans: ScriptSectionPlan[],
  language?: ScriptLanguage
): ScriptBeat[] {
  const lang = normalizeScriptLanguage(language);
  const sentences = splitCompleteSentences(narration, lang, { keepShort: true });
  if (sentences.length === 0 || plans.length === 0) return [];
  const total = Math.max(1, countBudgetUnits(narration, lang));
  const assigned: string[][] = plans.map(() => []);
  let cursor = 0;
  let planIndex = 0;
  let consumed = 0;
  const quotas = plans.map((plan) => Math.max(1, plan.maxUnits));
  const quotaSum = quotas.reduce((sum, value) => sum + value, 0) || 1;
  const ends = plans.map((_, index) => Math.round((quotas.slice(0, index + 1).reduce((sum, value) => sum + value, 0) / quotaSum) * total));
  sentences.forEach((sentence) => {
    const units = Math.max(1, countBudgetUnits(sentence, lang));
    const mid = consumed + units / 2;
    while (planIndex < ends.length - 1 && mid > ends[planIndex]) planIndex += 1;
    assigned[planIndex].push(sentence);
    consumed += units;
    cursor = planIndex;
  });
  void cursor;
  return plans.map((plan, index) => {
    const fn = plan.beatFunctions[0] || 'setup';
    const text = assigned[index].join(lang === 'en' ? ' ' : '');
    return {
      id: `${plan.id}-beat-1`,
      order: index + 1,
      function: fn,
      intent: intentFor(fn),
      narration: text,
      targetSeconds: plan.targetSeconds,
      energy: energyForRole(plan.role),
      visualIntent: '',
      needsHold: fn === 'cta' || fn === 'reveal',
      sectionId: plan.id
    };
  }).filter((beat) => beat.narration);
}

export function sectionsFromNarration(input: {
  narration: string;
  targetSeconds: number;
  maxChars: number;
  scriptLanguage?: ScriptLanguage;
  genre?: string | null;
}): ScriptSection[] {
  const lang = normalizeScriptLanguage(input.scriptLanguage);
  const plans = planScriptSections({
    targetSeconds: input.targetSeconds,
    maxChars: input.maxChars,
    genre: input.genre
  });
  const beats = beatsFromSectionPlans(input.narration, plans, lang);
  return plans.map((plan) => {
    const beat = beats.find((item) => item.sectionId === plan.id);
    return {
      ...emptySectionFromPlan(plan),
      narration: beat?.narration || '',
      beats: beat ? [{ ...beat, order: 1 }] : emptySectionFromPlan(plan).beats
    };
  });
}

export function shouldUseSections(targetSeconds: number, sentenceCount = 0): boolean {
  return usesSectionWorkflow(scriptFormForSeconds(targetSeconds)) || sentenceCount > 12;
}

export function uniqueSceneCount(shots: Array<{ sceneId?: string }>): number {
  const ids = new Set(shots.map((shot) => shot.sceneId).filter(Boolean));
  return ids.size || shots.length;
}
