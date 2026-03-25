/**
 * PicPuck 工作区标签页分组：蓝色「PicPuck」组、仅复用组内 Tab（设计 docs/implements/picpuck-workspace-tab-group）。
 * 用户自行打开、未在本组内的同域 Tab（含裸开 Gemini）不作为候选；扩展须新建并入组。
 */
const STORAGE_KEY = 'picpuckWorkspaceGroupByWindow';

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

async function doEnsureTabInGroup(tabId, windowId) {
  let gid = await getValidatedGroupIdForWindow(windowId);
  if (gid != null) {
    try {
      await chrome.tabs.group({ groupId: gid, tabIds: [tabId] });
      return;
    } catch (e) {
      console.warn('[PicPuck] tabs.group into PicPuck group failed', e);
    }
  }
  const newGid = await chrome.tabs.group({ createProperties: { windowId }, tabIds: [tabId] });
  await chrome.tabGroups.update(newGid, { title: 'PicPuck', color: 'blue' });
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
  const map = await loadGroupMap();
  const out = [];
  for (const tab of tabsSorted) {
    if (await matchesPicpuckWorkspaceGroupTab(tab, map)) {
      out.push(tab);
    }
  }
  return out.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
}
