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

export interface NarrationClipTiming {
  clipId: string;
  audioStart: number;
  audioEnd: number;
}

export type NarrationAlignSource = 'per-utterance' | 'word-boundary' | 'energy' | 'char-fallback';

export interface NarrationWordMark {
  text: string;
  start: number;
  end: number;
}

export interface NarrationUtteranceMark {
  text: string;
  audioStart: number;
  audioEnd: number;
  clipIds: string[];
  source: NarrationAlignSource;
}

export interface NarrationAlignment {
  version: 2;
  source: NarrationAlignSource;
  utterances: NarrationUtteranceMark[];
}

export interface NarrationTrack {
  audioUrl: string;
  duration: number;
  speechStart?: number;
  speechEnd?: number;
  voiceCharacter: string;
  speechRate: number;
  sourceHash: string;
  generatedAt: number;
  clips: NarrationClipTiming[];
  alignment?: NarrationAlignment;
}

export interface StoryboardClip {
  id: string;
  order: number;
  duration: number; // in seconds (e.g. 3.5) = speechDuration + holdDuration
  speechDuration?: number; // locked narration span on the full track
  holdDuration?: number; // extra picture hold after speech ends
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
  voSpanId?: string;
  voRole?: 'start' | 'continue';
  voSlice?: string;
  holdPinned?: boolean;
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
  voiceCharacter: string;
  speechRate: number; // 0.8 - 1.5
  audioDucking: boolean; // lowers BGM when voice is active
  customBgmUrl?: string;
  narrationTrack?: NarrationTrack;
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
  provider: 'builtin' | 'deepseek' | 'openai' | 'custom';
  endpoint: string;
  apiKey: string;
  model: string;
}

export type ClipsChange =
  | StoryboardClip[]
  | ((prev: StoryboardClip[]) => StoryboardClip[]);

export interface CustomTtsApiConfig {
  enabled: boolean;
  provider: 'edge' | 'bailian' | 'azure' | 'minimax' | 'custom';
  endpoint: string;
  apiKey: string;
  model: string;
  voice: string;
}

export interface CustomVideoApiConfig {
  enabled: boolean;
  provider: 'kling' | 'runway' | 'luma' | 'custom';
  endpoint: string;
  apiKey: string;
  model: string;
}

export type StyleSource = 'preset' | 'inferred' | 'hybrid';
export type ContemporaryPolicy = 'adapt' | 'costume' | 'filter';
export type StyleDnaModule =
  | 'color'
  | 'lighting'
  | 'material'
  | 'rendering'
  | 'mood'
  | 'lens'
  | 'graphic'
  | 'world';

export interface StyleWorld {
  era: string;
  wardrobe: string;
  space: string;
  must: string[];
  dont: string[];
}

export interface StyleRender {
  medium: string;
  lighting: string;
  lens: string;
  quality: string;
}

export interface StyleDna {
  color?: { palette: string[]; ratio?: string; saturation?: string; contrast?: string };
  lighting?: { key?: string; rim?: string; shadows?: string; atmosphere?: string };
  lens?: { camera?: string; depth?: string; negativeSpace?: string };
  material?: { surface?: string; grain?: string };
  rendering?: { medium?: string; edgeQuality?: string };
  graphic?: { motifs?: string[]; typeFeel?: string };
  mood?: string[];
}

export interface StyleReference {
  imageId: string;
  thumbDataUrl?: string;
  notes?: string;
}

export interface StylePack {
  id: string;
  source: StyleSource;
  label: string;
  world: StyleWorld;
  render: StyleRender;
  contemporaryPolicy: ContemporaryPolicy;
  dna?: StyleDna;
  contentToIgnore?: string[];
  transferModules?: StyleDnaModule[];
  reference?: StyleReference;
  confidence?: number;
  pinned?: boolean;
  createdAt: number;
}

export interface StyleLibraryEntry {
  id: string;
  pack: StylePack;
  title: string;
  tags: string[];
  blurb: string;
  thumbDataUrl?: string;
  imageHash?: string;
  nearestVisualStyle: VisualStyle;
  createdAt: number;
  updatedAt: number;
}

