/**
 * SW 侧将目标 Tab 顶栏执行槽置 idle（§11 releaseExecSlot）。
 */
import { injectableReleaseExecSlot } from './execSlot/injectableReleaseExecSlot.js';

/**
 * @param {number} tabId
 */
export async function releaseExecSlot(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: injectableReleaseExecSlot,
      world: 'MAIN',
    });
  } catch (e) {
    // Tab 已关或无法注入时按 §5.1 允许忽略
    console.warn('[PicPuck] releaseExecSlot ignored tab=%d', tabId, e);
  }
}
