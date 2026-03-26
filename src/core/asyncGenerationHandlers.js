/**
 * 熔炉页 `picpuckAsyncGeneration`：PRE / DISPATCH / RECOVER / CANCEL（设计 **11**、**12**）。
 */
import {
  markAsyncJobCancelled,
  pendingPreSlot,
  registerActiveAsyncJob,
  setPendingPreSlot,
} from './asyncGenerationState.js';
import { PICPUCK_ASYNC_GEN_PAGE, PICPUCK_ASYNC_GEN_RECOVER_RECEIVED } from './runtimeMessages.js';
import { dispatchAsyncGenerationFillOnly, dispatchAsyncGenerationLaunch } from './asyncLaunchDispatch.js';
import { onManualProbeRequest, unregisterWatchLoop } from './asyncWatchLoopRegistry.js';

const ASYNC_ID_RE = /^[a-z0-9]{12}$/;

/**
 * @param {Record<string, unknown>} p
 * @param {{ forbidAsyncJobId?: boolean }} [opts]
 * @returns {string|undefined} 错误文案
 */
function validateHandshakeFields(p, opts) {
  const id = typeof p.client_handshake_id === 'string' ? p.client_handshake_id.trim() : '';
  if (!id) return '缺少 client_handshake_id';
  if (opts?.forbidAsyncJobId && p.async_job_id != null && String(p.async_job_id).trim() !== '') {
    return 'PRE 禁止携带 async_job_id';
  }
  const projectId = typeof p.projectId === 'string' ? p.projectId.trim() : '';
  const subjectType = typeof p.subjectType === 'string' ? p.subjectType.trim() : '';
  const subjectId = typeof p.subjectId === 'string' ? p.subjectId.trim() : '';
  const core_engine = typeof p.core_engine === 'string' ? p.core_engine.trim() : '';
  if (!projectId) return '缺少 projectId';
  if (!subjectType) return '缺少 subjectType';
  if (!subjectId) return '缺少 subjectId';
  if (!core_engine) return '缺少 core_engine';
  if (typeof p.input_prompt !== 'string') return '缺少 input_prompt';
  return undefined;
}

/**
 * 即梦异步第二阶段：须含锚点（与 Step20 PATCH 写入 extension_remote_context 一致）。
 * @returns {string|undefined}
 */
function validateJimengRecoverFields(p) {
  const async_job_id = typeof p.async_job_id === 'string' ? p.async_job_id.trim().toLowerCase() : '';
  if (!ASYNC_ID_RE.test(async_job_id)) return 'async_job_id 须为 12 位 [a-z0-9]';
  const core = String(p.core_engine || '').trim();
  if (!core.startsWith('jimeng_agent')) return 'RECOVER 当前仅支持 jimeng_agent';
  const projectId = typeof p.projectId === 'string' ? p.projectId.trim() : '';
  if (!projectId) return '缺少 projectId';
  const a = p.jimengRecordAnchor;
  if (!a || typeof a !== 'object') return '缺少 jimengRecordAnchor';
  const dataId = typeof a.dataId === 'string' ? a.dataId.trim() : '';
  const recordItemId = typeof a.recordItemId === 'string' ? a.recordItemId.trim() : '';
  if (!dataId && !recordItemId) return 'jimengRecordAnchor 须含 dataId 或 recordItemId';
  return undefined;
}

/**
 * @param {number} tabId
 * @param {Record<string, unknown>} envelope
 */
async function postEnvelopeToPage(tabId, envelope) {
  await chrome.tabs.sendMessage(tabId, {
    type: PICPUCK_ASYNC_GEN_PAGE,
    envelope,
  });
}

/**
 * @param {Record<string, unknown>} payload
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<{ ok: boolean, error?: string, asyncGenHandled?: boolean }>}
 */
