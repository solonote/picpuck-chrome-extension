/**
 * PicPuck 工作区标签页分组：展示名为「PicPuck Agent 专用」、蓝色。
 * **解析 groupId：先在当前窗口用组标题匹配**（含旧标题 PicPuck），有则合并多组并采用该 id；无标题命中再用 session 辅助「新建尚未写标题」的瞬间。不以 session 为优先，避免与真实已命名组脱节。
 * `allocateTab`：`filterPicpuckWorkspaceCandidates` 会纳入**专用窗口内**同 homeUrl 但未入蓝组的 Tab（优先尝试并入组并复用），避免已开 Gemini 仍 `tabs.create` 重复开页。
 *
 * **分组列表**：`tabGroups.query` 在 MV3 Service Worker 中可能恒为 `[]`；须与 **`tabs.query` → `groupId` → `tabGroups.get`** 并集（`mergeTabGroupsWithTabsQueryEnumerate`）。`resolve` 与剪枝仍以 `tabGroups.get` + `windowId` 为准。
 * **查/建/取 id 的一体化**：见 `runPicpuckWorkspaceGroupEnsureAtomicSequence`（仅能在锁内跑）；对外只调 `ensureTabInPicpuckWorkspaceGroup`。平台无同步 API，故为 async「单事务」而非字面同步。
 */
import { chromeWindowIdStillExists } from './chromeWindowExists.js';
import { getAllCommandRecords } from './registry.js';

/** @readonly 与 UI 展示一致；旧版标题「PicPuck」仍识别并迁移为本标题。 */
export const PICPUCK_AGENT_WORKSPACE_GROUP_TITLE = 'PicPuck Agent 专用';

const LEGACY_WORKSPACE_GROUP_TITLE = 'PicPuck';

const STORAGE_KEY = 'picpuckWorkspaceGroupByWindow';

/**
 * 仅以组标题识别工作区分组（trim）。
 * @param {chrome.tabGroups.TabGroup} g
 */
function workspaceGroupTitleMatches(g) {
  const t = String(g.title || '').trim();
  return t === PICPUCK_AGENT_WORKSPACE_GROUP_TITLE || t === LEGACY_WORKSPACE_GROUP_TITLE;
}

/**
 * PicPuck **专用窗口**内仅会有本扩展建的蓝组；无标题且 color=blue 视为同一工作区组（标题尚未写入或 session 丢失时的兜底）。
 * @param {chrome.tabGroups.TabGroup} g
 */
function isUntitledBlueWorkspaceLikelyOurs(g) {
  if (String(g.title || '').trim() !== '') return false;
  return g.color === 'blue';
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

function isPicpuckWorkspaceGroupCandidate(g, sessionGid) {
  return isPicpuckAgentWorkspaceGroup(g, sessionGid) || isUntitledBlueWorkspaceLikelyOurs(g);
}

function tabGroupIdNoneValue() {
  return typeof chrome.tabGroups?.TAB_GROUP_ID_NONE === 'number' ? chrome.tabGroups.TAB_GROUP_ID_NONE : -1;
}

/**
 * 用全量 `tabs.query` 上非 NONE 的 `groupId` 再 `tabGroups.get`，得到 SW 里 `tabGroups.query` 漏掉的真实组列表。
 * @returns {Promise<chrome.tabGroups.TabGroup[]>}
 */
async function collectTabGroupsEnumerateViaTabsQuery() {
  const none = tabGroupIdNoneValue();
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return [];
  }
  const gids = new Set();
  for (const t of tabs) {
    const gid = t.groupId;
    if (gid == null || typeof gid !== 'number' || !Number.isFinite(gid) || gid === none) continue;
    gids.add(gid);
  }
  /** @type {chrome.tabGroups.TabGroup[]} */
  const out = [];
  for (const gid of gids) {
    try {
      out.push(await chrome.tabGroups.get(gid));
    } catch {
      /* ignore */
    }
  }
  return out;
}

/**
 * @param {chrome.tabGroups.TabGroup[]} fromQuery `tabGroups.query` 结果（可能为空）
 * @returns {Promise<chrome.tabGroups.TabGroup[]>} 按 group id 去重合并后
 */
