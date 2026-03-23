/**
 * Service Worker 侧 `chrome.runtime.onMessage` 路由。
 * 与内容脚本约定的顶层 `type` 仅 §11 项 3 中的 `PICPUCK_COMMAND`、`LOG_APPEND`（及 SW→CS 的 `ROUND_PHASE`）。
 */
import { PICPUCK_COMMAND, LOG_APPEND } from './runtimeMessages.js';
import { getCommandRecordByPicpuckAction } from './registry.js';
import { masterDispatch } from './masterDispatch.js';
import { appendLog, getContext } from './roundContext.js';
import { getSinkRoundForTab } from './logSink.js';
import { pushRoundPhaseUi } from './phaseUi.js';

/** 与 `frontend-v2/src/utils/picpuckExtension.js` 中 PICPUCK_EXTENSION_COMMAND 一致 */
const PAGE_CMD_TYPE = 'IdlinkExtensionCommand';

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
        const logs = getContext(tabId)?.logs ?? [];
        const sorted = [...logs].sort((a, b) => a.ts - b.ts);
        sendResponse({ ok: true, logs: sorted });
        return;
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
          const result = await masterDispatch(clientRequestId, rec.command, payload);
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
