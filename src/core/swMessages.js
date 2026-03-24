/**
 * Service Worker 侧 `chrome.runtime.onMessage` 路由。
 * 与内容脚本约定的顶层 `type` 仅 §11 项 3 中的 `PICPUCK_COMMAND`、`LOG_APPEND`（及 SW→CS 的 `ROUND_PHASE`）。
 */
import { PICPUCK_COMMAND, LOG_APPEND } from './runtimeMessages.js';
import { getCommandRecordByPicpuckAction } from './registry.js';
import { masterDispatch } from './masterDispatch.js';
import { relayJimengGeneratedImagesToCaller } from './jimengRelayGeneratedImages.js';
import { geminiRelayCallerTabByRoundId, getWorkTabIdByRoundId } from './taskBindings.js';
import { appendLog, getContext } from './roundContext.js';
import { getSinkRoundForTab } from './logSink.js';
import { pushRoundPhaseUi } from './phaseUi.js';
import { loadLogsForCopy } from './roundLogSnapshot.js';

/** 与 `frontend-v2/src/utils/picpuckExtension.js` 中 PICPUCK_EXTENSION_COMMAND 一致 */
const PAGE_CMD_TYPE = 'IdlinkExtensionCommand';

function delayMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 内容脚本无 `chrome.tabs`：由 SW 将 Gemini 工作台 Tab 置前并轮询直至页内 `document.hasFocus()` 或超时。
 * @param {number} tabId
 * @param {number} maxWaitMs
 * @param {number} pollMs
 */
async function ensureTabAndDocumentFocusedForClipboard(tabId, maxWaitMs, pollMs) {
  const deadline = Date.now() + maxWaitMs;
  const settleMs = 150;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      await delayMs(pollMs);
      continue;
    }
    if (!tab || tab.windowId == null) {
      await delayMs(pollMs);
      continue;
    }
    let hasFocus = false;
    try {
      const inj = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.hasFocus(),
      });
      hasFocus = !!(inj && inj[0] && inj[0].result === true);
    } catch {
      hasFocus = false;
    }
    if (tab.active && hasFocus) {
      try {
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch {
        /* 仍认为可尝试写剪贴板 */
      }
      await delayMs(settleMs);
      return;
    }
    try {
      await chrome.windows.update(tab.windowId, { focused: true });
      await chrome.tabs.update(tabId, { active: true });
    } catch {
      /* 继续轮询 */
    }
    await delayMs(pollMs);
  }
  throw new Error('GEMINI_CLIPBOARD_TAB_FOCUS_TIMEOUT');
}

/**
 * 安装消息监听；应在 SW 启动时调用一次。
 */
