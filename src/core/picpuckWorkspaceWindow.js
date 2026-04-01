/**
 * PicPuck 专用工作区浏览器窗口：站点 Agent Tab 仅在此窗口内分配，与熔炉窗口分离。
 * windowId 存 session；用户关闭窗口后 onRemoved 清缓存，下次 allocate 再建（默认 focused: false）。
 */

import { chromeWindowIdStillExists } from './chromeWindowExists.js';
import { clearPicpuckWorkspaceGroupMappingForWindow } from './picpuckWorkspaceTabGroup.js';

const STORAGE_KEY = 'picpuckWorkspaceWindowId';

/** 专用窗口初始尺寸（px，Chrome 会按显示器约束夹取）。略增高便于即梦/Gemini 编辑区与参考图。 */
const WORKSPACE_WINDOW_WIDTH = 1280;
const WORKSPACE_WINDOW_HEIGHT = 960;

let removedListenerInstalled = false;

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
  await chrome.storage.session.set({ [STORAGE_KEY]: id });
  return id;
}

async function resolveWorkspaceWindowIdFromSession() {
  const sid = await chrome.storage.session.get(STORAGE_KEY);
  const raw = sid[STORAGE_KEY];
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return null;
  }
  if (!(await chromeWindowIdStillExists(raw))) {
    await chrome.storage.session.remove(STORAGE_KEY);
    await clearPicpuckWorkspaceGroupMappingForWindow(raw);
    return null;
  }
  // `windows.get/getAll` 偶发与真实可调度窗口脱节；再验一次 tabs，避免 session 指向已死窗却仍去 W2 里开 Tab、却在「以为的」旧窗上留映射/重复建组。
  try {
    await chrome.tabs.query({ windowId: raw });
  } catch (e) {
    console.warn('[PicPuck] workspace window id in session not queryable, clearing', raw, e);
    await chrome.storage.session.remove(STORAGE_KEY);
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
    const existing = await resolveWorkspaceWindowIdFromSession();
    if (existing != null) return existing;
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
        await clearPicpuckWorkspaceGroupMappingForWindow(windowId);
        const sid = await chrome.storage.session.get(STORAGE_KEY);
        if (sid[STORAGE_KEY] === windowId) {
          await chrome.storage.session.remove(STORAGE_KEY);
        }
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
