/**
 * Gemini 站点业务步骤（step01～step03 由 core/dispatchRound 框架固定执行）。
 */
import { executeInAllFrames } from '../../core/executeAllFrames.js';
import { scrollTopViaInjectMain } from '../../core/mainWorldScrollTop.js';
import { logStepDone, logStepEnter, logStepFail, logStepInfo } from '../../core/stepLog.js';
import { waitForTabUrlWhen } from '../../core/waitTabUrl.js';
import {
  GEMINI_IMAGE_MAIN_INJECT_FAILED,
  GEMINI_UI_NOT_READY,
} from './geminiErrorCodes.js';
import { GEMINI_APP_HOME, isGeminiAppUrl } from './geminiUrls.js';

/** 与 `manifest.json` `web_accessible_resources` 路径一致 */
const GEMINI_IMAGE_MAIN_WORLD_FILE = 'src/agents/gemini/geminiImageMainWorld.js';
const FETCH_CAPTURE_MAIN_FILE = 'src/core/picpuckFetchCaptureMainWorld.js';

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

/** 熔炉页传入、随 step13 经 ARM 传到隔离世界，剪贴板成功后回传并记 GENERATION 事件 */
function payloadGenerationEvent(payload) {
  if (!payload || typeof payload !== 'object') return undefined;
  const ge = payload.generationEvent;
  if (!ge || typeof ge !== 'object') return undefined;
  const projectId = typeof ge.projectId === 'string' ? ge.projectId.trim() : '';
  const subjectType = typeof ge.subjectType === 'string' ? ge.subjectType.trim() : '';
  const subjectId = typeof ge.subjectId === 'string' ? ge.subjectId.trim() : '';
  const inputPrompt = typeof ge.inputPrompt === 'string' ? ge.inputPrompt : '';
  if (!projectId || !subjectType || !subjectId) return undefined;
  return { projectId, subjectType, subjectId, inputPrompt };
}

function normalizeAspectRatioId(raw) {
  if (raw == null || !String(raw).trim()) return '16:9';
  const s = String(raw)
    .trim()
    .replace(/\s+/g, '')
    .replace(/\//g, ':');
  return s || '16:9';
}

function effectiveGeminiPrompt(raw, aspectRatioId) {
  const p = typeof raw === 'string' ? raw : '';
  if (/--ar\s*=/i.test(p)) return p;
  return '--ar=' + aspectRatioId + '，' + p;
}

async function ensureGeminiImageMainWorldInjected(tabId, allFrames) {
  const target = allFrames ? { tabId, allFrames: true } : { tabId };
  /** 先加载公共捕获（内联 install 一次），再加载 Gemini MAIN；重复注入时两脚本均在文件头短路，不会重复注册钩子 */
  await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    files: [FETCH_CAPTURE_MAIN_FILE, GEMINI_IMAGE_MAIN_WORLD_FILE],
  });
}

/**
 * @param {unknown[]} results
 */
function pickGeminiMainResult(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  for (const ir of results) {
    const r = ir && typeof ir === 'object' && 'result' in ir ? ir.result : null;
    if (r && typeof r === 'object' && r.ok === true) return r;
  }
  for (const ir of results) {
    const r = ir && typeof ir === 'object' && 'result' in ir ? ir.result : null;
    if (r && typeof r === 'object' && r.ok === false && r.code === 'GEMINI_STEP12_SKIP_FRAME') continue;
    if (r && typeof r === 'object') return r;
  }
  const first = results[0];
  return first && typeof first === 'object' && 'result' in first ? first.result : null;
}

/**
 * @param {object} ctx dispatchRound 上下文
 * @param {{ nn: number, stepKey: string, runnerName: string, mainPayload: Record<string, unknown>, failUserMsg: string, startMsg: string, doneMsg: string, allFrames?: boolean }} opts
 */
async function execGeminiMainRunner(ctx, opts) {
  const { tabId, roundId } = ctx;
  const { nn, stepKey, runnerName, mainPayload, failUserMsg, startMsg, doneMsg, allFrames } = opts;
  const useAllFrames = !!allFrames;
  logStepEnter(tabId, roundId, stepKey, nn, startMsg);
  try {
    await ensureGeminiImageMainWorldInjected(tabId, useAllFrames);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    logStepFail(tabId, roundId, stepKey, nn, '动作失败+页内 Gemini 脚本注入失败请刷新页面后重试', m.slice(0, 500));
    throw new Error(GEMINI_IMAGE_MAIN_INJECT_FAILED);
  }
  const mergedPayload = { roundId, ...mainPayload };
  const target = useAllFrames ? { tabId, allFrames: true } : { tabId };
  const results = await chrome.scripting.executeScript({
    target,
    world: 'MAIN',
    func: async (packed) => {
      const gl = typeof globalThis !== 'undefined' ? globalThis : window;
      const inj = gl.__picpuckGeminiImage;
      if (!inj || typeof inj[packed.runnerName] !== 'function') {
        return { ok: false, code: 'GEMINI_IMAGE_MAIN_INJECT_FAILED' };
      }
      return inj[packed.runnerName](packed.payload);
    },
    args: [{ runnerName, payload: mergedPayload }],
  });
  const r = pickGeminiMainResult(results);
  if (!r || r.ok !== true) {
    const code = r && r.code ? String(r.code) : GEMINI_UI_NOT_READY;
    const detail = r && typeof r.detail === 'string' ? r.detail : '';
    logStepFail(tabId, roundId, stepKey, nn, failUserMsg, (detail || code).slice(0, 500));
    throw new Error(code);
  }
  logStepDone(tabId, roundId, stepKey, nn, doneMsg);
}

