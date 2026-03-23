/**
 * 即梦站点业务步骤（step01～step03 由 core/dispatchRound 框架固定执行）。
 */
import { appendLog } from '../../core/roundContext.js';

/**
 * 占位步骤：后续替换为真实 DOM 操作并遵守 §3.3 日志。
 */
export async function step04_jimeng_fill_placeholder(ctx) {
  const { tabId, roundId } = ctx;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      /* 占位：后续在此访问即梦 DOM */
    },
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step04_jimeng_fill_placeholder',
    level: 'info',
    message: 'Step04.进入步骤',
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step04_jimeng_fill_placeholder',
    level: 'info',
    message: 'Step04.占位步骤+尚未对接即梦页面表单',
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step04_jimeng_fill_placeholder',
    level: 'info',
    message: 'Step04.完成步骤',
  });
}
