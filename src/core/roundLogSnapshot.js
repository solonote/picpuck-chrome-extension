/**
 * SW 内存会在 worker 休眠后清空；三连击复制依赖的日志需落盘到 session storage（按 tabId）。
 * 在 dispatchRound 的 finally 中快照；`__picpuckCopyLogs` 优先内存，否则读快照。
 */
import { getContext } from './roundContext.js';

const MAX_ENTRIES = 800;

/** @param {number} tabId */
function snapshotKey(tabId) {
  return `picpuckLastLogs_${tabId}`;
}

/**
 * @param {number} tabId
 */
export async function persistRoundLogsSnapshot(tabId) {
  const c = getContext(tabId);
  if (!c || !Array.isArray(c.logs) || c.logs.length === 0) return;
  try {
    await chrome.storage.session.set({
      [snapshotKey(tabId)]: {
        roundId: c.roundId,
        savedAt: Date.now(),
        logs: c.logs.slice(-MAX_ENTRIES),
      },
    });
  } catch (e) {
    console.warn('[PicPuck] persistRoundLogsSnapshot failed tab=%d', tabId, e);
  }
}

/**
 * @param {number} tabId
 * @returns {Promise<import('./types.js').LogEntry[]>}
 */
/**
 * 新一轮 step01 清空内存日志时同步清快照，避免执行中途三连击拿到上一轮 JSON。
 * @param {number} tabId
 */
export function clearRoundLogsSnapshot(tabId) {
  chrome.storage.session.remove(snapshotKey(tabId)).catch(() => {});
}

export async function loadLogsForCopy(tabId) {
  const c = getContext(tabId);
  if (c && Array.isArray(c.logs) && c.logs.length > 0) {
    return c.logs;
  }
  try {
    const key = snapshotKey(tabId);
    const st = await chrome.storage.session.get(key);
    const snap = st[key];
    if (snap && Array.isArray(snap.logs)) return snap.logs;
  } catch (e) {
    console.warn('[PicPuck] loadLogsForCopy failed tab=%d', tabId, e);
  }
  return [];
}
