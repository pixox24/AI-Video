import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Pause, Play, Sparkles, Wand2 } from 'lucide-react';
import { CustomTtsApiConfig, DesignedVoiceStatus } from '../types';
import {
  countVoiceDesignChars,
  DEFAULT_VOICE_PREVIEW_TEXT,
  saveDesignedVoice,
  VOICE_PROMPT_EXAMPLES,
  voicePrefixFromTitle
} from '../utils/voiceLibrary';
import {
  inferTargetModelFromVoiceId,
  isDesignedVoiceId,
  isMissingEnrollmentError,
  isVoiceDesignAvailable,
  libraryVoiceCandidates,
  sanitizePastedVoiceId
} from '../utils/ttsCatalog';
import { audioEngine } from '../utils/audioEngine';
import { hideStatusToast, showStatusToast } from '../utils/statusToast';

type DraftVoice = {
  voiceId: string;
  targetModel: string;
  status: DesignedVoiceStatus;
  previewAudioUrl: string;
  prompt: string;
  previewText: string;
  language: 'zh' | 'en';
  source: 'designed' | 'imported' | 'cloned';
};

function statusLabel(status: DesignedVoiceStatus): string {
  if (status === 'ok') return '可用';
  if (status === 'undeployed') return '未通过';
  if (status === 'missing') return '已失效';
  return '审核中';
}

