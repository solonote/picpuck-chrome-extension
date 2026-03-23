/**
 * §7.1：appendLog 入口校验，拒绝不合规 message，避免污染顶栏与导出 JSON。
 * system 级 info 使用 Step00. / Step99. 等前缀（与 step 字段 `system` 配合）。
 * @param {'info'|'debug'} level
 * @param {string} message
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateLogMessage(level, message) {
  if (typeof message !== 'string' || message.length === 0) {
    return { ok: false, reason: 'message must be non-empty string' };
  }
  if (level === 'info') {
    if (!/^Step\d{2}\./.test(message)) {
      return { ok: false, reason: 'info must match StepNN.' };
    }
    return { ok: true };
  }
  if (level === 'debug') {
    if (!/^Step\d{2}\.debug\./.test(message)) {
      return { ok: false, reason: 'debug must match StepNN.debug.' };
    }
    return { ok: true };
  }
  return { ok: false, reason: 'unknown level' };
}
