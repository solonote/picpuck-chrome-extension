/**
 * 框架固定前序：`dispatchRound` 在执行业务 `CommandRecord.steps` 之前始终运行本模块两步。
 * 站点 Agent 不得在 `register.js` 中重复注册 step01/step02。
 */
import { clearRoundLogs } from './clearRoundLogs.js';
import { appendLog } from './roundContext.js';
import { attachLogSink } from './logSink.js';

/**
 * @param {{ tabId: number, roundId: string }} ctx
 */
export async function frameworkStep01_clearRoundLogs(ctx) {
  const { tabId, roundId } = ctx;
  // 先清空缓冲区，再写 step01 的进入/完成（避免被 clear 抹掉）
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

/**
 * @param {{ tabId: number, roundId: string }} ctx
 */
export async function frameworkStep02_attachLogSink(ctx) {
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
