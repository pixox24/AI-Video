import React, { useState } from 'react';
import {
  Settings,
  Monitor,
  Cpu,
  Key,
  Globe,
  Zap,
  AlertCircle,
  Eye,
  EyeOff,
  Check,
  RefreshCw,
  Image as ImageIcon,
  Upload,
  X,
  CheckCircle2,
  Layers,
  Sparkles,
  RotateCcw,
  Search,
  ListFilter,
  Brain,
  Mic,
  Clapperboard,
  Construction,
  Shield,
  Palette
} from 'lucide-react';
import { ProjectSettings, CustomLlmApiConfig, CustomTtsApiConfig } from '../types';
import {
  DEFAULT_CUSTOM_LLM_API,
  DEFAULT_CUSTOM_TTS_API,
  LLM_PROVIDER_PRESETS,
  TTS_PROVIDER_PRESETS,
  resolveImageApi,
  isImageApiReady,
  imageApiLabel,
  resolveLlmApi,
  isCustomLlmProvider,
  resolveTtsApi,
  isCustomTtsProvider
} from '../utils/presets';
import { defaultVoiceForModel, resolveBailianTtsEndpoint, resolveTtsVoiceId } from '../utils/ttsCatalog';
import { StyleDnaModule, StyleLibraryEntry, StylePack } from '../types';
import {
  DEFAULT_STYLE_VISION_API,
  DEFAULT_TRANSFER_MODULES,
  DNA_MODULE_LABEL,
  activeTransferModules,
  hydrateActiveStylePack,
  isStyleVisionReady,
  nearestVisualStyleFromPack,
  resolveStyleVisionApi,
  usesStyleDna
} from '../utils/stylePack';
import { compressStyleImage, getCachedStyleInfer, setCachedStyleInfer } from '../utils/styleInferClient';
import {
  STYLE_LIBRARY_MAX,
  catalogFromPack,
  findLibraryByImageHash,
  loadStyleLibrary,
  makeStyleCardThumb,
  saveStyleLibraryEntry
} from '../utils/styleLibrary';
import { showStatusToast } from '../utils/statusToast';
import { ImageApiSettingsSection } from './ImageApiSettings';

type SettingsSection = 'llm' | 'image' | 'style' | 'tts' | 'video' | 'system';

interface SettingsPanelProps {
  settings: ProjectSettings;
  onChange: (settings: ProjectSettings) => void;
  hasStoryboardClips?: boolean;
  onApplyStyleToExistingClips?: (pack?: StylePack) => void;
  onLibraryChange?: (entries: StyleLibraryEntry[]) => void;
  onOpenStylePanel?: () => void;
}

