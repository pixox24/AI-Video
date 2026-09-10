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

export type ShotSize = 'ecu' | 'cu' | 'ms' | 'ws' | 'insert';
export type CameraAngle = 'eye' | 'low' | 'high';
export type ShotComposition = 'center' | 'thirds' | 'silhouette' | 'negative-left' | 'negative-right';
export type CoverageJob = 'hook' | 'establish' | 'evidence' | 'insert' | 'contrast' | 'callback';
export type CoverageLink = 'advance' | 'contrast-cut' | 'callback' | 'same-axis';
export type CoverageSource = 'rule' | 'llm' | 'pinned';

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
  /** Per-utterance TTS asset so later resynth can skip unchanged sentences. */
  audioUrl?: string;
  words?: NarrationWordMark[];
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

export interface VisualBeat {
  setting?: string;
  subject?: string;
  action?: string;
}

export interface StoryboardClip {
  id: string;
  order: number;
  duration: number; // in seconds (e.g. 3.5) = speechDuration + holdDuration
  speechDuration?: number; // locked narration span on the full track
  holdDuration?: number; // extra picture hold after speech ends
  sceneId?: string; // visual scene group; multiple clips may reuse one image
  narration: string; // Spoken VO in scriptLanguage
  secondaryText?: string; // Bilingual translation line (the other language)
  secondaryHash?: string; // Hash of the primary display text when secondaryText was produced; stale hash = wrong pairing
  visualPrompt: string; // Compiled image prompt last sent (or user-pinned)
  /** Bible source hash used when the prompt was compiled. */
  visualBibleHash?: string;
  chineseVisualPrompt?: string;
  visualBeat?: VisualBeat;
  promptPinned?: boolean;
  shotSize?: ShotSize;
  cameraAngle?: CameraAngle;
  shotComposition?: ShotComposition;
  coverageJob?: CoverageJob;
  coverageLink?: CoverageLink;
  coverageSource?: CoverageSource;
  imageUrl?: string; // Generated image or template image
  isGeneratingImage?: boolean;
  imageStatus?: ClipImageStatus;
  imageError?: string;
  /** Whether a character reference was sent to and accepted by the provider. */
  referenceStatus?: 'accepted' | 'dropped';
  cameraMotion: CameraMotion;
  transition: TransitionType;
  voiceAudioUrl?: string;
  voSpanId?: string;
  voRole?: 'start' | 'continue';
  voSlice?: string;
  holdPinned?: boolean;
  characterIds?: string[];
  locationId?: string;
  continuity?: VisualContinuity;
  occupancyPlan?: OccupancyPlan;
  subjectIds?: string[];
}

export interface SubtitleConfig {
  enabled: boolean;
  preset: SubtitlePreset;
  fontSize: number; // 18 - 48
  fontId?: string;
  fontFamily: string;
  secondaryFontId?: string;
  positionY: number; // percentage from top, e.g., 82%
  primaryColor: string;
  highlightColor: string;
  backgroundColor: string;
  showBackground: boolean;
  showShadow: boolean;
  showStroke: boolean;
  strokeColor: string;
  animation: 'pop' | 'fade' | 'karaoke' | 'none';
  bilingual: boolean; // draw translation line under the spoken primary line
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
  /** Inter-sentence breath in seconds. Applied as unpinned hold on utterance tails. */
  sentenceGap?: number;
  customBgmUrl?: string;
  narrationTrack?: NarrationTrack;
}

export type ImageApiProvider = 'siliconflow' | 'openai' | 'midjourney' | 'oneapi' | 'custom';

export interface CustomImageApiConfig {
  enabled: boolean;
  provider: ImageApiProvider | 'builtin';
  endpoint: string;
  apiKey: string;
  model: string;
  size: 'auto' | '1024x1024' | '1024x1792' | '1792x1024' | '512x512';
  protocol?: 'auto' | 'images' | 'chat-completions';
  quality?: 'standard' | 'hd';
  concurrency?: number;
  promptProfile?: 'auto' | 'gpt-image';
}

export interface ImageRetryConfig {
  enabled: boolean;
  maxRetries: number;
  useBackup: boolean;
}

