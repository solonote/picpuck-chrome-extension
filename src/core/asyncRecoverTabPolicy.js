/**
 * 异步找回：检查阶段是否抢工作 Tab 焦点（与「取回就绪后 focus」分离）。
 * 未开本开关时，静默路径由 `dispatchRound` 在 step03 后调用 `applyRecoverSilentWorkTabSurface`（仅窗口内 active，不聚焦窗口）。
 */

/** `chrome.storage.sync`：`true` = 检查阶段在 `allocateTab` 走完整 `focusWorkTab`；未设或 `false` = 静默 + 上述 `applyRecoverSilentWorkTabSurface` */
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
