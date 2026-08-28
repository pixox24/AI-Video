import { AudioConfig, CustomTtsApiConfig, ProjectSettings, VideoProject } from '../types';
import { resolveTtsApi } from './presets';

export interface TtsVoiceOption {
  id: string;
  name: string;
  desc: string;
  badge: string;
}

export const EDGE_TTS_VOICES: TtsVoiceOption[] = [
  { id: 'magnetic-male', name: '磁性男声 (云希)', desc: '影视解说 / 短视频第一爆款音色', badge: '影视标配' },
  { id: 'warm-female', name: '温柔女声 (晓晓)', desc: '亲和治愈，适合生活美学 / 情感哲思', badge: '全网热门' },
  { id: 'tech-anchor', name: '商业播音 (云扬)', desc: '干练专业，适合科技前沿 / 商业资讯', badge: '商业首选' },
  { id: 'documentary-male', name: '纪录片沉稳 (云健)', desc: '深沉浑厚，适合历史大片 / 地理探索', badge: '史诗大片' },
  { id: 'vibrant-creator', name: '活力主播 (晓伊)', desc: '轻快自然，适合好物种草 / 旅行日常', badge: '生动自然' },
  { id: 'bilingual-en', name: '美语播音 (Christopher)', desc: '地道国际双语播音主播音色', badge: '双语国际' }
];

export const BAILIAN_TTS_VOICES: TtsVoiceOption[] = [
  { id: 'Cherry', name: 'Cherry 甜美活力', desc: '轻快女声，适合带货和生活口播', badge: '百炼默认' },
  { id: 'Serena', name: 'Serena 温柔知性', desc: '沉静女声，适合情绪和故事', badge: '温柔' },
  { id: 'Ethan', name: 'Ethan 沉稳磁性', desc: '男声底盘，适合科普和解读', badge: '沉稳' },
  { id: 'Chelsie', name: 'Chelsie 清晰播音', desc: '字正腔圆，适合教程和资讯', badge: '播音' },
  { id: 'Jasper', name: 'Jasper 年轻阳光', desc: '偏年轻男声，适合热点和金句', badge: '阳光' }
];

const EDGE_PERSONA_IDS = new Set(EDGE_TTS_VOICES.map((item) => item.id));
const BAILIAN_VOICE_IDS = new Set(BAILIAN_TTS_VOICES.map((item) => item.id));

const EDGE_TO_BAILIAN: Record<string, string> = {
  'magnetic-male': 'Ethan',
  'warm-female': 'Serena',
  'tech-anchor': 'Chelsie',
  'documentary-male': 'Ethan',
  'mystery-noir': 'Ethan',
  'vibrant-creator': 'Cherry',
  'bilingual-en': 'Cherry',
  'bilingual-female': 'Serena'
};

const BAILIAN_TO_EDGE: Record<string, string> = {
  Cherry: 'vibrant-creator',
  Serena: 'warm-female',
  Ethan: 'magnetic-male',
  Chelsie: 'tech-anchor',
  Jasper: 'magnetic-male'
};

export function ttsVoicesForApi(api?: CustomTtsApiConfig): TtsVoiceOption[] {
  const resolved = resolveTtsApi(api);
  if (resolved.provider === 'bailian' && resolved.enabled !== false && resolved.apiKey.trim()) {
    return BAILIAN_TTS_VOICES;
  }
  return EDGE_TTS_VOICES;
}

export function defaultTtsVoiceId(api?: CustomTtsApiConfig): string {
  const voices = ttsVoicesForApi(api);
  return voices[0]?.id || 'magnetic-male';
}

export function ttsEngineLabel(api?: CustomTtsApiConfig): string {
  const resolved = resolveTtsApi(api);
  if (resolved.provider === 'bailian') {
    if (resolved.enabled !== false && resolved.apiKey.trim()) {
      return `阿里云百炼 · ${resolved.model || 'Qwen-TTS'}`;
    }
    return '阿里云百炼（未填密钥，暂用 Edge）';
  }
  if (resolved.provider === 'minimax') return 'MiniMax（尚未开放）';
  if (resolved.provider === 'azure') return 'Azure Speech（尚未开放）';
  if (resolved.provider === 'custom') return '自定义 TTS';
  return '内置 Edge TTS';
}

