/**
 * 即梦站点业务步骤（step01～step03 由 core/dispatchRound 框架固定执行）。
 */
import { executeInAllFrames } from '../../core/executeAllFrames.js';
import { scrollBottomViaInjectMain } from '../../core/mainWorldScrollTop.js';
import { logStepDone, logStepEnter, logStepFail, logStepInfo } from '../../core/stepLog.js';
import { waitForTabUrlWhen } from '../../core/waitTabUrl.js';
import { frameworkStep03_ensurePageHelpers } from '../../core/frameworkPreflight.js';
import { pushRoundPhaseUi } from '../../core/phaseUi.js';
import {
  JIMENG_IMAGE_MAIN_INJECT_FAILED,
  JIMENG_SUBMIT_MODE_INVALID,
  JIMENG_WORKBENCH_NOT_READY,
} from './jimengErrorCodes.js';
import { JIMENG_AI_TOOL_HOME, isJimengAiToolHomeUrl } from './jimengUrls.js';
import { ensureMcupExtensionAccessTokenOrThrow } from '../../core/extensionAccessTokenLifecycle.js';
import { mcupPatchExtensionState } from '../../core/mcupGenerationAsyncApi.js';

/** 设计 §3.1.1：与 `manifest.json` `web_accessible_resources` 路径一致 */
const JIMENG_IMAGE_MAIN_WORLD_FILE = 'src/agents/jimeng/jimengImageMainWorld.js';

function payloadString(payload, key) {
  if (!payload || typeof payload !== 'object') return '';
  const v = payload[key];
  return typeof v === 'string' ? v : '';
}

/** 熔炉传 `ratio`（如 9/16）时映射为即梦 radio 的 value（9:16）；显式 `ratioLabel` 优先 */
function payloadJimengRatioLabel(payload) {
  const explicit = payloadString(payload, 'ratioLabel');
  if (explicit) return explicit;
  const raw = payload && payload.ratio;
  const r = typeof raw === 'string' ? raw.trim() : raw != null ? String(raw).trim() : '';
  if (!r) return '';
  return r.replace(/\//g, ':');
}

/** 显式 `resolutionLabel` 优先，否则使用 `resolution`（与熔炉字段一致） */
function payloadJimengResolutionLabel(payload) {
  const explicit = payloadString(payload, 'resolutionLabel');
  if (explicit) return explicit;
  return payloadString(payload, 'resolution');
}

function payloadImages(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const v = payload.images;
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string' && x.trim().length > 0);
}

/**
 * `jimengGenerateImage` **必填**：`jimengSubmitMode` 为 `toolbar` | `enter` | `none`。
 * - `toolbar`：点击工具栏「生成」
 * - `enter`：不点工具栏，提示词区 Enter + step18～22
 * - `none`：不触发生成（仅填入）
 * @param {Record<string, unknown>|undefined|null} payload
 * @returns {'toolbar'|'enter'|'none'}
 */
function requireJimengSubmitMode(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error(JIMENG_SUBMIT_MODE_INVALID);
  }
  const m = payload.jimengSubmitMode;
  if (m === 'toolbar' || m === 'enter' || m === 'none') return m;
  throw new Error(JIMENG_SUBMIT_MODE_INVALID);
}

const JIMENG_ASYNC_JOB_ID_RE = /^[a-z0-9]{12}$/;

