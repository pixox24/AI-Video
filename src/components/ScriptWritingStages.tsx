import React, { useRef, useState } from 'react';
import { Lock, RefreshCw, Wand2 } from 'lucide-react';
import type { BeatFunction, CustomLlmApiConfig, ResearchNotes, ScriptWorkspace, ShotEnergy } from '../types';
import { budgetUnitLabel } from '../utils/scriptLanguage';
import { beatIntentLabel, formatSeconds, lengthBudgetOf } from '../utils/scriptBudget';
import { FILL_RATIO_MIN } from '../utils/scriptDuration';
import { RESEARCH_DRAG_MIME, RESEARCH_FIELDS, workspaceTopicTitle } from '../utils/scriptWorkspace';
import { CAMERA_ANGLE_LABEL, COVERAGE_JOB_LABEL, SHOT_SIZE_LABEL } from '../utils/shotCoverage';
import { bibleSubjects, continuityShortLabel, occupancyReasonLabel } from '../utils/visualBible';
import { RevisionBanner } from './ScriptOutlineStage';

const ENERGY_LABEL: Record<ShotEnergy, string> = {
  fast: '快',
  medium: '中',
  slow: '慢',
  hold: '停'
};

const ENERGY_COLOR: Record<ShotEnergy, string> = {
  fast: 'bg-orange-400',
  medium: 'bg-amber-400',
  slow: 'bg-sky-400',
  hold: 'bg-violet-400'
};

const FUNCTION_LABEL: Record<BeatFunction, string> = {
  hook: '钩子',
  setup: '铺垫',
  turn: '转折',
  proof: '证据',
  reveal: '揭示',
  cta: '收束'
};

function SectionIntro({ title, desc }: { title: string; desc: string }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
      <p className="mt-1 text-[13px] text-zinc-500 leading-relaxed">{desc}</p>
    </div>
  );
}

