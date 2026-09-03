import { VideoProject, VisualStyle, SubtitleConfig, AudioConfig, CustomImageApiConfig, CustomLlmApiConfig, CustomTtsApiConfig, ScriptGenre } from '../types';
import { SYSTEM_FONT_ID, SYSTEM_FONT_STACK, SYSTEM_LATIN_FONT_ID } from './subtitleFonts';

export const DEFAULT_CUSTOM_IMAGE_API: CustomImageApiConfig = {
  enabled: false,
  provider: 'siliconflow',
  endpoint: 'https://api.siliconflow.cn/v1/images/generations',
  apiKey: '',
  model: '',
  size: 'auto',
  protocol: 'auto',
  quality: 'standard',
  concurrency: 3
};

export const DEFAULT_IMAGE_RETRY = {
  enabled: true,
  maxRetries: 2,
  useBackup: true
};

export function resolveImageApi(api?: CustomImageApiConfig): CustomImageApiConfig {
  const merged: CustomImageApiConfig = { ...DEFAULT_CUSTOM_IMAGE_API, ...(api || {}) };
  if ((merged.provider as string) === 'builtin') {
    return { ...DEFAULT_CUSTOM_IMAGE_API, enabled: false };
  }
  const ready = Boolean(merged.endpoint?.trim() && merged.apiKey?.trim());
  return {
    ...merged,
    enabled: merged.enabled !== false && ready
  };
}

export function isImageApiReady(api?: CustomImageApiConfig): boolean {
  const resolved = resolveImageApi(api);
  return Boolean(resolved.enabled && resolved.endpoint.trim() && resolved.apiKey.trim());
}

export function isCustomImageProvider(api?: CustomImageApiConfig): boolean {
  return isImageApiReady(api);
}

export function imageApiLabel(api?: CustomImageApiConfig): string {
  const resolved = resolveImageApi(api);
  if (!isImageApiReady(resolved)) return '未配置';
  return resolved.model || resolved.provider;
}

export function resolveImageRetry(retry?: { enabled?: boolean; maxRetries?: number; useBackup?: boolean } | null) {
  const maxRetries = Number(retry?.maxRetries);
  return {
    enabled: retry?.enabled !== false,
    maxRetries: Number.isFinite(maxRetries) ? Math.max(0, Math.min(4, Math.round(maxRetries))) : DEFAULT_IMAGE_RETRY.maxRetries,
    useBackup: retry?.useBackup !== false
  };
}

export const DEFAULT_CUSTOM_LLM_API: CustomLlmApiConfig = {
  enabled: false,
  provider: 'builtin',
  endpoint: '',
  apiKey: '',
  model: ''
};

export function resolveLlmApi(api?: CustomLlmApiConfig): CustomLlmApiConfig {
  if (!api) return { ...DEFAULT_CUSTOM_LLM_API };
  if (api.provider === 'builtin' || api.enabled === false) {
    return { ...DEFAULT_CUSTOM_LLM_API, ...api, provider: 'builtin', enabled: false };
  }
  return { ...DEFAULT_CUSTOM_LLM_API, ...api, enabled: true };
}

export function isCustomLlmProvider(api?: CustomLlmApiConfig): boolean {
  const resolved = resolveLlmApi(api);
  return resolved.provider !== 'builtin' && !!resolved.apiKey.trim() && !!resolved.endpoint.trim();
}

export interface LlmProviderPreset {
  id: CustomLlmApiConfig['provider'];
  name: string;
  badge: string;
  description: string;
  defaultEndpoint: string;
  defaultModel: string;
  popularModels: { id: string; label: string; hint: string }[];
  docHint: string;
  available: boolean;
}

export const LLM_PROVIDER_PRESETS: LlmProviderPreset[] = [
  {
    id: 'builtin',
    name: '内置引擎',
    badge: '无需密钥',
    description: '未配置自定义 LLM 时，使用服务端 Gemini（若已配置）或本地分镜引擎',
    defaultEndpoint: '',
    defaultModel: '',
    popularModels: [],
    docHint: '适合先跑通流程。需要更高质量的中文分镜和润色时，改选 DeepSeek 并填写 API Key。',
    available: true
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    badge: '已接入',
    description: 'OpenAI 兼容接口，适合中文分镜、文案润色与结构化剧本输出',
    defaultEndpoint: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    popularModels: [
      { id: 'deepseek-v4-flash', label: 'V4 Flash', hint: '更快更省，日常分镜推荐' },
      { id: 'deepseek-v4-pro', label: 'V4 Pro', hint: '更高质量，复杂文案更稳' }
    ],
    docHint: '在 platform.deepseek.com 创建 API Key。Base URL 填 https://api.deepseek.com，请求格式兼容 OpenAI Chat Completions。',
    available: true
  },
  {
    id: 'openai',
    name: 'OpenAI',
    badge: '即将开放',
    description: 'GPT 系列对话模型，后续支持作为文案供应商',
    defaultEndpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    popularModels: [],
    docHint: '',
    available: false
  },
  {
    id: 'custom',
    name: '自定义兼容接口',
    badge: '即将开放',
    description: '任意 OpenAI Chat Completions 兼容中转，后续开放',
    defaultEndpoint: 'https://your-api-domain.com/v1',
    defaultModel: '',
    popularModels: [],
    docHint: '',
    available: false
  }
];

