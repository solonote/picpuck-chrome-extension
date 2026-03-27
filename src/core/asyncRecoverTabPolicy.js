/**
 * 异步找回：检查阶段是否抢工作 Tab 焦点（与「取回就绪后 focus」分离）。
 * 未开本开关时，静默路径由 `dispatchRound` 在 step03 后调用 `applyRecoverSilentWorkTabSurface`（不 `windows.update(focused)`；必要时短暂 active 再还原标签，见 `recoverSilentWorkTab.js`）。
 */

/** `chrome.storage.sync`：`true` = **仅 RELAY** 在 `allocateTab` 走完整 `focusWorkTab`；PROBE 恒静默（见 `isAsyncRecoverProbeCommand`）。 */
export const PICPUCK_STORAGE_RECOVER_CHECK_FOCUS_TAB = 'picpuckRecoverCheckFocusTab';

/**
 * 异步找回「状态检测」轮（`*_ASYNC_PROBE`）：allocate 与 dispatchRound 均不抢整窗焦点；取回在 RELAY 步骤内显式 `focusWorkTab`。
 * @param {string} [command]
 * @returns {boolean}
 */
export function isAsyncRecoverProbeCommand(command) {
  return typeof command === 'string' && command.endsWith('_ASYNC_PROBE');
}

/**
 * @param {string} [command] `allocateTab` 传入的 CommandRecord.command（预留）
 * @returns {Promise<boolean>} `true` = RELAY allocate 时聚焦工作 Tab 所在窗口
 */
export async function getRecoverCheckFocusWorkTab(command) {
  try {
    const r = await chrome.storage.sync.get(PICPUCK_STORAGE_RECOVER_CHECK_FOCUS_TAB);
    return r[PICPUCK_STORAGE_RECOVER_CHECK_FOCUS_TAB] === true;
  } catch {
    return false;
  }
}