export interface CustomLlmApiConfig {
  enabled: boolean;
  provider: 'builtin' | 'gemini' | 'deepseek' | 'bailian' | 'openai' | 'custom';
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

export type DesignedVoiceStatus = 'deploying' | 'ok' | 'undeployed' | 'missing';

export interface DesignedVoiceEntry {
  id: string;
  voiceId: string;
  targetModel: string;
  title: string;
  prompt: string;
  previewText: string;
  language: 'zh' | 'en';
  status: DesignedVoiceStatus;
  previewAudioUrl?: string;
  createdAt: number;
  updatedAt: number;
  source: 'designed' | 'imported' | 'cloned';
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

export interface OutroConfig {
  hold: number; // seconds of moving picture after the last narration ends (0-5)
  pictureFade: number; // seconds of fade-to-black at the very end (0-3)
  musicFade: number; // requested BGM fade-out length; clamped to the outro window (0-5)
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
  outro?: OutroConfig;
  customImageApi?: CustomImageApiConfig;
  backupImageApi?: CustomImageApiConfig;
  imageRetry?: ImageRetryConfig;
  customLlmApi?: CustomLlmApiConfig;
  customTtsApi?: CustomTtsApiConfig;
  customVideoApi?: CustomVideoApiConfig;
}

export type ScriptStage = 'intent' | 'brief' | 'topic' | 'research' | 'duration' | 'beats' | 'copy' | 'rhythm';
export type ScriptForm = 'short' | 'medium' | 'long' | 'extended';
export type OutlineStatus = 'none' | 'draft' | 'confirmed' | 'stale';
export type SectionStatus = 'planned' | 'drafting' | 'ready' | 'locked' | 'needs-revision' | 'failed';
export type RevisionReason =
  | 'under-duration'
  | 'over-duration'
  | 'missing-evidence'
  | 'repetition'
  | 'transition'
  | 'manual';
export type ScriptIntent = 'have-title' | 'blank' | 'direction' | 'product' | 'reference' | 'have-script';
export type ScriptLanguage = 'zh' | 'en';
export type ScriptGenre = '科普' | '反常识' | '故事' | '教程' | '带货' | '情绪' | '热点解读' | '口播金句';
export type ScriptPace = 'ultrafast' | 'fast' | 'medium' | 'slow' | 'cinematic';
export type ScriptPlatform = 'douyin' | 'shipinhao' | 'reels' | 'bilibili' | 'youtube';
export type BeatFunction = 'hook' | 'setup' | 'turn' | 'proof' | 'reveal' | 'cta';
export type ShotEnergy = 'fast' | 'medium' | 'slow' | 'hold';
export type DirectorNoteLevel = 'info' | 'warn' | 'block';
export type ScriptGate = 'fast' | 'deep';
export type VisualBibleMode = 'story' | 'expository';
export type VisualContinuity = 'same-space' | 'same-subject' | 'contrast' | 'callback' | 'new-info';
export type VisualCharacterRole = 'lead' | 'support' | 'extra';
export type VisualCharacterKind = 'person' | 'creature' | 'object' | 'anonymous' | 'narrator';
export type VisualCastPolicy = 'evidence';
export type VisualCharacterRefKind = 'none' | 'sheet' | 'face' | 'turnaround';
export type ScriptEvidenceSource = 'narration' | 'title' | 'intentNotes';
export type ScriptEntityOrigin = 'rule' | 'llm' | 'user';
export type ScriptEntityStatus = 'confirmed' | 'pending' | 'rejected';
export type AnonymousKind = 'unnamed_person' | 'first_person' | 'occupation';
export type NarratorMode = 'voiceover' | 'on_camera' | 'story_character';
export type CastPresentation =
  | 'character_driven'
  | 'product_showcase'
  | 'narrator_led'
  | 'motion_graphics'
  | 'montage';
export type OccupancyReason =
  | 'named-in-line'
  | 'dialogue'
  | 'insert-object'
  | 'establish-lead'
  | 'contrast-support'
  | 'pronoun-continue'
  | 'empty'
  | 'user';
export type CharacterLockFlag = 'identity' | 'appearance' | 'refs';
export type UserDecision = 'auto' | 'include' | 'exclude';
export type IssueSeverity = 'info' | 'warning' | 'error';
export type IssueTargetType = 'source' | 'entity' | 'character' | 'subject' | 'shot' | 'asset';
export type IssueBlock = 'compile_prompt' | 'generate_image' | 'accept_entity';

export interface VisualCharacterRef {
  imageId: string;
  imageUrl?: string;
  thumbDataUrl?: string;
  kind: VisualCharacterRefKind;
  notes?: string;
}

export interface CastCandidate {
  id: string;
  name: string;
  kind: VisualCharacterKind;
  mentions: number;
  evidence: string[];
  inTitle?: boolean;
  inNotes?: boolean;
  confidence?: number;
}

export interface ScriptEvidenceSpan {
  text: string;
  source: ScriptEvidenceSource;
  start: number;
  end: number;
}

/** Unique ScriptEntity ledger row. Character cards may only reference these IDs. */
export interface ScriptEntityRecord {
  id: string;
  name: string;
  kind: VisualCharacterKind;
  isNamed: boolean;
  anonymousKind?: AnonymousKind;
  evidence: ScriptEvidenceSpan[];
  confidence: number;
  mentions: number;
  inTitle?: boolean;
  inNotes?: boolean;
  origin: ScriptEntityOrigin;
  status: ScriptEntityStatus;
  /** Analysis status before any user override; never replaced by include/exclude. */
  analysisStatus?: ScriptEntityStatus;
  analysisType?: string;
}

export interface ScriptEntityLedger {
  version: number;
  fingerprint: string;
  sourceKey?: string;
  entities: ScriptEntityRecord[];
  contentType?: string;
  contentConfidence?: number;
  perspective?: string;
  hasDialogue?: boolean;
  hasNarrativeArc?: boolean;
  personificationDetected?: boolean;
  visualDensity?: string;
  provenance?: 'llm' | 'rule_fallback';
  generatedAt: number;
}

export interface AnalysisInput {
  inputSchemaVersion: 2;
  narration: string;
  title: string;
  intentNotes: string;
  language: 'zh' | 'en';
  genreHint: string | null;
}

export interface EntityUserOverride {
  entityId: string;
  decision: UserDecision;
  /** Retain the card/asset when a user excludes it, for restoring auto/include. */
  decisionCard?: VisualCharacter;
  displayName?: string;
  role?: VisualCharacterRole;
  locks: {
    identity: boolean;
    appearance: boolean;
    refs: boolean;
  };
  appearance?: {
    look: string;
    wardrobe: string;
    ageBand?: string;
    signature?: string;
    source: 'user' | 'accepted_design';
  };
}

export interface ValidationIssue {
  code: string;
  severity: IssueSeverity;
  targetType: IssueTargetType;
  targetId?: string;
  message: string;
  blocks: IssueBlock[];
  resolution?: string;
}

export interface RetiredEntity {
  entityId: string;
  name: string;
  kind?: VisualCharacterKind;
  character?: VisualCharacter;
  subject?: VisualSubject;
  override?: EntityUserOverride;
  reason: string;
}

export interface OccupancyPlan {
  onCamera: boolean;
  characterIds: string[];
  subjectIds: string[];
  reason: OccupancyReason;
}

export interface VisualBibleDiff {
  sourceChanged: boolean;
  pinned: boolean;
  addedNames: string[];
  removedNames: string[];
  pendingNames: string[];
  summary: string;
}

export interface VisualCharacter {
  id: string;
  name: string;
  role: VisualCharacterRole;
  kind?: VisualCharacterKind;
  /** Must match a ScriptEntityRecord.id after grounding. */
  entityId?: string;
  candidateId?: string;
  ageBand: string;
  look: string;
  wardrobe: string;
  signature?: string;
  /** Short quotes or phrases from the narration that justify this character. */
  sourceEvidence?: string[];
  evidenceSpans?: ScriptEvidenceSpan[];
  /** LLM/heuristic confidence that this card is grounded in the narration. */
  confidence?: number;
  status?: ScriptEntityStatus;
  castReason?: string;
  appearanceUnknown?: boolean;
  /** Preserve name / entity / role across rebuilds. */
  identityLocked?: boolean;
  /** Preserve look / wardrobe / age / signature across rebuilds. */
  appearanceLocked?: boolean;
  /** Preserve reference images across rebuilds. */
  refsLocked?: boolean;
  /** Backward-compatible keep-card flag; true if any of the three locks is on. */
  locked: boolean;
  refs: VisualCharacterRef[];
  seedHint?: string;
}

export interface VisualSubject {
  id: string;
  name: string;
  kind: 'object' | 'product';
  entityId?: string;
  look: string;
  locked: boolean;
  identityLocked?: boolean;
  appearanceLocked?: boolean;
  refsLocked?: boolean;
  refs: VisualCharacterRef[];
  sourceEvidence?: string[];
  evidenceSpans?: ScriptEvidenceSpan[];
  confidence?: number;
  castReason?: string;
}

export interface VisualLocation {
  id: string;
  name: string;
  look: string;
  timeOfDay: string;
  locked: boolean;
  refs: VisualCharacterRef[];
}

export interface VisualMotif {
  id: string;
  name: string;
  look: string;
  appearsIn: Array<'hook' | 'reveal' | 'cta' | 'any'>;
}

export interface VisualBible {
  version: 1 | 2;
  mode: VisualBibleMode;
  castPolicy?: VisualCastPolicy;
  candidates?: CastCandidate[];
  entityLedger?: ScriptEntityLedger;
  logline: string;
  paletteLock: string;
  characters: VisualCharacter[];
  subjects?: VisualSubject[];
  pendingCharacters?: VisualCharacter[];
  rejectedCast?: Array<{ name: string; reason: string }>;
  locations: VisualLocation[];
  motif: VisualMotif | null;
  continuityRule: string;
  sourceHash: string;
  sourceFingerprint?: string;
  sourceKey?: string;
  bibleRevision?: string;
  analysisCacheKey?: string;
  analysisInput?: AnalysisInput;
  analysisSnapshot?: import('./utils/scriptAnalysis').ScriptAnalysis;
  pinned?: boolean;
  narratorMode?: NarratorMode;
  presentation?: CastPresentation;
  analysisReason?: string;
  overrides?: Record<string, EntityUserOverride>;
  retiredEntities?: RetiredEntity[];
  issues?: ValidationIssue[];
  validation?: {
    status: 'ok' | 'warning';
    warnings: string[];
    checkedAt: number;
  };
  generatedAt: number;
}

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
  /** target-driven: AI writes to a duration; content-driven: existing copy determines duration */
  durationMode: 'target-driven' | 'content-driven';
  targetSeconds: number;
  platform: ScriptPlatform;
  pace: ScriptPace;
  speechRate: number;
  charsPerSecond: number; // budget units per second for the current scriptLanguage
  scriptLanguage?: ScriptLanguage;
  speechSeconds: number;
  holdSeconds: number;
  /** Alias of targetUnits; kept so saved projects and older UI keep working. */
  maxChars: number; // budget units: zh=chars, en=words
  /** Target spoken units (zh chars / en words). Equals maxChars after migration. */
  targetUnits?: number;
  minUnits?: number;
  maxUnits?: number;
  speechTargetSeconds?: number;
  visualHoldTargetSeconds?: number;
  usedChars: number;
  /** Measured after TTS; planning values remain estimates until this is present. */
  actualSpeechSeconds?: number;
  actualTotalSeconds?: number;
  conceptMax: number;
  conceptUsed: number;
  lockedShotCount: number | null;
}

export type ScriptSectionRole = 'hook' | 'setup' | 'body' | 'turn' | 'proof' | 'reveal' | 'cta';
export type DraftSource = 'llm' | 'fallback';

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
  sectionId?: string;
}

