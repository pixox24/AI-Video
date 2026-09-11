import React, { useEffect, useRef, useState } from 'react';
import type { CustomLlmApiConfig, QualityReport, ScriptWorkspace } from '../types';
import { qualityFailureMessage, qualityInputKey, qualityResponseSchema } from '../shared/quality';
import { findWritingStyleProfile } from '../shared/writingStyle';
import { flattenSectionBeats, joinSectionNarrations } from '../utils/scriptSections';
import { rebuildForecast } from '../utils/scriptWorkspace';

export function QualityPanel({ workspace, onChange, customLlmApi, projectId }: {
  workspace: ScriptWorkspace; onChange: (workspace: ScriptWorkspace) => void; customLlmApi?: CustomLlmApiConfig; projectId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [labelWarnings, setLabelWarnings] = useState<string[]>([]);
  const live = useRef(workspace); live.current = workspace;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const request = {
    sections: workspace.sections || [], outline: workspace.outline, scriptLanguage: workspace.scriptLanguage || 'zh',
    pace: workspace.durationBudget.pace, durationSpec: workspace.durationSpec, contentBrief: workspace.contentBrief,
    brief: workspace.brief, claims: workspace.claims || [], llmApi: customLlmApi, projectId,
    writingStyleId: workspace.contentBrief?.writingStyleId, writingStyles: workspace.writingStyles
  };
  const report = workspace.qualityReport;
  // Exclude secrets from persisted comparison data.
  const sourceKey = qualityInputKey(request);
  const stale = workspace.qualityInputKey !== sourceKey;
  const locked = (id: string) => workspace.sections?.some(s => s.id === id && s.status === 'locked') || workspace.outline?.sections.some(s => s.id === id && s.status === 'locked');
  const run = async (repair = false, sectionIds?: string[], styleFindings?: QualityReport['issues']) => {
    const snapshot = workspace;
    setBusy(true); setMessage(''); setLabelWarnings([]);
    try {
      const response = await fetch('/api/script/quality-check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...request, repair, sectionIds, styleFindings }) });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(qualityFailureMessage(response.status, data));
      const result = qualityResponseSchema.parse(data);
      if (!mounted.current || live.current !== snapshot) { if (mounted.current) setMessage('文案或锁定状态已改变，已丢弃旧结果，请重新检查。'); return; }
      setLabelWarnings(result.sections.flatMap(s => s.beatLabelWarnings || []));
      // Preserve saved locked chapters, including legacy metadata, when applying repairs.
      const sections = result.sections.map(s => locked(s.id) ? workspace.sections!.find(original => original.id === s.id)! : s);
      const next = repair ? { ...rebuildForecast({ ...workspace, sections, beats: flattenSectionBeats(sections), fullNarration: joinSectionNarrations(sections, workspace.scriptLanguage || 'zh') }), sections } : workspace;
      onChange({ ...next, qualityReport: result.report, claims: result.report.claims,
        qualityInputKey: qualityInputKey({ ...request, sections: next.sections, outline: next.outline, claims: result.report.claims }) });
      setMessage(repair ? `已修订 ${result.rounds} 轮 · ${result.report.verdict}${result.stoppedReason === 'round_limit' ? ' · 已达两轮上限，请人工核对剩余问题' : ''}${result.failures.length ? ' · 部分修订失败，已保留成功章节' : ''}` : '质量检查完成');
    } catch (error: unknown) { if (mounted.current) setMessage(error instanceof Error ? error.message : '检查失败'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const canCheck = Boolean(workspace.outline?.sections.length && workspace.sections?.length);
  const hasEditable = report?.issues.some(i => i.sectionId && !locked(i.sectionId));
  const activeStyle = findWritingStyleProfile(workspace.contentBrief?.writingStyleId, workspace.writingStyles);
  const styleIssues = (report?.issues || []).filter(i => i.kind === 'style');
  const styleSectionIds = [...new Set(styleIssues.map(i => i.sectionId).filter((id): id is string => Boolean(id)))];
  const styleViolatingCount = styleSectionIds.filter(id => !locked(id)).length;
  const conformingCount = Math.max(0, (workspace.sections || []).filter(s => !styleSectionIds.includes(s.id)).length);
  const fixStyle = (sectionId: string) => void run(true, [sectionId], styleIssues.filter(i => i.sectionId === sectionId));
  return <section className="mt-6 rounded-xl border border-zinc-700 p-4 space-y-3 text-zinc-200" aria-label="质量评估">
    <h3 className="font-semibold">质量评估</h3>
    <p className="text-sm text-zinc-400">检查承诺、时长、事实风险与节奏{activeStyle ? '，以及所选写作风格' : ''}；修复只作用于有问题的未锁定章节，最多两轮。</p>
    <button disabled={busy || !canCheck} onClick={() => void run()} className="rounded bg-indigo-600 px-3 py-2 disabled:opacity-40">{busy ? '检查 / 修复中…' : '检查质量'}</button>
    {hasEditable && <button disabled={busy || stale} onClick={() => void run(true)} className="ml-3 rounded bg-amber-600 px-3 py-2 disabled:opacity-40">一键修复未锁定问题</button>}
    {!canCheck && <p>请先生成大纲与章节口播。</p>}
    {report && stale && <p className="text-amber-300">内容已变化，请重新检查后再修复。</p>}
    {message && <p role="status">{message}</p>}
    {[...new Set([...(workspace.sections?.flatMap(s => s.beatLabelWarnings || []) || []), ...labelWarnings])].map((warning, index) => <p key={index} className="text-sm text-zinc-400">{warning}</p>)}
    {report && <>
      <p>全文口播预算：{report.projectDuration?.complete === false ? '章节尚未写完，暂不作全文判定' : report.verdict} · {report.issues.length} 个内容 / 全文预算问题</p>
      {activeStyle && <div className="rounded-lg border border-zinc-700 p-3 space-y-1" aria-label="写作风格检查">
        <p>写作风格：{activeStyle.label} · {styleSectionIds.length === 0 ? '全部章节符合档案' : `${conformingCount} 章符合 / ${styleSectionIds.length} 章有风格问题`}</p>
        <p className="text-xs text-zinc-400">风格问题 severity 上限为中，永不阻断导出；修复风格不改变承诺、事实与时长预算。</p>
      </div>}
      {styleIssues.map((issue, index) => <div key={`style-${index}`} className="border-l-2 border-sky-500 pl-3 text-sm">
        <p>风格 · {workspace.sections?.find(s => s.id === issue.sectionId)?.title || issue.sectionId || '全文'} · {issue.message}</p>
        <p className="text-zinc-400">{issue.suggestedFix}</p>
        {issue.sectionId && <button disabled={busy || stale || locked(issue.sectionId)} onClick={() => fixStyle(issue.sectionId!)}
          className="text-sky-300 disabled:text-zinc-500">{locked(issue.sectionId) ? '已锁定，不修订' : '按风格修复本章'}</button>}
      </div>)}
      {report.projectDuration && <p className="text-sm text-zinc-400">当前预计口播 {report.projectDuration.estimatedSec.toFixed(1)} 秒 · 全文参考 {report.projectDuration.minSec.toFixed(1)}–{report.projectDuration.maxSec.toFixed(1)} 秒</p>}
      {report.durations.filter(d => d.verdict !== 'in_range').map(d => <p key={d.sectionId} className="text-sm text-zinc-400">
        {workspace.sections?.find(s => s.id === d.sectionId)?.title || d.sectionId}：预计 {d.estimatedSec.toFixed(1)} 秒，章节参考 {d.minSec.toFixed(1)}–{d.maxSec.toFixed(1)} 秒。仅作篇幅提示，不要求凑字或自动重写。
      </p>)}
      {(['high', 'medium', 'low'] as const).map(severity => <div key={severity} className="space-y-2">
        {report.issues.filter(i => i.severity === severity).map((issue, index) => <div key={`${severity}-${index}`} className="border-l-2 border-amber-500 pl-3 text-sm">
          <p>{severity === 'high' ? '高' : severity === 'medium' ? '中' : '低'} · {issue.kind} · {issue.message}</p>
          <p className="text-zinc-400">{issue.suggestedFix}</p>
          {issue.sectionId && <div className="flex gap-4">
            <button onClick={() => onChange({ ...workspace, stage: 'beats', activeSectionId: issue.sectionId })}>定位章节</button>
            <button disabled={busy || stale || locked(issue.sectionId)} onClick={() => void run(true, [issue.sectionId!])} className="text-amber-300 disabled:text-zinc-500">{locked(issue.sectionId) ? '已锁定，不修订' : '修复本章'}</button>
          </div>}
        </div>)}
      </div>)}
      {(workspace.claims || []).filter(c => c.needsSource).map(claim => <div key={claim.id} className="space-y-1 text-sm">
        <p><mark className="bg-amber-500/25 text-amber-200" title="待补来源；风险标记不等于断言内容为假">{claim.text}</mark> · {claim.kind}/{claim.risk}/needsSource</p>
        <label className="block">来源 URL<input aria-label={`来源 URL ${claim.id}`} className="ml-2 bg-zinc-900 border border-zinc-700 rounded p-1" value={claim.sourceUrl || ''} onChange={e => onChange({ ...workspace, claims: workspace.claims?.map(c => c.id === claim.id ? { ...c, sourceUrl: e.target.value } : c) })} /></label>
        <label className="block">来源说明<input aria-label={`来源说明 ${claim.id}`} className="ml-2 bg-zinc-900 border border-zinc-700 rounded p-1" value={claim.sourceNote || ''} onChange={e => onChange({ ...workspace, claims: workspace.claims?.map(c => c.id === claim.id ? { ...c, sourceNote: e.target.value } : c) })} /></label>
      </div>)}
    </>}
  </section>;
}
