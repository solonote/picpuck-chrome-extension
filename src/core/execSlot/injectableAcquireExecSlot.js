/**
 * 供 chrome.scripting.executeScript({ func, world: 'MAIN' }) 注入。
 * 必须自洽、不引用闭包外变量（Chrome 会序列化本函数体）（§9.3）。
 * @returns {{ acquired: boolean, invalid?: boolean, reason?: string }}
 */
export function injectableAcquireExecSlot() {
  const ID = 'picpuck-agent-topbar';
  let el = document.getElementById(ID);
  if (!el) {
    el = document.createElement('div');
    el.id = ID;
    el.setAttribute('data-picpuck-exec-state', 'idle');
    if (!document.body) {
      return { acquired: false, reason: 'no-body' };
    }
    document.body.appendChild(el);
  }
  const raw = el.getAttribute('data-picpuck-exec-state');
  if (raw === 'running') {
    return { acquired: false };
  }
  // 浏览器上缺失属性多为 null，与 '' 一并视为可抢占（§9.3）
  if (!raw || raw === '' || raw === 'idle') {
    el.setAttribute('data-picpuck-exec-state', 'running');
    return { acquired: true };
  }
  return { acquired: false, invalid: true };
}
