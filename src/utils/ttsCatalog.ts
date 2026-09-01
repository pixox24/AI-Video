import { AudioConfig, CustomTtsApiConfig, ProjectSettings, VideoProject } from '../types';
import { resolveTtsApi } from './presets';

export interface TtsVoiceOption {
  id: string;
  name: string;
  desc: string;
  badge: string;
}

export const QWEN3_TTS_HTTP_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const QWEN_AUDIO_TTS_HTTP_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';

export const EDGE_TTS_VOICES: TtsVoiceOption[] = [
  { id: 'magnetic-male', name: '磁性男声 (云希)', desc: '影视解说 / 短视频第一爆款音色', badge: '影视标配' },
  { id: 'warm-female', name: '温柔女声 (晓晓)', desc: '亲和治愈，适合生活美学 / 情感哲思', badge: '全网热门' },
  { id: 'tech-anchor', name: '商业播音 (云扬)', desc: '干练专业，适合科技前沿 / 商业资讯', badge: '商业首选' },
  { id: 'documentary-male', name: '纪录片沉稳 (云健)', desc: '深沉浑厚，适合历史大片 / 地理探索', badge: '史诗大片' },
  { id: 'vibrant-creator', name: '活力主播 (晓伊)', desc: '轻快自然，适合好物种草 / 旅行日常', badge: '生动自然' },
  { id: 'bilingual-en', name: '美语播音 (Christopher)', desc: '地道国际双语播音主播音色', badge: '双语国际' }
];

export const QWEN3_TTS_VOICES: TtsVoiceOption[] = [
  { id: 'Cherry', name: 'Cherry 甜美活力', desc: '轻快女声，适合带货和生活口播', badge: '百炼默认' },
  { id: 'Serena', name: 'Serena 温柔知性', desc: '沉静女声，适合情绪和故事', badge: '温柔' },
  { id: 'Ethan', name: 'Ethan 沉稳磁性', desc: '男声底盘，适合科普和解读', badge: '沉稳' },
  { id: 'Chelsie', name: 'Chelsie 清晰播音', desc: '字正腔圆，适合教程和资讯', badge: '播音' },
  { id: 'Jasper', name: 'Jasper 年轻阳光', desc: '偏年轻男声，适合热点和金句', badge: '阳光' }
];

/** @deprecated 使用 QWEN3_TTS_VOICES；保留别名以免旧引用断裂 */
export const BAILIAN_TTS_VOICES = QWEN3_TTS_VOICES;

export const QWEN_AUDIO_PLUS_VOICES: TtsVoiceOption[] = [
  { id: 'longanlingxin', name: '龙安灵心', desc: '知心温暖女声，3.0 Plus 旗舰音色', badge: '旗舰女声' },
  { id: 'longanlufeng', name: '龙安鲁风', desc: '明亮开朗男声，3.0 Plus 旗舰音色', badge: '旗舰男声' }
];

export const QWEN_AUDIO_FLASH_VOICES: TtsVoiceOption[] = [
  { id: 'longanfengyue', name: '龙安风悦', desc: '自然亲切女声，适合口播和陪伴', badge: '推荐' },
  { id: 'longanlingxi', name: '龙安灵希', desc: '可爱甜美女声，适合带货和生活', badge: '甜美' },
  { id: 'longanxiaoxin', name: '龙安小昕', desc: '亲切活泼女声，适合种草和日常', badge: '活泼' },
  { id: 'longanhuan_v3.6', name: '龙安欢', desc: '标准女声，适合通用旁白', badge: '通用' },
  { id: 'longanyuanfei', name: '龙安元妃', desc: '高傲妃子音，适合角色和故事', badge: '角色' },
  { id: 'longchuanshu_v3.6', name: '龙川叔', desc: '川普大叔音，Flash 系统里的成年男声', badge: '川普' },
  { id: 'longhuohuo_v3.6', name: '龙火火', desc: '顽皮少年音，适合角色配音', badge: '少年' },
  { id: 'longjielidou_v3.6', name: '龙杰力豆', desc: '天真男童，适合儿童向内容', badge: '男童' },
  { id: 'longpaopao_v3.6', name: '龙泡泡', desc: '软糯可爱女童音', badge: '女童' },
  { id: 'loongmary', name: 'loongmary', desc: '温暖英音女声，适合英文旁白', badge: '英音' },
  { id: 'loongeva_v3.6', name: 'loongeva', desc: '高智美音女声，适合英文旁白', badge: '美音' },
  { id: 'loongjohn', name: 'loongJohn', desc: '沉稳亲切美音男声，适合英文旁白', badge: '美音' }
];