async function mergeTabGroupsWithTabsQueryEnumerate(fromQuery) {
  const byId = new Map(fromQuery.map((g) => [g.id, g]));
  const viaTabs = await collectTabGroupsEnumerateViaTabsQuery();
  for (const g of viaTabs) {
    if (!byId.has(g.id)) byId.set(g.id, g);
  }
  return [...byId.values()];
}

/**
 * 同窗：`tabGroups.query({ windowId })` 可能为空，用该窗 `tabs.query` 的 `groupId` 补全。
 * @param {number} windowId
 * @param {chrome.tabGroups.TabGroup[]} fromQueryGroups
 * @returns {Promise<chrome.tabGroups.TabGroup[]>}
 */
async function mergeTabGroupsInWindowWithTabsEnumerate(windowId, fromQueryGroups) {
  const byId = new Map(fromQueryGroups.map((g) => [g.id, g]));
  const none = tabGroupIdNoneValue();
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch {
    return [...byId.values()];
  }
  for (const t of tabs) {
    const gid = t.groupId;
    if (gid == null || typeof gid !== 'number' || gid === none) continue;
    if (byId.has(gid)) continue;
    try {
      const g = await chrome.tabGroups.get(gid);
      if (g.windowId === windowId) byId.set(g.id, g);
    } catch {
      /* ignore */
    }
  }
  return [...byId.values()];
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
 * 组是否仍被 Chrome 持有且属于该窗口（**不**要求此时 `tabs.query` 已能列出标签）。
 * 用于剪枝与 resolve 列表：避免把「并入中、查询瞬时空」的存活组当成死组。
 */
async function tabGroupEntityBelongsToWindow(windowId, groupId) {
  if (typeof groupId !== 'number' || !Number.isFinite(groupId)) return false;
  try {
    const tg = await chrome.tabGroups.get(groupId);
    return tg.windowId === windowId;
  } catch {
    return false;
  }
}

async function getLiveTabGroupInWindow(windowId, groupId) {
  if (typeof groupId !== 'number' || !Number.isFinite(groupId)) return null;
  let tg;
  try {
    tg = await chrome.tabGroups.get(groupId);
  } catch {
    return null;
  }
  if (tg.windowId !== windowId) return null;
  /** `tabs.group` 并入瞬间 `tabs.query` 可能短暂为空；重试后再判「无 Tab」为真死组。 */
  for (let attempt = 0; attempt < 3; attempt++) {
    let tabs;
    try {
      tabs = await chrome.tabs.query({ windowId, groupId });
    } catch {
      return null;
    }
    if (Array.isArray(tabs) && tabs.length > 0) return tg;
    if (attempt + 1 < 3) {
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  return null;
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
 * `query` 返回的 id 中，仅保留 `tabGroups.get` 仍有效且 windowId 匹配的项（**不**要求 tabs 查询非空）。
 * @param {number} windowId
 * @param {chrome.tabGroups.TabGroup[]} raw
 * @returns {Promise<chrome.tabGroups.TabGroup[]>}
 */
async function filterQueryGroupsStillInWindow(windowId, raw) {
  const out = [];
  for (const g of raw) {
    if (!(await tabGroupEntityBelongsToWindow(windowId, g.id))) continue;
    try {
      out.push(await chrome.tabGroups.get(g.id));
    } catch {
      /* ignore */
    }
  }
  return out;
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
    if (!(await chromeWindowIdStillExists(wid))) {
      delete next[wStr];
      changed = true;
      continue;
    }
    if (!(await tabGroupEntityBelongsToWindow(wid, gid))) {
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

/**
 * 窗口内是否存在至少一个 Tab，其 URL 前缀命中已注册 `CommandRecord.homeUrl`（Gemini/即梦等工作区站点）。
 * 用于把「无标题蓝组」限定在真实工作区窗，避免误认主窗口里用户手动的蓝组。
 */
async function workspaceWindowHasRegisteredSiteTab(windowId) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId });
  } catch {
    return false;
  }
  const prefixes = new Set();
  for (const r of getAllCommandRecords()) {
    const h = typeof r.homeUrl === 'string' ? r.homeUrl.trim() : '';
    if (h.startsWith('http')) prefixes.add(h);
  }
  if (prefixes.size === 0) return false;
  for (const t of tabs) {
    const u = (t.url || t.pendingUrl || '').trim();
    if (!u.startsWith('http')) continue;
    for (const h of prefixes) {
      if (u.startsWith(h)) return true;
    }
  }
  return false;
}

/**
 * **`windows.create` 之前**必须调用：全局枚举标签组（`query({})` 空时按窗口再扫一遍），再决定能否复用已有窗。
 * 优先级：0 标题为 PicPuck 工作区；1 session `picpuckWorkspaceGroupByWindow` 中登记的 gid 仍属该窗；
 * 2 无标题且 blue，且该窗内已有已注册站点 Tab（常见：`tabGroups.update` 标题尚未写回、仅标题扫会漏）。
 *
 * @returns {Promise<number | null>}
 */
export async function findExistingWorkspaceWindowIdByGlobalTabGroupScan() {
  const map = await loadGroupMap();
  let fromQuery = [];
  try {
    fromQuery = await chrome.tabGroups.query({});
  } catch {
    fromQuery = [];
  }
  if (fromQuery.length === 0) {
    try {
      const wins = await chrome.windows.getAll({ populate: false });
      for (const w of wins) {
        if (w.id == null || typeof w.id !== 'number') continue;
        let sub = [];
        try {
          sub = await chrome.tabGroups.query({ windowId: w.id });
        } catch {
          continue;
        }
        fromQuery.push(...sub);
      }
    } catch {
      /* ignore */
    }
  }
  const tabGroupsQueryLen = fromQuery.length;
  const all = await mergeTabGroupsWithTabsQueryEnumerate(fromQuery);

  /** @type {Map<number, number>} windowId → 最优优先级（越小越可信） */
  const best = new Map();
  const consider = (wid, prio) => {
    if (typeof wid !== 'number' || !Number.isFinite(wid)) return;
    const prev = best.get(wid);
    if (prev == null || prio < prev) best.set(wid, prio);
  };

  for (const g of all) {
    const wid = g.windowId;
    if (typeof wid !== 'number' || !Number.isFinite(wid)) continue;
    if (!(await tabGroupEntityBelongsToWindow(wid, g.id))) continue;

    if (workspaceGroupTitleMatches(g)) {
      consider(wid, 0);
      continue;
    }
    const sessGid = map[String(wid)];
    if (sessGid != null && sessGid === g.id) {
      consider(wid, 1);
      continue;
    }
    if (isUntitledBlueWorkspaceLikelyOurs(g) && (await workspaceWindowHasRegisteredSiteTab(wid))) {
      consider(wid, 2);
    }
  }

  const ranked = [...best.entries()].sort((a, b) => {
    if (a[1] !== b[1]) return a[1] - b[1];
    return a[0] - b[0];
  });

  for (const [wid, prio] of ranked) {
    if (!(await chromeWindowIdStillExists(wid))) continue;
    try {
      await chrome.tabs.query({ windowId: wid });
    } catch {
      continue;
    }
    console.info('[PicPuck SW] create 前全局标签组扫描命中复用窗', {
      windowId: wid,
      matchPriority: prio,
      hint: prio === 0 ? 'title' : prio === 1 ? 'session_gid' : 'untitled_blue+site_tab',
      tabGroupsQueryLen,
      mergedGroupCount: all.length,
    });
    return wid;
  }
  console.info('[PicPuck SW] create 前全局标签组扫描未命中可复用窗', {
    tabGroupsQueryLen,
    mergedGroupCount: all.length,
    note: tabGroupsQueryLen === 0 && all.length > 0 ? 'tabGroups.query 空但 tabs.groupId 枚举有组（SW 已知问题）' : undefined,
  });
  return null;
}

/** @deprecated 使用 {@link findExistingWorkspaceWindowIdByGlobalTabGroupScan} */
export async function findExistingWorkspaceWindowIdByPicpuckGroupTitle() {
  return findExistingWorkspaceWindowIdByGlobalTabGroupScan();
}

async function getValidatedGroupIdForWindow(windowId) {
  const map = await loadGroupMap();
  const gid = map[String(windowId)];
  if (gid == null) return null;
  if (await tabGroupEntityBelongsToWindow(windowId, gid)) {
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
 * 把若干「其他组」里的 Tab 并入 `targetGroupId`（同窗内合并重复蓝组 / 无标题组）。
 * @param {number} windowId
 * @param {number} targetGroupId
 * @param {number[]} sourceGroupIds
 */
async function absorbTabGroupsIntoCanonical(windowId, targetGroupId, sourceGroupIds) {
  for (const sid of sourceGroupIds) {
    if (sid === targetGroupId) continue;
    let tabsIn;
    try {
      tabsIn = await chrome.tabs.query({ windowId, groupId: sid });
    } catch {
      continue;
    }
    const ids = tabsIn.map((t) => t.id).filter((id) => id != null);
    if (ids.length === 0) continue;
    try {
      await chrome.tabs.group({ groupId: targetGroupId, tabIds: ids });
    } catch (e) {
      console.warn('[PicPuck] absorb tabs into PicPuck workspace group failed', e);
    }
  }
}

/**
 * `tabGroups.query({ windowId })` 在部分时序下会瞬时返回 []。
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
 * 合并「窗口内全部分组」与「本窗口蓝色分组」去重 id。标题未写回时组可能仅表现为 blue，全窗口 query 偶发漏列。
 * @param {number} windowId
 * @returns {Promise<chrome.tabGroups.TabGroup[]>}
 */
async function collectTabGroupDescriptorsForWindow(windowId) {
  const { groups: fromWindow } = await queryTabGroupsForWindowRobust(windowId);
  const mergedWindow = await mergeTabGroupsInWindowWithTabsEnumerate(windowId, fromWindow);
  /** @type {Map<number, chrome.tabGroups.TabGroup>} */
  const byId = new Map(mergedWindow.map((g) => [g.id, g]));
  try {
    const blue = await chrome.tabGroups.query({ windowId, color: 'blue' });
    for (const g of blue) {
      if (g.windowId === windowId && !byId.has(g.id)) byId.set(g.id, g);
    }
  } catch {
    /* ignore */
  }
  return [...byId.values()];
}

/**
 * 新窗口或刚并入组后，`tabGroups.query` 可能仍短暂为空；仅 `await Promise.resolve()` 让出微任务后重扫，禁止 setTimeout。
 * @param {number} windowId
 * @param {number} maxAttempts
 * @returns {Promise<number | null>}
 */
async function resolvePicpuckGroupIdInWindowWithYieldRetries(windowId, maxAttempts) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const gid = await resolvePicpuckGroupIdInWindow(windowId);
    if (gid != null) {
      return gid;
    }
    if (attempt + 1 < maxAttempts) {
      await Promise.resolve();
      await Promise.resolve();
    }
  }
  return null;
}

/**
 * 扫描窗口内 PicPuck 分组 ID：**先按组标题**（含旧标题 PicPuck）在 Chrome 里找，得到 id；无标题命中再回退 session（新建组标题尚未写回的瞬间）。
 * @param {number} windowId
 * @returns {Promise<number | null>} 合并后应使用的 groupId；无则 null
 */
async function resolvePicpuckGroupIdInWindow(windowId) {
  const rawGroups = await collectTabGroupDescriptorsForWindow(windowId);
  let groups = await filterQueryGroupsStillInWindow(windowId, rawGroups);
  const map = await loadGroupMap();
  const sessionGid = map[String(windowId)];

  const byTitle = groups.filter((g) => workspaceGroupTitleMatches(g));
  if (byTitle.length > 0) {
    const canonical = await mergePicpuckTabGroupsInWindow(windowId, byTitle);
    // session 曾指向「刚创建、尚无标题」的另一组时，只按标题会漏合并
    if (sessionGid != null && sessionGid !== canonical && (await tabGroupEntityBelongsToWindow(windowId, sessionGid))) {
      try {
        const tgx = await chrome.tabGroups.get(sessionGid);
        if (!workspaceGroupTitleMatches(tgx)) {
          await absorbTabGroupsIntoCanonical(windowId, canonical, [sessionGid]);
        }
      } catch {
        /* ignore */
      }
    }
    const extraBlue = groups
      .filter((g) => g.id !== canonical && isUntitledBlueWorkspaceLikelyOurs(g))
      .map((g) => g.id);
    if (extraBlue.length > 0) {
      await absorbTabGroupsIntoCanonical(windowId, canonical, extraBlue);
    }
    return canonical;
  }

  const picpuck = groups.filter((g) => isPicpuckWorkspaceGroupCandidate(g, sessionGid));
  if (picpuck.length === 0) {
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
  console.info('[PicPuck SW] tabGroup 原子序列开始', { tabId, windowId });
  await pruneStaleGroupMappings();
  let gid = await getOrSyncPicpuckGroupId(windowId);
  if (gid != null) {
    try {
      await chrome.tabs.group({ groupId: gid, tabIds: [tabId] });
      console.info('[PicPuck SW] tab 已并入已有 PicPuck 组', { tabId, windowId, groupId: gid });
      return;
    } catch (e) {
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
          return;
        }
      }
    }
  } catch {
    /* ignore */
  }

  gid = await resolvePicpuckGroupIdInWindowWithYieldRetries(windowId, 4);
  if (gid != null) {
    const mapYield = await loadGroupMap();
    mapYield[String(windowId)] = gid;
    await saveGroupMap(mapYield);
    try {
      await chrome.tabs.group({ groupId: gid, tabIds: [tabId] });
      return;
    } catch (e) {
      console.warn('[PicPuck] tabs.group after yield-retry resolve failed', e);
    }
  }

  /** 最后一道：微任务后 Chrome 仍可能未把新组暴露给 `tabGroups.query`，再短延迟重扫，避免同窗叠两个「PicPuck Agent 专用」。 */
  for (let waitAttempt = 0; waitAttempt < 6; waitAttempt++) {
    if (waitAttempt > 0) {
      await new Promise((r) => setTimeout(r, 40));
    }
    gid = await resolvePicpuckGroupIdInWindow(windowId);
    if (gid == null) continue;
    const mapWait = await loadGroupMap();
    mapWait[String(windowId)] = gid;
    await saveGroupMap(mapWait);
    try {
      await chrome.tabs.group({ groupId: gid, tabIds: [tabId] });
      return;
    } catch (e) {
      console.warn('[PicPuck] tabs.group after timed resolve retry failed', e);
    }
  }

  const snap = await collectTabGroupDescriptorsForWindow(windowId);
  const snapF = await filterQueryGroupsStillInWindow(windowId, snap);
  if (snapF.length === 0) {
    console.info('[PicPuck SW] tabGroup 本窗尚无存活组 → 首张工作 Tab 首次 createProperties（正常，非叠组）', {
      tabId,
      windowId,
    });
  } else {
    console.warn('[PicPuck SW] tabGroup 本窗已有组却未 resolve → 将再 create（异常，可能叠组）', {
      tabId,
      windowId,
      groups: snapF.map((g) => ({ id: g.id, title: g.title, color: g.color })),
    });
  }
  const newGid = await chrome.tabs.group({ createProperties: { windowId }, tabIds: [tabId] });
  const mapNew = await loadGroupMap();
  mapNew[String(windowId)] = newGid;
  await saveGroupMap(mapNew);
  try {
    await chrome.tabGroups.update(newGid, { title: PICPUCK_AGENT_WORKSPACE_GROUP_TITLE, color: 'blue' });
  } catch (e) {
    console.warn('[PicPuck SW] tabGroups.update new workspace group failed', e);
  }
  console.info('[PicPuck SW] tabGroup 已 createProperties', { tabId, windowId, newGroupId: newGid });
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
  console.info('[PicPuck SW] ensureTabInPicpuckWorkspaceGroup', { tabId, windowId: wid });

  const run = () => runPicpuckWorkspaceGroupEnsureAtomicSequence(tabId, wid);

  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    try {
      await navigator.locks.request(picpuckWorkspaceTabGroupLockName(wid), { mode: 'exclusive' }, run);
      return;
    } catch (e) {
      console.warn('[PicPuck SW] navigator.locks.request tab group 回退 Promise 链', e);
    }
  }

  const prev = winGroupChain.get(wid) ?? Promise.resolve();
  const next = prev.then(run);
  winGroupChain.set(
    wid,
    next.catch((e) => {
      console.warn('[PicPuck SW] ensureTabInPicpuckWorkspaceGroup 链上异常', e);
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
