/**
 * 异步「检测进度」：
 * 1. LAUNCH 成功：`masterDispatch` 在 round 成功后调用 `registerAsyncRecoverWatchLoop`；或熔炉 `RECOVER` / `WATCH_PROBE` → `onManualProbeRequest`。
 * 2. `chrome.alarms` 触发 → 注入的 `dispatchAsyncGenerationRecover`（payload 存 `chrome.storage.session` 以扛 SW 冷启动）。
 * 3. RECOVER 跑完后若 profile 要求且得到工作 Tab，在工作 Tab 挂页内 watcher；就绪后再 dispatch 一轮 RECOVER 取图。
 * 4. 成功回传 / 失败 / CANCEL → `unregisterWatchLoop`。
 */
import { startRecoverPageWatcherFromLaunch } from './recoverPageWatcherLaunch.js';
import { resolveProfileByCoreEngine } from './asyncEngineProfiles.js';
import { clearAsyncJobWorkTab } from './taskBindings.js';

/**
 * @type {((callerTabId: number, payload: Record<string, unknown>) => Promise<{ ok?: boolean, tabId?: number }>) | null}
 */
let dispatchAsyncGenerationRecoverRef = null;

/**
 * 须在 `installWatchLoopAlarmHandling` 之前由 `swMain` 调用一次。
 * @param {typeof import('./asyncRecoverDispatch.js').dispatchAsyncGenerationRecover} fn
 */
export function setDispatchAsyncGenerationRecoverForWatchLoop(fn) {
  dispatchAsyncGenerationRecoverRef = typeof fn === 'function' ? fn : null;
}

const WATCH_LOOP_ALARM_PREFIX = 'picpuckWL:';
const WATCH_LOOP_SESSION_PREFIX = 'picpuckWLSess:';
const WATCH_PROBE_INTERVAL_MS = 5000;
const WATCH_MANUAL_PROBE_DELAY_MS = 400;

/** @type {Map<string, { recoverPayload: Record<string, unknown>, callerTabId?: number }>} */
const watchLoopPayloads = new Map();

/** @type {Map<string, boolean>} */
const probeRunning = new Map();

/** @type {Map<string, boolean>} */
const manualPending = new Map();

let watchLoopAlarmListenerInstalled = false;

function normalizeId(id) {
  return String(id || '').trim().toLowerCase();
}

function scheduleRecoverPageWatcherAfterProbe(args) {
  const { workTabId, asyncJobId, callerTabId, recoverPayload } = args;
  if (typeof workTabId !== 'number' || workTabId <= 0) return;
  void startRecoverPageWatcherFromLaunch({
    workTabId,
    roundId: '',
    async_job_id: asyncJobId,
    forgeCallerTabId: typeof callerTabId === 'number' && callerTabId > 0 ? callerTabId : 0,
    recoverPayload,
  }).catch((e) => console.warn('[PicPuck] WatchLoop 页内 watcher 启动失败', e));
}

function watchLoopAlarmName(asyncJobId) {
  return WATCH_LOOP_ALARM_PREFIX + normalizeId(asyncJobId);
}

function watchLoopSessionKey(asyncJobId) {
  return WATCH_LOOP_SESSION_PREFIX + normalizeId(asyncJobId);
}

/** @param {string} id */
async function hydrateWatchLoopPayloadFromSession(id) {
  if (watchLoopPayloads.has(id)) return;
  const key = watchLoopSessionKey(id);
  try {
    const r = await chrome.storage.session.get(key);
    const stored = r[key];
    if (stored && stored.recoverPayload && typeof stored.recoverPayload === 'object') {
      watchLoopPayloads.set(id, {
        recoverPayload: { ...stored.recoverPayload },
        callerTabId: stored.callerTabId,
      });
    }
  } catch (e) {
    console.warn('[PicPuck] watchLoop session 读取失败', id, e);
  }
}

/**
 * 注册 `alarms.onAlarm`（幂等）。须在 SW 启动时调用一次。
 */
