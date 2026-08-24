import { VideoProject, VisualStyle, SubtitleConfig, AudioConfig, CustomImageApiConfig, CustomLlmApiConfig } from '../types';

export const DEFAULT_CUSTOM_IMAGE_API: CustomImageApiConfig = {
  enabled: false,
  provider: 'builtin',
  endpoint: '',
  apiKey: '',
  model: 'FLUX.1-schnell',
  size: 'auto',
  protocol: 'auto',
  quality: 'standard',
  concurrency: 3
};

export function resolveImageApi(api?: CustomImageApiConfig): CustomImageApiConfig {
  if (!api) return { ...DEFAULT_CUSTOM_IMAGE_API };
  if (api.provider === 'builtin' || api.enabled === false) {
    return { ...DEFAULT_CUSTOM_IMAGE_API, ...api, provider: 'builtin', enabled: false };
  }
  return { ...DEFAULT_CUSTOM_IMAGE_API, ...api, enabled: true };
}

export function isCustomImageProvider(api?: CustomImageApiConfig): boolean {
  return resolveImageApi(api).provider !== 'builtin';
}

export const DEFAULT_CUSTOM_LLM_API: CustomLlmApiConfig = {
  enabled: false,
  provider: 'deepseek',
  endpoint: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-v4-flash'
};

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
    id: 'builtin',
    name: '内置 FLUX',
    badge: '无需密钥',
    description: '免费默认引擎，适合快速出图和草稿预览',
    defaultEndpoint: '',
    defaultModel: 'FLUX.1-schnell',
    popularModels: [],
    docHint: '使用内置 Pollinations FLUX，无需填写密钥。需要更稳定或指定模型时，直接改选其他供应商即可。'
  },
  {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    badge: '极速推荐',
    description: '国内高速低延迟，支持 FLUX.1、SD3 等主流开源文生图大模型',
    defaultEndpoint: 'https://api.siliconflow.cn/v1/images/generations',
    defaultModel: 'black-forest-labs/FLUX.1-schnell',
    popularModels: [
      'black-forest-labs/FLUX.1-schnell',
      'black-forest-labs/FLUX.1-dev',
      'stabilityai/stable-diffusion-3-medium',
      'Pro/black-forest-labs/FLUX.1-schnell'
    ],
    docHint: '可在硅基流动控制台创建 API 密钥 (sk-...)，请求格式完全兼容 OpenAI。'
  },
  {
    id: 'oneapi',
    name: 'OneAPI / NewAPI / Change2Pro 中转',
    badge: '智能自适应',
    description: '自动兼容中转站的 Images 接口与 Chat 对话生图模式',
    defaultEndpoint: 'https://api.change2pro.com',
    defaultModel: 'dall-e-3',
    popularModels: ['dall-e-3', 'flux-schnell', 'flux-dev', 'midjourney', 'mj-chat', 'gpt-4o'],
    docHint: '支持各大聚合中转站。系统已内置双通道自适应（标准生图与 Chat 对话生图自动切换）。'
  },
  {
    id: 'openai',
    name: 'OpenAI (DALL·E 3)',
    badge: '顶级画质',
    description: '全球顶尖语义理解与超清画面构图，完美还原细致 Prompt',
    defaultEndpoint: 'https://api.openai.com/v1/images/generations',
    defaultModel: 'dall-e-3',
    popularModels: ['dall-e-3', 'dall-e-2'],
    docHint: '需填入官方 OpenAI API Key (sk-...) 或对应的官方中转反向代理地址。'
  },
  {
    id: 'midjourney',
    name: 'Midjourney 代理',
    badge: '艺术质感',
    description: '支持 Midjourney-Proxy 或 NewAPI Midjourney 渠道',
    defaultEndpoint: 'https://api.openai-proxy.org/v1/images/generations',
    defaultModel: 'midjourney',
    popularModels: ['midjourney', 'mj-chat', 'flux-1-schnell'],
    docHint: '适用于第三方聚合站或 Midjourney 协议代理服务。'
  },
  {
    id: 'custom',
    name: '自定义 API 接口',
    badge: '自由配置',
    description: '支持任意兼容 OpenAI /v1/images/generations 或 ChatCompletions 的服务端',
    defaultEndpoint: 'https://your-api-domain.com/v1/images/generations',
    defaultModel: 'flux-1-schnell',
    popularModels: ['flux-1-schnell', 'stable-diffusion-xl', 'dall-e-3'],
    docHint: '支持任意符合 OpenAI 规范的私有部署或第三方中转服务，支持自动通道识别。'
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
}

