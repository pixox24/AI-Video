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
  '鳄鱼', '森蚺', '蚺', '巨嘴鸟', '兔子', '小白兔', '白兔', '狐狸', '狼', '熊', '猫', '狗', '老鼠',
  '狮子', '老虎', '龙', '鸟', '鱼', '青蛙', '蛇', '乌龟', '猴子', '熊猫',
  '鸭子', '鹅', '猪', '马', '鹿', '猫头鹰'
];

/** 常见可食用动物 / 菜肴主料：在教程语境中它们是被加工对象，不是叙事角色。 */
const FOOD_CREATURE_EN = [
  'salmon', 'fish', 'shrimp', 'crab', 'lobster', 'chicken', 'duck', 'goose', 'pig', 'pork',
  'beef', 'steak', 'lamb', 'bacon', 'ham', 'sausage', 'turkey', 'eel', 'octopus', 'squid',
  'oyster', 'mussel', 'scallop', 'frog', 'snake', 'rabbit'
];

const FOOD_CREATURE_ZH = [
  '三文鱼', '三文鱼排', '鱼排', '鱼', '鲜鱼', '生鱼片', '虾', '大虾', '基围虾', '蟹', '大闸蟹',
  '龙虾', '鸡', '鸡翅', '鸡腿', '鸡胸', '鸭', '鹅', '猪', '排骨', '五花肉', '牛肉', '牛排',
  '羊肉', '羊排', '培根', '火腿', '香肠', '腊肉', '火鸡', '牛蛙', '青蛙', '蛇', '兔肉', '肉'
];

/** 教程/菜谱操作语境信号：这些词出现时，动物名词极可能是食材。 */
const FOOD_PROCESS_ZH = [
  '煎', '炸', '炒', '煮', '蒸', '烤', '炖', '焖', '烧', '卤', '腌', '拌', '焯', '切', '片',
  '剁', '翻面', '下锅', '热锅', '冷油', '油温', '水分', '擦干', '吸水', '定型', '入味', '收汁',
  '黄油', '橄榄油', '食用油', '平底锅', '烤箱', '蒜末', '姜', '葱', '料酒', '生抽', '老抽',
  '盐', '糖', '胡椒', '柠檬汁', '淀粉', '大火', '中火', '小火', '装盘', '盛出', '上桌'
];

const OBJECT_HINT = /产品|商品|包装|瓶|盒|仪器|手机|app|品牌|榨汁机|口红|指南针|便利店/i;