/** `DISPATCH` 合并后的 12 位 `async_job_id`；`FILL_DISPATCH` 仅填词路径无此字段 */
function hasJimengAsyncJobId(payload) {
  const aj =
    payload && typeof payload.async_job_id === 'string' ? payload.async_job_id.trim().toLowerCase() : '';
  return JIMENG_ASYNC_JOB_ID_RE.test(aj);
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

/**
 * JIMENG_ASYNC_PROBE / RELAY：页内返回 `outcome:not_ready` 时探查/收集步骤仅 info，不抛错；由调度侧决定是否继续 RELAY。
 */
async function execJimengRecoverMainRunner(ctx, opts) {
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
  if (r.outcome === 'not_ready') {
    logStepInfo(tabId, roundId, stepKey, nn, '即梦尚未生成完成或结果图未就绪');
    return r;
  }
  logStepDone(tabId, roundId, stepKey, nn, doneMsg);
  return r;
}

function generationEventFieldString(ge, k) {
  const v = ge[k];
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return '';
  return String(v).trim();
}

function generationEventFieldsComplete(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const ge = payload.generationEvent;
  if (ge && typeof ge === 'object') {
    const s = (k) => generationEventFieldString(ge, k);
    return !!(s('projectId') && s('subjectType') && s('subjectId') && s('inputPrompt') && s('coreEngine'));
  }
  // 熔炉「检查进度」/ list 拼出的 RECOVER 载荷仅有扁平字段，无嵌套 generationEvent
  const pid = typeof payload.projectId === 'string' ? payload.projectId.trim() : '';
  const st = typeof payload.subjectType === 'string' ? payload.subjectType.trim() : '';
  const sid = typeof payload.subjectId === 'string' ? payload.subjectId.trim() : '';
  const core = String(payload.core_engine || '').trim();
  const ip = payload.input_prompt;
  if (ip != null && typeof ip !== 'string') return false;
  return !!(pid && st && sid && core);
}

/** Step19 页内 DOM 锚点（data-id、列表项 id、提示词预览）并入回传 generationEvent，供后端与后续取图一致。 */
function buildJimengRelayGenerationEvent(payload, ctx) {
  /** @type {Record<string, unknown>} */
  let ge = {};
  if (payload && payload.generationEvent && typeof payload.generationEvent === 'object') {
    ge = { ...payload.generationEvent };
  } else if (payload && typeof payload === 'object') {
    const ip = payload.input_prompt;
    ge = {
      projectId: typeof payload.projectId === 'string' ? payload.projectId.trim() : '',
      subjectType: typeof payload.subjectType === 'string' ? payload.subjectType.trim() : '',
      subjectId: typeof payload.subjectId === 'string' ? payload.subjectId.trim() : '',
      inputPrompt: typeof ip === 'string' ? ip : '',
      coreEngine: String(payload.core_engine || '').trim(),
    };
  }
  const a = ctx && ctx.jimengRecordAnchor;
  if (!a || typeof a !== 'object') return ge;
  const did = generationEventFieldString(a, 'dataId');
  const rid = generationEventFieldString(a, 'recordItemId');
  const pv = generationEventFieldString(a, 'promptPreview');
  if (did) ge.jimeng_record_data_id = did;
  if (rid) ge.jimeng_record_item_id = rid;
  if (pv) ge.jimeng_prompt_preview = pv.length > 4000 ? pv.slice(0, 4000) : pv;
  const ajFlat =
    payload && typeof payload.async_job_id === 'string' ? payload.async_job_id.trim().toLowerCase() : '';
  if (/^[a-z0-9]{12}$/.test(ajFlat)) {
    ge.async_job_id = ajFlat;
  }
  return ge;
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
 * 已登录：若不在 `ai-tool/generate` 则整页导航至任务起始页，加载完成后滚至页底（懒加载后再滚一次）；已在该页则仅滚底。
 */
export async function step05_jimeng_ensure_ai_tool_home(ctx) {
  const { tabId, roundId } = ctx;
  const stepKey = 'step05_jimeng_ensure_ai_tool_home';
  logStepEnter(tabId, roundId, stepKey, 5, '确认在即梦站点并进入 AI 生成起始页');

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || '';
  if (url.indexOf('jimeng.jianying.com') === -1) {
    logStepInfo(tabId, roundId, stepKey, 5, '动作失败+当前标签页不是即梦站点');
    throw new Error('JIMENG_NOT_JIMENG_TAB');
  }

  async function scrollGeneratePageToBottom() {
    /* 窗口 + 大 overflow 容器均单调向下滚底；多拍给懒加载后 scrollHeight 变大再补滚 */
    await new Promise((r) => setTimeout(r, 400));
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: scrollBottomViaInjectMain,
    });
    await new Promise((r) => setTimeout(r, 450));
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: scrollBottomViaInjectMain,
    });
    await new Promise((r) => setTimeout(r, 550));
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: scrollBottomViaInjectMain,
    });
  }

  if (isJimengAiToolHomeUrl(url)) {
    logStepInfo(tabId, roundId, stepKey, 5, '已在生成起始页将页面滚至底部');
    await scrollGeneratePageToBottom();
    await pushRoundPhaseUi(tabId, roundId);
    logStepDone(tabId, roundId, stepKey, 5, '生成起始页就绪');
    return;
  }

  logStepInfo(tabId, roundId, stepKey, 5, '正在导航至即梦生成起始页');

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
      '动作失败+无法打开即梦生成起始页请稍后重试',
      m.slice(0, 500),
    );
    throw e;
  }

  await new Promise((r) => setTimeout(r, 400));

  /* 整页导航后 MAIN 清空，须重做 Step03，否则 Step13 缺 __idlinkPicpuckInject */
  await frameworkStep03_ensurePageHelpers(ctx);

  logStepInfo(tabId, roundId, stepKey, 5, '生成页滚至底部');
  await scrollGeneratePageToBottom();
  await pushRoundPhaseUi(tabId, roundId);

  logStepDone(tabId, roundId, stepKey, 5, '已打开生成起始页并滚底');
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
      ratioLabel: payloadJimengRatioLabel(payload),
      resolutionLabel: payloadJimengResolutionLabel(payload),
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

