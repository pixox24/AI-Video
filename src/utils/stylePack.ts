import {
  ContemporaryPolicy,
  CustomStyleVisionApiConfig,
  ProjectSettings,
  StyleDna,
  StyleDnaModule,
  StylePack,
  VisualBible,
  VisualContinuity,
  VisualStyle
} from '../types';
import { applyBibleToChineseIntent, stripBiblePrefix } from './visualBible';

export const DEFAULT_STYLE_VISION_API: CustomStyleVisionApiConfig = {
  enabled: false,
  provider: 'bailian',
  endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: '',
  model: 'qwen3.7-plus'
};

export function resolveStyleVisionApi(api?: CustomStyleVisionApiConfig): CustomStyleVisionApiConfig {
  if (!api) return { ...DEFAULT_STYLE_VISION_API };
  return { ...DEFAULT_STYLE_VISION_API, ...api, provider: 'bailian' };
}

export function isStyleVisionReady(api?: CustomStyleVisionApiConfig): boolean {
  const resolved = resolveStyleVisionApi(api);
  return resolved.enabled !== false && Boolean(resolved.apiKey.trim());
}

function pack(
  id: VisualStyle,
  label: string,
  policy: ContemporaryPolicy,
  world: StylePack['world'],
  render: StylePack['render']
): StylePack {
  return {
    id: `preset:${id}`,
    source: 'preset',
    label,
    world,
    render,
    contemporaryPolicy: policy,
    createdAt: 0
  };
}

export const PRESET_STYLE_PACKS: Record<VisualStyle, StylePack> = {
  photorealistic: pack(
    'photorealistic',
    '真实摄影',
    'filter',
    {
      era: '当代真实世界',
      wardrobe: '现代日常服饰，按口播身份来',
      space: '真实室内外空间，自然材质',
      must: ['真实人体比例', '可见的生活道具'],
      dont: ['卡通五官', '明显 CG 塑料感', '扁平贴纸人']
    },
    {
      medium: 'photorealistic photograph',
      lighting: 'natural lighting, high dynamic range',
      lens: '35mm lens, f/1.8, shallow depth of field',
      quality: '8k, ultra detailed, award winning photography'
    }
  ),
  cinematic: pack(
    'cinematic',
    '电影质感',
    'filter',
    {
      era: '题材自带的时代，默认当代',
      wardrobe: '符合角色身份的写实服饰',
      space: '可被院线镜头拍到的真实或戏剧化空间',
      must: ['明确主体', '有前后景的空间'],
      dont: ['插画平涂', '过度霓虹赛博', '表情包贴纸']
    },
    {
      medium: 'cinematic still, 35mm film',
      lighting: 'cinematic lighting, color graded, atmospheric mist',
      lens: 'anamorphic lens, shallow depth of field',
      quality: 'blockbuster movie still, high production value'
    }
  ),
  anime: pack(
    'anime',
    '新海诚风 / 动漫',
    'adapt',
    {
      era: '日系动漫世界',
      wardrobe: '动漫角色服化，线条干净',
      space: '通透天空、细腻背景、生活或校园感场景',
      must: ['动漫五官与发色', '清晰的背景层次'],
      dont: ['写实皮肤毛孔', '实拍街景照片感', '三维塑料人']
    },
    {
      medium: 'Makoto Shinkai style anime art',
      lighting: 'beautiful lighting, sunbeams, volumetric clouds',
      lens: 'dramatic sky composition',
      quality: 'highly detailed background, 4k anime wallpaper'
    }
  ),
  cyberpunk: pack(
    'cyberpunk',
    '赛博朋克 / 未来',
    'adapt',
    {
      era: '近未来夜城',
      wardrobe: '机能服、义体、反光面料',
      space: '霓虹街巷、全息界面、雨夜反光地面',
      must: ['霓虹光源', '未来都市轮廓'],
      dont: ['田园水墨', '乡村土坯', '唐宋袍服作为默认']
    },
    {
      medium: 'cyberpunk concept art',
      lighting: 'neon city lights, volumetric glow, purple and cyan grade',
      lens: 'moody night cinematography',
      quality: 'hyperdetailed sci-fi, rainy reflective street'
    }
  ),
  '3d-render': pack(
    '3d-render',
    '3D三维渲染',
    'filter',
    {
      era: '题材自带的时代，默认当代',
      wardrobe: '三维角色服装，材质可读',
      space: '可被三维渲染的场景与道具',
      must: ['三维体积', '清晰材质'],
      dont: ['2D 线稿当主体', '实拍胶片噪点当主体']
    },
    {
      medium: '3D CGI render, Unreal Engine 5, Octane',
      lighting: 'Pixar Disney style lighting, volumetric lighting',
      lens: 'cinematic CG camera',
      quality: 'ray tracing, smooth textures, high detail'
    }
  ),
  'chinese-ink': pack(
    'chinese-ink',
    '东方水墨 / 国风',
    'adapt',
    {
      era: '写意东方世界',
      wardrobe: '袍服、布鞋，或把当代身份译成写意简化轮廓，不要写实品牌服装',
      space: '留白室内、轩窗屏风、山水或水墨城垣；当代场景要译成对应写意空间',
      must: ['水墨笔触或留白', '东方器物或建筑语言'],
      dont: ['清晰现代品牌', '运动鞋 LOGO', '玻璃幕墙霓虹', '写实地铁广告车厢', '智能手机近景品牌']
    },
    {
      medium: 'traditional Chinese ink wash painting',
      lighting: 'ethereal mist, poetic atmosphere',
      lens: 'scroll-like composition, generous negative space',
      quality: 'watercolor brush strokes, gold foil accents, elegant oriental aesthetics'
    }
  ),
  'vintage-film': pack(
    'vintage-film',
    '复古胶片',
    'filter',
    {
      era: '题材自带的时代，默认当代',
      wardrobe: '符合身份的写实服饰，可带一点 90s 生活感',
      space: '可被胶片拍到的真实空间',
      must: ['胶片色调能成立的现场光'],
      dont: ['HDR 广告质感', '纯矢量平涂', '霓虹赛博作为默认']
    },
    {
      medium: 'vintage 1990s 35mm Kodak Portra 400 film photograph',
      lighting: 'nostalgic warm tones, soft lens flare',
      lens: '35mm documentary lens',
      quality: 'subtle film grain, documentary realism'
    }
  ),
  'vector-art': pack(
    'vector-art',
    '极简矢量插画',
    'filter',
    {
      era: '当代扁平世界',
      wardrobe: '几何简化的现代服饰',
      space: '干净色块场景，少杂物',
      must: ['清晰几何轮廓', '有限配色'],
      dont: ['写实毛孔', '水墨皴法', '复杂实拍纹理']
    },
    {
      medium: 'modern vector illustration, flat art',
      lighting: 'graphic lighting, high contrast',
      lens: 'poster-like composition',
      quality: 'clean lines, elegant palette, Dribbble trending'
    }
  )
};

