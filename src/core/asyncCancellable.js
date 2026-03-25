/**
 * 可中断等待（设计 **14** §D）：步骤内长 sleep 时仍能在取消后尽快退出。
 */

/**
 * @param {number} ms
 * @param {{ isCancelled?: () => boolean }} [opts]
 */
export async function delay(ms, { isCancelled } = {}) {
  const total = typeof ms === 'number' && ms > 0 ? ms : 0;
  const deadline = Date.now() + total;
  while (Date.now() < deadline) {
    if (isCancelled && isCancelled()) {
      throw Object.assign(new Error('ASYNC_JOB_CANCELLED'), { code: 'ASYNC_JOB_CANCELLED' });
    }
    const left = deadline - Date.now();
    await new Promise((r) => setTimeout(r, Math.min(200, left > 0 ? left : 0)));
  }
}