/** `jimengSubmitMode===toolbar` 时点击工具栏生成；`enter`/`none` 跳过 */
export async function step17_jimeng_click_generate_if_needed(ctx) {
  const { tabId, roundId, payload } = ctx;
  let mode;
  try {
    mode = requireJimengSubmitMode(payload);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    logStepFail(
      tabId,
      roundId,
      'step17_jimeng_click_generate_if_needed',
      17,
      '动作失败+jimengSubmitMode 须为 toolbar、enter 或 none',
      m.slice(0, 500),
    );
    throw new Error(JIMENG_SUBMIT_MODE_INVALID);
  }
  await execJimengMainRunner(ctx, {
    nn: 17,
    stepKey: 'step17_jimeng_click_generate_if_needed',
    runnerName: 'runStep17ClickGenerateIfNeeded',
    mainPayload: { jimengSubmitMode: mode },
    failUserMsg: '动作失败+无法点击即梦生成按钮',
    startMsg: '按需点击即梦「生成」按钮',
    doneMsg: '生成动作已处理',
  });
}

/** `jimengSubmitMode===enter`：MAIN 派发 Enter；否则跳过 */
export async function step18_jimeng_submit_prompt_enter_if_configured(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step18_jimeng_submit_prompt_enter_if_configured';
  if (payload.jimengSubmitMode !== 'enter') {
    logStepInfo(tabId, roundId, stepKey, 18, '非 Enter 提交+未在提示词区派发 Enter');
    return;
  }
  ctx.jimengEnterAtMs = Date.now();
  await execJimengMainRunner(ctx, {
    nn: 18,
    stepKey,
    runnerName: 'runStep18SubmitPromptEnterIfConfigured',
    mainPayload: { jimengSubmitMode: 'enter' },
    failUserMsg: '动作失败+无法在提示词区提交 Enter',
    startMsg: '在提示词区派发 Enter 键以提交生成',
    doneMsg: 'Enter 提交已派发',
  });
}

/**
 * 等待首条记录出现「生成中」语义并捕获锚点，最长 120s。
 * - **JIMENG_ASYNC_LAUNCH** 且已带 `async_job_id`（发布任务）：`toolbar` / `none` / `enter` 均可能执行本步以取锚点（`none` 时用户稍后手点生成仍可出现生成中）。
 * - **JIMENG_ASYNC_LAUNCH** 且无 `async_job_id`（**仅填词**）：不等待，避免 `submitMode=none` 时空等 120s、顶栏一直 running。
 * - **JIMENG_IMAGE_FILL**：仍仅 `enter` 跑本步（与同步 Step20～22 约定一致）。
 */
