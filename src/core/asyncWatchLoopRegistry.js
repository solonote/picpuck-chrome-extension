/**
 * WatchLoop：设计 **10**；即梦 `JIMENG_ASYNC_RECOVER` 经 `dispatchAsyncGenerationRecover`；禁止 `setInterval`。
 * 调度用 `chrome.alarms` 的 **`when` 绝对时间**（毫秒）；`delayInMinutes` 过小在部分 Chromium 上不可靠，表现为 alarm 从不触发。
 * **条目须写入 `chrome.storage.session`**：闹钟触发时 SW 常冷启动，内存 Map 为空，否则 `runProbeInner` 无 entry 直接返回且无任何日志。
 * 页内 JimengRecoverWatch 由 `jimengRecoverPageWatcherLaunch.js` 静态导入（SW 禁止动态 `import()`）。
 */
import { dispatchAsyncGenerationRecover } from './asyncRecoverDispatch.js';
import { getContext } from './roundContext.js';
import { getCommandRecord } from './registry.js';
import { startJimengRecoverPageWatcherFromLaunch } from './jimengRecoverPageWatcherLaunch.js';
import { filterAndSortCandidates } from './tabCandidates.js';
import { filterPicpuckWorkspaceCandidates } from './picpuckWorkspaceTabGroup.js';

const WATCH_LOOP_ALARM_PREFIX = 'picpuckWL:';
/** session 键前缀，与 alarm name 分离 */
const WATCH_LOOP_SESSION_PREFIX = 'picpuckWLSess:';
/** LAUNCH 后首次与 not_ready 后再次检查的间隔 */
const WATCH_PROBE_INTERVAL_MS = 5000;
/** 熔炉「检查进度」防抖：略大于单次 session 写入 + 组/Tab 落稳，避免 alarm 与 UI 竞态 */
const WATCH_MANUAL_PROBE_DELAY_MS = 1000;
/** 探测前解析组内即梦 Tab：alarm 与冷启动同时到达时可能尚未出现在 tabs.query，短轮询等待 */
const PROBE_JIMENG_TAB_RESOLVE_ATTEMPTS = 10;
const PROBE_JIMENG_TAB_RESOLVE_GAP_MS = 400;

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

/**
 * 不抢占 exec slot：仅解析 PicPuck 组内即梦 Tab，供 WatchLoop「检查进度」路径注入页内观测（无 LAUNCH 时原先不会挂 watcher）。
 * @returns {Promise<number>}
 */
async function tryResolveJimengWorkTabIdForProbeWatch() {
  const rec = getCommandRecord('JIMENG_ASYNC_RECOVER');
  if (!rec || typeof rec.homeUrl !== 'string') return 0;
  let all = [];
  try {
    all = await chrome.tabs.query({});
  } catch {
    return 0;
  }
  const urlSorted = filterAndSortCandidates(all, rec.homeUrl);
  const candidates = await filterPicpuckWorkspaceCandidates(urlSorted);
  if (!candidates.length) return 0;
  const sorted = [...candidates].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const tid = sorted[0].id;
  return typeof tid === 'number' && tid > 0 ? tid : 0;
}

function delayWatchLoopMs(ms) {
  return new Promise((r) => {
    setTimeout(r, Math.max(0, Number(ms) || 0));
  });
}

/**
 * @returns {Promise<number>}
 */
async function tryResolveJimengWorkTabIdForProbeWatchWithRetries() {
  for (let attempt = 1; attempt <= PROBE_JIMENG_TAB_RESOLVE_ATTEMPTS; attempt += 1) {
    const tabId = await tryResolveJimengWorkTabIdForProbeWatch();
    if (tabId > 0) {
      if (attempt > 1) {
        console.info('[PicPuck] WatchLoop 探测前第 ' + attempt + ' 次解析到组内即梦 Tab', { workTabId: tabId });
      }
      return tabId;
    }
    if (attempt < PROBE_JIMENG_TAB_RESOLVE_ATTEMPTS) {
      await delayWatchLoopMs(PROBE_JIMENG_TAB_RESOLVE_GAP_MS);
    }
  }
  return 0;
}

/**
 * @param {{ workTabId: number, asyncJobId: string, callerTabId: number, recoverPayload: Record<string, unknown>, timing: string }} args
 */
