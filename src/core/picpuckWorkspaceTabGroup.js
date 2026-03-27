/**
 * PicPuck 工作区标签页分组：展示名为「PicPuck Agent 专用」、蓝色。
 * **解析 groupId：先在当前窗口用组标题匹配**（含旧标题 PicPuck），有则合并多组并采用该 id；无标题命中再用 session 辅助「新建尚未写标题」的瞬间。不以 session 为优先，避免与真实已命名组脱节。
 * `allocateTab`：`filterPicpuckWorkspaceCandidates` 会纳入**专用窗口内**同 homeUrl 但未入蓝组的 Tab（优先尝试并入组并复用），避免已开 Gemini 仍 `tabs.create` 重复开页。
 *
 * **分组列表**：使用 `chrome.tabGroups.query({ windowId })` 可拿到当前窗口分组；另用 `tabGroups.get` + `tabs.query({ groupId })` 过滤已解散/无 Tab 的残留项。重复建组常见根因是**并发**（见 `ensureTabInPicpuckWorkspaceGroup` 中 Web Locks 说明），而非「读不到列表」。
 * **查/建/取 id 的一体化**：见 `runPicpuckWorkspaceGroupEnsureAtomicSequence`（仅能在锁内跑）；对外只调 `ensureTabInPicpuckWorkspaceGroup`。平台无同步 API，故为 async「单事务」而非字面同步。
 */
/** @readonly 与 UI 展示一致；旧版标题「PicPuck」仍识别并迁移为本标题。 */
export const PICPUCK_AGENT_WORKSPACE_GROUP_TITLE = 'PicPuck Agent 专用';

const LEGACY_WORKSPACE_GROUP_TITLE = 'PicPuck';

const STORAGE_KEY = 'picpuckWorkspaceGroupByWindow';

// #region agent log
/** @param {string} msg @param {Record<string, unknown>} data @param {string} hypothesisId */
function __dbgPicpuckTabGroup(msg, data, hypothesisId) {
  fetch('http://127.0.0.1:7580/ingest/950995e1-d0ac-4671-9d6d-791b255470ef', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '2e5487' },
    body: JSON.stringify({
      sessionId: '2e5487',
      location: 'picpuckWorkspaceTabGroup.js',
      message: msg,
      data,
      timestamp: Date.now(),
      hypothesisId,
    }),
  }).catch(() => {});
}
// #endregion

/**
 * 仅以组标题识别工作区分组（trim）。新建组在 `tabGroups.update` 生效前常为灰、标题空，不能再用 color===blue 否则扫描不到、会误建第二个同名组。
 * @param {chrome.tabGroups.TabGroup} g
 */
function workspaceGroupTitleMatches(g) {
  const t = String(g.title || '').trim();
  return t === PICPUCK_AGENT_WORKSPACE_GROUP_TITLE || t === LEGACY_WORKSPACE_GROUP_TITLE;
}

/**
 * @param {chrome.tabGroups.TabGroup} g
 * @param {number | null | undefined} sessionGid 本窗口 session 登记的组 id（用于标题尚未写回的瞬间）
 */
function isPicpuckAgentWorkspaceGroup(g, sessionGid) {
  if (workspaceGroupTitleMatches(g)) return true;
  if (sessionGid != null && g.id === sessionGid) return true;
  return false;
}

/** @type {Map<number, Promise<void>>} */
const winGroupChain = new Map();

async function loadGroupMap() {
  const raw = await chrome.storage.session.get(STORAGE_KEY);
  return raw[STORAGE_KEY] && typeof raw[STORAGE_KEY] === 'object' ? { ...raw[STORAGE_KEY] } : {};
}

async function saveGroupMap(map) {
  await chrome.storage.session.set({ [STORAGE_KEY]: map });
}

/**
 * 分组已解散/关闭后，`tabGroups.query` 仍可能短暂带出无效 id；须确认组仍存在、仍属本窗口且至少有一个 Tab。
 * @param {number} windowId
 * @param {number} groupId
 * @returns {Promise<chrome.tabGroups.TabGroup | null>}
 */
async function getLiveTabGroupInWindow(windowId, groupId) {
  if (typeof groupId !== 'number' || !Number.isFinite(groupId)) return null;
  let tg;
  try {
    tg = await chrome.tabGroups.get(groupId);
  } catch {
    return null;
  }
  if (tg.windowId !== windowId) return null;
  let tabs;
  try {
    tabs = await chrome.tabs.query({ windowId, groupId });
  } catch {
    return null;
  }
  if (!Array.isArray(tabs) || tabs.length === 0) return null;
  return tg;
}

