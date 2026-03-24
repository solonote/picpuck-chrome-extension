/**
 * 即梦站点业务步骤（step01～step03 由 core/dispatchRound 框架固定执行）。
 */
import { executeInAllFrames } from '../../core/executeAllFrames.js';
import { scrollTopViaInjectMain } from '../../core/mainWorldScrollTop.js';
import { logStepDone, logStepEnter, logStepFail, logStepInfo } from '../../core/stepLog.js';
import { relayJimengGeneratedImagesToCaller } from '../../core/jimengRelayGeneratedImages.js';
import { waitForTabUrlWhen } from '../../core/waitTabUrl.js';
import {
  JIMENG_IMAGE_MAIN_INJECT_FAILED,
  JIMENG_RELAY_CALLER_GONE,
  JIMENG_WORKBENCH_NOT_READY,
} from './jimengErrorCodes.js';
import { JIMENG_AI_TOOL_HOME, isJimengAiToolHomeUrl } from './jimengUrls.js';

/** 设计 §3.1.1：与 `manifest.json` `web_accessible_resources` 路径一致 */
const JIMENG_IMAGE_MAIN_WORLD_FILE = 'src/agents/jimeng/jimengImageMainWorld.js';

function payloadString(payload, key) {
  if (!payload || typeof payload !== 'object') return '';
  const v = payload[key];
  return typeof v === 'string' ? v : '';
}

function payloadImages(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const v = payload.images;
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string');
}

function payloadFillOnly(payload) {
  return !!(payload && typeof payload === 'object' && payload.fillOnly);
}

async function ensureJimengImageMainWorldInjected(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    files: [JIMENG_IMAGE_MAIN_WORLD_FILE],
  });
}

/**
 * 注入 `jimengImageMainWorld.js` 并调用 `globalThis.__picpuckJimengImage[runnerName](payload)`。
 * @param {object} ctx dispatchRound 上下文
 * @param {{ nn: number, stepKey: string, runnerName: string, mainPayload: Record<string, unknown>, failUserMsg: string, startMsg: string, doneMsg: string }} opts
 */
async function execJimengMainRunner(ctx, opts) {
  const { tabId, roundId } = ctx;
  const { nn, stepKey, runnerName, mainPayload, failUserMsg, startMsg, doneMsg } = opts;
  logStepEnter(tabId, roundId, stepKey, nn, startMsg);
  try {
    await ensureJimengImageMainWorldInjected(tabId);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    logStepFail(tabId, roundId, stepKey, nn, '动作失败+页内即梦脚本注入失败请刷新页面后重试', m.slice(0, 500));
    throw new Error(JIMENG_IMAGE_MAIN_INJECT_FAILED);
  }
  const mergedPayload = { roundId, ...mainPayload };
  const [injRes] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (packed) => {
      const g = typeof globalThis !== 'undefined' ? globalThis : window;
      const inj = g.__picpuckJimengImage;
      if (!inj || typeof inj[packed.runnerName] !== 'function') {
        return { ok: false, code: 'JIMENG_IMAGE_MAIN_INJECT_FAILED' };
      }
      return inj[packed.runnerName](packed.payload);
    },
    args: [{ runnerName, payload: mergedPayload }],
  });
  const r = injRes?.result;
  if (!r || r.ok !== true) {
    const code = r && r.code ? String(r.code) : JIMENG_WORKBENCH_NOT_READY;
    const detail = r && typeof r.detail === 'string' ? r.detail : '';
    logStepFail(tabId, roundId, stepKey, nn, failUserMsg, (detail || code).slice(0, 500));
    throw new Error(code);
  }
  logStepDone(tabId, roundId, stepKey, nn, doneMsg);
}

/**
 * MAIN 注入；成功时返回页内 `result` 对象（用于 step20/21 读取 `n` / `images`）。
 * @param {object} ctx dispatchRound 上下文
 * @param {{ nn: number, stepKey: string, runnerName: string, mainPayload: Record<string, unknown>, failUserMsg: string, startMsg: string, doneMsg: string }} opts
 */
