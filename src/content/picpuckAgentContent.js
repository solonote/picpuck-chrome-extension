/* global chrome */
/**
 * 内容脚本（隔离世界）：与页面共享 DOM，可改 `#picpuck-agent-topbar`；与 SW 用 runtime 消息通信。
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

  const TOPBAR_ID = 'picpuck-agent-topbar';
  const COPY_FLASH_MS = 300;
  const COPY_FLASH_COLOR = '#1a3d1a';
  const TRIPLE_CLICK_MS = 600;

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
    const { left, center, right } = ensureTopbarShell();
    const phase = payload && payload.phase != null ? String(payload.phase) : 'idle';
    const roundShort = payload && payload.roundIdShort != null ? String(payload.roundIdShort) : '—';
    const lastInfo = payload && payload.lastInfoMessage != null ? String(payload.lastInfoMessage) : '';
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
    const { left } = ensureTopbarShell();
    left.removeEventListener('click', onLeftClick);
    left.addEventListener('click', onLeftClick);
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
    // MAIN 世界无 chrome.*，由页面 postMessage 经此桥到 SW
    if (d && d.picpuckBridge === true && d.kind === 'LOG_APPEND' && d.entry) {
      safeRuntimeSendMessage({ type: LOG_APPEND, entry: d.entry });
      return;
    }
    /** MAIN 捕获整图二进制后交内容脚本写剪贴板（MAIN 无 clipboard API） */
    if (d && d.picpuckBridge === true && d.kind === 'GEMINI_FULL_IMAGE_BUFFER') {
      (async () => {
        let ok = false;
        let err = '';
        try {
          const buf = d._buffer;
          if (!(buf instanceof ArrayBuffer)) {
            throw new Error('GEMINI_CLIPBOARD_FAILED');
          }
          const ctRaw = typeof d.contentType === 'string' && d.contentType ? d.contentType : 'image/png';
          const blob = new Blob([buf], { type: ctRaw.split(';')[0].trim() });
          await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
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
      })();
      return;
    }
    if (!d || d.type !== PAGE_CMD) return;
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
  });

  const idlePayload = { phase: 'idle', roundIdShort: '—', lastInfoMessage: '' };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureTopbarShell();
      applyRoundPhase(idlePayload);
      wireLeftClick();
    });
  } else {
    ensureTopbarShell();
    applyRoundPhase(idlePayload);
    wireLeftClick();
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
