const ASYNC_ID_RE = /^[a-z0-9]{12}$/;

/**
 * Gemini 异步找回：最小字段（与熔炉 RECOVER 约定一致即可扩展）。
 * @param {Record<string, unknown>} p
 * @returns {string|undefined}
 */
export function validateGeminiRecoverMergedPayload(p) {
  const async_job_id = typeof p.async_job_id === 'string' ? p.async_job_id.trim().toLowerCase() : '';
  if (!ASYNC_ID_RE.test(async_job_id)) return 'async_job_id 须为 12 位 [a-z0-9]';
  const projectId = typeof p.projectId === 'string' ? p.projectId.trim() : '';
  if (!projectId) return '缺少 projectId';
  const url = typeof p.geminiConversationUrl === 'string' ? p.geminiConversationUrl.trim() : '';
  if (!url || url.indexOf('gemini.google.com/app') === -1) return '缺少或非法 geminiConversationUrl';
  const turnId = typeof p.geminiTurnContainerId === 'string' ? p.geminiTurnContainerId.trim() : '';
  if (!turnId) return '缺少 geminiTurnContainerId';
  return undefined;
}