async function execJimengMainRunnerWithResult(ctx, opts) {
  const { tabId, roundId } = ctx;
  const { nn, stepKey, runnerName, mainPayload, failUserMsg, startMsg, doneMsg } = opts;
  logStepEnter(tabId, roundId, stepKey, nn, startMsg);
  try {
    await ensureJimengImageMainWorldInjected(tabId);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    logStepFail(tabId, roundId, stepKey, nn, '动作失败+页内即梦脚本注入失败请刷新页面后重试', m.slice(0, 500));
    throw new Error(JIMENG_IMAGE_MAIN_INJECT_FAILED);
  }
  const mergedPayload = { roundId, ...mainPayload };
  const [injRes] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: async (packed) => {
      const g = typeof globalThis !== 'undefined' ? globalThis : window;
      const inj = g.__picpuckJimengImage;
      if (!inj || typeof inj[packed.runnerName] !== 'function') {
        return { ok: false, code: 'JIMENG_IMAGE_MAIN_INJECT_FAILED' };
      }
      return inj[packed.runnerName](packed.payload);
    },
    args: [{ runnerName, payload: mergedPayload }],
  });
  const r = injRes?.result;
  if (!r || r.ok !== true) {
    const code = r && r.code ? String(r.code) : JIMENG_WORKBENCH_NOT_READY;
    const detail = r && typeof r.detail === 'string' ? r.detail : '';
    logStepFail(tabId, roundId, stepKey, nn, failUserMsg, (detail || code).slice(0, 500));
    throw new Error(code);
  }
  logStepDone(tabId, roundId, stepKey, nn, doneMsg);
  return r;
}

function jimengPostFillSubmitFlow(payload) {
  return !!(
    payload &&
    typeof payload === 'object' &&
    payload.fillOnly === true &&
    payload.submitAfterFill === true
  );
}

function generationEventFieldsComplete(payload) {
  const ge = payload && payload.generationEvent;
  if (!ge || typeof ge !== 'object') return false;
  const s = (k) => (typeof ge[k] === 'string' ? ge[k].trim() : '');
  return !!(s('projectId') && s('subjectType') && s('subjectId') && s('inputPrompt') && s('coreEngine'));
}

/**
 * MAIN 注入：与旧版 `readJimengLoggedInFlag` 一致，`allFrames: true` 时任一 frame 返回 1 即视为已登录。
 */
function readJimengLoggedInFlagMain() {
  try {
    const doc = typeof document !== 'undefined' ? document : null;
    if (!doc) return 0;
    if (doc.getElementById('Personal')) return 1;
    if (doc.querySelector && doc.querySelector('[id="Personal"]')) return 1;
    const body = doc.body;
    if (body && body.getAttribute('data-idlink-jimeng-logged-in') === '1') return 1;
    return 0;
  } catch {
    return 0;
  }
}

/**
 * 未登录则本轮失败（较旧版「仍执行脚本」更严格：PicPuck 侧直接收到 error phase）。
 */
export async function step04_jimeng_require_logged_in(ctx) {
  const { tabId, roundId } = ctx;
  const stepKey = 'step04_jimeng_require_logged_in';
  logStepEnter(tabId, roundId, stepKey, 4, '检查各 frame 是否已登录即梦');

  const frameResults = await executeInAllFrames(tabId, readJimengLoggedInFlagMain);
  const loggedIn = frameResults.some((v) => v === 1);

  if (!loggedIn) {
    logStepFail(
      tabId,
      roundId,
      stepKey,
      4,
      '动作失败+未登录即梦请先登录后再使用生成功能',
      'readJimengLoggedInFlag frames=' + frameResults.length,
    );
    throw new Error('JIMENG_NOT_LOGGED_IN');
  }

  logStepDone(tabId, roundId, stepKey, 4, '已确认即梦登录状态');
}

/**
 * 已登录：若不在 `ai-tool/home` 则整页导航至工作台，加载完成后滚顶；已在 home 则仅滚顶（对齐旧版 `ensureJimengAiToolHomeLoggedInThenScroll`）。
 */
