import React, { useEffect, useMemo, useState } from 'react';
import type { GenerationRun } from '../types';

type UsageResponse = {
  ok: boolean;
  runs: GenerationRun[];
  total: number;
};

export function UsagePanel({ projectId }: { projectId: string }) {
  const [runs, setRuns] = useState<GenerationRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');

  const refresh = async () => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/usage?projectId=${encodeURIComponent(projectId)}`);
      const payload = await response.json() as UsageResponse;
      if (!response.ok || !Array.isArray(payload.runs)) throw new Error('无法读取调用记录');
      setRuns(payload.runs);
      setUpdatedAt(new Date().toLocaleTimeString());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '无法读取调用记录');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [projectId]);

  const summary = useMemo(() => {
    const stages = new Map<string, { count: number; tokens: number; costUsd: number; durationMs: number }>();
    let tokens = 0;
    let costUsd = 0;
    let durationMs = 0;
    for (const run of runs) {
      const item = stages.get(run.stage) || { count: 0, tokens: 0, costUsd: 0, durationMs: 0 };
      const runTokens = run.inputTokens + run.outputTokens;
      item.count += 1;
      item.tokens += runTokens;
      item.costUsd += run.costUsd;
      item.durationMs += run.durationMs;
      stages.set(run.stage, item);
      tokens += runTokens;
      costUsd += run.costUsd;
      durationMs += run.durationMs;
    }
    return { stages: [...stages.entries()].sort(([left], [right]) => left.localeCompare(right)), tokens, costUsd, durationMs };
  }, [runs]);

  return (
    <section className="border-t border-[#2b2b36] px-4 py-3 space-y-2" aria-label="项目调用成本">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-[12px] font-medium text-zinc-200">项目调用成本</h3>
          <p className="text-[10px] text-zinc-500">按当前项目与生成阶段聚合</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || !projectId}
          className="text-[10px] text-amber-300 hover:text-amber-200 disabled:text-zinc-600 cursor-pointer"
        >
          {loading ? '读取中…' : '刷新'}
        </button>
      </div>
      {error ? <p role="alert" className="text-[10px] text-rose-300">{error}</p> : null}
      {!error && summary.stages.length === 0 ? <p className="text-[10px] text-zinc-500">尚无当前项目的生成调用。</p> : null}
      {summary.stages.length > 0 ? <>
        <div className="grid grid-cols-3 gap-1.5 text-[10px]">
          <div className="rounded border border-[#2b2b36] bg-[#18181f] px-2 py-1.5 text-zinc-400">调用 <span className="text-zinc-200">{runs.length}</span></div>
          <div className="rounded border border-[#2b2b36] bg-[#18181f] px-2 py-1.5 text-zinc-400">Token <span className="text-zinc-200">{summary.tokens}</span></div>
          <div className="rounded border border-[#2b2b36] bg-[#18181f] px-2 py-1.5 text-zinc-400">成本 <span className="text-zinc-200">${summary.costUsd.toFixed(4)}</span></div>
        </div>
        <div className="space-y-1">
          {summary.stages.map(([stage, item]) => (
            <div key={stage} className="flex items-center justify-between gap-2 text-[10px] text-zinc-400">
              <span className="truncate">{stage}</span>
              <span className="flex-shrink-0">{item.count} 次 · {item.tokens} token · ${item.costUsd.toFixed(4)}</span>
            </div>
          ))}
        </div>
        <p className="text-[9px] text-zinc-600">累计模型耗时 {(summary.durationMs / 1000).toFixed(1)}s{updatedAt ? ` · ${updatedAt} 更新` : ''}</p>
      </> : null}
    </section>
  );
}
