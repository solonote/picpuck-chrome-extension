/**
 * §5.0 masterDispatch：roundId → allocateTab（打开或复用工作 Tab，与具体 Task 步骤无关）→ 票据与 inFlight → dispatchRound。
 */
import { allocateTab } from './allocateTab.js';
import { registerAsyncJobWorkTab } from './taskBindings.js';
import { dispatchRound } from './dispatchRound.js';
import { registerAsyncRecoverWatchLoop } from './asyncWatchLoopRegistry.js';
import { detachLogSink } from './logSink.js';
import { releaseExecSlot } from './releaseExecSlot.js';
import { inFlightByTabId, roundBinding } from './taskBindings.js';
import { registerRelayCallerTabForRound } from './relayCallerTabTTL.js';

/** 需在熔炉 caller Tab 登记 TTL 的指令（多图/整图分片回传依赖 roundId → callerTabId） */
const RELAY_CALLER_TAB_COMMANDS = new Set([
  'GEMINI_IMAGE_FILL',
  'GEMINI_ASYNC_LAUNCH',
  'GEMINI_ASYNC_PROBE',
  'GEMINI_ASYNC_RELAY',
  'JIMENG_IMAGE_FILL',
  'JIMENG_ASYNC_LAUNCH',
  'JIMENG_ASYNC_PROBE',
  'JIMENG_ASYNC_RELAY',
]);

/** 成功 allocate 后把 `async_job_id → tabId` 写入登记，供后续 PROBE/RELAY 等不再盲扫池子 */
const ASYNC_JOB_WORK_TAB_REGISTER_COMMANDS = new Set([
  'GEMINI_ASYNC_LAUNCH',
  'GEMINI_ASYNC_PROBE',
  'GEMINI_ASYNC_RELAY',
  'JIMENG_ASYNC_LAUNCH',
  'JIMENG_ASYNC_PROBE',
  'JIMENG_ASYNC_RELAY',
]);

/**
 * @param {string} clientRequestId
 * @param {string} command CommandRecord.command
 * @param {Record<string, unknown>} payload
 * @param {number} [callerTabId]
 * @param {{ reuseWorkTabId?: number }} [options] `reuseWorkTabId`：异步 PROBE 成功后 RELAY 强制复用同一工作 Tab，避免再 allocate 出新页
 * @returns {Promise<{ ok: boolean, roundId: string, tabId: number, phase: string, errorCode?: string, probeOutcome?: string }>}
 */
export async function masterDispatch(clientRequestId, command, payload, callerTabId, options) {
  const roundId = crypto.randomUUID();
  const reuse =
    options && typeof options.reuseWorkTabId === 'number' && Number.isFinite(options.reuseWorkTabId)
      ? Math.floor(options.reuseWorkTabId)
      : undefined;
  // 工作 Tab：按 CommandRecord.homeUrl/taskBaseUrl 全量 query 后筛选并抢占或新建（core/allocateTab）
  const alloc = await allocateTab(command, {
    reuseWorkTabId: reuse,
    asyncJobId: typeof payload?.async_job_id === 'string' ? payload.async_job_id : undefined,
  });
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
  if (ASYNC_JOB_WORK_TAB_REGISTER_COMMANDS.has(command) && typeof payload?.async_job_id === 'string') {
    void registerAsyncJobWorkTab(payload.async_job_id, tabId);
  }
  // §5.0：仅在有 tabId 之后写入票据；顺序在 allocateTab 成功之后、dispatchRound 之前（§9.5）
  roundBinding.set(roundId, {
    roundId,
    tabId,
    clientRequestId,
    command,
    createdAt: Date.now(),
  });
  inFlightByTabId.set(tabId, roundId);

  if (RELAY_CALLER_TAB_COMMANDS.has(command) && callerTabId != null && callerTabId > 0) {
    registerRelayCallerTabForRound(roundId, callerTabId);
  }

  try {
    const dr = await dispatchRound({ clientRequestId, command, tabId, roundId, payload });
    if (dr.phase === 'success' && dr.asyncRecoverWatchLoopRegistration) {
      registerAsyncRecoverWatchLoop(dr.asyncRecoverWatchLoopRegistration);
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