export interface ScriptSection {
  actualSec?: number;
  id: string;
  order: number;
  role: ScriptSectionRole;
  title: string;
  outline?: string;
  targetSeconds: number;
  minUnits: number;
  maxUnits: number;
  narration: string;
  beats: ScriptBeat[];
  status?: SectionStatus;
  usedEvidenceIds?: string[];
  audienceQuestion?: string;
  promise?: string;
}

export interface ScriptEvidenceItem {
  id: string;
  claim: string;
  source?: string;
  confidence: 'user' | 'researched' | 'unverified';
}

export interface ScriptBrief {
  audience: string;
  coreQuestion: string;
  coreConclusion: string;
  evidence: ScriptEvidenceItem[];
  forbiddenClaims: string[];
  requiredTerms: string[];
  callToAction?: string;
}

export interface ScriptOutlineSection {
  id: string;
  order: number;
  title: string;
  role: ScriptSectionRole;
  audienceQuestion: string;
  promise: string;
  evidenceIds: string[];
  bridgeFromPrevious: string;
  bridgeToNext: string;
  targetSeconds: number;
  targetUnits: number;
  minUnits: number;
  maxUnits: number;
  status: SectionStatus;
  narrationBudgetSec: number;
  visualHoldBudgetSec: number;
  retentionDevice: string;
  transitionOut: string;
}

