/**
 * §12.2：框架 step01（frameworkPreflight）调用；清空 logs、lastInfoMessage 并将 phase 置 clearing（实现见 roundContext.clearLogs）。
 */
import { clearLogs } from './roundContext.js';
import { clearRoundLogsSnapshot } from './roundLogSnapshot.js';

/**
 * @param {number} tabId
 */
export function clearRoundLogs(tabId) {
  clearLogs(tabId);
  clearRoundLogsSnapshot(tabId);
}
