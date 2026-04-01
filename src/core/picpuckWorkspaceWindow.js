/**
 * PicPuck 专用工作区浏览器窗口：站点 Agent Tab 仅在此窗口内分配，与熔炉窗口分离。
 * windowId 存 session；**在 `windows.create` 之前**若 session 无效，会全局查找标题为 PicPuck 工作区的标签组并复用其窗口，避免叠窗叠组。
 * `windowId` 同时写 **session** 与 **local**：扩展重载会清空 session，local 仍在则复用同一专用窗，避免每次「新建窗 + 首张 Tab 必 createProperties」被误认为叠组。
 * 用户**关掉整个专用浏览器窗口**时，Chrome 会销毁该窗内所有标签组；下次 allocate 只能再 `windows.create` + 首张工作 Tab 再 `createProperties` 一组——**不是** session 失效的 bug。若需长期复用同一「PicPuck Agent 专用」组，请**不要关专用窗**（可只关里面的站点 Tab 或最小化窗口）。
 * 用户关闭专用窗后 onRemoved 清 session + local。
 */

import { chromeWindowIdStillExists } from './chromeWindowExists.js';
import {
  clearPicpuckWorkspaceGroupMappingForWindow,
  findExistingWorkspaceWindowIdByPicpuckGroupTitle,
} from './picpuckWorkspaceTabGroup.js';

const STORAGE_KEY = 'picpuckWorkspaceWindowId';
/** 与 session 同语义，跨扩展重载保留（用户未关专用窗时找回） */
const LOCAL_KEY = 'picpuckWorkspaceWindowIdLocal';

/** 专用窗口初始尺寸（px，Chrome 会按显示器约束夹取）。略增高便于即梦/Gemini 编辑区与参考图。 */
const WORKSPACE_WINDOW_WIDTH = 1280;
const WORKSPACE_WINDOW_HEIGHT = 960;

let removedListenerInstalled = false;

async function persistWorkspaceWindowIdToStores(id) {
  await Promise.all([
    chrome.storage.session.set({ [STORAGE_KEY]: id }),
    chrome.storage.local.set({ [LOCAL_KEY]: id }),
  ]);
}

async function clearWorkspaceWindowIdFromStoresIfMatches(windowId) {
  const sid = await chrome.storage.session.get(STORAGE_KEY);
  if (sid[STORAGE_KEY] === windowId) {
    await chrome.storage.session.remove(STORAGE_KEY);
  }
  const loc = await chrome.storage.local.get(LOCAL_KEY);
  if (loc[LOCAL_KEY] === windowId) {
    await chrome.storage.local.remove(LOCAL_KEY);
  }
}

/**
 * @returns {Promise<number>} 专用工作区窗口 ID
 */
async function createWorkspaceWindowAndStoreId() {
  const w = await chrome.windows.create({
    url: 'about:blank',
    focused: false,
    width: WORKSPACE_WINDOW_WIDTH,
    height: WORKSPACE_WINDOW_HEIGHT,
  });
  const id = w.id;
  if (id == null || !Number.isFinite(id)) {
    throw new Error('PICPUCK_WORKSPACE_WINDOW_NO_ID');
  }
  await persistWorkspaceWindowIdToStores(id);
  return id;
}

async function resolveWorkspaceWindowIdFromSession() {
  const sid = await chrome.storage.session.get(STORAGE_KEY);
  const raw = sid[STORAGE_KEY];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  if (!(await chromeWindowIdStillExists(raw))) {
    await clearWorkspaceWindowIdFromStoresIfMatches(raw);
    await clearPicpuckWorkspaceGroupMappingForWindow(raw);
    return null;
  }
  // `windows.get/getAll` 偶发与真实可调度窗口脱节；再验一次 tabs，避免 session 指向已死窗却仍去 W2 里开 Tab、却在「以为的」旧窗上留映射/重复建组。
  try {
    await chrome.tabs.query({ windowId: raw });
  } catch (e) {
    console.warn('[PicPuck SW] workspace window id in session not queryable, clearing', raw, e);
    await clearWorkspaceWindowIdFromStoresIfMatches(raw);
    await clearPicpuckWorkspaceGroupMappingForWindow(raw);
    return null;
  }
  return raw;
}