export interface ImageApiProviderPreset {
  id: CustomImageApiConfig['provider'];
  name: string;
  badge: string;
  description: string;
  defaultEndpoint: string;
  defaultModel: string;
  popularModels: string[];
  docHint: string;
}

export const IMAGE_API_PROVIDER_PRESETS: ImageApiProviderPreset[] = [
  {
    id: 'siliconflow',
    name: '硅基流动',
    badge: '国内直连',
    description: 'OpenAI 兼容生图接口，适合日常分镜出图',
    defaultEndpoint: 'https://api.siliconflow.cn/v1/images/generations',
    defaultModel: '',
    popularModels: ['stabilityai/stable-diffusion-3-medium'],
    docHint: '在硅基流动控制台创建 API Key。模型请拉取列表后选择。'
  },
  {
    id: 'oneapi',
    name: '中转站',
    badge: 'OneAPI / NewAPI',
    description: '自动兼容 Images 与 Chat 生图通道',
    defaultEndpoint: 'https://api.change2pro.com',
    defaultModel: 'dall-e-3',
    popularModels: ['dall-e-3', 'gpt-4o', 'midjourney', 'mj-chat'],
    docHint: '填中转站根地址和密钥。系统会按协议自适应 Images 或 Chat Completions。'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    badge: '官方',
    description: 'DALL·E / GPT Image 官方或官方兼容代理',
    defaultEndpoint: 'https://api.openai.com/v1/images/generations',
    defaultModel: 'dall-e-3',
    popularModels: ['dall-e-3', 'gpt-image-1'],
    docHint: '使用官方 Key 或兼容代理。GPT Image 类模型建议协议选 Chat。'
  },
  {
    id: 'midjourney',
    name: 'Midjourney 代理',
    badge: '艺术向',
    description: 'Midjourney-Proxy / NewAPI 的 MJ 通道',
    defaultEndpoint: 'https://api.openai-proxy.org/v1/images/generations',
    defaultModel: 'midjourney',
    popularModels: ['midjourney', 'mj-chat'],
    docHint: '适用于第三方 MJ 协议代理。出图较慢，并发建议开 1。'
  },
  {
    id: 'custom',
    name: '自定义兼容接口',
    badge: '自建',
    description: '任意 OpenAI Images 或 Chat Completions 兼容服务',
    defaultEndpoint: '',
    defaultModel: '',
    popularModels: ['dall-e-3', 'gpt-image-1', 'stable-diffusion-xl'],
    docHint: '自己填接口地址和模型名。不会走任何内置免费引擎。'
  }
];

export const DEFAULT_CUSTOM_TTS_API: CustomTtsApiConfig = {
  enabled: false,
  provider: 'edge',
  endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation',
  apiKey: '',
  model: 'qwen-audio-3.0-tts-flash',
  voice: 'longanfengyue'
};

export function resolveTtsApi(api?: CustomTtsApiConfig): CustomTtsApiConfig {
  if (!api) return { ...DEFAULT_CUSTOM_TTS_API };
  if (api.provider === 'edge' || api.enabled === false) {
    return { ...DEFAULT_CUSTOM_TTS_API, ...api, provider: 'edge', enabled: false };
  }
  return { ...DEFAULT_CUSTOM_TTS_API, ...api, enabled: true };
}

export function isCustomTtsProvider(api?: CustomTtsApiConfig): boolean {
  const resolved = resolveTtsApi(api);
  return resolved.provider !== 'edge' && !!resolved.apiKey.trim();
}

