/**
 * §9.5：仅跟踪「尚未结束的 round」，供响应与 onRemoved 使用。
 * 禁止当作 Tab 池或 idle 表（R15、R14：idle 只看顶栏 DOM）。
 */

/** @typedef {{ roundId: string, tabId: number, clientRequestId: string, command: string, createdAt: number }} TaskTicket */

/** @type {Map<string, TaskTicket>} */
export const roundBinding = new Map();

/** @type {Map<number, string>} tabId -> roundId */
export const inFlightByTabId = new Map();

/**
 * Gemini 整图写剪贴板成功后，由 Gemini 页 CS 将字节回传到「发起命令」的 PicPuck 标签页。
 * key: roundId；value: 发起扩展命令的 tabId（localhost 熔炉页）。
 */
/** @type {Map<string, number>} */
export const geminiRelayCallerTabByRoundId = new Map();
