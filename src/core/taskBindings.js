/**
 * §9.5：仅跟踪「尚未结束的 round」，供响应与 onRemoved 使用。
 * 禁止当作 Tab 池或 idle 表（R15、R14：idle 只看顶栏 DOM）。
 */

/** @typedef {{ roundId: string, tabId: number, clientRequestId: string, command: string, createdAt: number }} TaskTicket */

/** @type {Map<string, TaskTicket>} */
export const roundBinding = new Map();

/** @type {Map<number, string>} tabId -> roundId */
export const inFlightByTabId = new Map();
