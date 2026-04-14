/**
 * 豆包站点业务步骤（step01～step03 由 core/dispatchRound 框架固定执行）。
 */
import { logStepDone, logStepEnter, logStepFail, logStepInfo } from '../../core/stepLog.js';
import { DOUBAO_MAIN_INJECT_FAILED, DOUBAO_WORKBENCH_NOT_READY } from './doubaoErrorCodes.js';
import { DOUBAO_CHAT_HOME, isDoubaoChatUrl, needsNavigateToDoubaoChat } from './doubaoUrls.js';

const DOUBAO_IMAGE_MAIN_WORLD_FILE = 'src/agents/doubao/doubaoImageMainWorld.js';

/** `DOUBAO_VIDEO_FILL` 在比例/粘贴前多一步「视频」Tab，业务步日志序号顺延 1。 */
function doubaoPostVideoTabNnOffset(ctx) {
  return ctx.command === 'DOUBAO_VIDEO_FILL' ? 1 : 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 导航到 /chat/ 后轮询直至地址就绪或超时 */
async function waitDoubaoChatUrl(tabId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      throw new Error('DOUBAO_TAB_GONE');
    }
    const raw = String(tab.pendingUrl || tab.url || '');
    if (isDoubaoChatUrl(raw)) return;
    await sleep(300);
  }
  throw new Error('DOUBAO_CHAT_TIMEOUT');
}

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
  let u = '';
  for (let i = 0; i < 80; i += 1) {
    try {
      const tab = await chrome.tabs.get(tabId);
      u = String(tab.pendingUrl || tab.url || '');
    } catch {
      logStepFail(tabId, roundId, stepKey, 4, '动作失败+无法读取豆包标签页', '');
      throw new Error('DOUBAO_BAD_URL');
    }
    if (isDoubaoChatUrl(u)) {
      logStepDone(tabId, roundId, stepKey, 4, '已在豆包对话页');
      return;
    }
    if (u.startsWith('http') && u.indexOf('doubao.com') < 0) {
      logStepFail(tabId, roundId, stepKey, 4, '动作失败+当前标签页不是豆包', u.slice(0, 200));
      throw new Error('DOUBAO_BAD_URL');
    }
    if (needsNavigateToDoubaoChat(u)) {
      logStepInfo(tabId, roundId, stepKey, 4, '当前非对话路径，导航至 /chat/');
      try {
        await chrome.tabs.update(tabId, { url: DOUBAO_CHAT_HOME });
        await waitDoubaoChatUrl(tabId, 45000);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        logStepFail(tabId, roundId, stepKey, 4, '动作失败+未能进入豆包对话页', m.slice(0, 200));
        throw new Error('DOUBAO_BAD_URL');
      }
      try {
        const tab2 = await chrome.tabs.get(tabId);
        u = String(tab2.pendingUrl || tab2.url || '');
      } catch {
        logStepFail(tabId, roundId, stepKey, 4, '动作失败+导航后无法读取标签页', '');
        throw new Error('DOUBAO_BAD_URL');
      }
      if (isDoubaoChatUrl(u)) {
        logStepDone(tabId, roundId, stepKey, 4, '已在豆包对话页');
        return;
      }
      logStepFail(tabId, roundId, stepKey, 4, '动作失败+导航后仍不在豆包对话页', u.slice(0, 200));
      throw new Error('DOUBAO_BAD_URL');
    }
    await sleep(250);
  }
  logStepFail(tabId, roundId, stepKey, 4, '动作失败+当前不在豆包对话页', u.slice(0, 200));
  throw new Error('DOUBAO_BAD_URL');
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

/** 豆包视频（Seendance）：进入图像生成后切换到「视频」子 Tab。 */
export async function step06b_doubao_click_video_tab(ctx) {
  await execDoubaoMainRunner(ctx, {
    nn: 7,
    stepKey: 'step06b_doubao_click_video_tab',
    runnerName: 'runStep05b_doubao_click_video_tab',
    failUserMsg: '动作失败+无法切换到豆包视频',
    startMsg: '点击视频 Tab',
    doneMsg: '已切换到视频',
  });
}

export async function step07_doubao_select_ratio(ctx) {
  await execDoubaoMainRunner(ctx, {
    nn: 7 + doubaoPostVideoTabNnOffset(ctx),
    stepKey: 'step07_doubao_select_ratio',
    runnerName: 'runStep06_doubao_select_ratio',
    failUserMsg: '动作失败+无法选择画幅比例',
    startMsg: '选择比例',
    doneMsg: '比例已选',
  });
}

export async function step08_doubao_paste_images_and_prompt(ctx) {
  await execDoubaoMainRunner(ctx, {
    nn: 8 + doubaoPostVideoTabNnOffset(ctx),
    stepKey: 'step08_doubao_paste_images_and_prompt',
    runnerName: 'runStep07_doubao_paste_images_and_prompt',
    failUserMsg: '动作失败+无法粘贴参考图或提示词',
    startMsg: '粘贴参考图并写入提示词',
    doneMsg: '输入区已就绪',
  });
}

export async function step09_doubao_submit_enter(ctx) {
  await execDoubaoMainRunner(ctx, {
    nn: 9 + doubaoPostVideoTabNnOffset(ctx),
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
  logStepInfo(tabId, roundId, stepKey, 10 + doubaoPostVideoTabNnOffset(ctx), '豆包路径不登记异步锚点与回图');
}
