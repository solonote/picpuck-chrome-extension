/**
 * `chrome.windows.get(id)` 偶发失败时，勿误判窗口已关闭（会误删 session 分组映射并重复建组）。
 * @param {number} windowId
 * @returns {Promise<boolean>}
 */
export async function chromeWindowIdStillExists(windowId) {
  if (typeof windowId !== 'number' || !Number.isFinite(windowId)) return false;
  try {
    await chrome.windows.get(windowId);
    return true;
  } catch {
    /* fall through */
  }
  try {
    const all = await chrome.windows.getAll({ populate: false });
    return all.some((w) => w.id === windowId);
  } catch {
    return false;
  }
}
