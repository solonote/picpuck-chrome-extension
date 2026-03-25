/* global chrome */
/**
 * 内容脚本（隔离世界）：在即梦/Gemini 注入顶栏 `#picpuck-agent-topbar`；本站（如 localhost）仅作 postMessage→SW 桥，不显示顶栏。
 *
 * - §4.1：左「当前轮次」（三连击）+ 中「等待/执行中」相对整条顶栏几何水平居中 + 右 Step 摘要（右对齐，`title` 全文）
 * - §4.2：600ms 内三次点击左侧 → 向 SW 索取日志 JSON 并写入剪贴板（含 session 快照，避免 SW 休眠丢日志）
 * - 与 PicPuck 前端：`IdlinkExtensionCommand` / `IdlinkExtensionCommandResult`（同 picpuckExtension.js）
 * - MAIN 世界若需写日志：先 `postMessage` 到本脚本，再转发 `LOG_APPEND`（见 picpuckBridge）
 */
(function () {
  const PICPUCK_COMMAND = 'PICPUCK_COMMAND';
  const LOG_APPEND = 'LOG_APPEND';
  const ROUND_PHASE = 'ROUND_PHASE';

  const PAGE_CMD = 'IdlinkExtensionCommand';
  /** 与 swMessages 中 `tabs.sendMessage` 的 type 一致：SW → 熔炉页 CS → window.postMessage */
  const PICPUCK_GEMINI_GENERATED_IMAGE = 'PICPUCK_GEMINI_GENERATED_IMAGE';
  const PICPUCK_IMAGE_RELAY = 'PICPUCK_IMAGE_RELAY';
  /** 与 `core/extensionAccessTokenLifecycle.js` 发向 CS 的 type 一致（设计 **12** §C） */
  const PICPUCK_EXTENSION_ACCESS_TOKEN_REQUEST = 'PICPUCK_EXTENSION_ACCESS_TOKEN_REQUEST';
  /** 与 `core/runtimeMessages.js` 中 `PICPUCK_ASYNC_GEN_PAGE` 一致（设计 **12** B） */
  const PICPUCK_ASYNC_GEN_PAGE = 'PICPUCK_ASYNC_GEN_PAGE';

  const TOPBAR_ID = 'picpuck-agent-topbar';
  const COPY_FLASH_MS = 300;
  const COPY_FLASH_COLOR = '#1a3d1a';
  const TRIPLE_CLICK_MS = 600;
  /** Gemini Step13：整图已拦截后，在写系统剪贴板前争取把本 Tab 切回前台（用户可暂时离开） */
  const CLIPBOARD_TAB_FOCUS_MAX_MS = 5 * 60 * 1000;
  const CLIPBOARD_TAB_FOCUS_POLL_MS = 100;

  /** Gemini step13：仅在 ARM～BUFFER/ABORT 之间挂一次监听，处理完或中止即移除 */
  let geminiClipboardBufferListener = null;

  function removeGeminiClipboardBufferListener() {
    if (geminiClipboardBufferListener) {
      window.removeEventListener('message', geminiClipboardBufferListener);
      geminiClipboardBufferListener = null;
    }
  }

  /**
   * 顶栏仅用于即梦 / Gemini 工作台；localhost 等本站仅保留 postMessage→SW 桥，不注入 UI。
   */
  function showPicpuckAgentTopbar() {
    try {
      const h = String(location.hostname || '').toLowerCase();
      if (h === 'gemini.google.com') return true;
      return h === 'jimeng.jianying.com' || h.endsWith('.jimeng.jianying.com');
    } catch {
      return false;
    }
  }

  /** 升级扩展后移除曾注入在本站（如 localhost）的顶栏残留 */
  function removeStalePicpuckTopbar() {
    if (showPicpuckAgentTopbar()) return;
    const el = document.getElementById(TOPBAR_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /**
   * 整图已就绪后、写系统剪贴板前：内容脚本**没有** `chrome.tabs`（读 `getCurrent` 会抛错）。
   * 通过 SW 在至多 maxWaitMs 内每 pollMs 将本 Tab 置前并确认页内 `document.hasFocus()`。
   */
  /**
   * @param {number} maxWaitMs
   * @param {number} pollMs
   * @param {string} [roundId] 传入则 SW 优先用 taskBindings 解析工作台 tabId（与 sender.tab 双保险）
   */
  async function ensureThisTabActiveForClipboardOrThrow(maxWaitMs, pollMs, roundId) {
    if (!extensionRuntimeOk()) {
      throw new Error('GEMINI_CLIPBOARD_TAB_FOCUS_UNAVAILABLE');
    }
    return new Promise((resolve, reject) => {
      try {
        const payload = {
          action: '__picpuckEnsureTabFocusForClipboard',
          maxWaitMs,
          pollMs,
        };
        if (roundId && typeof roundId === 'string') payload.roundId = roundId;
        chrome.runtime.sendMessage(
          {
            type: PICPUCK_COMMAND,
            payload,
          },
          (response) => {
            let lastErr = '';
            try {
              lastErr = chrome.runtime.lastError ? String(chrome.runtime.lastError.message || '') : '';
            } catch {
              reject(new Error('GEMINI_CLIPBOARD_TAB_FOCUS_UNAVAILABLE'));
              return;
            }
            if (lastErr) {
              reject(new Error(lastErr || 'GEMINI_CLIPBOARD_TAB_FOCUS_UNAVAILABLE'));
              return;
            }
            if (response && response.ok === true) {
              resolve();
              return;
            }
            const errMsg =
              response && typeof response.error === 'string' && response.error
                ? response.error
                : 'GEMINI_CLIPBOARD_TAB_FOCUS_TIMEOUT';
            reject(new Error(errMsg));
          },
        );
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /**
   * @param {ArrayBuffer} buf
   * @param {string} contentType
   */
  /**
   * @param {Record<string, unknown>} payload
   * @returns {Promise<unknown>}
   */
  function sendPicpuckCommandAndWait(payload) {
    return new Promise((resolve, reject) => {
      if (!extensionRuntimeOk()) {
        reject(new Error('Extension context invalidated'));
        return;
      }
      try {
        chrome.runtime.sendMessage({ type: PICPUCK_COMMAND, payload }, (res) => {
          let lastErr = '';
          try {
            lastErr = chrome.runtime.lastError ? String(chrome.runtime.lastError.message || '') : '';
          } catch {
            lastErr = '';
          }
          if (lastErr) {
            reject(new Error(lastErr));
            return;
          }
          if (res && res.ok === false && typeof res.error === 'string') {
            reject(new Error(res.error));
            return;
          }
          resolve(res);
        });
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /**
   * 将整图经 SW 以 picpuck.imageRelay 分片转发回熔炉页（避免单条 runtime.sendMessage 超 64MiB）。
   */
  async function relayGeminiFullImageToCallerTab(buf, contentType, roundId, generationEvent) {
    if (!extensionRuntimeOk() || !roundId || !generationEvent) return;
    if (!(buf instanceof ArrayBuffer)) return;
    const ct = typeof contentType === 'string' && contentType ? contentType.split(';')[0].trim() : 'image/png';
    const byteLen = buf.byteLength;
    const base64CharLength = Math.ceil(byteLen / 3) * 4;
    const u8 = new Uint8Array(buf);
    /** 每段 base64 至多 262144 字符，与即梦 CHUNK 对齐 */
    const CHUNK_BYTES = 196608;
    try {
      await sendPicpuckCommandAndWait({
        action: '__picpuckGeminiRelayBegin',
        roundId,
        generationEvent,
        contentType: ct,
        base64CharLength,
      });
      let seq = 0;
      for (let off = 0; off < u8.length; off += CHUNK_BYTES) {
        const end = Math.min(off + CHUNK_BYTES, u8.length);
        const sub = u8.subarray(off, end);
        let bin = '';
        for (let i = 0; i < sub.length; i += 0x8000) {
          bin += String.fromCharCode.apply(null, sub.subarray(i, Math.min(i + 0x8000, sub.length)));
        }
        const text = btoa(bin);
        await sendPicpuckCommandAndWait({
          action: '__picpuckGeminiRelayChunk',
          roundId,
          seq,
          text,
        });
        seq += 1;
      }
      await sendPicpuckCommandAndWait({ action: '__picpuckGeminiRelayEnd', roundId });
    } catch (e) {
      console.warn('[PicPuck] relayGeminiFullImageToCallerTab failed', e);
    }
  }

  /**
   * @param {ArrayBuffer} buf
   * @param {string} contentType
   * @param {string} [roundId]
   */
  async function writeImageBufferToSystemClipboard(buf, contentType, roundId) {
    await ensureThisTabActiveForClipboardOrThrow(
      CLIPBOARD_TAB_FOCUS_MAX_MS,
      CLIPBOARD_TAB_FOCUS_POLL_MS,
      roundId,
    );
    let mime = typeof contentType === 'string' ? contentType.split(';')[0].trim().toLowerCase() : '';
    if (!mime.startsWith('image/')) mime = 'image/png';
    const blob = new Blob([buf], { type: mime });
    try {
      await navigator.clipboard.write([new ClipboardItem({ [mime]: blob })]);
      return;
    } catch (e1) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ [mime]: Promise.resolve(blob) })]);
        return;
      } catch (e2) {
        const m1 = e1 instanceof Error ? e1.message : String(e1);
        const m2 = e2 instanceof Error ? e2.message : String(e2);
        throw new Error(`${m2} | ${m1}`);
      }
    }
  }

  /** 与顶栏根背景一致，左右区盖住中层文案边缘，避免与几何居中句叠读 */
  const TOPBAR_SIDE_BG = 'rgba(20,20,24,.98)';

  /** @type {Set<string>} */
  const BUSY_PHASES = new Set(['received', 'clearing', 'running']);

  let clickTimes = [];

  /**
   * 扩展重载/更新后旧内容脚本的 `chrome.runtime` 会失效，任何访问都可能抛 Extension context invalidated。
   */
  function extensionRuntimeOk() {
    try {
      return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch {
      return false;
    }
  }

  /**
   * @param {unknown} message
   * @param {(response: unknown) => void} [responseCallback]
   */
  function safeRuntimeSendMessage(message, responseCallback) {
    if (!extensionRuntimeOk()) return;
    try {
      chrome.runtime.sendMessage(message, responseCallback);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.indexOf('Extension context invalidated') !== -1) return;
      throw e;
    }
  }

  /**
   * 中间提示相对整条顶栏几何水平居中（非「剩余 flex 区域」居中）。
   * @param {HTMLElement} root
   * @param {HTMLElement} left
   * @param {HTMLElement} center
   * @param {HTMLElement} right
   */
  function applyTopbarLayoutStyles(root, left, center, right) {
    root.style.setProperty('justify-content', 'space-between');
    root.style.setProperty('align-items', 'center');
    left.style.cssText =
      'flex:0 1 auto;max-width:42%;min-width:0;padding:4px 8px;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;position:relative;z-index:2;background:' +
      TOPBAR_SIDE_BG;
    right.style.cssText =
      'flex:0 1 auto;max-width:42%;min-width:0;padding:4px 8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;text-align:right;position:relative;z-index:2;background:' +
      TOPBAR_SIDE_BG;
    center.style.cssText = [
      'position:absolute',
      'left:50%',
      'top:50%',
      'transform:translate(-50%,-50%)',
      'z-index:1',
      'max-width:min(92vw,calc(100vw - 200px))',
      'padding:0 6px',
      'box-sizing:border-box',
      'pointer-events:none',
      'text-align:center',
      'white-space:nowrap',
      'overflow:hidden',
      'text-overflow:ellipsis',
      'color:#b8bcc8',
      'font-weight:500',
    ].join(';');
  }

  /** 若尚无根节点则创建；与 allocateTab 注入的裸根节点共存，仅补全左右子节点与样式 */
  function ensureTopbarShell() {
    if (!showPicpuckAgentTopbar()) {
      return { root: null, left: null, center: null, right: null };
    }
    let root = document.getElementById(TOPBAR_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = TOPBAR_ID;
      root.setAttribute('data-picpuck-exec-state', 'idle');
      root.style.cssText = [
        'position:fixed',
        'top:0',
        'left:0',
        'right:0',
        'z-index:2147483646',
        'display:flex',
        'flex-direction:row',
        'align-items:center',
        'justify-content:space-between',
        'min-height:28px',
        'font:12px/1.4 system-ui,sans-serif',
        'background:rgba(20,20,24,.92)',
        'color:#e8e8ec',
        'border-bottom:1px solid #333',
        'box-sizing:border-box',
      ].join(';');
      (document.body || document.documentElement).appendChild(root);
    }
    let left = root.querySelector('[data-picpuck-topbar-left]');
    if (!left) {
      left = document.createElement('div');
      left.setAttribute('data-picpuck-topbar-left', '1');
      root.appendChild(left);
    }
    let right = root.querySelector('[data-picpuck-topbar-right]');
    if (!right) {
      right = document.createElement('div');
      right.setAttribute('data-picpuck-topbar-right', '1');
      root.appendChild(right);
    }
    let center = root.querySelector('[data-picpuck-topbar-center]');
    if (!center) {
      center = document.createElement('div');
      center.setAttribute('data-picpuck-topbar-center', '1');
      root.insertBefore(center, right);
    }
    applyTopbarLayoutStyles(root, left, center, right);
    return { root, left, center, right };
  }

  function applyRoundPhase(payload) {
    if (!showPicpuckAgentTopbar()) return;
    const { root, left, center, right } = ensureTopbarShell();
    if (!root || !left || !center || !right) return;
    const phase = payload && payload.phase != null ? String(payload.phase) : 'idle';
    const roundShort = payload && payload.roundIdShort != null ? String(payload.roundIdShort) : '—';
    const lastInfo = payload && payload.lastInfoMessage != null ? String(payload.lastInfoMessage) : '';
    /** 新建顶栏时 ensureTopbarShell 默认 exec-state=idle；须与 phase 一致，否则 SW 已 running 但属性仍 idle（Jimeng 重绘/同步顶栏后常见）。 */
    root.setAttribute('data-picpuck-exec-state', BUSY_PHASES.has(phase) ? 'running' : 'idle');
    left.textContent = '当前轮次 ' + roundShort + ' · ' + phase;
    center.textContent = BUSY_PHASES.has(phase)
      ? 'PicPuck Agent 正在执行任务，请勿进行操作'
      : 'PicPuck Agent 等待新的任务';
    right.textContent = lastInfo;
    right.setAttribute('title', lastInfo);
  }

  function flashCopySuccess(leftEl) {
    const prev = leftEl.style.backgroundColor;
    leftEl.style.backgroundColor = COPY_FLASH_COLOR;
    setTimeout(() => {
      leftEl.style.backgroundColor = prev;
    }, COPY_FLASH_MS);
  }

  function copyTextFallback(text, onOk) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      (document.body || document.documentElement).appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand('copy');
      if (ta.parentNode) ta.parentNode.removeChild(ta);
      if (ok) onOk();
    } catch (_) {
      /* ignore */
    }
  }

  /** §4.2：导出前再按 ts 升序排序，与 SW 侧 RoundContext / 快照约定一致 */
  function requestLogsAndCopy(leftEl) {
    safeRuntimeSendMessage({ type: PICPUCK_COMMAND, payload: { type: PAGE_CMD, action: '__picpuckCopyLogs' } }, (res) => {
      let lastErr = '';
      try {
        lastErr = chrome.runtime.lastError ? String(chrome.runtime.lastError.message || '') : '';
      } catch {
        return;
      }
      if (lastErr) return;
      if (!res || !res.ok || !Array.isArray(res.logs)) {
        return;
      }
      const sorted = [...res.logs].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const text = JSON.stringify(sorted);
      const done = () => flashCopySuccess(leftEl);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => copyTextFallback(text, done));
      } else {
        copyTextFallback(text, done);
      }
    });
  }

  function onLeftClick(e) {
    const left = e.currentTarget;
    const now = Date.now();
    clickTimes.push(now);
    clickTimes = clickTimes.filter((t) => now - t <= TRIPLE_CLICK_MS);
    if (clickTimes.length >= 3) {
      clickTimes = [];
      requestLogsAndCopy(left);
    }
  }

  function wireLeftClick() {
    if (!showPicpuckAgentTopbar()) return;
    const { left } = ensureTopbarShell();
    if (!left) return;
    left.removeEventListener('click', onLeftClick);
    left.addEventListener('click', onLeftClick);
  }

  function delayMsJimeng(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  async function blobToBase64Pure(blob) {
    const ab = await blob.arrayBuffer();
    const u8 = new Uint8Array(ab);
    const CH = 0x8000;
    let bin = '';
    for (let i = 0; i < u8.length; i += CH) {
      bin += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length)));
    }
    return btoa(bin);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    const safeRespond = (obj) => {
      try {
        sendResponse(obj);
      } catch {
        /* Extension context invalidated 等 */
      }
    };
    if (msg.type === PICPUCK_EXTENSION_ACCESS_TOKEN_REQUEST && msg.requestId) {
      const requestId = msg.requestId;
      (async () => {
        try {
          const apiBase = window.location.origin;
          const res = await fetch(`${apiBase}/api/generation/event/extension-access-token`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          });
          const json = await res.json().catch(() => ({}));
          const tok = json?.data?.extension_access_token;
          if (res.ok && typeof tok === 'string' && tok.trim()) {
            safeRespond({ ok: true, requestId, token: tok.trim(), apiBase });
          } else {
            safeRespond({
              ok: false,
              requestId,
              error: json?.detail || json?.message || `HTTP_${res.status}`,
            });
          }
        } catch (e) {
          safeRespond({
            ok: false,
            requestId,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      })();
      return true;
    }
    if (msg.type === PICPUCK_ASYNC_GEN_PAGE && msg.envelope && typeof msg.envelope === 'object') {
      try {
        window.postMessage(msg.envelope, window.location.origin);
        safeRespond({ ok: true });
      } catch (e) {
        safeRespond({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (msg.type === PICPUCK_GEMINI_GENERATED_IMAGE) {
      try {
        window.postMessage(
          {
            type: 'IdlinkExtensionGeminiGeneratedImage',
            imageBase64: msg.imageBase64,
            contentType: msg.contentType,
            generationEvent: msg.generationEvent,
          },
          window.location.origin,
        );
        safeRespond({ ok: true });
      } catch (e) {
        safeRespond({ ok: false });
      }
      return;
    }
    if (msg.type === PICPUCK_IMAGE_RELAY) {
      const env = msg.envelope;
      if (!env || typeof env !== 'object') {
        safeRespond({ ok: false, error: 'bad envelope' });
        return;
      }
      try {
        window.postMessage(env, window.location.origin);
        safeRespond({ ok: true });
      } catch (e) {
        safeRespond({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
      return;
    }
    if (msg.type === ROUND_PHASE) {
      applyRoundPhase(msg.payload);
      wireLeftClick();
      safeRespond({ ok: true });
      return;
    }
    if (msg.type === LOG_APPEND) {
      safeRespond({ ok: true });
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (d && d.type === 'PICPUCK_MCUP_ASYNC' && d.kind === 'SET_ACCESS_TOKEN') {
      const token = typeof d.token === 'string' ? d.token.trim() : '';
      const apiBase = typeof d.apiBase === 'string' ? d.apiBase.trim() : '';
      if (token) {
        try {
          chrome.storage.session.set({
            picpuckMcupExtensionAccessToken: token,
            picpuckMcupApiBase: apiBase,
          });
        } catch (_) {
          /* ignore */
        }
      }
      return;
    }
    // MAIN 世界无 chrome.*，由页面 postMessage 经此桥到 SW
    if (d && d.picpuckBridge === true && d.kind === 'LOG_APPEND' && d.entry) {
      safeRuntimeSendMessage({ type: LOG_APPEND, entry: d.entry });
      return;
    }
    if (d && d.picpuckBridge === true && d.kind === 'JIMENG_CLIPBOARD_READ_ARM') {
      const requestId = typeof d.requestId === 'string' ? d.requestId : '';
      const prevB64 = typeof d.previousImageBase64 === 'string' ? d.previousImageBase64 : '';
      (async () => {
        const reply = (obj) => {
          try {
            window.postMessage(
              {
                picpuckBridge: true,
                kind: 'JIMENG_CLIPBOARD_READ_RESULT',
                requestId,
                ...obj,
              },
              window.location.origin,
            );
          } catch (_) {
            /* ignore */
          }
        };
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          try {
            if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
              await delayMsJimeng(200);
              continue;
            }
            const items = await navigator.clipboard.read();
            let pickedB64 = '';
            let pickedCt = 'image/png';
            const order = ['image/png', 'image/jpeg', 'image/webp'];
            outer: for (const item of items) {
              const types = Array.isArray(item.types) ? item.types : [];
              for (let oi = 0; oi < order.length; oi += 1) {
                const mime = order[oi];
                if (!types.includes(mime)) continue;
                const blob = await item.getType(mime);
                const b64 = await blobToBase64Pure(blob);
                pickedB64 = b64;
                pickedCt = mime;
                break outer;
              }
            }
            if (pickedB64 && pickedB64 !== prevB64) {
              reply({ ok: true, imageBase64: pickedB64, contentType: pickedCt });
              return;
            }
          } catch (_) {
            /* 继续轮询 */
          }
          await delayMsJimeng(200);
        }
        reply({ ok: false, code: 'JIMENG_CLIPBOARD_IMAGE_TIMEOUT' });
      })();
      return;
    }
    /** MAIN 先发 ARM，本处挂上 BUFFER 专用监听后再 ARM_READY，避免 BUFFER 早于监听 */
    if (d && d.picpuckBridge === true && d.kind === 'GEMINI_FULL_IMAGE_CLIPBOARD_ARM') {
      removeGeminiClipboardBufferListener();
      const relayRoundId = typeof d.roundId === 'string' ? d.roundId : '';
      const relayGen =
        d.generationEvent && typeof d.generationEvent === 'object' ? d.generationEvent : null;
      geminiClipboardBufferListener = function onGeminiFullImageBuffer(event) {
        if (event.source !== window) return;
        const p = event.data;
        if (!p || p.picpuckBridge !== true || p.kind !== 'GEMINI_FULL_IMAGE_BUFFER') return;
        window.removeEventListener('message', geminiClipboardBufferListener);
        geminiClipboardBufferListener = null;
        (async () => {
          let ok = false;
          let err = '';
          let bufForRelay = null;
          let ctForRelay = 'image/png';
          try {
            const buf = p._buffer;
            if (!(buf instanceof ArrayBuffer)) {
              throw new Error('剪贴板数据不是 ArrayBuffer');
            }
            const ctRaw = typeof p.contentType === 'string' && p.contentType ? p.contentType : 'image/png';
            ctForRelay = ctRaw;
            if (relayGen && relayRoundId) {
              try {
                bufForRelay = buf.slice(0);
              } catch (eCopy) {
                bufForRelay = null;
              }
            }
            await writeImageBufferToSystemClipboard(buf, ctRaw, relayRoundId || undefined);
            ok = true;
          } catch (e) {
            err = e instanceof Error ? e.message : String(e);
          }
          window.postMessage(
            {
              picpuckBridge: true,
              kind: 'GEMINI_FULL_IMAGE_CLIPBOARD_DONE',
              ok,
              error: ok ? undefined : err || 'GEMINI_CLIPBOARD_FAILED',
            },
            window.location.origin,
          );
          if (ok && bufForRelay && relayGen && relayRoundId) {
            await relayGeminiFullImageToCallerTab(bufForRelay, ctForRelay, relayRoundId, relayGen);
          }
        })();
      };
      window.addEventListener('message', geminiClipboardBufferListener);
      window.postMessage(
        { picpuckBridge: true, kind: 'GEMINI_FULL_IMAGE_CLIPBOARD_ARM_READY' },
        window.location.origin,
      );
      return;
    }
    if (d && d.picpuckBridge === true && d.kind === 'GEMINI_FULL_IMAGE_CLIPBOARD_ABORT') {
      removeGeminiClipboardBufferListener();
      return;
    }
    if (d && d.type === PAGE_CMD && d.action === 'picpuckAsyncGeneration') {
      safeRuntimeSendMessage({ type: PICPUCK_COMMAND, payload: d }, (res) => {
        let lastErr = '';
        try {
          lastErr = chrome.runtime.lastError ? String(chrome.runtime.lastError.message || '') : '';
        } catch {
          return;
        }
        if (lastErr) return;
        if (res && res.ok === false && res.error) {
          try {
            window.postMessage(
              { type: 'PICPUCK_ASYNC_GEN_FAIL', error: String(res.error) },
              window.location.origin,
            );
          } catch {
            /* ignore */
          }
        }
      });
      return;
    }
    if (!d || d.type !== PAGE_CMD) return;
    const replyError = (errorMsg) => {
      try {
        window.postMessage(
          {
            type: 'IdlinkExtensionCommandResult',
            action: d.action,
            ok: false,
            error: errorMsg,
          },
          window.location.origin,
        );
      } catch {
        /* ignore */
      }
    };
    try {
      safeRuntimeSendMessage({ type: PICPUCK_COMMAND, payload: d }, (res) => {
        let lastErr = '';
        try {
          lastErr = chrome.runtime.lastError ? String(chrome.runtime.lastError.message || '') : '';
        } catch {
          return;
        }
        if (lastErr) return;
        const reply = {
          type: 'IdlinkExtensionCommandResult',
          action: d.action,
          ok: !!(res && res.ok),
          error: res && res.error,
          roundId: res && res.roundId,
          tabId: res && res.tabId,
          phase: res && res.phase,
        };
        window.postMessage(reply, window.location.origin);
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.indexOf('maximum allowed size') !== -1 || m.indexOf('64MiB') !== -1) {
        replyError(
          '扩展单消息体积超过浏览器上限（参考图 data URL 过大）。请减少 @ 引用或依赖页面已做的自动压缩后重试。',
        );
        return;
      }
      replyError(m || 'runtime.sendMessage 失败');
    }
  });

  const idlePayload = { phase: 'idle', roundIdShort: '—', lastInfoMessage: '' };

  function initTopbarIfWorkbench() {
    removeStalePicpuckTopbar();
    if (!showPicpuckAgentTopbar()) return;
    ensureTopbarShell();
    function finishTopbarPhase(payload) {
      applyRoundPhase(payload);
      wireLeftClick();
    }
    try {
      chrome.runtime.sendMessage(
        { type: PICPUCK_COMMAND, payload: { action: '__picpuckSyncTopbarFromSw' } },
        (res) => {
          let err = '';
          try {
            err = chrome.runtime.lastError ? String(chrome.runtime.lastError.message || '') : '';
          } catch {
            err = '';
          }
          if (!err && res && res.ok === true && res.phasePayload && typeof res.phasePayload === 'object') {
            finishTopbarPhase(res.phasePayload);
          } else {
            finishTopbarPhase(idlePayload);
          }
        },
      );
    } catch {
      finishTopbarPhase(idlePayload);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTopbarIfWorkbench);
  } else {
    initTopbarIfWorkbench();
  }

  /** Gemini：URL 带 picpuck_net_hook=1 或 =all 时注入 MAIN 世界网络测试钩子（控制台看 [PicPuck net-test]） */
  (function requestGeminiNetHookIfQuery() {
    try {
      if (typeof location.hostname !== 'string' || location.hostname.indexOf('gemini.google.com') === -1) {
        return;
      }
      if (!/[?&]picpuck_net_hook=(?:1|all)(?:&|$)/.test(location.search || '')) {
        return;
      }
      safeRuntimeSendMessage({ type: PICPUCK_COMMAND, payload: { action: '__picpuckGeminiNetHookTest' } });
    } catch (_) {
      /* ignore */
    }
  })();
})();
