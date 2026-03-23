/**
 * §5.1 dispatchRound：串行步骤、异常收尾、Step99、releaseExecSlot、映射清理。
 */
import { getCommandRecord } from './registry.js';
import { getOrCreateRoundContext, appendLog, updatePhase, getContext } from './roundContext.js';
import { releaseExecSlot } from './releaseExecSlot.js';
import { inFlightByTabId, roundBinding } from './taskBindings.js';
import { detachLogSink } from './logSink.js';
import { pushRoundPhaseUi } from './phaseUi.js';

/**
 * @param {{ clientRequestId: string, command: string, tabId: number, roundId: string, payload: Record<string, unknown> }} args
 * @returns {Promise<{ phase: string }>}
 */
export async function dispatchRound(args) {
  const { clientRequestId, command, tabId, roundId, payload } = args;
  const rec = getCommandRecord(command);
  // step01/step02 为强制前两项（§3.1、§5.1）
  if (!rec || !Array.isArray(rec.steps) || rec.steps.length < 2) {
    await releaseExecSlot(tabId);
    inFlightByTabId.delete(tabId);
    roundBinding.delete(roundId);
    detachLogSink(tabId);
    return { phase: 'error' };
  }

  const ctx = { tabId, roundId, command, clientRequestId, payload };

  const c = getOrCreateRoundContext(tabId);
  c.roundId = roundId;
  c.command = command;
  c.startedAt = Date.now();

  try {
    updatePhase(tabId, 'received');
    await pushRoundPhaseUi(tabId, roundId);

    await rec.steps[0](ctx); // step01_clear_round_logs
    await rec.steps[1](ctx); // step02_attach_log_sink

    // §5.1：step02 完成后再置 running，直至终止态
    updatePhase(tabId, 'running');
    await pushRoundPhaseUi(tabId, roundId);

    // §5.1：业务步骤从下标 2 起
    for (let i = 2; i < rec.steps.length; i += 1) {
      const fn = rec.steps[i];
      if (typeof fn !== 'function') throw new Error(`step ${i} missing`);
      const r = await fn(ctx);
      if (r && r.ok === false) {
        throw Object.assign(new Error('STEP_OK_FALSE'), { stepResult: r });
      }
    }

    appendLog(tabId, {
      ts: Date.now(),
      roundId,
      step: 'system',
      level: 'info',
      message: 'Step99.本轮结束+成功',
    });
    updatePhase(tabId, 'success');
    await pushRoundPhaseUi(tabId, roundId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    appendLog(tabId, {
      ts: Date.now(),
      roundId,
      step: 'system',
      level: 'info',
      message: 'Step99.本轮结束+失败',
    });
    appendLog(tabId, {
      ts: Date.now(),
      roundId,
      step: 'system',
      level: 'debug',
      message: 'Step99.debug.' + msg.slice(0, 500),
    });
    updatePhase(tabId, 'error');
    await pushRoundPhaseUi(tabId, roundId);
  } finally {
    // §5.1 第 4 步：无论成功失败，释放顶栏执行槽并清理进行中映射（与 PicPuck 响应在 masterDispatch 侧同回合结束）
    await releaseExecSlot(tabId);
    inFlightByTabId.delete(tabId);
    roundBinding.delete(roundId);
    detachLogSink(tabId);
  }

  return { phase: getContext(tabId)?.phase ?? 'error' };
}
