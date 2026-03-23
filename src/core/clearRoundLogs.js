/**
 * §12.2：站点 step01 仅委托此 API；清空 logs、lastInfoMessage 并将 phase 置 clearing（实现见 roundContext.clearLogs）。
 */
import { clearLogs } from './roundContext.js';

/**
 * @param {number} tabId
 */
export function clearRoundLogs(tabId) {
  clearLogs(tabId);
}
