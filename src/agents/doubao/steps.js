/**
 * 豆包站点业务步骤（step01～step03 由 core/dispatchRound 框架固定执行）。
 */
import { logStepDone, logStepEnter, logStepFail, logStepInfo } from '../../core/stepLog.js';
import { DOUBAO_MAIN_INJECT_FAILED, DOUBAO_WORKBENCH_NOT_READY } from './doubaoErrorCodes.js';
import { isDoubaoChatUrl } from './doubaoUrls.js';

const DOUBAO_IMAGE_MAIN_WORLD_FILE = 'src/agents/doubao/doubaoImageMainWorld.js';

async function ensureDoubaoMainWorldInjected(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: [DOUBAO_IMAGE_MAIN_WORLD_FILE],
  });
}

/**
 * @param {object} ctx
 * @param {{ nn: number, stepKey: string, runnerName: string, mainPayload?: Record<string, unknown>, failUserMsg: string, startMsg: string, doneMsg: string }} opts
 */
async function execDoubaoMainRunner(ctx, opts) {
  const { tabId, roundId, payload } = ctx;
  const { nn, stepKey, runnerName, mainPayload = {}, failUserMsg, startMsg, doneMsg } = opts;
  logStepEnter(tabId, roundId, stepKey, nn, startMsg);
  try {
    await ensureDoubaoMainWorldInjected(tabId);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    logStepFail(tabId, roundId, stepKey, nn, '动作失败+豆包页内脚本注入失败请刷新后重试', m.slice(0, 500));
    throw new Error(DOUBAO_MAIN_INJECT_FAILED);
  }
  const mergedPayload = { ...payload, ...mainPayload };
  const [injRes] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (packed) => {
      const gl = typeof globalThis !== 'undefined' ? globalThis : window;
      const inj = gl.__picpuckDoubaoImage;
      if (!inj || typeof inj[packed.runnerName] !== 'function') {
        return { ok: false, code: 'DOUBAO_MAIN_INJECT_FAILED' };
      }
      return inj[packed.runnerName](packed.payload);
    },
    args: [{ runnerName, payload: mergedPayload }],
  });
  const r = injRes?.result;
  if (!r || r.ok !== true) {
    const code = r && r.code ? String(r.code) : DOUBAO_WORKBENCH_NOT_READY;
    const detail = r && typeof r.detail === 'string' ? r.detail : '';
    logStepFail(tabId, roundId, stepKey, nn, failUserMsg, (detail || code).slice(0, 500));
    throw new Error(code);
  }
  logStepDone(tabId, roundId, stepKey, nn, doneMsg);
}

export async function step04_doubao_ensure_chat_home(ctx) {
  const { tabId, roundId } = ctx;
  const stepKey = 'step04_doubao_ensure_chat_home';
  logStepEnter(tabId, roundId, stepKey, 4, '确认当前在豆包对话页');
  const url = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => ({ url: String(window.location.href || '') }),
  });
  const u = url && url[0] && url[0].result && url[0].result.url ? url[0].result.url : '';
  if (!isDoubaoChatUrl(u)) {
    logStepFail(tabId, roundId, stepKey, 4, '动作失败+当前不在豆包对话页', u.slice(0, 200));
    throw new Error('DOUBAO_BAD_URL');
  }
  logStepDone(tabId, roundId, stepKey, 4, '已在豆包对话页');
}

export async function step05_doubao_require_logged_in(ctx) {
  await execDoubaoMainRunner(ctx, {
    nn: 5,
    stepKey: 'step05_doubao_require_logged_in',
    runnerName: 'runStep04_doubao_require_logged_in',
    failUserMsg: '动作失败+未登录豆包',
    startMsg: '检测豆包登录状态',
    doneMsg: '已登录',
  });
}

export async function step06_doubao_click_image_generation(ctx) {
  await execDoubaoMainRunner(ctx, {
    nn: 6,
    stepKey: 'step06_doubao_click_image_generation',
    runnerName: 'runStep05_doubao_click_image_mode',
    failUserMsg: '动作失败+无法进入豆包图像生成',
    startMsg: '点击图像生成',
    doneMsg: '已进入图像生成',
  });
}

export async function step07_doubao_select_ratio(ctx) {
  await execDoubaoMainRunner(ctx, {
    nn: 7,
    stepKey: 'step07_doubao_select_ratio',
    runnerName: 'runStep06_doubao_select_ratio',
    failUserMsg: '动作失败+无法选择画幅比例',
    startMsg: '选择比例',
    doneMsg: '比例已选',
  });
}

export async function step08_doubao_paste_images_and_prompt(ctx) {
  await execDoubaoMainRunner(ctx, {
    nn: 8,
    stepKey: 'step08_doubao_paste_images_and_prompt',
    runnerName: 'runStep07_doubao_paste_images_and_prompt',
    failUserMsg: '动作失败+无法粘贴参考图或提示词',
    startMsg: '粘贴参考图并写入提示词',
    doneMsg: '输入区已就绪',
  });
}

export async function step09_doubao_submit_enter(ctx) {
  await execDoubaoMainRunner(ctx, {
    nn: 9,
    stepKey: 'step09_doubao_submit_enter',
    runnerName: 'runStep08_doubao_submit_enter',
    failUserMsg: '动作失败+无法提交生成',
    startMsg: '在输入区派发 Enter 提交',
    doneMsg: '已派发 Enter',
  });
}

/** 占位：与即梦 Step16 对齐日志结构 */
export async function step10_doubao_noop_anchor(ctx) {
  const { tabId, roundId } = ctx;
  const stepKey = 'step10_doubao_noop_anchor';
  logStepInfo(tabId, roundId, stepKey, 10, '豆包路径不登记异步锚点与回图');
}
