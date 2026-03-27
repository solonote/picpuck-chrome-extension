/**
 * =============================================================================
 * Core 调度底座（Service Worker）：任务 ↔ 工作台 Tab 的**唯一权威登记处**
 * =============================================================================
 *
 * **设计边界**（与页内 DOM、其它模块分工）
 *
 * 1. **round 维度（`roundBinding` / `inFlightByTabId`）**
 *    - 一次 `masterDispatch` = 一个 `roundId`，生命周期：allocate 成功 → `dispatchRound` 结束（finally）或异常收尾。
 *    - 回答：「这一轮任务绑在哪张工作台 Tab？」「这张 Tab 上现在跑的是哪个 round？」
 *    - PicPuck 响应、日志、relay 分片等多用 `roundId` 查 `getWorkTabIdByRoundId`。
 *
 * 2. **async_job 维度（`asyncJobWorkTab*`）**
 *    - 业务侧 `async_job_id`（12 位）可跨**多轮** `masterDispatch`（如 LAUNCH → 多次 PROBE → RELAY）。
 *    - 回答：「这个异步作业**应固定使用**哪张工作台 Tab？」避免仅靠扫 Tab 池 + 页内 idle 误建新页。
 *    - 落盘 `chrome.storage.session`，SW 冷启仍可恢复绑定；终态由 `unregisterWatchLoop` / `clearAsyncJobWorkTab` 清理。
 *
 * 3. **页内执行槽（`#picpuck-agent-topbar` / `data-picpuck-exec-state`）**
 *    - **不在此文件持久化**；由 `allocateTab` 经 `scripting.executeScript` 读写，表示「该文档是否允许再开一轮步骤」。
 *    - allocate 顺序：**先**按 2 取登记 Tab 并 `releaseExecSlot` + `tryAcquire`，**再**必要时扫候选池；槽位是**现场闸**，不是作业指派源。
 *
 * 4. **其它**
 *    - 取消/活跃作业标志：`asyncGenerationState.js`（`activeAsyncJobs`）。
 *    - 熔炉 caller Tab TTL：`relayCallerTabTTL.js`。
 *
 * 调用约定：新增「某任务用哪张 Tab」时**必须**在本文件增登记 API，禁止在 allocate 外再散写 Map/session。
 */

/** @typedef {{ roundId: string, tabId: number, clientRequestId: string, command: string, createdAt: number }} TaskTicket */

/** @type {Map<string, TaskTicket>} */
export const roundBinding = new Map();

/** @type {Map<number, string>} tabId -> roundId */
export const inFlightByTabId = new Map();

// --- async_job_id → 工作台 Tab（跨多轮 masterDispatch）---------------------------------

const ASYNC_JOB_WORK_TAB_STORAGE_PREFIX = 'picpuckAsyncJobWorkTab:';

/** @type {Map<string, number>} normalized job id → work tab id */
const asyncJobWorkTabMem = new Map();

/**
 * @param {unknown} raw
 * @returns {string} 合法 12 位 id 或 ''
 */
export function normalizeAsyncJobId(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return /^[a-z0-9]{12}$/.test(s) ? s : '';
}

function asyncJobWorkTabStorageKey(jobIdNorm) {
  return ASYNC_JOB_WORK_TAB_STORAGE_PREFIX + jobIdNorm;
}

/**
 * LAUNCH / PROBE / RELAY 等成功 allocate 后由 `masterDispatch` 写入。
 * @param {string} asyncJobId
 * @param {number} tabId
 */
export async function registerAsyncJobWorkTab(asyncJobId, tabId) {
  const id = normalizeAsyncJobId(asyncJobId);
  if (!id || typeof tabId !== 'number' || tabId <= 0) return;
  asyncJobWorkTabMem.set(id, tabId);
  try {
    await chrome.storage.session.set({ [asyncJobWorkTabStorageKey(id)]: tabId });
  } catch (e) {
    console.warn('[PicPuck] registerAsyncJobWorkTab session failed', id, e);
  }
}

/**
 * @param {string} asyncJobId
 * @returns {Promise<number | undefined>}
 */
export async function getAsyncJobWorkTab(asyncJobId) {
  const id = normalizeAsyncJobId(asyncJobId);
  if (!id) return undefined;
  if (asyncJobWorkTabMem.has(id)) return asyncJobWorkTabMem.get(id);
  try {
    const r = await chrome.storage.session.get(asyncJobWorkTabStorageKey(id));
    const tid = r[asyncJobWorkTabStorageKey(id)];
    if (typeof tid === 'number' && tid > 0) {
      asyncJobWorkTabMem.set(id, tid);
      return tid;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

/**
 * @param {string} asyncJobId
 */
export async function clearAsyncJobWorkTab(asyncJobId) {
  const id = normalizeAsyncJobId(asyncJobId);
  if (!id) return;
  asyncJobWorkTabMem.delete(id);
  try {
    await chrome.storage.session.remove(asyncJobWorkTabStorageKey(id));
  } catch {
    /* ignore */
  }
}

/**
 * 工作台 Tab 被关闭时：去掉所有指向该 Tab 的 async_job 绑定（内存 + session，避免 SW 冷启仅 session 有残留时挂死 id）。
 * @param {number} tabId
 */
export async function clearAsyncJobWorkTabsForClosedTab(tabId) {
  if (typeof tabId !== 'number' || tabId <= 0) return;
  const toClear = new Set();
  for (const [jobId, tid] of asyncJobWorkTabMem.entries()) {
    if (tid === tabId) toClear.add(jobId);
  }
  try {
    const all = await chrome.storage.session.get(null);
    for (const [k, v] of Object.entries(all || {})) {
      if (!k.startsWith(ASYNC_JOB_WORK_TAB_STORAGE_PREFIX)) continue;
      if (v === tabId) {
        toClear.add(k.slice(ASYNC_JOB_WORK_TAB_STORAGE_PREFIX.length));
      }
    }
  } catch {
    /* ignore */
  }
  for (const jobId of toClear) {
    await clearAsyncJobWorkTab(jobId);
  }
}

// --- round 查询 -------------------------------------------------------------------

/**
 * 根据本轮任务 ID（roundId）解析**当前**工作台标签页 id；无进行中任务时返回 `undefined`。
 * @param {string} roundId
 * @returns {number|undefined}
 */
export function getWorkTabIdByRoundId(roundId) {
  if (!roundId || typeof roundId !== 'string') return undefined;
  const t = roundBinding.get(roundId);
  return t && typeof t.tabId === 'number' && t.tabId > 0 ? t.tabId : undefined;
}

/**
 * @param {string} roundId
 * @returns {TaskTicket|undefined}
 */
export function getInFlightTaskTicketByRoundId(roundId) {
  if (!roundId || typeof roundId !== 'string') return undefined;
  return roundBinding.get(roundId);
}

/**
 * 根据工作台 tabId 反查进行中任务的 roundId。
 * @param {number} tabId
 * @returns {string|undefined}
 */
export function getRoundIdByWorkTabId(tabId) {
  if (typeof tabId !== 'number' || tabId <= 0) return undefined;
  return inFlightByTabId.get(tabId);
}

/**
 * 熔炉 callerTabId 与 roundId 的 TTL 登记见 `relayCallerTabTTL.js`（register/get/touch/clear）。
 */
