/* global chrome */
/**
 * 内容脚本（隔离世界）：与页面共享 DOM，可改 `#picpuck-agent-topbar`；与 SW 用 runtime 消息通信。
 *
 * - §4.1：左约 40% 状态区 + 右 lastInfo（`title` 展示全文）；`data-picpuck-exec-state` 由 §9.3 在 MAIN 世界维护
 * - §4.2：600ms 内三次点击左侧 → 向 SW 索取日志 JSON 并写入剪贴板
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

  let clickTimes = [];

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
        'align-items:stretch',
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
      left.style.cssText =
        'width:40%;flex:0 0 40%;padding:4px 8px;cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
      root.appendChild(left);
    }
    let right = root.querySelector('[data-picpuck-topbar-right]');
    if (!right) {
      right = document.createElement('div');
      right.setAttribute('data-picpuck-topbar-right', '1');
      right.style.cssText =
        'flex:1;min-width:0;padding:4px 8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;';
      root.appendChild(right);
    }
    return { root, left, right };
  }

  function applyRoundPhase(payload) {
    const { left, right } = ensureTopbarShell();
    const phase = payload && payload.phase != null ? String(payload.phase) : 'idle';
    const roundShort = payload && payload.roundIdShort != null ? String(payload.roundIdShort) : '—';
    const lastInfo = payload && payload.lastInfoMessage != null ? String(payload.lastInfoMessage) : '';
    left.textContent = '当前轮次 ' + roundShort + ' · ' + phase;
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

  /** §4.2：导出前再按 ts 升序排序，与 SW 侧 RoundContext 约定一致 */
  function requestLogsAndCopy(leftEl) {
    chrome.runtime.sendMessage(
      { type: PICPUCK_COMMAND, payload: { type: PAGE_CMD, action: '__picpuckCopyLogs' } },
      (res) => {
        if (chrome.runtime.lastError || !res || !res.ok || !Array.isArray(res.logs)) {
          return;
        }
        const sorted = [...res.logs].sort((a, b) => (a.ts || 0) - (b.ts || 0));
        const text = JSON.stringify(sorted);
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(
            () => flashCopySuccess(leftEl),
            () => {},
          );
        }
      },
    );
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
    if (msg.type === ROUND_PHASE) {
      applyRoundPhase(msg.payload);
      wireLeftClick();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === LOG_APPEND) {
      sendResponse({ ok: true });
    }
  });

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    // MAIN 世界无 chrome.*，由页面 postMessage 经此桥到 SW
    if (d && d.picpuckBridge === true && d.kind === 'LOG_APPEND' && d.entry) {
      chrome.runtime.sendMessage({ type: LOG_APPEND, entry: d.entry });
      return;
    }
    if (!d || d.type !== PAGE_CMD) return;
    chrome.runtime.sendMessage({ type: PICPUCK_COMMAND, payload: d }, (res) => {
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureTopbarShell();
      wireLeftClick();
    });
  } else {
    ensureTopbarShell();
    wireLeftClick();
  }
})();