const EDGE_PERSONA_IDS = new Set(EDGE_TTS_VOICES.map((item) => item.id));
const QWEN3_VOICE_IDS = new Set(QWEN3_TTS_VOICES.map((item) => item.id));
const PLUS_VOICE_IDS = new Set(QWEN_AUDIO_PLUS_VOICES.map((item) => item.id));
const FLASH_VOICE_IDS = new Set(QWEN_AUDIO_FLASH_VOICES.map((item) => item.id));
const ALL_BAILIAN_VOICE_IDS = new Set([
  ...QWEN3_VOICE_IDS,
  ...PLUS_VOICE_IDS,
  ...FLASH_VOICE_IDS
]);

const MALE_VOICE_IDS = new Set([
  'Ethan',
  'Jasper',
  'magnetic-male',
  'documentary-male',
  'mystery-noir',
  'longanlufeng',
  'longchuanshu_v3.6',
  'longhuohuo_v3.6',
  'longjielidou_v3.6',
  'loongjohn'
]);

const EDGE_TO_QWEN3: Record<string, string> = {
  'magnetic-male': 'Ethan',
  'warm-female': 'Serena',
  'tech-anchor': 'Chelsie',
  'documentary-male': 'Ethan',
  'mystery-noir': 'Ethan',
  'vibrant-creator': 'Cherry',
  'bilingual-en': 'Cherry',
  'bilingual-female': 'Serena'
};

const TO_EDGE: Record<string, string> = {
  Cherry: 'vibrant-creator',
  Serena: 'warm-female',
  Ethan: 'magnetic-male',
  Chelsie: 'tech-anchor',
  Jasper: 'magnetic-male',
  longanlingxin: 'warm-female',
  longanlufeng: 'magnetic-male',
  longanfengyue: 'warm-female',
  longanlingxi: 'vibrant-creator',
  longanxiaoxin: 'vibrant-creator',
  'longanhuan_v3.6': 'warm-female',
  longanyuanfei: 'tech-anchor',
  'longchuanshu_v3.6': 'documentary-male',
  'longhuohuo_v3.6': 'magnetic-male',
  'longjielidou_v3.6': 'magnetic-male',
  'longpaopao_v3.6': 'warm-female',
  loongmary: 'bilingual-en',
  'loongeva_v3.6': 'bilingual-en',
  loongjohn: 'bilingual-en'
};

export function isQwenAudioTtsModel(model?: string | null): boolean {
  const id = (model || '').trim().toLowerCase();
  return id.startsWith('qwen-audio-') || id.startsWith('cosyvoice-');
}

export function isQwenAudioPlusModel(model?: string | null): boolean {
  return (model || '').trim().toLowerCase().includes('qwen-audio-3.0-tts-plus');
}

export function isQwenAudioFlashModel(model?: string | null): boolean {
  return (model || '').trim().toLowerCase().includes('qwen-audio-3.0-tts-flash');
}

/** Qwen-Audio-3.0 提交接口官方 RPS 为 3，按句并发不能顶满。 */
export function bailianTtsConcurrency(api?: CustomTtsApiConfig): number {
  const resolved = resolveTtsApi(api);
  if (resolved.provider !== 'bailian' || resolved.enabled === false || !resolved.apiKey.trim()) return 2;
  if (isQwenAudioTtsModel(resolved.model)) return 1;
  return 2;
}

function isGenerationEndpoint(url: string): boolean {
  return /\/aigc\/multimodal-generation\/generation\/?$/i.test(url);
}

function isSpeechSynthesizerEndpoint(url: string): boolean {
  return /\/audio\/tts\/SpeechSynthesizer\/?$/i.test(url);
}

export function defaultEndpointForTtsModel(model?: string | null): string {
  return isQwenAudioTtsModel(model) ? QWEN_AUDIO_TTS_HTTP_ENDPOINT : QWEN3_TTS_HTTP_ENDPOINT;
}

export function resolveBailianTtsEndpoint(endpoint: string | undefined, model?: string | null): string {
  const trimmed = (endpoint || '').trim();
  if (isQwenAudioTtsModel(model)) {
    if (!trimmed || isGenerationEndpoint(trimmed)) return QWEN_AUDIO_TTS_HTTP_ENDPOINT;
    return trimmed;
  }
  if (!trimmed || isSpeechSynthesizerEndpoint(trimmed)) return QWEN3_TTS_HTTP_ENDPOINT;
  return trimmed;
}

