/**
 * 异步找回：检查阶段是否抢工作 Tab 焦点（与「取回就绪后 focus」分离）。
 */

/** `chrome.storage.sync`：`true` = 检查阶段也激活工作 Tab；未设或 `false` = 静默（含即梦 RECOVER 轮询） */
export const PICPUCK_STORAGE_RECOVER_CHECK_FOCUS_TAB = 'picpuckRecoverCheckFocusTab';

/**
 * @param {string} [command] `allocateTab` 传入的 CommandRecord.command
 * @returns {Promise<boolean>} `true` = 检查阶段也激活工作 Tab
 */
export async function getRecoverCheckFocusWorkTab(command) {
  try {
    const r = await chrome.storage.sync.get(PICPUCK_STORAGE_RECOVER_CHECK_FOCUS_TAB);
    return r[PICPUCK_STORAGE_RECOVER_CHECK_FOCUS_TAB] === true;
  } catch {
    return false;
  }
}
