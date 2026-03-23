/**
 * 等待 Tab 导航至 `complete` 且 URL 满足谓词（不含站点名；谓词由调用方传入）。
 *
 * @param {number} tabId
 * @param {number} timeoutMs
 * @param {(url: string) => boolean} isTargetUrl 仅对非空 url 调用
 * @param {string} [timeoutErrorMessage] 超时 Error.message，便于调用方区分业务场景
 * @returns {Promise<void>}
 */
export function waitForTabUrlWhen(tabId, timeoutMs, isTargetUrl, timeoutErrorMessage) {
  const timeoutMsg = timeoutErrorMessage || 'TAB_URL_WAIT_TIMEOUT';
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpd);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMsg));
    }, timeoutMs);

    const onUpd = (id, changeInfo, updatedTab) => {
      if (id !== tabId || changeInfo.status !== 'complete') return;
      const url = updatedTab?.url;
      if (!url || !isTargetUrl(url)) return;
      cleanup();
      resolve();
    };

    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete' && tab.url && isTargetUrl(tab.url)) {
        cleanup();
        resolve();
      }
    });
  });
}