/** 常见中文姓：动作用人名必须命中，避免「针不停」「着条码」这类误召回。 */
const ZH_SURNAMES = new Set([
  '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '韩', '杨',
  '朱', '秦', '尤', '许', '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏', '陶', '姜',
  '戚', '谢', '邹', '喻', '柏', '水', '窦', '章', '云', '苏', '潘', '葛', '奚', '范', '彭', '郎',
  '鲁', '韦', '昌', '马', '苗', '凤', '花', '方', '俞', '任', '袁', '柳', '鲍', '史', '唐', '费',
  '廉', '岑', '薛', '雷', '贺', '倪', '汤', '滕', '殷', '罗', '毕', '郝', '邬', '安', '常', '乐',
  '于', '时', '傅', '皮', '卞', '齐', '康', '伍', '余', '元', '卜', '顾', '孟', '平', '黄', '和',
  '穆', '萧', '尹', '姚', '邵', '湛', '汪', '祁', '毛', '禹', '狄', '米', '贝', '明', '臧', '计',
  '伏', '成', '戴', '谈', '宋', '茅', '庞', '熊', '纪', '舒', '屈', '项', '祝', '董', '梁', '杜',
  '阮', '蓝', '闵', '席', '季', '麻', '强', '贾', '路', '娄', '危', '江', '童', '颜', '郭', '梅',
  '盛', '林', '刁', '钟', '徐', '邱', '骆', '高', '夏', '蔡', '田', '樊', '胡', '凌', '霍', '虞',
  '万', '支', '柯', '昝', '管', '卢', '莫', '经', '房', '裘', '缪', '干', '解', '应', '宗', '丁',
  '宣', '贲', '邓', '郁', '单', '杭', '洪', '包', '诸', '左', '石', '崔', '吉', '钮', '龚', '程',
  '嵇', '邢', '滑', '裴', '陆', '荣', '翁', '荀', '羊', '於', '惠', '甄', '曲', '家', '封', '芮',
  '羿', '储', '靳', '汲', '邴', '糜', '松', '井', '段', '富', '巫', '乌', '焦', '巴', '弓', '牧',
  '隗', '山', '谷', '车', '侯', '宓', '蓬', '全', '郗', '班', '仰', '秋', '仲', '伊', '宫', '宁',
  '仇', '栾', '暴', '甘', '钭', '厉', '戎', '祖', '武', '符', '刘', '景', '詹', '束', '龙', '叶',
  '幸', '司', '韶', '郜', '黎', '蓟', '薄', '印', '宿', '白', '怀', '蒲', '邰', '从', '鄂', '索',
  '咸', '籍', '赖', '卓', '蔺', '屠', '蒙', '池', '乔', '阴', '胥', '能', '苍', '双', '闻', '莘',
  '党', '翟', '谭', '贡', '劳', '逄', '姬', '申', '扶', '堵', '冉', '宰', '郦', '雍', '却', '璩',
  '桑', '桂', '濮', '牛', '寿', '通', '边', '扈', '燕', '冀', '郏', '浦', '尚', '农', '温', '别',
  '庄', '晏', '柴', '瞿', '阎', '充', '慕', '连', '茹', '习', '宦', '艾', '鱼', '容', '向', '古',
  '易', '慎', '戈', '廖', '庾', '终', '暨', '居', '衡', '步', '都', '耿', '满', '弘', '匡', '国',
  '文', '寇', '广', '禄', '阙', '东', '欧', '殳', '沃', '利', '蔚', '越', '夔', '隆', '师', '巩',
  '厍', '聂', '晁', '勾', '敖', '融', '冷', '訾', '辛', '阚', '那', '简', '饶', '空', '曾', '毋',
  '沙', '乜', '养', '鞠', '须', '丰', '巢', '关', '蒯', '相', '查', '后', '荆', '红', '游', '竺',
  '权', '逯', '盖', '益', '桓', '公', '万俟', '司马', '上官', '欧阳', '夏侯', '诸葛', '东方', '赫连'
]);

const ZH_NAME_STOP = new Set([
  '亚马逊', '丛林', '瀑布', '夜里', '第二天', '指南针', '手机', '口红', '便利店', '收银员',
  '袋子', '果汁', '婚宴', '婚礼', '新郎', '新娘', '西装', '草帽', '条码', '叶子', '蘑菇',
  '绿色', '环保', '信号', '东西', '嗓子', '出口', '后面', '两人', '他们', '我们', '自己',
  '突然', '平静', '平静地', '最后', '不够', '已经', '发现', '参加', '冲进', '看着', '长出', '变成',
  '打转', '指向', '迷了', '交出', '掏出', '递上', '摇头', '飞来', '说出口', '便利', '商店',
  '逊丛林', '针不停', '子请去', '着条码', '不停打', '请去参'
]);

/** 仅保留强人物动作，避免「参加/发现」吞掉前后杂词。 */
const PERSON_ACTION_ZH =
  '迷了路|迷了|掏出|递上|看着|喝了|打了个|打了|变成|长出|冲进|说|问|答|喊|跑|走|冲|掏|递|喝|看';

const SINGLE_CHAR_CREATURES = new Set(['鸟', '鱼', '蛇', '猫', '狗', '熊', '狼', '龙', '马', '鹿', '鹅', '猪', '蚺']);

const FOOD_PROCESS_ZH_RE = new RegExp(FOOD_PROCESS_ZH.join('|'), 'i');

/** 命中的动物词在教程/操作语境下应视作被加工对象。 */
function isFoodProcessContext(text: string): boolean {
  if (!text) return false;
  return FOOD_PROCESS_ZH_RE.test(text);
}

function isFoodCreature(name: string): boolean {
  const lower = name.toLowerCase();
  if (FOOD_CREATURE_EN.some((word) => lower.includes(word))) return true;
  return FOOD_CREATURE_ZH.some((word) => name.includes(word));
}

/** 完整食物主料名（如「三文鱼」），供合并逻辑吃掉更短的「鱼」。 */
function foodCreatureNames(text: string): string[] {
  const lower = text.toLowerCase();
  const english = FOOD_CREATURE_EN.filter((word) => new RegExp(`\\b${word}s?\\b`, 'i').test(lower)).map(titleCaseName);
  const chinese = FOOD_CREATURE_ZH.filter((word) => text.includes(word));
  return [...english, ...chinese];
}

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