export async function step05_jimeng_ensure_ai_tool_home(ctx) {
  const { tabId, roundId } = ctx;
  const stepKey = 'step05_jimeng_ensure_ai_tool_home';
  logStepEnter(tabId, roundId, stepKey, 5, '确认在即梦站点并进入 AI 工作台首页');

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || '';
  if (url.indexOf('jimeng.jianying.com') === -1) {
    logStepInfo(tabId, roundId, stepKey, 5, '动作失败+当前标签页不是即梦站点');
    throw new Error('JIMENG_NOT_JIMENG_TAB');
  }

  if (isJimengAiToolHomeUrl(url)) {
    logStepInfo(tabId, roundId, stepKey, 5, '已在工作台页将编辑区滚至顶部');
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: scrollTopViaInjectMain,
    });
    logStepDone(tabId, roundId, stepKey, 5, '工作台首页就绪');
    return;
  }

  logStepInfo(tabId, roundId, stepKey, 5, '正在导航至即梦工作台首页');

  try {
    await chrome.tabs.update(tabId, { url: JIMENG_AI_TOOL_HOME });
    await waitForTabUrlWhen(
      tabId,
      45000,
      (u) => u.indexOf('jimeng.jianying.com') !== -1 && isJimengAiToolHomeUrl(u),
      'JIMENG_HOME_NAV_TIMEOUT',
    );
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    logStepFail(
      tabId,
      roundId,
      stepKey,
      5,
      '动作失败+无法打开即梦工作台首页请稍后重试',
      m.slice(0, 500),
    );
    throw e;
  }

  await new Promise((r) => setTimeout(r, 400));

  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: scrollTopViaInjectMain,
  });

  logStepDone(tabId, roundId, stepKey, 5, '已打开工作台首页并滚顶');
}

/** 设计 §4.1.2：工作台就绪（仅 hasForm 链，不切换模式/模型） */
export async function step07_jimeng_ensure_workbench_ready(ctx) {
  await execJimengMainRunner(ctx, {
    nn: 7,
    stepKey: 'step07_jimeng_ensure_workbench_ready',
    runnerName: 'runStep07EnsureWorkbenchReady',
    mainPayload: {},
    failUserMsg: '动作失败+即梦工作台未就绪请刷新或稍后重试',
    startMsg: '检查工作台表单与画布是否就绪',
    doneMsg: '工作台已就绪',
  });
}

/** 设计 §4.1.2：关闭 lv-select / popover */
export async function step08_jimeng_close_open_popovers(ctx) {
  await execJimengMainRunner(ctx, {
    nn: 8,
    stepKey: 'step08_jimeng_close_open_popovers',
    runnerName: 'runStep08CloseOpenPopovers',
    mainPayload: {},
    failUserMsg: '动作失败+无法关闭即梦下拉层',
    startMsg: '关闭已打开的下拉与浮层',
    doneMsg: '浮层已关闭',
  });
}

/** 设计 §4.1.2：类型选择器切「图片生成」 */
export async function step09_jimeng_ensure_mode_image_generation(ctx) {
  await execJimengMainRunner(ctx, {
    nn: 9,
    stepKey: 'step09_jimeng_ensure_mode_image_generation',
    runnerName: 'runStep09EnsureModeImageGeneration',
    mainPayload: {},
    failUserMsg: '动作失败+无法切换到图片生成模式',
    startMsg: '将生成类型切换为「图片生成」',
    doneMsg: '已处于图片生成模式',
  });
}

/** 设计 §4.1.2：模型 lv-select（§5 modelLabel 可空） */
export async function step10_jimeng_ensure_model(ctx) {
  const { payload } = ctx;
  await execJimengMainRunner(ctx, {
    nn: 10,
    stepKey: 'step10_jimeng_ensure_model',
    runnerName: 'runStep10EnsureModel',
    mainPayload: {
      modelLabel: payloadString(payload, 'modelLabel'),
    },
    failUserMsg: '动作失败+无法选择即梦模型',
    startMsg: '在模型下拉中选择请求指定的模型',
    doneMsg: '模型已选择',
  });
}

/** 设计 §4.1.2：画幅与分辨率（§5 可空默认） */
export async function step11_jimeng_ensure_ratio_resolution(ctx) {
  const { payload } = ctx;
  await execJimengMainRunner(ctx, {
    nn: 11,
    stepKey: 'step11_jimeng_ensure_ratio_resolution',
    runnerName: 'runStep11EnsureRatioResolution',
    mainPayload: {
      ratioLabel: payloadString(payload, 'ratioLabel'),
      resolutionLabel: payloadString(payload, 'resolutionLabel'),
    },
    failUserMsg: '动作失败+无法设置画幅或分辨率',
    startMsg: '设置画幅比例与分辨率',
    doneMsg: '画幅与分辨率已设置',
  });
}

