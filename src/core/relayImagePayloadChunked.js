/**
 * 即梦多图：按 picpuck.imageRelay v1 分片 tabs.sendMessage → CS postMessage → 页面拼装。
 */
import {
  JIMENG_RELAY_CALLER_TAB_UNBOUND,
  JIMENG_RELAY_INVALID_PAYLOAD,
  JIMENG_RELAY_SEND_FAILED,
} from './jimengRelayErrorCodes.js';
import {
  clearRelayCallerTabRegistrationForRound,
  getRelayCallerTabIdForRound,
  touchRelayCallerTabTtlForRound,
} from './relayCallerTabTTL.js';

const PROTOCOL = 'picpuck.imageRelay';
const CHUNK_CHARS = 262144;

function baseEnvelope(relayId) {
  return { picpuckRelay: true, protocol: PROTOCOL, version: 1, relayId };
}

/**
 * @param {number} tabId
 * @param {Record<string, unknown>} envelope
 */
export async function sendImageRelayEnvelopeToTab(tabId, envelope) {
  const res = await chrome.tabs.sendMessage(tabId, { type: 'PICPUCK_IMAGE_RELAY', envelope });
  if (res && res.ok === false) {
    throw new Error(typeof res.error === 'string' ? res.error : 'PICPUCK_IMAGE_RELAY_CS_FAIL');
  }
}

async function sendRelayToTab(tabId, envelope) {
  return sendImageRelayEnvelopeToTab(tabId, envelope);
}

/**
 * Gemini 单张整图：与即梦相同 picpuck.imageRelay v1，经多段 CHUNK 避免 runtime.sendMessage / tabs.sendMessage 64MiB 上限。
 * @param {number} tabId
 * @param {string} relayId
 * @param {object} generationEvent
 * @param {string} contentType
 * @param {number} base64CharLength
 */
export async function geminiRelayForwardBegin(tabId, relayId, generationEvent, contentType, base64CharLength) {
  const mainCt =
    typeof contentType === 'string' && contentType ? contentType.split(';')[0].trim() : 'image/png';
  const beginEnv = {
    ...baseEnvelope(relayId),
    phase: 'BEGIN',
    generationEvent,
    imageCount: 1,
    base64CharLength: [base64CharLength],
    contentTypes: [mainCt || 'image/png'],
  };
  await sendRelayToTab(tabId, beginEnv);
}

/**
 * @param {number} tabId
 * @param {string} relayId
 * @param {number} seq
 * @param {string} text
 */
export async function geminiRelayForwardChunk(tabId, relayId, seq, text) {
  await sendRelayToTab(tabId, {
    ...baseEnvelope(relayId),
    phase: 'CHUNK',
    imageIndex: 0,
    seq,
    text,
  });
}

/**
 * @param {number} tabId
 * @param {string} relayId
 */
export async function geminiRelayForwardEnd(tabId, relayId) {
  await sendRelayToTab(tabId, { ...baseEnvelope(relayId), phase: 'END' });
}

/**
 * @param {number} tabId
 * @param {string} relayId
 * @param {string} code
 * @param {string} message
 */
async function tryAbortToTab(tabId, relayId, code, message) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'PICPUCK_IMAGE_RELAY',
      envelope: { ...baseEnvelope(relayId), phase: 'ABORT', code, message },
    });
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ tabId?: number, relayId: string, generationEvent: object, images: Array<{ imageBase64: string, contentType?: string }> }} p
 * `tabId` 可选；缺省时由 `relayId`（与 roundId 相同）在 TTL 登记中解析 caller 熔炉 Tab。
 */
export async function relayImagePayloadChunkedToTab(p) {
  const relayId = typeof p.relayId === 'string' ? p.relayId : '';
  const images = Array.isArray(p.images) ? p.images : [];
  const generationEvent =
    p.generationEvent && typeof p.generationEvent === 'object' ? p.generationEvent : null;
  if (!relayId || images.length === 0 || !generationEvent) {
    throw new Error(JIMENG_RELAY_INVALID_PAYLOAD);
  }
  for (let i = 0; i < images.length; i += 1) {
    const it = images[i];
    if (!it || typeof it.imageBase64 !== 'string' || !it.imageBase64) {
      throw new Error(JIMENG_RELAY_INVALID_PAYLOAD);
    }
  }
  const fromReg = getRelayCallerTabIdForRound(relayId);
  const callerTabId =
    typeof p.tabId === 'number' && p.tabId > 0 ? p.tabId : fromReg;
  if (callerTabId == null) {
    throw new Error(JIMENG_RELAY_CALLER_TAB_UNBOUND);
  }

  const base64CharLength = images.map((it) => it.imageBase64.length);
  const contentTypes = images.map((it) => {
    const ct = typeof it.contentType === 'string' && it.contentType ? it.contentType : '';
    const main = ct.split(';')[0].trim();
    return main || 'image/png';
  });

  const beginEnv = {
    ...baseEnvelope(relayId),
    phase: 'BEGIN',
    generationEvent,
    imageCount: images.length,
    base64CharLength,
    contentTypes,
  };

  try {
    touchRelayCallerTabTtlForRound(relayId);
    await sendRelayToTab(callerTabId, beginEnv);

    for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
      const b64 = images[imageIndex].imageBase64;
      let seq = 0;
      for (let off = 0; off < b64.length; off += CHUNK_CHARS) {
        const text = b64.slice(off, off + CHUNK_CHARS);
        touchRelayCallerTabTtlForRound(relayId);
        await sendRelayToTab(callerTabId, {
          ...baseEnvelope(relayId),
          phase: 'CHUNK',
          imageIndex,
          seq,
          text,
        });
        seq += 1;
      }
    }
    touchRelayCallerTabTtlForRound(relayId);
    await sendRelayToTab(callerTabId, { ...baseEnvelope(relayId), phase: 'END' });
  } catch (e) {
    let detail = '';
    try {
      detail = chrome.runtime.lastError?.message || '';
    } catch {
      detail = '';
    }
    const em = e instanceof Error ? e.message : String(e);
    const tail = [detail, em].filter(Boolean).join(' | ');
    await tryAbortToTab(callerTabId, relayId, JIMENG_RELAY_SEND_FAILED, tail || JIMENG_RELAY_SEND_FAILED);
    throw new Error(tail ? `${JIMENG_RELAY_SEND_FAILED}: ${tail}` : JIMENG_RELAY_SEND_FAILED);
  }
  clearRelayCallerTabRegistrationForRound(relayId);
}
