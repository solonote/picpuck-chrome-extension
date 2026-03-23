/**
 * 全站 PicPuck 指令注册表：仅通过 registerAgentCommands 写入，按 command 查 CommandRecord（§12、§11.7）。
 * @typedef {import('./types.js').CommandRecord} CommandRecord
 */

/** @type {CommandRecord[]} */
const commandRecords = [];

/**
 * 站点模块在加载时调用，合并注册多条 CommandRecord。
 * @param {CommandRecord[]} records
 */
export function registerAgentCommands(records) {
  if (!Array.isArray(records)) {
    console.warn('[PicPuck] registerAgentCommands: expected array');
    return;
  }
  commandRecords.push(...records);
  console.info('[PicPuck] registerAgentCommands: +%d total=%d', records.length, commandRecords.length);
}

/** @param {string} command */
export function getCommandRecord(command) {
  return commandRecords.find((r) => r.command === command) ?? null;
}

/** PicPuck 页面 payload.action → CommandRecord（数据驱动，禁止写站点 if 分支 §12.4） */
export function getCommandRecordByPicpuckAction(action) {
  if (!action || typeof action !== 'string') return null;
  return commandRecords.find((r) => r.picpuckAction === action) ?? null;
}

export function getRegisteredCommandCount() {
  return commandRecords.length;
}

export function getAllCommandRecords() {
  return [...commandRecords];
}
