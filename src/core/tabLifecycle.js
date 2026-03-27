/**
 * §9.6：Tab 关闭时摘掉 inFlight / roundBinding，并清 `async_job_id → 该 Tab` 的 Core 登记（见 `taskBindings` 头注释）。
 * TODO：若当时仍有未决的 PicPuck `sendResponse`，应补发 TAB_CLOSED（与 §10 对齐）。
 */
import {
  clearAsyncJobWorkTabsForClosedTab,
  inFlightByTabId,
  roundBinding,
} from './taskBindings.js';

export function installTabRemovedHandler() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void clearAsyncJobWorkTabsForClosedTab(tabId).catch(() => {});
    const roundId = inFlightByTabId.get(tabId);
    if (roundId == null) return;
    inFlightByTabId.delete(tabId);
    roundBinding.delete(roundId);
    console.warn('[PicPuck] tabs.onRemoved cleared in-flight tab=%d round=%s', tabId, roundId);
  });
}
