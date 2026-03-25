/**
 * 异步生成握手与作业控制（设计 **01**、**11**）：pending PRE 单槽、活跃作业取消集合。
 * 仅 SW 内存；随 Service Worker 休眠丢失，由熔炉 PRE/DISPATCH 重建。
 */

/** @type {Record<string, unknown> | null} */
export let pendingPreSlot = null;

/** @type {Map<string, { cancelRequested: boolean }>} */
export const activeAsyncJobs = new Map();

export function setPendingPreSlot(v) {
  pendingPreSlot = v;
}

/**
 * @param {string} id12
 */
export function markAsyncJobCancelled(id12) {
  if (!id12 || typeof id12 !== 'string') return;
  const cur = activeAsyncJobs.get(id12) || { cancelRequested: false };
  cur.cancelRequested = true;
  activeAsyncJobs.set(id12, cur);
}

/**
 * @param {string} id12
 */
export function registerActiveAsyncJob(id12) {
  if (!id12 || typeof id12 !== 'string') return;
  activeAsyncJobs.set(id12, { cancelRequested: false });
}

/**
 * @param {string} id12
 */
export function isAsyncJobCancelled(id12) {
  const j = activeAsyncJobs.get(id12);
  return !!(j && j.cancelRequested);
}
