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
import { isVoiceDesignAvailable } from '../utils/ttsCatalog';
import { hideStatusToast, showStatusToast } from '../utils/statusToast';

type DraftVoice = {
  voiceId: string;
  targetModel: string;
  status: DesignedVoiceStatus;
  previewAudioUrl: string;
  prompt: string;
  previewText: string;
  language: 'zh' | 'en';
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
  const model = (ttsApi?.model || '').trim();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(VOICE_PROMPT_EXAMPLES[0].prompt);
  const [previewText, setPreviewText] = useState(DEFAULT_VOICE_PREVIEW_TEXT);
  const [title, setTitle] = useState('纪录片男声');
  const [creating, setCreating] = useState(false);
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
    };
  }, []);

  const stopPreview = () => {
    audioRef.current?.pause();
    setPlaying(false);
  };

  const playPreview = (url: string) => {
    stopPreview();
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.onended = () => setPlaying(false);
    audio.onerror = () => {
      setPlaying(false);
      showStatusToast('预览音频无法播放', { tone: 'warn', id: 'voice-design' });
    };
    setPlaying(true);
    void audio.play().catch(() => {
      setPlaying(false);
      showStatusToast('预览被浏览器拦住了，请再点一次', { tone: 'warn', id: 'voice-design' });
    });
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
    if (!available || !ttsApi) {
      onNeedSettings?.();
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
        language: data.language === 'en' ? 'en' : 'zh'
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
        previewAudioUrl: draft.previewAudioUrl
      });
      onLibraryChange();
      if (select) {
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
        用一句话描述声音，试听后再推到货架。设计绑定当前模型，Plus / Flash 不能混用。
      </p>
      {open && (
        <div className="space-y-2.5 pt-1">
          {!available ? (
            <div className="space-y-2">
              <p className="text-[11px] text-amber-200/90 leading-relaxed">
                声音设计需要百炼 Key，且模型为 Audio 3.0 Plus 或 Flash。
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
                disabled={creating || promptOver || previewShort || previewLong || !prompt.trim()}
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
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                      draft.status === 'ok'
                        ? 'text-emerald-300 border-emerald-500/40'
                        : draft.status === 'undeployed'
                          ? 'text-rose-300 border-rose-500/40'
                          : 'text-amber-300 border-amber-500/40'
                    }`}>
                      {statusLabel(draft.status)}
                    </span>
                  </div>
                  {draft.previewAudioUrl && (
                    <button
                      type="button"
                      onClick={() => (playing ? stopPreview() : playPreview(draft.previewAudioUrl))}
                      className="w-full py-1.5 rounded-lg border border-[#3a3a4a] text-zinc-200 hover:border-amber-500/40 flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      {playing ? '停止预览' : '试听这条'}
                    </button>
                  )}
                  {draft.status === 'ok' ? (
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
