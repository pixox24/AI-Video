import { CustomTtsApiConfig } from '../types';
import { DEFAULT_BGM_TRACK_ID, bgmById, resolveBgmTrackId } from './presets';
import { ttsSourceKey } from './ttsCatalog';
import { getTtsPreviewUrl, makeVoicePreviewKey, setTtsPreviewUrl } from './ttsPreviewCache';

export type AudioPreviewListener = (previewTrackId: string | null) => void;
export type VoicePreviewListener = (playing: boolean) => void;

/** 1-sample silent WAV: capture the click's user-gesture on an HTMLAudioElement before TTS returns. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

/**
 * High-performance, single-instance audio engine for studio BGM playback,
 * dedicated preview player, custom audio tracks, and real-time voiceover audio ducking & mixing.
 */
class AudioEngine {
  // Timeline playback BGM instance
  private bgmAudio: HTMLAudioElement | null = null;
  private bgmSessionToken: number = 0;

  // Dedicated Preview BGM instance (strictly single-instance)
  private previewAudio: HTMLAudioElement | null = null;
  private previewTrackId: string | null = null;
  private previewSessionToken: number = 0;

  private currentBgmVolume: number = 0.10;
  private isDucking: boolean = false;
  private currentTrackId: string = '';
  
  // Voiceover instance & session
  private activeAudioElement: HTMLAudioElement | null = null;
  private voiceSessionToken: number = 0;
  private voicePreviewActive = false;
  private ttsCache: Map<string, string> = new Map();
  private audioDuckingEnabled: boolean = true;
  private duckingAnimFrame: number | null = null;
  private ttsApi: unknown = null;
  private fullNarrationAudio: HTMLAudioElement | null = null;
  private fullNarrationUrl: string | null = null;
  private narrationForceSeek = false;
  private audioUnlockCtx: AudioContext | null = null;

  private previewListeners: Set<AudioPreviewListener> = new Set();
  private voicePreviewListeners: Set<VoicePreviewListener> = new Set();

  public subscribePreviewState(listener: AudioPreviewListener): () => void {
    this.previewListeners.add(listener);
    return () => {
      this.previewListeners.delete(listener);
    };
  }

  private notifyPreviewState(trackId: string | null) {
    this.previewTrackId = trackId;
    this.previewListeners.forEach(listener => {
      try {
        listener(trackId);
      } catch (e) {
        console.error('Error in preview listener:', e);
      }
    });
  }

  public subscribeVoicePreview(listener: VoicePreviewListener): () => void {
    this.voicePreviewListeners.add(listener);
    return () => {
      this.voicePreviewListeners.delete(listener);
    };
  }

  public isVoicePreviewActive(): boolean {
    return this.voicePreviewActive;
  }

  private setVoicePreviewActive(playing: boolean) {
    if (this.voicePreviewActive === playing) return;
    this.voicePreviewActive = playing;
    this.voicePreviewListeners.forEach((listener) => {
      try {
        listener(playing);
      } catch (e) {
        console.error('Error in voice preview listener:', e);
      }
    });
  }

