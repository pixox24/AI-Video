import { CastCandidate, VisualCharacterKind } from '../types';

const EN_STOP = new Set([
  'the', 'story', 'of', 'and', 'or', 'a', 'an', 'to', 'in', 'on', 'for', 'with', 'from',
  'this', 'that', 'these', 'those', 'you', 'your', 'our', 'how', 'why', 'what', 'when',
  'little', 'big', 'new', 'old', 'true', 'real', 'one', 'two', 'three'
]);

const CREATURE_EN = [
  'crocodile', 'rabbit', 'bunny', 'hare', 'fox', 'wolf', 'bear', 'cat', 'dog', 'mouse',
  'lion', 'tiger', 'dragon', 'bird', 'fish', 'frog', 'snake', 'turtle', 'monkey', 'panda',
  'duck', 'goose', 'pig', 'horse', 'deer', 'owl'
];

const CREATURE_ZH = [
  '鳄鱼', '兔子', '小白兔', '白兔', '狐狸', '狼', '熊', '猫', '狗', '老鼠',
  '狮子', '老虎', '龙', '鸟', '鱼', '青蛙', '蛇', '乌龟', '猴子', '熊猫',
  '鸭子', '鹅', '猪', '马', '鹿', '猫头鹰'
];

const OBJECT_HINT = /产品|商品|包装|瓶|盒|仪器|手机|app|品牌/i;

function slugCandidate(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '');
  return `cand-${slug || index + 1}`;
}

function splitSentences(text: string): string[] {
  return String(text || '')
    .split(/[。！？!?；;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function countMentions(haystack: string, name: string): number {
  const source = haystack.toLowerCase();
  const needle = name.toLowerCase();
  if (!needle) return 0;
  if (/[\u4e00-\u9fff]/.test(name)) {
    let count = 0;
    let from = 0;
    while (from <= source.length) {
      const at = source.indexOf(needle, from);
      if (at < 0) break;
      count += 1;
      from = at + needle.length;
    }
    return count;
  }
  const re = new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  return (haystack.match(re) || []).length;
}

function evidenceFor(name: string, sentences: string[]): string[] {
  const lower = name.toLowerCase();
  return sentences.filter((sentence) => sentence.toLowerCase().includes(lower)).slice(0, 3);
}

function inferKind(name: string): VisualCharacterKind {
  const lower = name.toLowerCase();
  if (CREATURE_EN.some((word) => lower.includes(word)) || CREATURE_ZH.some((word) => name.includes(word))) {
    return 'creature';
  }
  if (OBJECT_HINT.test(name)) return 'object';
  return 'person';
}

function englishProperNames(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,4}\b/g) || [];
  return matches.filter((name) => {
    const words = name.split(/\s+/);
    const meaningful = words.filter((word) => !EN_STOP.has(word.toLowerCase()));
    return meaningful.length > 0 && name.length >= 3;
  });
}

function titleCaseName(name: string): string {
  if (/[\u4e00-\u9fff]/.test(name)) return name;
  return name.replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
}

function chineseNames(text: string): string[] {
  const named = [...text.matchAll(/(?:叫|名叫|名字是)([\u4e00-\u9fa5]{2,6})/g)].map((match) => match[1]);
  const creatures = CREATURE_ZH.filter((word) => text.includes(word));
  return [...named, ...creatures];
}

function creatureNames(text: string): string[] {
  const lower = text.toLowerCase();
  const english = CREATURE_EN.filter((word) => new RegExp(`\\b${word}s?\\b`, 'i').test(lower)).map(titleCaseName);
  const chinese = CREATURE_ZH.filter((word) => text.includes(word));
  return [...english, ...chinese];
}

function notesBoost(notes: string): boolean {
  return /拟人|角色|主角|人物|动物|故事/.test(notes);
}

export function extractCastCandidates(input: {
  narration?: string;
  title?: string;
  intentNotes?: string;
}): CastCandidate[] {
  const title = String(input.title || '').trim();
  const notes = String(input.intentNotes || '').trim();
  const narration = String(input.narration || '').trim();
  const corpus = [title, notes, narration].filter(Boolean).join('\n');
  if (!corpus) return [];

  const sentences = splitSentences(corpus);
  const rawNames = [
    ...englishProperNames(title),
    ...englishProperNames(narration),
    ...englishProperNames(notes),
    ...chineseNames(title),
    ...chineseNames(notes),
    ...chineseNames(narration),
    ...creatureNames(corpus)
  ];

  const merged = new Map<string, string>();
  for (const name of rawNames) {
    const key = name.replace(/\s+/g, ' ').trim();
    if (!key) continue;
    const id = key.toLowerCase();
    const overlap = [...merged.entries()].find(([existing]) => existing.includes(id) || id.includes(existing));
    if (overlap) {
      if (key.length > overlap[1].length) {
        merged.delete(overlap[0]);
        merged.set(id, key);
      }
      continue;
    }
    const prev = merged.get(id);
    if (!prev || key.length > prev.length) merged.set(id, key);
  }

  const personify = notesBoost(notes);
  const out: CastCandidate[] = [];
  let index = 0;
  for (const name of merged.values()) {
    const mentions = countMentions(corpus, name);
    const inTitle = title.toLowerCase().includes(name.toLowerCase()) || title.includes(name);
    const inNotes = notes.toLowerCase().includes(name.toLowerCase()) || notes.includes(name);
    const kind = inferKind(name);
    const keep = mentions >= 2 || inTitle || inNotes || (personify && kind === 'creature' && mentions >= 1);
    if (!keep) continue;
    const evidence = evidenceFor(name, sentences);
    out.push({
      id: slugCandidate(name, index),
      name,
      kind,
      mentions: Math.max(mentions, inTitle || inNotes ? 1 : 0),
      evidence: evidence.length ? evidence : [inTitle ? title : inNotes ? notes : name],
      inTitle,
      inNotes
    });
    index += 1;
  }

  return out
    .sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.mentions - a.mentions)
    .slice(0, 6);
}

export function candidateByName(candidates: CastCandidate[], name: string): CastCandidate | null {
  const needle = (name || '').trim().toLowerCase();
  if (!needle) return null;
  return candidates.find((item) => {
    const hay = item.name.toLowerCase();
    return hay === needle || hay.includes(needle) || needle.includes(hay);
  }) || null;
}

export function formatCandidatesForPrompt(candidates: CastCandidate[]): string {
  if (!candidates.length) {
    return '【文案实体硬约束】未识别到可指认主体。characters 必须输出 []，不得新增讲解员、女孩、用户或其他主角。';
  }
  const lines = candidates.map((item) => (
    `- ${item.id} 「${item.name}」（${item.kind}，出现 ${item.mentions} 次）${item.evidence[0] ? ` 证据：${item.evidence[0]}` : ''}`
  ));
  return [
    '【文案实体硬约束】角色只能从下列候选认领，不得发明名单外的人/动物/产品。',
    '每张卡必须带 sourceEvidence（原文短句）和 candidateId。',
    '没有把握就不要建卡。拟人动物用 kind=creature，产品用 kind=object。',
    ...lines
  ].join('\n');
}
