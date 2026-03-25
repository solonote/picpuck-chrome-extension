/**
 * 异步「找回」占位步骤（设计 **02** 第二阶段、**已确认决策** §6）：PATCH → 可取消等待 → complete 终态。
 * 站内取图 / SUCCEEDED 后续替换为本步之后的真实逻辑。
 */
import { delay } from './asyncCancellable.js';
import { isAsyncJobCancelled } from './asyncGenerationState.js';
import { ensureMcupExtensionAccessTokenOrThrow } from './extensionAccessTokenLifecycle.js';
import { mcupPatchExtensionState, mcupPostGenerationAsyncComplete } from './mcupGenerationAsyncApi.js';

function asyncJobIdFromCtx(ctx) {
  const raw = ctx?.payload && typeof ctx.payload.async_job_id === 'string' ? ctx.payload.async_job_id.trim() : '';
  return raw.toLowerCase();
}

/** 将 RUNNING 标为 EXT_REMOTE_READY_PENDING_FETCH（与后端 ExtensionRunPhase 一致）。 */
export async function step04_recover_patch_remote_ready_placeholder(ctx) {
  await ensureMcupExtensionAccessTokenOrThrow();
  const p = ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {};
  const asyncJobId = asyncJobIdFromCtx(ctx);
  if (!asyncJobId) throw new Error('recover: missing async_job_id');
  await mcupPatchExtensionState({
    projectId: String(p.projectId || '').trim(),
    async_job_id: asyncJobId,
    extension_run_phase: 'EXT_REMOTE_READY_PENDING_FETCH',
    extension_remote_context: 'recover_placeholder',
  });
  return { ok: true };
}

/**
 * 占位：模拟轮询窗口；取消时由外层 dispatchRound 与 delay 内检查共同生效。
 */
export async function step05_recover_poll_placeholder(ctx) {
  const aj = asyncJobIdFromCtx(ctx);
  const cancelled = () => !!(aj && isAsyncJobCancelled(aj));
  for (let i = 0; i < 3; i += 1) {
    if (cancelled()) {
      throw Object.assign(new Error('ASYNC_JOB_CANCELLED'), { code: 'ASYNC_JOB_CANCELLED' });
    }
    await delay(2000, { isCancelled: cancelled });
  }
  return { ok: true };
}

/**
 * 占位：以 FAILED 结束 RUNNING（无图）；真实找回成功路径应改为 SUCCEEDED + 文件 parts。
 */
export async function step06_recover_complete_placeholder_failed(ctx) {
  await ensureMcupExtensionAccessTokenOrThrow();
  const p = ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {};
  const asyncJobId = asyncJobIdFromCtx(ctx);
  const projectId = String(p.projectId || '').trim();
  const subjectType = String(p.subjectType || '').trim();
  const subjectId = String(p.subjectId || '').trim();
  const inputPrompt =
    typeof p.input_prompt === 'string'
      ? p.input_prompt
      : typeof p.inputPrompt === 'string'
        ? p.inputPrompt
        : '';
  const coreEngine = String(p.core_engine || p.coreEngine || '').trim();
  if (!asyncJobId || !projectId || !subjectType || !subjectId) {
    throw new Error('recover complete: missing subject fields');
  }
  const fd = new FormData();
  fd.append('async_job_id', asyncJobId);
  fd.append('outcome', 'FAILED');
  fd.append('error_message', 'RECOVER_PLACEHOLDER_NO_IMAGE_YET');
  fd.append('projectId', projectId);
  fd.append('subjectType', subjectType);
  fd.append('subjectId', subjectId);
  fd.append('input_prompt', inputPrompt);
  if (coreEngine) fd.append('core_engine', coreEngine);
  await mcupPostGenerationAsyncComplete(fd);
  return { ok: true };
}
