/**
 * Smart Concurrency Pool Executor
 * Executes async tasks with a maximum concurrency limit, real-time item status callbacks,
 * and AbortController support.
 */

export interface ConcurrencyTask<T, R> {
  id: string;
  item: T;
  index: number;
}

export interface PoolCallbacks<T, R> {
  onItemQueued?: (task: ConcurrencyTask<T, R>) => void;
  onItemStart?: (task: ConcurrencyTask<T, R>) => void;
  onItemSuccess?: (task: ConcurrencyTask<T, R>, result: R) => void;
  onItemError?: (task: ConcurrencyTask<T, R>, error: any) => void;
  onProgress?: (completed: number, total: number) => void;
}

export async function runConcurrencyPool<T, R>(
  items: T[],
  taskFn: (item: T, index: number, signal?: AbortSignal) => Promise<R>,
  options: {
    concurrency?: number;
    getId?: (item: T, index: number) => string;
    signal?: AbortSignal;
  } & PoolCallbacks<T, R>
): Promise<Array<{ id: string; result?: R; error?: any; ok: boolean }>> {
  const {
    concurrency = 3,
    getId = (_, i) => String(i),
    signal,
    onItemQueued,
    onItemStart,
    onItemSuccess,
    onItemError,
    onProgress
  } = options;

  const total = items.length;
  let completedCount = 0;
  const results: Array<{ id: string; result?: R; error?: any; ok: boolean }> = new Array(total);

  // Convert items into indexed tasks
  const queue: ConcurrencyTask<T, R>[] = items.map((item, index) => ({
    id: getId(item, index),
    item,
    index
  }));

  // Notify queued state for all tasks initially
  if (onItemQueued) {
    queue.forEach(task => onItemQueued(task));
  }

  let queueIndex = 0;

  async function worker() {
    while (queueIndex < queue.length) {
      if (signal?.aborted) {
        break;
      }

      const task = queue[queueIndex++];
      if (!task) break;

      onItemStart?.(task);

      try {
        if (signal?.aborted) {
          throw new DOMException('Operation aborted by user', 'AbortError');
        }

        const res = await taskFn(task.item, task.index, signal);
        
        results[task.index] = { id: task.id, result: res, ok: true };
        onItemSuccess?.(task, res);
      } catch (err: any) {
        results[task.index] = { id: task.id, error: err, ok: false };
        onItemError?.(task, err);
      } finally {
        completedCount++;
        onProgress?.(completedCount, total);
      }
    }
  }

  // Spawn parallel workers up to concurrency limit
  const workerCount = Math.min(concurrency, total);
  const workers = Array.from({ length: workerCount }, () => worker());

  await Promise.all(workers);
  return results;
}
