/**
 * §9.4 allocateTab(command)：每次请求全量 `tabs.query`（§9.2）→ 按站点 `homeUrl` 前缀筛候选 → **再**筛 PicPuck 蓝组内 Tab（见 `picpuckWorkspaceTabGroup`）→
 * 按 tab.id 升序尝试 §9.3 原子抢占；无 idle 则 `tabs.create` 并入 PicPuck 组后再 `waitForTabUrlPrefix` 与抢占。
 * 新建 Tab 且不要求抢焦点时：`waitForTabUrlPrefix`（首帧 complete）后再 `tabs.update({ active: false })`，避免导航过程中偶发抢当前标签。
 * `CommandRecord.recoverAllocateSilentDefault` 为 true 时：由 `getRecoverCheckFocusWorkTab()` 决定；未设或 `false` 则静默；`picpuckRecoverCheckFocusTab===true` 时检查阶段激活工作 Tab。
 */
import { getCommandRecord } from './registry.js';
import { injectableAcquireExecSlot } from './execSlot/injectableAcquireExecSlot.js';
import { filterAndSortCandidates, MAX_SAME_BASE_TABS } from './tabCandidates.js';
import {
  ensureTabInPicpuckWorkspaceGroup,
  filterPicpuckWorkspaceCandidates,
} from './picpuckWorkspaceTabGroup.js';
import { getRecoverCheckFocusWorkTab } from './asyncRecoverTabPolicy.js';

/** @typedef {{ ok: true, tabId: number }} AllocateTabOk */
/** @typedef {{ ok: false, errorCode: string, message?: string }} AllocateTabFail */

/**
 * @param {string} command
 * @returns {Promise<AllocateTabOk | AllocateTabFail>}
 */
export async function allocateTab(command) {
  const rec = getCommandRecord(command);
  if (!rec) {
    return { ok: false, errorCode: 'UNKNOWN_COMMAND', message: 'command not registered' };
  }
  const { homeUrl, taskBaseUrl } = rec;
  if (typeof homeUrl !== 'string' || typeof taskBaseUrl !== 'string' || !taskBaseUrl.startsWith(homeUrl)) {
    return { ok: false, errorCode: 'INTERNAL_TAB_STATE_ERROR', message: 'invalid CommandRecord urls' };
  }

  /** 异步找回 allocate 阶段：默认静默，由 `getRecoverCheckFocusWorkTab`（sync `picpuckRecoverCheckFocusTab`）决定是否激活；未设 false。Step04 内另有一次 focus 保证 recover 前 DOM 挂载。 */
  let focusAfterAllocate = true;
  if (rec.recoverAllocateSilentDefault === true) {
    focusAfterAllocate = await getRecoverCheckFocusWorkTab();
  }

  const all = await chrome.tabs.query({});
  const urlSorted = filterAndSortCandidates(all, homeUrl);
  const candidates = await filterPicpuckWorkspaceCandidates(urlSorted);

  // R12：同一前缀下第一个 idle 候选即复用；仅 PicPuck 蓝组内 Tab（不抢占用户裸开同域页）
  for (const tab of candidates) {
    if (tab.id == null) continue;
    const got = await tryAcquireOnTab(tab.id);
    if (got.ok && got.acquired) {
      if (focusAfterAllocate) {
        await focusWorkTab(tab.id);
      }
      return { ok: true, tabId: tab.id };
    }
  }

  const n = candidates.length;
  // §8：同前缀已有 n 个 Tab 且无一 idle 时不得再 create，返回 TAB_POOL_EXHAUSTED
  if (n >= MAX_SAME_BASE_TABS) {
    return { ok: false, errorCode: 'TAB_POOL_EXHAUSTED' };
  }

  const created = await chrome.tabs.create({ url: taskBaseUrl, active: focusAfterAllocate });
  if (created.id == null) {
    return { ok: false, errorCode: 'INTERNAL_TAB_STATE_ERROR', message: 'tabs.create no id' };
  }

  try {
    await ensureTabInPicpuckWorkspaceGroup(created.id);
  } catch (e) {
    console.warn('[PicPuck] ensureTabInPicpuckWorkspaceGroup after create', e);
    return { ok: false, errorCode: 'INTERNAL_TAB_STATE_ERROR', message: 'tab group failed' };
  }

  try {
    await waitForTabUrlPrefix(created.id, homeUrl, 60000);
  } catch (e) {
    console.warn('[PicPuck] waitForTabUrlPrefix', e);
    return { ok: false, errorCode: 'INTERNAL_TAB_STATE_ERROR', message: 'new tab url timeout' };
  }

  if (!focusAfterAllocate) {
    try {
      await chrome.tabs.update(created.id, { active: false });
    } catch (e) {
      console.warn('[PicPuck] tabs.update active:false after new tab load tab=%d', created.id, e);
    }
  }

  const got = await tryAcquireOnTab(created.id);
  if (!got.ok || !got.acquired) {
    return { ok: false, errorCode: 'INTERNAL_TAB_STATE_ERROR', message: 'acquire after create failed' };
  }
  if (focusAfterAllocate) {
    await focusWorkTab(created.id);
  }
  return { ok: true, tabId: created.id };
}

/**
 * @param {number} tabId
 * @returns {Promise<{ ok: boolean, acquired?: boolean, invalid?: boolean }>}
 */
/**
 * 激活工作 Tab 并聚焦其窗口（异步找回「取回」就绪后由步骤显式调用；普通指令在 allocateTab 内按需调用）。
 * @param {number} tabId
 */
export async function focusWorkTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    await chrome.tabs.update(tabId, { active: true });
  } catch (e) {
    console.warn('[PicPuck] focusWorkTab failed tab=%d', tabId, e);
  }
}

async function tryAcquireOnTab(tabId) {
  try {
    // 必须在 MAIN：与页面真实 DOM 上的 #picpuck-agent-topbar 为同一套节点（§9.3）
    const [inj] = await chrome.scripting.executeScript({
      target: { tabId },
      func: injectableAcquireExecSlot,
      world: 'MAIN',
    });
    const r = inj?.result;
    if (r && r.invalid) {
      console.warn('[PicPuck] invalid exec-state on tab', tabId);
    }
    if (r && typeof r.acquired === 'boolean') {
      return { ok: true, acquired: r.acquired, invalid: r.invalid };
    }
    return { ok: false };
  } catch (e) {
    console.warn('[PicPuck] tryAcquireOnTab failed tab=%d', tabId, e);
    return { ok: false };
  }
}

/**
 * @param {number} tabId
 * @param {string} urlPrefix 站点 homeUrl 前缀，用于确认导航未跳出本站
 * @param {number} timeoutMs
 */
/** §9.4 第 5 步：新建 Tab 须在 complete 且 url 仍以站点 homeUrl 为前缀后再执行 9.3 */
function waitForTabUrlPrefix(tabId, urlPrefix, timeoutMs) {
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
      reject(new Error('timeout'));
    }, timeoutMs);

    const matches = (tab) =>
      !!tab?.url && tab.url.startsWith('http') && tab.url.startsWith(urlPrefix);

    const onUpd = (id, change, tab) => {
      if (id !== tabId) return;
      if (change.status === 'complete' && matches(tab)) {
        cleanup();
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete' && matches(tab)) {
          cleanup();
          resolve();
        }
      })
      .catch(() => {});
  });
}