function isCreatureWord(name: string): boolean {
  const lower = name.toLowerCase();
  return CREATURE_EN.some((word) => lower.includes(word)) || CREATURE_ZH.some((word) => name.includes(word));
}

/** 文案里有直接引语/对话动作词时，动物通常是角色（童话/寓言），而非食材。 */
function hasDialogueTone(text: string): boolean {
  if (!text) return false;
  return /["“「『]|说[：:，,]?|问道|回答|喊|叫[他她它]|轻声|笑着说|自言自语/.test(text);
}

function inferKind(name: string, corpus: string, personify = false): VisualCharacterKind {
  if (isCreatureWord(name)) {
    // 用户明示拟人意图，或文案带对话口吻（童话/寓言）时，尊重为角色，不降级为道具。
    if (personify || hasDialogueTone(corpus)) return 'creature';
    // 教程/菜谱/操作语境下，命中的动物大概率是食材（被加工对象），降级为 object。
    if (isFoodCreature(name) && isFoodProcessContext(corpus)) return 'object';
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

function hasChineseSurname(name: string): boolean {
  if (name.length >= 2 && ZH_SURNAMES.has(name.slice(0, 2))) return true;
  return ZH_SURNAMES.has(name[0] || '');
}

function isLikelyChinesePersonName(name: string, requireSurname = false): boolean {
  if (!/^[\u4e00-\u9fa5]{2,3}$/.test(name)) return false;
  if (ZH_NAME_STOP.has(name)) return false;
  if (name.endsWith('地') || name.endsWith('的') || name.endsWith('得')) return false;
  if (isCreatureWord(name) || isFoodCreature(name)) return false;
  if (OBJECT_HINT.test(name)) return false;
  if (/第[一二三四五六七八九十百]+|今天|明天|昨天|现在|然后|接着|于是|因为|所以|但是|如果|虽然/.test(name)) {
    return false;
  }
  if (requireSurname && !hasChineseSurname(name)) return false;
  return true;
}

/** 并列主语：许野和苏黎在… / 许野、苏黎走进… */
function pairedChineseNames(text: string): string[] {
  const names: string[] = [];
  const patterns = [
    /([\u4e00-\u9fa5]{2,3})(?:和|与|跟|同)([\u4e00-\u9fa5]{2,3})(?:在|于|到|去|来|走进|冲进|迷了|发现|看着|被|把)/g,
    /([\u4e00-\u9fa5]{2,3})[、，,]([\u4e00-\u9fa5]{2,3})(?:在|于|到|去|来|走进|冲进|迷了|发现|看着|被|把)/g
  ];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) {
      if (isLikelyChinesePersonName(match[1])) names.push(match[1]);
      if (isLikelyChinesePersonName(match[2])) names.push(match[2]);
    }
  }
  return names;
}

/** 专名 + 人物动作：许野掏出 / 苏黎看着 / 许野喝了一口 */
function actionChineseNames(text: string): string[] {
  const re = new RegExp(`([\\u4e00-\\u9fa5]{2,3})(?:${PERSON_ACTION_ZH})`, 'g');
  return [...text.matchAll(re)]
    .map((match) => match[1])
    .filter((name) => isLikelyChinesePersonName(name, true));
}

/** 「叫/名叫/名字是」显式命名。 */
function explicitChineseNames(text: string): string[] {
  return [...text.matchAll(/(?:叫|名叫|名字是)([\u4e00-\u9fa5]{2,6})/g)]
    .map((match) => match[1])
    .filter((name) => name && !ZH_NAME_STOP.has(name));
}

/** 量词短语里的生物：一只戴草帽的巨嘴鸟 / 一条穿西装的森蚺 / 一群猴子 */
function quantifiedCreatureNames(text: string): string[] {
  const names: string[] = [];
  const re = /(?:一|几|两|三|数)?(?:只|条|头|群|位)([\u4e00-\u9fa5的]{0,16}?)(巨嘴鸟|森蚺|猫头鹰|小白兔|鳄鱼|兔子|狐狸|猴子|熊猫|青蛙|乌龟|鸭子|老鼠|狮子|老虎|白兔|鸟|蛇|猫|狗|熊|狼|龙|鱼|鹅|猪|马|鹿|蚺)/g;
  for (const match of text.matchAll(re)) {
    names.push(match[2]);
  }
  return names;
}

function chineseNames(text: string): string[] {
  return [
    ...explicitChineseNames(text),
    ...pairedChineseNames(text),
    ...actionChineseNames(text)
  ];
}

function chineseCreatureMentions(text: string): string[] {
  const hits: string[] = [];
  for (const word of [...CREATURE_ZH].sort((a, b) => b.length - a.length)) {
    if (!text.includes(word)) continue;
    if (SINGLE_CHAR_CREATURES.has(word)) {
      // 单字动物必须是独立词或量词短语，避免「亚马逊」抽成「马」。
      const re = new RegExp(`(?:一|几|两|三|数)?(?:只|条|头|群|位)[\\u4e00-\\u9fa5的]{0,12}${word}|(?:^|[^\\u4e00-\\u9fa5])${word}(?:$|[^\\u4e00-\\u9fa5])`);
      if (!re.test(text)) continue;
    }
    hits.push(word);
  }
  return hits;
}

function creatureNames(text: string): string[] {
  const lower = text.toLowerCase();
  const english = CREATURE_EN.filter((word) => new RegExp(`\\b${word}s?\\b`, 'i').test(lower)).map(titleCaseName);
  const chinese = [
    ...quantifiedCreatureNames(text),
    ...chineseCreatureMentions(text)
  ];
  return [...english, ...chinese];
}

function notesBoost(notes: string): boolean {
  return /拟人|角色|主角|人物|动物|故事/.test(notes);
}

function firstIndex(haystack: string, name: string): number {
  const at = haystack.toLowerCase().indexOf(name.toLowerCase());
  return at < 0 ? Number.MAX_SAFE_INTEGER : at;
}

function kindRank(kind: VisualCharacterKind): number {
  if (kind === 'person') return 0;
  if (kind === 'creature') return 1;
  return 2;
}

function mergeCandidateNames(rawNames: string[]): string[] {
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
  return [...merged.values()];
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
    ...creatureNames(corpus),
    ...foodCreatureNames(corpus)
  ];

  const personify = notesBoost(notes);
  const foodContext = isFoodProcessContext(corpus);
  const dialogue = hasDialogueTone(corpus);
  const out: CastCandidate[] = [];
  let index = 0;
  for (const name of mergeCandidateNames(rawNames)) {
    const mentions = countMentions(corpus, name);
    const inTitle = title.toLowerCase().includes(name.toLowerCase()) || title.includes(name);
    const inNotes = notes.toLowerCase().includes(name.toLowerCase()) || notes.includes(name);
    const kind = inferKind(name, corpus, personify);
    const personOnce = kind === 'person' && mentions >= 1 && (
      pairedChineseNames(corpus).includes(name)
      || actionChineseNames(corpus).includes(name)
      || explicitChineseNames(corpus).includes(name)
    );
    const speakingCreatureOnce = kind === 'creature' && mentions >= 1 && (dialogue || personify);
    // 操作语境中只出现一次的食物主料也算「被加工对象」候选，供画面圣经锁实物状态。
    const processedFoodOnce = kind === 'object' && foodContext && isFoodCreature(name) && mentions >= 1;
    const keep = mentions >= 2
      || inTitle
      || inNotes
      || personOnce
      || speakingCreatureOnce
      || processedFoodOnce
      || (personify && kind === 'creature' && mentions >= 1);
    if (!keep) continue;
    const evidence = evidenceFor(name, sentences);
    out.push({
      id: slugCandidate(name, index),
      name,
      kind,
      mentions: Math.max(mentions, inTitle || inNotes || personOnce ? 1 : 0),
      evidence: evidence.length ? evidence : [inTitle ? title : inNotes ? notes : name],
      inTitle,
      inNotes
    });
    index += 1;
  }

  return out
    .sort((a, b) => (
      kindRank(a.kind) - kindRank(b.kind)
      || Number(b.inTitle) - Number(a.inTitle)
      || firstIndex(corpus, a.name) - firstIndex(corpus, b.name)
      || b.mentions - a.mentions
    ))
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
    '开场并列出现的人名优先作共同主角（role=lead）；会说话的动物/物件作配角（role=support）。',
    '没有把握就不要建卡。人物/拟人动物才能当角色（kind=person / creature）；kind=object 是被加工对象/道具，禁止拟人化、禁止给表情动作。',
    ...lines
  ].join('\n');
}