export async function step19_jimeng_wait_generation_started(ctx) {
  const { tabId, roundId, payload, command } = ctx;
  const stepKey = 'step19_jimeng_wait_generation_started';
  if (command === 'JIMENG_IMAGE_FILL' && payload.jimengSubmitMode !== 'enter') {
    logStepInfo(tabId, roundId, stepKey, 19, '同步填词且非 Enter 提交+不等待生成开始与锚点');
    return;
  }
  if (command === 'JIMENG_ASYNC_LAUNCH' && !hasJimengAsyncJobId(payload)) {
    logStepInfo(tabId, roundId, stepKey, 19, '异步仅填词+无 async_job_id+不等待生成开始与锚点');
    return;
  }
  const mode = requireJimengSubmitMode(payload);
  const enterAtMs =
    mode === 'enter' && typeof ctx.jimengEnterAtMs === 'number' ? ctx.jimengEnterAtMs : Date.now();
  const r = await execJimengMainRunnerWithResult(ctx, {
    nn: 19,
    stepKey,
    runnerName: 'runStep19WaitGenerationStarted',
    mainPayload: { enterAtMs: enterAtMs, jimengSubmitMode: mode },
    failUserMsg: '动作失败+等待即梦开始生成超时',
    startMsg: '等待即梦出现生成中界面并捕获锚点',
    doneMsg: '已检测到生成中状态',
  });
  if (r && r.jimengRecordAnchor && typeof r.jimengRecordAnchor === 'object') {
    ctx.jimengRecordAnchor = r.jimengRecordAnchor;
  }
}

/**
 * 仅 JIMENG_ASYNC_LAUNCH：Step19 拿到锚点后 PATCH 后端，供熔炉/后端持久化；不在此阶段等待出图。
 */
export async function step20_jimeng_patch_remote_after_anchor(ctx) {
  const { tabId, roundId, payload, command } = ctx;
  const stepKey = 'step20_jimeng_patch_remote_after_anchor';
  if (command === 'JIMENG_ASYNC_LAUNCH' && !hasJimengAsyncJobId(payload)) {
    logStepInfo(tabId, roundId, stepKey, 20, '异步仅填词+无异步任务+跳过锚点同步');
    return;
  }
  const aj =
    payload && typeof payload.async_job_id === 'string' ? payload.async_job_id.trim().toLowerCase() : '';
  if (!JIMENG_ASYNC_JOB_ID_RE.test(aj)) {
    logStepFail(tabId, roundId, stepKey, 20, '动作失败+缺少有效 async_job_id 无法同步锚点', '');
    throw new Error('JIMENG_ASYNC_NO_JOB_ID');
  }
  const anchor = ctx.jimengRecordAnchor;
  if (!anchor || typeof anchor !== 'object') {
    logStepFail(tabId, roundId, stepKey, 20, '动作失败+未捕获即梦锚点无法同步后端', '');
    throw new Error('JIMENG_ANCHOR_MISSING');
  }
  const projectId = String(payload.projectId || '').trim();
  if (!projectId) {
    logStepFail(tabId, roundId, stepKey, 20, '动作失败+缺少 projectId 无法同步锚点', '');
    throw new Error('JIMENG_ASYNC_NO_PROJECT');
  }
  logStepEnter(tabId, roundId, stepKey, 20, '将即梦锚点同步至后端');
  await ensureMcupExtensionAccessTokenOrThrow();
  /** 仅写入锚点上下文，保持 `EXT_REMOTE_IN_FLIGHT`；「待回收」在探查成功后再 PATCH（EXT_REMOTE_AWAITING_RELAY）。 */
  await mcupPatchExtensionState({
    projectId,
    async_job_id: aj,
    extension_remote_context: JSON.stringify({
      jimengRecordAnchor: anchor,
    }),
  });
  logStepDone(tabId, roundId, stepKey, 20, '锚点已同步');
}