export function installWatchLoopAlarmHandling() {
  if (watchLoopAlarmListenerInstalled) return;
  watchLoopAlarmListenerInstalled = true;
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm.name.startsWith(WATCH_LOOP_ALARM_PREFIX)) return;
    const raw = alarm.name.slice(WATCH_LOOP_ALARM_PREFIX.length);
    const id = normalizeId(raw);
    void runProbeLoopEntry(id).catch((e) => {
      console.error('[PicPuck] runProbeLoopEntry', e);
    });
  });
}

function cancelScheduledProbe(asyncJobId) {
  const id = normalizeId(asyncJobId);
  void chrome.alarms.clear(watchLoopAlarmName(id));
}

/**
 * @param {number} delayMs
 */
export function scheduleNextProbe(asyncJobId, delayMs) {
  const id = normalizeId(asyncJobId);
  const name = watchLoopAlarmName(id);
  const ms = Math.max(100, Number(delayMs));
  const when = Date.now() + ms;
  void chrome.alarms
    .clear(name)
    .then(() => chrome.alarms.create(name, { when }))
    .catch((e) => {
      console.error('[PicPuck] watchLoop alarm 设置失败', { async_job_id: id, e });
    });
}

/**
 * 异步 LAUNCH 成功后由 `dispatchRound` 经 `masterDispatch` 注册。
 * @param {{ async_job_id: string, recoverPayload: Record<string, unknown>, callerTabId?: number }} args
 */
export function registerAsyncRecoverWatchLoop({ async_job_id, recoverPayload, callerTabId }) {
  const id = normalizeId(async_job_id);
  const entry = {
    recoverPayload: { ...recoverPayload, async_job_id: id },
    callerTabId,
  };
  watchLoopPayloads.set(id, entry);
  const key = watchLoopSessionKey(id);
  const arm = () => scheduleNextProbe(id, WATCH_PROBE_INTERVAL_MS);
  void chrome.storage.session
    .set({ [key]: entry })
    .then(arm)
    .catch((e) => {
      console.warn('[PicPuck] watchLoop session 写入失败', id, e);
      arm();
    });
}

/**
 * 终态、成功回传、或 recover 失败时清理。
 * @param {string} async_job_id
 */
export function unregisterWatchLoop(async_job_id) {
  const id = normalizeId(async_job_id);
  cancelScheduledProbe(id);
  watchLoopPayloads.delete(id);
  manualPending.delete(id);
  void chrome.storage.session.remove(watchLoopSessionKey(id)).catch(() => {});
  void clearAsyncJobWorkTab(id);
}

/**
 * RELAY 成功回传后由编排约定点调用（设计 **11** §E、**README** R3）；默认等同 `unregisterWatchLoop`。
 * @param {string} async_job_id
 */
export function notifyAsyncJobRecoverFinished(async_job_id) {
  unregisterWatchLoop(async_job_id);
}

/**
 * 熔炉 `WATCH_PROBE` / `RECOVER`：合并 payload 并延迟触发 probe。
 * @param {{ async_job_id: string, recoverPayload: Record<string, unknown>, callerTabId?: number }} args
 */
export function onManualProbeRequest({ async_job_id, recoverPayload, callerTabId }) {
  const id = normalizeId(async_job_id);
  const merged = { ...recoverPayload, async_job_id: id };
  const prev = watchLoopPayloads.get(id);
  const entry = {
    recoverPayload: merged,
    callerTabId: callerTabId ?? prev?.callerTabId,
  };
  watchLoopPayloads.set(id, entry);
  if (probeRunning.get(id)) {
    manualPending.set(id, true);
    void chrome.storage.session.set({ [watchLoopSessionKey(id)]: entry }).catch(() => {});
    return;
  }
  cancelScheduledProbe(id);
  const key = watchLoopSessionKey(id);
  const arm = () => scheduleNextProbe(id, WATCH_MANUAL_PROBE_DELAY_MS);
  void chrome.storage.session
    .set({ [key]: entry })
    .then(arm)
    .catch((e) => {
      console.warn('[PicPuck] watchLoop session 写入失败', id, e);
      arm();
    });
}

