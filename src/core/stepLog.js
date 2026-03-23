/**
 * 步骤日志：统一 StepNN. 前缀与 appendLog 字段，供 framework 与各 agent 复用。
 */
import { appendLog } from './roundContext.js';

/**
 * @param {number} nn 步骤号（1–99），格式化为两位
 */
function padStep(nn) {
  return String(nn).padStart(2, '0');
}

/**
 * @param {number} tabId
 * @param {string} roundId
 * @param {string} stepKey 日志 step 字段，如 step04_jimeng_require_logged_in
 * @param {number} nn
 */
export function logStepEnter(tabId, roundId, stepKey, nn) {
  const p = padStep(nn);
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: stepKey,
    level: 'info',
    message: `Step${p}.进入步骤`,
  });
}

/**
 * @param {number} tabId
 * @param {string} roundId
 * @param {string} stepKey
 * @param {number} nn
 */
export function logStepDone(tabId, roundId, stepKey, nn) {
  const p = padStep(nn);
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: stepKey,
    level: 'info',
    message: `Step${p}.完成步骤`,
  });
}

/**
 * @param {number} tabId
 * @param {string} roundId
 * @param {string} stepKey
 * @param {number} nn
 * @param {string} rest `StepNN.` 之后正文，如 `已在即梦工作台页执行滚顶`
 */
export function logStepInfo(tabId, roundId, stepKey, nn, rest) {
  const p = padStep(nn);
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: stepKey,
    level: 'info',
    message: `Step${p}.${rest}`,
  });
}

/**
 * @param {number} tabId
 * @param {string} roundId
 * @param {string} stepKey
 * @param {number} nn
 * @param {string} rest `StepNN.debug.` 之后正文
 */
export function logStepDebug(tabId, roundId, stepKey, nn, rest) {
  const p = padStep(nn);
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: stepKey,
    level: 'debug',
    message: `Step${p}.debug.${rest}`,
  });
}

/**
 * 业务可见失败 info + 可选 debug（技术摘要）。
 * @param {number} tabId
 * @param {string} roundId
 * @param {string} stepKey
 * @param {number} nn
 * @param {string} infoRest 如 `动作失败+未登录…`
 * @param {string} [debugRest] 不传则只写 info
 */
export function logStepFail(tabId, roundId, stepKey, nn, infoRest, debugRest) {
  logStepInfo(tabId, roundId, stepKey, nn, infoRest);
  if (debugRest != null && debugRest !== '') {
    logStepDebug(tabId, roundId, stepKey, nn, debugRest);
  }
}
