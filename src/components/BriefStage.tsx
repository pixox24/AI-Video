import React, { useEffect, useRef, useState } from 'react';
import type { ContentBrief, CustomLlmApiConfig, DurationPreset, ScriptPace, ScriptWorkspace, WritingStyleProfile } from '../types';
import { contentBriefFields, contentBriefSchema, DURATION_PRESETS } from '../shared/contentBrief';
import { BUILTIN_WRITING_STYLES } from '../shared/writingStyle';
import { canEnterOutline, emptyContentBrief } from '../utils/contentBrief';
import { durationSpecForPreset, durationSpecForm, applyDurationSpec, estimateNarrationSeconds } from '../../src-server/duration/engine';
import { buildDurationBudget, PACE_PRESETS } from '../utils/scriptBudget';

export function BriefStage({ workspace, onChange, customLlmApi, projectId }: {
  workspace: ScriptWorkspace; onChange: (next: ScriptWorkspace) => void; customLlmApi?: CustomLlmApiConfig; projectId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const current = useRef(workspace);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  current.current = workspace;
  const brief = workspace.contentBrief || emptyContentBrief(workspace.lockedTitle || workspace.draftedTitle || workspace.intentNotes);
  const spec = workspace.durationSpec;
  const inputClass = 'w-full rounded-lg border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 disabled:opacity-50';
  const patch = (updates: Partial<ContentBrief>) => onChange({ ...workspace, contentBrief: { ...brief, ...updates } });
  const selectPreset = (preset: DurationPreset, pace: ScriptPace = spec?.pace || workspace.durationBudget.pace) => {
    const durationSpec = durationSpecForPreset(preset, pace, brief.contentType);
    onChange({ ...workspace, contentBrief: brief, durationSpec, scriptFormOverride: durationSpecForm(durationSpec),
      durationBudget: applyDurationSpec(buildDurationBudget({ ...workspace.durationBudget, platform: 'youtube', targetSeconds: durationSpec.targetSeconds, pace }), durationSpec) });
  };
  const generate = async () => {
    const snapshot = workspace;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/script/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        input: brief.topic || workspace.intentNotes, contentBrief: brief, durationSpec: spec, scriptLanguage: workspace.scriptLanguage, llmApi: customLlmApi, projectId
      }) });
      const data: unknown = await response.json();
      const result = contentBriefSchema.safeParse(typeof data === 'object' && data !== null && 'contentBrief' in data ? data.contentBrief : null);
      if (!response.ok || !result.success) throw new Error('生成失败，请检查输入与模型配置；锁定的必填字段不能留空。');
      if (!mounted.current) return;
      if (current.current !== snapshot) { setError('内容已改变，已丢弃旧生成结果。'); return; }
      onChange({ ...workspace, contentBrief: result.data });
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '生成失败'); }
    finally { setBusy(false); }
  };
  const budget = spec ? applyDurationSpec(workspace.durationBudget, spec) : workspace.durationBudget;
  const estimated = estimateNarrationSeconds(workspace.fullNarration, workspace.scriptLanguage || 'zh', budget.pace);
  const label: Record<(typeof contentBriefFields)[number], string> = { topic: '主题', audience: '受众', objective: '内容目标', viewerPromise: '观众承诺', contentType: '内容类型', mustCover: '必须覆盖', mustAvoid: '必须避免', writingStyleId: '写作风格' };
  const styleOptions: WritingStyleProfile[] = [...BUILTIN_WRITING_STYLES, ...(workspace.writingStyles || [])];
  const selectedStyle = styleOptions.find(profile => profile.id === brief.writingStyleId);
  const styleLocked = busy || brief.lockedFields.includes('writingStyleId');
  const selectStyle = (id: string | undefined) => {
    if (styleLocked) return;
    patch({ writingStyleId: id });
  };
  return <section className="max-w-3xl space-y-5 text-zinc-200">
    <h3 className="text-lg font-semibold">观众承诺</h3>
    <p className="text-sm text-zinc-400">先明确看完能带走什么，再选择时长。锁定字段在重新生成时保留。</p>
    {(['topic', 'viewerPromise', 'objective'] as const).map(field => <label className="block space-y-1" key={field}>
      <span>{label[field]}{field === 'viewerPromise' ? '（必填）' : ''}</span>
      <textarea aria-label={label[field]} className={inputClass} disabled={busy || brief.lockedFields.includes(field)} value={brief[field]} onChange={e => patch({ [field]: e.target.value })} />
    </label>)}
    <fieldset disabled={busy || brief.lockedFields.includes('audience')} className="space-y-2">
      <legend>受众</legend>
      <label className="block">角色（每行一个）<textarea className={inputClass} value={brief.audience.roles.join('\n')} onChange={e => patch({ audience: { ...brief.audience, roles: e.target.value.split('\n') } })} /></label>
      <label className="block">知识水平<select className={inputClass} value={brief.audience.knowledgeLevel} onChange={e => patch({ audience: { ...brief.audience, knowledgeLevel: e.target.value as ContentBrief['audience']['knowledgeLevel'] } })}>
        <option value="beginner">入门</option><option value="intermediate">有基础</option><option value="advanced">专业</option>
      </select></label>
      <label className="block">首要需求<input className={inputClass} value={brief.audience.primaryNeed} onChange={e => patch({ audience: { ...brief.audience, primaryNeed: e.target.value } })} /></label>
    </fieldset>
    <label className="block">内容类型<select className={inputClass} disabled={busy || brief.lockedFields.includes('contentType')} value={brief.contentType} onChange={e => {
      const contentType = e.target.value as ContentBrief['contentType'];
      onChange({ ...workspace, contentBrief: { ...brief, contentType }, durationSpec: spec ? { ...spec, narrationRatio: contentType === 'tutorial' ? 0.65 : 0.8 } : undefined });
    }}><option value="analysis">分析</option><option value="tutorial">教程</option><option value="commentary">评论</option><option value="story">故事</option></select></label>
    {(['mustCover', 'mustAvoid'] as const).map(field => <label key={field} className="block">{label[field]}（每行一个）
      <textarea className={inputClass} disabled={busy || brief.lockedFields.includes(field)} value={brief[field].join('\n')} onChange={e => patch({ [field]: e.target.value.split('\n') })} />
    </label>)}
    <fieldset className="flex flex-wrap gap-3" disabled={busy}><legend>锁定字段</legend>{contentBriefFields.map(field => <label key={field} className="text-sm">
      <input type="checkbox" checked={brief.lockedFields.includes(field)} onChange={e => patch({ lockedFields: e.target.checked ? [...brief.lockedFields, field] : brief.lockedFields.filter(f => f !== field) })} /> {label[field]}
    </label>)}</fieldset>
    <button disabled={busy || !brief.topic.trim()} onClick={generate} className="rounded-lg bg-indigo-600 px-4 py-2 disabled:opacity-40">{busy ? '正在生成…' : '生成 / 重新生成承诺'}</button>
    <div className="space-y-2">
      <h4>写作风格</h4>
      <p className="text-sm text-zinc-400">风格只约束"怎么说话"，不改变本章承诺与时长预算。不选 = 不加任何风格约束。</p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2" role="radiogroup" aria-label="写作风格">
        <button type="button" role="radio" aria-checked={!brief.writingStyleId} aria-pressed={!brief.writingStyleId}
          disabled={styleLocked} onClick={() => selectStyle(undefined)}
          className={`rounded-xl border p-3 text-left disabled:opacity-50 ${!brief.writingStyleId ? 'border-indigo-400 bg-indigo-500/20' : 'border-zinc-700'}`}>
          <div>不选风格</div>
          <div className="text-xs text-zinc-400">保持现状：只按承诺、证据与时长预算写，不加风格约束。</div>
        </button>
        {styleOptions.map(profile => <div key={profile.id} className={`rounded-xl border p-3 space-y-1 ${profile.id === brief.writingStyleId ? 'border-indigo-400 bg-indigo-500/20' : 'border-zinc-700'}`}>
          <button type="button" role="radio" aria-checked={profile.id === brief.writingStyleId} aria-pressed={profile.id === brief.writingStyleId}
            disabled={styleLocked} onClick={() => selectStyle(profile.id)} className="w-full text-left disabled:opacity-50">
            <div>{profile.label}{profile.kind === 'custom' ? ' · 自定义' : ''}{profile.provisional ? ' · 待替换样例' : ''}</div>
            <div className="text-xs text-zinc-400">{profile.description}</div>
          </button>
          <button type="button" aria-expanded={previewId === profile.id} onClick={() => setPreviewId(previewId === profile.id ? null : profile.id)}
            className="text-xs text-indigo-300">{previewId === profile.id ? '收起范例' : '看范例'}</button>
          {previewId === profile.id && <div className="space-y-1 text-xs text-zinc-300">
            <p>规则：{profile.rules.join('；')}</p>
            <p>禁用表达：{profile.bannedPatterns.join('、')}</p>
            <p>范例：{profile.exemplar}</p>
            <p className="text-zinc-500">反例：{profile.counterExemplar}</p>
          </div>}
        </div>)}
      </div>
      {selectedStyle && selectedStyle.provisional && <p className="text-sm text-amber-400">该档案是通用骨架，尚未用你的真实文案归纳；可在设置页粘贴样例反推自己的档案。</p>}
    </div>
    <h4>视频时长</h4>
    <div className="grid grid-cols-3 gap-3">{(Object.keys(DURATION_PRESETS) as DurationPreset[]).map(key => {
      const preset = DURATION_PRESETS[key];
      return <button key={key} aria-pressed={spec?.preset === key} onClick={() => selectPreset(key)} className={`rounded-xl border p-3 text-left ${spec?.preset === key ? 'border-indigo-400 bg-indigo-500/20' : 'border-zinc-700'}`}>
        <div>{preset.label}</div><div>{preset.minSeconds / 60}–{preset.maxSeconds / 60} 分钟</div><div className="text-xs text-zinc-400">{durationSpecForm(durationSpecForPreset(key)) === 'long' ? '章节视频' : '深度长视频'}</div>
      </button>;
    })}</div>
    {spec && <label className="block">语速<select className={inputClass} value={spec.pace} onChange={e => onChange({ ...workspace, durationSpec: { ...spec, pace: e.target.value as ScriptPace } })}>
      {Object.values(PACE_PRESETS).map(p => <option value={p.id} key={p.id}>{p.label}</option>)}
    </select></label>}
    <div role="status" className="rounded-xl border border-zinc-700 p-4">
      <p>目标 {budget.targetSeconds} 秒 · 口播 {budget.speechSeconds} 秒 · 画面停留 {budget.holdSeconds} 秒</p>
      <p>口播预算 {budget.targetUnits} {workspace.scriptLanguage === 'en' ? '词' : '字'} · 当前预计口播 {estimated.toFixed(1)} 秒</p>
      <progress aria-label="口播预算使用" className="w-full accent-indigo-500" value={Math.min(budget.usedChars, budget.maxChars)} max={budget.maxChars} />
    </div>
    {!canEnterOutline({ contentBrief: brief }) && <p className="text-amber-400">请填写观众承诺，才能进入大纲。</p>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
    <button disabled={busy || !canEnterOutline({ contentBrief: brief })} className="rounded-lg bg-indigo-600 px-4 py-2 disabled:opacity-40" onClick={() => onChange({ ...workspace, contentBrief: brief, stage: 'duration' })}>确认承诺，进入时长</button>
  </section>;
}