export function presetStylePack(style: VisualStyle): StylePack {
  return { ...PRESET_STYLE_PACKS[style], createdAt: Date.now() };
}

export function hydrateActiveStylePack(settings?: ProjectSettings | null): StylePack {
  const style = settings?.visualStyle || 'cinematic';
  const pack = settings?.activeStylePack;
  if (pack?.world && pack?.render && pack.label) {
    return pack;
  }
  return presetStylePack(style);
}

export function renderLine(pack: StylePack): string {
  return [pack.render.medium, pack.render.lighting, pack.render.lens, pack.render.quality]
    .map((item) => item.trim())
    .filter(Boolean)
    .join(', ');
}

export const DEFAULT_TRANSFER_MODULES: StyleDnaModule[] = [
  'color',
  'lighting',
  'material',
  'rendering',
  'mood'
];

export const DNA_MODULE_LABEL: Record<StyleDnaModule, string> = {
  color: '色彩',
  lighting: '光影',
  material: '材质',
  rendering: '媒介',
  mood: '情绪',
  lens: '镜头/留白',
  graphic: '图形母题',
  world: '世界观翻译'
};

export function usesStyleDna(pack?: StylePack): boolean {
  return Boolean(pack && pack.source !== 'preset' && pack.dna);
}

export function activeTransferModules(pack: StylePack): StyleDnaModule[] {
  if (pack.transferModules && pack.transferModules.length > 0) return pack.transferModules;
  if (usesStyleDna(pack)) return DEFAULT_TRANSFER_MODULES;
  return [];
}

function joinParts(parts: Array<string | undefined>): string {
  return parts.map((item) => (item || '').trim()).filter(Boolean).join(', ');
}

