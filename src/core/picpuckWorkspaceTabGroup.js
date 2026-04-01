/**
 * PicPuck 工作区标签页分组：名称「PicPuck Agent 专用」、蓝色。
 * `ensureTabInPicpuckWorkspaceGroup`：session 有 gid 则并入；否则 `tabGroups.query({ windowId })` 找标题匹配；再无则 `createProperties` 新建并写 session。
 */
/** @readonly */
export const PICPUCK_AGENT_WORKSPACE_GROUP_TITLE = 'PicPuck Agent 专用';

const LEGACY_WORKSPACE_GROUP_TITLE = 'PicPuck';
const STORAGE_KEY = 'picpuckWorkspaceGroupByWindow';

/** @type {Map<number, Promise<void>>} */
const winGroupChain = new Map();

async function windowStillOpen(windowId) {
  try {
    await chrome.windows.get(windowId);
    return true;
  } catch {
    return false;
  }
}

function workspaceGroupTitleMatches(g) {
  const t = String(g.title || '').trim();
  return t === PICPUCK_AGENT_WORKSPACE_GROUP_TITLE || t === LEGACY_WORKSPACE_GROUP_TITLE;
}

async function loadGroupMap() {
  const raw = await chrome.storage.session.get(STORAGE_KEY);
  return raw[STORAGE_KEY] && typeof raw[STORAGE_KEY] === 'object' ? { ...raw[STORAGE_KEY] } : {};
}

async function saveGroupMap(map) {
  await chrome.storage.session.set({ [STORAGE_KEY]: map });
}

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
    if (!(await windowStillOpen(wid))) {
      delete next[wStr];
      changed = true;
      continue;
    }
    try {
      const tg = await chrome.tabGroups.get(gid);
      if (tg.windowId !== wid) {
        delete next[wStr];
        changed = true;
      }
    } catch {
      delete next[wStr];
      changed = true;
    }
  }
  if (changed) await saveGroupMap(next);
}

/**
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
 * @param {number} windowId
 * @returns {Promise<chrome.tabGroups.TabGroup[]>}
 */
async function queryGroupsInWindow(windowId) {
  let primary = [];
  try {
    primary = await chrome.tabGroups.query({ windowId });
  } catch {
    primary = [];
  }
  if (primary.length > 0) return primary;
  try {
    const all = await chrome.tabGroups.query({});
    return all.filter((g) => g.windowId === windowId);
  } catch {
    return [];
  }
}

/**
 * @param {number} tabId
 * @param {number} windowId
 */
async function runPicpuckWorkspaceGroupEnsureAtomicSequence(tabId, windowId) {
  await pruneStaleGroupMappings();
  const map = await loadGroupMap();
  const k = String(windowId);
  let gid = map[k];

  if (gid != null) {
    try {
      const tg = await chrome.tabGroups.get(gid);
      if (tg.windowId === windowId) {
        await chrome.tabs.group({ groupId: gid, tabIds: [tabId] });
        return;
      }
    } catch {
      /* session 指向已失效组 */
    }
  }

  const groups = await queryGroupsInWindow(windowId);
  const hit = groups.find((g) => workspaceGroupTitleMatches(g));
  if (hit != null) {
    map[k] = hit.id;
    await saveGroupMap(map);
    try {
      await chrome.tabs.group({ groupId: hit.id, tabIds: [tabId] });
      return;
    } catch {
      /* 继续新建 */
    }
  }

  const newGid = await chrome.tabs.group({ createProperties: { windowId }, tabIds: [tabId] });
  map[k] = newGid;
  await saveGroupMap(map);
  try {
    await chrome.tabGroups.update(newGid, { title: PICPUCK_AGENT_WORKSPACE_GROUP_TITLE, color: 'blue' });
  } catch {
    /* ignore */
  }
}

function picpuckWorkspaceTabGroupLockName(windowId) {
  return `picpuck-workspace-tabgroup-w${windowId}`;
}

/**
 * @param {number} tabId
 */
export async function ensureTabInPicpuckWorkspaceGroup(tabId) {
  const tab = await chrome.tabs.get(tabId);
  const wid = tab.windowId;
  if (wid == null) return;

  const run = () => runPicpuckWorkspaceGroupEnsureAtomicSequence(tabId, wid);

  if (typeof navigator !== 'undefined' && navigator.locks && typeof navigator.locks.request === 'function') {
    try {
      await navigator.locks.request(picpuckWorkspaceTabGroupLockName(wid), { mode: 'exclusive' }, run);
      return;
    } catch (e) {
      console.warn('[PicPuck] navigator.locks.request tab group, fallback chain', e);
    }
  }

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
  try {
    const tg = await chrome.tabGroups.get(expected);
    return tg.windowId === tab.windowId;
  } catch {
    return false;
  }
}

/**
 * @param {chrome.tabs.Tab | undefined} tab
 * @returns {Promise<boolean>}
 */
export async function isTabInPicpuckWorkspaceGroup(tab) {
  await pruneStaleGroupMappings();
  const map = await loadGroupMap();
  return matchesPicpuckWorkspaceGroupTab(tab, map);
}

/**
 * @param {chrome.tabs.Tab[]} tabsSorted
 * @returns {Promise<chrome.tabs.Tab[]>}
 */
export async function filterPicpuckWorkspaceCandidates(tabsSorted) {
  await pruneStaleGroupMappings();
  const uniqueWindowIds = [
    ...new Set(tabsSorted.map((t) => t.windowId).filter((w) => typeof w === 'number')),
  ];
  const map = await loadGroupMap();
  for (const wid of uniqueWindowIds) {
    const groups = await queryGroupsInWindow(wid);
    const hit = groups.find((g) => workspaceGroupTitleMatches(g));
    if (hit != null) {
      map[String(wid)] = hit.id;
    }
  }
  await saveGroupMap(map);
  const fresh = await loadGroupMap();
  const inGroup = [];
  const orphan = [];
  for (const tab of tabsSorted) {
    if (await matchesPicpuckWorkspaceGroupTab(tab, fresh)) {
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
