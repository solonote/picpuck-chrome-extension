/**
 * §5.1 dispatchRound：串行步骤、异常收尾、Step99、releaseExecSlot、映射清理。
 */
import { getCommandRecord } from './registry.js';
import { getOrCreateRoundContext, appendLog, updatePhase, getContext } from './roundContext.js';
import { releaseExecSlot } from './releaseExecSlot.js';
import { clearJimengRelayCallerTabRegistration, getJimengRelayCallerTabId } from './relayCallerTabTTL.js';
import { inFlightByTabId, roundBinding } from './taskBindings.js';
import { detachLogSink } from './logSink.js';
import { isAsyncJobCancelled } from './asyncGenerationState.js';
import { persistRoundLogsSnapshot } from './roundLogSnapshot.js';
import { pushRoundPhaseUi } from './phaseUi.js';
import {
  frameworkStep01_clearRoundLogs,
  frameworkStep02_attachLogSink,
  frameworkStep03_ensurePageHelpers,
} from './frameworkPreflight.js';
import { startJimengRecoverPageWatcherFromLaunch } from './jimengRecoverPageWatcherLaunch.js';
import { resolveProfileByCoreEngine } from './asyncEngineProfiles.js';
import { submitFrameworkAsyncJobOutcomeIfPresent } from './frameworkAsyncJobOutcome.js';
import { notifyAsyncJobRecoverFinished } from './asyncWatchLoopRegistry.js';
/**
 * @param {{ clientRequestId: string, command: string, tabId: number, roundId: string, payload: Record<string, unknown> }} args
 * @returns {Promise<{ phase: string, probeOutcome?: string, jimengWatchLoopRegister?: { async_job_id: string, recoverPayload: Record<string, unknown>, callerTabId?: number } }>}
 */