export interface TtsProviderPreset {
  id: CustomTtsApiConfig['provider'];
  name: string;
  badge: string;
  description: string;
  defaultEndpoint: string;
  defaultModel: string;
  defaultVoice: string;
  popularModels: { id: string; label: string; hint: string }[];
  popularVoices: { id: string; label: string; hint: string }[];
  docHint: string;
  available: boolean;
}

export const TTS_PROVIDER_PRESETS: TtsProviderPreset[] = [
  {
    id: 'edge',
    name: '内置 Edge TTS',
    badge: '无需密钥',
    description: '微软 Edge 神经语音，免费无需密钥，已内置在声音面板',
    defaultEndpoint: '',
    defaultModel: '',
    defaultVoice: '',
    popularModels: [],
    popularVoices: [],
    docHint: '直接在「声音」页选择音色即可，无需额外配置。',
    available: true
  },
  {
    id: 'bailian',
    name: '阿里云百炼 Qwen-TTS',
    badge: '已接入',
    description: 'DashScope 千问语音合成，中文表现力强，需北京地域 API Key',
    defaultEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
    defaultModel: 'qwen-audio-3.0-tts-flash',
    defaultVoice: 'longanfengyue',
     popularModels: [
       { id: 'cosyvoice-v3.5-plus', label: 'CosyVoice V3.5 Plus', hint: '最新旗舰版，音质最优' },
       { id: 'cosyvoice-v3.5-flash', label: 'CosyVoice V3.5 Flash', hint: '最新快版，性能最佳' },
       { id: 'cosyvoice-v3-plus', label: 'CosyVoice V3 Plus', hint: '旗舰音质，48kHz，适合成片配音' },
       { id: 'cosyvoice-v3-flash', label: 'CosyVoice V3 Flash', hint: '更快更省，日常推荐' },
       { id: 'cosyvoice-v2', label: 'CosyVoice V2', hint: '经典稳定版' },
       { id: 'qwen-audio-3.0-tts-plus', label: 'Audio 3.0 Plus', hint: '旗舰音质，48kHz，适合成片配音' },
       { id: 'qwen-audio-3.0-tts-flash', label: 'Audio 3.0 Flash', hint: '新一代更快更省，日常推荐' },
       { id: 'qwen3-tts-flash', label: 'Qwen3-TTS-Flash', hint: '上一代轻量档，Cherry 等音色' },
       { id: 'qwen3-tts-instruct-flash', label: 'Instruct-Flash', hint: '上一代，支持指令控制语速/情感' },
       { id: 'qwen-tts', label: 'Qwen-TTS', hint: '经典稳定版音色' }
     ],
    popularVoices: [
      { id: 'longanfengyue', label: '龙安风悦', hint: '3.0 Flash 自然亲切女声' },
      { id: 'longanlingxin', label: '龙安灵心', hint: '3.0 Plus 旗舰女声' },
      { id: 'longanlufeng', label: '龙安鲁风', hint: '3.0 Plus 旗舰男声' },
      { id: 'Cherry', label: 'Cherry', hint: 'Qwen3 甜美活力女声' },
      { id: 'Ethan', label: 'Ethan', hint: 'Qwen3 沉稳磁性男声' }
    ],
    docHint: '在百炼控制台创建北京地域 API Key（sk-...）。3.0 与 Qwen3 接口、音色都不能混用，切换模型会自动改地址和音色目录。目录外的 voice id 可在本页或声音页自定义填写。',
    available: true
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    badge: '即将开放',
    description: '高表现力中文配音，后续开放',
    defaultEndpoint: '',
    defaultModel: '',
    defaultVoice: '',
    popularModels: [],
    popularVoices: [],
    docHint: '',
    available: false
  },
  {
    id: 'azure',
    name: 'Azure Speech',
    badge: '即将开放',
    description: '企业级多语言神经语音，后续开放',
    defaultEndpoint: '',
    defaultModel: '',
    defaultVoice: '',
    popularModels: [],
    popularVoices: [],
    docHint: '',
    available: false
  }
];