  private unlockPlaybackFromUserGesture() {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      if (!this.audioUnlockCtx) this.audioUnlockCtx = new Ctx();
      if (this.audioUnlockCtx.state === 'suspended') {
        void this.audioUnlockCtx.resume();
      }
    } catch {
      // ignore
    }
  }

  /**
   * Safely detach all listeners and terminate an HTMLAudioElement completely
   * to guarantee no ghost audio or aborted-src onerror fallbacks resurrect the track
   */
  private teardownAudio(audio: HTMLAudioElement | null) {
    if (!audio) return;
    try {
      audio.onended = null;
      audio.onerror = null;
      audio.oncanplay = null;
      audio.onplay = null;
      audio.onpause = null;
      audio.onplaying = null;
      audio.pause();
      audio.currentTime = 0;
      audio.removeAttribute('src');
      audio.load();
    } catch {
      // ignore
    }
  }

  public setAudioDucking(enabled: boolean) {
    this.audioDuckingEnabled = enabled;
    if (!enabled && this.isDucking) {
      this.applyDucking(false);
    }
  }

  public setTtsApi(api: unknown) {
    this.ttsApi = api;
  }

  public setBgmVolume(volume: number) {
    this.currentBgmVolume = Math.max(0, Math.min(1, volume));
    if (this.bgmAudio) {
      const targetVolume = this.isDucking ? this.currentBgmVolume * 0.35 : this.currentBgmVolume;
      this.fadeVolume(this.bgmAudio, targetVolume, 150);
    }
  }

  public setVoiceVolume(volume: number) {
    if (this.activeAudioElement) {
      this.activeAudioElement.volume = Math.max(0, Math.min(1, volume));
    }
  }

  /**
   * Smoothly interpolate audio volume over durationMs
   */
  private fadeVolume(audio: HTMLAudioElement, targetVol: number, durationMs: number = 250) {
    if (!audio) return;
    const clampedTarget = Math.max(0, Math.min(1, targetVol));
    const startVol = audio.volume;
    const startTime = performance.now();

    if (this.duckingAnimFrame) {
      cancelAnimationFrame(this.duckingAnimFrame);
      this.duckingAnimFrame = null;
    }

    const step = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      // Smooth cosine easing
      const ease = 0.5 * (1 - Math.cos(Math.PI * progress));
      audio.volume = Math.max(0, Math.min(1, startVol + (clampedTarget - startVol) * ease));

      if (progress < 1) {
        this.duckingAnimFrame = requestAnimationFrame(step);
      } else {
        audio.volume = clampedTarget;
        this.duckingAnimFrame = null;
      }
    };

    this.duckingAnimFrame = requestAnimationFrame(step);
  }

  /**
   * Start or resume BGM for video timeline playback
   */
  public startBgm(trackId: string, volume: number = 0.10, customUrl?: string) {
    // Stop old BGM/preview first. stopBgm() bumps the session so in-flight
    // play() callbacks from the previous track cannot resurrect it.
    this.stopPreviewBgm();
    this.stopBgm();
    const session = this.bgmSessionToken;

    this.currentTrackId = trackId;
    this.currentBgmVolume = Math.max(0, Math.min(1, volume));

    const trackDef = bgmById(resolveBgmTrackId(trackId));
    const audioSrc = customUrl || trackDef?.url || `/audio/bgm/${DEFAULT_BGM_TRACK_ID}.mp3`;

    try {
      const audio = new Audio();
      audio.loop = true;
      audio.crossOrigin = 'anonymous';
      audio.volume = 0; // Fade in smoothly
      audio.src = audioSrc;

      audio.onerror = () => {
        if (this.bgmSessionToken !== session) return; // Stale session, ignore
        if (trackDef && trackDef.fallbackUrl && audio.src !== trackDef.fallbackUrl) {
          console.warn(`[AudioEngine] Timeline BGM falling back to remote CDN for ${trackId}`);
          audio.src = trackDef.fallbackUrl;
          audio.play().catch(e => {
            if (this.bgmSessionToken !== session) return;
            console.warn('[AudioEngine] Remote play failed:', e);
          });
        }
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          if (this.bgmSessionToken !== session) {
            this.teardownAudio(audio);
            return;
          }
          this.fadeVolume(audio, this.currentBgmVolume, 300);
        }).catch(err => {
          if (this.bgmSessionToken !== session) return;
          console.warn('[AudioEngine] BGM autoplay blocked until user gesture:', err?.message);
        });
      }

      this.bgmAudio = audio;
    } catch (err) {
      console.warn('[AudioEngine] Failed to initialize BGM audio:', err);
    }
  }

  /**
   * Stop timeline video BGM with smooth fade-out
   */
  public stopBgm() {
    this.bgmSessionToken++;
    if (this.bgmAudio) {
      const audioToStop = this.bgmAudio;
      this.bgmAudio = null;
      this.teardownAudio(audioToStop);
    }
  }

  /**
   * Dedicated standalone BGM Preview Player (Single-instance strictly guaranteed)
   * Plays ONLY the currently requested track. Automatically stops and cleans up
   * any previous preview tracks, preventing audio overlapping or mixing.
   */
  public previewBgmTrack(
    trackId: string, 
    volume: number = 0.25, 
    customUrl?: string, 
    onEnd?: () => void
  ) {
    // Tear down any previous preview first, then adopt that session.
    // Incrementing *before* stopPreviewBgm() made onended/error handlers
    // treat the brand-new preview as stale.
    this.stopPreviewBgm();
    const session = this.previewSessionToken;
    this.stopNarration();

    // 2. Also pause timeline BGM while previewing so there is zero audio cacophony
    if (this.bgmAudio) {
      try {
        this.bgmAudio.pause();
      } catch {
        // ignore
      }
    }

    this.notifyPreviewState(trackId);
    const trackDef = bgmById(resolveBgmTrackId(trackId));
    const audioSrc = customUrl || trackDef?.url || `/audio/bgm/${DEFAULT_BGM_TRACK_ID}.mp3`;

    try {
      const audio = new Audio();
      audio.loop = false; // Preview plays once
      audio.crossOrigin = 'anonymous';
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.src = audioSrc;

      audio.onended = () => {
        if (this.previewSessionToken !== session) return;
        this.teardownAudio(audio);
        this.previewAudio = null;
        this.notifyPreviewState(null);
        if (onEnd) onEnd();
      };

      audio.onerror = () => {
        if (this.previewSessionToken !== session) return;
        if (trackDef && trackDef.fallbackUrl && audio.src !== trackDef.fallbackUrl) {
          audio.src = trackDef.fallbackUrl;
          audio.play().catch(e => {
            if (this.previewSessionToken !== session) return;
            console.warn('[AudioEngine] Preview remote fallback failed:', e);
            this.teardownAudio(audio);
            this.previewAudio = null;
            this.notifyPreviewState(null);
            if (onEnd) onEnd();
          });
        } else {
          this.teardownAudio(audio);
          this.previewAudio = null;
          this.notifyPreviewState(null);
          if (onEnd) onEnd();
        }
      };

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          if (this.previewSessionToken !== session) return;
          console.warn('[AudioEngine] Preview audio blocked:', err?.message);
          this.teardownAudio(audio);
          this.previewAudio = null;
          this.notifyPreviewState(null);
          if (onEnd) onEnd();
        });
      }

      this.previewAudio = audio;
    } catch (err) {
      if (this.previewSessionToken !== session) return;
      console.warn('[AudioEngine] Preview creation error:', err);
      this.previewAudio = null;
      this.notifyPreviewState(null);
      if (onEnd) onEnd();
    }
  }

  /**
   * Stop standalone BGM preview
   */
  public stopPreviewBgm() {
    this.previewSessionToken++;
    if (this.previewAudio) {
      const audioToStop = this.previewAudio;
      this.previewAudio = null;
      this.teardownAudio(audioToStop);
    }
    this.notifyPreviewState(null);
  }

  public getPreviewTrackId(): string | null {
    return this.previewTrackId;
  }

  public stopAll() {
    this.stopBgm();
    this.stopPreviewBgm();
    this.stopNarration();
  }

  /**
   * Smooth Audio Ducking: lowers BGM volume by 65% when voiceover plays
   */
  private applyDucking(duck: boolean) {
    if (!this.audioDuckingEnabled) return;
    this.isDucking = duck;
    if (this.bgmAudio) {
      // Keep 35% of the original volume during speech (65% reduction), fade over 250ms
      const targetVolume = duck ? this.currentBgmVolume * 0.35 : this.currentBgmVolume;
      this.fadeVolume(this.bgmAudio, targetVolume, duck ? 200 : 350);
    }
  }

  /**
   * Speak narration using High Quality Edge Neural TTS (100% Free) with fallback to Web Speech
   */
  public async speakNarration(
    text: string, 
    character: string = 'magnetic-male', 
    rate: number = 1.0, 
    onEnd?: () => void,
    opts?: { persistPreview?: boolean }
  ): Promise<{ fromCache: boolean; played: boolean; cancelled?: boolean }> {
    const persistPreview = Boolean(opts?.persistPreview);
    // Voice-panel preview must not tear down the timeline's full VO file; only pause it.
    if (persistPreview) {
      if (this.fullNarrationAudio && !this.fullNarrationAudio.paused) {
        try { this.fullNarrationAudio.pause(); } catch { /* ignore */ }
      }
    } else {
      this.stopFullNarration();
    }
    this.stopNarration();
    const session = this.voiceSessionToken;
    if (persistPreview) this.setVoicePreviewActive(true);

    if (!text || !text.trim()) {
      this.setVoicePreviewActive(false);
      if (onEnd) onEnd();
      return { fromCache: false, played: false, cancelled: false };
    }

    // Apply audio ducking on BGM
    this.applyDucking(true);

    const handleVoiceEnd = () => {
      if (this.voiceSessionToken !== session) return;
      this.setVoicePreviewActive(false);
      this.applyDucking(false);
      if (onEnd) onEnd();
    };

    const sourceKey = ttsSourceKey(this.ttsApi as CustomTtsApiConfig | undefined, character);
    const previewKey = makeVoicePreviewKey(sourceKey, persistPreview ? 1 : rate);
    const cacheKey = persistPreview ? previewKey : `${sourceKey}|${rate}|${text.trim()}`;
    let audioUrl = this.ttsCache.get(cacheKey);
    if (!audioUrl && persistPreview) {
      audioUrl = getTtsPreviewUrl(previewKey) || undefined;
    }
    const fromCache = Boolean(audioUrl);

    // Hold one HTMLAudioElement from the click so play() after TTS still counts as a user gesture.
    let previewPlayer: HTMLAudioElement | null = null;
    if (persistPreview) {
      this.unlockPlaybackFromUserGesture();
      previewPlayer = new Audio();
      previewPlayer.preload = 'auto';
      previewPlayer.volume = 0;
      previewPlayer.src = SILENT_WAV;
      this.activeAudioElement = previewPlayer;
      void previewPlayer.play().catch(() => {});
    }

    if (!audioUrl) {
      try {
        const res = await fetch('/api/audio/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: text.trim(),
            character,
            rate: persistPreview ? 1 : rate,
            ttsApi: this.ttsApi
          })
        });

        if (this.voiceSessionToken !== session) return { fromCache: false, played: false, cancelled: true };

        if (res.ok) {
          const data = await res.json();
          if (data && data.audioUrl) {
            audioUrl = data.audioUrl;
            this.ttsCache.set(cacheKey, audioUrl);
            if (persistPreview) setTtsPreviewUrl(previewKey, audioUrl);
          }
        }
      } catch (err) {
        console.warn('TTS request failed, fallback to WebSpeech:', err);
      }
    }

    if (this.voiceSessionToken !== session) return { fromCache: false, played: false, cancelled: true };

    // Play high-quality neural voice if retrieved
    if (audioUrl) {
      const played = await this.playVoiceUrl(
        audioUrl,
        session,
        text,
        character,
        persistPreview ? 1 : rate,
        handleVoiceEnd,
        previewPlayer
      );
      if (this.voiceSessionToken !== session) {
        return { fromCache, played: false, cancelled: true };
      }
      if (played) {
        return { fromCache, played: true };
      }
    }

    if (this.voiceSessionToken !== session) return { fromCache: false, played: false, cancelled: true };

    if (previewPlayer && this.activeAudioElement === previewPlayer) {
      this.teardownAudio(previewPlayer);
      this.activeAudioElement = null;
    }

    // Fallback: Web Speech API
    this.fallbackWebSpeech(text, character, persistPreview ? 1 : rate, handleVoiceEnd);
    return { fromCache: false, played: true };
  }

  private async playVoiceUrl(
    audioUrl: string,
    session: number,
    text: string,
    character: string,
    rate: number,
    handleVoiceEnd: () => void,
    existingPlayer: HTMLAudioElement | null
  ): Promise<boolean> {
    const audio = existingPlayer || new Audio();
    try {
      this.activeAudioElement = audio;
      audio.onended = null;
      audio.onerror = null;
      audio.playbackRate = 1.0;
      audio.volume = 1;
      try { audio.pause(); } catch { /* ignore */ }

      audio.onended = () => {
        if (this.voiceSessionToken !== session) return;
        this.teardownAudio(audio);
        if (this.activeAudioElement === audio) this.activeAudioElement = null;
        handleVoiceEnd();
      };

      audio.onerror = () => {
        if (this.voiceSessionToken !== session) return;
        this.teardownAudio(audio);
        if (this.activeAudioElement === audio) this.activeAudioElement = null;
        this.fallbackWebSpeech(text, character, rate, handleVoiceEnd);
      };

      audio.src = audioUrl;
      await audio.play();
      return this.voiceSessionToken === session;
    } catch (playErr) {
      audio.onended = null;
      audio.onerror = null;
      if (this.voiceSessionToken !== session) return false;
      console.warn('Audio element play failed, falling back:', playErr);
      return false;
    }
  }

  private fallbackWebSpeech(
    text: string,
    character: string = 'magnetic-male',
    rate: number = 1.0,
    onEnd?: () => void
  ) {
    try {
      if (!('speechSynthesis' in window)) {
        if (onEnd) setTimeout(onEnd, 1500);
        return;
      }

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = rate;

      // Pick suitable Chinese / English voice
      const voices = window.speechSynthesis.getVoices();
      const zhVoices = voices.filter(v => v.lang.includes('zh') || v.lang.includes('cmn') || v.lang.includes('yue'));
      
      if (character === 'warm-female') {
        const femaleVoice = zhVoices.find(v => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('tingting') || v.name.toLowerCase().includes('xiaoxiao') || v.name.toLowerCase().includes('mei'));
        if (femaleVoice) utterance.voice = femaleVoice;
        utterance.pitch = 1.15;
      } else if (character === 'magnetic-male') {
        const maleVoice = zhVoices.find(v => v.name.toLowerCase().includes('male') || v.name.toLowerCase().includes('yunxi') || v.name.toLowerCase().includes('kangkang') || v.name.toLowerCase().includes('qiang'));
        if (maleVoice) utterance.voice = maleVoice;
        utterance.pitch = 0.85;
      } else if (character === 'mystery-noir') {
        utterance.pitch = 0.7;
        utterance.rate = Math.max(0.7, rate * 0.85);
      } else {
        if (zhVoices.length > 0) utterance.voice = zhVoices[0];
        utterance.pitch = 1.0;
      }

      utterance.onend = () => {
        if (onEnd) onEnd();
      };

      utterance.onerror = () => {
        if (onEnd) onEnd();
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('[AudioEngine] Web Speech synthesis failed:', e);
      if (onEnd) onEnd();
    }
  }

  public stopNarration() {
    this.voiceSessionToken++;
    this.setVoicePreviewActive(false);
    this.applyDucking(false);

    if (this.activeAudioElement) {
      const audio = this.activeAudioElement;
      this.activeAudioElement = null;
      this.teardownAudio(audio);
    }

    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  public ensureFullNarration(url: string, volume: number) {
    if (this.fullNarrationUrl === url && this.fullNarrationAudio) {
      this.fullNarrationAudio.volume = Math.max(0, Math.min(1, volume));
      return;
    }
    this.stopFullNarration();
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = url;
    audio.volume = Math.max(0, Math.min(1, volume));
    this.fullNarrationAudio = audio;
    this.fullNarrationUrl = url;
    this.narrationForceSeek = true;
  }

  public requestNarrationSeek() {
    this.narrationForceSeek = true;
  }

  public getFullNarrationTime(): number | null {
    const audio = this.fullNarrationAudio;
    if (!audio || !Number.isFinite(audio.currentTime)) return null;
    return audio.currentTime;
  }

  public isFullNarrationPaused(): boolean {
    return !this.fullNarrationAudio || this.fullNarrationAudio.paused;
  }

  public syncFullNarration(audioTime: number, playing: boolean, frozen: boolean, volume: number) {
    const audio = this.fullNarrationAudio;
    if (!audio) return;

    audio.volume = Math.max(0, Math.min(1, volume));
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : Math.max(audioTime, 0.01);
    const safeTime = Math.max(0, Math.min(duration, audioTime));
    const drift = Math.abs((audio.currentTime || 0) - safeTime);
    const forceSeek = this.narrationForceSeek;
    this.narrationForceSeek = false;

    if (!playing || frozen) {
      if (!audio.paused) {
        try { audio.pause(); } catch { /* ignore */ }
      }
      if (forceSeek || drift > 0.22) {
        try { audio.currentTime = safeTime; } catch { /* ignore seek errors */ }
      }
      this.applyDucking(false);
      return;
    }

    this.applyDucking(this.audioDuckingEnabled);
    if (forceSeek || audio.paused || drift > 0.6) {
      try { audio.currentTime = safeTime; } catch { /* ignore seek errors */ }
    }
    if (audio.paused) {
      audio.play().catch(() => {});
    }
  }

  public stopFullNarration() {
    this.applyDucking(false);
    this.teardownAudio(this.fullNarrationAudio);
    this.fullNarrationAudio = null;
    this.fullNarrationUrl = null;
  }
}

export const audioEngine = new AudioEngine();
