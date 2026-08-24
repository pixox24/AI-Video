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
  Shield
} from 'lucide-react';
import { ProjectSettings, CustomImageApiConfig, CustomLlmApiConfig } from '../types';
import {
  IMAGE_API_PROVIDER_PRESETS,
  DEFAULT_CUSTOM_IMAGE_API,
  DEFAULT_CUSTOM_LLM_API,
  LLM_PROVIDER_PRESETS,
  resolveImageApi,
  isCustomImageProvider
} from '../utils/presets';

type SettingsSection = 'llm' | 'image' | 'tts' | 'video' | 'system';

interface SettingsPanelProps {
  settings: ProjectSettings;
  onChange: (settings: ProjectSettings) => void;
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

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, onChange }) => {
  const [section, setSection] = useState<SettingsSection>('llm');
  const llmApi: CustomLlmApiConfig = settings.customLlmApi || DEFAULT_CUSTOM_LLM_API;
  const imageApi = resolveImageApi(settings.customImageApi);
  const usingCustomImage = isCustomImageProvider(imageApi);

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
      status: llmApi.enabled && llmApi.apiKey ? 'on' : undefined
    },
    {
      id: 'image',
      label: '生图',
      hint: '分镜画面生成',
      icon: <ImageIcon className="w-4 h-4" />,
      status: usingCustomImage ? 'on' : undefined
    },
    {
      id: 'tts',
      label: 'TTS 配音',
      hint: '旁白语音合成',
      icon: <Mic className="w-4 h-4" />,
      status: 'soon'
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
            llmApi.enabled && llmApi.apiKey
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : 'bg-zinc-800 text-zinc-400 border-zinc-700'
          }`}>
            LLM {llmApi.enabled && llmApi.apiKey ? llmApi.model : '内置回退'}
          </span>
          <span className={`text-[11px] px-2.5 py-1 rounded-full border ${
            usingCustomImage
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
              : 'bg-zinc-800 text-zinc-400 border-zinc-700'
          }`}>
            生图 {usingCustomImage ? imageApi.model || '自定义' : '内置 FLUX'}
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
          {section === 'image' && <ImageProviderSection settings={settings} onChange={onChange} />}
          {section === 'tts' && (
            <ComingSoonSection
              title="TTS 配音供应商"
              description="当前使用内置 Edge Neural TTS。自定义供应商接入将在后续版本开放。"
              items={[
                { name: 'Edge TTS', hint: '现已内置于声音面板，无需配置密钥' },
                { name: 'Azure Speech', hint: '企业级多语言神经语音' },
                { name: 'MiniMax', hint: '高表现力中文配音' }
              ]}
            />
          )}
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

  const llmApi: CustomLlmApiConfig = settings.customLlmApi || DEFAULT_CUSTOM_LLM_API;
  const currentPreset = LLM_PROVIDER_PRESETS.find((p) => p.id === llmApi.provider) || LLM_PROVIDER_PRESETS[0];

  const updateLlmApi = (updates: Partial<CustomLlmApiConfig>) => {
    let enabled = llmApi.enabled;
    if (updates.apiKey !== undefined && updates.apiKey.trim().length > 0 && updates.enabled === undefined) {
      enabled = true;
    }
    onChange({
      ...settings,
      customLlmApi: {
        ...llmApi,
        ...updates,
        enabled: updates.enabled !== undefined ? updates.enabled : enabled
      }
    });
  };

  const handleSelectProvider = (providerId: CustomLlmApiConfig['provider']) => {
    const preset = LLM_PROVIDER_PRESETS.find((p) => p.id === providerId);
    if (!preset?.available) return;
    updateLlmApi({
      provider: providerId,
      endpoint: preset.defaultEndpoint,
      model: preset.defaultModel
    });
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
        if (!llmApi.enabled) updateLlmApi({ enabled: true });
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-semibold text-zinc-100">LLM 文案模型</h3>
            <p className="mt-1 text-[13px] text-zinc-500 leading-relaxed max-w-xl">
              用于一键分镜、文案润色和智能拆镜。启用后优先走自定义供应商，失败时回退 Gemini 或内置分镜引擎。
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-[#2a2a36] bg-[#18181f] px-4 py-3">
            <div>
              <div className="text-[12px] text-zinc-200 font-medium">启用 DeepSeek</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">填写密钥后自动开启</div>
            </div>
            <Switch
              id="toggle-custom-llm-api"
              checked={llmApi.enabled}
              onChange={(enabled) => updateLlmApi({ enabled })}
            />
          </div>
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
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageProviderSection({
  settings,
  onChange
}: {
  settings: ProjectSettings;
  onChange: (settings: ProjectSettings) => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchedImageModels, setFetchedImageModels] = useState<string[]>([]);
  const [fetchModelsInfo, setFetchModelsInfo] = useState<{
    ok: boolean;
    totalCount?: number;
    message?: string;
  } | null>(null);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [showAllModelsModal, setShowAllModelsModal] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    imageUrl?: string;
    model?: string;
    error?: string;
    diagnosis?: string;
    endpointUsed?: string;
    methodUsed?: string;
  } | null>(null);

  const customApi = resolveImageApi(settings.customImageApi);
  const isBuiltin = customApi.provider === 'builtin';
  const currentPreset = IMAGE_API_PROVIDER_PRESETS.find((p) => p.id === customApi.provider) || IMAGE_API_PROVIDER_PRESETS[0];

  const updateCustomApi = (updates: Partial<CustomImageApiConfig>) => {
    const nextProvider = updates.provider ?? customApi.provider;
    onChange({
      ...settings,
      customImageApi: {
        ...customApi,
        ...updates,
        provider: nextProvider,
        enabled: nextProvider !== 'builtin'
      }
    });
  };

  const handleSelectProviderPreset = (providerId: CustomImageApiConfig['provider']) => {
    const preset = IMAGE_API_PROVIDER_PRESETS.find((p) => p.id === providerId);
    if (!preset) return;
    if (providerId === 'builtin') {
      updateCustomApi({
        provider: 'builtin',
        enabled: false
      });
    } else {
      updateCustomApi({
        provider: providerId,
        enabled: true,
        endpoint: preset.defaultEndpoint || customApi.endpoint,
        model: preset.defaultModel || customApi.model,
        protocol: providerId === 'oneapi' ? 'auto' : customApi.protocol || 'auto'
      });
    }
    setTestResult(null);
    setFetchModelsInfo(null);
    setFetchedModels([]);
    setFetchedImageModels([]);
  };

  const handleFetchModels = async () => {
    if (!customApi.endpoint) {
      setFetchModelsInfo({ ok: false, message: '请先填入 API 接口请求地址' });
      return;
    }
    if (!customApi.apiKey) {
      setFetchModelsInfo({ ok: false, message: '请先填入 API 密钥' });
      return;
    }

    setIsFetchingModels(true);
    setFetchModelsInfo(null);

    try {
      const res = await fetch('/api/visual/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sanitizeEndpoint(customApi.endpoint),
          apiKey: sanitizeKey(customApi.apiKey)
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setFetchedModels(data.models || []);
        setFetchedImageModels(data.imageModels || []);
        setFetchModelsInfo({
          ok: true,
          totalCount: data.totalCount,
          message: `成功拉取 ${data.totalCount} 个模型，识别出生图模型 ${data.imageModels?.length || 0} 个`
        });
        if (data.imageModels?.length > 0) {
          const preferred = data.imageModels.find((m: string) =>
            m.includes('dall-e-3') || m.includes('flux') || m.includes('midjourney')
          ) || data.imageModels[0];
          if (!customApi.model || customApi.model === DEFAULT_CUSTOM_IMAGE_API.model) {
            updateCustomApi({ model: preferred });
          }
        }
      } else {
        setFetchModelsInfo({
          ok: false,
          message: data.diagnosis || data.error || '获取模型列表失败'
        });
      }
    } catch (err: any) {
      setFetchModelsInfo({ ok: false, message: `连接异常: ${err?.message || '无法访问 /v1/models'}` });
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleTestApi = async () => {
    if (!customApi.endpoint) {
      setTestResult({ ok: false, error: '请先输入 API 接口地址' });
      return;
    }
    if (!customApi.apiKey) {
      setTestResult({ ok: false, error: '请先填入 API 密钥' });
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/visual/test-custom-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sanitizeEndpoint(customApi.endpoint),
          apiKey: sanitizeKey(customApi.apiKey),
          model: customApi.model,
          size: customApi.size,
          protocol: customApi.protocol || 'auto'
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setTestResult({
          ok: true,
          latencyMs: data.latencyMs,
          imageUrl: data.imageUrl,
          model: data.model,
          endpointUsed: data.endpoint,
          methodUsed: data.methodUsed
        });
      } else {
        setTestResult({
          ok: false,
          latencyMs: data.latencyMs,
          error: data.error || '测试请求失败',
          diagnosis: data.diagnosis,
          endpointUsed: data.endpointUsed
        });
      }
    } catch (err: any) {
      setTestResult({
        ok: false,
        error: `网络连接异常: ${err?.message || '无法访问服务'}`,
        diagnosis: '请检查本地是否可解析并访问该 API 域名。'
      });
    } finally {
      setIsTesting(false);
    }
  };

  const filteredAllModels = fetchedModels.filter((m) =>
    m.toLowerCase().includes(modelSearchQuery.toLowerCase())
  );

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h3 className="text-[15px] font-semibold text-zinc-100">生图供应商</h3>
          <p className="mt-1 text-[13px] text-zinc-500 leading-relaxed max-w-2xl">
            选中即使用。内置 FLUX 无需密钥；其他供应商需填写接口和 API Key。
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
          {IMAGE_API_PROVIDER_PRESETS.map((preset) => {
            const selected = customApi.provider === preset.id;
            return (
              <button
                key={preset.id}
                id={`preset-btn-${preset.id}`}
                type="button"
                onClick={() => handleSelectProviderPreset(preset.id)}
                className={`text-left rounded-2xl border px-3.5 py-3 cursor-pointer transition-all ${
                  selected
                    ? 'bg-amber-500/10 border-amber-500/50'
                    : 'bg-[#18181f] border-[#2a2a36] hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[13px] font-medium text-zinc-100 truncate">{preset.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-amber-400/90 flex-shrink-0">
                    {preset.badge}
                  </span>
                </div>
                <p className="text-[11px] text-zinc-500 leading-snug line-clamp-2">{preset.description}</p>
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl border border-[#2a2a36] bg-[#17171e] p-5 space-y-5">
          {isBuiltin ? (
            <div className="space-y-4">
              <p className="text-[13px] text-zinc-400 leading-relaxed">
                当前使用内置 FLUX，无需配置密钥。批量出图仍可调整并发。
              </p>
              <div className="max-w-sm space-y-2">
                <FieldLabel icon={<Zap className="w-3.5 h-3.5 text-amber-400" />} title="并发" hint={`${customApi.concurrency || 3} 路`} />
                <div className="grid grid-cols-4 gap-1.5">
                  {[1, 2, 3, 5].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => updateCustomApi({ concurrency: value })}
                      className={`py-2 rounded-xl text-[12px] border cursor-pointer ${
                        (customApi.concurrency || 3) === value
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                          : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-[11px] text-zinc-500 leading-relaxed border-t border-[#2a2a36] pt-3">
                {currentPreset.docHint}
              </p>
            </div>
          ) : (
          <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <FieldLabel icon={<Globe className="w-3.5 h-3.5 text-amber-400" />} title="接口地址" />
              <input
                id="input-custom-api-endpoint"
                type="text"
                value={customApi.endpoint}
                onChange={(e) => updateCustomApi({ endpoint: e.target.value })}
                placeholder="https://api.siliconflow.cn/v1/images/generations"
                className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel icon={<Key className="w-3.5 h-3.5 text-amber-400" />} title="API Key" hint="仅保存在本地" />
              <div className="relative">
                <input
                  id="input-custom-api-key"
                  type={showApiKey ? 'text' : 'password'}
                  value={customApi.apiKey}
                  onChange={(e) => updateCustomApi({ apiKey: e.target.value })}
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
            <div className="flex items-center justify-between gap-3">
              <FieldLabel icon={<Zap className="w-3.5 h-3.5 text-amber-400" />} title="模型名称" />
              <button
                id="btn-fetch-models-auto"
                type="button"
                onClick={handleFetchModels}
                disabled={isFetchingModels}
                className="text-[12px] px-2.5 py-1.5 bg-amber-500/12 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${isFetchingModels ? 'animate-spin' : ''}`} />
                {isFetchingModels ? '拉取中...' : '拉取模型列表'}
              </button>
            </div>
            <input
              id="input-custom-api-model"
              type="text"
              value={customApi.model}
              onChange={(e) => updateCustomApi({ model: e.target.value })}
              placeholder="black-forest-labs/FLUX.1-schnell"
              className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
            />

            {fetchModelsInfo && (
              <div className={`rounded-xl border px-3 py-2.5 text-[12px] flex items-start gap-2 ${
                fetchModelsInfo.ok
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
              }`}>
                {fetchModelsInfo.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
                <span>{fetchModelsInfo.message}</span>
              </div>
            )}

            {fetchedImageModels.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {fetchedImageModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateCustomApi({ model: m })}
                    className={`px-2 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${
                      customApi.model === m
                        ? 'bg-amber-500/20 text-amber-200 border-amber-500/50'
                        : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {currentPreset.popularModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateCustomApi({ model: m })}
                    className={`px-2 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${
                      customApi.model === m
                        ? 'bg-amber-500/20 text-amber-200 border-amber-500/50'
                        : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

            {fetchedModels.length > 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowAllModelsModal(!showAllModelsModal)}
                  className="text-[11px] text-zinc-500 hover:text-amber-400 flex items-center gap-1 cursor-pointer"
                >
                  <ListFilter className="w-3 h-3" />
                  {showAllModelsModal ? '收起全部模型' : `查看全部 ${fetchedModels.length} 个模型`}
                </button>
                {showAllModelsModal && (
                  <div className="mt-2 rounded-xl border border-[#2c2c3c] bg-[#121217] p-2.5 space-y-2">
                    <div className="relative">
                      <Search className="w-3 h-3 text-zinc-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={modelSearchQuery}
                        onChange={(e) => setModelSearchQuery(e.target.value)}
                        placeholder="搜索模型..."
                        className="w-full bg-[#0e0e12] border border-[#262634] rounded-lg pl-7 pr-2 py-1.5 text-[12px] text-zinc-200 outline-none"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-0.5 custom-scrollbar">
                      {filteredAllModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => updateCustomApi({ model: m })}
                          className={`w-full text-left px-2 py-1 rounded text-[11px] font-mono cursor-pointer ${
                            customApi.model === m
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'text-zinc-400 hover:bg-[#22222e] hover:text-zinc-200'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <FieldLabel icon={<Sparkles className="w-3.5 h-3.5 text-amber-400" />} title="协议" />
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'auto', label: '自适应' },
                  { id: 'images', label: 'Images' },
                  { id: 'chat-completions', label: 'Chat' }
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => updateCustomApi({ protocol: p.id as CustomImageApiConfig['protocol'] })}
                    className={`py-2 rounded-xl text-[12px] border cursor-pointer ${
                      (customApi.protocol || 'auto') === p.id
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <FieldLabel icon={<Layers className="w-3.5 h-3.5 text-amber-400" />} title="画幅" />
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { id: 'auto', label: '跟随视频' },
                  { id: '1792x1024', label: '16:9' },
                  { id: '1024x1792', label: '9:16' },
                  { id: '1024x1024', label: '1:1' }
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => updateCustomApi({ size: s.id as CustomImageApiConfig['size'] })}
                    className={`py-2 rounded-xl text-[12px] border cursor-pointer ${
                      customApi.size === s.id
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <FieldLabel icon={<Zap className="w-3.5 h-3.5 text-amber-400" />} title="并发" hint={`${customApi.concurrency || 3} 路`} />
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateCustomApi({ concurrency: value })}
                    className={`py-2 rounded-xl text-[12px] border cursor-pointer ${
                      (customApi.concurrency || 3) === value
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              id="btn-test-custom-api"
              type="button"
              onClick={handleTestApi}
              disabled={isTesting}
              className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-[13px] font-semibold rounded-xl flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
              {isTesting ? '正在生成测试图...' : '测试并生成样图'}
            </button>
            <button
              type="button"
              onClick={() => {
                onChange({ ...settings, customImageApi: { ...DEFAULT_CUSTOM_IMAGE_API } });
                setTestResult(null);
                setFetchModelsInfo(null);
                setFetchedModels([]);
                setFetchedImageModels([]);
              }}
              className="px-3 py-2 text-[12px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              恢复默认
            </button>
          </div>

          {testResult && (
            <div
              id="custom-api-test-result"
              className={`rounded-xl border p-3.5 space-y-2 ${
                testResult.ok
                  ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                  : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-[13px] font-medium">
                  {testResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
                  {testResult.ok ? '接口测试成功' : '接口连接失败'}
                </div>
                {testResult.latencyMs != null && (
                  <span className="text-[11px] font-mono opacity-80">{testResult.latencyMs} ms</span>
                )}
              </div>
              {testResult.ok && testResult.imageUrl && (
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3 items-start">
                  <div className="text-[12px] text-emerald-200/90 space-y-1">
                    <div>模型 <span className="font-mono text-zinc-100">{testResult.model}</span></div>
                    {testResult.methodUsed && <div>通道 {testResult.methodUsed}</div>}
                  </div>
                  <div className="h-28 rounded-lg overflow-hidden border border-emerald-500/30 bg-black">
                    <img src={testResult.imageUrl} alt="API Test Result" className="w-full h-full object-cover" />
                  </div>
                </div>
              )}
              {!testResult.ok && (
                <div className="space-y-2 text-[12px]">
                  {testResult.diagnosis && <p className="leading-relaxed">{testResult.diagnosis}</p>}
                  {testResult.error && <p className="font-mono break-all text-rose-200/90">{testResult.error}</p>}
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-zinc-500 leading-relaxed border-t border-[#2a2a36] pt-3">
            {currentPreset.docHint}
          </p>
          </>
          )}
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
  const llmApi = settings.customLlmApi || DEFAULT_CUSTOM_LLM_API;
  const imageApi = resolveImageApi(settings.customImageApi);

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
                {llmApi.enabled && llmApi.apiKey ? `DeepSeek · ${llmApi.model}` : 'Gemini / 内置分镜'}
              </span>
            </div>
            <div className="rounded-xl bg-[#121217] border border-[#2b2b38] px-3.5 py-3 flex items-center justify-between gap-3">
              <span className="text-zinc-400">生图</span>
              <span className="text-zinc-100 font-medium truncate">
                {isCustomImageProvider(imageApi) ? imageApi.model : '内置 FLUX'}
              </span>
            </div>
            <div className="rounded-xl bg-[#121217] border border-[#2b2b38] px-3.5 py-3 flex items-center justify-between gap-3">
              <span className="text-zinc-400">TTS 配音</span>
              <span className="text-zinc-100 font-medium">Edge Neural TTS</span>
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
