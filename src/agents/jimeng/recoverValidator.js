const ASYNC_ID_RE = /^[a-z0-9]{12}$/;

/**
 * RECOVER / WATCH_PROBE 合并后的载荷（设计 **12** §B）。
 * @param {Record<string, unknown>} p
 * @returns {string|undefined}
 */
export function validateJimengRecoverMergedPayload(p) {
  const async_job_id = typeof p.async_job_id === 'string' ? p.async_job_id.trim().toLowerCase() : '';
  if (!ASYNC_ID_RE.test(async_job_id)) return 'async_job_id 须为 12 位 [a-z0-9]';
  const projectId = typeof p.projectId === 'string' ? p.projectId.trim() : '';
  if (!projectId) return '缺少 projectId';
  const a = p.jimengRecordAnchor;
  if (!a || typeof a !== 'object') return '缺少 jimengRecordAnchor';
  const dataId = typeof a.dataId === 'string' ? a.dataId.trim() : '';
  const recordItemId = typeof a.recordItemId === 'string' ? a.recordItemId.trim() : '';
  if (!dataId && !recordItemId) return 'jimengRecordAnchor 须含 dataId 或 recordItemId';
  return undefined;
}