export const STYLE_DEFINITIONS: Record<VisualStyle, {
  id: VisualStyle;
  name: string;
  enName: string;
  badge: string;
  description: string;
  promptSuffix: string;
  previewBg: string;
  accentColor: string;
  thumbnail: string;
}> = {
  'photorealistic': {
    id: 'photorealistic',
    name: '真实摄影',
    enName: 'Photorealistic',
    badge: '8K 超写实',
    description: '单反级景深、自然光影与极高细节质感',
    promptSuffix: 'photorealistic, shot on 35mm lens, f/1.8 aperture, natural lighting, high dynamic range, 8k resolution, ultra detailed, award winning photography',
    previewBg: 'from-amber-900/40 via-stone-900 to-black',
    accentColor: '#f59e0b',
    thumbnail: 'https://images.unsplash.com/photo-1552168324-d612d77725e3?auto=format&fit=crop&w=300&q=80'
  },
  'cinematic': {
    id: 'cinematic',
    name: '电影质感',
    enName: 'Cinematic Movie',
    badge: '院线大片',
    description: '宽银幕变形镜头、戏剧性冷暖反差与情绪光影',
    promptSuffix: 'cinematic lighting, anamorphic lens, blockbuster movie still, 35mm film still, shallow depth of field, color graded, atmospheric mist, high production value',
    previewBg: 'from-blue-950/60 via-slate-900 to-black',
    accentColor: '#38bdf8',
    thumbnail: 'https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=300&q=80'
  },
  'anime': {
    id: 'anime',
    name: '新海诚风 / 动漫',
    enName: 'Makoto Shinkai Anime',
    badge: '治愈唯美',
    description: '通透蓝天、梦幻云海、细腻光影与唯美日系色调',
    promptSuffix: 'Makoto Shinkai style, vibrant anime art, beautiful lighting, dramatic volumetric clouds, sunbeams, highly detailed background, gorgeous color palette, 4k anime wallpaper',
    previewBg: 'from-sky-900/50 via-indigo-950 to-black',
    accentColor: '#60a5fa',
    thumbnail: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=300&q=80'
  },
  'cyberpunk': {
    id: 'cyberpunk',
    name: '赛博朋克 / 未来',
    enName: 'Cyberpunk Sci-Fi',
    badge: '霓虹科幻',
    description: '霓虹流光、全息投影、雨夜反光与未来科技感',
    promptSuffix: 'cyberpunk aesthetic, neon city lights, rainy reflective street, holographic interfaces, futuristic skyscrapers, purple and cyan color grading, moody night atmosphere',
    previewBg: 'from-fuchsia-950/60 via-purple-950 to-black',
    accentColor: '#ec4899',
    thumbnail: 'https://images.unsplash.com/photo-1601042879364-f3947d3f9c16?auto=format&fit=crop&w=300&q=80'
  },
  '3d-render': {
    id: '3d-render',
    name: '3D三维渲染',
    enName: '3D CGI Animation',
    badge: '皮克斯/虚幻5',
    description: '虚幻引擎5全局光照、精细材质与生动三维角色',
    promptSuffix: '3D CGI render, Unreal Engine 5, Octane render, ray tracing, cute stylized character, Pixar Disney style lighting, smooth textures, volumetric lighting',
    previewBg: 'from-emerald-950/50 via-teal-950 to-black',
    accentColor: '#34d399',
    thumbnail: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=300&q=80'
  },
  'chinese-ink': {
    id: 'chinese-ink',
    name: '东方水墨 / 国风',
    enName: 'Traditional Ink Wash',
    badge: '诗意意境',
    description: '泼墨留白、山水苍茫、古典东方美学意境',
    promptSuffix: 'traditional Chinese ink wash painting, ethereal poetic atmosphere, watercolor brush strokes, mist and distant mountains, gold foil accents, elegant oriental aesthetics',
    previewBg: 'from-stone-800/60 via-zinc-900 to-black',
    accentColor: '#d4af37',
    thumbnail: 'https://images.unsplash.com/photo-1577937927133-66ef06acdf18?auto=format&fit=crop&w=300&q=80'
  },
  'vintage-film': {
    id: 'vintage-film',
    name: '复古胶片',
    enName: '90s Vintage Film',
    badge: '胶片颗粒',
    description: '柯达胶片色彩、温润怀旧光晕与经典质感',
    promptSuffix: 'vintage 1990s 35mm Kodak Portra 400 film photograph, nostalgic warm tones, subtle film grain, soft lens flare, documentary realism',
    previewBg: 'from-orange-950/50 via-stone-900 to-black',
    accentColor: '#fb923c',
    thumbnail: 'https://images.unsplash.com/photo-1557053910-d9eadeed1c58?auto=format&fit=crop&w=300&q=80'
  },
  'vector-art': {
    id: 'vector-art',
    name: '极简矢量插画',
    enName: 'Modern Vector',
    badge: '商业现代',
    description: '几何形态、明快色彩、扁平科技感与高识别度',
    promptSuffix: 'modern vector illustration, clean lines, minimalist flat art, elegant color palette, high contrast, trendy graphic design, Dribbble trending',
    previewBg: 'from-violet-950/50 via-slate-900 to-black',
    accentColor: '#a78bfa',
    thumbnail: 'https://images.unsplash.com/photo-1618005192384-a83a8bd57fbe?auto=format&fit=crop&w=300&q=80'
  }
};

