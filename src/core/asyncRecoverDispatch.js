/**
 * 熔炉触发的异步「找回」入口：按 Profile 选 PROBE_RELAY 或 SINGLE_COMMAND（设计 **11** §B/C、**14** 批次 1）。
 */
import { ensureMcupExtensionAccessTokenOrThrow } from './extensionAccessTokenLifecycle.js';
import { resolveProfileByCoreEngine } from './asyncEngineProfiles.js';
import { runDefaultProbeThenRelay, runSingleShotRecover } from './asyncPipelineOrchestration.js';

/**
 * @param {number} callerTabId 熔炉页 tabId
 * @param {Record<string, unknown>} payload 与 launch DISPATCH 相同字段（含 async_job_id、core_engine）
 */
export async function dispatchAsyncGenerationRecover(callerTabId, payload) {
  await ensureMcupExtensionAccessTokenOrThrow();
  const profile = resolveProfileByCoreEngine(String(payload.core_engine || '').trim());
  if (profile.recoverStrategy === 'PROBE_RELAY') {
    return runDefaultProbeThenRelay(callerTabId, payload);
  }
  if (profile.recoverStrategy === 'SINGLE_COMMAND') {
    return runSingleShotRecover(callerTabId, payload);
  }
  throw new Error('ASYNC_BAD_RECOVER_STRATEGY');
}
