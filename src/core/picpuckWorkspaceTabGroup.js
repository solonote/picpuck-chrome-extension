/**
 * PicPuck 工作区标签页分组：展示名为「PicPuck Agent 专用」、蓝色；**识别组以标题（及 session 登记的 groupId）为准**，不能依赖新建瞬间的 color===blue。
 * 用户自行打开、未在本组内的同域 Tab（含裸开 Gemini）不作为候选；扩展须新建并入组。
 */
/** @readonly 与 UI 展示一致；旧版标题「PicPuck」仍识别并迁移为本标题。 */
export const PICPUCK_AGENT_WORKSPACE_GROUP_TITLE = 'PicPuck Agent 专用';

const LEGACY_WORKSPACE_GROUP_TITLE = 'PicPuck';

const STORAGE_KEY = 'picpuckWorkspaceGroupByWindow';

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
 * 移除已失效的 groupId 映射（用户删组、合并窗口等）。
 */
async function pruneStaleGroupMappings() {
  const map = await loadGroupMap();
  let changed = false;
  const next = { ...map };
  for (const [wStr, gid] of Object.entries(map)) {
    try {
      await chrome.tabGroups.get(gid);
    } catch {
      delete next[wStr];
      changed = true;
    }
  }
  if (changed) {
    await saveGroupMap(next);
  }
}

async function getValidatedGroupIdForWindow(windowId) {
  const map = await loadGroupMap();
  const gid = map[String(windowId)];
  if (gid == null) return null;
  try {
    await chrome.tabGroups.get(gid);
    return gid;
  } catch {
    const next = { ...map };
    delete next[String(windowId)];
    await saveGroupMap(next);
    return null;
  }
}

/**
 * 扫描窗口内 PicPuck Agent 专用（或旧标题 PicPuck）、蓝色组；若存在多个则合并为一个。
 * @param {number} windowId
 * @returns {Promise<number | null>} 合并后应使用的 groupId；无则 null
 */
async function resolvePicpuckGroupIdInWindow(windowId) {
  let groups;
  try {
    groups = await chrome.tabGroups.query({ windowId });
  } catch {
    return null;
  }
  const map = await loadGroupMap();
  const sessionGid = map[String(windowId)];
  const picpuck = groups.filter((g) => isPicpuckAgentWorkspaceGroup(g, sessionGid));
  if (picpuck.length === 0) {
    return null;
  }
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
 * session 中的 groupId 与 Chrome 实际分组可能不一致；优先以窗口内真实 PicPuck 组为准并写回 session。
 * @param {number} windowId
 * @returns {Promise<number | null>}
 */
async function getOrSyncPicpuckGroupId(windowId) {
  const fromSession = await getValidatedGroupIdForWindow(windowId);
  const fromChrome = await resolvePicpuckGroupIdInWindow(windowId);
  if (fromChrome != null) {
    if (fromSession == null || fromSession !== fromChrome) {
      const map = await loadGroupMap();
      map[String(windowId)] = fromChrome;
      await saveGroupMap(map);
    }
    return fromChrome;
  }
  return fromSession;
}

async function doEnsureTabInGroup(tabId, windowId) {
  let gid = await getOrSyncPicpuckGroupId(windowId);
  if (gid != null) {
    try {
      await chrome.tabs.group({ groupId: gid, tabIds: [tabId] });
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

  const newGid = await chrome.tabs.group({ createProperties: { windowId }, tabIds: [tabId] });
  await chrome.tabGroups.update(newGid, { title: PICPUCK_AGENT_WORKSPACE_GROUP_TITLE, color: 'blue' });
  const map = await loadGroupMap();
  map[String(windowId)] = newGid;
  await saveGroupMap(map);
}

/**
 * 将工作台 Tab 并入当前窗口的 PicPuck 蓝组（无则创建）。同窗口串行，避免并发双开组。
 * @param {number} tabId
 */
export async function ensureTabInPicpuckWorkspaceGroup(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const wid = tab.windowId;
  if (wid == null) return;
  const prev = winGroupChain.get(wid) ?? Promise.resolve();
  const next = prev.then(() => doEnsureTabInGroup(tabId, wid));
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
  try {
    await chrome.tabGroups.get(expected);
    return true;
  } catch {
    return false;
  }
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
 * 在 `filterAndSortCandidates` 之后调用：只保留**已在 PicPuck 工作区组内**的同域 Tab。
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
  const out = [];
  for (const tab of tabsSorted) {
    if (await matchesPicpuckWorkspaceGroupTab(tab, map)) {
      out.push(tab);
    }
  }
  return out.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}