/**
 * @returns {number} 1 已登录，0 明确未登录，-1 无法判定（无 #gb 等）
 */
function readGeminiLoggedInMain() {
  try {
    const gb = document.getElementById('gb');
    if (!gb) return -1;
    if (gb.querySelector('a[aria-label="登录"]')) return 0;
    if (gb.querySelector('a[href*="SignOutOptions"]') || gb.querySelector('img.gbii')) return 1;
    return -1;
  } catch {
    return -1;
  }
}

/** 未登录或无法确认登录则本轮失败（与即梦 step04 策略一致）。 */
export async function step04_gemini_require_logged_in(ctx) {
  const { tabId, roundId } = ctx;
  const stepKey = 'step04_gemini_require_logged_in';
  logStepEnter(tabId, roundId, stepKey, 4, '检查各 frame 是否已登录 Google 账号');

  const frameResults = await executeInAllFrames(tabId, readGeminiLoggedInMain);
  const anyIn = frameResults.some((v) => v === 1);
  const anyOut = frameResults.some((v) => v === 0);

  if (anyIn) {
    logStepDone(tabId, roundId, stepKey, 4, '已确认处于登录状态');
    return;
  }

  logStepFail(
    tabId,
    roundId,
    stepKey,
    4,
    anyOut ? '动作失败+未登录 Gemini 请先登录后再使用生成功能' : '动作失败+无法确认 Gemini 登录状态请刷新页面',
    'readGeminiLoggedIn frames=' + JSON.stringify(frameResults),
  );
  throw new Error('GEMINI_NOT_LOGGED_IN');
}

/** 导航至 `/app` 并滚顶（类比即梦 step05）。 */
export async function step05_gemini_ensure_app_home(ctx) {
  const { tabId, roundId } = ctx;
  const stepKey = 'step05_gemini_ensure_app_home';
  logStepEnter(tabId, roundId, stepKey, 5, '确认当前在 Gemini 站点并进入应用首页');

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || '';
  if (url.indexOf('gemini.google.com') === -1) {
    logStepInfo(tabId, roundId, stepKey, 5, '动作失败+当前标签页不是 Gemini 站点');
    throw new Error('GEMINI_NOT_GEMINI_TAB');
  }

  if (isGeminiAppUrl(url)) {
    logStepInfo(tabId, roundId, stepKey, 5, '已在应用页将对话区滚至顶部');
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: scrollTopViaInjectMain,
    });
    logStepDone(tabId, roundId, stepKey, 5, '应用页就绪');
    return;
  }

  logStepInfo(tabId, roundId, stepKey, 5, '正在导航至 Gemini 应用首页');
  try {
    await chrome.tabs.update(tabId, { url: GEMINI_APP_HOME });
    await waitForTabUrlWhen(
      tabId,
      45000,
      (u) => u.indexOf('gemini.google.com') !== -1 && isGeminiAppUrl(u),
      'GEMINI_HOME_NAV_TIMEOUT',
    );
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    logStepFail(tabId, roundId, stepKey, 5, '动作失败+无法打开 Gemini 应用页请稍后重试', m.slice(0, 500));
    throw e;
  }

  await new Promise((r) => setTimeout(r, 400));
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: scrollTopViaInjectMain,
  });
  logStepDone(tabId, roundId, stepKey, 5, '已打开应用首页并滚顶');
}

/** 工具 →「制作图片」 */
export async function step06_gemini_ensure_make_image_entry(ctx) {
  await execGeminiMainRunner(ctx, {
    nn: 6,
    stepKey: 'step06_gemini_ensure_make_image_entry',
    runnerName: 'runStep06GeminiEnsureMakeImageEntry',
    mainPayload: {},
    failUserMsg: '动作失败+无法进入 Gemini 制作图片模式',
    startMsg: '打开工具抽屉并进入「制作图片」',
    doneMsg: '已进入制作图片模式',
  });
}

/**
 * 纯 SW：按 aspectRatioId 与 prompt 写入 `ctx.effectivePrompt`（设计 §5.1）。
 */
