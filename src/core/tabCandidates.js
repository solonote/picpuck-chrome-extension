/**
 * §9.2：全量 Tab 列表 → 按站点 homeUrl 前缀过滤并稳定排序。
 * @param {chrome.tabs.Tab[]} tabs
 * @param {string} homeUrl 站点 URL 前缀，与 CommandRecord.homeUrl 一致
 * @returns {chrome.tabs.Tab[]}
 */
export function filterAndSortCandidates(tabs, homeUrl) {
  return tabs
    .filter((t) => typeof t.url === 'string')
    .filter((t) => t.url.startsWith('http://') || t.url.startsWith('https://'))
    .filter((t) => t.url.startsWith(homeUrl))
    // 稳定顺序，保证「第一个 idle」可复现（§9.2）
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}

/** §8：同站点 homeUrl 前缀下候选 Tab 数上限 */
export const MAX_SAME_BASE_TABS = 16;
