/**
 * 异步找回静默路径：将工作 Tab 设为所在窗口的当前标签，不调用 `windows.update({ focused: true })`。
 * 许多站点（如即梦）依赖「窗口内 active Tab」才挂载业务 DOM，与整窗是否被 OS 聚焦无关。
 *
 * 调用约定（与 `recoverAllocateSilentDefault` / `getRecoverCheckFocusWorkTab` 配合）：
 * - **新建 Tab**：须在 `allocateTab` 内 `waitForTabUrlPrefix`（首屏 complete）完成之后、且在本轮 `dispatchRound` 的框架 step03 之后再调用，避免在文档未就绪时抢 active。
 * - **已打开的 Tab**：每一轮 `masterDispatch` → `dispatchRound` 在执行业务「检查」步骤前调用一次，保证每次探查前窗口内当前标签仍是工作 Tab。
 *
 * 实际挂载点：`dispatchRound` 在 `frameworkStep03_ensurePageHelpers` 之后、`updatePhase(running)` 与业务 steps 之前。
 */

/**
 * @param {number} tabId
 */
export async function applyRecoverSilentWorkTabSurface(tabId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch (e) {
    console.warn('[PicPuck] applyRecoverSilentWorkTabSurface failed tab=%d', tabId, e);
  }
}
