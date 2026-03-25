/**
 * 启动阶段成功后串联「找回」轮次（设计 **02** 第二阶段、**14**）。
 */
import { masterDispatch } from './masterDispatch.js';
import { getCommandRecord } from './registry.js';
import { ensureMcupExtensionAccessTokenOrThrow } from './extensionAccessTokenLifecycle.js';

/**
 * @param {number} callerTabId 熔炉页 tabId
 * @param {Record<string, unknown>} payload 与 launch DISPATCH 相同字段（含 async_job_id）
 */
export async function dispatchAsyncGenerationRecover(callerTabId, payload) {
  await ensureMcupExtensionAccessTokenOrThrow();
  const core = String(payload.core_engine || '').trim();
  let command = '';
  if (core.startsWith('jimeng_agent')) command = 'JIMENG_ASYNC_RECOVER';
  else if (core.startsWith('gemini_agent')) command = 'GEMINI_ASYNC_RECOVER';
  else throw new Error('ASYNC_BAD_CORE_ENGINE');
  const rec = getCommandRecord(command);
  if (!rec || !Array.isArray(rec.steps)) throw new Error('ASYNC_NO_COMMAND_RECORD');
  const clientRequestId = crypto.randomUUID();
  return masterDispatch(clientRequestId, command, { ...payload }, callerTabId);
}
