/**
 * core_engine 前缀 → 异步管线 Profile（设计 **12** §A、**14** 批次 1/4）。
 * core 禁止以引擎名字符串分支选路；仅允许与本表及 registry 组合使用。
 */

/**
 * @typedef {object} AsyncEngineProfile
 * @property {string} enginePrefix
 * @property {string} launchCommand
 * @property {'PROBE_RELAY'|'SINGLE_COMMAND'} recoverStrategy
 * @property {string|null} probeCommand
 * @property {string|null} relayCommand
 * @property {string|null} recoverCommand
 * @property {string|null} awaitingRelayPhase
 * @property {((result: { ok?: boolean, probeOutcome?: string }) => string) | null} parseProbeOutcome
 * @property {boolean} registerWatchLoopOnLaunchSuccess
 * @property {boolean} usePageRecoverReady
 * @property {boolean} keepWatchLoopAfterRelaySuccess
 * @property {string|null} defaultJimengSubmitModeForLaunch
 */

/** @type {AsyncEngineProfile[]} */
const PROFILES = [
  {
    enginePrefix: 'jimeng_agent',
    launchCommand: 'JIMENG_ASYNC_LAUNCH',
    recoverStrategy: 'PROBE_RELAY',
    probeCommand: 'JIMENG_ASYNC_PROBE',
    relayCommand: 'JIMENG_ASYNC_RELAY',
    recoverCommand: null,
    awaitingRelayPhase: 'EXT_REMOTE_AWAITING_RELAY',
    parseProbeOutcome: (result) =>
      result.probeOutcome === 'ready' ? 'ready' : String(result.probeOutcome || 'not_ready'),
    registerWatchLoopOnLaunchSuccess: true,
    usePageRecoverReady: true,
    keepWatchLoopAfterRelaySuccess: false,
    defaultJimengSubmitModeForLaunch: 'enter',
  },
  {
    enginePrefix: 'gemini_agent',
    launchCommand: 'GEMINI_ASYNC_LAUNCH',
    recoverStrategy: 'SINGLE_COMMAND',
    probeCommand: null,
    relayCommand: null,
    recoverCommand: 'GEMINI_ASYNC_RECOVER',
    awaitingRelayPhase: null,
    parseProbeOutcome: null,
    registerWatchLoopOnLaunchSuccess: false,
    usePageRecoverReady: false,
    keepWatchLoopAfterRelaySuccess: false,
    defaultJimengSubmitModeForLaunch: null,
  },
];

/**
 * @param {string} core_engine
 * @returns {AsyncEngineProfile}
 */
export function resolveProfileByCoreEngine(core_engine) {
  const core = String(core_engine || '').trim();
  for (let i = 0; i < PROFILES.length; i += 1) {
    const p = PROFILES[i];
    if (core.startsWith(p.enginePrefix)) return p;
  }
  throw new Error('ASYNC_BAD_CORE_ENGINE');
}
