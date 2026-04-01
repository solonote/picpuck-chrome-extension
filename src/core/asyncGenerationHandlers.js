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
import { validateRecoverPayload } from './asyncRecoverValidators.js';

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
      console.error(e);
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
      console.error(e);
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
    if (!ASYNC_ID_RE.test(async_job_id)) {
      console.warn('[PicPuck] 检查进度 拒绝', { reason: 'async_job_id 无效', async_job_id });
      return { ok: false, error: 'async_job_id 无效' };
    }
    const recoverPayload = payload.recoverPayload;
    if (!recoverPayload || typeof recoverPayload !== 'object') {
      console.warn('[PicPuck] 检查进度 拒绝', { reason: '缺少 recoverPayload', async_job_id });
      return { ok: false, error: '缺少 recoverPayload' };
    }
    const coreForVal = String(recoverPayload.core_engine || '').trim();
    const err = validateRecoverPayload(coreForVal, { ...recoverPayload, async_job_id });
    if (err) {
      console.warn('[PicPuck] 检查进度 拒绝', { async_job_id, error: err });
      return { ok: false, error: err };
    }
    const client_probe_id =
      typeof payload.client_probe_id === 'string' && payload.client_probe_id.trim()
        ? payload.client_probe_id.trim()
        : undefined;
    console.info('[PicPuck] 检查进度 已受理（将异步跑 PROBE→RELAY）', {
      async_job_id,
      client_probe_id,
      callerTabId: tabId,
    });
    onManualProbeRequest({
      async_job_id,
      recoverPayload: { ...recoverPayload, async_job_id },
      callerTabId: tabId,
    });
    return { ok: true, asyncGenHandled: true };
  }
  if (phase === 'RECOVER') {
    const mergedForVal = { ...payload };
    const err = validateRecoverPayload(String(mergedForVal.core_engine || '').trim(), mergedForVal);
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
