/**
 * §9.5：仅跟踪「尚未结束的 round」，供响应与 onRemoved 使用。
 * 禁止当作 Tab 池或 idle 表（R15、R14：idle 只看顶栏 DOM）。
 *
 * **任务 → 工作台 Tab（公共查询）**
 * - PicPuck / 扩展响应里的 **任务标识**即 `roundId`（与 `TaskTicket.roundId` 一致）。
 * - `masterDispatch` 在 `allocateTab` 成功后 `set`，`dispatchRound` / `tabLifecycle` / 异常路径 `delete`。
 * - 上层请用 **`getWorkTabIdByRoundId` / `getInFlightTaskTicketByRoundId`**，避免直接依赖 Map 结构。
 */

/** @typedef {{ roundId: string, tabId: number, clientRequestId: string, command: string, createdAt: number }} TaskTicket */

/** @type {Map<string, TaskTicket>} */
export const roundBinding = new Map();

/** @type {Map<number, string>} tabId -> roundId */
export const inFlightByTabId = new Map();

/**
 * 根据本轮任务 ID（roundId）解析**当前**工作台标签页 id；无进行中任务时返回 `undefined`。
 * @param {string} roundId
 * @returns {number|undefined}
 */
export function getWorkTabIdByRoundId(roundId) {
  if (!roundId || typeof roundId !== 'string') return undefined;
  const t = roundBinding.get(roundId);
  return t && typeof t.tabId === 'number' && t.tabId > 0 ? t.tabId : undefined;
}

/**
 * @param {string} roundId
 * @returns {TaskTicket|undefined}
 */
export function getInFlightTaskTicketByRoundId(roundId) {
  if (!roundId || typeof roundId !== 'string') return undefined;
  return roundBinding.get(roundId);
}

/**
 * 根据工作台 tabId 反查进行中任务的 roundId。
 * @param {number} tabId
 * @returns {string|undefined}
 */
export function getRoundIdByWorkTabId(tabId) {
  if (typeof tabId !== 'number' || tabId <= 0) return undefined;
  return inFlightByTabId.get(tabId);
}

/**
 * Gemini 整图写剪贴板成功后，由 Gemini 页 CS 将字节回传到「发起命令」的 PicPuck 标签页。
 * key: roundId；value: 发起扩展命令的 tabId（localhost 熔炉页）。
 */
/** @type {Map<string, number>} */
export const geminiRelayCallerTabByRoundId = new Map();

/**
 * 即梦多图经剪贴板收集后，由 SW 回传到发起 `jimengGenerateImage` 的熔炉标签页（与 Gemini 映射同生命周期约定）。
 * @type {Map<string, number>}
 */
export const jimengRelayCallerTabByRoundId = new Map();
