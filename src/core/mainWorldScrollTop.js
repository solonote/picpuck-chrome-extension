/**
 * 供 `executeScript({ world: 'MAIN', func })` 使用；依赖框架 step03 已注入 `__idlinkPicpuckInject.scrollDocumentToTop`。
 */
export function scrollTopViaInjectMain() {
  try {
    const g = typeof globalThis !== 'undefined' ? globalThis : window;
    const inj = g.__idlinkPicpuckInject;
    if (inj && typeof inj.scrollDocumentToTop === 'function') {
      inj.scrollDocumentToTop();
    }
  } catch {
    /* ignore */
  }
}