export const BGM_TRACKS: BgmTrackDefinition[] = [
  {
    id: 'epic-cinematic',
    title: '🌌 宇宙史诗 · 电影原声',
    category: '电影原声',
    bpm: 85,
    mood: '宏大、神秘、院线史诗交响',
    previewColor: '#6366f1',
    url: '/audio/bgm/epic-cinematic.mp3',
    fallbackUrl: 'https://commondatastorage.googleapis.com/codeskulptor-assets/sounddogs/soundtrack.mp3',
    durationText: '01:31'
  },
  {
    id: 'chill-lofi',
    title: '☕ 轻松复古 · 80s 律动',
    category: '轻松复古',
    bpm: 78,
    mood: '治愈、节奏、惬意舒适',
    previewColor: '#f59e0b',
    url: '/audio/bgm/chill-lofi.mp3',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/goldfire/howler.js@master/examples/player/audio/80s_vibe.mp3',
    durationText: '01:00'
  },
  {
    id: 'cyber-pulse',
    title: '⚡ 赛博狂飙 · 电子狂欢',
    category: '电子科幻',
    bpm: 120,
    mood: '科技、前沿、能量充沛',
    previewColor: '#ec4899',
    url: '/audio/bgm/cyber-pulse.mp3',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/goldfire/howler.js@master/examples/player/audio/rave_digger.mp3',
    durationText: '01:18'
  },
  {
    id: 'running-energy',
    title: '🔥 高燃动感 · 活力冲刺',
    category: '高燃卡点',
    bpm: 128,
    mood: '极速、昂扬、爆发力',
    previewColor: '#f97316',
    url: '/audio/bgm/running-energy.mp3',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/goldfire/howler.js@master/examples/player/audio/running_out.mp3',
    durationText: '01:08'
  },
  {
    id: 'ambient-ethereal',
    title: '✨ 空灵幻境 · 梦幻光影',
    category: '唯美氛围',
    bpm: 68,
    mood: '空灵、诗意、情绪沉浸',
    previewColor: '#a855f7',
    url: '/audio/bgm/ambient-ethereal.ogg',
    fallbackUrl: 'https://commondatastorage.googleapis.com/codeskulptor-assets/Epoq-Lepidoptera.ogg',
    durationText: '04:32'
  },
  {
    id: 'tech-future',
    title: '🚀 科技脉冲 · 智能未来',
    category: '商业科技',
    bpm: 110,
    mood: '现代、智能、轻快节奏',
    previewColor: '#06b6d4',
    url: '/audio/bgm/tech-future.mp3',
    fallbackUrl: 'https://raw.githubusercontent.com/mdn/webaudio-examples/master/audio-analyser/viper.mp3',
    durationText: '00:41'
  },
  {
    id: 'warm-acoustic',
    title: '🌿 温暖叙事 · 情感治愈',
    category: '生活纪实',
    bpm: 90,
    mood: '温情、自然、娓娓道来',
    previewColor: '#10b981',
    url: '/audio/bgm/warm-acoustic.mp3',
    fallbackUrl: 'https://cdn.jsdelivr.net/gh/rafaelreis-hotmart/Audio-Sample-files/sample.mp3',
    durationText: '04:36'
  },
  {
    id: 'deep-exploration',
    title: '🪐 深空探索 · 沉浸迷幻',
    category: '纪录探索',
    bpm: 75,
    mood: '深邃、沉浸、奇幻探索',
    previewColor: '#3b82f6',
    url: '/audio/bgm/deep-exploration.mp3',
    fallbackUrl: 'https://commondatastorage.googleapis.com/codeskulptor-demos/DDR_assets/Sevish_-__nbsp_.mp3',
    durationText: '03:40'
  }
];

export const DEFAULT_SUBTITLE_CONFIG: SubtitleConfig = {
  enabled: true,
  preset: 'viral-yellow',
  fontSize: 26,
  fontFamily: 'system-ui, sans-serif',
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
  bgmTrackId: 'epic-cinematic',
  bgmVolume: 0.10,
  voiceoverEnabled: true,
  voiceoverVolume: 0.95,
  voiceCharacter: 'magnetic-male',
  speechRate: 1.0,
  audioDucking: true
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
      bgmTrackId: 'epic-cinematic'
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
      bgmTrackId: 'cyber-pulse'
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