export function dnaTransferText(pack: StylePack): string {
  const dna = pack.dna;
  if (!dna) return renderLine(pack);
  const mods = new Set(activeTransferModules(pack));
  const chunks: string[] = [];
  if (mods.has('rendering') && dna.rendering) {
    chunks.push(joinParts([dna.rendering.medium, dna.rendering.edgeQuality]));
  }
  if (mods.has('color') && dna.color) {
    const palette = (dna.color.palette || []).filter(Boolean).join(', ');
    chunks.push(joinParts([
      palette ? `color palette ${palette}` : undefined,
      dna.color.ratio ? `color ratio ${dna.color.ratio}` : undefined,
      dna.color.saturation,
      dna.color.contrast
    ]));
  }
  if (mods.has('lighting') && dna.lighting) {
    chunks.push(joinParts([dna.lighting.key, dna.lighting.rim, dna.lighting.shadows, dna.lighting.atmosphere]));
  }
  if (mods.has('lens') && dna.lens) {
    chunks.push(joinParts([dna.lens.camera, dna.lens.depth, dna.lens.negativeSpace]));
  }
  if (mods.has('material') && dna.material) {
    chunks.push(joinParts([dna.material.surface, dna.material.grain]));
  }
  if (mods.has('graphic') && dna.graphic) {
    chunks.push(joinParts([(dna.graphic.motifs || []).join(', '), dna.graphic.typeFeel]));
  }
  if (mods.has('mood') && dna.mood && dna.mood.length > 0) {
    chunks.push(`mood: ${dna.mood.join(', ')}`);
  }
  return chunks.filter(Boolean).join('; ') || renderLine(pack);
}

export function contentLockText(pack: StylePack): string {
  const ignored = (pack.contentToIgnore || []).map((item) => item.trim()).filter(Boolean);
  const list = ignored.length > 0
    ? ignored.join(', ')
    : 'people, clothing, specific objects, architecture, logos, readable text';
  return `Preserve this shot's own subject and scene logic. Do not copy from the style reference: ${list}.`;
}

export function buildVisualPrompt(visualIntent: string, pack: StylePack): string {
  const scene = (visualIntent || '').trim() || 'a clear story beat';
  if (usesStyleDna(pack)) {
    const mods = new Set(activeTransferModules(pack));
    const worldPrefix = mods.has('world')
      ? `${pack.world.era}, ${pack.world.wardrobe}, `
      : '';
    return `${worldPrefix}${scene}. Transfer only the visual system: ${dnaTransferText(pack)}. ${contentLockText(pack)}`;
  }
  return `${scene}, ${renderLine(pack)}`;
}

export function stripStyleRenders(prompt: string): string {
  let next = prompt;
  for (const pack of Object.values(PRESET_STYLE_PACKS)) {
    const line = renderLine(pack);
    if (line && next.includes(line)) next = next.split(line).join('');
    for (const part of [pack.render.medium, pack.render.quality]) {
      if (part && next.includes(part)) next = next.split(part).join('');
    }
  }
  return next.replace(/[,，\s]+$/g, '').replace(/,\s*,/g, ',').trim();
}

export function renderCalibrationSuffix(prompt: string, pack: StylePack): string {
  const existing = prompt.toLowerCase();
  const extras = [pack.render.medium, pack.render.lighting]
    .map((item) => item.trim())
    .filter((item) => item && !existing.includes(item.toLowerCase().slice(0, 18)));
  if (extras.length === 0) return prompt;
  return `${prompt.replace(/[,，\s]+$/g, '')}, ${extras.slice(0, 2).join(', ')}`;
}