export async function step07_gemini_apply_effective_prompt_on_context(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step07_gemini_apply_effective_prompt_on_context';
  logStepEnter(tabId, roundId, stepKey, 7, '按画幅与提示词组装本轮有效提示词');
  const ar = normalizeAspectRatioId(payloadString(payload, 'aspectRatioId'));
  ctx.effectivePrompt = effectiveGeminiPrompt(payloadString(payload, 'prompt'), ar);
  logStepDone(
    tabId,
    roundId,
    stepKey,
    7,
    '有效提示词已写入上下文长度=' + (ctx.effectivePrompt || '').length,
  );
}

/** Pro / 快速（bardMode） */
export async function step08_gemini_ensure_bard_mode(ctx) {
  const { payload } = ctx;
  const bardRaw = payload && typeof payload === 'object' ? payload.bardMode : undefined;
  const bardMode = bardRaw === 'pro' ? 'pro' : 'banana2';
  await execGeminiMainRunner(ctx, {
    nn: 8,
    stepKey: 'step08_gemini_ensure_bard_mode',
    runnerName: 'runStep08GeminiEnsureBardMode',
    mainPayload: { bardMode },
    failUserMsg: '动作失败+无法选择 Gemini 生成模式',
    startMsg: '在模式选择器中选择快速或 Pro（与请求一致）',
    doneMsg: '对话模式已就绪',
  });
}

/** 清空已有参考预览 → 填入 effectivePrompt → 粘贴配图 */
export async function step09_gemini_fill_input_and_paste_images(ctx) {
  const { effectivePrompt, payload } = ctx;
  const text = typeof effectivePrompt === 'string' ? effectivePrompt : '';
  await execGeminiMainRunner(ctx, {
    nn: 9,
    stepKey: 'step09_gemini_fill_input_and_paste_images',
    runnerName: 'runStep09GeminiFillInputAndPasteImages',
    mainPayload: {
      effectivePrompt: text,
      images: payloadImages(payload),
    },
    failUserMsg: '动作失败+无法写入 Gemini 输入框或粘贴图片',
    startMsg: '清空旧参考图写入提示词并粘贴参考图',
    doneMsg: '输入区与参考图已就绪',
  });
}

/** 占位式确认：便于日志对齐八步编排 */
export async function step10_gemini_confirm_prompt_applied(ctx) {
  const { tabId, roundId } = ctx;
  const stepKey = 'step10_gemini_confirm_prompt_applied';
  logStepInfo(tabId, roundId, stepKey, 10, '填词与贴图步骤已执行完毕');
}

/** fillOnly 时跳过：否则在输入区派发 Enter 提交（仅主 frame：allFrames 时子 frame 会拖满 executeScript 整轮 Promise） */
export async function step11_gemini_submit_enter_if_needed(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step11_gemini_submit_enter_if_needed';
  if (payloadFillOnly(payload)) {
    logStepInfo(tabId, roundId, stepKey, 11, '填词仅模式跳过在输入区按 Enter 提交');
    return;
  }
  await execGeminiMainRunner(ctx, {
    nn: 11,
    stepKey,
    runnerName: 'runStep11GeminiSubmitEnterIfNeeded',
    mainPayload: {},
    failUserMsg: '动作失败+无法用 Enter 提交 Gemini 提示词',
    startMsg: '在输入区模拟 Enter 提交生成请求',
    doneMsg: '已提交生成请求',
  });
}

/** 等待 generated-image 与预览图（3 分钟） */
export async function step12_gemini_wait_generated_image(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step12_gemini_wait_generated_image';
  if (payloadFillOnly(payload)) {
    logStepInfo(tabId, roundId, stepKey, 12, '填词仅模式跳过等待生成预览图');
    return;
  }
  await execGeminiMainRunner(ctx, {
    nn: 12,
    stepKey,
    runnerName: 'runStep12GeminiWaitGeneratedImage',
    mainPayload: {},
    failUserMsg: '动作失败+等待 Gemini 生成图超时',
    startMsg: '等待页面出现已加载的生成预览图',
    doneMsg: '预览图已出现',
  });
}

/** 点「下载完整尺寸」→ 首条 >1MB 的 lh3 rd-gg-dl 图片经临时监听写入剪贴板（捕获脚本已在 ensure 时注入并单次 register） */
export async function step13_gemini_download_full_image_to_clipboard(ctx) {
  const { tabId, roundId, payload } = ctx;
  const stepKey = 'step13_gemini_download_full_image_to_clipboard';
  if (payloadFillOnly(payload)) {
    logStepInfo(tabId, roundId, stepKey, 13, '填词仅模式跳过整图下载与剪贴板');
    return;
  }
  await execGeminiMainRunner(ctx, {
    nn: 13,
    stepKey,
    runnerName: 'runStep13GeminiDownloadFullImageToClipboard',
    mainPayload: { captureTimeoutMs: 120000, generationEvent: payloadGenerationEvent(payload) },
    failUserMsg: '动作失败+整图下载链或剪贴板写入失败',
    startMsg: '点击整图下载拦截响应并写入系统剪贴板',
    doneMsg: '整图已写入系统剪贴板',
  });
}
