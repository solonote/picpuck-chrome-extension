/**
 * 将 `RoundContext.phase` 与 `lastInfoMessage` 推到内容脚本，驱动顶栏三栏：左轮次、中等待/执行、右 Step 摘要。
 * 注意：`phase`（多状态）与根节点 `data-picpuck-exec-state`（仅 idle/running）语义不同。
 */
import { getContext } from './roundContext.js';
import { ROUND_PHASE } from './runtimeMessages.js';

/**
 * @param {number} tabId
 * @param {string} roundId
 */
export async function pushRoundPhaseUi(tabId, roundId) {
  const c = getContext(tabId);
  if (!c) return;
  const roundIdShort = roundId.length > 8 ? roundId.slice(0, 8) : roundId;
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: ROUND_PHASE,
      payload: {
        phase: c.phase,
        roundIdShort,
        lastInfoMessage: c.lastInfoMessage,
      },
    });
  } catch (e) {
    console.warn('[PicPuck] pushRoundPhaseUi failed tab=%d', tabId, e);
  }
}