export interface ScriptOutline {
  status: OutlineStatus;
  version: number;
  oneSentenceThesis: string;
  sections: ScriptOutlineSection[];
  confirmedAt?: number;
}

export interface ScriptRevisionAction {
  sectionId: string;
  action: 'expand' | 'compress' | 'replace-transition';
  targetDeltaUnits: number;
  instruction: string;
}

export interface ScriptRevisionPlan {
  reason: RevisionReason;
  measuredSeconds: number;
  targetSeconds: number;
  deltaSeconds: number;
  sectionActions: ScriptRevisionAction[];
}

/** LLM call cost log (JSONL). Keys are never stored. */
export interface GenerationRun {
  id: string;
  projectId?: string;
  stage: string;
  model: string;
  endpointHost?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  status: 'success' | 'failed' | 'mocked';
  promptHash: string;
  createdAt: string;
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
  beatId?: string;
  sectionId?: string;
  charStart?: number;
  charEnd?: number;
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
  sceneId?: string;
  beatId?: string;
  sectionId?: string;
  characterIds?: string[];
  locationId?: string;
  continuity?: VisualContinuity;
  occupancyPlan?: OccupancyPlan;
  subjectIds?: string[];
  shotSize?: ShotSize;
  cameraAngle?: CameraAngle;
  shotComposition?: ShotComposition;
  coverageJob?: CoverageJob;
  coverageLink?: CoverageLink;
  coverageSource?: CoverageSource;
}

