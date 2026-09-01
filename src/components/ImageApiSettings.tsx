import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Globe,
  Key,
  ListFilter,
  RefreshCw,
  Search,
  Sparkles
} from 'lucide-react';
import { CustomImageApiConfig, ImageRetryConfig, ProjectSettings } from '../types';
import {
  DEFAULT_CUSTOM_IMAGE_API,
  IMAGE_API_PROVIDER_PRESETS,
  imageApiLabel,
  isImageApiReady,
  resolveImageApi,
  resolveImageRetry
} from '../utils/presets';

function sanitizeEndpoint(raw: string) {
  let val = raw.trim().replace(/^["']|["']$/g, '');
  if (val && !val.startsWith('http://') && !val.startsWith('https://')) val = 'https://' + val;
  return val;
}

function sanitizeKey(raw: string) {
  let val = raw.trim().replace(/^["']|["']$/g, '');
  if (val.toLowerCase().startsWith('bearer ')) val = val.slice(7).trim();
  return val;
}

function FieldLabel({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] font-medium text-zinc-300">{title}</span>
      {hint ? <span className="text-[11px] text-zinc-500">{hint}</span> : null}
    </div>
  );
}

function Switch({
  checked,
  onChange
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only peer"
      />
      <div className="w-11 h-6 bg-zinc-700 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500" />
    </label>
  );
}

function ImageChannelEditor({
  title,
  hint,
  api,
  onChange,
  showConcurrency,
  idPrefix
}: {
  title: string;
  hint: string;
  api: CustomImageApiConfig;
  onChange: (next: CustomImageApiConfig) => void;
  showConcurrency?: boolean;
  idPrefix: string;
}) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fetchedImageModels, setFetchedImageModels] = useState<string[]>([]);
  const [fetchModelsInfo, setFetchModelsInfo] = useState<{ ok: boolean; message?: string } | null>(null);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const [showAllModels, setShowAllModels] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    imageUrl?: string;
    model?: string;
    error?: string;
    diagnosis?: string;
    methodUsed?: string;
  } | null>(null);

  const resolved = resolveImageApi(api);
  const currentPreset = IMAGE_API_PROVIDER_PRESETS.find((item) => item.id === resolved.provider) || IMAGE_API_PROVIDER_PRESETS[0];
  const ready = isImageApiReady(resolved);

  const patch = (updates: Partial<CustomImageApiConfig>) => {
    const nextProvider = updates.provider ?? resolved.provider;
    onChange({
      ...resolved,
      ...updates,
      provider: nextProvider === 'builtin' ? 'siliconflow' : nextProvider,
      enabled: true
    });
  };

  const handleSelectProvider = (providerId: CustomImageApiConfig['provider']) => {
    if (providerId === 'builtin') return;
    const preset = IMAGE_API_PROVIDER_PRESETS.find((item) => item.id === providerId);
    if (!preset) return;
    patch({
      provider: providerId,
      endpoint: preset.defaultEndpoint || resolved.endpoint,
      model: preset.defaultModel || resolved.model,
      protocol: providerId === 'oneapi' ? 'auto' : resolved.protocol || 'auto'
    });
    setTestResult(null);
    setFetchModelsInfo(null);
    setFetchedModels([]);
    setFetchedImageModels([]);
  };

  const handleFetchModels = async () => {
    if (!resolved.endpoint.trim() || !resolved.apiKey.trim()) {
      setFetchModelsInfo({ ok: false, message: '请先填写接口地址和 API Key' });
      return;
    }
    setIsFetchingModels(true);
    setFetchModelsInfo(null);
    try {
      const res = await fetch('/api/visual/fetch-models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sanitizeEndpoint(resolved.endpoint),
          apiKey: sanitizeKey(resolved.apiKey)
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setFetchedModels(data.models || []);
        setFetchedImageModels(data.imageModels || []);
        setFetchModelsInfo({
          ok: true,
          message: `拉取到 ${data.totalCount || 0} 个模型，其中生图 ${data.imageModels?.length || 0} 个`
        });
        if (!resolved.model && data.imageModels?.length) {
          const preferred = data.imageModels.find((item: string) =>
            /dall-e-3|gpt-image|midjourney/i.test(item)
          ) || data.imageModels[0];
          patch({ model: preferred });
        }
      } else {
        setFetchModelsInfo({ ok: false, message: data.diagnosis || data.error || '获取模型列表失败' });
      }
    } catch (err: any) {
      setFetchModelsInfo({ ok: false, message: err?.message || '无法访问 /v1/models' });
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleTest = async () => {
    if (!resolved.endpoint.trim() || !resolved.apiKey.trim()) {
      setTestResult({ ok: false, error: '请先填写接口地址和 API Key' });
      return;
    }
    if (!resolved.model.trim()) {
      setTestResult({ ok: false, error: '请填写或选择模型' });
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/visual/test-custom-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: sanitizeEndpoint(resolved.endpoint),
          apiKey: sanitizeKey(resolved.apiKey),
          model: resolved.model,
          size: resolved.size,
          protocol: resolved.protocol || 'auto'
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setTestResult({
          ok: true,
          latencyMs: data.latencyMs,
          imageUrl: data.imageUrl,
          model: data.model,
          methodUsed: data.methodUsed
        });
      } else {
        setTestResult({
          ok: false,
          latencyMs: data.latencyMs,
          error: data.error || '测试失败',
          diagnosis: data.diagnosis
        });
      }
    } catch (err: any) {
      setTestResult({ ok: false, error: err?.message || '无法访问该接口' });
    } finally {
      setIsTesting(false);
    }
  };

  const filteredModels = fetchedModels.filter((item) =>
    item.toLowerCase().includes(modelSearchQuery.toLowerCase())
  );

  return (
    <div className="rounded-2xl border border-[#2a2a36] bg-[#17171e] overflow-hidden">
      <div className="px-5 py-4 border-b border-[#23232c] flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-zinc-100">{title}</div>
          <p className="mt-1 text-[12px] text-zinc-500 leading-relaxed">{hint}</p>
        </div>
        <span className={`flex-shrink-0 text-[11px] px-2 py-1 rounded-full border ${
          ready
            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            : 'bg-zinc-800 text-zinc-500 border-zinc-700'
        }`}>
          {ready ? imageApiLabel(resolved) : '未配置'}
        </span>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {IMAGE_API_PROVIDER_PRESETS.map((preset) => {
            const selected = resolved.provider === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => handleSelectProvider(preset.id)}
                className={`text-left rounded-xl border px-3 py-2.5 cursor-pointer transition-all ${
                  selected
                    ? 'bg-amber-500/10 border-amber-500/50'
                    : 'bg-[#121217] border-[#2b2b38] hover:border-zinc-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[12px] font-medium text-zinc-100 truncate">{preset.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 flex-shrink-0">{preset.badge}</span>
                </div>
                <p className="text-[10px] text-zinc-500 leading-snug line-clamp-2">{preset.description}</p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <FieldLabel title="接口地址" />
            <div className="relative">
              <Globe className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id={`${idPrefix}-endpoint`}
                type="text"
                value={resolved.endpoint}
                onChange={(e) => patch({ endpoint: e.target.value })}
                placeholder="https://api.example.com/v1"
                className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl pl-9 pr-3 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <FieldLabel title="API Key" hint="仅保存在本机" />
            <div className="relative">
              <Key className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                id={`${idPrefix}-key`}
                type={showApiKey ? 'text' : 'password'}
                value={resolved.apiKey}
                onChange={(e) => patch({ apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl pl-9 pr-10 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((value) => !value)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200 cursor-pointer p-1"
              >
                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel title="模型" />
            <button
              type="button"
              onClick={() => void handleFetchModels()}
              disabled={isFetchingModels}
              className="text-[12px] px-2.5 py-1.5 bg-amber-500/12 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${isFetchingModels ? 'animate-spin' : ''}`} />
              {isFetchingModels ? '拉取中' : '拉取模型'}
            </button>
          </div>
          <input
            id={`${idPrefix}-model`}
            type="text"
            value={resolved.model}
            onChange={(e) => patch({ model: e.target.value })}
            placeholder="填写模型 id，或从列表点选"
            className="w-full bg-[#121217] border border-[#2b2b38] focus:border-amber-500 rounded-xl px-3 py-2.5 text-[13px] text-zinc-100 placeholder-zinc-600 font-mono outline-none"
          />
          {fetchModelsInfo && (
            <div className={`rounded-xl border px-3 py-2 text-[12px] flex items-start gap-2 ${
              fetchModelsInfo.ok
                ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
                : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
            }`}>
              {fetchModelsInfo.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
              <span>{fetchModelsInfo.message}</span>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {(fetchedImageModels.length ? fetchedImageModels : currentPreset.popularModels).map((model) => (
              <button
                key={model}
                type="button"
                onClick={() => patch({ model })}
                className={`px-2 py-1 rounded-lg text-[11px] font-mono border cursor-pointer ${
                  resolved.model === model
                    ? 'bg-amber-500/20 text-amber-200 border-amber-500/50'
                    : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                }`}
              >
                {model}
              </button>
            ))}
          </div>
          {fetchedModels.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowAllModels((value) => !value)}
                className="text-[11px] text-zinc-500 hover:text-amber-400 flex items-center gap-1 cursor-pointer"
              >
                <ListFilter className="w-3 h-3" />
                {showAllModels ? '收起全部模型' : `查看全部 ${fetchedModels.length} 个`}
              </button>
              {showAllModels && (
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
                    {filteredModels.map((model) => (
                      <button
                        key={model}
                        type="button"
                        onClick={() => patch({ model })}
                        className={`w-full text-left px-2 py-1 rounded text-[11px] font-mono cursor-pointer ${
                          resolved.model === model
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'text-zinc-400 hover:bg-[#22222e] hover:text-zinc-200'
                        }`}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`grid grid-cols-1 gap-4 ${showConcurrency ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
          <div className="space-y-2">
            <FieldLabel title="协议" />
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { id: 'auto', label: '自适应' },
                { id: 'images', label: 'Images' },
                { id: 'chat-completions', label: 'Chat' }
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => patch({ protocol: item.id as CustomImageApiConfig['protocol'] })}
                  className={`py-2 rounded-xl text-[12px] border cursor-pointer ${
                    (resolved.protocol || 'auto') === item.id
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                      : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <FieldLabel title="画幅" />
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { id: 'auto', label: '跟随视频' },
                { id: '1792x1024', label: '16:9' },
                { id: '1024x1792', label: '9:16' },
                { id: '1024x1024', label: '1:1' }
              ].map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => patch({ size: item.id as CustomImageApiConfig['size'] })}
                  className={`py-2 rounded-xl text-[12px] border cursor-pointer ${
                    resolved.size === item.id
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                      : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {showConcurrency && (
            <div className="space-y-2">
              <FieldLabel title="并发" hint={`${resolved.concurrency || 3} 路`} />
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => patch({ concurrency: value })}
                    className={`py-2 rounded-xl text-[12px] border cursor-pointer ${
                      (resolved.concurrency || 3) === value
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleTest()}
            disabled={isTesting}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-[13px] font-semibold rounded-xl flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Sparkles className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
            {isTesting ? '正在出测试图…' : '测试通道'}
          </button>
        </div>

        {testResult && (
          <div className={`rounded-xl border p-3.5 space-y-2 ${
            testResult.ok
              ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/30 border-rose-500/40 text-rose-200'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[13px] font-medium">
                {testResult.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <AlertCircle className="w-4 h-4 text-rose-400" />}
                {testResult.ok ? '通道可用' : '通道失败'}
              </div>
              {testResult.latencyMs != null && (
                <span className="text-[11px] font-mono opacity-80">{testResult.latencyMs} ms</span>
              )}
            </div>
            {testResult.ok && testResult.imageUrl && (
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3 items-start">
                <div className="text-[12px] space-y-1">
                  <div>模型 <span className="font-mono text-zinc-100">{testResult.model}</span></div>
                  {testResult.methodUsed && <div>通道 {testResult.methodUsed}</div>}
                </div>
                <div className="h-24 rounded-lg overflow-hidden border border-emerald-500/30 bg-black">
                  <img src={testResult.imageUrl} alt="" className="w-full h-full object-cover" />
                </div>
              </div>
            )}
            {!testResult.ok && (
              <div className="text-[12px] space-y-1">
                {testResult.diagnosis && <p className="leading-relaxed">{testResult.diagnosis}</p>}
                {testResult.error && <p className="font-mono break-all opacity-90">{testResult.error}</p>}
              </div>
            )}
          </div>
        )}

        <p className="text-[11px] text-zinc-500 leading-relaxed border-t border-[#2a2a36] pt-3">
          {currentPreset.docHint}
        </p>
      </div>
    </div>
  );
}

export function ImageApiSettingsSection({
  settings,
  onChange
}: {
  settings: ProjectSettings;
  onChange: (settings: ProjectSettings) => void;
}) {
  const primary = resolveImageApi(settings.customImageApi);
  const backup = resolveImageApi(settings.backupImageApi);
  const retry = resolveImageRetry(settings.imageRetry);
  const backupOn = Boolean(settings.backupImageApi?.enabled) || isImageApiReady(backup);

  const setRetry = (updates: Partial<ImageRetryConfig>) => {
    onChange({
      ...settings,
      imageRetry: { ...retry, ...updates }
    });
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h3 className="text-[15px] font-semibold text-zinc-100">生图通道</h3>
          <p className="mt-1 text-[13px] text-zinc-500 leading-relaxed max-w-2xl">
            主通道负责日常出图。瞬时失败会自动重试；主通道连不上或协议不支持时，才走备用。没有内置免费引擎。
          </p>
        </div>

        <ImageChannelEditor
          title="主通道"
          hint="日常分镜出图走这里。必须填供应商、接口、密钥和模型。"
          api={primary}
          idPrefix="image-primary"
          showConcurrency
          onChange={(customImageApi) => onChange({ ...settings, customImageApi })}
        />

        <div className="rounded-2xl border border-[#2a2a36] bg-[#17171e] p-5 space-y-4">
          <div>
            <div className="text-[13px] font-semibold text-zinc-100">失败策略</div>
            <p className="mt-1 text-[12px] text-zinc-500">只对网络抖动、超时和限流自动补发。审核拒绝或密钥错误不会空转。</p>
          </div>
          <div className="flex items-center justify-between gap-4 py-1">
            <div>
              <div className="text-[13px] text-zinc-200">自动重试失败镜头</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">每镜最多再发两次，带退避</div>
            </div>
            <Switch checked={retry.enabled} onChange={(enabled) => setRetry({ enabled })} />
          </div>
          {retry.enabled && (
            <div className="space-y-2">
              <FieldLabel title="每镜补发次数" hint={`${retry.maxRetries} 次`} />
              <div className="grid grid-cols-4 gap-1.5 max-w-sm">
                {[0, 1, 2, 3].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRetry({ maxRetries: value })}
                    className={`py-2 rounded-xl text-[12px] border cursor-pointer ${
                      retry.maxRetries === value
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                        : 'bg-[#121217] text-zinc-400 border-[#2b2b38] hover:text-zinc-200'
                    }`}
                  >
                    {value === 0 ? '关闭补发' : `${value} 次`}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-4 py-1 border-t border-[#2a2a36] pt-4">
            <div>
              <div className="text-[13px] text-zinc-200">主通道仍失败时使用备用</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">需要先开启并填好备用通道</div>
            </div>
            <Switch
              checked={retry.useBackup}
              onChange={(useBackup) => setRetry({ useBackup })}
            />
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[13px] font-semibold text-zinc-100">备用通道</div>
              <p className="mt-1 text-[12px] text-zinc-500">另一家供应商。主通道用尽重试仍连不上时，才打这一路。</p>
            </div>
            <Switch
              checked={backupOn}
              onChange={(enabled) => {
                const nextProvider = backup.provider === 'builtin' ? 'openai' : backup.provider;
                onChange({
                  ...settings,
                  backupImageApi: {
                    ...DEFAULT_CUSTOM_IMAGE_API,
                    ...backup,
                    provider: nextProvider,
                    enabled
                  }
                });
              }}
            />
          </div>
          {backupOn && (
            <ImageChannelEditor
              title="备用供应商"
              hint="建议和主通道不是同一家、同一把 Key。"
              api={{ ...backup, enabled: true }}
              idPrefix="image-backup"
              onChange={(backupImageApi) => onChange({ ...settings, backupImageApi: { ...backupImageApi, enabled: true } })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
