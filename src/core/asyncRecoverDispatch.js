/**
 * 熔炉触发的异步「找回」入口：按 Profile 选 PROBE_RELAY 或 SINGLE_COMMAND（设计 **11** §B/C、**14** 批次 1）。
 * 同一 `async_job_id` 在途只跑一轮，避免页内 watcher + 定时 probe 并发触发时重复 PROBE/RELAY、连续 `tabs.create`。
 */
import { ensureMcupExtensionAccessTokenOrThrow } from './extensionAccessTokenLifecycle.js';
import { resolveProfileByCoreEngine } from './asyncEngineProfiles.js';
import { runDefaultProbeThenRelay, runSingleShotRecover } from './asyncPipelineOrchestration.js';
import { normalizeAsyncJobId } from './taskBindings.js';

/** @type {Map<string, Promise<{ ok?: boolean, tabId?: number, probeOutcome?: string }>>} */
const recoverInFlightByJobId = new Map();

/**
 * @param {number} callerTabId 熔炉页 tabId
 * @param {Record<string, unknown>} payload 与 launch DISPATCH 相同字段（含 async_job_id、core_engine）
 */
export async function dispatchAsyncGenerationRecover(callerTabId, payload) {
  const dedupeKey = normalizeAsyncJobId(payload?.async_job_id);
  if (dedupeKey) {
    const existing = recoverInFlightByJobId.get(dedupeKey);
    if (existing) return existing;
  }

  const run = (async () => {
    await ensureMcupExtensionAccessTokenOrThrow();
    const profile = resolveProfileByCoreEngine(String(payload.core_engine || '').trim());
    if (profile.recoverStrategy === 'PROBE_RELAY') {
      return runDefaultProbeThenRelay(callerTabId, payload);
    }
    if (profile.recoverStrategy === 'SINGLE_COMMAND') {
      return runSingleShotRecover(callerTabId, payload);
    }
    throw new Error('ASYNC_BAD_RECOVER_STRATEGY');
  })();

  if (dedupeKey) {
    recoverInFlightByJobId.set(dedupeKey, run);
    run.finally(() => {
      if (recoverInFlightByJobId.get(dedupeKey) === run) {
        recoverInFlightByJobId.delete(dedupeKey);
      }
    });
  }

  return run;
}