function scheduleJimengProbePageWatcher(args) {
  const { workTabId, asyncJobId, callerTabId, recoverPayload, timing } = args;
  if (typeof workTabId !== 'number' || workTabId <= 0) return;
  console.info('[PicPuck] WatchLoop 启动页内 JimengRecoverWatch', {
    async_job_id: asyncJobId,
    workTabId,
    timing,
  });
  void startJimengRecoverPageWatcherFromLaunch({
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
    console.info('[PicPuck] watchLoop onAlarm', {
      name: alarm.name,
      scheduledTime: alarm.scheduledTime,
    });
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
    .then(() => {
      console.info('[PicPuck] watchLoop alarm 已设置', {
        async_job_id: id,
        delayMs: ms,
        fireAtEpochMs: when,
      });
    })
    .catch((e) => {
      console.error('[PicPuck] watchLoop alarm 设置失败', { async_job_id: id, e });
    });
}

/**
 * 即梦异步 LAUNCH 成功后由 `dispatchRound` 调用。
 * @param {{ async_job_id: string, recoverPayload: Record<string, unknown>, callerTabId?: number }} args
 */
export function registerWatchLoopAfterJimengLaunch({ async_job_id, recoverPayload, callerTabId }) {
  const id = normalizeId(async_job_id);
  const entry = {
    recoverPayload: { ...recoverPayload, async_job_id: id },
    callerTabId,
  };
  watchLoopPayloads.set(id, entry);
  const key = watchLoopSessionKey(id);
  void chrome.storage.session
    .set({ [key]: entry })
    .then(() => {
      scheduleNextProbe(id, WATCH_PROBE_INTERVAL_MS);
      console.info('[PicPuck] WatchLoop 已开启', { async_job_id: id, firstProbeDelayMs: WATCH_PROBE_INTERVAL_MS });
    })
    .catch((e) => {
      console.warn('[PicPuck] watchLoop session 写入失败', id, e);
      scheduleNextProbe(id, WATCH_PROBE_INTERVAL_MS);
      console.info('[PicPuck] WatchLoop 已开启', { async_job_id: id, firstProbeDelayMs: WATCH_PROBE_INTERVAL_MS });
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
}

/**
 * 熔炉 `WATCH_PROBE` / 历史 `RECOVER`：合并 payload 并延迟触发 probe。
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
    console.info('[PicPuck] 检查进度 已排队', {
      async_job_id: id,
      detail: '当前仍有一次 RECOVER probe 在执行，本轮结束后补跑',
    });
    return;
  }
  cancelScheduledProbe(id);
  const key = watchLoopSessionKey(id);
  void chrome.storage.session
    .set({ [key]: entry })
    .then(() => {
      scheduleNextProbe(id, WATCH_MANUAL_PROBE_DELAY_MS);
      console.info('[PicPuck] 检查进度 已排程', {
        async_job_id: id,
        delayMs: WATCH_MANUAL_PROBE_DELAY_MS,
        detail: 'alarm 触发后跑 RECOVER；冷启动从 session 恢复 payload',
      });
    })
    .catch((e) => {
      console.warn('[PicPuck] watchLoop session 写入失败', id, e);
      scheduleNextProbe(id, WATCH_MANUAL_PROBE_DELAY_MS);
      console.info('[PicPuck] 检查进度 已排程', { async_job_id: id, delayMs: WATCH_MANUAL_PROBE_DELAY_MS });
    });
}

async function runProbeLoopEntry(asyncJobId) {
  const id = normalizeId(asyncJobId);
  await hydrateWatchLoopPayloadFromSession(id);
  if (!watchLoopPayloads.has(id)) {
    console.warn('[PicPuck] watchLoop alarm 触发但无内存且无 session 条目 async_job_id=%s', id);
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
  // #region agent log
  fetch('http://127.0.0.1:7580/ingest/950995e1-d0ac-4671-9d6d-791b255470ef', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'd9d244' },
    body: JSON.stringify({
      sessionId: 'd9d244',
      location: 'asyncWatchLoopRegistry.js:runProbeInner',
      message: 'probe inner',
      data: { async_job_id: id, hasEntry: !!entry },
      timestamp: Date.now(),
      hypothesisId: 'E',
    }),
  }).catch(() => {});
  // #endregion
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
  if (coreEng.startsWith('jimeng_agent')) {
    const watchTab = await tryResolveJimengWorkTabIdForProbeWatchWithRetries();
    if (watchTab > 0) {
      scheduleJimengProbePageWatcher({
        workTabId: watchTab,
        asyncJobId: id,
        callerTabId: typeof callerTabId === 'number' ? callerTabId : 0,
        recoverPayload: payload,
        timing: 'beforeRecover',
      });
    } else {
      console.info(
        '[PicPuck] WatchLoop 探测前 ' +
          PROBE_JIMENG_TAB_RESOLVE_ATTEMPTS +
          ' 次仍未解析到组内即梦 Tab；将跑 RECOVER（allocate 可能新建 Tab），结束后按 workTabId 挂页内观测',
        { async_job_id: id },
      );
    }
  }

  try {
    console.info('[PicPuck] WatchLoop 即将 dispatch JIMENG_ASYNC_RECOVER', {
      async_job_id: id,
      callerTabId,
    });
    const result = await dispatchAsyncGenerationRecover(callerTabId, payload);
    let relayed = false;
    let notReadyOrSkipped = false;
    if (result.ok && result.tabId > 0) {
      const c = getContext(result.tabId);
      const infos = (c?.logs || [])
        .filter((e) => e && e.level === 'info')
        .map((e) => (typeof e.message === 'string' ? e.message : ''));
      const text = infos.join('\n');
      relayed = text.includes('已回传生成图至熔炉页');
      const notReady = text.includes('即梦尚未生成完成') || text.includes('本轮未就绪或无可回传图');
      const skippedRelay =
        text.includes('跳过图片回传') || text.includes('缺少 generationEvent') || text.includes('无图片可回传');
      notReadyOrSkipped = notReady || skippedRelay;
    }
    console.info('[PicPuck] WatchLoop RECOVER 检查', {
      async_job_id: id,
      callerTabId,
      ok: result.ok,
      phase: result.phase,
      roundId: result.roundId,
      workTabId: result.tabId,
      errorCode: result.errorCode,
      relayedToForge: relayed,
      notReadyOrSkipped,
    });
    if (coreEng.startsWith('jimeng_agent') && typeof result.tabId === 'number' && result.tabId > 0) {
      scheduleJimengProbePageWatcher({
        workTabId: result.tabId,
        asyncJobId: id,
        callerTabId: typeof callerTabId === 'number' ? callerTabId : 0,
        recoverPayload: payload,
        timing: 'afterRecover',
      });
    }
    if (!result.ok) {
      unregisterWatchLoop(id);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[PicPuck] WatchLoop RECOVER probe 异常', { async_job_id: id, error: msg, e });
    unregisterWatchLoop(id);
  }
}
