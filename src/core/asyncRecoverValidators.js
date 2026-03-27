/**
 * Recover / WATCH_PROBE 载荷校验：按 core_engine 前缀找 agent 注册函数（设计 **12** §B、**14** 批次 2）。
 */

/** @type {Map<string, (p: Record<string, unknown>) => string|undefined>} */
const validatorsByPrefix = new Map();

/**
 * @param {string} enginePrefix 与 Profile `enginePrefix` 对齐，如 `jimeng_agent`
 * @param {(p: Record<string, unknown>) => string|undefined} fn 通过返回 undefined，失败返回文案
 */
export function registerAsyncRecoverPayloadValidator(enginePrefix, fn) {
  const p = String(enginePrefix || '').trim();
  if (!p || typeof fn !== 'function') return;
  validatorsByPrefix.set(p, fn);
}

/**
 * @param {string} core_engine
 * @param {Record<string, unknown>} mergedPayload
 * @returns {string|undefined}
 */
export function validateRecoverPayload(core_engine, mergedPayload) {
  const core = String(core_engine || '').trim();
  const keys = Array.from(validatorsByPrefix.keys()).sort((a, b) => b.length - a.length);
  for (let i = 0; i < keys.length; i += 1) {
    const prefix = keys[i];
    if (core.startsWith(prefix)) {
      const fn = validatorsByPrefix.get(prefix);
      return fn ? fn(mergedPayload) : '校验器未注册';
    }
  }
  return '不支持的 core_engine';
}