/**
 * @param {number} windowId
 * @param {number} groupId
 * @returns {Promise<boolean>}
 */
async function tabGroupIsLiveInWindow(windowId, groupId) {
  const tg = await getLiveTabGroupInWindow(windowId, groupId);
  return tg != null;
}

/**
 * @param {number} windowId
 * @param {chrome.tabGroups.TabGroup} g
 * @returns {Promise<chrome.tabGroups.TabGroup | null>}
 */
async function refreshTabGroupIfLiveInWindow(windowId, g) {
  return getLiveTabGroupInWindow(windowId, g.id);
}

/**
 * `query` 结果只保留仍存活的分组，避免把已关闭分组当「已有 PicPuck 组」从而跳过合并、又去新建一组。
 * @param {number} windowId
 * @param {chrome.tabGroups.TabGroup[]} raw
 * @returns {Promise<chrome.tabGroups.TabGroup[]>}
 */
async function filterLiveTabGroupsInWindow(windowId, raw) {
  const out = await Promise.all(
    raw.map(async (g) => {
      const v = await refreshTabGroupIfLiveInWindow(windowId, g);
      return v;
    }),
  );
  return out.filter((x) => x != null);
}

/**
 * 移除已失效映射：窗口已关、组已删、组已不在该窗口、或组内已无 Tab（用户关掉分组内所有标签后 session 仍可能指向旧 id）。
 */
async function pruneStaleGroupMappings() {
  const map = await loadGroupMap();
  let changed = false;
  const next = { ...map };
  for (const [wStr, gid] of Object.entries(map)) {
    const wid = Number(wStr);
    if (!Number.isFinite(wid)) {
      delete next[wStr];
      changed = true;
      continue;
    }
    try {
      await chrome.windows.get(wid);
    } catch {
      delete next[wStr];
      changed = true;
      continue;
    }
    if (!(await tabGroupIsLiveInWindow(wid, gid))) {
      delete next[wStr];
      changed = true;
    }
  }
  if (changed) {
    await saveGroupMap(next);
  }
}

/**
 * 专用工作区窗口关闭时由 `picpuckWorkspaceWindow` 调用：立刻删掉本窗口的分组映射，避免新窗口复用旧 windowId 逻辑混乱。
 * @param {number} windowId
 */
export async function clearPicpuckWorkspaceGroupMappingForWindow(windowId) {
  if (typeof windowId !== 'number' || !Number.isFinite(windowId)) return;
  const map = await loadGroupMap();
  const k = String(windowId);
  if (map[k] == null) return;
  const next = { ...map };
  delete next[k];
  await saveGroupMap(next);
}

async function getValidatedGroupIdForWindow(windowId) {
  const map = await loadGroupMap();
  const gid = map[String(windowId)];
  if (gid == null) return null;
  if (await tabGroupIsLiveInWindow(windowId, gid)) {
    return gid;
  }
  const next = { ...map };
  delete next[String(windowId)];
  await saveGroupMap(next);
  return null;
}

/**
 * 合并窗口内多个 PicPuck 相关组为 canonical，并统一标题/颜色。
 * @param {number} windowId
 * @param {chrome.tabGroups.TabGroup[]} picpuck
 * @returns {Promise<number>}
 */
async function mergePicpuckTabGroupsInWindow(windowId, picpuck) {
  if (picpuck.length === 1) {
    const only = picpuck[0].id;
    try {
      await chrome.tabGroups.update(only, { title: PICPUCK_AGENT_WORKSPACE_GROUP_TITLE, color: 'blue' });
    } catch {
      /* ignore */
    }
    return only;
  }
  const canonical = Math.min(...picpuck.map((g) => g.id));
  for (const g of picpuck) {
    if (g.id === canonical) continue;
    let tabsIn;
    try {
      tabsIn = await chrome.tabs.query({ windowId, groupId: g.id });
    } catch {
      continue;
    }
    const ids = tabsIn.map((t) => t.id).filter((id) => id != null);
    if (ids.length === 0) continue;
    try {
      await chrome.tabs.group({ groupId: canonical, tabIds: ids });
    } catch (e) {
      console.warn('[PicPuck] merge duplicate PicPuck tab groups failed', e);
    }
  }
  try {
    await chrome.tabGroups.update(canonical, { title: PICPUCK_AGENT_WORKSPACE_GROUP_TITLE, color: 'blue' });
  } catch {
    /* ignore */
  }
  return canonical;
}

