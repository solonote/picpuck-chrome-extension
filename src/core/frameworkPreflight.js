/**
 * 框架固定前序：`dispatchRound` 在执行业务 `CommandRecord.steps` 之前始终运行本模块三步（01/02/03）。
 * 站点 Agent 不得在 `register.js` 中重复注册 step01～step03。
 */
import { clearRoundLogs } from './clearRoundLogs.js';
import { attachLogSink } from './logSink.js';
import { logStepDone, logStepEnter, logStepFail, logStepInfo } from './stepLog.js';

/** 相对扩展根目录，与 manifest / `background.js` 同级 */
const INJECT_HELPERS_MAIN_FILE = 'src/core/injectHelpersMainWorld.js';

/**
 * @param {{ tabId: number, roundId: string }} ctx
 */
export async function frameworkStep01_clearRoundLogs(ctx) {
  const { tabId, roundId } = ctx;
  // 先清空缓冲区，再写 step01 的进入/完成（避免被 clear 抹掉）
  clearRoundLogs(tabId);
  const stepKey = 'step01_clear_round_logs';
  logStepEnter(tabId, roundId, stepKey, 1);
  logStepDone(tabId, roundId, stepKey, 1);
}

/**
 * @param {{ tabId: number, roundId: string }} ctx
 */
export async function frameworkStep02_attachLogSink(ctx) {
  const { tabId, roundId } = ctx;
  const stepKey = 'step02_attach_log_sink';
  logStepEnter(tabId, roundId, stepKey, 2);
  attachLogSink(tabId, roundId);
  logStepDone(tabId, roundId, stepKey, 2);
}

/**
 * 在目标 Tab 的 MAIN 世界注入 `injectHelpersMainWorld.js`，确保 `__idlinkPicpuckInject` 可用。
 *
 * @param {{ tabId: number, roundId: string }} ctx
 */
export async function frameworkStep03_ensurePageHelpers(ctx) {
  const { tabId, roundId } = ctx;
  const stepKey = 'step03_ensure_page_helpers';
  logStepEnter(tabId, roundId, stepKey, 3);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      files: [INJECT_HELPERS_MAIN_FILE],
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    logStepFail(
      tabId,
      roundId,
      stepKey,
      3,
      '动作失败+页内工具脚本注入失败请刷新标签页后重试',
      m.slice(0, 500),
    );
    throw e;
  }

  const [inj] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const g = typeof globalThis !== 'undefined' ? globalThis : window;
      const inj = g.__idlinkPicpuckInject;
      return {
        ok: !!(inj && typeof inj.dataUrlToBlob === 'function'),
      };
    },
  });
  if (!inj?.result?.ok) {
    logStepInfo(tabId, roundId, stepKey, 3, '动作失败+页内工具对象未就绪请刷新标签页后重试');
    throw new Error('PAGE_HELPERS_NOT_READY');
  }

  logStepDone(tabId, roundId, stepKey, 3);
}