function PrimaryButton({ id, busy, onClick, disabled, children }: {
  id?: string;
  busy?: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold bg-gradient-to-r from-amber-500 to-orange-500 text-black disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
    >
      {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
      {children}
    </button>
  );
}
export function ResearchStage({
  workspace,
  busy,
  onChange,
  onReferenceUrl,
  onFillHook,
  onResearch,
  onConcepts
}: {
  workspace: ScriptWorkspace;
  busy: boolean;
  onChange: (notes: ScriptWorkspace['researchNotes']) => void;
  onReferenceUrl: (value: string) => void;
  onFillHook: (key: keyof ResearchNotes) => void;
  onResearch: () => void;
  onConcepts: () => void;
}) {
  const notes = workspace.researchNotes;
  return (
    <div className="space-y-5 max-w-3xl">
      <SectionIntro
        title="浅调研四刀"
        desc="对标、受众、事实、画面。可以联网搜，也可以手写。搜完能一键出三个概念。"
      />
      <input
        value={workspace.referenceUrl}
        onChange={(e) => onReferenceUrl(e.target.value)}
        placeholder="对标链接，可空。有的话会算进对标刀。"
        className="w-full bg-[#18181f] border border-[#2b2b36] rounded-xl px-3 py-2 text-[13px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 select-text"
      />
      <div className="flex flex-wrap gap-2">
        <PrimaryButton id="btn-shallow-research" busy={busy} onClick={onResearch}>开始浅调研</PrimaryButton>
        <button
          type="button"
          onClick={onConcepts}
          disabled={busy}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium border border-[#2b2b36] text-zinc-200 hover:border-amber-500/40 cursor-pointer disabled:opacity-40"
        >
          根据调研出三个概念
        </button>
      </div>
      {workspace.researchBrief && (
        <div className="rounded-2xl border border-[#2b2b36] bg-[#18181f] p-4 space-y-2">
          <div className="text-[12px] text-zinc-200">{workspace.researchBrief.summary}</div>
          <div className="text-[10px] text-zinc-500">来源：{workspace.researchBrief.source === 'web' ? '网页' : workspace.researchBrief.source === 'mixed' ? '网页 + 模型' : '模型归纳'}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {workspace.researchBrief.blades.map((blade) => (
              <div key={blade.id} className="rounded-xl border border-[#2b2b36] p-2.5">
                <div className="text-[11px] text-amber-300">{blade.label}</div>
                <div className="text-[10px] text-zinc-600 truncate">{blade.query}</div>
                <ul className="mt-1 space-y-1">
                  {blade.findings.slice(0, 2).map((hit) => (
                    <li key={hit.url || hit.title} className="text-[11px] text-zinc-400 truncate">
                      {hit.title || hit.snippet}
                    </li>
                  ))}
                  {blade.findings.length === 0 && <li className="text-[11px] text-zinc-600">这刀没搜到</li>}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      <HookDropZone onFillHook={onFillHook} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {RESEARCH_FIELDS.map((field) => (
          <div
            key={field.key}
            className="rounded-2xl border border-[#2b2b36] bg-[#18181f] p-3 space-y-1.5"
          >
            <div
              draggable={Boolean(notes[field.key].trim())}
              onDragStart={(e) => writeResearchDrag(e, field.key)}
              className={`flex items-center justify-between gap-2 ${notes[field.key].trim() ? 'cursor-grab' : ''}`}
            >
              <span className="text-[12px] text-zinc-400">{field.label}</span>
              <button
                type="button"
                disabled={!notes[field.key].trim()}
                onClick={() => onFillHook(field.key)}
                className="text-[11px] text-amber-400 disabled:text-zinc-600 cursor-pointer disabled:cursor-not-allowed"
              >
                填进钩子
              </button>
            </div>
            <textarea
              value={notes[field.key]}
              onChange={(e) => onChange({ ...notes, [field.key]: e.target.value })}
              rows={3}
              placeholder={field.placeholder}
              className="w-full bg-[#121217] border border-[#2b2b36] rounded-xl p-3 text-[13px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 resize-none select-text"
            />
            {notes[field.key].trim() && (
              <p className="text-[10px] text-zinc-600">拖这张卡到选题或钩子槽</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}


export function BeatsStage({
  workspace,
  onChange,
  onFillHook
}: {
  workspace: ScriptWorkspace;
  onChange: (beats: ScriptWorkspace['beats']) => void;
  onFillHook: (key: keyof ResearchNotes) => void;
}) {
  if (workspace.beats.length === 0) {
    return (
      <div className="space-y-3">
        <SectionIntro title="节拍表" desc="先在时长页点「按预算写稿」，或在已有文案里诊断。" />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <SectionIntro
        title="节拍表"
        desc={workspace.sections && workspace.sections.length > 1
          ? `长视频按 ${workspace.sections.length} 章展开。改某一拍的口播，整段旁白和节奏带会一起重算。`
          : '改某一拍的口播，整段旁白和节奏带会一起重算。钩子行可以接调研笔记。'}
      />
      {workspace.sections && workspace.sections.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {workspace.sections.map((section) => (
            <span key={section.id} className="text-[10px] px-2 py-1 rounded-lg border border-[#2b2b36] text-zinc-400">
              {section.order}. {section.title} · {section.targetSeconds}s
            </span>
          ))}
        </div>
      )}
      <HookDropZone onFillHook={onFillHook} />
      <div className="space-y-2">
        {workspace.beats.map((beat, index) => (
          <div
            key={beat.id}
            onDragOver={(e) => {
              if (beat.function === 'hook' && isResearchDragEvent(e)) e.preventDefault();
            }}
            onDrop={(e) => {
              if (beat.function !== 'hook') return;
              const key = readResearchDrag(e);
              if (!key) return;
              e.preventDefault();
              onFillHook(key);
            }}
            className={`rounded-xl border p-3 grid grid-cols-1 lg:grid-cols-12 gap-2 ${
              beat.function === 'hook' ? 'border-amber-500/35 bg-amber-500/5' : 'border-[#2b2b36] bg-[#18181f]'
            }`}
          >
            <div className="lg:col-span-2 flex flex-col gap-1">
              <span className="text-[11px] text-amber-400">{FUNCTION_LABEL[beat.function]}</span>
              <span className="text-[10px] text-zinc-500">{ENERGY_LABEL[beat.energy]} · {beat.intent || beatIntentLabel(beat.function)}</span>
            </div>
            <textarea
              value={beat.narration}
              onChange={(e) => {
                const beats = workspace.beats.map((item, itemIndex) => itemIndex === index ? { ...item, narration: e.target.value } : item);
                onChange(beats);
              }}
              rows={2}
              className="lg:col-span-6 bg-[#121217] border border-[#2b2b36] rounded-lg p-2 text-[12px] text-zinc-200 resize-none select-text"
            />
            <textarea
              value={beat.visualIntent}
              onChange={(e) => {
                const beats = workspace.beats.map((item, itemIndex) => itemIndex === index ? { ...item, visualIntent: e.target.value } : item);
                onChange(beats);
              }}
              rows={2}
              placeholder="看得见的画面，不要写「很有氛围」"
              className="lg:col-span-4 bg-[#121217] border border-[#2b2b36] rounded-lg p-2 text-[12px] text-zinc-300 resize-none select-text"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CopyStage({
  workspace,
  onChange,
  onWorkspaceChange,
  customLlmApi,
  onDraft,
  onDiagnose,
  onAdoptDuration,
  busy,
  onHoldChange,
  onFillHook,
  onEditTitle
}: {
  workspace: ScriptWorkspace;
  onChange: (value: string) => void;
  onWorkspaceChange?: (next: ScriptWorkspace) => void;
  customLlmApi?: CustomLlmApiConfig;
  onDraft: () => void;
  onDiagnose: () => void;
  onAdoptDuration: () => void;
  busy: boolean;
  onHoldChange: (shotId: string, holdDuration: number) => void;
  onFillHook: (key: keyof ResearchNotes) => void;
  onEditTitle?: () => void;
}) {
  const budget = workspace.durationBudget;
  const unit = budgetUnitLabel(workspace.scriptLanguage);
  const over = budget.usedChars > budget.maxChars * 1.05;
  const under = budget.usedChars > 0 && budget.usedChars < budget.maxChars * FILL_RATIO_MIN && budget.durationMode === 'target-driven';
  const lockedTitle = workspaceTopicTitle(workspace);
  return (
    <div className="space-y-4 max-w-4xl">
      <SectionIntro title="整段口播" desc={workspace.durationBudget.durationMode === 'content-driven'
        ? '已有文案优先保留。可延长到预计时长、压缩到目标，或扩写到目标，不会因为没填满预算而丢稿。'
        : `一条连续旁白。目标 ${lengthBudgetOf(budget).targetUnits}${unit}，允许 ${lengthBudgetOf(budget).minUnits}–${lengthBudgetOf(budget).maxUnits}。`} />
      {onWorkspaceChange && <RevisionBanner workspace={workspace} onChange={onWorkspaceChange} customLlmApi={customLlmApi} />}
      {workspace.intent === 'have-title' && lockedTitle && (
        <div className="flex items-center gap-2 rounded-xl border border-[#2b2b36] bg-[#18181f] px-3 py-2">
          <Lock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
          <span className="text-[12px] text-zinc-200 truncate flex-1">{lockedTitle}</span>
          {onEditTitle && (
            <button type="button" onClick={onEditTitle} className="text-[11px] text-amber-400 hover:text-amber-300 cursor-pointer flex-shrink-0">
              改
            </button>
          )}
        </div>
      )}
      <HookDropZone onFillHook={onFillHook} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <span className={over || under ? 'text-amber-300' : 'text-zinc-400'}>
          {budget.usedChars} / {budget.maxChars} {unit} · 预计口播 {formatSeconds(budget.usedChars / Math.max(0.1, budget.charsPerSecond))}
          {under ? ' · 未填满 90%' : over ? ' · 超出 105%' : ''}
        </span>
        {workspace.intent === 'have-script' ? (
          <div className="flex items-center gap-3">
            {workspace.durationBudget.durationMode === 'content-driven' && (
              <>
                <button type="button" onClick={onAdoptDuration} className="text-amber-300 text-[12px] cursor-pointer">采用预计时长</button>
                {onWorkspaceChange && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const measured = budget.usedChars / Math.max(0.8, budget.charsPerSecond) + budget.holdSeconds;
                      const res = await fetch('/api/script/revision-plan', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          measuredSeconds: measured,
                          targetSeconds: budget.targetSeconds,
                          outline: workspace.outline,
                          sections: workspace.sections,
                          budget
                        })
                      });
                      const data = await res.json().catch(() => ({}));
                      if (data?.revisionPlan) onWorkspaceChange({ ...workspace, revisionPlan: data.revisionPlan });
                    }}
                    className="text-amber-300 text-[12px] cursor-pointer disabled:opacity-50"
                  >
                    {over ? '压缩到目标' : '扩写到目标'}
                  </button>
                )}
              </>
            )}
            <button type="button" onClick={onDiagnose} className="text-amber-400 text-[12px] cursor-pointer">重新诊断</button>
          </div>
        ) : (
          <button type="button" onClick={onDraft} disabled={busy} className="text-amber-400 text-[12px] cursor-pointer disabled:opacity-50">按预算重写</button>
        )}
      </div>
      <textarea
        id="input-full-narration"
        value={workspace.fullNarration}
        onChange={(e) => onChange(e.target.value)}
        rows={14}
        placeholder="口播写在这里。刷新后还在。"
        className={`w-full bg-[#18181f] border rounded-2xl p-4 text-[14px] leading-relaxed text-zinc-100 placeholder-zinc-600 focus:outline-none resize-none select-text ${
          over || under ? 'border-amber-500/50' : 'border-[#2b2b36] focus:border-amber-500/50'
        }`}
      />
      <RhythmTape shots={workspace.forecastShots} onHoldChange={onHoldChange} />
    </div>
  );
}

export function RhythmStage({
  workspace,
  onHoldChange
}: {
  workspace: ScriptWorkspace;
  onHoldChange: (shotId: string, holdDuration: number) => void;
}) {
  const shots = workspace.forecastShots;
  return (
    <div className="space-y-5">
      <SectionIntro title="节奏带" desc="格子宽是秒数。拖每格右缘只加「念完后的停留」，不能短于口播。停过的格下次重算还会记住。" />
      <RhythmTape shots={shots} onHoldChange={onHoldChange} />
      {shots.length === 0 ? (
        <p className="text-sm text-zinc-500">还没有预测镜。先写稿或诊断已有文案。</p>
      ) : (
        <div className="space-y-2">
          {shots.map((shot) => (
            <div key={shot.id} className="rounded-xl border border-[#2b2b36] bg-[#18181f] px-3 py-2.5 flex gap-3">
              <div className="w-16 flex-shrink-0">
                <div className="text-[11px] text-amber-400">镜 {shot.order}</div>
                <div className="text-[10px] text-zinc-500">{(shot.speechDuration + shot.holdDuration).toFixed(1)}s</div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-zinc-200 truncate">{shot.sliceText || shot.narration || '（无口播，纯画面停留）'}</div>
                <div className="mt-1 text-[10px] text-zinc-500">
                  {FUNCTION_LABEL[shot.function]} · {ENERGY_LABEL[shot.energy]}
                  {shot.shotSize ? ` · ${SHOT_SIZE_LABEL[shot.shotSize]}` : ''}
                  {shot.cameraAngle ? ` · ${CAMERA_ANGLE_LABEL[shot.cameraAngle]}` : ''}
                  {shot.coverageJob ? ` · ${COVERAGE_JOB_LABEL[shot.coverageJob]}` : ''}
                  {' '}· 口播 {shot.speechDuration.toFixed(1)}s · 停留 {shot.holdDuration.toFixed(1)}s
                  {shot.visualCount && shot.visualCount > 1 ? ` · 同一句图 ${(shot.visualIndex || 0) + 1}/${shot.visualCount}` : ''}
                  {shot.holdPinned ? ' · 停留已钉' : ''}
                  {continuityShortLabel(shot.continuity) ? ` · ${continuityShortLabel(shot.continuity)}` : ''}
                  {shot.occupancyPlan
                    ? ` · ${occupancyReasonLabel(shot.occupancyPlan.reason) || (shot.occupancyPlan.onCamera ? '上人' : '无人')}${
                        shot.occupancyPlan.characterIds.length
                          ? ` ${shot.occupancyPlan.characterIds.map((id) => workspace.visualBible?.characters.find((item) => item.id === id)?.name).filter(Boolean).join('、')}`
                          : ''
                      }${
                        shot.occupancyPlan.subjectIds.length
                          ? ` ${shot.occupancyPlan.subjectIds.map((id) => bibleSubjects(workspace.visualBible).find((item) => item.id === id)?.name).filter(Boolean).join('、')}`
                          : ''
                      }`
                    : shot.characterIds?.length
                      ? ` · ${workspace.visualBible?.characters.find((item) => shot.characterIds!.includes(item.id))?.name || '角色'}`
                      : shot.coverageJob === 'insert'
                        ? ' · 无人'
                        : ''}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-600 truncate">{shot.splitReason}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RhythmTape({
  shots,
  onHoldChange
}: {
  shots: ScriptWorkspace['forecastShots'];
  onHoldChange?: (shotId: string, holdDuration: number) => void;
}) {
  const tapeRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startHold: number; pps: number } | null>(null);

  if (shots.length === 0) {
    return <div id="rhythm-tape" className="h-10 rounded-lg bg-[#18181f] border border-dashed border-[#2b2b36]" />;
  }

  const beginHoldDrag = (event: React.PointerEvent, shot: ScriptWorkspace['forecastShots'][number]) => {
    if (!onHoldChange) return;
    event.preventDefault();
    event.stopPropagation();
    const total = shots.reduce((sum, item) => sum + item.speechDuration + item.holdDuration, 0);
    const width = tapeRef.current?.clientWidth || 1;
    dragRef.current = {
      id: shot.id,
      startX: event.clientX,
      startHold: shot.holdDuration,
      pps: total > 0 ? width / total : 40
    };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };

  const moveHoldDrag = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !onHoldChange) return;
    const delta = (event.clientX - drag.startX) / drag.pps;
    const hold = Math.max(0, Math.min(8, Math.round((drag.startHold + delta) * 10) / 10));
    onHoldChange(drag.id, hold);
  };

  const endHoldDrag = () => {
    dragRef.current = null;
  };

  return (
    <div
      id="rhythm-tape"
      ref={tapeRef}
      className="flex h-12 rounded-lg overflow-hidden border border-[#2b2b36] select-none"
    >
      {shots.map((shot) => {
        const duration = Math.max(0.4, shot.speechDuration + shot.holdDuration);
        return (
          <div
            key={shot.id}
            title={`镜${shot.order} 口播 ${shot.speechDuration.toFixed(1)}s · 停留 ${shot.holdDuration.toFixed(1)}s${shot.holdPinned ? '（已钉）' : ''}。拖右缘只加停留。`}
            style={{ flex: duration }}
            className={`${ENERGY_COLOR[shot.energy]} relative opacity-90 border-r border-black/30 last:border-0`}
          >
            <span className="absolute inset-0 flex items-center justify-center text-[9px] font-medium text-black/70 pointer-events-none">
              {shot.order}
            </span>
            {onHoldChange && (
              <span
                id={`rhythm-hold-handle-${shot.id}`}
                onPointerDown={(event) => beginHoldDrag(event, shot)}
                onPointerMove={moveHoldDrag}
                onPointerUp={endHoldDrag}
                onPointerCancel={endHoldDrag}
                className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/25 hover:bg-black/45"
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function HookDropZone({ onFillHook }: { onFillHook: (key: keyof ResearchNotes) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div
      id="hook-drop-zone"
      onDragOver={(e) => {
        if (!isResearchDragEvent(e)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const key = readResearchDrag(e);
        setOver(false);
        if (!key) return;
        e.preventDefault();
        onFillHook(key);
      }}
      className={`rounded-xl border border-dashed px-3 py-2.5 text-[12px] ${
        over
          ? 'border-amber-400 bg-amber-500/15 text-amber-100'
          : 'border-[#2b2b36] bg-[#18181f] text-zinc-500'
      }`}
    >
      钩子槽 · 把调研卡拖到这里，或在调研页点「填进钩子」
    </div>
  );
}

export function isResearchDragEvent(event: React.DragEvent) {
  const types = Array.from(event.dataTransfer.types || []);
  return types.includes(RESEARCH_DRAG_MIME) || types.includes('text/plain');
}

export function readResearchDrag(event: React.DragEvent): keyof ResearchNotes | null {
  const raw = event.dataTransfer.getData(RESEARCH_DRAG_MIME) || event.dataTransfer.getData('text/plain');
  const key = raw.replace(/^research-note:/, '') as keyof ResearchNotes;
  if (key === 'competitor' || key === 'audienceQuestion' || key === 'fact' || key === 'visualRef') return key;
  return null;
}

function writeResearchDrag(event: React.DragEvent, key: keyof ResearchNotes) {
  event.dataTransfer.setData(RESEARCH_DRAG_MIME, key);
  event.dataTransfer.setData('text/plain', `research-note:${key}`);
  event.dataTransfer.effectAllowed = 'copy';
}