/**
 * `tabGroups.query({ windowId })` 在部分时序下会瞬时返回 []（runtime：debug-2e5487 第2行 raw=0，约 1s 后同 window raw=1）。
 * 回退为 `query({})` 再按 windowId 过滤，避免误判「无组」而连开多个 createProperties。
 * @param {number} windowId
 * @returns {Promise<{ groups: chrome.tabGroups.TabGroup[], usedGlobalFallback: boolean }>}
 */
async function queryTabGroupsForWindowRobust(windowId) {
  let primary = [];
  try {
    primary = await chrome.tabGroups.query({ windowId });
  } catch {
    primary = [];
  }
  if (primary.length > 0) {
    return { groups: primary, usedGlobalFallback: false };
  }
  try {
    const all = await chrome.tabGroups.query({});
    const filtered = all.filter((g) => g.windowId === windowId);
    return { groups: filtered, usedGlobalFallback: filtered.length > 0 };
  } catch {
    return { groups: [], usedGlobalFallback: false };
  }
}

/**
 * 扫描窗口内 PicPuck 分组 ID：**先按组标题**（含旧标题 PicPuck）在 Chrome 里找，得到 id；无标题命中再回退 session（新建组标题尚未写回的瞬间）。
 * @param {number} windowId
 * @returns {Promise<number | null>} 合并后应使用的 groupId；无则 null
 */
async function resolvePicpuckGroupIdInWindow(windowId) {
  const { groups: rawGroups, usedGlobalFallback } = await queryTabGroupsForWindowRobust(windowId);
  const rawCount = rawGroups.length;
  let groups = await filterLiveTabGroupsInWindow(windowId, rawGroups);
  const map = await loadGroupMap();
  const sessionGid = map[String(windowId)];

  const byTitle = groups.filter((g) => workspaceGroupTitleMatches(g));
  // #region agent log
  __dbgPicpuckTabGroup(
    'resolvePicpuckGroupIdInWindow',
    {
      windowId,
      rawTabGroupCount: rawCount,
      usedGlobalQueryFallback: usedGlobalFallback,
      liveAfterFilterCount: groups.length,
      byTitleCount: byTitle.length,
      sessionGid: sessionGid ?? null,
    },
    'H-B,H-D,H-E',
  );
  // #endregion
  if (byTitle.length > 0) {
    const canonical = await mergePicpuckTabGroupsInWindow(windowId, byTitle);
    // session 曾指向「刚创建、尚无标题」的另一组时，只按标题会漏合并，把该组标签并入 canonical
    if (sessionGid != null && sessionGid !== canonical) {
      const sg = await getLiveTabGroupInWindow(windowId, sessionGid);
      if (sg && !workspaceGroupTitleMatches(sg)) {
        try {
          const tabsIn = await chrome.tabs.query({ windowId, groupId: sessionGid });
          const ids = tabsIn.map((t) => t.id).filter((id) => id != null);
          if (ids.length > 0) {
            await chrome.tabs.group({ groupId: canonical, tabIds: ids });
          }
        } catch {
          /* ignore */
        }
      }
    }
    return canonical;
  }

  const picpuck = groups.filter((g) => isPicpuckAgentWorkspaceGroup(g, sessionGid));
  if (picpuck.length === 0) {
    // #region agent log
    __dbgPicpuckTabGroup(
      'resolvePicpuckGroupIdInWindow_null',
      { windowId, picpuckFallbackLen: 0, sessionGid: sessionGid ?? null },
      'H-D',
    );
    // #endregion
    return null;
  }
  return mergePicpuckTabGroupsInWindow(windowId, picpuck);
}

/**
 * 以 Chrome 内**按标题识别到的组**为权威，得到 groupId 后写回 session；session 仅作「无标题瞬间」辅助，不作为优先依据。
 * @param {number} windowId
 * @returns {Promise<number | null>}
 */
async function getOrSyncPicpuckGroupId(windowId) {
  const fromChrome = await resolvePicpuckGroupIdInWindow(windowId);
  if (fromChrome != null) {
    const map = await loadGroupMap();
    if (map[String(windowId)] !== fromChrome) {
      map[String(windowId)] = fromChrome;
      await saveGroupMap(map);
    }
    return fromChrome;
  }
  return getValidatedGroupIdForWindow(windowId);
}

/**
 * **逻辑上的「单事务」**（仍须 `await`）：在**已由外层 Web Lock / Promise 链串行化**的前提下，
 * 一次性完成：剪枝 session → 解析或合并有效 PicPuck 组 id → 把 `tabId` 并入该组 → 必要时创建新组并写 session 与标题。
 *
 * Chrome **不提供** `tabGroups` / `tabs` 的同步 API，因此无法实现 OS 意义下的阻塞式同步；本函数即为**不可再拆的异步原子序列**（勿在未持锁时并行调用）。
 *
 * @param {number} tabId
 * @param {number} windowId
 * @returns {Promise<void>}
 */
