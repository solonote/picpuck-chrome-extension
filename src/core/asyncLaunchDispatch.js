/**
 * DISPATCH 确认后：Token 门禁 + `masterDispatch` 跑「启动阶段」站点步骤（设计 **11** §D、**14** §B）。
 */
import { masterDispatch } from './masterDispatch.js';
import { getCommandRecord } from './registry.js';
import { pendingPreSlot, setPendingPreSlot } from './asyncGenerationState.js';
import { ensureMcupExtensionAccessTokenOrThrow } from './extensionAccessTokenLifecycle.js';
/**
 * 仅填词：不登记后端 RUNNING、无 `async_job_id`；不跑找回阶段。
 * @param {number} callerTabId 熔炉页 tabId
 * @param {Record<string, unknown>} mergedPayload PRE 合并字段（须含 `fillOnly: true`）
 */
export async function dispatchAsyncGenerationFillOnly(callerTabId, mergedPayload) {
  await ensureMcupExtensionAccessTokenOrThrow();
  const pending = mergedPayload && typeof mergedPayload === 'object' ? mergedPayload : {};
  const core = String(pending.core_engine || '').trim();
  let command = '';
  if (core.startsWith('jimeng_agent')) command = 'JIMENG_ASYNC_LAUNCH';
  else if (core.startsWith('gemini_agent')) command = 'GEMINI_ASYNC_LAUNCH';
  else throw new Error('ASYNC_BAD_CORE_ENGINE');
  const rec = getCommandRecord(command);
  if (!rec || !Array.isArray(rec.steps)) throw new Error('ASYNC_NO_COMMAND_RECORD');

  /** @type {Record<string, unknown>} */
  const payload = { ...pending };
  delete payload.type;
  delete payload.action;
  delete payload.picpuckAsyncPhase;
  delete payload.async_job_id;
  if (typeof payload.prompt !== 'string' && typeof payload.input_prompt === 'string') {
    payload.prompt = payload.input_prompt;
  }
  if (command === 'JIMENG_ASYNC_LAUNCH' && payload.jimengSubmitMode == null) {
    payload.jimengSubmitMode = 'enter';
  }

  const clientRequestId = crypto.randomUUID();
  return masterDispatch(clientRequestId, command, payload, callerTabId);
}

/**
 * @param {number} callerTabId 熔炉页 tabId
 * @param {string} asyncJobId 12 位
 */
export async function dispatchAsyncGenerationLaunch(callerTabId, asyncJobId) {
  await ensureMcupExtensionAccessTokenOrThrow();
  const pending = pendingPreSlot;
  if (!pending || typeof pending !== 'object') {
    throw new Error('ASYNC_NO_PENDING_PRE');
  }
  const core = String(pending.core_engine || '').trim();
  let command = '';
  if (core.startsWith('jimeng_agent')) command = 'JIMENG_ASYNC_LAUNCH';
  else if (core.startsWith('gemini_agent')) command = 'GEMINI_ASYNC_LAUNCH';
  else throw new Error('ASYNC_BAD_CORE_ENGINE');
  const rec = getCommandRecord(command);
  if (!rec || !Array.isArray(rec.steps)) throw new Error('ASYNC_NO_COMMAND_RECORD');

  /** @type {Record<string, unknown>} */
  const payload = { ...pending };
  delete payload.type;
  delete payload.action;
  delete payload.picpuckAsyncPhase;
  if (typeof payload.prompt !== 'string' && typeof payload.input_prompt === 'string') {
    payload.prompt = payload.input_prompt;
  }
  payload.async_job_id = asyncJobId;
  if (command === 'JIMENG_ASYNC_LAUNCH' && payload.jimengSubmitMode == null) {
    payload.jimengSubmitMode = 'enter';
  }

  const clientRequestId = crypto.randomUUID();
  setPendingPreSlot(null);

  return masterDispatch(clientRequestId, command, payload, callerTabId);
}
