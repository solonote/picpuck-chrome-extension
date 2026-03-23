/**
 * §5.1 dispatchRound：串行步骤、异常收尾、Step99、releaseExecSlot、映射清理。
 */
import { getCommandRecord } from './registry.js';
import { getOrCreateRoundContext, appendLog, updatePhase, getContext } from './roundContext.js';
import { releaseExecSlot } from './releaseExecSlot.js';
import { inFlightByTabId, roundBinding } from './taskBindings.js';
import { detachLogSink } from './logSink.js';
import { persistRoundLogsSnapshot } from './roundLogSnapshot.js';
import { pushRoundPhaseUi } from './phaseUi.js';
import {
  frameworkStep01_clearRoundLogs,
  frameworkStep02_attachLogSink,
  frameworkStep03_ensurePageHelpers,
} from './frameworkPreflight.js';

/**
 * @param {{ clientRequestId: string, command: string, tabId: number, roundId: string, payload: Record<string, unknown> }} args
 * @returns {Promise<{ phase: string }>}
 */
export async function dispatchRound(args) {
  const { clientRequestId, command, tabId, roundId, payload } = args;
  const rec = getCommandRecord(command);
  // step01～step03 由 core 框架统一执行；steps 仅含站点业务步骤（§5.1）
  if (!rec || !Array.isArray(rec.steps)) {
    await releaseExecSlot(tabId);
    inFlightByTabId.delete(tabId);
    roundBinding.delete(roundId);
    detachLogSink(tabId);
    return { phase: 'error' };
  }

  /**
   * Gemini：`step07_gemini_apply_effective_prompt_on_context` 写入 `effectivePrompt`，
   * `step09_gemini_fill_input_and_paste_images` 读取（设计 §5.1 / §11.1）。
   * @type {{ tabId: number, roundId: string, command: string, clientRequestId: string, payload: Record<string, unknown>, effectivePrompt?: string }}
   */
  const ctx = {
    tabId,
    roundId,
    command,
    clientRequestId,
    payload,
    effectivePrompt: undefined,
  };

  const c = getOrCreateRoundContext(tabId);
  c.roundId = roundId;
  c.command = command;
  c.startedAt = Date.now();

  try {
    updatePhase(tabId, 'received');
    await pushRoundPhaseUi(tabId, roundId);

    await frameworkStep01_clearRoundLogs(ctx);
    await frameworkStep02_attachLogSink(ctx);
    await frameworkStep03_ensurePageHelpers(ctx);

    // §5.1：框架前序完成后再置 running，直至终止态
    updatePhase(tabId, 'running');
    await pushRoundPhaseUi(tabId, roundId);

    for (let i = 0; i < rec.steps.length; i += 1) {
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
    // worker 休眠后内存日志会丢；快照供顶栏三连击复制仍可取上一轮日志
    try {
      await persistRoundLogsSnapshot(tabId);
    } catch (e) {
      console.warn('[PicPuck] persistRoundLogsSnapshot in finally tab=%d', tabId, e);
    }
    // §5.1 第 4 步：无论成功失败，释放顶栏执行槽并清理进行中映射（与 PicPuck 响应在 masterDispatch 侧同回合结束）
    await releaseExecSlot(tabId);
    inFlightByTabId.delete(tabId);
    roundBinding.delete(roundId);
    detachLogSink(tabId);
  }

  return { phase: getContext(tabId)?.phase ?? 'error' };
}
