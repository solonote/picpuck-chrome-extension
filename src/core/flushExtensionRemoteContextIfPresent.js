/**
 * 站点步骤将 `extension_remote_context` 拼入 {@code ctx.pendingExtensionRemoteContext}（字符串或可归一化为 JSON 的对象）；
 * 框架在本轮业务步骤跑完后统一 PATCH，agents 禁止直连 {@link ./mcupGenerationAsyncApi.js}。
 */
import { ensureMcupExtensionAccessTokenOrThrow } from './extensionAccessTokenLifecycle.js';
import { mcupPatchExtensionState } from './mcupGenerationAsyncApi.js';

const ASYNC_JOB_ID_RE = /^[a-z0-9]{12}$/;

/**
 * @param {{ payload?: Record<string, unknown>, pendingExtensionRemoteContext?: string | Record<string, unknown> }} ctx
 */
export async function flushExtensionRemoteContextIfPresent(ctx) {
  const pending = ctx.pendingExtensionRemoteContext;
  if (pending == null || pending === '') return;

  const p = ctx.payload && typeof ctx.payload === 'object' ? ctx.payload : {};
  const projectId = String(p.projectId || '').trim();
  const ajRaw =
    typeof p.async_job_id === 'string' ? p.async_job_id.trim().toLowerCase() : '';
  if (!projectId || !ASYNC_JOB_ID_RE.test(ajRaw)) {
    delete ctx.pendingExtensionRemoteContext;
    throw new Error('EXTENSION_REMOTE_CONTEXT_FLUSH_MISSING_IDS');
  }

  const extension_remote_context =
    typeof pending === 'string' ? pending : JSON.stringify(pending);

  await ensureMcupExtensionAccessTokenOrThrow();
  await mcupPatchExtensionState({
    projectId,
    async_job_id: ajRaw,
    extension_remote_context,
  });
  delete ctx.pendingExtensionRemoteContext;
}
