import React, { useState } from 'react';
import { canEnterOutline } from '../utils/contentBrief';
import { ArrowDown, ArrowUp, Loader2, Lock, Plus, RefreshCw, Trash2, Unlock } from 'lucide-react';
import {
  CustomLlmApiConfig,
  ScriptBrief,
  ScriptOutline,
  ScriptOutlineSection,
  ScriptSection,
  ScriptWorkspace,
  StylePack
} from '../types';
import { budgetUnitLabel, countBudgetUnits, normalizeScriptLanguage } from '../utils/scriptLanguage';
import { lengthBudgetOf } from '../utils/scriptBudget';
import { flattenSectionBeats, joinSectionNarrations } from '../utils/scriptSections';
import {
  addOutlineSection,
  emptyScriptBrief,
  moveOutlineSection,
  normalizeScriptBrief,
  removeOutlineSection,
  updateOutlineSection
} from '../utils/scriptOutline';
import { outlineConfirmationRequired, resolveScriptForm } from '../utils/scriptDuration';
import { rebuildForecast } from '../utils/scriptWorkspace';

function SectionIntro({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
      <p className="mt-1 text-[13px] text-zinc-500 leading-relaxed">{desc}</p>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = {
  planned: '待写',
  drafting: '生成中',
  ready: '草稿已保存',
  locked: '已锁定',
  'needs-revision': '需回修',
  failed: '失败'
};

export function ScriptOutlineStage({
  workspace,
  busy,
  customLlmApi,
  stylePack,
  projectId,
  onChange,
  onStatus
}: {
  workspace: ScriptWorkspace;
  busy: boolean;
  customLlmApi?: CustomLlmApiConfig;
  stylePack?: StylePack | null;
  projectId?: string;
  onChange: (next: ScriptWorkspace) => void;
  onStatus: (message: string, error?: string) => void;
}) {
  const form = resolveScriptForm(workspace.durationBudget.targetSeconds, workspace.scriptFormOverride);
  const unit = budgetUnitLabel(workspace.scriptLanguage);
  const brief = normalizeScriptBrief(workspace.brief || emptyScriptBrief());
  const outline = workspace.outline;
  const [pendingId, setPendingId] = useState<string | null>(null);
  const requireConfirm = outlineConfirmationRequired(form, workspace.confirmOutlineBeforeDraft);

  const patchBrief = (updates: Partial<ScriptBrief>) => {
    onChange({ ...workspace, brief: { ...brief, ...updates } });
  };

  const patchOutline = (next: ScriptOutline) => {
    onChange({ ...workspace, outline: next });
  };

  const applySections = (sections: ScriptSection[], nextOutline?: ScriptOutline, stay = false) => {
    const lang = normalizeScriptLanguage(workspace.scriptLanguage);
    const fullNarration = joinSectionNarrations(sections, lang);
    const beats = flattenSectionBeats(sections);
    const mergedOutline = nextOutline || workspace.outline;
    const pending = mergedOutline?.sections.some((item) => item.status !== 'ready' && item.status !== 'locked');
    onChange(rebuildForecast({
      ...workspace,
      sections,
      beats,
      fullNarration,
      outline: mergedOutline,
      stage: stay || pending ? 'beats' : (fullNarration ? 'copy' : workspace.stage)
    }));
  };

  const requestOutline = async () => {
    if (!canEnterOutline(workspace)) { onStatus('请先填写观众承诺'); onChange({ ...workspace, stage: 'brief' }); return; }
    setPendingId('outline');
    try {
      const res = await fetch('/api/script/outline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: workspace.lockedTitle || workspace.draftedTitle,
          lockedTitle: workspace.lockedTitle,
          intent: workspace.intent,
          intentNotes: workspace.intentNotes,
          budget: workspace.durationBudget,
          brief,
          contentBrief: workspace.contentBrief,
          durationSpec: workspace.durationSpec,
          outline,
          genrePack: workspace.genrePackId ? { id: workspace.genrePackId } : undefined,
          llmApi: customLlmApi,
          stylePack,
          scriptLanguage: workspace.scriptLanguage,
          scriptFormOverride: workspace.scriptFormOverride,
          writingStyleId: workspace.contentBrief?.writingStyleId,
          writingStyles: workspace.writingStyles,
          projectId
        })
      });
      const data = await res.json().catch(() => ({}));
      if (data?.outline) {
        patchOutline(data.outline);
        onStatus(data.ok ? '已生成全片提纲，请核对章节任务。' : (data.warnings?.[0] || '提纲已生成，请再核对。'));
      } else {
        onStatus('生成提纲失败', data?.error || '生成提纲失败');
      }
    } catch (err: any) {
      onStatus('生成提纲失败', err?.message || '生成提纲失败');
    } finally {
      setPendingId(null);
    }
  };

  const confirmOutline = () => {
    if (!canEnterOutline(workspace)) { onChange({ ...workspace, stage: 'brief' }); return; }
    if (!outline) return;
    patchOutline({ ...outline, status: 'confirmed', confirmedAt: Date.now(), version: (outline.version || 1) + 1 });
    onStatus('提纲已确认。可以生成第 1 章。');
  };

  const draftSection = async (sectionId: string, outlineOverride?: ScriptOutline, priorSections = workspace.sections) => {
    const activeOutline = outlineOverride || outline;
    if (!activeOutline) return false;
    if (requireConfirm && activeOutline.status !== 'confirmed') {
      onStatus('请先确认提纲', '长视频需要先确认全片提纲。');
      return false;
    }
    setPendingId(sectionId);
    onChange({ ...workspace, activeSectionId: sectionId, outline: activeOutline });
    try {
      const res = await fetch('/api/script/section-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sectionId,
          topic: workspace.lockedTitle || workspace.draftedTitle,
          lockedTitle: workspace.lockedTitle,
          intent: workspace.intent,
          intentNotes: workspace.intentNotes,
          budget: workspace.durationBudget,
          brief,
          outline: activeOutline,
          sections: priorSections,
          llmApi: customLlmApi,
          stylePack,
          scriptLanguage: workspace.scriptLanguage,
          scriptFormOverride: workspace.scriptFormOverride,
          confirmOutlineBeforeDraft: workspace.confirmOutlineBeforeDraft,
          writingStyleId: workspace.contentBrief?.writingStyleId,
          writingStyles: workspace.writingStyles,
          projectId
        })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.section) {
        const sections = Array.isArray(data.sections) ? data.sections : [data.section];
        const nextOutline: ScriptOutline = {
          ...(data.outline || activeOutline),
          sections: (data.outline || activeOutline).sections.map((item: ScriptOutlineSection) => (
            item.id === sectionId ? { ...item, status: 'ready' as const } : item
          ))
        };
        applySections(sections, nextOutline, true);
        onStatus(`第 ${data.section.order} 章草稿已保存。${Array.isArray(data.warnings) ? data.warnings.join('；') : ''}`);
        return { sections, outline: nextOutline };
      } else {
        if (Array.isArray(data?.sections) && data.sections.length) {
          applySections(data.sections, data.outline || activeOutline, true);
        }
        onStatus(data?.error || '本章生成失败', data?.warnings?.[0] || data?.error);
        return false;
      }
    } catch (err: any) {
      onStatus('本章生成失败', err?.message);
      return false;
    } finally {
      setPendingId(null);
    }
  };

  const draftAllUnfinished = async () => {
    if (!outline) return;
    const queue = outline.sections.filter((item) => item.status !== 'ready' && item.status !== 'locked');
    let currentSections = workspace.sections;
    let currentOutline = outline;
    for (const item of queue) {
      const result = await draftSection(item.id, currentOutline, currentSections);
      if (!result) break;
      currentSections = result.sections;
      currentOutline = result.outline;
    }
  };

  const toggleLock = (sectionId: string) => {
    if (!outline) return;
    const sections = (workspace.sections || []).map((section) => (
      section.id === sectionId
        ? { ...section, status: section.status === 'locked' ? 'ready' as const : 'locked' as const }
        : section
    ));
    const nextOutline: ScriptOutline = {
      ...outline,
      sections: outline.sections.map((item) => (
        item.id === sectionId
          ? { ...item, status: item.status === 'locked' ? 'ready' : 'locked' }
          : item
      ))
    };
    onChange({ ...workspace, sections, outline: nextOutline });
  };

  const unfinished = outline?.sections.filter((item) => item.status !== 'ready' && item.status !== 'locked') || [];
  const length = lengthBudgetOf(workspace.durationBudget);

  return (
    <div className="space-y-5 max-w-4xl">
      <SectionIntro
        title={requireConfirm ? '全片提纲' : '轻提纲'}
        desc={requireConfirm
          ? '先锁结构再写正文。确认提纲后才能逐章生成；改提纲不会静默删掉已写章节。'
          : '段落视频会先给出轻提纲，默认可直接继续写稿。你仍可以改章节任务。'}
      />

      <div className="rounded-2xl border border-[#2b2b36] bg-[#18181f] p-4 space-y-3">
        <div className="text-[12px] text-zinc-400">创作简报</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            value={brief.coreQuestion}
            onChange={(e) => patchBrief({ coreQuestion: e.target.value })}
            placeholder="核心问题：观众看完要得到什么答案"
            className="bg-[#121217] border border-[#2b2b36] rounded-xl px-3 py-2 text-[13px] text-zinc-100"
          />
          <input
            value={brief.audience}
            onChange={(e) => patchBrief({ audience: e.target.value })}
            placeholder="目标受众"
            className="bg-[#121217] border border-[#2b2b36] rounded-xl px-3 py-2 text-[13px] text-zinc-100"
          />
          <input
            value={brief.coreConclusion}
            onChange={(e) => patchBrief({ coreConclusion: e.target.value })}
            placeholder="核心结论"
            className="md:col-span-2 bg-[#121217] border border-[#2b2b36] rounded-xl px-3 py-2 text-[13px] text-zinc-100"
          />
          <input
            value={brief.callToAction || ''}
            onChange={(e) => patchBrief({ callToAction: e.target.value })}
            placeholder="行动目标（可选）"
            className="bg-[#121217] border border-[#2b2b36] rounded-xl px-3 py-2 text-[13px] text-zinc-100"
          />
          <input
            value={brief.forbiddenClaims.join('；')}
            onChange={(e) => patchBrief({ forbiddenClaims: e.target.value.split(/[；;]/).map((item) => item.trim()).filter(Boolean) })}
            placeholder="禁区，用分号分隔"
            className="bg-[#121217] border border-[#2b2b36] rounded-xl px-3 py-2 text-[13px] text-zinc-100"
          />
          <input
            value={brief.requiredTerms.join('、')}
            onChange={(e) => patchBrief({ requiredTerms: e.target.value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean) })}
            placeholder="必须保留的术语，顿号分隔"
            className="bg-[#121217] border border-[#2b2b36] rounded-xl px-3 py-2 text-[13px] text-zinc-100"
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-zinc-400">事实与证据</span>
            <button
              type="button"
              className="text-[11px] text-amber-300 cursor-pointer"
              onClick={() => patchBrief({
                evidence: [...brief.evidence, { id: `evidence-${brief.evidence.length + 1}`, claim: '', confidence: 'user' }]
              })}
            >
              添加证据
            </button>
          </div>
          {brief.evidence.map((item, index) => (
            <div key={item.id} className="flex gap-2">
              <input
                value={item.claim}
                onChange={(e) => {
                  const evidence = brief.evidence.map((row, rowIndex) => rowIndex === index ? { ...row, claim: e.target.value } : row);
                  patchBrief({ evidence });
                }}
                placeholder="一条用户确认的事实，模型不得编造"
                className="flex-1 bg-[#121217] border border-[#2b2b36] rounded-xl px-3 py-2 text-[13px] text-zinc-100"
              />
              <button
                type="button"
                className="text-zinc-500 hover:text-rose-300 cursor-pointer"
                onClick={() => patchBrief({ evidence: brief.evidence.filter((_, rowIndex) => rowIndex !== index) })}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          id="btn-generate-outline"
          onClick={() => void requestOutline()}
          disabled={busy || pendingId === 'outline'}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black text-[13px] font-semibold rounded-xl flex items-center gap-2 cursor-pointer disabled:opacity-50"
        >
          {pendingId === 'outline' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {outline ? '重新生成提纲' : '生成全片提纲'}
        </button>
        {outline && requireConfirm && outline.status !== 'confirmed' && (
          <button
            type="button"
            id="btn-confirm-outline"
            onClick={confirmOutline}
            className="px-4 py-2 border border-amber-500/40 text-amber-200 text-[13px] rounded-xl cursor-pointer"
          >
            确认提纲
          </button>
        )}
        {outline && requireConfirm && outline.status !== 'confirmed' && unfinished[0] && (
          <button
            type="button"
            id="btn-confirm-and-draft-first"
            onClick={() => {
              if (!outline) return;
              const confirmed = { ...outline, status: 'confirmed' as const, confirmedAt: Date.now(), version: (outline.version || 1) + 1 };
              patchOutline(confirmed);
              void draftSection(unfinished[0].id, confirmed);
            }}
            className="px-4 py-2 border border-[#2b2b36] text-zinc-200 text-[13px] rounded-xl cursor-pointer"
          >
            确认提纲并生成第 1 章
          </button>
        )}
        {outline && unfinished[0] && (!requireConfirm || outline.status === 'confirmed') && (
          <button
            type="button"
            id="btn-draft-next-section"
            onClick={() => void draftSection(unfinished[0].id)}
            disabled={Boolean(pendingId)}
            className="px-4 py-2 border border-[#2b2b36] text-zinc-200 text-[13px] rounded-xl cursor-pointer disabled:opacity-50"
          >
            生成{unfinished[0].order === 1 ? '第 1 章' : '下一章'}
          </button>
        )}
        {outline && unfinished.length > 1 && (!requireConfirm || outline.status === 'confirmed') && (
          <button
            type="button"
            id="btn-draft-all-sections"
            onClick={() => void draftAllUnfinished()}
            disabled={Boolean(pendingId)}
            className="px-4 py-2 border border-[#2b2b36] text-zinc-200 text-[13px] rounded-xl cursor-pointer disabled:opacity-50"
          >
            生成全部未完成章节
          </button>
        )}
        {!requireConfirm && outline && (
          <button
            type="button"
            id="btn-draft-from-outline"
            onClick={() => void draftAllUnfinished()}
            disabled={Boolean(pendingId)}
            className="px-4 py-2 bg-amber-500/20 border border-amber-500/40 text-amber-100 text-[13px] rounded-xl cursor-pointer disabled:opacity-50"
          >
            按提纲写稿
          </button>
        )}
      </div>

      {outline ? (
        <div className="space-y-2">
          {outline.oneSentenceThesis && (
            <p className="text-[13px] text-zinc-300">全片一句话：{outline.oneSentenceThesis}</p>
          )}
          <p className="text-[11px] text-zinc-500">
            全文参考 {length.targetUnits}{unit}（范围 {length.minUnits}–{length.maxUnits}）· 提纲 {outline.status}
          </p>
          {outline.sections.map((section) => {
            const draft = workspace.sections?.find(item => item.id === section.id);
            const used = countBudgetUnits(draft?.narration, workspace.scriptLanguage);
            return (
            <div key={section.id} className={`rounded-xl border p-3 space-y-2 ${
              workspace.activeSectionId === section.id
                ? 'border-amber-500/50 bg-amber-500/5'
                : 'border-[#2b2b36] bg-[#18181f]'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <input
                  value={section.title}
                  onChange={(e) => outline && patchOutline(updateOutlineSection(outline, section.id, { title: e.target.value }))}
                  className="bg-transparent text-[13px] text-zinc-100 flex-1 outline-none"
                />
                <span className="text-[11px] text-zinc-500">{section.role} · {section.targetSeconds}s · 参考 {section.minUnits}–{section.maxUnits}{unit}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{STATUS_LABEL[section.status] || section.status}</span>
              </div>
              {draft?.narration && <p className="text-[11px] text-zinc-400" role="status">
                草稿 {used}{unit}{used < section.minUnits || used > section.maxUnits ? ' · 偏离参考篇幅，草稿已保留；可继续写作，全文完成后统一评估。' : ''}
              </p>}
              {draft?.beatLabelWarnings?.map((warning, index) => <p key={index} className="text-[11px] text-zinc-400">{warning}</p>)}
              <input
                value={section.audienceQuestion}
                onChange={(e) => outline && patchOutline(updateOutlineSection(outline, section.id, { audienceQuestion: e.target.value }))}
                placeholder="这一章回答观众的什么问题"
                className="w-full bg-[#121217] border border-[#2b2b36] rounded-lg px-2 py-1.5 text-[12px] text-zinc-200"
              />
              <input
                value={section.promise}
                onChange={(e) => outline && patchOutline(updateOutlineSection(outline, section.id, { promise: e.target.value }))}
                placeholder="章节承诺，禁止写「继续讲解」"
                className="w-full bg-[#121217] border border-[#2b2b36] rounded-lg px-2 py-1.5 text-[12px] text-zinc-200"
              />
              <input value={section.retentionDevice} onChange={(e) => outline && patchOutline(updateOutlineSection(outline, section.id, { retentionDevice: e.target.value }))} placeholder="留存设计：这一段靠什么留住观众" className="w-full bg-[#121217] border border-[#2b2b36] rounded-lg px-2 py-1.5 text-[12px] text-zinc-200" />
              <input value={section.transitionOut} onChange={(e) => outline && patchOutline(updateOutlineSection(outline, section.id, { transitionOut: e.target.value }))} placeholder="移交下一段的问题" className="w-full bg-[#121217] border border-[#2b2b36] rounded-lg px-2 py-1.5 text-[12px] text-zinc-200" />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void draftSection(section.id)}
                  disabled={Boolean(pendingId) || section.status === 'locked' || (requireConfirm && outline.status !== 'confirmed')}
                  className="text-[11px] text-amber-300 cursor-pointer disabled:text-zinc-600"
                >
                  {section.status === 'failed' ? '重试本章' : section.status === 'ready' ? '重写本章' : '生成本章'}
                </button>
                {(section.status === 'ready' || section.status === 'locked') && (
                  <button type="button" onClick={() => toggleLock(section.id)} className="text-[11px] text-zinc-400 cursor-pointer flex items-center gap-1">
                    {section.status === 'locked' ? <Unlock className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    {section.status === 'locked' ? '解锁' : '锁定'}
                  </button>
                )}
                <button type="button" onClick={() => outline && patchOutline(moveOutlineSection(outline, section.id, -1, workspace.durationBudget))} className="text-zinc-500 cursor-pointer"><ArrowUp className="w-3 h-3" /></button>
                <button type="button" onClick={() => outline && patchOutline(moveOutlineSection(outline, section.id, 1, workspace.durationBudget))} className="text-zinc-500 cursor-pointer"><ArrowDown className="w-3 h-3" /></button>
                <button type="button" onClick={() => outline && patchOutline(addOutlineSection(outline, section.id, workspace.durationBudget))} className="text-zinc-500 cursor-pointer"><Plus className="w-3 h-3" /></button>
                <button type="button" onClick={() => outline && patchOutline(removeOutlineSection(outline, section.id, workspace.durationBudget))} className="text-zinc-500 cursor-pointer"><Trash2 className="w-3 h-3" /></button>
              </div>
            </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-zinc-500">还没有提纲。先点「生成全片提纲」。短视频请回时长页直接写稿。</p>
      )}
    </div>
  );
}

export function RevisionBanner({
  workspace,
  onChange,
  customLlmApi
}: {
  workspace: ScriptWorkspace;
  onChange: (next: ScriptWorkspace) => void;
  customLlmApi?: CustomLlmApiConfig;
}) {
  const measured = workspace.durationBudget.actualTotalSeconds;
  const target = workspace.durationBudget.targetSeconds;
  if (measured == null) return null;
  const delta = measured - target;
  const tolerance = Math.max(2, target * 0.05);
  if (Math.abs(delta) <= tolerance) {
    return <p className="text-[12px] text-emerald-300">时长已实测匹配：目标 {target}s · 实测 {measured}s</p>;
  }
  const plan = workspace.revisionPlan;
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[12px] text-amber-100 space-y-2">
      <div>目标 {target}s · 实测 {measured}s · {delta > 0 ? `超出 ${delta.toFixed(1)}s` : `不足 ${Math.abs(delta).toFixed(1)}s`}</div>
      {plan?.sectionActions?.length ? (
        <div className="space-y-1">
          {plan.sectionActions.map((action) => (
            <div key={action.sectionId} className="flex items-center justify-between gap-2">
              <span>{action.instruction}</span>
              <button
                type="button"
                className="text-amber-200/70 cursor-pointer"
                onClick={() => onChange({
                  ...workspace,
                  revisionPlan: {
                    ...plan,
                    sectionActions: plan.sectionActions.filter((item) => item.sectionId !== action.sectionId)
                  }
                })}
              >
                去掉
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          className="text-amber-200 underline cursor-pointer"
          onClick={async () => {
            const res = await fetch('/api/script/revision-plan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                measuredSeconds: measured,
                targetSeconds: target,
                outline: workspace.outline,
                sections: workspace.sections,
                budget: workspace.durationBudget
              })
            });
            const data = await res.json().catch(() => ({}));
            if (data?.revisionPlan) onChange({ ...workspace, revisionPlan: data.revisionPlan });
          }}
        >
          查看修改计划
        </button>
        {plan?.sectionActions?.length ? (
          <button
            type="button"
            className="text-amber-200 underline cursor-pointer"
            onClick={async () => {
              let sections = workspace.sections || [];
              for (const action of plan.sectionActions) {
                const res = await fetch('/api/script/section-revise', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action,
                    sections,
                    outline: workspace.outline,
                    brief: workspace.brief,
                    budget: workspace.durationBudget,
                    llmApi: customLlmApi,
                    scriptLanguage: workspace.scriptLanguage,
                    writingStyleId: workspace.contentBrief?.writingStyleId,
                    writingStyles: workspace.writingStyles
                  })
                });
                const data = await res.json().catch(() => ({}));
                if (Array.isArray(data?.sections)) sections = data.sections;
              }
              const lang = normalizeScriptLanguage(workspace.scriptLanguage);
              onChange(rebuildForecast({
                ...workspace,
                sections,
                beats: flattenSectionBeats(sections),
                fullNarration: joinSectionNarrations(sections, lang),
                revisionPlan: null
              }));
            }}
          >
            按计划回修
          </button>
        ) : null}
      </div>
    </div>
  );
}