/** 等待生成结束并统计结果图张数；自 Enter 起总超时 600s */
export async function step20_jimeng_wait_generation_finished(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step20_jimeng_wait_generation_finished';
  if (payload.jimengSubmitMode !== 'enter') {
    logStepInfo(tabId, roundId, stepKey, 20, '非 Enter 提交+不等待即梦生成结束');
    return;
  }
  const r = await execJimengMainRunnerWithResult(ctx, {
    nn: 20,
    stepKey,
    runnerName: 'runStep20WaitGenerationFinished',
    mainPayload: {
      enterAtMs: ctx.jimengEnterAtMs,
      jimengSubmitMode: 'enter',
      jimengRecordAnchor: ctx.jimengRecordAnchor,
    },
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
  if (payload.jimengSubmitMode !== 'enter') {
    logStepInfo(tabId, roundId, stepKey, 21, '非 Enter 提交+不从页面收集结果图');
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
  let n = typeof ctx.jimengResultImageCount === 'number' ? ctx.jimengResultImageCount : 0;
  if (n < 1) {
    const rCount = await execJimengMainRunnerWithResult(ctx, {
      nn: 21,
      stepKey: 'step21_jimeng_infer_n_from_dom',
      runnerName: 'runJimengCountNewestRecordImages',
      mainPayload: { roundId, jimengRecordAnchor: ctx.jimengRecordAnchor },
      failUserMsg: '动作失败+页面上未找到可复制的即梦结果图',
      startMsg: '推断最新记录（data-index=0）结果图张数',
      doneMsg: '已确定待复制张数',
    });
    n = typeof rCount.n === 'number' ? rCount.n : 0;
  }
  const r = await execJimengMainRunnerWithResult(ctx, {
    nn: 21,
    stepKey,
    runnerName: 'runStep21CollectImagesViaContextMenu',
    mainPayload: { n, jimengSubmitMode: 'enter', jimengRecordAnchor: ctx.jimengRecordAnchor },
    failUserMsg: '动作失败+通过右键菜单收集即梦结果图失败',
    startMsg: '逐张右键复制图片并读取剪贴板',
    doneMsg: '已收集全部结果图',
  });
  ctx.jimengCollectedImages = Array.isArray(r.images) ? r.images : [];
}

/** Enter 成功收集多图后：仅经扩展 Token 调后端 `generation-async/complete` 落库（不分片 relay 至熔炉页） */
export async function step22_jimeng_relay_images_to_caller(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step22_jimeng_relay_images_to_caller';
  if (payload.jimengSubmitMode !== 'enter') {
    logStepInfo(tabId, roundId, stepKey, 22, '非 Enter 提交+不落库产出图');
    return;
  }
  if (ctx.jimengSkipRelay === true) {
    logStepInfo(tabId, roundId, stepKey, 22, '前置已跳过收集或无图+未落库');
    return;
  }
  logStepEnter(tabId, roundId, stepKey, 22, '扩展 Token 完成异步落库');
  const images = ctx.jimengCollectedImages;
  const ge = buildJimengRelayGenerationEvent(payload, ctx);
  const aj = typeof ge.async_job_id === 'string' ? ge.async_job_id.trim().toLowerCase() : '';
  if (!/^[a-z0-9]{12}$/.test(aj)) {
    logStepFail(tabId, roundId, stepKey, 22, '动作失败+缺少合法 async_job_id+无法用扩展 Token 落库', '');
    throw new Error('JIMENG_STEP22_NO_ASYNC_JOB');
  }
  ctx.frameworkAsyncJobOutcome = {
    type: 'SUCCEEDED',
    images,
    generationEvent: ge,
  };
  logStepDone(tabId, roundId, stepKey, 22, '已登记回收结果+待框架提交落库');
}

/** JIMENG_ASYNC_PROBE：仅探查对端是否可收集；不执行 Step21/剪贴板；释放本轮后由 SW PATCH 并自动发起 RELAY。 */
export async function step04_jimeng_recover_probe_only(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step04_jimeng_recover_probe';
  if (!payload.jimengRecordAnchor || typeof payload.jimengRecordAnchor !== 'object') {
    logStepFail(tabId, roundId, stepKey, 4, '动作失败+payload 缺少 jimengRecordAnchor', '');
    throw new Error('JIMENG_RECOVER_NO_ANCHOR');
  }
  ctx.jimengRecordAnchor = payload.jimengRecordAnchor;
  const r = await execJimengRecoverMainRunner(ctx, {
    nn: 4,
    stepKey,
    runnerName: 'runJimengRecoverPipeline',
    mainPayload: {
      jimengRecordAnchor: payload.jimengRecordAnchor,
      recoverDomVerbose: payload.recoverDomVerbose === true,
      probeOnly: true,
    },
    failUserMsg: '动作失败+即梦探查页内执行失败',
    startMsg: '按锚点探查对端是否可收集结果图',
    doneMsg: '探查完成',
  });
  if (r && r.outcome === 'not_ready') {
    ctx.jimengProbeOutcome = 'not_ready';
    ctx.jimengRecoverOutcome = 'not_ready';
    ctx.jimengCollectedImages = [];
    return;
  }
  ctx.jimengProbeOutcome = 'ready';
  ctx.jimengRecoverOutcome = 'not_ready';
  ctx.jimengCollectedImages = [];
}

/** JIMENG_ASYNC_RELAY：在探查已判定可收集后执行页内收集 + 回传（Step21 内会先请求激活工作 Tab）。 */
export async function step04_jimeng_recover_collect(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step04_jimeng_recover_fetch';
  if (!payload.jimengRecordAnchor || typeof payload.jimengRecordAnchor !== 'object') {
    logStepFail(tabId, roundId, stepKey, 4, '动作失败+payload 缺少 jimengRecordAnchor', '');
    throw new Error('JIMENG_RECOVER_NO_ANCHOR');
  }
  ctx.jimengRecordAnchor = payload.jimengRecordAnchor;
  const r = await execJimengRecoverMainRunner(ctx, {
    nn: 4,
    stepKey,
    runnerName: 'runJimengRecoverPipeline',
    mainPayload: {
      jimengRecordAnchor: payload.jimengRecordAnchor,
      recoverDomVerbose: payload.recoverDomVerbose === true,
    },
    failUserMsg: '动作失败+即梦找回页内执行失败',
    startMsg: '按锚点收集结果图',
    doneMsg: '已取回结果图',
  });
  if (r && r.outcome === 'not_ready') {
    ctx.jimengRecoverOutcome = 'not_ready';
    ctx.jimengCollectedImages = [];
    return;
  }
  ctx.jimengRecoverOutcome = 'ready';
  ctx.jimengCollectedImages = Array.isArray(r.images) ? r.images : [];
}

/**
 * JIMENG_ASYNC_RELAY：Step04 已就绪时向框架登记回收结果（由 dispatchRound 末尾统一提交 complete）。
 */
export async function step05_jimeng_recover_relay_to_caller(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step05_jimeng_recover_relay_to_caller';
  if (ctx.jimengRecoverOutcome !== 'ready') {
    logStepInfo(tabId, roundId, stepKey, 5, '本轮未就绪或无可落库图');
    return;
  }
  if (!generationEventFieldsComplete(payload)) {
    logStepInfo(tabId, roundId, stepKey, 5, '缺少 generationEvent 完整字段已跳过落库');
    return;
  }
  const images = ctx.jimengCollectedImages;
  if (!Array.isArray(images) || images.length < 1) {
    logStepInfo(tabId, roundId, stepKey, 5, '无图片可落库');
    return;
  }
  logStepEnter(tabId, roundId, stepKey, 5, '扩展 Token 完成异步落库');
  const ge = buildJimengRelayGenerationEvent(payload, ctx);
  const ajForComplete =
    typeof ge.async_job_id === 'string' ? ge.async_job_id.trim().toLowerCase() : '';
  if (!/^[a-z0-9]{12}$/.test(ajForComplete)) {
    logStepFail(tabId, roundId, stepKey, 5, '动作失败+缺少合法 async_job_id+无法用扩展 Token 落库', '');
    throw new Error('JIMENG_RECOVER_NO_ASYNC_JOB');
  }
  ctx.frameworkAsyncJobOutcome = {
    type: 'SUCCEEDED',
    images,
    generationEvent: ge,
  };
  logStepDone(tabId, roundId, stepKey, 5, '已登记回收结果+待框架提交落库');
}
