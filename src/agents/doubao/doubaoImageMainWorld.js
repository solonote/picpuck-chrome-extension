/**
 * 豆包对话页 MAIN 世界：由 SW executeScript 注入；通过 globalThis.__picpuckDoubaoImage 暴露各步 runner。
 * 主对话：前缀「请帮我生成图片/视频」+ 熔炉 prompt，不点「图像生成」或「视频」工作台。
 */
(function () {
  const g = typeof globalThis !== 'undefined' ? globalThis : window;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function editorRectUsable(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 4 && r.height > 4;
  }

  /**
   * 豆包主对话多为 Semi Design：`textarea.semi-input-textarea` + placeholder「发消息…」，不是 Slate contenteditable。
   * 仍回退到主会话区 Slate（若存在且在工作台外）。
   */
  function findMainChatSemiTextarea() {
    const host = document.querySelector('#input-engine-container');
    const list = Array.from(
      document.querySelectorAll(
        'textarea[placeholder*="发消息"], textarea.semi-input-textarea, textarea.semi-input-textarea-autosize',
      ),
    ).filter((el) => {
      if (!editorRectUsable(el)) return false;
      if (host && host.contains(el)) return false;
      return true;
    });
    if (!list.length) return null;
    list.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
    return list[0];
  }

  function findComposerEditor() {
    const ta = findMainChatSemiTextarea();
    if (ta) return ta;
    const host = document.querySelector('#input-engine-container');
    const candidates = Array.from(
      document.querySelectorAll(
        '[data-slate-editor="true"][role="textbox"][contenteditable="true"], [role="textbox"][contenteditable="true"]',
      ),
    ).filter(editorRectUsable);
    const outside = candidates.filter((el) => !host || !host.contains(el));
    const pool = outside.length ? outside : candidates;
    const slate = pool.find((el) => el.getAttribute('data-slate-editor') === 'true');
    return slate || pool[0] || null;
  }

  async function dataUrlToBlob(dataUrl) {
    const res = await fetch(dataUrl);
    return await res.blob();
  }

  /**
   * 将单张参考图写入输入区：构造 ClipboardEvent + DataTransfer（与 Chromium contenteditable 常见行为对齐）。
   */
  async function pasteImageDataUrlIntoEditor(ed, dataUrl) {
    const blob = await dataUrlToBlob(dataUrl);
    const type = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png';
    const file = new File([blob], 'picpuck-ref.png', { type });
    const dt = new DataTransfer();
    dt.items.add(file);
    ed.focus();
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
    ed.dispatchEvent(ev);
    await sleep(450);
  }

  /** 顶栏区域可见的「登录」按钮：存在则视为未登录（勿用哈希 class 定位）。 */
  function findHeaderLoginButton() {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find((b) => {
      const rect = b.getBoundingClientRect();
      if (rect.top > 160 || rect.width < 8 || rect.height < 8) return false;
      const spans = b.querySelectorAll('span');
      for (let i = 0; i < spans.length; i += 1) {
        if ((spans[i].textContent || '').trim() === '登录') return true;
      }
      const compact = (b.textContent || '').replace(/\s+/g, '');
      return compact === '登录';
    });
  }

  /**
   * 熔炉 `prompt` 前加主对话意图前缀；若正文已含「请帮我生成图片/视频」则不再叠一层。
   */
  function buildDoubaoChatFullPrompt(payload) {
    const rawLead =
      typeof payload.doubaoLeadIn === 'string' && payload.doubaoLeadIn.trim()
        ? payload.doubaoLeadIn.trim()
        : '请帮我生成图片，';
    const body = typeof payload.prompt === 'string' ? payload.prompt : '';
    if (!body) return rawLead;
    if (body.startsWith(rawLead)) return body;
    if (/^\s*请帮我生成(图片|视频)/.test(body)) return body;
    return rawLead + body;
  }

  /** Semi / React 受控组件：用原型 setter 写 `value` 再派发自定义事件，避免界面不更新。 */
  function setNativeFormControlValue(el, value) {
    const v = typeof value === 'string' ? value : '';
    const tag = el.tagName;
    const proto = tag === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && typeof desc.set === 'function') {
      desc.set.call(el, v);
    } else {
      el.value = v;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /**
   * Slate：`appendChild` 会破坏内部 DOM；用 insertText / 合成 paste。
   * TEXTAREA/INPUT：整段写入 `value`（本步传入的是完整主对话文案）。
   */
  async function insertPlainTextIntoEditor(ed, text) {
    const s = typeof text === 'string' ? text : '';
    if (!s) return;
    ed.focus();
    await sleep(40);
    const tag = ed.tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT') {
      setNativeFormControlValue(ed, s);
      await sleep(120);
      return;
    }
    const slateLike = ed.getAttribute && ed.getAttribute('data-slate-editor') === 'true';
    let inserted = false;
    if (typeof document.execCommand === 'function') {
      try {
        inserted = document.execCommand('insertText', false, s) === true;
      } catch {
        inserted = false;
      }
    }
    if (!inserted) {
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', s);
        ed.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }),
        );
      } catch {
        /* ignore */
      }
    }
    if (!slateLike && typeof document.execCommand !== 'function' && ed.appendChild) {
      try {
        ed.appendChild(document.createTextNode(s));
      } catch {
        /* ignore */
      }
    }
    await sleep(220);
  }

  function dispatchEnterOnEditor(ed) {
    ed.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }),
    );
    ed.dispatchEvent(
      new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }),
    );
  }

  g.__picpuckDoubaoImage = {
    runStep04_doubao_require_logged_in() {
      const loginBtn = findHeaderLoginButton();
      if (loginBtn) {
        return { ok: false, code: 'DOUBAO_NOT_LOGGED_IN', detail: '请先登录豆包账号' };
      }
      return { ok: true };
    },

    async runStep07_doubao_paste_images_and_prompt(payload) {
      let ed = findComposerEditor();
      if (!ed) {
        return { ok: false, code: 'DOUBAO_EDITOR_NOT_FOUND', detail: '未找到主对话输入框' };
      }
      const images = Array.isArray(payload.images) ? payload.images.filter((x) => typeof x === 'string' && x) : [];
      for (let i = 0; i < images.length; i += 1) {
        ed = findComposerEditor() || ed;
        await pasteImageDataUrlIntoEditor(ed, images[i]);
      }
      const fullPrompt = buildDoubaoChatFullPrompt(payload);
      ed = findComposerEditor() || ed;
      if (!ed) {
        return { ok: false, code: 'DOUBAO_EDITOR_NOT_FOUND', detail: '贴图后未找到输入框' };
      }
      await insertPlainTextIntoEditor(ed, fullPrompt);
      return { ok: true };
    },

    runStep08_doubao_submit_enter() {
      const ed = findComposerEditor();
      if (!ed) {
        return { ok: false, code: 'DOUBAO_EDITOR_NOT_FOUND', detail: '未找到对话输入框' };
      }
      dispatchEnterOnEditor(ed);
      return { ok: true };
    },
  };
})();