/** session 被扩展重载清空后，仍可从 local 找回未关闭的专用窗 */
async function resolveWorkspaceWindowIdFromLocal() {
  const got = await chrome.storage.local.get(LOCAL_KEY);
  const raw = got[LOCAL_KEY];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  if (!(await chromeWindowIdStillExists(raw))) {
    await clearWorkspaceWindowIdFromStoresIfMatches(raw);
    await clearPicpuckWorkspaceGroupMappingForWindow(raw);
    return null;
  }
  try {
    await chrome.tabs.query({ windowId: raw });
  } catch (e) {
    console.warn('[PicPuck SW] workspace window id in local not queryable, clearing', raw, e);
    await clearWorkspaceWindowIdFromStoresIfMatches(raw);
    await clearPicpuckWorkspaceGroupMappingForWindow(raw);
    return null;
  }
  return raw;
}

/**
 * 返回当前专用工作区窗口 ID；不存在或失效则创建（不抢 OS 焦点）。
 * Web Locks 串行化，避免并发 `create` 出多个专用窗（与 picpuckWorkspaceTabGroup 同理）。
 * @returns {Promise<number>}
 */
export async function ensurePicpuckWorkspaceWindow() {
  const run = async () => {
    console.info('[PicPuck SW] ensurePicpuckWorkspaceWindow 进入');
    const existing = await resolveWorkspaceWindowIdFromSession();
    if (existing != null) {
      await persistWorkspaceWindowIdToStores(existing);
      console.info('[PicPuck SW] 专用窗来自 session windowId=', existing);
      return existing;
    }
    const fromLocal = await resolveWorkspaceWindowIdFromLocal();
    if (fromLocal != null) {
      await persistWorkspaceWindowIdToStores(fromLocal);
      console.info('[PicPuck SW] 专用窗来自 local（session 已空，常见于扩展重载）windowId=', fromLocal);
      return fromLocal;
    }
    const resurrected = await findExistingWorkspaceWindowIdByPicpuckGroupTitle();
    if (resurrected != null) {
      try {
        await chrome.tabs.query({ windowId: resurrected });
      } catch (e) {
        console.warn('[PicPuck SW] 按标签组标题找回的专用窗无法 query，将新建窗口', resurrected, e);
        return createWorkspaceWindowAndStoreId();
      }
      await persistWorkspaceWindowIdToStores(resurrected);
      console.info('[PicPuck SW] 专用窗复用（create 前已有 PicPuck 标题组）windowId=', resurrected);
      return resurrected;
    }
    console.info(
      '[PicPuck SW] 将 windows.create 新建专用窗（session/local/全局标题扫均无可用窗；若你刚关了专用窗，下一组标签组只能新建，Chrome 不会保留已关窗里的组）',
    );
    return createWorkspaceWindowAndStoreId();
  };

  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    return navigator.locks.request('picpuck-workspace-window-ensure', { mode: 'exclusive' }, run);
  }
  return run();
}

/**
 * 幂等：用户关闭专用窗口时清除 session，避免指向死 id。
 */
export function installPicpuckWorkspaceWindowRemovedListener() {
  if (removedListenerInstalled) return;
  removedListenerInstalled = true;
  chrome.windows.onRemoved.addListener((windowId) => {
    void (async () => {
      try {
        const sid = await chrome.storage.session.get(STORAGE_KEY);
        const loc = await chrome.storage.local.get(LOCAL_KEY);
        const wasWorkspace =
          sid[STORAGE_KEY] === windowId || loc[LOCAL_KEY] === windowId;
        if (wasWorkspace) {
          console.info('[PicPuck SW] 专用窗已关闭，已清 session/local 组映射', { windowId });
        }
        await clearPicpuckWorkspaceGroupMappingForWindow(windowId);
        await clearWorkspaceWindowIdFromStoresIfMatches(windowId);
      } catch {
        /* ignore */
      }
    })();
  });
}

/**
 * 新建站点 Tab 后关闭同窗口内多余的 about:blank（创建窗口时的占位页）。
 * @param {number} windowId
 * @param {number} keepTabId
 */
export async function prunePlaceholderTabsInWorkspaceWindow(windowId, keepTabId) {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    for (const t of tabs) {
      if (t.id == null || t.id === keepTabId) continue;
      const u = (t.url || t.pendingUrl || '').trim();
      if (u === 'about:blank' || u === 'chrome://newtab/') {
        try {
          await chrome.tabs.remove(t.id);
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}
