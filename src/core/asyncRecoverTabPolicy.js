/**
 * 异步找回：检查阶段是否抢工作 Tab 焦点（默认不抢；与「取回就绪后 focus」分离）。
 */

/** `chrome.storage.sync`：`true` = 检查阶段也激活工作 Tab；未设或 `false` = 默认静默 */
export const PICPUCK_STORAGE_RECOVER_CHECK_FOCUS_TAB = 'picpuckRecoverCheckFocusTab';

/**
 * @returns {Promise<boolean>} `true` = 检查阶段也激活工作 Tab；`false` = 默认静默（新建后台 Tab、复用不抢焦点）
 */
export async function getRecoverCheckFocusWorkTab() {
  try {
    const r = await chrome.storage.sync.get(PICPUCK_STORAGE_RECOVER_CHECK_FOCUS_TAB);
    return r[PICPUCK_STORAGE_RECOVER_CHECK_FOCUS_TAB] === true;
  } catch {
    return false;
  }
}
