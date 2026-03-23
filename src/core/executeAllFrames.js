/**
 * 在 Tab 全部 frame 执行 MAIN 函数，返回各 frame 的 result 数组（顺序由引擎决定）。
 *
 * @param {number} tabId
 * @param {() => unknown} func 须可序列化注入；无闭包捕获 SW 状态
 * @returns {Promise<unknown[]>}
 */
export async function executeInAllFrames(tabId, func) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func,
  });
  if (!Array.isArray(results)) return [];
  return results.map((r) => (r && 'result' in r ? r.result : undefined));
}