/** 清空提示词并移除页面已有参考图（两条固定 Step12 info 在 MAIN） */
export async function step12_jimeng_clear_form(ctx) {
  await execJimengMainRunner(ctx, {
    nn: 12,
    stepKey: 'step12_jimeng_clear_form',
    runnerName: 'runStep12ClearForm',
    mainPayload: {},
    failUserMsg: '动作失败+未找到即梦提示词区域或无法清空',
    startMsg: '清空提示词并移除页面上已有参考图',
    doneMsg: '表单已清空',
  });
}

/** 有配图：逐张贴参考图后双次硬清空；无配图：SW 记 Step13 跳过 */
export async function step13_jimeng_paste_reference_clear_prompt(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step13_jimeng_paste_reference_clear_prompt';
  const images = payloadImages(payload);
  if (images.length === 0) {
    logStepInfo(tabId, roundId, stepKey, 13, '无参考图跳过粘贴参考图');
    return;
  }
  await execJimengMainRunner(ctx, {
    nn: 13,
    stepKey,
    runnerName: 'runStep13PasteReferenceClearPrompt',
    mainPayload: { images },
    failUserMsg: '动作失败+即梦参考图粘贴或清空失败',
    startMsg: '逐张粘贴参考图并再次清空提示词区',
    doneMsg: '参考图已粘贴',
  });
}

/** 写入用户提示词（含占位符文案） */
export async function step14_jimeng_fill_prompt_text(ctx) {
  const { payload } = ctx;
  await execJimengMainRunner(ctx, {
    nn: 14,
    stepKey: 'step14_jimeng_fill_prompt_text',
    runnerName: 'runStep14FillPromptText',
    mainPayload: { prompt: payloadString(payload, 'prompt') },
    failUserMsg: '动作失败+无法写入即梦提示词',
    startMsg: '写入用户提示词（含占位符）',
    doneMsg: '提示词已写入',
  });
}

/** 有配图：将 (参考图片N) 换为 @ 并选「图片N」；无配图：跳过 */
export async function step15_jimeng_expand_at_mentions(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step15_jimeng_expand_at_mentions';
  const images = payloadImages(payload);
  if (images.length === 0) {
    logStepInfo(tabId, roundId, stepKey, 15, '无参考图跳过展开 @ 引用');
    return;
  }
  await execJimengMainRunner(ctx, {
    nn: 15,
    stepKey,
    runnerName: 'runStep15ExpandAtMentions',
    mainPayload: {
      prompt: payloadString(payload, 'prompt'),
      images,
    },
    failUserMsg: '动作失败+即梦 @ 参考图或占位符校验失败',
    startMsg: '将 (参考图片N) 展开为 @ 并选择对应参考图',
    doneMsg: '@ 引用已展开',
  });
}

/** 同步 body 登录标记（对齐旧版 setLoggedInFlag） */
export async function step16_jimeng_set_logged_in_marker(ctx) {
  await execJimengMainRunner(ctx, {
    nn: 16,
    stepKey: 'step16_jimeng_set_logged_in_marker',
    runnerName: 'runStep16SetLoggedInMarker',
    mainPayload: {},
    failUserMsg: '动作失败+即梦页内状态标记失败',
    startMsg: '在页内写入登录状态标记',
    doneMsg: '登录标记已写入',
  });
}

/** fillOnly 时跳过点击生成 */
export async function step17_jimeng_click_generate_if_needed(ctx) {
  const { payload } = ctx;
  await execJimengMainRunner(ctx, {
    nn: 17,
    stepKey: 'step17_jimeng_click_generate_if_needed',
    runnerName: 'runStep17ClickGenerateIfNeeded',
    mainPayload: { fillOnly: payloadFillOnly(payload) },
    failUserMsg: '动作失败+无法点击即梦生成按钮',
    startMsg: '按需点击即梦「生成」按钮',
    doneMsg: '生成动作已处理',
  });
}

/** fillOnly+submitAfterFill：MAIN 派发 Enter；否则跳过 */
export async function step18_jimeng_submit_prompt_enter_if_configured(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step18_jimeng_submit_prompt_enter_if_configured';
  if (!jimengPostFillSubmitFlow(payload)) {
    logStepInfo(tabId, roundId, stepKey, 18, '未启用 submitAfterFill 跳过 Enter 提交');
    return;
  }
  ctx.jimengEnterAtMs = Date.now();
  await execJimengMainRunner(ctx, {
    nn: 18,
    stepKey,
    runnerName: 'runStep18SubmitPromptEnterIfConfigured',
    mainPayload: { submitAfterFill: true },
    failUserMsg: '动作失败+无法在提示词区提交 Enter',
    startMsg: '在提示词区派发 Enter 键以提交生成',
    doneMsg: 'Enter 提交已派发',
  });
}