export function installRuntimeMessageHandlers() {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === LOG_APPEND) {
      const tabId = sender.tab?.id;
      if (tabId == null) return;
      const entry = msg.entry;
      if (!entry || typeof entry !== 'object') return;
      // step02 已 attach 的 roundId 须与条目一致，防止串轮次写入（§12.2 attachLogSink）
      const expectedRound = getSinkRoundForTab(tabId);
      if (!expectedRound || entry.roundId !== expectedRound) return;
      const r = appendLog(tabId, /** @type {*} */ (entry));
      if (r.ok) {
        pushRoundPhaseUi(tabId, expectedRound);
      }
      return;
    }

    if (msg.type === PICPUCK_COMMAND) {
      const payload = msg.payload;
      if (!payload || typeof payload !== 'object') {
        sendResponse({ ok: false, error: 'bad payload' });
        return;
      }
      /** PicPuck 页同源 postMessage 经 content 转发时带原始 type，便于对照 */
      if (payload.type === PAGE_CMD_TYPE && payload.action === 'ping') {
        sendResponse({ ok: true });
        return;
      }
      // 为遵守「仅三种 runtime type」约定：内部动作走 PICPUCK_COMMAND，不新增第四 type（见分阶段清单说明）
      if (payload.action === '__picpuckCopyLogs') {
        const tabId = sender.tab?.id;
        if (tabId == null) {
          sendResponse({ ok: false, error: 'no tab' });
          return;
        }
        (async () => {
          const logs = await loadLogsForCopy(tabId);
          const sorted = [...logs].sort((a, b) => (a.ts || 0) - (b.ts || 0));
          sendResponse({ ok: true, logs: sorted });
        })().catch((e) => {
          const m = e instanceof Error ? e.message : String(e);
          sendResponse({ ok: false, error: m });
        });
        return true;
      }

      /** Gemini Step13：CS 无 chrome.tabs，由 SW 在写系统剪贴板前抢焦点（至多 maxWaitMs / 步进 pollMs） */
      if (payload.action === '__picpuckEnsureTabFocusForClipboard') {
        const rid = typeof payload.roundId === 'string' ? payload.roundId : '';
        const fromTask = rid ? getWorkTabIdByRoundId(rid) : undefined;
        let tabId;
        if (typeof fromTask === 'number' && fromTask > 0) {
          tabId = fromTask;
        } else if (sender.tab && typeof sender.tab.id === 'number') {
          tabId = sender.tab.id;
        } else {
          tabId = undefined;
        }
        if (tabId == null) {
          sendResponse({ ok: false, error: 'GEMINI_CLIPBOARD_TAB_FOCUS_UNAVAILABLE' });
          return;
        }
        const maxWaitMs =
          typeof payload.maxWaitMs === 'number' && payload.maxWaitMs > 0 ? payload.maxWaitMs : 300000;
        const pollMs = typeof payload.pollMs === 'number' && payload.pollMs > 0 ? payload.pollMs : 100;
        (async () => {
          try {
            await ensureTabAndDocumentFocusedForClipboard(tabId, maxWaitMs, pollMs);
            sendResponse({ ok: true });
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            sendResponse({ ok: false, error: m });
          }
        })();
        return true;
      }

      /** Gemini 剪贴板成功后：由 Gemini 页 CS 将整图 base64 转发回发起命令的熔炉标签页（见 picpuckAgentContent） */
      if (payload.action === '__picpuckGeminiRelayGeneratedImage') {
        (async () => {
          try {
            const roundId = typeof payload.roundId === 'string' ? payload.roundId : '';
            const imageBase64 = typeof payload.imageBase64 === 'string' ? payload.imageBase64 : '';
            const contentType =
              typeof payload.contentType === 'string' && payload.contentType ? payload.contentType : 'image/png';
            const generationEvent =
              payload.generationEvent && typeof payload.generationEvent === 'object' ? payload.generationEvent : null;
            if (!roundId || !imageBase64 || !generationEvent) {
              sendResponse({ ok: false, error: 'bad relay payload' });
              return;
            }
            const callerTabId = geminiRelayCallerTabByRoundId.get(roundId);
            if (callerTabId == null) {
              sendResponse({ ok: false, error: 'relay round expired' });
              return;
            }
            await chrome.tabs.sendMessage(callerTabId, {
              type: 'PICPUCK_GEMINI_GENERATED_IMAGE',
              imageBase64,
              contentType,
              generationEvent,
            });
            geminiRelayCallerTabByRoundId.delete(roundId);
            sendResponse({ ok: true });
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            sendResponse({ ok: false, error: m });
          }
        })();
        return true;
      }

      /** 即梦 step22：SW 步骤将多图 base64 转发回发起命令的熔炉标签页 */
      if (payload.action === '__picpuckJimengRelayGeneratedImages') {
        (async () => {
          try {
            await relayJimengGeneratedImagesToCaller({
              roundId: typeof payload.roundId === 'string' ? payload.roundId : '',
              generationEvent:
                payload.generationEvent && typeof payload.generationEvent === 'object'
                  ? payload.generationEvent
                  : null,
              images: Array.isArray(payload.images) ? payload.images : [],
            });
            sendResponse({ ok: true });
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            sendResponse({ ok: false, error: m });
          }
        })();
        return true;
      }

      /** 开发用：MAIN 世界注入 fetch/XHR 测试钩子（见 geminiNetworkHookTestMain.js） */
      if (payload.action === '__picpuckGeminiNetHookTest') {
        const tabId = sender.tab?.id;
        if (tabId == null) {
          sendResponse({ ok: false, error: 'no tab' });
          return;
        }
        const hookFile = 'src/agents/gemini/geminiNetworkHookTestMain.js';
        (async () => {
          try {
            await chrome.scripting.executeScript({
              target: { tabId, allFrames: true },
              world: 'MAIN',
              files: [hookFile],
            });
            sendResponse({ ok: true });
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            sendResponse({ ok: false, error: m });
          }
        })().catch((e) => {
          const m = e instanceof Error ? e.message : String(e);
          sendResponse({ ok: false, error: m });
        });
        return true;
      }

      (async () => {
        try {
          if (payload.type !== PAGE_CMD_TYPE) {
            sendResponse({ ok: false, error: 'unknown bridge' });
            return;
          }
          const action = payload.action;
          if (typeof action !== 'string') {
            sendResponse({ ok: false, error: 'missing action' });
            return;
          }
          const rec = getCommandRecordByPicpuckAction(action);
          if (!rec) {
            sendResponse({ ok: false, error: 'unknown action: ' + action });
            return;
          }
          const clientRequestId =
            typeof payload.clientRequestId === 'string' ? payload.clientRequestId : crypto.randomUUID();
          const callerTabId = sender.tab && typeof sender.tab.id === 'number' ? sender.tab.id : 0;
          const result = await masterDispatch(clientRequestId, rec.command, payload, callerTabId);
          sendResponse({
            ok: result.ok,
            roundId: result.roundId,
            tabId: result.tabId,
            phase: result.phase,
            error:
              result.errorCode != null
                ? String(result.errorCode)
                : result.ok
                  ? undefined
                  : 'failed',
          });
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          sendResponse({ ok: false, error: m });
        }
      })();
      // 异步 `sendResponse` 必须返回 true，否则通道过早关闭
      return true;
    }

    return;
  });
}
