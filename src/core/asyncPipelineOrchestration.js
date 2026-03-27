/**
 * 异步探查→PATCH→回收编排（设计 **11** §B、**14** 批次 1）。
 * core 不得 import agents/*。
 */
import { masterDispatch } from './masterDispatch.js';
import { getCommandRecord } from './registry.js';
import { ensureMcupExtensionAccessTokenOrThrow } from './extensionAccessTokenLifecycle.js';
import { mcupPatchExtensionState } from './mcupGenerationAsyncApi.js';
import { resolveProfileByCoreEngine } from './asyncEngineProfiles.js';

/**
 * @param {number} callerTabId
 * @param {Record<string, unknown>} payload
 */
export async function runDefaultProbeThenRelay(callerTabId, payload) {
  await ensureMcupExtensionAccessTokenOrThrow();
  const profile = resolveProfileByCoreEngine(String(payload.core_engine || '').trim());
  if (
    profile.recoverStrategy !== 'PROBE_RELAY' ||
    !profile.probeCommand ||
    !profile.relayCommand ||
    !profile.parseProbeOutcome
  ) {
    throw new Error('ASYNC_PROFILE_NOT_PROBE_RELAY');
  }
  const pr = await masterDispatch(crypto.randomUUID(), profile.probeCommand, { ...payload }, callerTabId);
  if (!pr.ok) return pr;
  const parsed = profile.parseProbeOutcome(pr);
  if (parsed !== 'ready') {
    return { ...pr, probeOutcome: pr.probeOutcome || parsed || 'not_ready' };
  }
  const projectId = String(payload.projectId || '').trim();
  const aj = String(payload.async_job_id || '').trim().toLowerCase();
  if (profile.awaitingRelayPhase && projectId && aj) {
    try {
      await ensureMcupExtensionAccessTokenOrThrow();
      await mcupPatchExtensionState({
        projectId,
        async_job_id: aj,
        extension_run_phase: profile.awaitingRelayPhase,
      });
    } catch (e) {
      console.warn('[PicPuck] PATCH extension_run_phase failed', e);
    }
  }
  const rr = await masterDispatch(crypto.randomUUID(), profile.relayCommand, { ...payload }, callerTabId);
  return { ...rr, probeOutcome: 'ready' };
}

/**
 * @param {number} callerTabId
 * @param {Record<string, unknown>} payload
 */
export async function runSingleShotRecover(callerTabId, payload) {
  await ensureMcupExtensionAccessTokenOrThrow();
  const profile = resolveProfileByCoreEngine(String(payload.core_engine || '').trim());
  if (profile.recoverStrategy !== 'SINGLE_COMMAND' || !profile.recoverCommand) {
    throw new Error('ASYNC_PROFILE_NOT_SINGLE_COMMAND');
  }
  const rec = getCommandRecord(profile.recoverCommand);
  if (!rec || !Array.isArray(rec.steps)) throw new Error('ASYNC_NO_COMMAND_RECORD');
  const clientRequestId = crypto.randomUUID();
  return masterDispatch(clientRequestId, profile.recoverCommand, { ...payload }, callerTabId);
}