export interface CustomStyleVisionApiConfig {
  enabled: boolean;
  provider: 'bailian';
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface StyleShelfConfig {
  hiddenPresetIds: VisualStyle[];
}

export interface ProjectSettings {
  aspectRatio: AspectRatio;
  canvasBackground: string; // hex or 'blur'
  visualStyle: VisualStyle;
  activeStylePack?: StylePack;
  customStyleVisionApi?: CustomStyleVisionApiConfig;
  styleShelf?: StyleShelfConfig;
  safeMargin: boolean;
  exportQuality: '1080p' | '720p' | '4k';
  frameRate: 30 | 60;
  customImageApi?: CustomImageApiConfig;
  customLlmApi?: CustomLlmApiConfig;
  customTtsApi?: CustomTtsApiConfig;
  customVideoApi?: CustomVideoApiConfig;
}

export type ScriptStage = 'intent' | 'topic' | 'research' | 'duration' | 'beats' | 'copy' | 'rhythm';
export type ScriptIntent = 'blank' | 'direction' | 'product' | 'reference' | 'have-script';
export type ScriptGenre = '科普' | '反常识' | '故事' | '教程' | '带货' | '情绪' | '热点解读' | '口播金句';
export type ScriptPace = 'ultrafast' | 'fast' | 'medium' | 'slow' | 'cinematic';
export type ScriptPlatform = 'douyin' | 'shipinhao' | 'reels' | 'bilibili' | 'youtube';
export type BeatFunction = 'hook' | 'setup' | 'turn' | 'proof' | 'reveal' | 'cta';
export type ShotEnergy = 'fast' | 'medium' | 'slow' | 'hold';
export type DirectorNoteLevel = 'info' | 'warn' | 'block';
export type ScriptGate = 'fast' | 'deep';

export type NarrativeStructure = 'myth_busting' | 'problem_solution' | 'story' | 'tutorial' | 'contrast' | 'reveal';
export type ResearchBladeId = 'competitor' | 'audience' | 'fact' | 'visual';

export interface TopicCard {
  id: string;
  title: string;
  hook: string;
  insight: string;
  genre: ScriptGenre;
  whyNow: string;
  durationHint: number;
  paceHint: ScriptPace;
  conceptCount: number;
  risk: string;
  completionFit: string;
  hookType: string;
  structure?: NarrativeStructure;
  whyThisWorks?: string;
}

export interface ResearchFinding {
  title: string;
  snippet: string;
  url: string;
}

export interface ResearchBlade {
  id: ResearchBladeId;
  label: string;
  query: string;
  findings: ResearchFinding[];
}

export interface ResearchBrief {
  summary: string;
  blades: ResearchBlade[];
  notes: ResearchNotes;
  source: 'web' | 'model' | 'mixed';
  fetchedAt: number;
}

export interface ReferenceBreakdown {
  url: string;
  title: string;
  keep: string[];
  change: string[];
  whyBetter: string;
  hookStyle: string;
  pacingNote: string;
}

export interface ConceptMix {
  hookFromId: string | null;
  structureFromId: string | null;
}

export interface DurationBudget {
  targetSeconds: number;
  platform: ScriptPlatform;
  pace: ScriptPace;
  charsPerSecond: number;
  speechSeconds: number;
  holdSeconds: number;
  maxChars: number;
  usedChars: number;
  conceptMax: number;
  conceptUsed: number;
  lockedShotCount: number | null;
}

export interface ScriptBeat {
  id: string;
  order: number;
  function: BeatFunction;
  intent: string;
  narration: string;
  targetSeconds: number;
  energy: ShotEnergy;
  visualIntent: string;
  needsHold: boolean;
}

export interface SpeechVisual {
  id: string;
  startRatio: number;
  endRatio: number;
  visualIntent: string;
  sliceText: string;
  splitReason: string;
}

export interface SpeechSpan {
  id: string;
  text: string;
  function: BeatFunction;
  energy: ShotEnergy;
  needsHold: boolean;
  visuals: SpeechVisual[];
}

export interface ForecastShot {
  id: string;
  order: number;
  start: number;
  speechDuration: number;
  holdDuration: number;
  energy: ShotEnergy;
  function: BeatFunction;
  visualIntent: string;
  narration: string;
  splitReason: string;
  holdPinned?: boolean;
  spanId?: string;
  visualIndex?: number;
  visualCount?: number;
  voRole?: 'start' | 'continue';
  sliceText?: string;
}

export interface DirectorNote {
  id: string;
  level: DirectorNoteLevel;
  message: string;
  target?: 'hook' | 'chars' | 'hold' | 'shot' | 'concept';
}

export interface ResearchNotes {
  competitor: string;
  audienceQuestion: string;
  fact: string;
  visualRef: string;
}

export interface ScriptWorkspace {
  stage: ScriptStage;
  gate: ScriptGate;
  intent: ScriptIntent | null;
  intentNotes: string;
  topicCards: TopicCard[];
  selectedTopicId: string | null;
  researchNotes: ResearchNotes;
  durationBudget: DurationBudget;
  beats: ScriptBeat[];
  fullNarration: string;
  speechSpans: SpeechSpan[];
  forecastShots: ForecastShot[];
  directorNotes: DirectorNote[];
  appliedShotCount?: number;
  appliedAt?: number;
  appliedScriptHash?: string;
  appliedStyleFingerprint?: string;
  referenceUrl: string;
  researchBrief: ResearchBrief | null;
  referenceBreakdown: ReferenceBreakdown | null;
  conceptMix: ConceptMix;
  genrePackId: ScriptGenre | null;
  hookPreviewUrl?: string;
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
  scriptWorkspace?: ScriptWorkspace;
}

export type ActiveTab = 'script' | 'storyboard' | 'style' | 'subtitles' | 'audio' | 'projects' | 'settings';

export type StoryboardSubTab = 'split' | 'shots';
