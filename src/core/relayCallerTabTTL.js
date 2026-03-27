/**
 * 熔炉 callerTabId 与 roundId：首登 12min 删除；touch 在 send 前调用，剩余不足 5min 续到自此刻起 5min。
 * 按 roundId 唯一，全引擎共用一张表（与具体站点实现无关）。
 */

const INITIAL_MS = 12 * 60 * 1000;
const FLOOR_MS = 5 * 60 * 1000;

/** @type {Map<string, { callerTabId: number, deadline: number, timeoutId: ReturnType<typeof setTimeout> }>} */
const relayCallerByRoundId = new Map();

export function registerRelayCallerTabForRound(roundId, callerTabId) {
  const prev = relayCallerByRoundId.get(roundId);
  if (prev) clearTimeout(prev.timeoutId);
  const deadline = Date.now() + INITIAL_MS;
  const timeoutId = setTimeout(() => {
    relayCallerByRoundId.delete(roundId);
  }, INITIAL_MS);
  relayCallerByRoundId.set(roundId, { callerTabId, deadline, timeoutId });
}

export function getRelayCallerTabIdForRound(roundId) {
  const e = relayCallerByRoundId.get(roundId);
  return e && typeof e.callerTabId === 'number' ? e.callerTabId : undefined;
}

export function touchRelayCallerTabTtlForRound(roundId) {
  const e = relayCallerByRoundId.get(roundId);
  if (!e) return;
  const now = Date.now();
  if (e.deadline - now >= FLOOR_MS) return;
  clearTimeout(e.timeoutId);
  const newDeadline = now + FLOOR_MS;
  const timeoutId = setTimeout(() => {
    relayCallerByRoundId.delete(roundId);
  }, FLOOR_MS);
  relayCallerByRoundId.set(roundId, { callerTabId: e.callerTabId, deadline: newDeadline, timeoutId });
}

export function clearRelayCallerTabRegistrationForRound(roundId) {
  const e = relayCallerByRoundId.get(roundId);
  if (e) clearTimeout(e.timeoutId);
  relayCallerByRoundId.delete(roundId);
}