export interface BgmTrackDefinition {
  id: string;
  title: string;
  category: string;
  bpm: number;
  mood: string;
  previewColor: string;
  url: string;
  fallbackUrl: string;
  durationText: string;
  genres: ScriptGenre[];
  credit?: string;
}

export const BGM_GENRE_ORDER: ScriptGenre[] = ['科普', '反常识', '故事', '教程', '带货', '情绪', '热点解读', '口播金句'];

export const BGM_TRACKS: BgmTrackDefinition[] = [
  {
    id: 'kepu-thinking',
    title: '🧠 思考底垫 · 科普口播',
    category: '科普',
    bpm: 92,
    mood: '轻思考、不抢话、适合讲机制',
    previewColor: '#38bdf8',
    url: '/audio/bgm/kepu-thinking.mp3',
    fallbackUrl: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Thinking%20Music.mp3',
    durationText: '02:37',
    genres: ['科普', '热点解读'],
    credit: 'Kevin MacLeod · Thinking Music · CC BY 3.0'
  },
  {
    id: 'kepu-deliberate',
    title: '📘 沉稳论述 · 机制讲解',
    category: '科普',
    bpm: 80,
    mood: '沉稳、纪录片感、把一件事讲明白',
    previewColor: '#0ea5e9',
    url: '/audio/bgm/kepu-deliberate.mp3',
    fallbackUrl: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Deliberate%20Thought.mp3',
    durationText: '02:57',
    genres: ['科普'],
    credit: 'Kevin MacLeod · Deliberate Thought · CC BY 3.0'
  },
  {
    id: 'fan-sneaky',
    title: '🕵️ 反转探案 · 先藏后揭',
    category: '反常识',
    bpm: 110,
    mood: '俏皮紧张、适合拆误解和反转',
    previewColor: '#f43f5e',
    url: '/audio/bgm/fan-sneaky.mp3',
    fallbackUrl: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Sneaky%20Snitch.mp3',
    durationText: '02:13',
    genres: ['反常识', '热点解读'],
    credit: 'Kevin MacLeod · Sneaky Snitch · CC BY 3.0'
  },
  {
    id: 'story-touching',
    title: '📖 故事钢琴 · 人物转折',
    category: '故事',
    bpm: 72,
    mood: '钢琴叙事、金句前后停得住',
    previewColor: '#fb7185',
    url: '/audio/bgm/story-touching.mp3',
    fallbackUrl: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Touching%20Story.mp3',
    durationText: '01:06',
    genres: ['故事', '情绪'],
    credit: 'Kevin MacLeod · Touching Story · CC BY 3.0'
  },
  {
    id: 'tutorial-lemon',
    title: '🍋 轻松柠檬 · 跟着做',
    category: '教程',
    bpm: 108,
    mood: '轻快、不压口播、适合步骤演示',
    previewColor: '#facc15',
    url: '/audio/bgm/tutorial-lemon.mp3',
    fallbackUrl: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Easy%20Lemon.mp3',
    durationText: '02:06',
    genres: ['教程'],
    credit: 'Kevin MacLeod · Easy Lemon · CC BY 3.0'
  },
  {
    id: 'tutorial-carefree',
    title: '🎈 轻快无压 · 步骤演示',
    category: '教程',
    bpm: 115,
    mood: '轻松、明亮、适合生活教程',
    previewColor: '#84cc16',
    url: '/audio/bgm/tutorial-carefree.mp3',
    fallbackUrl: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Carefree.mp3',
    durationText: '02:44',
    genres: ['教程', '带货'],
    credit: 'Kevin MacLeod · Carefree · CC BY 3.0'
  },
  {
    id: 'shop-catwalk',
    title: '🛍️ 街拍律动 · 种草带货',
    category: '带货',
    bpm: 129,
    mood: '时髦、轻快、适合产品出镜',
    previewColor: '#fb7185',
    url: '/audio/bgm/shop-catwalk.mp3',
    fallbackUrl: 'https://assets.mixkit.co/music/371/371.mp3',
    durationText: '01:40',
    genres: ['带货'],
    credit: 'Arulo · Cat Walk · Mixkit License'
  },
  {
    id: 'shop-house',
    title: '🏠 宅家律动 · 种草卡点',
    category: '带货',
    bpm: 123,
    mood: 'House 律动、适合好物展示',
    previewColor: '#e879f9',
    url: '/audio/bgm/shop-house.mp3',
    fallbackUrl: 'https://assets.mixkit.co/music/745/745.mp3',
    durationText: '01:51',
    genres: ['带货', '教程'],
    credit: 'Lily J · House Vibez · Mixkit License'
  },
  {
    id: 'emotion-frozen',
    title: '❄️ 冰星夜曲 · 情绪金句',
    category: '情绪',
    bpm: 88,
    mood: '空灵、停留、适合共鸣与金句',
    previewColor: '#a78bfa',
    url: '/audio/bgm/emotion-frozen.mp3',
    fallbackUrl: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Frozen%20Star.mp3',
    durationText: '03:41',
    genres: ['情绪', '故事'],
    credit: 'Kevin MacLeod · Frozen Star · CC BY 3.0'
  },
  {
    id: 'news-investigations',
    title: '🗞️ 调查底垫 · 热点解读',
    category: '热点解读',
    bpm: 100,
    mood: '调查感、不吵、适合讲这件事意味着什么',
    previewColor: '#64748b',
    url: '/audio/bgm/news-investigations.mp3',
    fallbackUrl: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Investigations.mp3',
    durationText: '01:34',
    genres: ['热点解读', '科普', '反常识'],
    credit: 'Kevin MacLeod · Investigations · CC BY 3.0'
  },
  {
    id: 'punch-nba',
    title: '🎤 说唱卡点 · 金句口播',
    category: '口播金句',
    bpm: 86,
    mood: '都市说唱底鼓、一句就能记住',
    previewColor: '#f59e0b',
    url: '/audio/bgm/punch-nba.mp3',
    fallbackUrl: 'https://assets.mixkit.co/music/403/403.mp3',
    durationText: '01:44',
    genres: ['口播金句', '带货'],
    credit: 'Arulo · G Eazy NBA type · Mixkit License'
  },
  {
    id: 'punch-tonight',
    title: '🌃 夜色节拍 · 短句记忆',
    category: '口播金句',
    bpm: 103,
    mood: '夜色节拍、适合短口播和钩子',
    previewColor: '#818cf8',
    url: '/audio/bgm/punch-tonight.mp3',
    fallbackUrl: 'https://assets.mixkit.co/music/841/841.mp3',
    durationText: '01:53',
    genres: ['口播金句', '热点解读'],
    credit: 'Michael Ramir C. · Tonight · Mixkit License'
  }
];

