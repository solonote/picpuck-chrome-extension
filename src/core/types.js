/**
 * JSDoc 类型约定（与《设计-Chrome扩展步骤与日志规范》CommandRecord / 日志字段对齐）。
 * @typedef {Object} CommandRecord
 * @property {string} command PicPuck 指令枚举键
 * @property {string} [picpuckAction] 页面 postMessage 的 action 字段，与 command 唯一对应
 * @property {string} taskBaseUrl URL 前缀，用于筛选 Tab（§9.1）
 * @property {string} homeUrl 新建 Tab 时的 url（§9.1）
 * @property {Function[]} steps step01/step02 及业务步骤函数引用数组（§3.1）
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
