/**
 * 框架 step02（frameworkPreflight）调用 `attachLogSink` 注册本轮 roundId；之后仅接受同 round 的 LOG_APPEND。
 * 不替代 §9.3 的顶栏执行槽：空闲判定仍以页面 DOM 为准（R14）。
 */

/** @type {Map<number, string>} */
const sinkRoundByTabId = new Map();

/**
 * @param {number} tabId
 * @param {string} roundId
 */
export function attachLogSink(tabId, roundId) {
  sinkRoundByTabId.set(tabId, roundId);
}

/**
 * @param {number} tabId
 */
export function detachLogSink(tabId) {
  sinkRoundByTabId.delete(tabId);
}

/**
 * @param {number} tabId
 * @returns {string | undefined}
 */
export function getSinkRoundForTab(tabId) {
  return sinkRoundByTabId.get(tabId);
}