export const DEFAULT_BGM_TRACK_ID = 'kepu-thinking';

const RETIRED_BGM_IDS: Record<string, string> = {
  'epic-cinematic': 'news-investigations',
  'chill-lofi': 'tutorial-lemon',
  'cyber-pulse': 'punch-tonight',
  'running-energy': 'shop-catwalk',
  'ambient-ethereal': 'emotion-frozen',
  'warm-acoustic': 'story-touching',
  'deep-exploration': 'kepu-deliberate',
  'tech-future': 'kepu-thinking'
};

export function resolveBgmTrackId(id: string | null | undefined): string {
  if (!id || id === 'custom-uploaded' || id === 'none') return id || DEFAULT_BGM_TRACK_ID;
  if (RETIRED_BGM_IDS[id]) return RETIRED_BGM_IDS[id];
  return BGM_TRACKS.some((track) => track.id === id) ? id : DEFAULT_BGM_TRACK_ID;
}

export function bgmById(id: string | null | undefined): BgmTrackDefinition | null {
  if (!id) return null;
  return BGM_TRACKS.find((track) => track.id === resolveBgmTrackId(id)) || BGM_TRACKS[0] || null;
}

export function bgmTracksForGenre(genre: ScriptGenre | 'all' | null | undefined): BgmTrackDefinition[] {
  if (!genre || genre === 'all') return BGM_TRACKS;
  const matched = BGM_TRACKS.filter((track) => track.genres.includes(genre));
  return matched.length ? matched : BGM_TRACKS;
}

export function recommendedBgmIdForGenre(genre: ScriptGenre | null | undefined): string | null {
  if (!genre) return null;
  const primary = BGM_TRACKS.find((track) => track.genres[0] === genre);
  return primary?.id || BGM_TRACKS.find((track) => track.genres.includes(genre))?.id || null;
}

