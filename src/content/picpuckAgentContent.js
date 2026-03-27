/* global chrome */
/**
 * 内容脚本（隔离世界）：在即梦/Gemini **且 Tab 位于 PicPuck 蓝组内**时注入顶栏 `#picpuck-agent-topbar`；本站（如 localhost）仅作 postMessage→SW 桥，不显示顶栏。
 *
 * - §4.1：左黑框「当前轮次」+ 三连击复制日志；中：机器人 SVG + 主文案 + `STEP NN //` 与动作摘要；右：最后一条 info 摘要；执行中全视口霓虹边（pointer-events 不挡页面）
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
   * 顶栏目标站点（即梦 / Gemini）；是否与 PicPuck 工作区同组由 `shouldShowWorkspaceTopbar` 判定。
   */
  function isWorkspaceSiteHost() {
    try {
      const h = String(location.hostname || '').toLowerCase();
      if (h === 'gemini.google.com') return true;
      return h === 'jimeng.jianying.com' || h.endsWith('.jimeng.jianying.com');
    } catch {
      return false;
    }
  }

  function removePicpuckTopbarDom() {
    const el = document.getElementById(TOPBAR_ID);
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /**
   * 由 SW 读取 `tabs` + session 中 PicPuck 组映射，与 `allocateTab` 候选规则一致。
   * @returns {Promise<boolean>}
   */
  function shouldShowWorkspaceTopbar() {
    if (!isWorkspaceSiteHost()) return Promise.resolve(false);
    if (!extensionRuntimeOk()) return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: PICPUCK_COMMAND, payload: { action: '__picpuckWorkspaceTopbarEligible' } },
          (res) => {
            let lastErr = '';
            try {
              lastErr = chrome.runtime.lastError ? String(chrome.runtime.lastError.message || '') : '';
            } catch {
              lastErr = '';
            }
            if (lastErr) {
              resolve(false);
              return;
            }
            resolve(!!(res && res.ok && res.eligible === true));
          },
        );
      } catch {
        resolve(false);
      }
    });
  }

  /** 升级扩展后移除曾注入在本站（如 localhost）的顶栏残留；非工作台域名必清 DOM */
  function removeStalePicpuckTopbar() {
    if (!isWorkspaceSiteHost()) {
      removePicpuckTopbarDom();
    }
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

  const STYLE_ID = 'picpuck-agent-topbar-styles';

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
   * @param {string} lastInfo
   * @returns {{ step: number | null, action: string }}
   */
  function parseStepFromLastInfo(lastInfo) {
    const s = typeof lastInfo === 'string' ? lastInfo.trim() : '';
    if (!s) return { step: null, action: '' };
    const m = s.match(/^Step(\d+)\.(.+)$/i);
    if (m) return { step: parseInt(m[1], 10), action: m[2].trim() };
    const m2 = s.match(/Step(\d+)/i);
    return { step: m2 ? parseInt(m2[1], 10) : null, action: s };
  }

  function injectTopbarStylesOnce() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      ':root{--pp-accent-cyan:#00f0ff;--pp-accent-cyan-glow:rgba(0,240,255,.5);--pp-accent-purple:#AF40FF;',
      '--pp-bg-panel:rgba(10,12,16,.92);--pp-text-bright:#f8fafc;--pp-text-main:#cbd5e1;--pp-text-dim:#64748b;',
      '--pp-font-sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--pp-font-mono:ui-monospace,SFMono-Regular,Consolas,monospace;}',
      '#picpuck-agent-topbar{position:fixed;top:0;left:0;right:0;z-index:2147483646;box-sizing:border-box;',
      'font:13px/1.45 var(--pp-font-sans);color:var(--pp-text-bright);pointer-events:none;}',
      '#picpuck-agent-rim{position:fixed;inset:0;z-index:2147483645;pointer-events:none;opacity:0;transition:opacity .35s ease;',
      'box-shadow:0 0 5px var(--pp-accent-cyan),inset 0 0 15px rgba(0,240,255,.8),inset 0 0 50px var(--pp-accent-cyan-glow),inset 0 0 150px rgba(0,240,255,.1);',
      'border:1.5px solid rgba(0,240,255,.7);border-radius:2px;animation:pp-breathing-field 4s infinite alternate ease-in-out;}',
      '@keyframes pp-breathing-field{0%{box-shadow:0 0 5px var(--pp-accent-cyan),inset 0 0 15px rgba(0,240,255,.8),inset 0 0 50px var(--pp-accent-cyan-glow),inset 0 0 150px rgba(0,240,255,.1);border-color:rgba(0,240,255,.7);}',
      '100%{box-shadow:0 0 10px var(--pp-accent-cyan),inset 0 0 25px rgba(0,240,255,1),inset 0 0 80px rgba(0,240,255,.6),inset 0 0 200px rgba(0,240,255,.2);border-color:rgba(0,240,255,1);}}',
      '#picpuck-agent-topbar[data-picpuck-exec-state="running"] #picpuck-agent-rim{opacity:1;}',
      '#picpuck-agent-topbar[data-picpuck-exec-state="idle"] #picpuck-agent-rim{opacity:0;animation:none;box-shadow:none;border-color:transparent;}',
      '#picpuck-agent-topbar .picpuck-topbar-inner{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2;display:flex;flex-direction:row;',
      'align-items:stretch;justify-content:center;min-height:52px;pointer-events:auto;width:auto;max-width:min(92vw,720px);',
      'background:var(--pp-bg-panel);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);',
      'border:1px solid rgba(0,240,255,.35);border-top:none;border-radius:0 0 12px 12px;box-sizing:border-box;padding:8px 16px 10px;}',
      '#picpuck-agent-topbar[data-picpuck-exec-state="running"] .picpuck-topbar-inner{border-color:rgba(0,240,255,.8);',
      'box-shadow:0 8px 28px rgba(0,0,0,.45),inset 0 0 4px var(--pp-accent-cyan-glow);}',
      '.picpuck-banner-block{flex:1 1 auto;min-width:0;width:100%;}',
      '.picpuck-banner-row{display:flex;flex-direction:row;align-items:center;justify-content:flex-start;gap:12px;min-height:44px;}',
      '.picpuck-banner-text-col{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;flex:1;min-width:0;pointer-events:none;}',
      '.picpuck-main-title{font-size:14px;font-weight:600;letter-spacing:.02em;color:var(--pp-text-bright);text-align:left;width:100%;',
      'text-shadow:0 0 6px rgba(0,240,255,.25);}',
      '#picpuck-agent-topbar[data-picpuck-exec-state="running"] .picpuck-main-title{text-shadow:0 0 8px var(--pp-accent-cyan);}',
      '.picpuck-status-line{display:flex;flex-direction:row;align-items:center;justify-content:flex-start;gap:8px;width:100%;',
      'font-family:var(--pp-font-mono);font-size:12px;letter-spacing:.4px;color:var(--pp-text-dim);}',
      '.picpuck-step-label::before{content:"";display:inline-block;width:14px;height:2px;background:var(--pp-text-dim);margin-right:2px;vertical-align:middle;}',
      '.picpuck-step-action{color:var(--pp-accent-cyan);font-weight:600;text-shadow:0 0 10px rgba(0,240,255,.4);max-width:min(70vw,420px);',
      'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:none;}',
      '.picpuck-bot-wrap{flex-shrink:0;width:44px;height:44px;display:flex;align-items:center;justify-content:center;',
      'cursor:pointer;pointer-events:auto;border-radius:8px;}',
      '.picpuck-bot-icon{width:40px;height:40px;display:block;filter:drop-shadow(0 0 6px rgba(0,240,255,.35));}',
      '#picpuck-agent-topbar[data-picpuck-exec-state="idle"] .picpuck-bot-icon{filter:none;}',
      '.picpuck-bot-body-group{animation:pp-hover-float 2.5s ease-in-out infinite alternate;transform-origin:center;}',
      '.picpuck-bot-shadow{animation:pp-shadow-scale 2.5s ease-in-out infinite alternate;transform-origin:center;}',
      '.picpuck-bot-eye{animation:pp-eye-scan 1.5s cubic-bezier(0.4,0,0.2,1) infinite alternate;}',
      '.picpuck-bot-arm-left{animation:pp-typing-left .3s infinite alternate;transform-origin:30px 65px;}',
      '.picpuck-bot-arm-right{animation:pp-typing-right .35s infinite alternate;transform-origin:90px 65px;}',
      '.picpuck-bot-antenna-bulb{animation:pp-signal-pulse .8s ease-in-out infinite alternate;}',
      '.picpuck-holo-keyboard{animation:pp-holo-flicker 2s infinite;}',
      '.picpuck-data-particle{animation:pp-particle-rise 2s linear infinite;}',
      '.picpuck-data-particle.pp-p2{animation-delay:.7s;animation-duration:2.5s;}',
      '.picpuck-data-particle.pp-p3{animation-delay:1.2s;animation-duration:1.8s;}',
      '@keyframes pp-hover-float{0%{transform:translateY(3px)}100%{transform:translateY(-3px)}}',
      '@keyframes pp-shadow-scale{0%{transform:scale(1.05);opacity:.75}100%{transform:scale(.85);opacity:.35}}',
      '@keyframes pp-eye-scan{0%{transform:translateX(0);width:8px}15%{transform:translateX(0);width:8px}50%{width:18px}',
      '85%{transform:translateX(18px);width:8px}100%{transform:translateX(18px);width:8px}}',
      '@keyframes pp-typing-left{0%{transform:rotate(0) translateY(0)}100%{transform:rotate(15deg) translateY(4px)}}',
      '@keyframes pp-typing-right{0%{transform:rotate(0) translateY(0)}100%{transform:rotate(-12deg) translateY(5px)}}',
      '@keyframes pp-signal-pulse{0%{fill:#AF40FF;filter:drop-shadow(0 0 2px #AF40FF)}100%{fill:#e5b3ff;filter:drop-shadow(0 0 8px #AF40FF)}}',
      '@keyframes pp-holo-flicker{0%,100%{opacity:.5}50%{opacity:1;filter:drop-shadow(0 0 4px #00f0ff)}52%{opacity:.35}54%{opacity:.85}}',
      '@keyframes pp-particle-rise{0%{transform:translateY(0) scale(0);opacity:0}20%{transform:translateY(-8px) scale(1);opacity:1}',
      '80%{transform:translateY(-24px) scale(1);opacity:.75}100%{transform:translateY(-32px) scale(0);opacity:0}}',
      '#picpuck-agent-topbar.picpuck-bot-idle .picpuck-bot-body-group,#picpuck-agent-topbar.picpuck-bot-idle .picpuck-bot-shadow,',
      '#picpuck-agent-topbar.picpuck-bot-idle .picpuck-bot-eye,#picpuck-agent-topbar.picpuck-bot-idle .picpuck-bot-arm-left,',
      '#picpuck-agent-topbar.picpuck-bot-idle .picpuck-bot-arm-right,#picpuck-agent-topbar.picpuck-bot-idle .picpuck-bot-antenna-bulb,',
      '#picpuck-agent-topbar.picpuck-bot-idle .picpuck-holo-keyboard,#picpuck-agent-topbar.picpuck-bot-idle .picpuck-data-particle{animation:none!important;}',
    ].join('');
    (document.head || document.documentElement).appendChild(style);
  }

  /** 与 ui-design/Extension_SVG.HTML 一致，类名加 picpuck- 前缀避免与页面冲突 */
  function botSvgMarkup() {
    return (
      '<svg class="picpuck-bot-icon" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<g class="picpuck-holo-keyboard"><ellipse cx="60" cy="105" rx="35" ry="6" fill="none" stroke="#00f0ff" stroke-width="1" opacity="0.3"/>' +
      '<line x1="40" y1="105" x2="80" y2="105" stroke="#00f0ff" stroke-width="2" stroke-linecap="round" opacity="0.8"/>' +
      '<line x1="50" y1="100" x2="70" y2="100" stroke="#00f0ff" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/></g>' +
      '<ellipse cx="60" cy="110" rx="20" ry="3" fill="#00f0ff" opacity="0.5" class="picpuck-bot-shadow"/>' +
      '<circle cx="25" cy="80" r="2" fill="#00f0ff" class="picpuck-data-particle"/>' +
      '<circle cx="95" cy="60" r="1.5" fill="#AF40FF" class="picpuck-data-particle pp-p2"/>' +
      '<circle cx="30" cy="40" r="2.5" fill="#00f0ff" class="picpuck-data-particle pp-p3"/>' +
      '<g class="picpuck-bot-body-group">' +
      '<line x1="60" y1="35" x2="60" y2="15" stroke="#AF40FF" stroke-width="2.5" stroke-linecap="round"/>' +
      '<circle cx="60" cy="15" r="4" fill="#AF40FF" class="picpuck-bot-antenna-bulb"/>' +
      '<rect x="35" y="35" width="50" height="45" rx="14" fill="#0d1117" stroke="#00f0ff" stroke-width="2.5"/>' +
      '<rect x="42" y="45" width="36" height="16" rx="6" fill="#030407"/>' +
      '<rect x="46" y="50" width="8" height="6" rx="3" fill="#00f0ff" class="picpuck-bot-eye"/>' +
      '<line x1="50" y1="70" x2="70" y2="70" stroke="#262c36" stroke-width="2" stroke-linecap="round"/>' +
      '<line x1="55" y1="74" x2="65" y2="74" stroke="#262c36" stroke-width="2" stroke-linecap="round"/>' +
      '<g class="picpuck-bot-arm-left"><rect x="23" y="55" width="8" height="22" rx="4" fill="#0d1117" stroke="#AF40FF" stroke-width="2"/>' +
      '<circle cx="27" cy="73" r="2" fill="#AF40FF"/></g>' +
      '<g class="picpuck-bot-arm-right"><rect x="89" y="55" width="8" height="22" rx="4" fill="#0d1117" stroke="#AF40FF" stroke-width="2"/>' +
      '<circle cx="93" cy="73" r="2" fill="#AF40FF"/></g></g></svg>'
    );
  }

  /** 若尚无根节点则创建；与 allocateTab 注入的裸根节点共存 */
  function ensureTopbarShell() {
    if (!isWorkspaceSiteHost()) {
      return { root: null, center: null, logTarget: null };
    }
    injectTopbarStylesOnce();
    let root = document.getElementById(TOPBAR_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = TOPBAR_ID;
      root.setAttribute('data-picpuck-exec-state', 'idle');
      root.className = 'picpuck-bot-idle';
      (document.body || document.documentElement).appendChild(root);
    }
    if (!root.querySelector('.picpuck-topbar-inner')) {
      root
        .querySelectorAll(':scope > [data-picpuck-topbar-left], :scope > [data-picpuck-topbar-center], :scope > [data-picpuck-topbar-right]')
        .forEach((el) => {
          el.remove();
        });
    }
    let rim = root.querySelector('#picpuck-agent-rim');
    if (!rim) {
      rim = document.createElement('div');
      rim.id = 'picpuck-agent-rim';
      rim.setAttribute('aria-hidden', 'true');
      root.insertBefore(rim, root.firstChild);
    }
    let inner = root.querySelector('.picpuck-topbar-inner');
    if (!inner) {
      inner = document.createElement('div');
      inner.className = 'picpuck-topbar-inner';
      root.appendChild(inner);
    }
    inner.querySelectorAll('[data-picpuck-topbar-left],[data-picpuck-topbar-right]').forEach((el) => el.remove());
    let center = inner.querySelector('[data-picpuck-topbar-center]');
    const needsRebuild =
      !center ||
      !center.querySelector('.picpuck-banner-text-col') ||
      !center.querySelector('[data-picpuck-main-title]');
    if (needsRebuild) {
      if (center) center.remove();
      center = document.createElement('div');
      center.setAttribute('data-picpuck-topbar-center', '1');
      center.className = 'picpuck-banner-block';
      inner.appendChild(center);
    }
    if (!center.querySelector('.picpuck-banner-row')) {
      center.textContent = '';
      const row = document.createElement('div');
      row.className = 'picpuck-banner-row';
      const botWrap = document.createElement('div');
      botWrap.className = 'picpuck-bot-wrap';
      botWrap.setAttribute('data-picpuck-log-target', '1');
      botWrap.innerHTML = botSvgMarkup();
      const textCol = document.createElement('div');
      textCol.className = 'picpuck-banner-text-col';
      const mainTitle = document.createElement('div');
      mainTitle.className = 'picpuck-main-title';
      mainTitle.setAttribute('data-picpuck-main-title', '1');
      const statusLine = document.createElement('div');
      statusLine.className = 'picpuck-status-line';
      const stepLab = document.createElement('span');
      stepLab.className = 'picpuck-step-label';
      stepLab.setAttribute('data-picpuck-step-label', '1');
      stepLab.textContent = 'STEP -- //';
      const stepAct = document.createElement('span');
      stepAct.className = 'picpuck-step-action';
      stepAct.setAttribute('data-picpuck-step-action', '1');
      statusLine.appendChild(stepLab);
      statusLine.appendChild(stepAct);
      textCol.appendChild(mainTitle);
      textCol.appendChild(statusLine);
      row.appendChild(botWrap);
      row.appendChild(textCol);
      center.appendChild(row);
    }
    const logTarget = center.querySelector('[data-picpuck-log-target]');
    return { root, center, logTarget };
  }

  async function applyRoundPhase(payload) {
    if (!(await shouldShowWorkspaceTopbar())) {
      removePicpuckTopbarDom();
      return;
    }
    const { root, center } = ensureTopbarShell();
    if (!root || !center) return;
    const phase = payload && payload.phase != null ? String(payload.phase) : 'idle';
    const lastInfo = payload && payload.lastInfoMessage != null ? String(payload.lastInfoMessage) : '';
    const busy = BUSY_PHASES.has(phase);
    /** 新建顶栏时 ensureTopbarShell 默认 exec-state=idle；须与 phase 一致，否则 SW 已 running 但属性仍 idle（Jimeng 重绘/同步顶栏后常见）。 */
    root.setAttribute('data-picpuck-exec-state', busy ? 'running' : 'idle');
    if (busy) {
      root.classList.remove('picpuck-bot-idle');
    } else {
      root.classList.add('picpuck-bot-idle');
    }
    const mainTitle = center.querySelector('[data-picpuck-main-title]');
    const stepLabelEl = center.querySelector('[data-picpuck-step-label]');
    const stepActEl = center.querySelector('[data-picpuck-step-action]');
    if (mainTitle) {
      mainTitle.textContent = busy
        ? 'PicPuck Agent 正在进行操作，请勿执行操作或切换窗口'
        : 'PicPuck Agent 正在等待任务';
    }
    const { step: stepNum, action: actionText } = parseStepFromLastInfo(lastInfo);
    if (stepLabelEl) {
      if (!busy) {
        stepLabelEl.style.display = 'none';
      } else {
        stepLabelEl.style.display = '';
        stepLabelEl.textContent = 'STEP ' + (stepNum != null ? String(stepNum).padStart(2, '0') : '--') + ' //';
      }
    }
    if (stepActEl) {
      if (!busy) {
        stepActEl.textContent = '操作已完成，您可以离开此页面';
      } else {
        stepActEl.textContent = actionText || (lastInfo ? lastInfo : '—');
      }
    }
  }

  function flashCopySuccess(el) {
    const prev = el.style.boxShadow;
    el.style.boxShadow = '0 0 0 2px rgba(0,240,255,.85)';
    setTimeout(() => {
      el.style.boxShadow = prev;
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
  function requestLogsAndCopy(triggerEl) {
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
      const done = () => flashCopySuccess(triggerEl);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => copyTextFallback(text, done));
      } else {
        copyTextFallback(text, done);
      }
    });
  }

  function onRobotTripleClick(e) {
    const logTarget = e.currentTarget;
    const now = Date.now();
    clickTimes.push(now);
    clickTimes = clickTimes.filter((t) => now - t <= TRIPLE_CLICK_MS);
    if (clickTimes.length >= 3) {
      clickTimes = [];
      requestLogsAndCopy(logTarget);
    }
  }

  async function wireRobotTripleClick() {
    if (!(await shouldShowWorkspaceTopbar())) return;
    const { logTarget } = ensureTopbarShell();
    if (!logTarget) return;
    logTarget.removeEventListener('click', onRobotTripleClick);
    logTarget.addEventListener('click', onRobotTripleClick);
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
      void (async () => {
        try {
          await applyRoundPhase(msg.payload);
          await wireRobotTripleClick();
        } catch {
          /* ignore */
        }
      })();
      safeRespond({ ok: true });
      return;
    }
    if (msg.type === LOG_APPEND) {
      safeRespond({ ok: true });
    }
  });

  window.addEventListener('message', (event) => {
    // MAIN 世界与隔离世界 window 非同一引用，event.source === window 常为 false，消息会被误丢。
    // 同源 + picpuckBridge 结构即可桥接（后台 Tab 同样生效；与是否激活无关）。
    let originOk = false;
    try {
      originOk = typeof event.origin === 'string' && event.origin === window.location.origin;
    } catch {
      originOk = false;
    }
    if (!originOk) return;
    const d = event.data;
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
        let oOk = false;
        try {
          oOk = typeof event.origin === 'string' && event.origin === window.location.origin;
        } catch {
          oOk = false;
        }
        if (!oOk) return;
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
    if (d && d.picpuckBridge === true && d.kind === 'JIMENG_REQUEST_ACTIVATE_TAB_FOR_COLLECT') {
      safeRuntimeSendMessage(
        {
          type: PICPUCK_COMMAND,
          payload: {
            type: PAGE_CMD,
            action: '__picpuckJimengActivateTabForCollect',
          },
        },
        () => {},
      );
      return;
    }
    if (d && d.picpuckBridge === true && d.kind === 'GEMINI_REQUEST_ACTIVATE_TAB_FOR_COLLECT') {
      safeRuntimeSendMessage(
        {
          type: PICPUCK_COMMAND,
          payload: {
            type: PAGE_CMD,
            action: '__picpuckGeminiActivateTabForCollect',
          },
        },
        () => {},
      );
      return;
    }
    if (d && d.picpuckBridge === true && d.kind === 'JIMENG_PAGE_RECOVER_READY') {
      safeRuntimeSendMessage(
        {
          type: PICPUCK_COMMAND,
          payload: {
            type: PAGE_CMD,
            action: '__picpuckJimengPageRecoverReady',
            forgeCallerTabId: d.forgeCallerTabId,
            recoverPayload: d.recoverPayload,
          },
        },
        () => {},
      );
      return;
    }
    if (d && d.picpuckBridge === true && d.kind === 'GEMINI_PAGE_RECOVER_READY') {
      safeRuntimeSendMessage(
        {
          type: PICPUCK_COMMAND,
          payload: {
            type: PAGE_CMD,
            action: '__picpuckGeminiPageRecoverReady',
            forgeCallerTabId: d.forgeCallerTabId,
            recoverPayload: d.recoverPayload,
          },
        },
        () => {},
      );
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

  async function initTopbarIfWorkbench() {
    removeStalePicpuckTopbar();
    if (!isWorkspaceSiteHost()) return;
    const eligible = await shouldShowWorkspaceTopbar();
    if (!eligible) {
      removePicpuckTopbarDom();
      return;
    }
    ensureTopbarShell();
    async function finishTopbarPhase(payload) {
      await applyRoundPhase(payload);
      await wireRobotTripleClick();
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
          const payload =
            !err && res && res.ok === true && res.phasePayload && typeof res.phasePayload === 'object'
              ? res.phasePayload
              : idlePayload;
          void finishTopbarPhase(payload);
        },
      );
    } catch {
      void finishTopbarPhase(idlePayload);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => void initTopbarIfWorkbench());
  } else {
    void initTopbarIfWorkbench();
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
