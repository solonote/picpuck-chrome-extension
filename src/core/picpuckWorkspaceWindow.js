/**
 * PicPuck 专用工作区浏览器窗口：站点 Agent Tab 仅在此窗口内分配。
 * 不再使用 Chrome 标签页分组（专用窗已隔离；分组 id 无法可靠清理与复用）。
 * windowId 存 `chrome.storage.session`；关闭窗口时 onRemoved 清除。
 */

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
    return null;
  }
  try {
    await chrome.tabs.query({ windowId: raw });
  } catch {
    await chrome.storage.session.remove(STORAGE_KEY);
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

/**
 * 是否当前 session 登记的专用窗内的 Tab（用于顶栏是否挂载等；不再依赖 tabGroups）。
 * @param {chrome.tabs.Tab | undefined} tab
 * @returns {Promise<boolean>}
 */
export async function isTabInPicpuckWorkspaceWindow(tab) {
  if (!tab || typeof tab.windowId !== 'number') return false;
  const sid = await chrome.storage.session.get(STORAGE_KEY);
  const wid = sid[STORAGE_KEY];
  if (typeof wid !== 'number' || !Number.isFinite(wid)) return false;
  return tab.windowId === wid;
}

export function installPicpuckWorkspaceWindowRemovedListener() {
  if (removedListenerInstalled) return;
  removedListenerInstalled = true;
  chrome.windows.onRemoved.addListener((windowId) => {
    void (async () => {
      try {
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
