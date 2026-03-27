/**
 * PicPuck 专用工作区浏览器窗口：站点 Agent Tab 仅在此窗口内分配，与熔炉窗口分离。
 * windowId 存 session；用户关闭窗口后 onRemoved 清缓存，下次 allocate 再建（默认 focused: false）。
 */

const STORAGE_KEY = 'picpuckWorkspaceWindowId';

/** @type {Promise<number> | null} */
let ensureInFlight = null;

let removedListenerInstalled = false;

/**
 * @returns {Promise<number>} 专用工作区窗口 ID
 */
async function createWorkspaceWindowAndStoreId() {
  const w = await chrome.windows.create({ url: 'about:blank', focused: false });
  const id = w.id;
  if (id == null || !Number.isFinite(id)) {
    throw new Error('PICPUCK_WORKSPACE_WINDOW_NO_ID');
  }
  await chrome.storage.session.set({ [STORAGE_KEY]: id });
  return id;
}

/**
 * 返回当前专用工作区窗口 ID；不存在或失效则创建（不抢 OS 焦点）。
 * @returns {Promise<number>}
 */
export async function ensurePicpuckWorkspaceWindow() {
  if (ensureInFlight) {
    return ensureInFlight;
  }
  ensureInFlight = (async () => {
    try {
      const sid = await chrome.storage.session.get(STORAGE_KEY);
      const raw = sid[STORAGE_KEY];
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        try {
          await chrome.windows.get(raw);
          return raw;
        } catch {
          await chrome.storage.session.remove(STORAGE_KEY);
        }
      }
      return await createWorkspaceWindowAndStoreId();
    } finally {
      ensureInFlight = null;
    }
  })();
  return ensureInFlight;
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
