/**
 * 将顶栏执行槽置 idle（§5.1 结束本轮、§11 releaseExecSlot）。
 * 自洽、供 executeScript({ func, world: 'MAIN' }) 序列化。
 * 与 `injectableAcquireExecSlot` 一致：若无 `#picpuck-agent-topbar` 则创建占位节点，避免「抢占时建了 div、释放时找不到节点」导致槽永久 running，下一轮 allocate 只能新开 Tab。
 */
export function injectableReleaseExecSlot() {
  const ID = 'picpuck-agent-topbar';
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ID;
    if (!document.body) {
      return { ok: false, reason: 'no-body' };
    }
    document.body.appendChild(el);
  }
  el.setAttribute('data-picpuck-exec-state', 'idle');
  return { ok: true };
}
