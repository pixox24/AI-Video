export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5';

export type VisualStyle = 
  | 'photorealistic' 
  | 'cinematic' 
  | 'anime' 
  | 'cyberpunk' 
  | '3d-render' 
  | 'chinese-ink' 
  | 'vintage-film' 
  | 'vector-art';

export type CameraMotion = 
  | 'zoom-in' 
  | 'zoom-out' 
  | 'pan-left' 
  | 'pan-right' 
  | 'tilt-up' 
  | 'tilt-down' 
  | 'static' 
  | 'cinematic-orbit';

export type TransitionType = 'crossfade' | 'fade-black' | 'slide-left' | 'zoom-in' | 'none';

export type SubtitlePreset = 
  | 'viral-yellow' 
  | 'cinematic-bilingual' 
  | 'glow-capsule' 
  | 'neon-cyan' 
  | 'retro-typewriter' 
  | 'classic-contrast';

export type ClipImageStatus = 'idle' | 'queued' | 'generating' | 'success' | 'failed';

export interface StoryboardClip {
  id: string;
  order: number;
  duration: number; // in seconds (e.g. 3.5)
  narration: string; // The spoken text / voiceover
  secondaryText?: string; // Optional English/sub text
  visualPrompt: string; // The AI image prompt
  chineseVisualPrompt?: string;
  imageUrl?: string; // Generated image or template image
  isGeneratingImage?: boolean;
  imageStatus?: ClipImageStatus;
  imageError?: string;
  cameraMotion: CameraMotion;
  transition: TransitionType;
  voiceAudioUrl?: string;
}

export interface SubtitleConfig {
  enabled: boolean;
  preset: SubtitlePreset;
  fontSize: number; // 18 - 48
  fontFamily: string;
  positionY: number; // percentage from top, e.g., 82%
  primaryColor: string;
  highlightColor: string;
  backgroundColor: string;
  showBackground: boolean;
  showShadow: boolean;
  showStroke: boolean;
  strokeColor: string;
  animation: 'pop' | 'fade' | 'karaoke' | 'none';
  bilingual: boolean;
  autoWrap?: boolean; // Automatic multi-line wrapping to prevent screen overflow
  maxLines?: number; // Max allowed lines before scaling font (default 2 or 3)
  maxWidthRatio?: number; // Safe width ratio (e.g., 0.84 = 84% screen width)
  lineSpacing?: number; // Line spacing multiplier (e.g., 1.3)
}

export interface AudioConfig {
  bgmEnabled: boolean;
  bgmTrackId: string;
  bgmVolume: number; // 0.0 - 1.0
  voiceoverEnabled: boolean;
  voiceoverVolume: number; // 0.0 - 1.0
  voiceCharacter: 
    | 'magnetic-male' 
    | 'warm-female' 
    | 'tech-anchor' 
    | 'mystery-noir' 
    | 'documentary-male'
    | 'vibrant-creator'
    | 'bilingual-en';
  speechRate: number; // 0.8 - 1.5
  audioDucking: boolean; // lowers BGM when voice is active
  customBgmUrl?: string;
}

export interface CustomImageApiConfig {
  enabled: boolean;
  provider: 'builtin' | 'siliconflow' | 'openai' | 'midjourney' | 'oneapi' | 'custom';
  endpoint: string; // e.g. https://api.siliconflow.cn/v1/images/generations or https://api.change2pro.com
  apiKey: string;
  model: string; // e.g. black-forest-labs/FLUX.1-schnell, dall-e-3
  size: 'auto' | '1024x1024' | '1024x1792' | '1792x1024' | '512x512';
  protocol?: 'auto' | 'images' | 'chat-completions';
  quality?: 'standard' | 'hd';
  concurrency?: number; // 1 to 6 (default: 3)
}

export interface CustomLlmApiConfig {
  enabled: boolean;
  provider: 'deepseek' | 'openai' | 'custom';
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface CustomTtsApiConfig {
  enabled: boolean;
  provider: 'edge' | 'azure' | 'minimax' | 'custom';
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface CustomVideoApiConfig {
  enabled: boolean;
  provider: 'kling' | 'runway' | 'luma' | 'custom';
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface ProjectSettings {
  aspectRatio: AspectRatio;
  canvasBackground: string; // hex or 'blur'
  visualStyle: VisualStyle;
  safeMargin: boolean;
  exportQuality: '1080p' | '720p' | '4k';
  frameRate: 30 | 60;
  customImageApi?: CustomImageApiConfig;
  customLlmApi?: CustomLlmApiConfig;
  customTtsApi?: CustomTtsApiConfig;
  customVideoApi?: CustomVideoApiConfig;
}

export interface VideoProject {
  id: string;
  title: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  clips: StoryboardClip[];
  subtitles: SubtitleConfig;
  audio: AudioConfig;
  settings: ProjectSettings;
}

export type ActiveTab = 'script' | 'storyboard' | 'style' | 'subtitles' | 'audio' | 'projects' | 'settings';

export type ScriptSubTab = 'one-click' | 'batch-topics';

export type StoryboardSubTab = 'split' | 'shots';