function sanitizeEndpoint(raw: string) {
  let val = raw.trim().replace(/^["']|["']$/g, '');
  if (val && !val.startsWith('http://') && !val.startsWith('https://')) {
    val = 'https://' + val;
  }
  return val;
}

function sanitizeKey(raw: string) {
  let val = raw.trim().replace(/^["']|["']$/g, '');
  if (val.toLowerCase().startsWith('bearer ')) {
    val = val.slice(7).trim();
  }
  return val;
}

function Switch({
  id,
  checked,
  onChange
}: {
  id?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500" />
    </label>
  );
}

function FieldLabel({
  icon,
  title,
  hint
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[13px] font-medium text-zinc-200 flex items-center gap-1.5">
        {icon}
        {title}
      </span>
      {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
    </div>
  );
}

function ComingSoonSection({
  title,
  description,
  items
}: {
  title: string;
  description: string;
  items: { name: string; hint: string }[];
}) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-zinc-800/80 border border-zinc-700/80 flex items-center justify-center">
            <Construction className="w-6 h-6 text-zinc-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
            <p className="mt-1.5 text-sm text-zinc-500 leading-relaxed">{description}</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400 bg-zinc-800/80 border border-zinc-700/70 px-2.5 py-1 rounded-full">
            即将开放
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {items.map((item) => (
            <div
              key={item.name}
              className="rounded-2xl border border-dashed border-zinc-700/80 bg-[#18181f] px-4 py-4 opacity-80"
            >
              <div className="text-sm font-medium text-zinc-300">{item.name}</div>
              <div className="mt-1 text-[12px] text-zinc-500 leading-relaxed">{item.hint}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  onChange,
  hasStoryboardClips = false,
  onApplyStyleToExistingClips,
  onLibraryChange,
  onOpenStylePanel
}) => {
  const [section, setSection] = useState<SettingsSection>('llm');
  const llmApi = resolveLlmApi(settings.customLlmApi);
  const imageApi = resolveImageApi(settings.customImageApi);
  const ttsApi = resolveTtsApi(settings.customTtsApi);
  const styleVision = resolveStyleVisionApi(settings.customStyleVisionApi);
  const usingCustomLlm = isCustomLlmProvider(llmApi);
  const usingCustomImage = isImageApiReady(imageApi);
  const usingCustomTts = isCustomTtsProvider(ttsApi);
  const usingStyleVision = isStyleVisionReady(styleVision);

  const navItems: {
    id: SettingsSection;
    label: string;
    hint: string;
    icon: React.ReactNode;
    status?: 'on' | 'soon';
  }[] = [
    {
      id: 'llm',
      label: 'LLM 文案',
      hint: '分镜 / 润色 / 拆镜',
      icon: <Brain className="w-4 h-4" />,
      status: usingCustomLlm ? 'on' : undefined
    },
    {
      id: 'image',
      label: '生图',
      hint: '分镜画面生成',
      icon: <ImageIcon className="w-4 h-4" />,
      status: usingCustomImage ? 'on' : undefined
    },
    {
      id: 'style',
      label: '美术世界',
      hint: '风格契约 / 上传反推',
      icon: <Palette className="w-4 h-4" />,
      status: usingStyleVision ? 'on' : undefined
    },
    {
      id: 'tts',
      label: 'TTS 配音',
      hint: '旁白语音合成',
      icon: <Mic className="w-4 h-4" />,
      status: usingCustomTts ? 'on' : undefined
    },
    {
      id: 'video',
      label: '视频生成',
      hint: '图生视频 / 文生视频',
      icon: <Clapperboard className="w-4 h-4" />,
      status: 'soon'
    },
    {
      id: 'system',
      label: '系统参数',
      hint: '画质 / 帧率 / 引擎',
      icon: <Monitor className="w-4 h-4" />
    }
  ];

  return (
    <section
      id="settings-workspace"
      className="flex-1 min-w-0 bg-[#131318] border border-[#23232c] rounded-2xl flex flex-col h-full overflow-hidden shadow-xl shadow-black/40"
    >
      <header className="px-6 py-4 border-b border-[#23232c] bg-[#16161c] flex items-center justify-between gap-4 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
            <Settings className="w-4 h-4 text-amber-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-100">系统偏好 & API 配置</h2>
            <p className="text-[12px] text-zinc-500 mt-0.5 truncate">
              按能力类型选择供应商。选中即生效。
            </p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-2 flex-shrink-0">
          <span className={`text-[11px] px-2.5 py-1 rounded-full border ${
            usingCustomLlm
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : 'bg-zinc-800 text-zinc-400 border-zinc-700'
          }`}>
            LLM {usingCustomLlm ? llmApi.model : '内置回退'}
          </span>
          <span className={`text-[11px] px-2.5 py-1 rounded-full border ${
            usingCustomImage
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : 'bg-zinc-800 text-zinc-400 border-zinc-700'
          }`}>
            生图 {imageApiLabel(imageApi)}
          </span>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <nav className="w-52 lg:w-56 flex-shrink-0 border-r border-[#23232c] bg-[#14141a] p-3 space-y-1 overflow-y-auto custom-scrollbar">
          {navItems.map((item) => {
            const active = section === item.id;
            return (
              <button
                key={item.id}
                id={`settings-nav-${item.id}`}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full text-left rounded-xl px-3 py-2.5 flex items-start gap-2.5 transition-all cursor-pointer ${
                  active
                    ? 'bg-amber-500/12 border border-amber-500/35 text-amber-200'
                    : 'border border-transparent text-zinc-400 hover:bg-[#1c1c24] hover:text-zinc-200'
                }`}
              >
                <span className={`mt-0.5 ${active ? 'text-amber-400' : 'text-zinc-500'}`}>{item.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-zinc-100">{item.label}</span>
                    {item.status === 'on' && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />}
                    {item.status === 'soon' && (
                      <span className="text-[9px] text-zinc-500 border border-zinc-700 rounded px-1 py-px">稍后</span>
                    )}
                  </span>
                  <span className="block text-[11px] text-zinc-500 mt-0.5 leading-snug">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar bg-[#121217]">
          {section === 'llm' && <LlmProviderSection settings={settings} onChange={onChange} />}
          {section === 'image' && <ImageApiSettingsSection settings={settings} onChange={onChange} />}
          {section === 'style' && (
            <StyleWorldSection
              settings={settings}
              onChange={onChange}
              hasStoryboardClips={hasStoryboardClips}
              onApplyStyleToExistingClips={onApplyStyleToExistingClips}
              onLibraryChange={onLibraryChange}
              onOpenStylePanel={onOpenStylePanel}
            />
          )}
          {section === 'tts' && <TtsProviderSection settings={settings} onChange={onChange} />}
          {section === 'video' && (
            <ComingSoonSection
              title="视频生成供应商"
              description="图生视频与文生视频将作为独立能力接入，不影响当前分镜拼装导出流程。"
              items={[
                { name: '可灵 Kling', hint: '高品质图生视频' },
                { name: 'Runway', hint: '电影级运动与镜头控制' },
                { name: 'Luma', hint: '快速概念动态预览' }
              ]}
            />
          )}
          {section === 'system' && <SystemSection settings={settings} onChange={onChange} />}
        </div>
      </div>
    </section>
  );
};

function LlmProviderSection({
  settings,
  onChange
}: {
  settings: ProjectSettings;
  onChange: (settings: ProjectSettings) => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    model?: string;
    preview?: string;
    error?: string;
  } | null>(null);

  const llmApi = resolveLlmApi(settings.customLlmApi);
  const isBuiltin = llmApi.provider === 'builtin';
  const currentPreset = LLM_PROVIDER_PRESETS.find((p) => p.id === llmApi.provider) || LLM_PROVIDER_PRESETS[0];

  const updateLlmApi = (updates: Partial<CustomLlmApiConfig>) => {
    const nextProvider = updates.provider ?? llmApi.provider;
    onChange({
      ...settings,
      customLlmApi: {
        ...llmApi,
        ...updates,
        provider: nextProvider,
        enabled: nextProvider !== 'builtin'
      }
    });
  };

  const handleSelectProvider = (providerId: CustomLlmApiConfig['provider']) => {
    const preset = LLM_PROVIDER_PRESETS.find((p) => p.id === providerId);
    if (!preset?.available) return;
    if (providerId === 'builtin') {
      updateLlmApi({ provider: 'builtin', enabled: false });
    } else {
      updateLlmApi({
        provider: providerId,
        enabled: true,
        endpoint: preset.defaultEndpoint || llmApi.endpoint,
        model: preset.defaultModel || llmApi.model
      });
    }
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!llmApi.endpoint.trim()) {
      setTestResult({ ok: false, error: '请先填写接口地址' });
      return;
    }
    if (!llmApi.apiKey.trim()) {
      setTestResult({ ok: false, error: '请先填写 API Key' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sanitizeEndpoint(llmApi.endpoint),
          apiKey: sanitizeKey(llmApi.apiKey),
          model: llmApi.model,
          provider: llmApi.provider
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setTestResult({
          ok: true,
          latencyMs: data.latencyMs,
          model: data.model,
          preview: data.preview
        });
        if (llmApi.provider === 'builtin') updateLlmApi({ enabled: true, provider: 'deepseek' });
      } else {
        setTestResult({
          ok: false,
          latencyMs: data.latencyMs,
          error: data.error || '连通性测试失败，请检查密钥或地址'
        });
      }
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message || '无法连接到本地服务' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h3 className="text-[15px] font-semibold text-zinc-100">LLM 文案模型</h3>
          <p className="mt-1 text-[13px] text-zinc-500 leading-relaxed max-w-2xl">
            选中即使用。内置引擎无需密钥；DeepSeek 需填写接口和 API Key。
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-5">
          <div className="space-y-2">
            <div className="text-[12px] text-zinc-500 px-0.5">供应商</div>
            {LLM_PROVIDER_PRESETS.map((preset) => {
              const selected = llmApi.provider === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  id={`llm-preset-${preset.id}`}
                  onClick={() => handleSelectProvider(preset.id)}
                  disabled={!preset.available}
                  className={`w-full text-left rounded-2xl border px-3.5 py-3 transition-all ${
                    !preset.available
                      ? 'border-dashed border-zinc-800 bg-[#16161c] opacity-60 cursor-not-allowed'
                      : selected
                        ? 'bg-amber-500/10 border-amber-500/50 cursor-pointer'
                        : 'bg-[#18181f] border-[#2a2a36] hover:border-zinc-600 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-zinc-100">{preset.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      preset.available
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-zinc-800 text-zinc-500'
                    }`}>
                      {preset.badge}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">{preset.description}</p>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-[#2a2a36] bg-[#17171e] p-5 space-y-5">
            {isBuiltin ? (
              <p className="text-[13px] text-zinc-400 leading-relaxed">
                {currentPreset.docHint}
              </p>
            ) : (
            <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <FieldLabel icon={<Globe className="w-3.5 h-3.5 text-amber-400" />} title="接口地址" hint="Base URL" />
                <input
                  id="input-llm-endpoint"
                  type="text"
                  value={llmApi.endpoint}
                  onChange={(e) => updateLlmApi({ endpoint: e.target.value })}
                  placeholder="https://api.deepseek.com"
                  className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel icon={<Key className="w-3.5 h-3.5 text-amber-400" />} title="API Key" hint="仅保存在本地" />
                <div className="relative">
                  <input
                    id="input-llm-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={llmApi.apiKey}
                    onChange={(e) => updateLlmApi({ apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl pl-3 pr-10 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 cursor-pointer p-1"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <FieldLabel icon={<Zap className="w-3.5 h-3.5 text-amber-400" />} title="模型" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {currentPreset.popularModels.map((model) => {
                  const selected = llmApi.model === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => updateLlmApi({ model: model.id })}
                      className={`text-left rounded-xl border px-3.5 py-3 cursor-pointer transition-all ${
                        selected
                          ? 'bg-amber-500/12 border-amber-500/50'
                          : 'bg-[#121217] border-[#2b2b38] hover:border-zinc-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-medium text-zinc-100">{model.label}</span>
                        {selected && <Check className="w-3.5 h-3.5 text-amber-400" />}
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-zinc-500">{model.id}</div>
                      <div className="mt-1 text-[11px] text-zinc-500">{model.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                id="btn-test-llm-api"
                type="button"
                onClick={handleTest}
                disabled={isTesting}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-[13px] font-semibold rounded-xl flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                {isTesting ? '正在测试...' : '测试连通性'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange({ ...settings, customLlmApi: { ...DEFAULT_CUSTOM_LLM_API } });
                  setTestResult(null);
                }}
                className="px-3 py-2 text-[12px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                恢复默认
              </button>
            </div>

            {testResult && (
              <div
                id="llm-api-test-result"
                className={`rounded-xl border px-3.5 py-3 text-[12px] ${
                  testResult.ok
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 font-medium">
                    {testResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
                    {testResult.ok ? '接口可用' : '测试失败'}
                  </div>
                  {testResult.latencyMs != null && (
                    <span className="font-mono text-[11px] opacity-80">{testResult.latencyMs} ms</span>
                  )}
                </div>
                {testResult.ok && (
                  <p className="mt-1.5 text-zinc-300">
                    模型 <span className="font-mono text-zinc-100">{testResult.model}</span>
                    {testResult.preview ? ` · ${testResult.preview}` : ''}
                  </p>
                )}
                {!testResult.ok && testResult.error && (
                  <p className="mt-1.5 font-mono break-all text-rose-200/90">{testResult.error}</p>
                )}
              </div>
            )}

            <p className="text-[11px] text-zinc-500 leading-relaxed border-t border-[#2a2a36] pt-3">
              {currentPreset.docHint} 密钥只保存在浏览器本地，由本机服务转发请求。
            </p>
            </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function StyleWorldSection({
  settings,
  onChange,
  hasStoryboardClips = false,
  onApplyStyleToExistingClips,
  onLibraryChange,
  onOpenStylePanel
}: {
  settings: ProjectSettings;
  onChange: (settings: ProjectSettings) => void;
  hasStoryboardClips?: boolean;
  onApplyStyleToExistingClips?: (pack?: StylePack) => void;
  onLibraryChange?: (entries: StyleLibraryEntry[]) => void;
  onOpenStylePanel?: () => void;
}) {
  const pack = hydrateActiveStylePack(settings);
  const vision = resolveStyleVisionApi(settings.customStyleVisionApi);
  const ttsApi = resolveTtsApi(settings.customTtsApi);
  const ready = isStyleVisionReady(vision);
  const ttsBailianKey = ttsApi.provider === 'bailian' ? ttsApi.apiKey.trim() : '';
  const canCopyTtsKey = Boolean(ttsBailianKey) && ttsBailianKey !== vision.apiKey.trim();
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; latencyMs?: number } | null>(null);
  const [isInferring, setIsInferring] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageHash, setImageHash] = useState<string | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const [draftPack, setDraftPack] = useState<StylePack | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [draftBlurb, setDraftBlurb] = useState('');
  const [duplicateEntry, setDuplicateEntry] = useState<StyleLibraryEntry | null>(null);
  const [isPushing, setIsPushing] = useState(false);

  const fillDraftCatalog = (nextPack: StylePack, hash?: string | null) => {
    const catalog = catalogFromPack(nextPack);
    setDraftTitle(catalog.title);
    setDraftTags(catalog.tags);
    setDraftBlurb(catalog.blurb);
    setDuplicateEntry(findLibraryByImageHash(hash || nextPack.reference?.imageId || imageHash));
  };

  const updateVision = (updates: Partial<typeof vision>) => {
    const next = { ...vision, ...updates };
    onChange({
      ...settings,
      customStyleVisionApi: {
        ...next,
        enabled: Boolean(next.apiKey.trim())
      }
    });
  };

  const updateDraft = (updates: Partial<StylePack>) => {
    if (!draftPack) return;
    setDraftPack({
      ...draftPack,
      ...updates,
      world: { ...draftPack.world, ...(updates.world || {}) },
      render: { ...draftPack.render, ...(updates.render || {}) }
    });
  };

  const handleClearImage = () => {
    setPreviewUrl(null);
    setImageHash(null);
    setDraftPack(null);
    setDuplicateEntry(null);
    setDraftTitle('');
    setDraftTags([]);
    setDraftBlurb('');
  };

  const handlePickImage = async (file?: File | null) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      showStatusToast('请使用 JPG / PNG / WebP 图片', { tone: 'warn', id: 'style-infer' });
      return;
    }
    try {
      const compressed = await compressStyleImage(file);
      setPreviewUrl(compressed.dataUrl);
      setImageHash(compressed.hash);
      setDraftPack(null);
      setDuplicateEntry(null);
      const cached = getCachedStyleInfer(compressed.hash);
      if (cached) {
        const nextPack = {
          ...cached,
          reference: {
            ...cached.reference,
            imageId: compressed.hash,
            thumbDataUrl: compressed.dataUrl
          }
        };
        setDraftPack(nextPack);
        fillDraftCatalog(nextPack, compressed.hash);
        showStatusToast('已用缓存的反推结果，可直接确认', { tone: 'ok', id: 'style-infer' });
      }
    } catch (err: any) {
      showStatusToast(err?.message || '图片无法使用', { tone: 'error', id: 'style-infer' });
    }
  };

  const handleInfer = async () => {
    if (!ready) {
      showStatusToast('先在下方填写百炼 API Key', { tone: 'warn', id: 'style-infer' });
      return;
    }
    if (!previewUrl || !imageHash) {
      showStatusToast('请先上传参考图', { tone: 'warn', id: 'style-infer' });
      return;
    }
    const cached = getCachedStyleInfer(imageHash);
    if (cached) {
      const nextPack = {
        ...cached,
        reference: { ...cached.reference, imageId: imageHash, thumbDataUrl: previewUrl }
      };
      setDraftPack(nextPack);
      fillDraftCatalog(nextPack);
      showStatusToast('已用缓存的反推结果，可直接确认', { tone: 'ok', id: 'style-infer' });
      return;
    }

    setIsInferring(true);
    showStatusToast('正在用 qwen3.7-plus 看图…', { tone: 'progress', id: 'style-infer', durationMs: 0 });
    try {
      const res = await fetch('/api/style/infer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageDataUrl: previewUrl,
          imageHash,
          visionApi: vision
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok || !data.pack) {
        throw new Error(data?.error || '风格反推失败');
      }
      const nextPack: StylePack = {
        ...data.pack,
        reference: {
          ...data.pack.reference,
          imageId: imageHash,
          thumbDataUrl: previewUrl
        }
      };
      setDraftPack(nextPack);
      fillDraftCatalog(nextPack);
      setCachedStyleInfer(imageHash, nextPack);
      showStatusToast(
        (nextPack.confidence ?? 1) < 0.45 ? '反推置信度偏低，请核对后再锁定' : '反推完成，可锁定或推到风格栏',
        { tone: (nextPack.confidence ?? 1) < 0.45 ? 'warn' : 'ok', id: 'style-infer' }
      );
    } catch (err: any) {
      showStatusToast(`风格反推失败：${err?.message || '未知错误'}`, { tone: 'error', id: 'style-infer' });
    } finally {
      setIsInferring(false);
    }
  };

  const labeledDraft = (): StylePack | null => {
    if (!draftPack) return null;
    const title = draftTitle.trim().slice(0, 16) || catalogFromPack(draftPack).title;
    return {
      ...draftPack,
      label: title,
      pinned: true,
      createdAt: draftPack.createdAt || Date.now()
    };
  };

  const handleConfirmPack = () => {
    const locked = labeledDraft();
    if (!locked) return;
    onChange({
      ...settings,
      visualStyle: nearestVisualStyleFromPack(locked),
      activeStylePack: locked
    });
    if (hasStoryboardClips && onApplyStyleToExistingClips) {
      showStatusToast(`已锁定美术世界：${locked.label}`, {
        tone: 'ok',
        id: 'style-infer',
        durationMs: 8000,
        actionLabel: '写入分镜画面词',
        onAction: () => onApplyStyleToExistingClips(locked)
      });
    } else {
      showStatusToast(`已锁定美术世界：${locked.label}`, { tone: 'ok', id: 'style-infer' });
    }
    setDraftPack(null);
    setDuplicateEntry(null);
  };

  const handlePushToLibrary = async (opts?: { lock?: boolean; overwriteId?: string; forceNew?: boolean }) => {
    const locked = labeledDraft();
    if (!locked) return;
    if ((locked.confidence ?? 1) < 0.45 && !opts?.overwriteId && !opts?.forceNew) {
      showStatusToast('置信度偏低，请改完标题后再推到风格栏', { tone: 'warn', id: 'style-library' });
    }
    setIsPushing(true);
    try {
      const thumb = previewUrl ? await makeStyleCardThumb(previewUrl) : locked.reference?.thumbDataUrl;
      const result = saveStyleLibraryEntry({
        pack: locked,
        title: locked.label,
        tags: draftTags,
        blurb: draftBlurb,
        thumbDataUrl: thumb,
        imageHash: imageHash || locked.reference?.imageId,
        nearestVisualStyle: nearestVisualStyleFromPack(locked),
        overwriteId: opts?.overwriteId,
        forceNew: opts?.forceNew
      });
      if (result.ok === false) {
        if (result.reason === 'full') {
          showStatusToast(`风格栏已满（${STYLE_LIBRARY_MAX}），请先删一张`, { tone: 'warn', id: 'style-library' });
        } else {
          setDuplicateEntry(result.existing);
          showStatusToast(`这张图已入库为「${result.existing.title}」`, { tone: 'warn', id: 'style-library' });
        }
        return;
      }
      onLibraryChange?.(loadStyleLibrary());
      setDuplicateEntry(null);
      if (opts?.lock) {
        onChange({
          ...settings,
          visualStyle: result.entry.nearestVisualStyle,
          activeStylePack: result.entry.pack
        });
        setDraftPack(null);
      }
      showStatusToast(result.overwritten ? `已覆盖「${result.entry.title}」` : `已推到风格栏：${result.entry.title}`, {
        tone: 'ok',
        id: 'style-library',
        durationMs: 8000,
        actionLabel: onOpenStylePanel ? '去风格页' : undefined,
        onAction: onOpenStylePanel
      });
    } catch (err: any) {
      showStatusToast(err?.message || '无法写入风格栏', { tone: 'error', id: 'style-library' });
    } finally {
      setIsPushing(false);
    }
  };

  const handleTestVision = async () => {
    if (!vision.apiKey.trim()) {
      setTestResult({ ok: false, error: '请先填写 API Key' });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/style/vision-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visionApi: vision })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setTestResult({ ok: true, latencyMs: data.latencyMs });
        showStatusToast('百炼视觉接口可用', { tone: 'ok', id: 'style-vision-test' });
      } else {
        setTestResult({ ok: false, error: data.error || '连通性测试失败', latencyMs: data.latencyMs });
        showStatusToast(data.error || '连通性测试失败', { tone: 'error', id: 'style-vision-test' });
      }
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message || '无法连接到本地服务' });
    } finally {
      setIsTesting(false);
    }
  };

  const policyLabel =
    pack.contemporaryPolicy === 'adapt' ? '当代题材译成这个世界'
      : pack.contemporaryPolicy === 'costume' ? '人仍当代，只换画法'
        : '只改画法与光影';

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h3 className="text-[15px] font-semibold text-zinc-100">美术世界</h3>
          <p className="mt-1 text-[13px] text-zinc-500 leading-relaxed max-w-2xl">
            反推图会编译成风格基因（色彩/光影/媒介），不会把图里的人物和物体写进每一镜。日常换预设请到「风格」页。
          </p>
        </div>

        <div className="rounded-2xl border border-[#2a2a36] bg-[#17171e] p-5 space-y-3">
          <FieldLabel icon={<Palette className="w-3.5 h-3.5 text-amber-400" />} title="当前生效包" />
          <div className="text-[14px] text-zinc-100">{pack.label}</div>
          <div className="text-[12px] text-zinc-400">
            来源 {pack.source === 'inferred' ? '上传反推 · 风格基因' : '预设'} · {policyLabel}
          </div>
          {usesStyleDna(pack) ? (
            <>
              <p className="text-[12px] text-zinc-400">
                迁 {(pack.transferModules || DEFAULT_TRANSFER_MODULES).map((id) => DNA_MODULE_LABEL[id]).join('、')}
              </p>
              <p className="text-[11px] text-zinc-500">
                剥掉：{(pack.contentToIgnore || []).join('、') || '参考图中的人物与物体'}
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12px] text-zinc-400">
                <div className="rounded-xl bg-[#121217] border border-[#2b2b38] px-3 py-2">服饰：{pack.world.wardrobe}</div>
                <div className="rounded-xl bg-[#121217] border border-[#2b2b38] px-3 py-2">空间：{pack.world.space}</div>
              </div>
              <p className="text-[11px] text-zinc-500">禁止：{pack.world.dont.join('、')}</p>
            </>
          )}
          {hasStoryboardClips && onApplyStyleToExistingClips && (
            <button
              type="button"
              onClick={() => onApplyStyleToExistingClips()}
              className="px-3 py-2 rounded-xl text-[12px] font-medium border border-amber-500/40 text-amber-200 hover:bg-amber-500/10 cursor-pointer"
            >
              写入分镜画面词（旁白不动）
            </button>
          )}
        </div>

        <div className="rounded-2xl border border-dashed border-[#2a2a36] bg-[#17171e] p-5 space-y-3">
          <FieldLabel icon={<ImageIcon className="w-3.5 h-3.5 text-amber-400" />} title="从一张图反推" />
          <p className="text-[12px] text-zinc-500 leading-relaxed">
            上传参考图，编译成可迁移的风格基因。新分镜只继承色彩、光影和媒介，不复制图里的人、物和场景。确认前不会改当前生效包。
          </p>
          <input
            id="input-style-reference-image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              void handlePickImage(e.target.files?.[0]);
              e.target.value = '';
            }}
            className="hidden"
          />
          <div
            role="button"
            tabIndex={0}
            onClick={() => document.getElementById('input-style-reference-image')?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                document.getElementById('input-style-reference-image')?.click();
              }
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDropActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDropActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handlePickImage(file);
            }}
            className={`rounded-xl border border-dashed px-4 py-6 text-center cursor-pointer transition-colors ${
              dropActive
                ? 'border-amber-500/70 bg-amber-500/10'
                : 'border-[#2b2b38] bg-[#121217] hover:border-zinc-500'
            }`}
          >
            <Upload className={`w-5 h-5 mx-auto mb-2 ${dropActive ? 'text-amber-300' : 'text-zinc-500'}`} />
            <p className="text-[12px] text-zinc-300">把图片拖到这里，或点击选择</p>
            <p className="text-[11px] text-zinc-500 mt-1">JPG / PNG / WebP，不超过 4MB</p>
          </div>
          {previewUrl && (
            <div className="relative w-28 h-28">
              <img src={previewUrl} alt="" className="w-28 h-28 object-cover rounded-xl border border-[#2b2b38]" />
              <button
                type="button"
                title="移除图片"
                onClick={handleClearImage}
                className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[#1b1b22] border border-[#3a3a48] text-zinc-300 hover:text-rose-300 hover:border-rose-400/50 flex items-center justify-center cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <button
            id="btn-infer-style-pack"
            type="button"
            onClick={() => { void handleInfer(); }}
            disabled={!ready || !previewUrl || isInferring}
            className="px-4 py-2 rounded-xl text-[13px] font-medium bg-amber-500 text-black disabled:bg-[#252532] disabled:text-zinc-500 cursor-pointer disabled:cursor-not-allowed"
          >
            {isInferring ? '正在反推...' : ready ? '开始反推' : '先填写百炼 API Key'}
          </button>
        </div>

        {draftPack && (
          <div id="style-infer-result-card" className="rounded-2xl border border-amber-500/30 bg-[#17171e] p-5 space-y-3">
            <FieldLabel icon={<Palette className="w-3.5 h-3.5 text-amber-400" />} title="反推结果（未确认不生效）" />
            {(draftPack.confidence ?? 1) < 0.45 && (
              <p className="text-[12px] text-amber-300">置信度偏低，请改完再锁定。</p>
            )}
            <div className="space-y-1.5">
              <div className="text-[11px] text-zinc-500">标题</div>
              <input
                value={draftTitle}
                onChange={(e) => {
                  setDraftTitle(e.target.value);
                  updateDraft({ label: e.target.value });
                }}
                className="w-full bg-[#121217] border border-[#2b2b38] rounded-xl px-3 py-2 text-[13px] text-zinc-100 outline-none"
                placeholder="风格标题"
                maxLength={16}
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] text-zinc-500">标签</div>
              <div className="flex flex-wrap gap-1.5">
                {draftTags.map((tag) => (
                  <span key={tag} className="px-2 py-0.5 rounded-lg text-[11px] bg-[#121217] border border-[#2b2b38] text-zinc-300">
                    {tag}
                  </span>
                ))}
              </div>
              <input
                value={draftTags.join(' ')}
                onChange={(e) => setDraftTags(e.target.value.split(/[\s,，、]+/).map((item) => item.trim()).filter(Boolean).slice(0, 4))}
                className="w-full bg-[#121217] border border-[#2b2b38] rounded-xl px-3 py-2 text-[12px] text-zinc-200 outline-none"
                placeholder="空格分隔，最多 4 个"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] text-zinc-500">简介</div>
              <textarea
                value={draftBlurb}
                onChange={(e) => setDraftBlurb(e.target.value)}
                rows={2}
                maxLength={48}
                className="w-full bg-[#121217] border border-[#2b2b38] rounded-xl px-3 py-2 text-[12px] text-zinc-200 outline-none resize-none"
                placeholder="一句介绍这套世界"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] text-zinc-500">从图中剥掉（不会写进分镜）</div>
              <div className="flex flex-wrap gap-1.5">
                {(draftPack.contentToIgnore || []).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => updateDraft({
                      contentToIgnore: (draftPack.contentToIgnore || []).filter((entry) => entry !== item)
                    })}
                    className="px-2 py-0.5 rounded-lg text-[11px] bg-[#121217] border border-[#2b2b38] text-zinc-300 hover:border-rose-400/50 cursor-pointer"
                    title="点击移除"
                  >
                    {item} ×
                  </button>
                ))}
              </div>
              <input
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const value = (e.target as HTMLInputElement).value.trim();
                  if (!value) return;
                  updateDraft({ contentToIgnore: [...(draftPack.contentToIgnore || []), value].slice(0, 8) });
                  (e.target as HTMLInputElement).value = '';
                }}
                className="w-full bg-[#121217] border border-[#2b2b38] rounded-xl px-3 py-2 text-[12px] text-zinc-200 outline-none"
                placeholder="回车追加，例如：火焰、红夹克"
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] text-zinc-500">迁移到新分镜（默认色彩+光影+媒介+材质+情绪）</div>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(DNA_MODULE_LABEL) as StyleDnaModule[]).map((id) => {
                  const on = activeTransferModules(draftPack).includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        const current = activeTransferModules(draftPack);
                        const next = on ? current.filter((item) => item !== id) : [...current, id];
                        updateDraft({
                          transferModules: next.length > 0 ? next : DEFAULT_TRANSFER_MODULES,
                          contemporaryPolicy: next.includes('world') ? 'adapt' : 'filter'
                        });
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] border cursor-pointer ${
                        on
                          ? 'bg-amber-500/20 text-amber-200 border-amber-500/50'
                          : 'bg-[#121217] text-zinc-500 border-[#2b2b38]'
                      }`}
                    >
                      {DNA_MODULE_LABEL[id]}
                    </button>
                  );
                })}
              </div>
            </div>
            {draftPack.dna && (
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                {[draftPack.dna.color?.ratio, draftPack.dna.lighting?.key, draftPack.dna.rendering?.medium, (draftPack.dna.mood || []).join('、')]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
            {activeTransferModules(draftPack).includes('world') && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input
                  value={draftPack.world.era}
                  onChange={(e) => updateDraft({ world: { ...draftPack.world, era: e.target.value } })}
                  className="bg-[#121217] border border-[#2b2b38] rounded-xl px-3 py-2 text-[12px] text-zinc-200 outline-none"
                  placeholder="时代"
                />
                <input
                  value={draftPack.world.wardrobe}
                  onChange={(e) => updateDraft({ world: { ...draftPack.world, wardrobe: e.target.value } })}
                  className="bg-[#121217] border border-[#2b2b38] rounded-xl px-3 py-2 text-[12px] text-zinc-200 outline-none"
                  placeholder="服饰"
                />
                <input
                  value={draftPack.world.space}
                  onChange={(e) => updateDraft({ world: { ...draftPack.world, space: e.target.value } })}
                  className="md:col-span-2 bg-[#121217] border border-[#2b2b38] rounded-xl px-3 py-2 text-[12px] text-zinc-200 outline-none"
                  placeholder="空间"
                />
              </div>
            )}
            {duplicateEntry && (
              <p className="text-[12px] text-amber-300">
                这张图已入库为「{duplicateEntry.title}」。可覆盖，或另存一份。
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                id="btn-discard-style-pack"
                type="button"
                onClick={() => {
                  setDraftPack(null);
                  setDuplicateEntry(null);
                }}
                className="px-3 py-2 rounded-xl text-[12px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                放弃
              </button>
              <button
                id="btn-confirm-style-pack"
                type="button"
                onClick={handleConfirmPack}
                className="px-3 py-2 rounded-xl text-[12px] text-zinc-200 border border-[#2b2b38] cursor-pointer"
              >
                {(draftPack.confidence ?? 1) < 0.45 ? '仍要锁定当前' : '只锁定为当前世界'}
              </button>
              {duplicateEntry ? (
                <>
                  <button
                    type="button"
                    disabled={isPushing}
                    onClick={() => { void handlePushToLibrary({ lock: true, overwriteId: duplicateEntry.id }); }}
                    className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-amber-500 text-black cursor-pointer disabled:opacity-50"
                  >
                    覆盖并推到风格栏
                  </button>
                  <button
                    type="button"
                    disabled={isPushing}
                    onClick={() => { void handlePushToLibrary({ lock: true, forceNew: true }); }}
                    className="px-3 py-2 rounded-xl text-[12px] text-amber-200 border border-amber-500/40 cursor-pointer disabled:opacity-50"
                  >
                    另存一份
                  </button>
                </>
              ) : (
                <button
                  id="btn-push-style-library"
                  type="button"
                  disabled={isPushing}
                  onClick={() => { void handlePushToLibrary({ lock: true }); }}
                  className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-amber-500 text-black cursor-pointer disabled:opacity-50"
                >
                  {isPushing ? '正在推送…' : '锁定并推到风格栏'}
                </button>
              )}
            </div>
            {!duplicateEntry && (
              <button
                type="button"
                disabled={isPushing}
                onClick={() => { void handlePushToLibrary({ lock: false }); }}
                className="text-[12px] text-zinc-400 hover:text-zinc-200 cursor-pointer disabled:opacity-40"
              >
                只推到风格栏，不改当前世界
              </button>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-[#2a2a36] bg-[#17171e] p-5 space-y-4">
          <FieldLabel icon={<Key className="w-3.5 h-3.5 text-amber-400" />} title="百炼视觉理解 API" hint="自备 Key" />
          <p className="text-[12px] text-zinc-500 leading-relaxed">
            北京地域 DashScope 兼容 OpenAI 的 chat/completions。默认模型 qwen3.7-plus。可与 TTS 用同一把 Key，但要在这一栏再填一次（不会自动带过来）。接口请用 compatible-mode，不要填 TTS 的 multimodal-generation 地址。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <FieldLabel icon={<Globe className="w-3.5 h-3.5 text-amber-400" />} title="接口地址" />
              <input
                id="style-vision-endpoint"
                type="text"
                value={vision.endpoint}
                onChange={(e) => updateVision({ endpoint: e.target.value })}
                placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel icon={<Key className="w-3.5 h-3.5 text-amber-400" />} title="API Key" hint="仅保存在本地" />
              <div className="relative">
                <input
                  id="style-vision-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  value={vision.apiKey}
                  onChange={(e) => updateVision({ apiKey: e.target.value })}
                  placeholder="sk-..."
                  className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl pl-3 pr-10 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 cursor-pointer p-1"
                >
                  {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <FieldLabel icon={<Zap className="w-3.5 h-3.5 text-amber-400" />} title="模型" />
            <input
              id="style-vision-model"
              type="text"
              value={vision.model}
              onChange={(e) => updateVision({ model: e.target.value })}
              placeholder="qwen3.7-plus"
              className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {['qwen3.7-plus', 'qwen3.7-plus-2026-05-26', 'qwen3.6-flash'].map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => updateVision({ model: id })}
                  className={`px-2.5 py-1.5 rounded-lg text-[11px] border cursor-pointer ${
                    vision.model === id
                      ? 'bg-amber-500/20 text-amber-200 border-amber-500/50'
                      : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                  }`}
                >
                  {id}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canCopyTtsKey && (
              <button
                type="button"
                onClick={() => updateVision({ apiKey: ttsBailianKey })}
                className="px-3 py-2 rounded-xl text-[12px] border border-amber-500/40 text-amber-200 hover:bg-amber-500/10 cursor-pointer"
              >
                填入 TTS 同一把 Key
              </button>
            )}
            <button
              id="btn-test-style-vision"
              type="button"
              onClick={() => { void handleTestVision(); }}
              disabled={isTesting || !vision.apiKey.trim()}
              className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-amber-500 text-black disabled:opacity-50 cursor-pointer"
            >
              {isTesting ? '正在测试…' : '测试连通'}
            </button>
          </div>
          {testResult && (
            <p className={`text-[12px] ${testResult.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {testResult.ok ? `接口可用${testResult.latencyMs != null ? ` · ${testResult.latencyMs} ms` : ''}` : testResult.error}
            </p>
          )}
          <button
            type="button"
            onClick={() => onChange({ ...settings, customStyleVisionApi: { ...DEFAULT_STYLE_VISION_API } })}
            className="text-[12px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            恢复默认接口
          </button>
        </div>
      </div>
    </div>
  );
}

function TtsProviderSection({
  settings,
  onChange
}: {
  settings: ProjectSettings;
  onChange: (settings: ProjectSettings) => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    model?: string;
    voice?: string;
    audioUrl?: string;
    error?: string;
  } | null>(null);

  const ttsApi = resolveTtsApi(settings.customTtsApi);
  const isBuiltin = ttsApi.provider === 'edge';
  const currentPreset = TTS_PROVIDER_PRESETS.find((p) => p.id === ttsApi.provider) || TTS_PROVIDER_PRESETS[0];

  const updateTtsApi = (updates: Partial<CustomTtsApiConfig>) => {
    const nextProvider = updates.provider ?? ttsApi.provider;
    onChange({
      ...settings,
      customTtsApi: {
        ...ttsApi,
        ...updates,
        provider: nextProvider,
        enabled: nextProvider !== 'edge'
      }
    });
  };

  const handleSelectProvider = (providerId: CustomTtsApiConfig['provider']) => {
    const preset = TTS_PROVIDER_PRESETS.find((p) => p.id === providerId);
    if (!preset?.available) return;
    if (providerId === 'edge') {
      updateTtsApi({ provider: 'edge', enabled: false });
    } else {
      updateTtsApi({
        provider: providerId,
        enabled: true,
        endpoint: preset.defaultEndpoint || ttsApi.endpoint,
        model: preset.defaultModel || ttsApi.model,
        voice: preset.defaultVoice || ttsApi.voice
      });
    }
    setTestResult(null);
  };

  const handleTest = async () => {
    if (!ttsApi.apiKey.trim()) {
      setTestResult({ ok: false, error: '请先填写 API Key' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/audio/tts/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sanitizeEndpoint(ttsApi.endpoint),
          apiKey: sanitizeKey(ttsApi.apiKey),
          model: ttsApi.model,
          voice: ttsApi.voice
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setTestResult({
          ok: true,
          latencyMs: data.latencyMs,
          model: data.model,
          voice: data.voice,
          audioUrl: data.audioUrl
        });
      } else {
        setTestResult({
          ok: false,
          latencyMs: data.latencyMs,
          error: data.error || '连通性测试失败，请检查密钥或音色'
        });
      }
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message || '无法连接到本地服务' });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h3 className="text-[15px] font-semibold text-zinc-100">TTS 配音供应商</h3>
          <p className="mt-1 text-[13px] text-zinc-500 leading-relaxed max-w-2xl">
            选中即使用。后台选哪个模型，试听、整段旁白和导出都走同一个。内置 Edge TTS 无需密钥；阿里云百炼需填写北京地域 API Key。日常选音色请到「声音」页。
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)] gap-5">
          <div className="space-y-2">
            <div className="text-[12px] text-zinc-500 px-0.5">供应商</div>
            {TTS_PROVIDER_PRESETS.map((preset) => {
              const selected = ttsApi.provider === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  id={`tts-preset-${preset.id}`}
                  onClick={() => handleSelectProvider(preset.id)}
                  disabled={!preset.available}
                  className={`w-full text-left rounded-2xl border px-3.5 py-3 transition-all ${
                    !preset.available
                      ? 'border-dashed border-zinc-800 bg-[#16161c] opacity-60 cursor-not-allowed'
                      : selected
                        ? 'bg-amber-500/10 border-amber-500/50 cursor-pointer'
                        : 'bg-[#18181f] border-[#2a2a36] hover:border-zinc-600 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-zinc-100">{preset.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      preset.available
                        ? 'bg-emerald-500/15 text-emerald-300'
                        : 'bg-zinc-800 text-zinc-500'
                    }`}>
                      {preset.badge}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">{preset.description}</p>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-[#2a2a36] bg-[#17171e] p-5 space-y-5">
            {isBuiltin ? (
              <p className="text-[13px] text-zinc-400 leading-relaxed">
                {currentPreset.docHint}
              </p>
            ) : (
            <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <FieldLabel icon={<Globe className="w-3.5 h-3.5 text-amber-400" />} title="接口地址" hint="Endpoint" />
                <input
                  id="input-tts-endpoint"
                  type="text"
                  value={ttsApi.endpoint}
                  onChange={(e) => updateTtsApi({ endpoint: e.target.value })}
                  placeholder="https://dashscope.aliyuncs.com/api/v1/..."
                  className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
                />
              </div>
              <div className="space-y-1.5">
                <FieldLabel icon={<Key className="w-3.5 h-3.5 text-amber-400" />} title="API Key" hint="仅保存在本地" />
                <div className="relative">
                  <input
                    id="input-tts-api-key"
                    type={showApiKey ? 'text' : 'password'}
                    value={ttsApi.apiKey}
                    onChange={(e) => updateTtsApi({ apiKey: e.target.value })}
                    placeholder="sk-..."
                    className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl pl-3 pr-10 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 cursor-pointer p-1"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <FieldLabel icon={<Zap className="w-3.5 h-3.5 text-amber-400" />} title="模型" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {currentPreset.popularModels.map((model) => {
                  const selected = ttsApi.model === model.id;
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        const nextModel = model.id;
                        updateTtsApi({
                          model: nextModel,
                          endpoint: resolveBailianTtsEndpoint(ttsApi.endpoint, nextModel),
                          voice: resolveTtsVoiceId(ttsApi.voice, { ...ttsApi, model: nextModel })
                        });
                      }}
                      className={`text-left rounded-xl border px-3.5 py-3 cursor-pointer transition-all ${
                        selected
                          ? 'bg-amber-500/12 border-amber-500/50'
                          : 'bg-[#121217] border-[#2b2b38] hover:border-zinc-600'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[13px] font-medium text-zinc-100">{model.label}</span>
                        {selected && <Check className="w-3.5 h-3.5 text-amber-400" />}
                      </div>
                      <div className="mt-1 text-[11px] font-mono text-zinc-500 truncate">{model.id}</div>
                      <div className="mt-1 text-[11px] text-zinc-500">{model.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <FieldLabel icon={<Mic className="w-3.5 h-3.5 text-amber-400" />} title="连通测试音色" />
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                日常换声音请到左侧「声音」。这里只影响「测试并试听」，也可填目录外的 voice id。3.0 与 Qwen3 的音色不能混用。
              </p>
              <input
                id="input-tts-voice"
                type="text"
                value={ttsApi.voice}
                onChange={(e) => updateTtsApi({ voice: e.target.value })}
                placeholder={defaultVoiceForModel(ttsApi.model)}
                className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                id="btn-test-tts-api"
                type="button"
                onClick={handleTest}
                disabled={isTesting}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-[13px] font-semibold rounded-xl flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                {isTesting ? '正在合成测试音...' : '测试并试听'}
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange({ ...settings, customTtsApi: { ...DEFAULT_CUSTOM_TTS_API } });
                  setTestResult(null);
                }}
                className="px-3 py-2 text-[12px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                恢复默认
              </button>
            </div>

            {testResult && (
              <div
                id="tts-api-test-result"
                className={`rounded-xl border px-3.5 py-3 space-y-2 text-[12px] ${
                  testResult.ok
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                    : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-1.5 font-medium">
                    {testResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
                    {testResult.ok ? '接口可用' : '测试失败'}
                  </div>
                  {testResult.latencyMs != null && (
                    <span className="font-mono text-[11px] opacity-80">{testResult.latencyMs} ms</span>
                  )}
                </div>
                {testResult.ok && (
                  <div className="space-y-1">
                    <p className="text-zinc-300">
                      模型 <span className="font-mono text-zinc-100">{testResult.model}</span>
                      {testResult.voice ? ` · 音色 ${testResult.voice}` : ''}
                    </p>
                    {testResult.audioUrl && (
                      <audio controls src={testResult.audioUrl} className="w-full h-9" preload="metadata" />
                    )}
                  </div>
                )}
                {!testResult.ok && testResult.error && (
                  <p className="font-mono break-all text-rose-200/90">{testResult.error}</p>
                )}
              </div>
            )}

            <p className="text-[11px] text-zinc-500 leading-relaxed border-t border-[#2a2a36] pt-3">
              {currentPreset.docHint} 密钥只保存在浏览器本地，由本机服务转发请求。
            </p>
            </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SystemSection({
  settings,
  onChange
}: {
  settings: ProjectSettings;
  onChange: (settings: ProjectSettings) => void;
}) {
  const llmApi = resolveLlmApi(settings.customLlmApi);
  const imageApi = resolveImageApi(settings.customImageApi);
  const ttsApi = resolveTtsApi(settings.customTtsApi);

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h3 className="text-[15px] font-semibold text-zinc-100">系统与导出</h3>
          <p className="mt-1 text-[13px] text-zinc-500">画质、帧率与当前引擎状态。</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-[#2a2a36] bg-[#17171e] p-5 space-y-3">
            <FieldLabel icon={<Monitor className="w-3.5 h-3.5 text-amber-400" />} title="导出画质" />
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: '720p', label: '720P', desc: '更快' },
                { id: '1080p', label: '1080P', desc: '常用' },
                { id: '4k', label: '4K', desc: '超清' }
              ].map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => onChange({ ...settings, exportQuality: q.id as ProjectSettings['exportQuality'] })}
                  className={`rounded-xl border py-3 cursor-pointer ${
                    settings.exportQuality === q.id
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                      : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                  }`}
                >
                  <div className="text-[13px] font-medium">{q.label}</div>
                  <div className="text-[11px] text-zinc-500 mt-0.5">{q.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-[#2a2a36] bg-[#17171e] p-5 space-y-3">
            <FieldLabel icon={<Cpu className="w-3.5 h-3.5 text-amber-400" />} title="视频帧率" />
            <div className="grid grid-cols-2 gap-2">
              {[30, 60].map((fps) => (
                <button
                  key={fps}
                  type="button"
                  onClick={() => onChange({ ...settings, frameRate: fps as ProjectSettings['frameRate'] })}
                  className={`rounded-xl border py-3 text-[13px] cursor-pointer ${
                    settings.frameRate === fps
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                      : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                  }`}
                >
                  {fps} FPS
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[#2a2a36] bg-[#17171e] px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-[13px] font-medium text-zinc-100">短视频安全区辅助线</div>
            <div className="text-[12px] text-zinc-500 mt-0.5">避开右侧互动栏与底部标题遮挡</div>
          </div>
          <Switch
            checked={settings.safeMargin}
            onChange={(safeMargin) => onChange({ ...settings, safeMargin })}
          />
        </div>

        <div className="rounded-2xl border border-[#2a2a36] bg-[#17171e] p-5 space-y-3">
          <FieldLabel icon={<Shield className="w-3.5 h-3.5 text-amber-400" />} title="当前引擎" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[13px]">
            <div className="rounded-xl bg-[#121217] border border-[#2b2b38] px-3.5 py-3 flex items-center justify-between gap-3">
              <span className="text-zinc-400">LLM 文案</span>
              <span className="text-zinc-100 font-medium truncate">
                {isCustomLlmProvider(llmApi) ? `${llmApi.provider} · ${llmApi.model}` : 'Gemini / 内置分镜'}
              </span>
            </div>
            <div className="rounded-xl bg-[#121217] border border-[#2b2b38] px-3.5 py-3 flex items-center justify-between gap-3">
              <span className="text-zinc-400">生图</span>
              <span className="text-zinc-100 font-medium truncate">
                {imageApiLabel(imageApi)}
              </span>
            </div>
            <div className="rounded-xl bg-[#121217] border border-[#2b2b38] px-3.5 py-3 flex items-center justify-between gap-3">
              <span className="text-zinc-400">美术世界</span>
              <span className="text-zinc-100 font-medium truncate">
                {hydrateActiveStylePack(settings).label}
              </span>
            </div>
            <div className="rounded-xl bg-[#121217] border border-[#2b2b38] px-3.5 py-3 flex items-center justify-between gap-3">
              <span className="text-zinc-400">TTS 配音</span>
              <span className="text-zinc-100 font-medium truncate">
                {isCustomTtsProvider(ttsApi) ? `${ttsApi.provider} · ${ttsApi.model || ttsApi.voice}` : 'Edge Neural TTS'}
              </span>
            </div>
            <div className="rounded-xl bg-[#121217] border border-[#2b2b38] px-3.5 py-3 flex items-center justify-between gap-3">
              <span className="text-zinc-400">视频生成</span>
              <span className="text-zinc-500">尚未接入</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
