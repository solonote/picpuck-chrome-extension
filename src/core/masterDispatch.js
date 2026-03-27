/**
 * §5.0 masterDispatch：roundId → allocateTab（打开或复用工作 Tab，与具体 Task 步骤无关）→ 票据与 inFlight → dispatchRound。
 */
import { allocateTab } from './allocateTab.js';
import { dispatchRound } from './dispatchRound.js';
import { registerWatchLoopAfterJimengLaunch } from './asyncWatchLoopRegistry.js';
import { detachLogSink } from './logSink.js';
import { releaseExecSlot } from './releaseExecSlot.js';
import { inFlightByTabId, roundBinding } from './taskBindings.js';
import { registerGeminiRelayCallerTab, registerJimengRelayCallerTab } from './relayCallerTabTTL.js';

/**
 * @param {string} clientRequestId
 * @param {string} command CommandRecord.command
 * @param {Record<string, unknown>} payload
 * @returns {Promise<{ ok: boolean, roundId: string, tabId: number, phase: string, errorCode?: string, probeOutcome?: string }>}
 */
export async function masterDispatch(clientRequestId, command, payload, callerTabId) {
  const roundId = crypto.randomUUID();
  // 工作 Tab：按 CommandRecord.homeUrl/taskBaseUrl 全量 query 后筛选并抢占或新建（core/allocateTab）
  const alloc = await allocateTab(command);
  if (!alloc.ok) {
    return {
      ok: false,
      roundId,
      // §10：失败时尚未分配 Tab；用 0 表示「无 tab」，供页面区分
      tabId: 0,
      phase: 'error',
      errorCode: alloc.errorCode,
    };
  }
  const tabId = alloc.tabId;
  // §5.0：仅在有 tabId 之后写入票据；顺序在 allocateTab 成功之后、dispatchRound 之前（§9.5）
  roundBinding.set(roundId, {
    roundId,
    tabId,
    clientRequestId,
    command,
    createdAt: Date.now(),
  });
  inFlightByTabId.set(tabId, roundId);

  if (command === 'GEMINI_IMAGE_FILL' && callerTabId != null && callerTabId > 0) {
    registerGeminiRelayCallerTab(roundId, callerTabId);
  }
  if (
    (command === 'JIMENG_IMAGE_FILL' ||
      command === 'JIMENG_ASYNC_LAUNCH' ||
      command === 'JIMENG_ASYNC_PROBE' ||
      command === 'JIMENG_ASYNC_RELAY') &&
    callerTabId != null &&
    callerTabId > 0
  ) {
    registerJimengRelayCallerTab(roundId, callerTabId);
  }

  try {
    const dr = await dispatchRound({ clientRequestId, command, tabId, roundId, payload });
    if (dr.phase === 'success' && dr.jimengWatchLoopRegister) {
      registerWatchLoopAfterJimengLaunch(dr.jimengWatchLoopRegister);
    }
    return {
      ok: dr.phase === 'success',
      roundId,
      tabId,
      phase: dr.phase,
      errorCode: dr.phase === 'success' ? undefined : 'ROUND_FAILED',
      ...(dr.probeOutcome ? { probeOutcome: dr.probeOutcome } : {}),
    };
  } catch (e) {
    // dispatchRound 正常路径不应抛错；此处兜底防止票据与执行槽泄漏（§5.0 INTERNAL_TAB_STATE_ERROR 语义）
    console.error('[PicPuck] dispatchRound threw', e);
    detachLogSink(tabId);
    await releaseExecSlot(tabId);
    inFlightByTabId.delete(tabId);
    roundBinding.delete(roundId);
    return {
      ok: false,
      roundId,
      tabId,
      phase: 'error',
      errorCode: 'INTERNAL_TAB_STATE_ERROR',
    };
  }
}