export async function dispatchRound(args) {
  const { clientRequestId, command, tabId, roundId, payload } = args;
  const rec = getCommandRecord(command);
  // step01～step03 由 core 框架统一执行；steps 仅含站点业务步骤（§5.1）
  if (!rec || !Array.isArray(rec.steps)) {
    await releaseExecSlot(tabId);
    inFlightByTabId.delete(tabId);
    roundBinding.delete(roundId);
    clearJimengRelayCallerTabRegistration(roundId);
    detachLogSink(tabId);
    return { phase: 'error', jimengWatchLoopRegister: undefined };
  }

  /**
   * Gemini：`step07_gemini_apply_effective_prompt_on_context` 写入 `effectivePrompt`，
   * `step09_gemini_fill_input_and_paste_images` 读取（设计 §5.1 / §11.1）。
   * @type {{ tabId: number, roundId: string, command: string, clientRequestId: string, payload: Record<string, unknown>, effectivePrompt?: string, frameworkAsyncJobOutcome?: object }}
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

  /** LAUNCH 成功且含锚点时由 `masterDispatch` 调用 `registerWatchLoopAfterJimengLaunch`（避免 dispatchRound ↔ asyncWatchLoopRegistry 循环依赖） */
  let jimengWatchLoopRegister;

  try {
    updatePhase(tabId, 'received');
    await pushRoundPhaseUi(tabId, roundId);

    await frameworkStep01_clearRoundLogs(ctx);
    await frameworkStep02_attachLogSink(ctx);
    await frameworkStep03_ensurePageHelpers(ctx);

    // §5.1：框架前序完成后再置 running，直至终止态
    updatePhase(tabId, 'running');
    await pushRoundPhaseUi(tabId, roundId);

    const assertAsyncJobNotCancelled = () => {
      const aj =
        ctx.payload && typeof ctx.payload.async_job_id === 'string'
          ? ctx.payload.async_job_id.trim().toLowerCase()
          : '';
      if (aj && isAsyncJobCancelled(aj)) {
        throw Object.assign(new Error('ASYNC_JOB_CANCELLED'), { code: 'ASYNC_JOB_CANCELLED' });
      }
    };

    for (let i = 0; i < rec.steps.length; i += 1) {
      const fn = rec.steps[i];
      if (typeof fn !== 'function') throw new Error(`step ${i} missing`);
      assertAsyncJobNotCancelled();
      const r = await fn(ctx);
      if (r && r.ok === false) {
        throw Object.assign(new Error('STEP_OK_FALSE'), { stepResult: r });
      }
      assertAsyncJobNotCancelled();
    }

    const outcomeSubmit = await submitFrameworkAsyncJobOutcomeIfPresent(ctx);
    if (
      outcomeSubmit.submitted &&
      outcomeSubmit.outcomeType === 'SUCCEEDED' &&
      ctx.command === 'JIMENG_ASYNC_RELAY'
    ) {
      const ajDone =
        ctx.payload && typeof ctx.payload.async_job_id === 'string'
          ? ctx.payload.async_job_id.trim().toLowerCase()
          : '';
      if (ajDone) {
        let keepLoop = false;
        try {
          keepLoop =
            resolveProfileByCoreEngine(String(ctx.payload.core_engine || '').trim())
              .keepWatchLoopAfterRelaySuccess === true;
        } catch {
          keepLoop = false;
        }
        if (!keepLoop) notifyAsyncJobRecoverFinished(ajDone);
      }
    }

    let launchProfile = null;
    try {
      launchProfile = resolveProfileByCoreEngine(String(payload.core_engine || '').trim());
    } catch {
      launchProfile = null;
    }
    if (
      launchProfile &&
      command === launchProfile.launchCommand &&
      launchProfile.registerWatchLoopOnLaunchSuccess === true
    ) {
      const aj = typeof payload.async_job_id === 'string' ? payload.async_job_id.trim().toLowerCase() : '';
      const ajOk = /^[a-z0-9]{12}$/.test(aj);
      const hasAnchor = !!(ctx.jimengRecordAnchor && typeof ctx.jimengRecordAnchor === 'object');
      if (hasAnchor && ajOk) {
        const callerTabId = getJimengRelayCallerTabId(roundId);
        const recoverPayload = {
          async_job_id: aj,
          core_engine: String(payload.core_engine || '').trim(),
          projectId: typeof payload.projectId === 'string' ? payload.projectId.trim() : '',
          subjectType: typeof payload.subjectType === 'string' ? payload.subjectType.trim() : '',
          subjectId: typeof payload.subjectId === 'string' ? payload.subjectId.trim() : '',
          input_prompt: typeof payload.input_prompt === 'string' ? payload.input_prompt : '',
          jimengRecordAnchor: ctx.jimengRecordAnchor,
        };
        void startJimengRecoverPageWatcherFromLaunch({
          workTabId: tabId,
          roundId,
          async_job_id: aj,
          forgeCallerTabId: typeof callerTabId === 'number' ? callerTabId : 0,
          recoverPayload,
        }).catch((e) => console.warn('[PicPuck] jimeng page watcher launch', e));
        jimengWatchLoopRegister = {
          async_job_id: aj,
          recoverPayload,
          callerTabId: typeof callerTabId === 'number' ? callerTabId : undefined,
        };
        appendLog(tabId, {
          ts: Date.now(),
          roundId,
          step: 'system',
          level: 'info',
          message: 'Step99.info.jimengRecoverPageWatcherStarted async_job_id=' + aj,
        });
      } else {
        const mode = payload && payload.jimengSubmitMode;
        const reason = !hasAnchor ? 'no_anchor' : 'bad_async_job_id';
        console.warn('[PicPuck] WatchLoop 未开启', {
          reason,
          async_job_id: aj || '(empty)',
          jimengSubmitMode: mode,
          hint:
            reason === 'no_anchor'
              ? 'LAUNCH 结束时 ctx 无 jimengRecordAnchor（Step19 未写入或失败）'
              : 'async_job_id 须为 12 位 [a-z0-9]',
        });
        appendLog(tabId, {
          ts: Date.now(),
          roundId,
          step: 'system',
          level: 'info',
          message:
            'Step99.info.watchLoopSkipped reason=' +
            reason +
            (mode != null ? ' jimengSubmitMode=' + String(mode) : ''),
        });
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
    const cancelled =
      msg === 'ASYNC_JOB_CANCELLED' ||
      (e && typeof e === 'object' && /** @type {{ code?: string }} */ (e).code === 'ASYNC_JOB_CANCELLED');
    appendLog(tabId, {
      ts: Date.now(),
      roundId,
      step: 'system',
      level: 'info',
      message: cancelled ? 'Step99.本轮结束+已取消' : 'Step99.本轮结束+失败',
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
    clearJimengRelayCallerTabRegistration(roundId);
    detachLogSink(tabId);
  }

  const phase = getContext(tabId)?.phase ?? 'error';
  let probeProfile = null;
  try {
    probeProfile = resolveProfileByCoreEngine(String(payload.core_engine || '').trim());
  } catch {
    probeProfile = null;
  }
  const probeOutcome =
    probeProfile &&
    probeProfile.probeCommand &&
    command === probeProfile.probeCommand &&
    typeof ctx.jimengProbeOutcome === 'string' &&
    ctx.jimengProbeOutcome.trim()
      ? ctx.jimengProbeOutcome.trim()
      : undefined;
  return {
    phase,
    jimengWatchLoopRegister: phase === 'success' ? jimengWatchLoopRegister : undefined,
    ...(probeOutcome ? { probeOutcome } : {}),
  };
}