export interface DirectorNote {
  id: string;
  level: DirectorNoteLevel;
  message: string;
  target?: 'hook' | 'chars' | 'hold' | 'shot' | 'concept' | 'duration' | 'draft';
}

export interface ResearchNotes {
  competitor: string;
  audienceQuestion: string;
  fact: string;
  visualRef: string;
}

export interface ScriptWorkspace {
  durationCalibration?: import('./shared/calibration').CalibrationResult;
  qualityReport?: QualityReport;
  qualityInputKey?: string;
  claims?: Claim[];
  contentBrief?: ContentBrief;
  durationSpec?: DurationSpec;
  stage: ScriptStage;
  gate: ScriptGate;
  scriptLanguage?: ScriptLanguage;
  intent: ScriptIntent | null;
  intentNotes: string;
  lockedTitle: string;
  draftedTitle?: string;
  topicCards: TopicCard[];
  selectedTopicId: string | null;
  researchNotes: ResearchNotes;
  durationBudget: DurationBudget;
  scriptForm?: ScriptForm;
  /** When set, overrides duration-derived ScriptForm. */
  scriptFormOverride?: ScriptForm | null;
  /** Medium videos confirm outline before draft when true. */
  confirmOutlineBeforeDraft?: boolean;
  brief?: ScriptBrief;
  outline?: ScriptOutline;
  revisionPlan?: ScriptRevisionPlan | null;
  activeSectionId?: string;
  beats: ScriptBeat[];
  sections?: ScriptSection[];
  fullNarration: string;
  speechSpans: SpeechSpan[];
  forecastShots: ForecastShot[];
  directorNotes: DirectorNote[];
  draftSource?: DraftSource;
  draftWarnings?: string[];
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
  visualBible?: VisualBible | null;
}

export interface VideoProject {
  id: string;
  title: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  saveRevision?: number;
  clips: StoryboardClip[];
  subtitles: SubtitleConfig;
  audio: AudioConfig;
  settings: ProjectSettings;
  scriptWorkspace?: ScriptWorkspace;
}

export interface ProjectLibraryItem {
  id: string;
  title: string;
  topic: string;
  createdAt: number;
  updatedAt: number;
  savedAt: number;
  clipCount: number;
  duration: number;
  aspectRatio: string;
  coverUrl?: string;
  saveRevision?: number;
}

export type ActiveTab = 'script' | 'storyboard' | 'style' | 'subtitles' | 'voice' | 'music' | 'audio' | 'projects' | 'settings';

export type StoryboardSubTab = 'split' | 'shots';

/** Audience promise, distinct from the existing evidence-oriented ScriptBrief. */
export type ContentBrief = import('zod').infer<typeof import('./shared/contentBrief').contentBriefDraftSchema>;
export type DurationPreset = 'insight' | 'deep_dive' | 'tutorial';
export interface DurationSpec {
  preset: DurationPreset;
  targetSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  pace: ScriptPace;
  narrationRatio: number;
}
export type Claim = import('zod').infer<typeof import('./shared/quality').claimSchema>;
export type QualityIssue = import('zod').infer<typeof import('./shared/quality').qualityIssueSchema>;
export type QualityReport = import('zod').infer<typeof import('./shared/quality').qualityReportSchema>;
