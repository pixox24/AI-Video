/**
 * 临时 mock LLM（OpenAI 兼容 /chat/completions），仅用于本地端到端验证。
 * 支持两类请求：
 * 1. 翻译（提取 id=/中文： 对，返回带序号英文）
 * 2. 写稿（识别 fullNarration/beats 提示，按【题目】生成中文口播+节拍）
 */
const http = require('node:http');

const WORDS = ['love', 'fades', 'daily', 'proof', 'care', 'time', 'hearts', 'choose', 'closer', 'always', 'small', 'moments', 'keep', 'warm', 'trust', 'slowly'];

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function buildTranslations(userMsg) {
  const pairs = [];
  const re = /id=([^\s\n]+)\n中文：([^\n]+)/g;
  let m;
  while ((m = re.exec(userMsg)) !== null) pairs.push({ id: m[1], zh: m[2].trim() });
  return pairs.map((p, i) => {
    const zhChars = (p.zh.match(/[\u4e00-\u9fa5]/g) || []).length || p.zh.length;
    const count = clamp(Math.round(zhChars * 0.35), 3, 16);
    const words = [];
    for (let k = 0; k < count; k++) words.push(WORDS[(i + k) % WORDS.length]);
    return { id: p.id, en: `Take ${i + 1}: ${words.join(' ')}` };
  });
}

function buildDraft(userMsg) {
  const titleMatch = userMsg.match(/【题目】([^\n]+)/);
  const title = (titleMatch ? titleMatch[1] : '这个话题').trim().slice(0, 24);
  const beats = [
    { id: 'b1', order: 1, function: 'hook', intent: '抛出反常识问题', narration: `${title}，大多数人都想反了。`, energy: 'fast', visualIntent: '主角转身面对镜头，眉头一挑', needsHold: false },
    { id: 'b2', order: 2, function: 'setup', intent: '给出常见误区', narration: '我们总以为努力堆时间就一定有结果，可现实往往不是这样。', energy: 'medium', visualIntent: '主角伏案工作，墙上时钟快转', needsHold: false },
    { id: 'b3', order: 3, function: 'turn', intent: '翻转认知', narration: '真正拉开差距的，是那些看起来毫不起眼的小选择。', energy: 'medium', visualIntent: '特写手指在两个按钮之间停顿', needsHold: true },
    { id: 'b4', order: 4, function: 'proof', intent: '给出证据', narration: '研究发现，持续的微小改进，一年后会被放大三十七倍。', energy: 'fast', visualIntent: '屏幕上曲线缓缓上扬的图表', needsHold: false },
    { id: 'b5', order: 5, function: 'cta', intent: '收束行动', narration: '从今天起，每天进步一点点，评论区立个字据，我们一起来。', energy: 'slow', visualIntent: '主角合上笔记本，对镜头点头', needsHold: false }
  ];
  return {
    title,
    fullNarration: beats.map((b) => b.narration).join(''),
    beats
  };
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !/\/chat\/completions$/.test(req.url || '')) {
    res.writeHead(404).end('not found');
    return;
  }
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const userMsg = (body.messages || []).filter((m) => m.role === 'user').map((m) => m.content || '').join('\n');
    let content;
    if (/fullNarration/.test(userMsg) && /beats/.test(userMsg)) {
      content = JSON.stringify(buildDraft(userMsg));
    } else {
      content = JSON.stringify({ items: buildTranslations(userMsg) });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }] }));
    console.log(`[mock-llm] ${/fullNarration/.test(userMsg) ? 'draft' : 'translate'} served`);
  });
});

server.listen(3002, '127.0.0.1', () => console.log('mock LLM on http://127.0.0.1:3002/v1'));
