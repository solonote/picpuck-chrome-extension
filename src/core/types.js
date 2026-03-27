/**
 * JSDoc 类型约定（与《设计-Chrome扩展步骤与日志规范》CommandRecord / 日志字段对齐）。
 * @typedef {Object} CommandRecord
 * @property {string} command PicPuck 指令枚举键
 * @property {string} [picpuckAction] 页面 postMessage 的 action 字段，与 command 唯一对应
 * @property {string} homeUrl 站点 URL 前缀，用于筛选「属于本站」的 Tab；同一站点可有多种 Task（§9.1）
 * @property {string} taskBaseUrl 本指令在无可用 Tab 时 `tabs.create` 打开的起始 URL，须以 homeUrl 为前缀（§9.1）
 * @property {Function[]} steps 仅业务步骤；step01～step03 由 dispatchRound 框架固定执行（§3.1）
 * @property {boolean} [recoverAllocateSilentDefault] 为 true 时：异步找回「检查」默认不聚焦窗口，仅 `tabs.update(active:true)`；`chrome.storage.sync.picpuckRecoverCheckFocusTab===true` 时检查阶段走完整 `focusWorkTab`。「取回」就绪后由业务步骤显式 `focusWorkTab`。
 */

/**
 * @typedef {'idle'|'received'|'clearing'|'running'|'success'|'error'|'aborted'} UiPhase
 */

/**
 * @typedef {Object} LogEntry
 * @property {number} ts
 * @property {string} roundId
 * @property {string} step
 * @property {'info'|'debug'} level
 * @property {string} message
 * @property {number} [tabId]
 * @property {number} [frameId]
 */

export {};