async function runProbeLoopEntry(asyncJobId) {
  const id = normalizeId(asyncJobId);
  await hydrateWatchLoopPayloadFromSession(id);
  if (!watchLoopPayloads.has(id)) {
    console.warn('[PicPuck] watchLoop alarm 触发但无条目 async_job_id=%s', id);
    return;
  }
  if (probeRunning.get(id)) {
    manualPending.set(id, true);
    return;
  }
  probeRunning.set(id, true);
  try {
    while (true) {
      await runProbeInner(id);
      if (manualPending.get(id)) {
        manualPending.set(id, false);
        continue;
      }
      break;
    }
  } finally {
    probeRunning.set(id, false);
    if (watchLoopPayloads.has(id)) {
      const snap = watchLoopPayloads.get(id);
      if (snap) {
        void chrome.storage.session.set({ [watchLoopSessionKey(id)]: snap }).catch(() => {});
      }
      scheduleNextProbe(id, WATCH_PROBE_INTERVAL_MS);
    }
  }
}

async function resolveCallerTabIdForRelay(callerTabId) {
  if (callerTabId != null && callerTabId > 0) {
    try {
      await chrome.tabs.get(callerTabId);
      return callerTabId;
    } catch {
      /* ignore */
    }
  }
  const all = await chrome.tabs.query({});
  const forge = all.find((t) => {
    const u = t.url || '';
    return (u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1')) && t.id != null;
  });
  return forge && typeof forge.id === 'number' ? forge.id : undefined;
}

async function runProbeInner(asyncJobId) {
  const id = normalizeId(asyncJobId);
  await hydrateWatchLoopPayloadFromSession(id);
  const entry = watchLoopPayloads.get(id);
  if (!entry) {
    console.warn('[PicPuck] watchLoop runProbeInner 无 entry async_job_id=%s', id);
    return;
  }
  let callerTabId = entry.callerTabId;
  callerTabId = await resolveCallerTabIdForRelay(callerTabId);
  if (callerTabId == null || callerTabId <= 0) {
    console.warn('[PicPuck] watchLoop: no callerTabId for %s', id);
    unregisterWatchLoop(id);
    return;
  }
  entry.callerTabId = callerTabId;
  void chrome.storage.session.set({ [watchLoopSessionKey(id)]: entry }).catch(() => {});

  const payload = { ...entry.recoverPayload };
  const coreEng = String(payload.core_engine || '').trim();
  let injectWatcher = false;
  try {
    injectWatcher = resolveProfileByCoreEngine(coreEng).injectRecoverPageWatcherAfterProbe === true;
  } catch {
    injectWatcher = false;
  }

  const runRecover = dispatchAsyncGenerationRecoverRef;
  if (!runRecover) {
    console.warn('[PicPuck] watchLoop: dispatchAsyncGenerationRecover 未注入，跳过本轮');
    return;
  }
  try {
    const result = await runRecover(callerTabId, payload);
    /** 成功回收后 `notifyAsyncJobRecoverFinished` 会删条目；切勿在条目已删后再挂页内 watcher */
    if (
      injectWatcher &&
      typeof result.tabId === 'number' &&
      result.tabId > 0 &&
      watchLoopPayloads.has(id)
    ) {
      scheduleRecoverPageWatcherAfterProbe({
        workTabId: result.tabId,
        asyncJobId: id,
        callerTabId: typeof callerTabId === 'number' ? callerTabId : 0,
        recoverPayload: payload,
      });
    }
    if (!result.ok) {
      unregisterWatchLoop(id);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[PicPuck] WatchLoop PROBE/RELAY 异常', { async_job_id: id, error: msg });
    unregisterWatchLoop(id);
  }
}