export function defaultVoiceForModel(model?: string | null): string {
  if (isQwenAudioPlusModel(model)) return 'longanlingxin';
  if (isQwenAudioFlashModel(model) || isQwenAudioTtsModel(model)) return 'longanfengyue';
  return 'Cherry';
}

export function voicesForTtsModel(model?: string | null): TtsVoiceOption[] {
  if (isQwenAudioPlusModel(model)) return QWEN_AUDIO_PLUS_VOICES;
  if (isQwenAudioFlashModel(model) || isQwenAudioTtsModel(model)) return QWEN_AUDIO_FLASH_VOICES;
  return QWEN3_TTS_VOICES;
}

export function qwenAudioSampleRate(model?: string | null): number {
  return isQwenAudioPlusModel(model) ? 48000 : 24000;
}

export function qwenAudioLanguageHints(text: string): string[] {
  return /[\u4e00-\u9fa5]/.test(text) ? ['zh'] : ['en'];
}

function isMaleVoice(id: string): boolean {
  return MALE_VOICE_IDS.has(id);
}

export const QWEN_AUDIO_VOICE_DESIGN_ENDPOINT =
  'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization';

export function isDesignedVoiceId(id?: string | null): boolean {
  return /^qwen-audio-3\.0-tts-(plus|flash)-vd-/i.test((id || '').trim());
}

export function designedVoiceMatchesModel(voiceId?: string | null, model?: string | null): boolean {
  const id = (voiceId || '').trim();
  if (!isDesignedVoiceId(id)) return false;
  if (isQwenAudioPlusModel(model)) return /^qwen-audio-3\.0-tts-plus-vd-/i.test(id);
  if (isQwenAudioFlashModel(model)) return /^qwen-audio-3\.0-tts-flash-vd-/i.test(id);
  return false;
}

export function isVoiceDesignAvailable(api?: CustomTtsApiConfig): boolean {
  const resolved = resolveTtsApi(api);
  if (resolved.provider !== 'bailian' || resolved.enabled === false || !resolved.apiKey.trim()) return false;
  return isQwenAudioPlusModel(resolved.model) || isQwenAudioFlashModel(resolved.model);
}

export function resolveBailianVoiceDesignEndpoint(endpoint?: string | null): string {
  const trimmed = (endpoint || '').trim();
  const maas = trimmed.match(/^(https:\/\/[^/]+\.maas\.aliyuncs\.com)/i);
  if (maas) return `${maas[1]}/api/v1/services/audio/tts/customization`;
  return QWEN_AUDIO_VOICE_DESIGN_ENDPOINT;
}

function remapAudio30BaseVoice(voice: string, model?: string | null): string | null {
  if (isDesignedVoiceId(voice)) return null;
  const match = voice.match(/^qwen-audio-3\.0-tts-(plus|flash)-(.+)$/i);
  if (!match) return null;
  if (isQwenAudioPlusModel(model)) return `qwen-audio-3.0-tts-plus-${match[2]}`;
  if (isQwenAudioFlashModel(model) || isQwenAudioTtsModel(model)) return `qwen-audio-3.0-tts-flash-${match[2]}`;
  return null;
}

function mapVoiceToModel(voiceId: string, model?: string | null): string {
  const trimmed = voiceId.trim();
  const catalog = voicesForTtsModel(model);
  if (trimmed && catalog.some((item) => item.id === trimmed)) return trimmed;

  const remappedBase = remapAudio30BaseVoice(trimmed, model);
  if (remappedBase) return remappedBase;

  if (isQwenAudioPlusModel(model)) {
    return isMaleVoice(trimmed) ? 'longanlufeng' : 'longanlingxin';
  }
  if (isQwenAudioFlashModel(model) || isQwenAudioTtsModel(model)) {
    if (trimmed === 'Cherry' || trimmed === 'vibrant-creator' || trimmed === 'longanlingxi') return 'longanlingxi';
    if (trimmed === 'Chelsie' || trimmed === 'tech-anchor' || trimmed === 'longanyuanfei') return 'longanyuanfei';
    if (trimmed === 'Jasper' || trimmed === 'longhuohuo_v3.6') return 'longhuohuo_v3.6';
    if (trimmed === 'bilingual-en' || trimmed === 'loongmary' || trimmed === 'loongeva_v3.6') return 'loongmary';
    if (trimmed === 'loongjohn') return 'loongjohn';
    return isMaleVoice(trimmed) ? 'longchuanshu_v3.6' : 'longanfengyue';
  }

  const fromEdge = EDGE_TO_QWEN3[trimmed];
  if (fromEdge) return fromEdge;
  if (isMaleVoice(trimmed)) return 'Ethan';
  if (trimmed === 'tech-anchor' || trimmed === 'Chelsie' || trimmed === 'longanyuanfei') return 'Chelsie';
  if (trimmed === 'vibrant-creator' || trimmed === 'Cherry' || trimmed === 'longanlingxi') return 'Cherry';
  return 'Serena';
}