export const DEFAULT_SUBTITLE_CONFIG: SubtitleConfig = {
  enabled: true,
  preset: 'viral-yellow',
  fontSize: 26,
  fontId: SYSTEM_FONT_ID,
  fontFamily: SYSTEM_FONT_STACK,
  secondaryFontId: SYSTEM_LATIN_FONT_ID,
  positionY: 82,
  primaryColor: '#ffffff',
  highlightColor: '#facc15',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  showBackground: true,
  showShadow: true,
  showStroke: true,
  strokeColor: '#000000',
  animation: 'pop',
  bilingual: false
};

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  bgmEnabled: true,
  bgmTrackId: DEFAULT_BGM_TRACK_ID,
  bgmVolume: 0.16,
  voiceoverEnabled: true,
  voiceoverVolume: 0.95,
  voiceCharacter: 'magnetic-male',
  speechRate: 1.0,
  audioDucking: true,
  sentenceGap: 0.2
};

export const SAMPLE_PROJECTS: VideoProject[] = [
  {
    id: 'project-universe',
    title: '人类探索深空的壮丽史诗',
    topic: '从地球出发，跨越百亿光年的深空探索旅程',
    createdAt: Date.now() - 3600000 * 24,
    updatedAt: Date.now() - 3600000 * 2,
    settings: {
      aspectRatio: '16:9',
      canvasBackground: '#0a0a0c',
      visualStyle: 'cinematic',
      safeMargin: false,
      exportQuality: '1080p',
      frameRate: 30
    },
    subtitles: {
      ...DEFAULT_SUBTITLE_CONFIG,
      preset: 'viral-yellow',
      fontSize: 28
    },
    audio: {
      ...DEFAULT_AUDIO_CONFIG,
      bgmTrackId: 'kepu-thinking'
    },
    clips: [
      {
        id: 'clip-1',
        order: 1,
        duration: 3.5,
        narration: '数百亿年前，宇宙在一场无可比拟的炽热大爆炸中诞生。',
        secondaryText: 'Billions of years ago, the cosmos ignited in a brilliant flash.',
        visualPrompt: 'Cinematic wide shot of the cosmic big bang, swirling galaxy nebula of vibrant gold, violet, and deep indigo starlight, 8k cinematic space photography',
        chineseVisualPrompt: '宇宙大爆炸瞬间，绚丽金色与紫罗兰色星云在深邃太空中旋转激荡，电影级太空摄影',
        cameraMotion: 'zoom-out',
        transition: 'crossfade',
        imageUrl: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1200&auto=format&fit=crop&q=80'
      },
      {
        id: 'clip-2',
        order: 2,
        duration: 3.5,
        narration: '恒星在漫长岁月中凝聚、燃烧，又在超新星中将重元素洒向虚空。',
        secondaryText: 'Stars condensed and ignited, scattering elements across the void.',
        visualPrompt: 'Close up glowing newborn blue giant star surrounded by planetary accretion disk, intense stellar flares and crystalline cosmic dust, hyper realistic',
        chineseVisualPrompt: '一颗新生的炽热蓝巨星，被行星吸积盘环绕，强烈的恒星耀斑与宇宙星尘',
        cameraMotion: 'zoom-in',
        transition: 'crossfade',
        imageUrl: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=1200&auto=format&fit=crop&q=80'
      },
      {
        id: 'clip-3',
        order: 3,
        duration: 4.0,
        narration: '我们这颗蔚蓝星球，不过是悬浮在一缕微弱阳光中的暗淡蓝点。',
        secondaryText: 'Our blue planet, a pale blue dot suspended in a sunbeam.',
        visualPrompt: 'Stunning orbital view of Planet Earth from deep space, thin glowing atmosphere line, deep black void, sunlight creating golden crescent',
        chineseVisualPrompt: '从深空俯瞰地球，发光的纤细大气层与深邃黑色太空，阳光勾勒出金色晨昏线',
        cameraMotion: 'pan-left',
        transition: 'crossfade',
        imageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1200&auto=format&fit=crop&q=80'
      },
      {
        id: 'clip-4',
        order: 4,
        duration: 3.8,
        narration: '然而人类从未停止仰望，我们终将驾驶星舰，驶向星辰大海的彼岸。',
        secondaryText: 'Yet humanity never stopped gazing upward, destined for the stars.',
        visualPrompt: 'Futuristic interstellar exploration starship cruising near giant ringed exoplanet, majestic cosmic vista, cinematic lighting, epic sci-fi realism',
        chineseVisualPrompt: '未来星际探索飞船航行于巨大光环系外行星旁，壮丽宏大的科幻大片质感',
        cameraMotion: 'cinematic-orbit',
        transition: 'crossfade',
        imageUrl: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=1200&auto=format&fit=crop&q=80'
      }
    ]
  },
  {
    id: 'project-ai-future',
    title: '未来已来：AI 重塑人类文明的一天',
    topic: '人工智能在城市、医疗、创作中全面爆发的科幻图景',
    createdAt: Date.now() - 3600000 * 12,
    updatedAt: Date.now() - 3600000 * 1,
    settings: {
      aspectRatio: '9:16',
      canvasBackground: '#0a0a0c',
      visualStyle: 'cyberpunk',
      safeMargin: false,
      exportQuality: '1080p',
      frameRate: 30
    },
    subtitles: {
      ...DEFAULT_SUBTITLE_CONFIG,
      preset: 'neon-cyan',
      fontSize: 24
    },
    audio: {
      ...DEFAULT_AUDIO_CONFIG,
      bgmTrackId: 'punch-tonight'
    },
    clips: [
      {
        id: 'clip-ai-1',
        order: 1,
        duration: 3.0,
        narration: '你是否想过，当智能超越想象，未来的城市将如何运转？',
        secondaryText: 'Have you ever wondered how future cities will operate?',
        visualPrompt: 'Vertical 9:16 futuristic smart megacity skyline at night, glowing neon light rails, holographic air traffic, cyberpunk vertical architecture',
        chineseVisualPrompt: '9:16竖屏赛博朋克未来智慧超级城市夜景，全息光轨与立体飞行器穿梭',
        cameraMotion: 'tilt-down',
        transition: 'crossfade',
        imageUrl: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800&auto=format&fit=crop&q=80'
      },
      {
        id: 'clip-ai-2',
        order: 2,
        duration: 3.2,
        narration: '微秒级的量子算力，在无声无息中调度着数以亿计的能量流。',
        secondaryText: 'Quantum computing orchestrates billions of energy flows silently.',
        visualPrompt: 'Vertical 9:16 close up glowing quantum processor core, intricate crystal light circuits, pulsing cyan and magenta lasers',
        chineseVisualPrompt: '量子计算芯片核心微观特写，晶体光路网络与流动的青色紫色激光脉冲',
        cameraMotion: 'zoom-in',
        transition: 'crossfade',
        imageUrl: 'https://images.unsplash.com/photo-1635070041078-e363dbe005cb?w=800&auto=format&fit=crop&q=80'
      },
      {
        id: 'clip-ai-3',
        order: 3,
        duration: 3.5,
        narration: '每一个普通人，都将拥有属于自己的全能超级数字分身。',
        secondaryText: 'Every individual will harness the power of their personal digital avatar.',
        visualPrompt: 'Vertical 9:16 human silhouette standing before gigantic glowing holographic sphere with AI neural connections, ethereal future atmosphere',
        chineseVisualPrompt: '人类剪影伫立在巨大的发光全息AI神经网络球体前，空灵超前的科技氛围',
        cameraMotion: 'zoom-out',
        transition: 'crossfade',
        imageUrl: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=800&auto=format&fit=crop&q=80'
      }
    ]
  }
];

