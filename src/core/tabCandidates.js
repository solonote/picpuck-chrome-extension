/**
 * §9.2：全量 Tab 列表 → 按 taskBaseUrl 过滤并稳定排序。
 * @param {chrome.tabs.Tab[]} tabs
 * @param {string} taskBaseUrl
 * @returns {chrome.tabs.Tab[]}
 */
export function filterAndSortCandidates(tabs, taskBaseUrl) {
  return tabs
    .filter((t) => typeof t.url === 'string')
    .filter((t) => t.url.startsWith('http://') || t.url.startsWith('https://'))
    .filter((t) => t.url.startsWith(taskBaseUrl))
    // 稳定顺序，保证「第一个 idle」可复现（§9.2）
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/** §8：同 taskBaseUrl 下候选 Tab 数上限 */
export const MAX_SAME_BASE_TABS = 16;
