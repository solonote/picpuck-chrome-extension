/**
 * 熔炉 callerTabId 与 roundId：首登 12min 删除；touch 在 send 前调用，剩余不足 5min 续到自此刻起 5min。
 * 条目：{ callerTabId, deadline, timeoutId }
 */

const INITIAL_MS = 12 * 60 * 1000;
const FLOOR_MS = 5 * 60 * 1000;

/** @type {Map<string, { callerTabId: number, deadline: number, timeoutId: ReturnType<typeof setTimeout> }>} */
const jimengMeta = new Map();
/** @type {Map<string, { callerTabId: number, deadline: number, timeoutId: ReturnType<typeof setTimeout> }>} */
const geminiMeta = new Map();

export function registerJimengRelayCallerTab(roundId, callerTabId) {
  const prev = jimengMeta.get(roundId);
  if (prev) clearTimeout(prev.timeoutId);
  const deadline = Date.now() + INITIAL_MS;
  const timeoutId = setTimeout(() => {
    jimengMeta.delete(roundId);
  }, INITIAL_MS);
  jimengMeta.set(roundId, { callerTabId, deadline, timeoutId });
}

export function getJimengRelayCallerTabId(roundId) {
  const e = jimengMeta.get(roundId);
  return e && typeof e.callerTabId === 'number' ? e.callerTabId : undefined;
}

export function touchJimengRelayCallerTabTtl(roundId) {
  const e = jimengMeta.get(roundId);
  if (!e) return;
  const now = Date.now();
  if (e.deadline - now >= FLOOR_MS) return;
  clearTimeout(e.timeoutId);
  const newDeadline = now + FLOOR_MS;
  const timeoutId = setTimeout(() => {
    jimengMeta.delete(roundId);
  }, FLOOR_MS);
  jimengMeta.set(roundId, { callerTabId: e.callerTabId, deadline: newDeadline, timeoutId });
}

export function clearJimengRelayCallerTabRegistration(roundId) {
  const e = jimengMeta.get(roundId);
  if (e) clearTimeout(e.timeoutId);
  jimengMeta.delete(roundId);
}

export function registerGeminiRelayCallerTab(roundId, callerTabId) {
  const prev = geminiMeta.get(roundId);
  if (prev) clearTimeout(prev.timeoutId);
  const deadline = Date.now() + INITIAL_MS;
  const timeoutId = setTimeout(() => {
    geminiMeta.delete(roundId);
  }, INITIAL_MS);
  geminiMeta.set(roundId, { callerTabId, deadline, timeoutId });
}

export function getGeminiRelayCallerTabId(roundId) {
  const e = geminiMeta.get(roundId);
  return e && typeof e.callerTabId === 'number' ? e.callerTabId : undefined;
}

export function touchGeminiRelayCallerTabTtl(roundId) {
  const e = geminiMeta.get(roundId);
  if (!e) return;
  const now = Date.now();
  if (e.deadline - now >= FLOOR_MS) return;
  clearTimeout(e.timeoutId);
  const newDeadline = now + FLOOR_MS;
  const timeoutId = setTimeout(() => {
    geminiMeta.delete(roundId);
  }, FLOOR_MS);
  geminiMeta.set(roundId, { callerTabId: e.callerTabId, deadline: newDeadline, timeoutId });
}

export function clearGeminiRelayCallerTabRegistration(roundId) {
  const e = geminiMeta.get(roundId);
  if (e) clearTimeout(e.timeoutId);
  geminiMeta.delete(roundId);
}
