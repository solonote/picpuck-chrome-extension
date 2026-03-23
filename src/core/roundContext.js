/**
 * RoundContext：按 tabId 隔离（R10、R13、§6）。
 * 不导出内部 Map，仅通过本模块 API 修改。
 */
import { validateLogMessage } from './logFormat.js';

/** @typedef {import('./types.js').LogEntry} LogEntry */

/**
 * @typedef {Object} RoundContext
 * @property {string} roundId
 * @property {import('./types.js').UiPhase} phase
 * @property {string} command
 * @property {number} startedAt
 * @property {LogEntry[]} logs
 * @property {string} lastInfoMessage
 * @property {number} tabId
 */

/** @type {Map<number, RoundContext>} */
const contexts = new Map();

/**
 * @param {number} tabId
 * @returns {RoundContext | undefined}
 */
export function getContext(tabId) {
  return contexts.get(tabId);
}

/**
 * §9.7：dispatchRound 开头使用；无则创建默认壳（随后写入 roundId/command）。
 * @param {number} tabId
 * @returns {RoundContext}
 */
export function getOrCreateRoundContext(tabId) {
  let c = contexts.get(tabId);
  if (!c) {
    c = {
      roundId: '',
      phase: 'idle',
      command: '',
      startedAt: Date.now(),
      logs: [],
      lastInfoMessage: '',
      tabId,
    };
    contexts.set(tabId, c);
  }
  return c;
}

/**
 * @param {number} tabId
 * @param {import('./types.js').UiPhase} phase
 * @returns {RoundContext}
 */
export function updatePhase(tabId, phase) {
  const c = getOrCreateRoundContext(tabId);
  c.phase = phase;
  return c;
}

/**
 * @param {number} tabId
 * @param {Omit<LogEntry, 'tabId'|'frameId'> & { tabId?: number, frameId?: number }} entry
 * @returns {{ ok: true, context: RoundContext } | { ok: false, reason: string }}
 */
export function appendLog(tabId, entry) {
  const v = validateLogMessage(entry.level, entry.message);
  if (!v.ok) {
    console.warn('[PicPuck] appendLog rejected tab=%d: %s', tabId, v.reason, entry.message);
    return { ok: false, reason: v.reason };
  }
  const c = getOrCreateRoundContext(tabId);
  /** @type {LogEntry} */
  const row = {
    ts: entry.ts,
    roundId: entry.roundId,
    step: entry.step,
    level: entry.level,
    message: entry.message,
  };
  if (entry.tabId !== undefined) row.tabId = entry.tabId;
  if (entry.frameId !== undefined) row.frameId = entry.frameId;
  c.logs.push(row);
  // R5、§6.3：仅 info 更新顶栏右侧摘要；debug 不改变 lastInfoMessage
  if (entry.level === 'info') {
    c.lastInfoMessage = entry.message;
  }
  return { ok: true, context: c };
}

/**
 * 等价于 clearRoundLogs 的 SW 侧状态部分（§12.2）：清空日志与 lastInfoMessage，phase → clearing。
 * @param {number} tabId
 * @returns {RoundContext}
 */
export function clearLogs(tabId) {
  const c = getOrCreateRoundContext(tabId);
  c.logs = [];
  c.lastInfoMessage = '';
  c.phase = 'clearing';
  return c;
}

/**
 * 测试或 Tab 关闭时清理（可选，非设计硬性）。
 * @param {number} tabId
 */
export function deleteContext(tabId) {
  contexts.delete(tabId);
}
