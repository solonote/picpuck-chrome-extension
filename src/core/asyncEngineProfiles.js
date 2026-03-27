/**
 * core_engine 前缀 → 异步管线 Profile（设计 **12** §A、**14** 批次 1/4）。
 * core 禁止以引擎展示名分支选路；仅允许与本表及 registry 组合使用。
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
 * @property {boolean} startRecoverPageWatcherOnLaunchSuccess LAUNCH 成功且含锚点立即挂页内 watcher
 * @property {boolean} injectRecoverPageWatcherAfterProbe PROBE 成功后在工作 Tab 再挂 watcher（与上条可并存）
 * @property {boolean} keepWatchLoopAfterRelaySuccess
 * @property {string|null} defaultSubmitModeForLaunch 即梦等站点的 `jimengSubmitMode` 默认值；无则 null
 * @property {(ctx: object) => boolean} hasLaunchAnchor
 * @property {(ctx: object, recoverPayload: Record<string, unknown>) => void} mergeLaunchRecoverPayload
 * @property {(ctx: object) => string} readProbeOutcome
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
    startRecoverPageWatcherOnLaunchSuccess: true,
    injectRecoverPageWatcherAfterProbe: true,
    keepWatchLoopAfterRelaySuccess: false,
    defaultSubmitModeForLaunch: 'enter',
    hasLaunchAnchor(ctx) {
      return !!(ctx.jimengRecordAnchor && typeof ctx.jimengRecordAnchor === 'object');
    },
    mergeLaunchRecoverPayload(ctx, recoverPayload) {
      recoverPayload.jimengRecordAnchor = ctx.jimengRecordAnchor;
    },
    readProbeOutcome(ctx) {
      return typeof ctx.jimengProbeOutcome === 'string' ? ctx.jimengProbeOutcome.trim() : '';
    },
  },
  {
    enginePrefix: 'gemini_agent',
    launchCommand: 'GEMINI_ASYNC_LAUNCH',
    recoverStrategy: 'PROBE_RELAY',
    probeCommand: 'GEMINI_ASYNC_PROBE',
    relayCommand: 'GEMINI_ASYNC_RELAY',
    recoverCommand: null,
    awaitingRelayPhase: 'EXT_REMOTE_AWAITING_RELAY',
    parseProbeOutcome: (result) =>
      result.probeOutcome === 'ready' ? 'ready' : String(result.probeOutcome || 'not_ready'),
    registerWatchLoopOnLaunchSuccess: true,
    startRecoverPageWatcherOnLaunchSuccess: true,
    injectRecoverPageWatcherAfterProbe: true,
    keepWatchLoopAfterRelaySuccess: false,
    defaultSubmitModeForLaunch: null,
    hasLaunchAnchor(ctx) {
      const g = ctx.geminiAsyncAnchor;
      return !!(
        g &&
        typeof g === 'object' &&
        typeof g.conversationUrl === 'string' &&
        g.conversationUrl.trim() &&
        typeof g.turnContainerId === 'string' &&
        g.turnContainerId.trim()
      );
    },
    mergeLaunchRecoverPayload(ctx, recoverPayload) {
      const g = ctx.geminiAsyncAnchor;
      if (!g || typeof g !== 'object') return;
      recoverPayload.geminiConversationUrl = g.conversationUrl.trim();
      recoverPayload.geminiTurnContainerId = g.turnContainerId.trim();
    },
    readProbeOutcome(ctx) {
      return typeof ctx.geminiProbeOutcome === 'string' ? ctx.geminiProbeOutcome.trim() : '';
    },
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