export const TOPIC_IDEAS = [
  {
    category: '前沿科技 & AI',
    topics: [
      '人类大脑芯片与脑机接口的终极未来',
      '具身智能机器人如何彻底颠覆制造业',
      '量子计算机破解一切密码的那一天',
      '核聚变商用成功后，地球能源格局将如何巨变'
    ]
  },
  {
    category: '自然宇宙 & 地理未解',
    topics: [
      '深海一万米马里亚纳海沟潜伏着怎样的未知巨兽',
      '太阳熄灭前的最后24小时，地球会经历什么',
      '詹姆斯·韦伯望远镜拍摄到的宇宙边缘神秘结构',
      '远古地球曾经历过的五次生物大灭绝启示录'
    ]
  },
  {
    category: '历史传奇 & 文明溯源',
    topics: [
      '消失的亚特兰蒂斯究竟沉睡在地球何处',
      '秦始皇陵地宫为何两千年无人敢掘',
      '古埃及金字塔建造的惊天数学巧合',
      '丝绸之路上的西域古国是如何一夜被风沙吞噬的'
    ]
  },
  {
    category: '情感治愈 & 人生哲学',
    topics: [
      '允许一切发生：治愈当代人精神内耗的顿悟时刻',
      '在快节奏的世界里，如何找回独属于你的内心秩序',
      '那些终将释怀的遗憾，教会了我们什么',
      '一生很短，去爱那些让你真正感到鲜活的事物'
    ]
  }
];
