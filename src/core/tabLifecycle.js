/**
 * §9.6：Tab 关闭时摘掉 inFlight / roundBinding，避免内存悬挂。
 * TODO：若当时仍有未决的 PicPuck `sendResponse`，应补发 TAB_CLOSED（与 §10 对齐）。
 */
import { inFlightByTabId, roundBinding } from './taskBindings.js';

export function installTabRemovedHandler() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    const roundId = inFlightByTabId.get(tabId);
    if (roundId == null) return;
    inFlightByTabId.delete(tabId);
    roundBinding.delete(roundId);
    console.warn('[PicPuck] tabs.onRemoved cleared in-flight tab=%d round=%s', tabId, roundId);
  });
}