async function runPicpuckWorkspaceGroupEnsureAtomicSequence(tabId, windowId) {
  await pruneStaleGroupMappings();
  let gid = await getOrSyncPicpuckGroupId(windowId);
  // #region agent log
  __dbgPicpuckTabGroup(
    'ensureSequence_start',
    { tabId, windowId, gidAfterGetOrSync: gid ?? null },
    'H-D,H-E',
  );
  // #endregion
  if (gid != null) {
    try {
      await chrome.tabs.group({ groupId: gid, tabIds: [tabId] });
      return;
    } catch (e) {
      // #region agent log
      __dbgPicpuckTabGroup(
        'tabs_group_into_existing_failed',
        {
          tabId,
          windowId,
          gid,
          err: e instanceof Error ? e.message : String(e),
        },
        'H-C',
      );
      // #endregion
      console.warn('[PicPuck] tabs.group into PicPuck group failed', e);
      gid = await resolvePicpuckGroupIdInWindow(windowId);
      if (gid != null) {
        const map = await loadGroupMap();
        map[String(windowId)] = gid;
        await saveGroupMap(map);
        try {
          await chrome.tabs.group({ groupId: gid, tabIds: [tabId] });
          return;
        } catch (e2) {
          console.warn('[PicPuck] tabs.group into PicPuck group retry failed', e2);
        }
      }
    }
  }

  /** 并入失败或 session 为空时：再从窗口扫描 PicPuck 组，避免误建第二个同名组 */
  gid = await resolvePicpuckGroupIdInWindow(windowId);
  if (gid != null) {
    const map = await loadGroupMap();
    map[String(windowId)] = gid;
    await saveGroupMap(map);
    try {
      await chrome.tabs.group({ groupId: gid, tabIds: [tabId] });
      return;
    } catch (e) {
      console.warn('[PicPuck] tabs.group last-chance before create failed', e);
    }
  }

  try {
    const tabNow = await chrome.tabs.get(tabId);
    const gFromTab = tabNow.groupId;
    const groupNone =
      typeof chrome.tabGroups?.TAB_GROUP_ID_NONE === 'number' ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1;
    if (typeof gFromTab === 'number' && gFromTab !== groupNone) {
      const tgLive = await getLiveTabGroupInWindow(windowId, gFromTab);
      if (tgLive) {
        const mapSnap = await loadGroupMap();
        const sess = mapSnap[String(windowId)];
        if (workspaceGroupTitleMatches(tgLive) || isPicpuckAgentWorkspaceGroup(tgLive, sess)) {
          mapSnap[String(windowId)] = tgLive.id;
          await saveGroupMap(mapSnap);
          // #region agent log
          __dbgPicpuckTabGroup(
            'ensureSequence_skip_create_already_in_picpuck',
            { tabId, windowId, groupId: gFromTab },
            'post-fix',
          );
          // #endregion
          return;
        }
      }
    }
  } catch {
    /* ignore */
  }

  // #region agent log
  __dbgPicpuckTabGroup(
    'createProperties_new_tab_group',
    { tabId, windowId, lastGidBeforeCreate: gid ?? null },
    'H-A,H-B,H-C,H-D',
  );
  // #endregion
  const newGid = await chrome.tabs.group({ createProperties: { windowId }, tabIds: [tabId] });
  // #region agent log
  __dbgPicpuckTabGroup(
    'created_new_group',
    { tabId, windowId, newGid },
    'H-A,H-C',
  );
  // #endregion
  const mapNew = await loadGroupMap();
  mapNew[String(windowId)] = newGid;
  await saveGroupMap(mapNew);
  try {
    await chrome.tabGroups.update(newGid, { title: PICPUCK_AGENT_WORKSPACE_GROUP_TITLE, color: 'blue' });
  } catch (e) {
    console.warn('[PicPuck] tabGroups.update new workspace group failed', e);
  }
}

/**
 * Service Worker 专用窗口 id，供 Web Locks（与 windowId 组合，避免与其它上下文撞名）。
 * @param {number} windowId
 */
function picpuckWorkspaceTabGroupLockName(windowId) {
  return `picpuck-workspace-tabgroup-w${windowId}`;
}