export function ttsSupportsSpeechRate(api?: CustomTtsApiConfig): boolean {
  const resolved = resolveTtsApi(api);
  return !(resolved.provider === 'bailian' && resolved.enabled !== false && resolved.apiKey.trim());
}

export function isEdgePersonaId(id: string | null | undefined): boolean {
  return !!id && (EDGE_PERSONA_IDS.has(id) || id === 'mystery-noir' || id === 'bilingual-female');
}

export function isBailianVoiceId(id: string | null | undefined): boolean {
  return !!id && BAILIAN_VOICE_IDS.has(id);
}

export function resolveTtsVoiceId(voiceId: string | null | undefined, api?: CustomTtsApiConfig): string {
  const catalog = ttsVoicesForApi(api);
  const trimmed = (voiceId || '').trim();
  if (trimmed && catalog.some((item) => item.id === trimmed)) return trimmed;

  const resolved = resolveTtsApi(api);
  const usingBailian = resolved.provider === 'bailian' && resolved.enabled !== false && resolved.apiKey.trim();
  if (usingBailian) {
    const mapped = EDGE_TO_BAILIAN[trimmed];
    if (mapped && catalog.some((item) => item.id === mapped)) return mapped;
    if (trimmed && !isEdgePersonaId(trimmed)) return trimmed;
    return 'Cherry';
  }

  const mapped = BAILIAN_TO_EDGE[trimmed];
  if (mapped && catalog.some((item) => item.id === mapped)) return mapped;
  return catalog[0]?.id || 'magnetic-male';
}

export function ttsSourceKey(api?: CustomTtsApiConfig, voiceId?: string | null): string {
  const resolved = resolveTtsApi(api);
  const voice = resolveTtsVoiceId(voiceId || resolved.voice, resolved);
  if (resolved.provider === 'bailian' && resolved.enabled !== false && resolved.apiKey.trim()) {
    return `bailian|${resolved.model || 'qwen3-tts-flash'}|${voice}`;
  }
  return `edge|${voice}`;
}

export function voiceOptionById(id: string | null | undefined, api?: CustomTtsApiConfig): TtsVoiceOption | null {
  if (!id) return null;
  const catalog = ttsVoicesForApi(api);
  return catalog.find((item) => item.id === id) || null;
}

export function applyVoiceToProject(project: Pick<VideoProject, 'audio' | 'settings'>, voiceId: string): {
  audio: AudioConfig;
  settings: ProjectSettings;
} {
  const api = resolveTtsApi(project.settings.customTtsApi);
  const voice = resolveTtsVoiceId(voiceId, api);
  return {
    audio: { ...project.audio, voiceCharacter: voice },
    settings: {
      ...project.settings,
      customTtsApi: { ...api, voice }
    }
  };
}

export function applyTtsSettingsToProject(
  project: Pick<VideoProject, 'audio' | 'settings'>,
  settings: ProjectSettings
): { audio: AudioConfig; settings: ProjectSettings } {
  const prevApi = resolveTtsApi(project.settings.customTtsApi);
  const nextApi = resolveTtsApi(settings.customTtsApi);
  const providerChanged = prevApi.provider !== nextApi.provider || Boolean(prevApi.apiKey.trim()) !== Boolean(nextApi.apiKey.trim());

  if (providerChanged) {
    const voice = resolveTtsVoiceId(project.audio.voiceCharacter, nextApi);
    return {
      audio: { ...project.audio, voiceCharacter: voice },
      settings: {
        ...settings,
        customTtsApi: { ...nextApi, voice }
      }
    };
  }

  if (nextApi.provider !== 'edge' && nextApi.voice && nextApi.voice !== project.audio.voiceCharacter) {
    const voice = resolveTtsVoiceId(nextApi.voice, nextApi);
    return {
      audio: { ...project.audio, voiceCharacter: voice },
      settings
    };
  }

  return { audio: project.audio, settings };
}
