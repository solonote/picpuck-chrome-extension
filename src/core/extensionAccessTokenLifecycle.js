/**
 * Extension Access Token：SW 全局生命周期（设计 **13**）。
 * 启动读 session → 有 Token 则立即 refresh + 5min alarm；失败则清空并走熔炉 Tab 代签；无匹配 Tab 则监听直至出现。
 */
import { mcupRefreshExtensionAccessToken } from './mcupGenerationAsyncApi.js';

export const PICPUCK_EXTENSION_ACCESS_TOKEN_REQUEST = 'PICPUCK_EXTENSION_ACCESS_TOKEN_REQUEST';

const ALARM_REFRESH = 'picpuckMcupExtensionTokenRefresh';
const REFRESH_PERIOD_MINUTES = 5;

/** @type {boolean} */
let furnaceWatchInstalled = false;

function normalizeApiBase(base) {
  if (!base || typeof base !== 'string') return '';
  return base.replace(/\/$/, '');
}

async function clearTokenSession() {
  try {
    await chrome.storage.session.remove(['picpuckMcupExtensionAccessToken', 'picpuckMcupApiBase']);
  } catch {
    /* ignore */
  }
}

/**
 * 与 manifest content_scripts 可注入的熔炉来源一致；生产域名须在 manifest 中声明 host_permissions 与 matches。
 * @param {string|undefined} url
 */
export function isMcupFurnaceUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1') return true;
    if (h === '::1') return true;
    return false;
  } catch {
    return false;
  }
}

async function scheduleRefreshAlarm() {
  try {
    await chrome.alarms.clear(ALARM_REFRESH);
  } catch {
    /* ignore */
  }
  try {
    await chrome.alarms.create(ALARM_REFRESH, { periodInMinutes: REFRESH_PERIOD_MINUTES });
  } catch (e) {
    console.warn('[PicPuck] alarms.create failed', e);
  }
}

/**
 * 立即刷新；成功则维持 alarm；失败则按 **13** 清空并尝试签发。
 */
async function refreshOrReissue() {
  try {
    await mcupRefreshExtensionAccessToken();
    await scheduleRefreshAlarm();
    return true;
  } catch (e) {
    await clearTokenSession();
    const issued = await issueFromFurnaceTab();
    if (!issued) installFurnaceTabWatchers();
    return issued;
  }
}

/**
 * @returns {Promise<boolean>} 是否已写入有效 Token
 */
async function issueFromFurnaceTab() {
  let tabs;
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return false;
  }
  const candidates = (tabs || [])
    .filter((t) => typeof t.id === 'number' && t.id > 0 && isMcupFurnaceUrl(t.url))
    .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

  for (const t of candidates) {
    const tabId = /** @type {number} */ (t.id);
    const requestId = crypto.randomUUID();
    try {
      const r = await chrome.tabs.sendMessage(tabId, {
        type: PICPUCK_EXTENSION_ACCESS_TOKEN_REQUEST,
        requestId,
      });
      if (r && r.ok === true && typeof r.token === 'string' && r.token.trim()) {
        const apiBase = normalizeApiBase(typeof r.apiBase === 'string' ? r.apiBase : '');
        if (!apiBase) continue;
        await chrome.storage.session.set({
          picpuckMcupExtensionAccessToken: r.token.trim(),
          picpuckMcupApiBase: apiBase,
        });
        await scheduleRefreshAlarm();
        try {
          await mcupRefreshExtensionAccessToken();
        } catch {
          await clearTokenSession();
          return false;
        }
        return true;
      }
    } catch {
      /* 页面未注入 content、或扩展页 */
    }
  }
  return false;
}

function installFurnaceTabWatchers() {
  if (furnaceWatchInstalled) return;
  furnaceWatchInstalled = true;

  const tryIssue = async () => {
    const ok = await issueFromFurnaceTab();
    if (ok) {
      try {
        chrome.tabs.onUpdated.removeListener(onUpdated);
      } catch {
        /* ignore */
      }
      try {
        chrome.tabs.onCreated.removeListener(onCreated);
      } catch {
        /* ignore */
      }
      furnaceWatchInstalled = false;
    }
  };

  function onUpdated(_tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && tab && isMcupFurnaceUrl(tab.url)) {
      void tryIssue();
    }
  }

  function onCreated(tab) {
    if (tab && isMcupFurnaceUrl(tab.url)) void tryIssue();
  }

  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.tabs.onCreated.addListener(onCreated);
}

async function boot() {
  const session = await chrome.storage.session.get([
    'picpuckMcupExtensionAccessToken',
    'picpuckMcupApiBase',
  ]);
  const token =
    typeof session.picpuckMcupExtensionAccessToken === 'string'
      ? session.picpuckMcupExtensionAccessToken.trim()
      : '';
  const apiBase = normalizeApiBase(
    typeof session.picpuckMcupApiBase === 'string' ? session.picpuckMcupApiBase : '',
  );

  if (token && apiBase) {
    await refreshOrReissue();
    return;
  }

  await clearTokenSession();
  const issued = await issueFromFurnaceTab();
  if (!issued) installFurnaceTabWatchers();
}

export function installExtensionAccessTokenLifecycle() {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_REFRESH) return;
    void (async () => {
      const session = await chrome.storage.session.get([
        'picpuckMcupExtensionAccessToken',
        'picpuckMcupApiBase',
      ]);
      const token =
        typeof session.picpuckMcupExtensionAccessToken === 'string'
          ? session.picpuckMcupExtensionAccessToken.trim()
          : '';
      const apiBase = normalizeApiBase(
        typeof session.picpuckMcupApiBase === 'string' ? session.picpuckMcupApiBase : '',
      );
      if (!token || !apiBase) {
        const ok = await issueFromFurnaceTab();
        if (!ok) installFurnaceTabWatchers();
        return;
      }
      await refreshOrReissue();
    })();
  });

  chrome.runtime.onInstalled.addListener(() => {
    void boot();
  });
  chrome.runtime.onStartup.addListener(() => {
    void boot();
  });

  void boot();
}

/**
 * 跑站点步骤前调用；无有效 Token 则尝试熔炉签发（设计 **13**、**14** §B）。
 */
export async function ensureMcupExtensionAccessTokenOrThrow() {
  const session = await chrome.storage.session.get([
    'picpuckMcupExtensionAccessToken',
    'picpuckMcupApiBase',
  ]);
  const token =
    typeof session.picpuckMcupExtensionAccessToken === 'string'
      ? session.picpuckMcupExtensionAccessToken.trim()
      : '';
  const apiBase = normalizeApiBase(
    typeof session.picpuckMcupApiBase === 'string' ? session.picpuckMcupApiBase : '',
  );
  if (token && apiBase) {
    const tokenBefore = token;
    try {
      await mcupRefreshExtensionAccessToken();
      return;
    } catch (e) {
      const again = await chrome.storage.session.get([
        'picpuckMcupExtensionAccessToken',
        'picpuckMcupApiBase',
      ]);
      const tokenAfter =
        typeof again.picpuckMcupExtensionAccessToken === 'string'
          ? again.picpuckMcupExtensionAccessToken.trim()
          : '';
      if (tokenAfter && tokenAfter !== tokenBefore) {
        return;
      }
      await clearTokenSession();
    }
  }
  const issued = await issueFromFurnaceTab();
  if (!issued) installFurnaceTabWatchers();
  if (!issued) {
    throw new Error('MCUP_ASYNC_NO_TOKEN');
  }
}
