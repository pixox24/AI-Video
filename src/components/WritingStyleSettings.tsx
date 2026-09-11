import React, { useState } from 'react';
import type { CustomLlmApiConfig, WritingStyleProfile } from '../types';
import { BASE_BANNED_PATTERNS, writingStyleProfileSchema } from '../shared/writingStyle';
import { inferDraftSchema, saveProfileSchema } from '../shared/writingStyleClient';

type Draft = { label: string; description: string; rules: string; bannedPatterns: string; exemplar: string; counterExemplar: string };

const EMPTY_DRAFT: Draft = { label: '', description: '', rules: '', bannedPatterns: '', exemplar: '', counterExemplar: '' };
const inputClass = 'w-full bg-[#121217] border border-[#2b2b36] rounded-xl p-3 text-[13px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50';

function splitLines(value: string): string[] {
  return value.split('\n').map(item => item.trim()).filter(Boolean);
}

export function WritingStyleSettings({ writingStyles, onChange, customLlmApi, projectId }: {
  writingStyles: WritingStyleProfile[];
  onChange: (styles: WritingStyleProfile[]) => void;
  customLlmApi?: CustomLlmApiConfig;
  projectId?: string;
}) {
  const [sampleInput, setSampleInput] = useState('');
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [sourceSamples, setSourceSamples] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const infer = async () => {
    const samples = splitLines(sampleInput).filter(sample => sample.length >= 40);
    if (samples.length < 2) { setError('请至少粘贴 2 篇样例文案，每篇不少于 40 字。'); return; }
    setBusy(true); setError(''); setStatus('');
    try {
      const response = await fetch('/api/writing-styles/infer', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ samples, llmApi: customLlmApi, projectId }) });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(describeFailure(data, '反推失败'));
      const parsed = inferDraftSchema.parse((data as { draft: unknown }).draft);
      setDraft({ label: parsed.label, description: parsed.description, rules: parsed.rules.join('\n'),
        bannedPatterns: parsed.bannedPatterns.join('\n'), exemplar: parsed.exemplar, counterExemplar: parsed.counterExemplar });
      setSourceSamples(samples);
      setStatus('已反推草稿。核对后可锁定入库；锁定后不可改动，只能另存。');
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '反推失败'); }
    finally { setBusy(false); }
  };

  const save = async (locked: boolean, existing?: WritingStyleProfile) => {
    setBusy(true); setError(''); setStatus('');
    try {
      const profile = {
        ...(existing ? { id: existing.id } : {}),
        label: draft.label.trim(), description: draft.description.trim(), rules: splitLines(draft.rules),
        bannedPatterns: splitLines(draft.bannedPatterns), exemplar: draft.exemplar.trim(), counterExemplar: draft.counterExemplar.trim(),
        derivedFromSamples: true, locked, ...(existing?.provisional ? { provisional: true } : {}),
        ...(existing?.lintThresholds ? { lintThresholds: existing.lintThresholds } : {}),
        samples: sourceSamples
      };
      const response = await fetch('/api/writing-styles', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile, existing: writingStyles }) });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(describeFailure(data, '保存失败'));
      const saved = saveProfileSchema.parse((data as { profile: unknown }).profile);
      const next = existing ? writingStyles.map(item => item.id === saved.id ? saved : item) : [...writingStyles, saved];
      onChange(next);
      setDraft(EMPTY_DRAFT); setSampleInput(''); setSourceSamples([]);
      setStatus(locked ? `已入库并锁定「${saved.label}」。` : `已保存「${saved.label}」草稿，可在承诺页选用。`);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(false); }
  };

  const lock = (profile: WritingStyleProfile) => {
    if (profile.locked) { setError('该档案已锁定，不能改动。'); return; }
    onChange(writingStyles.map(item => item.id === profile.id ? { ...item, locked: true } : item));
    setStatus(`已锁定「${profile.label}」。`);
  };

  const remove = (profile: WritingStyleProfile) => {
    if (profile.locked) { setError('已锁定的档案不能删除。'); return; }
    onChange(writingStyles.filter(item => item.id !== profile.id));
    setStatus(`已删除「${profile.label}」。`);
  };

  const startEdit = (profile: WritingStyleProfile) => {
    if (profile.locked) { setError('已锁定的档案不能改动，请另存为新档案。'); return; }
    setDraft({ label: profile.label, description: profile.description, rules: profile.rules.join('\n'),
      bannedPatterns: profile.bannedPatterns.join('\n'), exemplar: profile.exemplar, counterExemplar: profile.counterExemplar });
    setSourceSamples([profile.exemplar]);
    setStatus(`正在编辑「${profile.label}」。`);
  };

  const draftValid = writingStyleProfileSchema.safeParse({ ...draft, id: 'custom-0', kind: 'custom', rules: splitLines(draft.rules),
    bannedPatterns: splitLines(draft.bannedPatterns), derivedFromSamples: true, locked: false }).success;

  return <div className="space-y-4">
    <div>
      <h3 className="text-[13px] font-medium text-zinc-200">自定义写作风格档案</h3>
      <p className="text-[11px] text-zinc-500">粘贴 2–3 篇你自己的历史文案（每行一篇），反推出规则、禁用表达与范例；确认锁定后不可改动，只能另存。样式保存在本项目内。</p>
    </div>
    <label className="block space-y-1">
      <span className="text-[12px] text-zinc-400">样例文案（每行一篇，2–3 篇，每篇 ≥ 40 字）</span>
      <textarea aria-label="样例文案" rows={5} className={inputClass} value={sampleInput} onChange={e => setSampleInput(e.target.value)} placeholder="把你自己写过的文案粘进来，一行一篇。" />
    </label>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void infer()} className="rounded-lg bg-amber-500 px-3 py-2 text-[12px] font-semibold text-black disabled:opacity-40">{busy ? '处理中…' : '从样例反推'}</button>
      <button type="button" disabled={busy || !draftValid} onClick={() => void save(false)} className="rounded-lg border border-[#2b2b36] px-3 py-2 text-[12px] text-zinc-200 disabled:opacity-40">保存草稿</button>
      <button type="button" disabled={busy || !draftValid} onClick={() => void save(true)} className="rounded-lg border border-amber-500/40 px-3 py-2 text-[12px] text-amber-300 disabled:opacity-40">确认并锁定入库</button>
    </div>
    <div className="grid gap-3 md:grid-cols-2">
      <label className="block space-y-1"><span className="text-[12px] text-zinc-400">名称</span>
        <input aria-label="档案名称" className={inputClass} value={draft.label} onChange={e => setDraft({ ...draft, label: e.target.value })} /></label>
      <label className="block space-y-1"><span className="text-[12px] text-zinc-400">一句话说明</span>
        <input aria-label="档案说明" className={inputClass} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      <label className="block space-y-1"><span className="text-[12px] text-zinc-400">规则（每行一条，3–8 条）</span>
        <textarea aria-label="档案规则" rows={5} className={inputClass} value={draft.rules} onChange={e => setDraft({ ...draft, rules: e.target.value })} /></label>
      <label className="block space-y-1"><span className="text-[12px] text-zinc-400">禁用表达（每行一条）</span>
        <textarea aria-label="禁用表达" rows={5} className={inputClass} value={draft.bannedPatterns} onChange={e => setDraft({ ...draft, bannedPatterns: e.target.value })} placeholder={BASE_BANNED_PATTERNS.join('\n')} /></label>
      <label className="block space-y-1"><span className="text-[12px] text-zinc-400">范例（必须来自样例原文）</span>
        <textarea aria-label="档案范例" rows={3} className={inputClass} value={draft.exemplar} onChange={e => setDraft({ ...draft, exemplar: e.target.value })} /></label>
      <label className="block space-y-1"><span className="text-[12px] text-zinc-400">反例（不要写成这样）</span>
        <textarea aria-label="档案反例" rows={3} className={inputClass} value={draft.counterExemplar} onChange={e => setDraft({ ...draft, counterExemplar: e.target.value })} /></label>
    </div>
    {status && <p role="status" className="text-[12px] text-emerald-300">{status}</p>}
    {error && <p role="alert" className="text-[12px] text-red-400">{error}</p>}
    {writingStyles.length === 0 ? <p className="text-[12px] text-zinc-500">本项目还没有自定义档案。</p> : <div className="space-y-2">
      {writingStyles.map(profile => <div key={profile.id} className="rounded-xl border border-[#2b2b36] bg-[#18181f] p-3 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] text-zinc-100">{profile.label}{profile.locked ? ' · 已锁定' : ''}{profile.provisional ? ' · 待替换样例' : ''}</span>
          <div className="flex gap-3 text-[11px]">
            <button type="button" disabled={profile.locked} onClick={() => startEdit(profile)} className="text-amber-300 disabled:text-zinc-600">编辑</button>
            <button type="button" disabled={profile.locked} onClick={() => lock(profile)} className="text-emerald-300 disabled:text-zinc-600">锁定</button>
            <button type="button" disabled={profile.locked} onClick={() => remove(profile)} className="text-red-300 disabled:text-zinc-600">删除</button>
          </div>
        </div>
        <p className="text-[11px] text-zinc-400">{profile.description}</p>
        <p className="text-[11px] text-zinc-500">规则 {profile.rules.length} 条 · 禁用 {profile.bannedPatterns.length} 条 · 来源：{profile.derivedFromSamples ? '样例反推' : '手工填写'}</p>
      </div>)}
    </div>}
  </div>;
}

function describeFailure(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string') {
    return (data as { error: string }).error;
  }
  return fallback;
}
