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

/**
 * 即梦生成页：记录区为虚拟列表（`record-virtual-list` + `scroll-container` 语义类前缀 + `translate3d`），
 * 不能用全页乱扫 overflow。顺序：① 点「回到底部」走站内逻辑 ② 仅滚 `record-list-container` 下轴容器
 * ③ 窗口/文档根单调向下（不减小 scrollY）。
 */
export function scrollBottomViaInjectMain() {
  try {
    var g = typeof globalThis !== 'undefined' ? globalThis : window;
    var bi;
    var btn;
    var t;
    var r;
    var st;
    var buttons = document.querySelectorAll('button.lv-btn');
    for (bi = 0; bi < buttons.length; bi++) {
      btn = buttons[bi];
      if (!btn || btn.tagName !== 'BUTTON' || btn.disabled) continue;
      t = btn.textContent || '';
      if (t.indexOf('回到底部') === -1) continue;
      r = btn.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      st = g.getComputedStyle(btn);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
      btn.click();
      break;
    }

    var sc =
      document.querySelector('[class*="record-list-container"] [class*="scroll-container"]') ||
      document.querySelector('[class*="record-virtual-list"] [class*="scroll-container"]') ||
      document.querySelector('#dreamina-ui-configuration-content-wrapper [class*="scroll-container"]');
    if (sc && sc.scrollHeight > sc.clientHeight + 4) {
      var mt = Math.max(0, (sc.scrollHeight || 0) - (sc.clientHeight || 0));
      sc.scrollTop = Math.max(sc.scrollTop || 0, mt);
    }

    var innerH = g.innerHeight || 0;
    var se = document.scrollingElement || document.documentElement;
    var b = document.body;
    var docH = 0;
    if (se) docH = Math.max(docH, se.scrollHeight || 0);
    if (b) docH = Math.max(docH, b.scrollHeight || 0);
    var maxWin = Math.max(0, docH - innerH);
    var y = g.scrollY != null ? g.scrollY : g.pageYOffset;
    g.scrollTo(0, Math.max(y, maxWin));
    if (se) {
      var t2 = Math.max(0, (se.scrollHeight || 0) - (se.clientHeight || innerH));
      se.scrollTop = Math.max(se.scrollTop || 0, t2);
    }
    if (b && b !== se) {
      var tb = Math.max(0, (b.scrollHeight || 0) - (b.clientHeight || 0));
      b.scrollTop = Math.max(b.scrollTop || 0, tb);
    }
  } catch {
    /* ignore */
  }
}