/**
 * **对外唯一入口**：保证 `tabId` 落在当前窗口的 PicPuck 工作区分组内（无则创建并登记 groupId）。
 *
 * **「原子」与「同步」**
 * - Chrome **没有**标签分组 / 标签的**同步** API，扩展里无法写成不 `await` 的阻塞式同步方法。
 * - **逻辑原子性**：用 `navigator.locks`（或回退 `winGroupChain`）保证同一 `windowId` 在任意时刻**只有一条**
 *   `runPicpuckWorkspaceGroupEnsureAtomicSequence` 在执行，从而「查列表 → 取 id → 并入 / 创建 → 写 session」不会被另一条路径插队。
 * - MV3 Service Worker 会休眠/重启，仅靠内存 Promise 链会丢串行；Web Locks 由浏览器持有，可跨 SW 激活边界。
 *
 * @param {number} tabId
 */
export async function ensureTabInPicpuckWorkspaceGroup(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const wid = tab.windowId;
  if (wid == null) return;

  const run = () => runPicpuckWorkspaceGroupEnsureAtomicSequence(tabId, wid);

  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    try {
      // #region agent log
      __dbgPicpuckTabGroup('ensureTab_locks_path', { tabId, wid }, 'H-A');
      // #endregion
      await navigator.locks.request(picpuckWorkspaceTabGroupLockName(wid), { mode: 'exclusive' }, run);
      return;
    } catch (e) {
      // #region agent log
      __dbgPicpuckTabGroup(
        'ensureTab_locks_failed_fallback_chain',
        { tabId, wid, err: e instanceof Error ? e.message : String(e) },
        'H-A',
      );
      // #endregion
      console.warn('[PicPuck] navigator.locks.request tab group, fallback chain', e);
    }
  }

  // #region agent log
  __dbgPicpuckTabGroup('ensureTab_promise_chain_fallback', { tabId, wid }, 'H-A');
  // #endregion
  const prev = winGroupChain.get(wid) ?? Promise.resolve();
  const next = prev.then(run);
  winGroupChain.set(
    wid,
    next.catch((e) => {
      console.warn('[PicPuck] ensureTabInPicpuckWorkspaceGroup', e);
    }),
  );
  await next;
}

/**
 * @param {chrome.tabs.Tab | undefined} tab
 * @param {Record<string, number>} groupIdByWindowStr
 */
async function matchesPicpuckWorkspaceGroupTab(tab, groupIdByWindowStr) {
  if (!tab || tab.id == null || tab.windowId == null) return false;
  if (tab.groupId == null) return false;
  const expected = groupIdByWindowStr[String(tab.windowId)];
  if (expected == null || tab.groupId !== expected) return false;
  return tabGroupIsLiveInWindow(tab.windowId, expected);
}

/**
 * 当前 Tab 是否属于本窗口已登记的 PicPuck 蓝组（与 `filterPicpuckWorkspaceCandidates` 判定一致）。
 * 供 SW / 内容脚本经消息判断「是否显示工作台顶栏」。
 * @param {chrome.tabs.Tab | undefined} tab
 * @returns {Promise<boolean>}
 */
export async function isTabInPicpuckWorkspaceGroup(tab) {
  await pruneStaleGroupMappings();
  if (tab && typeof tab.windowId === 'number') {
    await getOrSyncPicpuckGroupId(tab.windowId);
  }
  const map = await loadGroupMap();
  return matchesPicpuckWorkspaceGroupTab(tab, map);
}

/**
 * 在 `filterAndSortCandidates` 之后调用：专用窗口内同域 Tab 中，**已在蓝组内的优先**，其余未入组但 URL 已匹配的排在后（allocate 时会先 `ensureTabInPicpuckWorkspaceGroup` 再抢占）。
 * @param {chrome.tabs.Tab[]} tabsSorted
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export async function filterPicpuckWorkspaceCandidates(tabsSorted) {
  await pruneStaleGroupMappings();
  /** 冷启动 / 合并组后 session 里的 groupId 可能滞后；先按窗口与 Chrome 内真实 PicPuck 蓝组对齐，再比对 tab.groupId */
  const uniqueWindowIds = [
    ...new Set(tabsSorted.map((t) => t.windowId).filter((w) => typeof w === 'number')),
  ];
  for (const wid of uniqueWindowIds) {
    await getOrSyncPicpuckGroupId(wid);
  }
  const map = await loadGroupMap();
  /** @type {chrome.tabs.Tab[]} */
  const inGroup = [];
  /** @type {chrome.tabs.Tab[]} */
  const orphan = [];
  for (const tab of tabsSorted) {
    if (await matchesPicpuckWorkspaceGroupTab(tab, map)) {
      inGroup.push(tab);
    } else {
      orphan.push(tab);
    }
  }
  const byId = (a, b) => (a.id ?? 0) - (b.id ?? 0);
  inGroup.sort(byId);
  orphan.sort(byId);
  return [...inGroup, ...orphan];
}
