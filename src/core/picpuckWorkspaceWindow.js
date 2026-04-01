/**
 * PicPuck 专用工作区浏览器窗口：站点 Agent Tab 仅在此窗口内分配。
 * windowId 存 `chrome.storage.session`；关闭窗口时 onRemoved 清除。
 */

import { clearPicpuckWorkspaceGroupMappingForWindow } from './picpuckWorkspaceTabGroup.js';

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
 * 通过全量 tabs 上的 groupId + tabGroups.get，列出当前能看到的分组（含 windowId），用于和 query 结果对照。
 * @returns {Promise<Array<{ id: number, title: string, windowId: number }>>}
 */
async function listTabGroupsViaTabsEnumerate() {
  const tabs = await chrome.tabs.query({});
  const groupIds = new Set();
  for (const t of tabs) {
    const gid = t.groupId;
    if (typeof gid === 'number' && gid >= 0) {
      groupIds.add(gid);
    }
  }
  /** @type {Array<{ id: number, title: string, windowId: number }>} */
  const out = [];
  for (const gid of groupIds) {
    try {
      const g = await chrome.tabGroups.get(gid);
      out.push({ id: g.id, title: String(g.title ?? ''), windowId: g.windowId });
    } catch {
      /* 组已消失 */
    }
  }
  return out;
}

/**
 * @returns {Promise<number>}
 */
async function createWorkspaceWindowAndStoreId() {
  try {
    const allGroups = await chrome.tabGroups.query({});
    const queryRows = (allGroups || []).map((g) => ({
      id: g.id,
      title: g.title,
      windowId: g.windowId,
    }));
    console.log('[PicPuck] windows.create 前 tabGroups.query({})', {
      count: queryRows.length,
      groups: queryRows,
    });
  } catch (e) {
    console.log('[PicPuck] windows.create 前 tabGroups.query({}) 失败', e);
  }

  try {
    const viaTabs = await listTabGroupsViaTabsEnumerate();
    console.log('[PicPuck] windows.create 前 tabs 枚举 + tabGroups.get', {
      count: viaTabs.length,
      groups: viaTabs,
    });
  } catch (e) {
    console.log('[PicPuck] windows.create 前 tabs 枚举分组 失败', e);
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
