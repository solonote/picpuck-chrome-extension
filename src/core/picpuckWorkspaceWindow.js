/**
 * PicPuck 专用工作区浏览器窗口：站点 Agent Tab 仅在此窗口内分配。
 * windowId 存 `chrome.storage.session`；关闭窗口时 onRemoved 清除。
 */

import {
  clearPicpuckWorkspaceGroupMappingForWindow,
  getRecordedWorkspaceTabGroupIds,
} from './picpuckWorkspaceTabGroup.js';

const STORAGE_KEY = 'picpuckWorkspaceWindowId';
const WORKSPACE_WINDOW_WIDTH = 1280;
const WORKSPACE_WINDOW_HEIGHT = 960;

let removedListenerInstalled = false;

async function windowStillOpen(windowId) {
  try {
    await chrome.windows.get(windowId);
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {Promise<number>}
 */
async function createWorkspaceWindowAndStoreId() {
  try {
    const ids = await getRecordedWorkspaceTabGroupIds();
    /** @type {unknown[]} */
    const results = [];
    for (const groupId of ids) {
      try {
        const g = await chrome.tabGroups.get(groupId);
        results.push({
          ok: true,
          id: g.id,
          title: g.title,
          windowId: g.windowId,
          collapsed: g.collapsed,
        });
      } catch (err) {
        results.push({
          ok: false,
          id: groupId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    console.log('[PicPuck] windows.create 前 按持久化 id 调用 tabGroups.get（对比 query，测未激活态是否可读）', {
      storedIdCount: ids.length,
      results,
    });
  } catch (e) {
    console.log('[PicPuck] windows.create 前 持久化 id → tabGroups.get 探测失败', e);
  }

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
  if (!(await windowStillOpen(raw))) {
    await chrome.storage.session.remove(STORAGE_KEY);
    await clearPicpuckWorkspaceGroupMappingForWindow(raw);
    return null;
  }
  try {
    await chrome.tabs.query({ windowId: raw });
  } catch {
    await chrome.storage.session.remove(STORAGE_KEY);
    await clearPicpuckWorkspaceGroupMappingForWindow(raw);
    return null;
  }
  return raw;
}

/**
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