export function VoiceDesignWorkshop({
  ttsApi,
  onLibraryChange,
  onPushAndSelect,
  onNeedSettings
}: {
  ttsApi?: CustomTtsApiConfig;
  onLibraryChange: () => void;
  onPushAndSelect: (voiceId: string) => void;
  onNeedSettings?: () => void;
}) {
  const available = isVoiceDesignAvailable(ttsApi);
  const canUseBailian = Boolean(
    ttsApi?.provider === 'bailian' && ttsApi.enabled !== false && ttsApi.apiKey?.trim()
  );
  const canDesign = available;
  const model = (ttsApi?.model || '').trim();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(VOICE_PROMPT_EXAMPLES[0].prompt);
  const [previewText, setPreviewText] = useState(DEFAULT_VOICE_PREVIEW_TEXT);
  const [title, setTitle] = useState('纪录片男声');
  const [creating, setCreating] = useState(false);
  const [importId, setImportId] = useState('');
  const [importing, setImporting] = useState(false);
  const [previewingImport, setPreviewingImport] = useState(false);
  const [draft, setDraft] = useState<DraftVoice | null>(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<number | null>(null);

  const promptChars = countVoiceDesignChars(prompt);
  const promptOver = promptChars > 500;
  const previewShort = previewText.trim().length < 15;
  const previewLong = previewText.trim().length > 200;

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearTimeout(pollRef.current);
      audioRef.current?.pause();
      audioEngine.stopNarration();
    };
  }, []);

  const stopPreview = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    audioEngine.stopNarration();
    setPlaying(false);
  };

  const playPreview = (url: string) => {
    const started = audioEngine.playUrlPreview(url, () => setPlaying(false));
    setPlaying(started);
    if (!started) return;
  };

  const pollStatus = (voiceId: string, startedAt: number) => {
    if (!ttsApi?.apiKey) return;
    if (Date.now() - startedAt > 60000) return;
    pollRef.current = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/audio/voice-design/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            endpoint: ttsApi.endpoint,
            apiKey: ttsApi.apiKey,
            voiceId
          })
        });
        const data = await res.json().catch(() => ({}));
        if (data?.ok && data.status) {
          setDraft((prev) => (prev && prev.voiceId === voiceId ? { ...prev, status: data.status } : prev));
          if (data.status === 'deploying') pollStatus(voiceId, startedAt);
          return;
        }
      } catch {
        // keep last known status
      }
      pollStatus(voiceId, startedAt);
    }, 2000);
  };

  const handleCreate = async () => {
    if (!canUseBailian || !ttsApi) {
      onNeedSettings?.();
      return;
    }
    if (!canDesign) {
      showStatusToast('当前模型只支持导入已有音色；声音描述生成请切换到 Audio 3.0 Plus 或 Flash', { tone: 'warn', id: 'voice-design' });
      return;
    }
    if (promptOver || previewShort || previewLong || !prompt.trim()) return;
    if (pollRef.current) window.clearTimeout(pollRef.current);
    stopPreview();
    setCreating(true);
    setError(null);
    setDraft(null);
    showStatusToast('正在设计音色…', { tone: 'progress', id: 'voice-design', durationMs: 0 });
    try {
      const res = await fetch('/api/audio/voice-design/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: ttsApi.endpoint,
          apiKey: ttsApi.apiKey,
          model,
          voicePrompt: prompt.trim(),
          previewText: previewText.trim(),
          prefix: voicePrefixFromTitle(title || prompt),
          language: /[\u4e00-\u9fa5]/.test(previewText) ? 'zh' : 'en'
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !data.voiceId) {
        throw new Error(data?.error || '创建音色失败');
      }
      const next: DraftVoice = {
        voiceId: String(data.voiceId),
        targetModel: String(data.targetModel || model),
        status: (data.status as DesignedVoiceStatus) || 'deploying',
        previewAudioUrl: String(data.previewAudioUrl || ''),
        prompt: prompt.trim(),
        previewText: previewText.trim(),
        language: data.language === 'en' ? 'en' : 'zh',
        source: 'designed'
      };
      setDraft(next);
      hideStatusToast('voice-design');
      showStatusToast(next.status === 'ok' ? '音色已生成，可以试听' : '音色已生成，正在审核', { tone: 'ok', id: 'voice-design' });
      if (next.previewAudioUrl) playPreview(next.previewAudioUrl);
      if (next.status === 'deploying') pollStatus(next.voiceId, Date.now());
    } catch (err: any) {
      const message = err?.message || '创建音色失败';
      setError(message);
      hideStatusToast('voice-design');
      showStatusToast(message, { tone: 'warn', id: 'voice-design' });
    } finally {
      setCreating(false);
    }
  };

  const probeLibraryVoice = async (voiceId: string): Promise<{ voiceId: string; audioUrl: string; error?: string } | null> => {
    if (!ttsApi) return null;
    const res = await fetch('/api/audio/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: previewText.trim() || DEFAULT_VOICE_PREVIEW_TEXT,
        character: voiceId,
        rate: 1,
        ttsApi
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.audioUrl) {
      return { voiceId, audioUrl: '', error: String(data?.error || `HTTP ${res.status}`) };
    }
    const resolvedVoice = String(data.resolvedVoice || data.voice || '').trim();
    if (resolvedVoice && resolvedVoice !== voiceId) {
      return { voiceId, audioUrl: '', error: `服务商实际使用 ${resolvedVoice}` };
    }
    return { voiceId: resolvedVoice || voiceId, audioUrl: String(data.audioUrl) };
  };

  const handleImport = async () => {
    if (!canUseBailian || !ttsApi) {
      onNeedSettings?.();
      return;
    }
    const voiceId = sanitizePastedVoiceId(importId);
    if (!voiceId) {
      setError('请粘贴 voice_id');
      return;
    }
    if (pollRef.current) window.clearTimeout(pollRef.current);
    stopPreview();
    setImporting(true);
    setError(null);
    showStatusToast('正在查询音色…', { tone: 'progress', id: 'voice-design', durationMs: 0 });
    try {
      const res = await fetch('/api/audio/voice-design/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: ttsApi.endpoint,
          apiKey: ttsApi.apiKey,
          voiceId
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok && data.voiceId) {
        const targetModel = String(data.targetModel || inferTargetModelFromVoiceId(data.voiceId) || model);
        const promptText = String(data.prompt || '').trim();
        const next: DraftVoice = {
          voiceId: String(data.voiceId),
          targetModel,
          status: (data.status as DesignedVoiceStatus) || 'deploying',
          previewAudioUrl: '',
          prompt: promptText,
          previewText: String(data.previewText || previewText.trim() || DEFAULT_VOICE_PREVIEW_TEXT),
          language: /[\u4e00-\u9fa5]/.test(promptText || previewText) ? 'zh' : 'en',
          source: isDesignedVoiceId(data.voiceId) ? 'designed' : 'imported'
        };
        setDraft(next);
        if (!title.trim() || title === '纪录片男声') {
          setTitle((promptText || '导入音色').slice(0, 16));
        }
        hideStatusToast('voice-design');
        showStatusToast(
          next.targetModel && next.targetModel !== model
            ? `已查到音色，绑定 ${next.targetModel.includes('plus') ? 'Plus' : 'Flash'}，当前模型不一致`
            : '已查到账号音色，可以试听后上架',
          { tone: next.targetModel && next.targetModel !== model ? 'warn' : 'ok', id: 'voice-design' }
        );
        if (next.status === 'deploying') pollStatus(next.voiceId, Date.now());
        return;
      }

      const queryError = String(data?.error || '');
      if (!isMissingEnrollmentError(queryError)) {
        throw new Error(queryError || '查询音色失败');
      }

      showStatusToast('不是账号注册音色，改按控制台音色库试合成…', { tone: 'progress', id: 'voice-design', durationMs: 0 });
      const candidates = libraryVoiceCandidates(voiceId, model);
      let probed: { voiceId: string; audioUrl: string } | null = null;
      let lastProbeError = '';
      for (const candidate of candidates) {
        const result = await probeLibraryVoice(candidate);
        if (result?.audioUrl) {
          probed = result;
          break;
        }
        if (result?.error) lastProbeError = `${candidate}: ${result.error}`;
      }
      if (!probed) {
        const voiceModel = inferTargetModelFromVoiceId(voiceId);
        throw new Error(
          `${voiceModel && voiceModel !== model ? `该音色属于 ${voiceModel}，当前模型是 ${model}。` : '音色合成失败。'}${lastProbeError ? ` 服务商错误：${lastProbeError}` : ''} 请确认音色库中的模型与当前设置一致。`
        );
      }

      const suffix = probed.voiceId.replace(/^qwen-audio-3\.0-tts-(plus|flash)-/i, '');
      const next: DraftVoice = {
        voiceId: probed.voiceId,
        targetModel: inferTargetModelFromVoiceId(probed.voiceId) || model,
        status: 'ok',
        previewAudioUrl: probed.audioUrl,
        prompt: `官方音色库 · ${suffix}`,
        previewText: previewText.trim() || DEFAULT_VOICE_PREVIEW_TEXT,
        language: /[\u4e00-\u9fa5]/.test(previewText) ? 'zh' : 'en',
        source: 'imported'
      };
      setDraft(next);
      if (!title.trim() || title === '纪录片男声') {
        setTitle(suffix.slice(0, 16) || '导入音色');
      }
      hideStatusToast('voice-design');
      showStatusToast('已按官方音色库合成，可以上架', { tone: 'ok', id: 'voice-design' });
      playPreview(probed.audioUrl);
    } catch (err: any) {
      const message = err?.message || '查询音色失败';
      setError(message);
      hideStatusToast('voice-design');
      showStatusToast(message, { tone: 'warn', id: 'voice-design' });
    } finally {
      setImporting(false);
    }
  };

  const previewImportedDraft = async () => {
    if (!draft || !ttsApi) return;
    if (draft.targetModel && draft.targetModel !== model) {
      showStatusToast('先把设置里的模型换成这条音色绑定的那一档', { tone: 'warn', id: 'voice-design' });
      return;
    }
    stopPreview();
    setPreviewingImport(true);
    showStatusToast('正在合成试听…', { tone: 'progress', id: 'voice-design', durationMs: 0 });
    try {
      const res = await fetch('/api/audio/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: draft.previewText || DEFAULT_VOICE_PREVIEW_TEXT,
          character: draft.voiceId,
          rate: 1,
          ttsApi
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.audioUrl) {
        throw new Error(data?.error || '试听合成失败');
      }
      const resolvedVoice = String(data.resolvedVoice || data.voice || '').trim();
      if (resolvedVoice && resolvedVoice !== draft.voiceId) {
        throw new Error(`试听音色未生效：服务商实际使用 ${resolvedVoice}`);
      }
      const audioUrl = String(data.audioUrl);
      setDraft((prev) => (prev ? { ...prev, previewAudioUrl: audioUrl } : prev));
      hideStatusToast('voice-design');
      playPreview(audioUrl);
    } catch (err: any) {
      hideStatusToast('voice-design');
      showStatusToast(err?.message || '试听失败', { tone: 'warn', id: 'voice-design' });
    } finally {
      setPreviewingImport(false);
    }
  };

  const persistDraft = (select: boolean) => {
    if (!draft) return;
    try {
      saveDesignedVoice({
        voiceId: draft.voiceId,
        targetModel: draft.targetModel,
        title: title.trim() || '我的音色',
        prompt: draft.prompt,
        previewText: draft.previewText,
        language: draft.language,
        status: draft.status,
        previewAudioUrl: draft.previewAudioUrl,
        source: draft.source
      });
      onLibraryChange();
      if (select && draft.targetModel && draft.targetModel !== model) {
        showStatusToast('已上架。换到这条音色绑定的模型后再选用', { tone: 'warn', id: 'voice-design' });
      } else if (select) {
        onPushAndSelect(draft.voiceId);
        showStatusToast('已上架并选用', { tone: 'ok', id: 'voice-design' });
      } else {
        showStatusToast('已上架，审核通过后再选用', { tone: 'ok', id: 'voice-design' });
      }
    } catch (err: any) {
      showStatusToast(err?.message || '上架失败', { tone: 'warn', id: 'voice-design' });
    }
  };

  return (
    <div className="rounded-xl border border-[#2b2b36] bg-[#181820] p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-zinc-200 font-medium">
          <Wand2 className="w-3.5 h-3.5 text-amber-400" />
          设计音色
        </div>
        <button
          id="btn-open-voice-design"
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="text-[10px] px-2 py-1 rounded-lg border border-[#3a3a4a] text-zinc-400 hover:text-amber-300 hover:border-amber-500/40 cursor-pointer"
        >
          {open ? '收起工坊' : '打开工坊'}
        </button>
      </div>
      <p className="text-[11px] text-zinc-500 leading-relaxed">
        可以写描述生成新音色，也可以粘贴已有 voice_id 上架。绑定当前 3.0 模型，Plus / Flash 不能混用。
      </p>
      {open && (
        <div className="space-y-2.5 pt-1">
          {!canUseBailian ? (
            <div className="space-y-2">
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                导入百炼音色或生成声音描述都需要百炼 API Key。
              </p>
              {onNeedSettings && (
                <button
                  type="button"
                  onClick={onNeedSettings}
                  className="text-[11px] text-amber-300 hover:text-amber-200 cursor-pointer"
                >
                  去 TTS 设置
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="text-[10px] text-zinc-500">
                目标模型 <span className="font-mono text-zinc-300">{model}</span>
              </div>
              <div className="space-y-1.5 rounded-xl border border-[#2b2b36] bg-[#121217] p-2.5">
                <div className="text-[11px] text-zinc-300">用已有 voice id 上架</div>
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  控制台「音色库」是官方基础音色，查不到账号资源是正常的，会改用当前模型直接试合成。自己设计/复刻的 id 仍走查询。
                </p>
                <input
                  id="input-import-voice-id"
                  value={importId}
                  onChange={(e) => setImportId(e.target.value.trim())}
                  placeholder="控制台音色库的 voice 参数，或自己的 vd- / 复刻 id"
                  className="w-full bg-[#181820] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-2.5 py-2 text-[11px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
                />
                <button
                  id="btn-import-voice-id"
                  type="button"
                  onClick={() => void handleImport()}
                  disabled={importing || !importId.trim()}
                  className="w-full py-1.5 rounded-xl border border-amber-500/30 text-amber-300 hover:bg-amber-500/10 cursor-pointer disabled:opacity-50 text-xs"
                >
                  {importing ? '正在查询…' : '查询并预览'}
                </button>
              </div>
              <div className="text-[10px] text-zinc-500">或从描述生成新音色</div>
              {!canDesign && (
                <p className="text-[10px] text-amber-200/80 leading-relaxed">
                  当前模型只支持导入已有音色；声音描述生成请切换到 Audio 3.0 Plus 或 Flash。
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                {VOICE_PROMPT_EXAMPLES.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setPrompt(item.prompt);
                      setTitle(item.label);
                    }}
                    className={`text-[10px] px-2 py-1 rounded-lg border cursor-pointer ${
                      prompt === item.prompt
                        ? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                        : 'border-[#3a3a4a] text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  <span>声音描述</span>
                  <span className={promptOver ? 'text-rose-300' : ''}>{promptChars}/500</span>
                </div>
                <textarea
                  id="input-voice-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  placeholder="性别、年龄、音调、语速、情感、用途。写特质，不要写模仿某人。"
                  className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-2.5 py-2 text-[12px] text-zinc-100 placeholder-zinc-600 outline-none resize-none"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  <span>预览文案</span>
                  <span className={previewShort || previewLong ? 'text-rose-300' : ''}>{previewText.trim().length} 字</span>
                </div>
                <textarea
                  id="input-voice-preview-text"
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  rows={2}
                  className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-2.5 py-2 text-[12px] text-zinc-100 outline-none resize-none"
                />
              </div>
              <div className="space-y-1">
                <div className="text-[10px] text-zinc-500">货架显示名</div>
                <input
                  id="input-voice-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 16))}
                  className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-2.5 py-2 text-[12px] text-zinc-100 outline-none"
                />
              </div>
              <button
                id="btn-generate-voice-design"
                type="button"
                onClick={() => void handleCreate()}
                disabled={!canDesign || creating || promptOver || previewShort || previewLong || !prompt.trim()}
                className="w-full py-2 bg-[#22222c] hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-xl flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 text-xs font-medium"
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {creating ? '正在设计…' : '生成试听'}
              </button>
              {error && <div className="text-[11px] text-rose-300 leading-relaxed">{error}</div>}
              {draft && (
                <div className="rounded-xl border border-[#2b2b36] bg-[#121217] p-2.5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12px] text-zinc-100 truncate">{title.trim() || '我的音色'}</div>
                      <div className="text-[10px] font-mono text-zinc-500 truncate">{draft.voiceId}</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                        draft.status === 'ok'
                          ? 'text-emerald-300 border-emerald-500/40'
                          : draft.status === 'undeployed'
                            ? 'text-rose-300 border-rose-500/40'
                            : 'text-amber-300 border-amber-500/40'
                      }`}>
                        {statusLabel(draft.status)}
                      </span>
                      <button
                        id="btn-preview-imported-voice"
                        type="button"
                        onClick={() => {
                          if (playing) stopPreview();
                          else if (draft.previewAudioUrl) playPreview(draft.previewAudioUrl);
                          else void previewImportedDraft();
                        }}
                        disabled={previewingImport}
                        className={`w-8 h-8 rounded-full border flex items-center justify-center cursor-pointer disabled:opacity-60 ${
                          playing
                            ? 'border-amber-500 bg-amber-500/20 text-amber-300'
                            : 'border-[#3a3a4a] text-zinc-300 hover:text-amber-300 hover:border-amber-500/40'
                        }`}
                        aria-label={playing ? '停止试听' : '试听'}
                      >
                        {previewingImport ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : playing ? (
                          <Pause className="w-3.5 h-3.5" />
                        ) : (
                          <Play className="w-3.5 h-3.5 fill-current" />
                        )}
                      </button>
                    </div>
                  </div>
                  {draft.status === 'ok' && draft.targetModel && draft.targetModel !== model ? (
                    <button
                      id="btn-push-designed-voice"
                      type="button"
                      onClick={() => persistDraft(true)}
                      className="w-full py-2 rounded-xl border border-[#3a3a4a] text-zinc-200 cursor-pointer text-xs"
                    >
                      先上架（模型不一致，暂不选用）
                    </button>
                  ) : draft.status === 'ok' ? (
                    <button
                      id="btn-push-designed-voice"
                      type="button"
                      onClick={() => persistDraft(true)}
                      className="w-full py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-black font-semibold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer text-xs"
                    >
                      <Check className="w-3.5 h-3.5" />
                      推到货架并选用
                    </button>
                  ) : draft.status === 'undeployed' ? (
                    <p className="text-[11px] text-rose-300">审核未通过，不能上架成片。</p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => persistDraft(false)}
                      className="w-full py-2 rounded-xl border border-[#3a3a4a] text-zinc-300 cursor-pointer text-xs"
                    >
                      先上架，审核通过后再选用
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
