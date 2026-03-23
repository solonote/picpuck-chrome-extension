/**
 * Gemini 站点业务步骤（step01/step02 由 core/dispatchRound 框架固定执行）。
 */
import { appendLog } from '../../core/roundContext.js';

/** 占位：待接 Gemini 页面 */
export async function step03_gemini_fill_placeholder(ctx) {
  const { tabId, roundId } = ctx;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {},
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step03_gemini_fill_placeholder',
    level: 'info',
    message: 'Step03.进入步骤',
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step03_gemini_fill_placeholder',
    level: 'info',
    message: 'Step03.占位步骤+尚未对接Gemini页面表单',
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step03_gemini_fill_placeholder',
    level: 'info',
    message: 'Step03.完成步骤',
  });
}
