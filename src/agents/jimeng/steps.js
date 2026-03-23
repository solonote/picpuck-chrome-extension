/**
 * 即梦站点步骤：step01/02 薄封装 core；step03+ 可含本站逻辑（R18）。
 */
import { clearRoundLogs } from '../../core/clearRoundLogs.js';
import { appendLog } from '../../core/roundContext.js';
import { attachLogSink } from '../../core/logSink.js';

export async function step01_clear_round_logs(ctx) {
  const { tabId, roundId } = ctx;
  // §5.1：先清空缓冲区，再写 step01 的进入/完成（避免被 clear 抹掉）
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

/**
 * 占位步骤：满足「业务步骤在 MAIN 注入一次」的验收；后续替换为真实 DOM 操作并遵守 §3.3 日志。
 */
export async function step03_jimeng_fill_placeholder(ctx) {
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
    step: 'step03_jimeng_fill_placeholder',
    level: 'info',
    message: 'Step03.进入步骤',
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step03_jimeng_fill_placeholder',
    level: 'info',
    message: 'Step03.占位步骤+尚未对接即梦页面表单',
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step03_jimeng_fill_placeholder',
    level: 'info',
    message: 'Step03.完成步骤',
  });
}
