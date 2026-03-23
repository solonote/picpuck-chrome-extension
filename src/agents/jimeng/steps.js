/**
 * 即梦站点业务步骤（step01～step03 由 core/dispatchRound 框架固定执行）。
 */
import { appendLog } from '../../core/roundContext.js';
import { JIMENG_AI_TOOL_HOME, isJimengAiToolHomeUrl } from './jimengUrls.js';

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

function scrollJimengTabToTopMain() {
  try {
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
  } catch {
    /* ignore */
  }
}

/**
 * @param {number} tabId
 * @param {number} timeoutMs
 */
function waitForJimengAiToolHomeUrl(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpd);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('JIMENG_HOME_NAV_TIMEOUT'));
    }, timeoutMs);

    const onUpd = (id, changeInfo, updatedTab) => {
      if (id !== tabId || changeInfo.status !== 'complete') return;
      if (!updatedTab?.url || updatedTab.url.indexOf('jimeng.jianying.com') === -1) return;
      if (!isJimengAiToolHomeUrl(updatedTab.url)) return;
      cleanup();
      resolve();
    };

    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete' && tab.url && isJimengAiToolHomeUrl(tab.url)) {
        cleanup();
        resolve();
      }
    });
  });
}

/**
 * 未登录则本轮失败（较旧版「仍执行脚本」更严格：PicPuck 侧直接收到 error phase）。
 */
export async function step04_jimeng_require_logged_in(ctx) {
  const { tabId, roundId } = ctx;
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step04_jimeng_require_logged_in',
    level: 'info',
    message: 'Step04.进入步骤',
  });

  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: readJimengLoggedInFlagMain,
  });
  const loggedIn = Array.isArray(results) && results.some((r) => r && r.result === 1);

  if (!loggedIn) {
    appendLog(tabId, {
      ts: Date.now(),
      roundId,
      step: 'step04_jimeng_require_logged_in',
      level: 'info',
      message: 'Step04.动作失败+未登录即梦请先登录后再使用生成功能',
    });
    appendLog(tabId, {
      ts: Date.now(),
      roundId,
      step: 'step04_jimeng_require_logged_in',
      level: 'debug',
      message:
        'Step04.debug.readJimengLoggedInFlag frames=' +
        (Array.isArray(results) ? results.length : 0),
    });
    throw new Error('JIMENG_NOT_LOGGED_IN');
  }

  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step04_jimeng_require_logged_in',
    level: 'info',
    message: 'Step04.完成步骤',
  });
}

/**
 * 已登录：若不在 `ai-tool/home` 则整页导航至工作台，加载完成后滚顶；已在 home 则仅滚顶（对齐旧版 `ensureJimengAiToolHomeLoggedInThenScroll`）。
 */
export async function step05_jimeng_ensure_ai_tool_home(ctx) {
  const { tabId, roundId } = ctx;
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step05_jimeng_ensure_ai_tool_home',
    level: 'info',
    message: 'Step05.进入步骤',
  });

  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || '';
  if (url.indexOf('jimeng.jianying.com') === -1) {
    appendLog(tabId, {
      ts: Date.now(),
      roundId,
      step: 'step05_jimeng_ensure_ai_tool_home',
      level: 'info',
      message: 'Step05.动作失败+当前标签页不是即梦站点',
    });
    throw new Error('JIMENG_NOT_JIMENG_TAB');
  }

  if (isJimengAiToolHomeUrl(url)) {
    appendLog(tabId, {
      ts: Date.now(),
      roundId,
      step: 'step05_jimeng_ensure_ai_tool_home',
      level: 'info',
      message: 'Step05.已在即梦工作台页执行滚顶',
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: scrollJimengTabToTopMain,
    });
    appendLog(tabId, {
      ts: Date.now(),
      roundId,
      step: 'step05_jimeng_ensure_ai_tool_home',
      level: 'info',
      message: 'Step05.完成步骤',
    });
    return;
  }

  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step05_jimeng_ensure_ai_tool_home',
    level: 'info',
    message: 'Step05.导航至即梦工作台首页',
  });

  try {
    await chrome.tabs.update(tabId, { url: JIMENG_AI_TOOL_HOME });
    await waitForJimengAiToolHomeUrl(tabId, 45000);
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    appendLog(tabId, {
      ts: Date.now(),
      roundId,
      step: 'step05_jimeng_ensure_ai_tool_home',
      level: 'info',
      message: 'Step05.动作失败+无法打开即梦工作台首页请稍后重试',
    });
    appendLog(tabId, {
      ts: Date.now(),
      roundId,
      step: 'step05_jimeng_ensure_ai_tool_home',
      level: 'debug',
      message: 'Step05.debug.' + m.slice(0, 500),
    });
    throw e;
  }

  await new Promise((r) => setTimeout(r, 400));

  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: scrollJimengTabToTopMain,
  });

  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step05_jimeng_ensure_ai_tool_home',
    level: 'info',
    message: 'Step05.完成步骤',
  });
}

/**
 * 占位步骤：后续替换为真实 DOM 操作并遵守 §3.3 日志。
 */
export async function step06_jimeng_fill_placeholder(ctx) {
  const { tabId, roundId } = ctx;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      /* 占位：后续在此访问即梦 DOM */
    },
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step06_jimeng_fill_placeholder',
    level: 'info',
    message: 'Step06.进入步骤',
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step06_jimeng_fill_placeholder',
    level: 'info',
    message: 'Step06.占位步骤+尚未对接即梦页面表单',
  });
  appendLog(tabId, {
    ts: Date.now(),
    roundId,
    step: 'step06_jimeng_fill_placeholder',
    level: 'info',
    message: 'Step06.完成步骤',
  });
}