export async function handlePicpuckAsyncGeneration(payload, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null || typeof tabId !== 'number') {
    return { ok: false, error: 'no tab' };
  }
  const phase = typeof payload.picpuckAsyncPhase === 'string' ? payload.picpuckAsyncPhase.trim() : '';
  if (phase === 'PRE') {
    const err = validateHandshakeFields(payload, { forbidAsyncJobId: true });
    if (err) return { ok: false, error: err };
    const rest = { ...payload };
    delete rest.picpuckAsyncPhase;
    delete rest.type;
    delete rest.action;
    setPendingPreSlot(rest);
    const client_handshake_id = String(payload.client_handshake_id).trim();
    await postEnvelopeToPage(tabId, {
      type: 'PICPUCK_ASYNC_GEN_PRE_ACK',
      client_handshake_id,
    });
    return { ok: true, asyncGenHandled: true };
  }
  if (phase === 'FILL_DISPATCH') {
    if (!pendingPreSlot || typeof pendingPreSlot !== 'object') {
      return { ok: false, error: '无 pending PRE' };
    }
    if (!pendingPreSlot.fillOnly) {
      return { ok: false, error: '非仅填词模式' };
    }
    const err = validateHandshakeFields(payload, { forbidAsyncJobId: true });
    if (err) return { ok: false, error: err };
    const dispatchRest = { ...payload };
    delete dispatchRest.picpuckAsyncPhase;
    delete dispatchRest.type;
    delete dispatchRest.action;
    const merged = { ...pendingPreSlot, ...dispatchRest };
    if (merged.async_job_id != null && String(merged.async_job_id).trim() !== '') {
      return { ok: false, error: 'FILL_DISPATCH 禁止携带 async_job_id' };
    }
    const cid = String(merged.client_handshake_id || '').trim();
    if (String(pendingPreSlot.client_handshake_id || '').trim() !== cid) {
      return { ok: false, error: 'FILL_DISPATCH 与 pending PRE 不一致' };
    }
    setPendingPreSlot(null);
    const client_handshake_id = cid;
    await postEnvelopeToPage(tabId, {
      type: 'PICPUCK_ASYNC_GEN_FILL_DISPATCH_RECEIVED',
      client_handshake_id,
    });
    void dispatchAsyncGenerationFillOnly(tabId, merged).catch((e) => {
      console.error('[PicPuck] dispatchAsyncGenerationFillOnly', e);
    });
    return { ok: true, asyncGenHandled: true };
  }
  if (phase === 'DISPATCH') {
    if (!pendingPreSlot || typeof pendingPreSlot !== 'object') {
      return { ok: false, error: '无 pending PRE' };
    }
    const err = validateHandshakeFields(payload, { forbidAsyncJobId: false });
    if (err) return { ok: false, error: err };
    const dispatchRest = { ...payload };
    delete dispatchRest.picpuckAsyncPhase;
    delete dispatchRest.type;
    delete dispatchRest.action;
    const merged = { ...pendingPreSlot, ...dispatchRest };
    const async_job_id =
      typeof merged.async_job_id === 'string' ? merged.async_job_id.trim().toLowerCase() : '';
    if (!ASYNC_ID_RE.test(async_job_id)) {
      return { ok: false, error: 'async_job_id 须为 12 位 [a-z0-9]' };
    }
    const cid = String(merged.client_handshake_id || '').trim();
    if (String(pendingPreSlot.client_handshake_id || '').trim() !== cid) {
      return { ok: false, error: 'DISPATCH 与 pending PRE 不一致' };
    }
    merged.async_job_id = async_job_id;
    setPendingPreSlot(merged);
    registerActiveAsyncJob(async_job_id);
    await postEnvelopeToPage(tabId, {
      type: 'PICPUCK_ASYNC_GEN_DISPATCH_RECEIVED',
      async_job_id,
    });
    void dispatchAsyncGenerationLaunch(tabId, async_job_id).catch((e) => {
      console.error('[PicPuck] dispatchAsyncGenerationLaunch', e);
    });
    return { ok: true, asyncGenHandled: true };
  }
  if (phase === 'CANCEL') {
    const async_job_id =
      typeof payload.async_job_id === 'string' ? payload.async_job_id.trim().toLowerCase() : '';
    if (!ASYNC_ID_RE.test(async_job_id)) return { ok: false, error: 'async_job_id 无效' };
    markAsyncJobCancelled(async_job_id);
    unregisterWatchLoop(async_job_id);
    return { ok: true, asyncGenHandled: true };
  }
  if (phase === 'WATCH_PROBE') {
    const async_job_id =
      typeof payload.async_job_id === 'string' ? payload.async_job_id.trim().toLowerCase() : '';
    // #region agent log
    fetch('http://127.0.0.1:7580/ingest/950995e1-d0ac-4671-9d6d-791b255470ef', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd9d244' },
      body: JSON.stringify({
        sessionId: 'd9d244',
        location: 'asyncGenerationHandlers.js:WATCH_PROBE:entry',
        message: 'WATCH_PROBE received',
        data: { async_job_id, tabId },
        timestamp: Date.now(),
        hypothesisId: 'D',
      }),
    }).catch(() => {});
    // #endregion
    if (!ASYNC_ID_RE.test(async_job_id)) {
      console.warn('[PicPuck] 检查进度 拒绝', { reason: 'async_job_id 无效', async_job_id });
      return { ok: false, error: 'async_job_id 无效' };
    }
    const recoverPayload = payload.recoverPayload;
    if (!recoverPayload || typeof recoverPayload !== 'object') {
      console.warn('[PicPuck] 检查进度 拒绝', { reason: '缺少 recoverPayload', async_job_id });
      return { ok: false, error: '缺少 recoverPayload' };
    }
    const err = validateJimengRecoverFields({ ...recoverPayload, async_job_id });
    if (err) {
      // #region agent log
      fetch('http://127.0.0.1:7580/ingest/950995e1-d0ac-4671-9d6d-791b255470ef', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd9d244' },
        body: JSON.stringify({
          sessionId: 'd9d244',
          location: 'asyncGenerationHandlers.js:WATCH_PROBE:validateFail',
          message: String(err),
          data: { async_job_id },
          timestamp: Date.now(),
          hypothesisId: 'D',
        }),
      }).catch(() => {});
      // #endregion
      console.warn('[PicPuck] 检查进度 拒绝', { async_job_id, error: err });
      return { ok: false, error: err };
    }
    const client_probe_id =
      typeof payload.client_probe_id === 'string' && payload.client_probe_id.trim()
        ? payload.client_probe_id.trim()
        : undefined;
    console.info('[PicPuck] 检查进度 已受理（将异步跑 JIMENG_ASYNC_RECOVER）', {
      async_job_id,
      client_probe_id,
      callerTabId: tabId,
    });
    onManualProbeRequest({
      async_job_id,
      recoverPayload: { ...recoverPayload, async_job_id },
      callerTabId: tabId,
    });
    // #region agent log
    fetch('http://127.0.0.1:7580/ingest/950995e1-d0ac-4671-9d6d-791b255470ef', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd9d244' },
      body: JSON.stringify({
        sessionId: 'd9d244',
        location: 'asyncGenerationHandlers.js:WATCH_PROBE:accepted',
        message: 'onManualProbeRequest queued',
        data: {
          async_job_id,
          hasAnchor: !!(recoverPayload.jimengRecordAnchor && typeof recoverPayload.jimengRecordAnchor === 'object'),
        },
        timestamp: Date.now(),
        hypothesisId: 'D',
      }),
    }).catch(() => {});
    // #endregion
    return { ok: true, asyncGenHandled: true };
  }
  if (phase === 'RECOVER') {
    const err = validateJimengRecoverFields(payload);
    if (err) return { ok: false, error: err };
    const rest = { ...payload };
    delete rest.picpuckAsyncPhase;
    delete rest.type;
    delete rest.action;
    const merged = { ...rest };
    const async_job_id =
      typeof merged.async_job_id === 'string' ? merged.async_job_id.trim().toLowerCase() : '';
    registerActiveAsyncJob(async_job_id);
    await postEnvelopeToPage(tabId, {
      type: PICPUCK_ASYNC_GEN_RECOVER_RECEIVED,
      async_job_id,
    });
    onManualProbeRequest({
      async_job_id,
      recoverPayload: merged,
      callerTabId: tabId,
    });
    return { ok: true, asyncGenHandled: true };
  }
  return { ok: false, error: 'unknown picpuckAsyncPhase' };
}
