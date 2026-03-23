/**
 * 将顶栏执行槽置 idle（§5.1 结束本轮、§11 releaseExecSlot）。
 * 自洽、供 executeScript({ func, world: 'MAIN' }) 序列化。
 */
export function injectableReleaseExecSlot() {
  const el = document.getElementById('picpuck-agent-topbar');
  if (!el) return { ok: false, reason: 'no-topbar' };
  el.setAttribute('data-picpuck-exec-state', 'idle');
  return { ok: true };
}