export function ttsVoicesForApi(api?: CustomTtsApiConfig): TtsVoiceOption[] {
  const resolved = resolveTtsApi(api);
  if (resolved.provider === 'bailian' && resolved.enabled !== false && resolved.apiKey.trim()) {
    return voicesForTtsModel(resolved.model);
  }
  return EDGE_TTS_VOICES;
}

export function defaultTtsVoiceId(api?: CustomTtsApiConfig): string {
  const resolved = resolveTtsApi(api);
  if (resolved.provider === 'bailian' && resolved.enabled !== false && resolved.apiKey.trim()) {
    return defaultVoiceForModel(resolved.model);
  }
  return EDGE_TTS_VOICES[0]?.id || 'magnetic-male';
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
  const usingBailian = resolved.provider === 'bailian' && resolved.enabled !== false && resolved.apiKey.trim();
  if (!usingBailian) return true;
  return isQwenAudioTtsModel(resolved.model);
}

export function isEdgePersonaId(id: string | null | undefined): boolean {
  return !!id && (EDGE_PERSONA_IDS.has(id) || id === 'mystery-noir' || id === 'bilingual-female');
}

export function isBailianVoiceId(id: string | null | undefined): boolean {
  return !!id && ALL_BAILIAN_VOICE_IDS.has(id);
}

function isForeignSystemVoice(id: string, model?: string | null): boolean {
  if (!id) return false;
  const catalogIds = new Set(voicesForTtsModel(model).map((item) => item.id));
  if (catalogIds.has(id)) return false;
  return ALL_BAILIAN_VOICE_IDS.has(id) || isEdgePersonaId(id);
}

export function resolveTtsVoiceId(voiceId: string | null | undefined, api?: CustomTtsApiConfig): string {
  const catalog = ttsVoicesForApi(api);
  const trimmed = (voiceId || '').trim();
  if (trimmed && catalog.some((item) => item.id === trimmed)) return trimmed;

  const resolved = resolveTtsApi(api);
  const usingBailian = resolved.provider === 'bailian' && resolved.enabled !== false && resolved.apiKey.trim();
  if (usingBailian) {
    if (trimmed) {
      if (designedVoiceMatchesModel(trimmed, resolved.model)) return trimmed;
      if (isDesignedVoiceId(trimmed)) return defaultVoiceForModel(resolved.model);
      const mapped = mapVoiceToModel(trimmed, resolved.model);
      if (catalog.some((item) => item.id === mapped)) return mapped;
      const remappedBase = remapAudio30BaseVoice(trimmed, resolved.model);
      if (remappedBase) return remappedBase;
      if (!isForeignSystemVoice(trimmed, resolved.model)) return trimmed;
    }
    return defaultVoiceForModel(resolved.model);
  }

  if (trimmed && TO_EDGE[trimmed] && catalog.some((item) => item.id === TO_EDGE[trimmed])) {
    return TO_EDGE[trimmed];
  }
  return catalog[0]?.id || 'magnetic-male';
}

export function ttsSourceKey(api?: CustomTtsApiConfig, voiceId?: string | null): string {
  const resolved = resolveTtsApi(api);
  const voice = resolveTtsVoiceId(voiceId || resolved.voice, resolved);
  if (resolved.provider === 'bailian' && resolved.enabled !== false && resolved.apiKey.trim()) {
    return `bailian|${resolved.model || 'qwen-audio-3.0-tts-flash'}|${voice}`;
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
  const providerChanged =
    prevApi.provider !== nextApi.provider || Boolean(prevApi.apiKey.trim()) !== Boolean(nextApi.apiKey.trim());
  const modelChanged = prevApi.model !== nextApi.model;

  if (providerChanged || modelChanged) {
    const voice = resolveTtsVoiceId(project.audio.voiceCharacter, nextApi);
    const endpoint =
      nextApi.provider === 'bailian' ? resolveBailianTtsEndpoint(nextApi.endpoint, nextApi.model) : nextApi.endpoint;
    return {
      audio: { ...project.audio, voiceCharacter: voice },
      settings: {
        ...settings,
        customTtsApi: { ...nextApi, voice, endpoint }
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
