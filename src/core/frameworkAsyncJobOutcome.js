/**
 * 异步 RUNNING 的终态（SUCCEEDED/FAILED）仅由框架在 dispatchRound 成功路径末尾提交，
 * agent 步骤只写入 {@code ctx.frameworkAsyncJobOutcome}，不得直接调用 generation-async/complete。
 */
import { ensureMcupExtensionAccessTokenOrThrow } from './extensionAccessTokenLifecycle.js';
import {
  mcupPostGenerationAsyncComplete,
  mcupPostGenerationAsyncCompleteSucceededWithImages,
} from './mcupGenerationAsyncApi.js';

/**
 * @typedef {{
 *   type: 'SUCCEEDED',
 *   images: Array<{ imageBase64: string, contentType?: string }>,
 *   generationEvent: Record<string, unknown>,
 * }} FrameworkAsyncJobOutcomeSucceeded
 */

/**
 * @typedef {{
 *   type: 'FAILED',
 *   error_message: string,
 *   async_job_id: string,
 *   projectId: string,
 *   subjectType: string,
 *   subjectId: string,
 *   input_prompt?: string,
 *   core_engine?: string,
 * }} FrameworkAsyncJobOutcomeFailed
 */

/**
 * @typedef {FrameworkAsyncJobOutcomeSucceeded | FrameworkAsyncJobOutcomeFailed} FrameworkAsyncJobOutcome
 */

/**
 * @param {{ frameworkAsyncJobOutcome?: FrameworkAsyncJobOutcome }} ctx
 * @returns {Promise<{ submitted: boolean, outcomeType?: 'SUCCEEDED' | 'FAILED' }>}
 */
export async function submitFrameworkAsyncJobOutcomeIfPresent(ctx) {
  const o = ctx.frameworkAsyncJobOutcome;
  if (!o || typeof o !== 'object') {
    return { submitted: false };
  }
  await ensureMcupExtensionAccessTokenOrThrow();
  if (o.type === 'SUCCEEDED') {
    const images = Array.isArray(o.images) ? o.images : [];
    const ge = o.generationEvent && typeof o.generationEvent === 'object' ? o.generationEvent : null;
    if (images.length < 1 || !ge) {
      delete ctx.frameworkAsyncJobOutcome;
      throw new Error('FRAMEWORK_ASYNC_OUTCOME_SUCCEEDED_INVALID');
    }
    await mcupPostGenerationAsyncCompleteSucceededWithImages(ge, images);
    delete ctx.frameworkAsyncJobOutcome;
    return { submitted: true, outcomeType: 'SUCCEEDED' };
  }
  if (o.type === 'FAILED') {
    const fd = new FormData();
    fd.append('async_job_id', String(o.async_job_id || '').trim().toLowerCase());
    fd.append('outcome', 'FAILED');
    fd.append('error_message', typeof o.error_message === 'string' ? o.error_message : '');
    fd.append('projectId', String(o.projectId || '').trim());
    fd.append('subjectType', String(o.subjectType || '').trim());
    fd.append('subjectId', String(o.subjectId || '').trim());
    const ip = o.input_prompt != null ? String(o.input_prompt) : '';
    if (ip) fd.append('input_prompt', ip);
    const ce = o.core_engine != null ? String(o.core_engine).trim() : '';
    if (ce) fd.append('core_engine', ce);
    await mcupPostGenerationAsyncComplete(fd);
    delete ctx.frameworkAsyncJobOutcome;
    return { submitted: true, outcomeType: 'FAILED' };
  }
  delete ctx.frameworkAsyncJobOutcome;
  return { submitted: false };
}
