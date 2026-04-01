/**
 * DISPATCH / FILL_DISPATCH 后：Token 门禁 + `masterDispatch` 跑启动阶段（设计 **11** §A、**14** 批次 3）。
 */
import { masterDispatch } from './masterDispatch.js';
import { getCommandRecord } from './registry.js';
import { pendingPreSlot, setPendingPreSlot } from './asyncGenerationState.js';
import { ensureMcupExtensionAccessTokenOrThrow } from './extensionAccessTokenLifecycle.js';
import { resolveProfileByCoreEngine } from './asyncEngineProfiles.js';

/**
 * @param {{ pending: Record<string, unknown>, fillOnly: boolean, asyncJobId?: string }} args
 * @returns {{ command: string, payload: Record<string, unknown> }}
 */
function selectLaunchCommandAndPayload({ pending, fillOnly, asyncJobId }) {
  const core = String(pending.core_engine || '').trim();
  const profile = resolveProfileByCoreEngine(core);
  const command = profile.launchCommand;
  const rec = getCommandRecord(command);
  if (!rec || !Array.isArray(rec.steps)) throw new Error('ASYNC_NO_COMMAND_RECORD');

  /** @type {Record<string, unknown>} */
  const payload = { ...pending };
  delete payload.type;
  delete payload.action;
  delete payload.picpuckAsyncPhase;
  if (fillOnly) {
    delete payload.async_job_id;
  } else if (asyncJobId != null && String(asyncJobId).trim() !== '') {
    payload.async_job_id = String(asyncJobId).trim().toLowerCase();
  }

  if (typeof payload.prompt !== 'string' && typeof payload.input_prompt === 'string') {
    payload.prompt = payload.input_prompt;
  }

  if (profile.defaultSubmitModeForLaunch != null && payload.jimengSubmitMode == null) {
    payload.jimengSubmitMode = profile.defaultSubmitModeForLaunch;
  }

  return { command, payload };
}

/**
 * 仅填词：不登记后端 RUNNING、无 `async_job_id`；不跑找回阶段。
 * @param {number} callerTabId 熔炉页 tabId
 * @param {Record<string, unknown>} mergedPayload PRE 合并字段（须含 `fillOnly: true`）
 */
export async function dispatchAsyncGenerationFillOnly(callerTabId, mergedPayload) {
  console.info('[PicPuck SW] FILL_DISPATCH → Token → masterDispatch', { callerTabId });
  await ensureMcupExtensionAccessTokenOrThrow();
  const pending = mergedPayload && typeof mergedPayload === 'object' ? mergedPayload : {};
  const { command, payload } = selectLaunchCommandAndPayload({ pending, fillOnly: true });
  const clientRequestId = crypto.randomUUID();
  return masterDispatch(clientRequestId, command, payload, callerTabId);
}

/**
 * @param {number} callerTabId 熔炉页 tabId
 * @param {string} asyncJobId 12 位
 */
export async function dispatchAsyncGenerationLaunch(callerTabId, asyncJobId) {
  console.info('[PicPuck SW] DISPATCH → Token → masterDispatch', { callerTabId, asyncJobId });
  await ensureMcupExtensionAccessTokenOrThrow();
  const pending = pendingPreSlot;
  if (!pending || typeof pending !== 'object') {
    throw new Error('ASYNC_NO_PENDING_PRE');
  }
  const { command, payload } = selectLaunchCommandAndPayload({
    pending,
    fillOnly: false,
    asyncJobId,
  });
  setPendingPreSlot(null);
  const clientRequestId = crypto.randomUUID();
  return masterDispatch(clientRequestId, command, payload, callerTabId);
}
