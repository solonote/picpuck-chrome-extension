/**
 * 异步找回静默路径：不调用 `windows.update({ focused: true })`。
 * 许多站点依赖「窗口内曾变为 active」才挂载业务 DOM；为减轻轮询时标签栏抢镜：
 * - 工作 Tab **已是**当前标签 → 直接返回（避免每轮无意义 `tabs.update`）。
 * - 否则 → 短暂 `active: true` 再**还原**此前窗口内的当前标签（若用户在此期间已切走则不再还原）。
 *
 * 调用约定（与 `recoverAllocateSilentDefault` / `isAsyncRecoverProbeCommand` / `getRecoverCheckFocusWorkTab` 配合）：
 * - `*_ASYNC_PROBE` / `*_ASYNC_RELAY` 在 `dispatchRound` 框架 step03 后按需调用。
 * - **新建 Tab**：须在 `allocateTab` 内 `waitForTabUrlPrefix` 完成后再经 `dispatchRound` 调用。
 *
 * 实际挂载点：`dispatchRound` 在 `frameworkStep03_ensurePageHelpers` 之后、`updatePhase(running)` 与业务 steps 之前。
 */

/**
 * 工作 Tab 被短暂置为 active 之后、还原用户原先标签之前等待的时长（ms）。0 最无感；约 16 接近一帧，给懒渲染/布局一点机会。可按体验调参。
 */
const RECOVER_SILENT_TAB_FLASH_MS = 16;

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * @param {number} tabId
 */
export async function applyRecoverSilentWorkTabSurface(tabId) {
  try {
    const target = await chrome.tabs.get(tabId);
    const wid = target.windowId;
    if (wid == null) return;

    if (target.active === true) {
      return;
    }

    const curList = await chrome.tabs.query({ windowId: wid, active: true });
    const prevId = curList[0]?.id;
    if (prevId == null || prevId === tabId) {
      await chrome.tabs.update(tabId, { active: true });
      return;
    }

    await chrome.tabs.update(tabId, { active: true });
    await delay(RECOVER_SILENT_TAB_FLASH_MS);

    const after = await chrome.tabs.query({ windowId: wid, active: true });
    const stillOnWork = after[0]?.id === tabId;
    if (stillOnWork) {
      await chrome.tabs.update(prevId, { active: true });
    }
  } catch (e) {
    console.warn('[PicPuck] applyRecoverSilentWorkTabSurface failed tab=%d', tabId, e);
  }
}
