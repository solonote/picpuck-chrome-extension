import { clearRoundLogs } from '../../core/clearRoundLogs.js';
import { appendLog } from '../../core/roundContext.js';
import { attachLogSink } from '../../core/logSink.js';

export async function step01_clear_round_logs(ctx) {
  const { tabId, roundId } = ctx;
  // §5.1：先 clear 再写 step01 进入/完成
  clearRoundLogs(tabId);
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step01_clear_round_logs',
    level: 'info',
    message: 'Step01.进入步骤',
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step01_clear_round_logs',
    level: 'info',
    message: 'Step01.完成步骤',
  });
}

export async function step02_attach_log_sink(ctx) {
  const { tabId, roundId } = ctx;
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step02_attach_log_sink',
    level: 'info',
    message: 'Step02.进入步骤',
  });
  attachLogSink(tabId, roundId);
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step02_attach_log_sink',
    level: 'info',
    message: 'Step02.完成步骤',
  });
}

/** 占位：同 jimeng step03，待接 Gemini 页面 */
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