/** 等待首条记录出现「生成中」语义，最长 120s */
export async function step19_jimeng_wait_generation_started(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step19_jimeng_wait_generation_started';
  if (!jimengPostFillSubmitFlow(payload)) {
    logStepInfo(tabId, roundId, stepKey, 19, '本步跳过');
    return;
  }
  await execJimengMainRunner(ctx, {
    nn: 19,
    stepKey,
    runnerName: 'runStep19WaitGenerationStarted',
    mainPayload: { enterAtMs: ctx.jimengEnterAtMs },
    failUserMsg: '动作失败+等待即梦开始生成超时',
    startMsg: '等待即梦出现生成中界面',
    doneMsg: '已检测到生成中状态',
  });
}

/** 等待生成结束并统计结果图张数；自 Enter 起总超时 600s */
export async function step20_jimeng_wait_generation_finished(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step20_jimeng_wait_generation_finished';
  if (!jimengPostFillSubmitFlow(payload)) {
    logStepInfo(tabId, roundId, stepKey, 20, '本步跳过');
    return;
  }
  const r = await execJimengMainRunnerWithResult(ctx, {
    nn: 20,
    stepKey,
    runnerName: 'runStep20WaitGenerationFinished',
    mainPayload: { enterAtMs: ctx.jimengEnterAtMs },
    failUserMsg: '动作失败+等待即梦生成完成超时或无输出图',
    startMsg: '等待即梦生成完成并统计结果图',
    doneMsg: '生成已完成',
  });
  ctx.jimengResultImageCount = typeof r.n === 'number' ? r.n : 0;
}

/** 右键复制图片 + 隔离世界读剪贴板；generationEvent 不齐则跳过并标记 jimengSkipRelay */
export async function step21_jimeng_collect_images_via_context_menu(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step21_jimeng_collect_images_via_context_menu';
  if (!jimengPostFillSubmitFlow(payload)) {
    logStepInfo(tabId, roundId, stepKey, 21, '本步跳过');
    return;
  }
  if (!generationEventFieldsComplete(payload)) {
    logStepInfo(
      tabId,
      roundId,
      stepKey,
      21,
      '缺少 generationEvent 完整字段已跳过图片回传与落库',
    );
    ctx.jimengSkipRelay = true;
    return;
  }
  const n = ctx.jimengResultImageCount;
  const r = await execJimengMainRunnerWithResult(ctx, {
    nn: 21,
    stepKey,
    runnerName: 'runStep21CollectImagesViaContextMenu',
    mainPayload: { n },
    failUserMsg: '动作失败+通过右键菜单收集即梦结果图失败',
    startMsg: '逐张右键复制图片并读取剪贴板',
    doneMsg: '已收集全部结果图',
  });
  ctx.jimengCollectedImages = Array.isArray(r.images) ? r.images : [];
}

/** 将多图与 generationEvent 回传发起命令的熔炉标签页 */
export async function step22_jimeng_relay_images_to_caller(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step22_jimeng_relay_images_to_caller';
  if (!jimengPostFillSubmitFlow(payload)) {
    logStepInfo(tabId, roundId, stepKey, 22, '本步跳过');
    return;
  }
  if (ctx.jimengSkipRelay === true) {
    logStepInfo(tabId, roundId, stepKey, 22, '未执行图片回传本步跳过');
    return;
  }
  logStepEnter(tabId, roundId, stepKey, 22, '将生成图回传至熔炉页');
  const images = ctx.jimengCollectedImages;
  const ge = payload.generationEvent;
  try {
    await relayJimengGeneratedImagesToCaller({
      roundId,
      generationEvent: ge,
      images,
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    logStepFail(tabId, roundId, stepKey, 22, '动作失败+回传熔炉页失败请保持熔炉页打开', m.slice(0, 500));
    throw new Error(JIMENG_RELAY_CALLER_GONE);
  }
  logStepDone(tabId, roundId, stepKey, 22, '已回传生成图至熔炉页');
}