export function styleContractForPrompt(pack: StylePack): string {
  if (usesStyleDna(pack)) {
    const mods = activeTransferModules(pack);
    const ignore = (pack.contentToIgnore || []).join('、') || '参考图中的人物、服装、具体物体、建筑、Logo、可读文字';
    const worldBlock = mods.includes('world')
      ? [
          `【世界-时代】${pack.world.era}`,
          `【世界-服饰】${pack.world.wardrobe}`,
          `【世界-空间】${pack.world.space}`
        ]
      : ['【世界】不要把参考图的场景、人物或道具译进新分镜。'];
    return [
      `【风格基因】${pack.label}（来源：上传反推，只迁视觉系统）`,
      `【剥掉的内容】${ignore}`,
      `【开启的模块】${mods.map((id) => DNA_MODULE_LABEL[id]).join('、')}`,
      ...worldBlock,
      `【可迁移 DNA】${dnaTransferText(pack)}`,
      `【内容锁定】每一镜的主体、动作、场景以口播为准，禁止复制参考图里的人、物、建筑、火焰等具体物件。`,
      pack.reference?.notes ? `【介质笔记】${pack.reference.notes}` : ''
    ]
      .filter(Boolean)
      .join('\n');
  }

  const policyHint =
    pack.contemporaryPolicy === 'adapt'
      ? 'adapt：保留口播动作与因果，把场景和服饰译成这个世界能成立的对应物'
      : pack.contemporaryPolicy === 'costume'
        ? 'costume：人仍是当代身份，只换画法，不要改成另一个时代的职业'
        : 'filter：几乎只改画法与光影，不改时代和服饰';

  return [
    `【美术世界】${pack.label}（来源：${pack.source === 'inferred' ? '上传反推' : pack.source === 'hybrid' ? '混合' : '预设'}）`,
    `【世界-时代】${pack.world.era}`,
    `【世界-服饰】${pack.world.wardrobe}`,
    `【世界-空间】${pack.world.space}`,
    `【必须看见】${pack.world.must.join('；')}`,
    `【禁止出现】${pack.world.dont.join('；')}`,
    `【当代题材落地】${policyHint}`,
    `【渲染】${renderLine(pack)}`,
    pack.reference?.notes ? `【参考图】${pack.reference.notes}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export const STYLE_DIRECTOR_SYSTEM =
  '你是短视频画面导演。口播语义不能丢。每一镜的主体、动作和场景以口播为准。若用户给的是风格基因：只迁移色彩、光影、媒介、材质和情绪，禁止把参考图里的人物、服装、道具、建筑、火焰或 Logo 写进新画面。若用户给的是美术世界：服饰、道具、建筑不得出现契约禁止项。禁止用空泛的「电影感」代替具体可见物。不要改口播用词。只输出合法 JSON。旁白必须口语化，且严格不超过字数上限。';

export const STYLE_INFER_SYSTEM = '只输出合法 JSON，不要解释，不要 markdown。先剥离图中的人物与物体，再写可迁移的视觉基因。';

export const STYLE_INFER_USER = `看这张参考图，编译成短视频「风格基因 Style DNA」。
新片子会换成完全不同的主体和故事。禁止把图里的人物、服装、道具、建筑、火焰、Logo、可读文字写进可迁移层。

先填写 content_to_ignore（从图中剥掉、禁止带进新图的东西），再填写 dna。
dna 只写规则：色彩占比、光怎么来、介质、颗粒、留白节奏、2-3 个情绪词。
不要写「必须看见火焰/某人/某件衣服」。must 若出现具体物体视为错误。

只输出 JSON：
{
  "label": "人读短名，形容视觉气质不要形容图中物体",
  "content_to_ignore": ["人物身份", "具体服装", "图中的主体物件", "可识别场景"],
  "dna": {
    "color": { "palette": ["主色", "辅色", "点缀色"], "ratio": "例如 70% 冷暗 / 25% 中性 / 5% 点缀", "saturation": "整体饱和度", "contrast": "对比" },
    "lighting": { "key": "主光方向与软硬", "rim": "轮廓光", "shadows": "阴影密度", "atmosphere": "雾/空气感" },
    "lens": { "camera": "焦段与机位感觉", "depth": "景深", "negativeSpace": "留白方向与主体占比" },
    "material": { "surface": "材质触感", "grain": "颗粒/纸纹/胶片" },
    "rendering": { "medium": "英文媒介关键词", "edgeQuality": "边缘硬软" },
    "graphic": { "motifs": ["可复用装饰，不要图中故事道具"], "typeFeel": "字体气质，没有文字就空" },
    "mood": ["情绪1", "情绪2"]
  },
  "world": null,
  "render": {
    "medium": "与 dna.rendering.medium 相同的英文",
    "lighting": "光的英文短句",
    "lens": "镜头英文短句",
    "quality": "短质量词"
  },
  "contemporaryPolicy": "filter",
  "transfer_defaults": ["color", "lighting", "material", "rendering", "mood"],
  "confidence": 0.0,
  "notes": "只写笔触与气质，一句话"
}

规则：
- 普通照片 / 海报 / 产品图：world 必须为 null，contemporaryPolicy 必须 filter。
- 只有图本身是完整世界观（古画长卷、赛博城概念图）才给 world 对象，且仍要把具体人物列入 content_to_ignore。
- content_to_ignore 至少 3 条，必须是图里实际看到的内容类别。
- palette 至少 3 个色名；mood 2-3 个词；ratio 必须写占比。
- confidence 0 到 1。若分不清内容和风格，给低分。`;

function asStringList(value: unknown, min = 0): string[] {
  const list = Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : typeof value === 'string' && value.trim()
      ? value.split(/[；;、,/]/).map((item) => item.trim()).filter(Boolean)
      : [];
  return list.slice(0, 8);
}

function asDna(raw: unknown, render: Record<string, any>): StyleDna | undefined {
  const src = raw && typeof raw === 'object' ? (raw as Record<string, any>) : {};
  const colorSrc = src.color && typeof src.color === 'object' ? src.color : {};
  const lightingSrc = src.lighting && typeof src.lighting === 'object' ? src.lighting : {};
  const lensSrc = src.lens && typeof src.lens === 'object' ? src.lens : {};
  const materialSrc = src.material && typeof src.material === 'object' ? src.material : {};
  const renderingSrc = src.rendering && typeof src.rendering === 'object' ? src.rendering : {};
  const graphicSrc = src.graphic && typeof src.graphic === 'object' ? src.graphic : {};
  const palette = asStringList(colorSrc.palette);
  const mood = asStringList(src.mood);
  const dna: StyleDna = {
    color: {
      palette: palette.length > 0 ? palette : asStringList(colorSrc),
      ratio: String(colorSrc.ratio || '').trim() || undefined,
      saturation: String(colorSrc.saturation || '').trim() || undefined,
      contrast: String(colorSrc.contrast || '').trim() || undefined
    },
    lighting: {
      key: String(lightingSrc.key || lightingSrc.key_light || render.lighting || '').trim() || undefined,
      rim: String(lightingSrc.rim || lightingSrc.rim_light || '').trim() || undefined,
      shadows: String(lightingSrc.shadows || '').trim() || undefined,
      atmosphere: String(lightingSrc.atmosphere || '').trim() || undefined
    },
    lens: {
      camera: String(lensSrc.camera || render.lens || '').trim() || undefined,
      depth: String(lensSrc.depth || '').trim() || undefined,
      negativeSpace: String(lensSrc.negativeSpace || lensSrc.negative_space || '').trim() || undefined
    },
    material: {
      surface: String(materialSrc.surface || '').trim() || undefined,
      grain: String(materialSrc.grain || materialSrc.texture || '').trim() || undefined
    },
    rendering: {
      medium: String(renderingSrc.medium || render.medium || '').trim() || undefined,
      edgeQuality: String(renderingSrc.edgeQuality || renderingSrc.edge_quality || '').trim() || undefined
    },
    graphic: {
      motifs: asStringList(graphicSrc.motifs),
      typeFeel: String(graphicSrc.typeFeel || graphicSrc.typography || '').trim() || undefined
    },
    mood
  };
  const hasColor = (dna.color?.palette || []).length > 0;
  const hasRender = Boolean(dna.rendering?.medium);
  const hasLight = Boolean(dna.lighting?.key);
  if (!hasColor && !hasRender && !hasLight) return undefined;
  return dna;
}

function asTransferModules(raw: unknown): StyleDnaModule[] {
  const allowed: StyleDnaModule[] = ['color', 'lighting', 'material', 'rendering', 'mood', 'lens', 'graphic', 'world'];
  const list = Array.isArray(raw) ? raw.map((item) => String(item || '').trim()) : [];
  const picked = allowed.filter((id) => list.includes(id));
  return picked.length > 0 ? picked : DEFAULT_TRANSFER_MODULES;
}

export function normalizeInferredPack(raw: unknown, imageHash: string): StylePack | null {
  if (!raw || typeof raw !== 'object') return null;
  const data = raw as Record<string, any>;
  const worldRaw = data.world && typeof data.world === 'object' ? data.world : {};
  const render = data.render && typeof data.render === 'object' ? data.render : {};
  const dna = asDna(data.dna, render);
  const contentToIgnore = asStringList(data.content_to_ignore || data.contentToIgnore);
  const medium = String(render.medium || dna?.rendering?.medium || '').trim();
  if (!medium && !dna) return null;

  const hasWorld =
    worldRaw &&
    typeof worldRaw === 'object' &&
    Boolean(String(worldRaw.era || '').trim()) &&
    Boolean(String(worldRaw.wardrobe || '').trim());

  const policyRaw = String(data.contemporaryPolicy || '').trim();
  const contemporaryPolicy: ContemporaryPolicy =
    hasWorld && (policyRaw === 'adapt' || policyRaw === 'costume')
      ? policyRaw
      : 'filter';

  const transferModules = asTransferModules(data.transfer_defaults || data.transferModules);
  const confidence = Number(data.confidence);
  const era = String(worldRaw.era || '').trim() || '题材自带的时代';
  const wardrobe = String(worldRaw.wardrobe || '').trim() || '按口播身份来，不从参考图抄服装';
  const space = String(worldRaw.space || '').trim() || '按口播场景来，不从参考图抄地点';

  return {
    id: `inferred:${imageHash.slice(0, 16)}`,
    source: 'inferred',
    label: String(data.label || dna?.mood?.[0] || '风格基因').trim().slice(0, 24) || '风格基因',
    world: {
      era,
      wardrobe,
      space,
      must: asStringList(worldRaw.must),
      dont: [
        ...contentToIgnore,
        ...asStringList(worldRaw.dont),
        '复制参考图中的人物或物体'
      ].filter((item, index, list) => list.indexOf(item) === index).slice(0, 8)
    },
    render: {
      medium: medium || 'editorial visual system',
      lighting: String(render.lighting || dna?.lighting?.key || 'controlled lighting').trim(),
      lens: String(render.lens || dna?.lens?.camera || 'balanced composition').trim(),
      quality: String(render.quality || 'controlled, consistent series look').trim()
    },
    contemporaryPolicy,
    dna,
    contentToIgnore: contentToIgnore.length >= 2 ? contentToIgnore : ['参考图中的人物', '参考图中的具体物体', '参考图中的可识别场景'],
    transferModules: hasWorld ? transferModules : transferModules.filter((id) => id !== 'world'),
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : undefined,
    reference: {
      imageId: imageHash,
      notes: String(data.notes || '').trim() || undefined
    },
    createdAt: Date.now()
  };
}

export function nearestVisualStyleFromPack(pack: StylePack): VisualStyle {
  const hay = `${pack.label} ${pack.world.era} ${pack.world.wardrobe} ${pack.world.space} ${pack.render.medium}`.toLowerCase();
  if (/水墨|墨|工笔|国画|oriental|ink wash/.test(hay)) return 'chinese-ink';
  if (/赛博|霓虹|cyber|neon/.test(hay)) return 'cyberpunk';
  if (/动漫|新海|anime|manga/.test(hay)) return 'anime';
  if (/矢量|扁平|vector|flat art/.test(hay)) return 'vector-art';
  if (/三维|cgi|unreal|octane|3d/.test(hay)) return '3d-render';
  if (/胶片|portra|film grain|vintage/.test(hay)) return 'vintage-film';
  if (/摄影|photoreal|photograph/.test(hay)) return 'photorealistic';
  return 'cinematic';
}

export function hashStyleImage(dataUrl: string): string {
  let hash = 5381;
  for (let i = 0; i < dataUrl.length; i += Math.max(1, Math.floor(dataUrl.length / 8000))) {
    hash = ((hash << 5) + hash) ^ dataUrl.charCodeAt(i);
  }
  hash = hash >>> 0;
  return hash.toString(16) + String(dataUrl.length);
}

export function localRewriteClipPrompt(
  clip: { visualPrompt?: string; chineseVisualPrompt?: string; narration?: string; characterIds?: string[]; locationId?: string; continuity?: VisualContinuity },
  pack: StylePack,
  visualBible?: VisualBible | null
): { visualPrompt: string; chineseVisualPrompt: string } {
  const raw = clip.chineseVisualPrompt || clip.narration || pack.label;
  const scene = stripBiblePrefix(stripStyleRenders(raw));
  const chinese = applyBibleToChineseIntent(scene, visualBible, clip);
  return {
    chineseVisualPrompt: chinese,
    visualPrompt: clip.visualPrompt || ''
  };
}
