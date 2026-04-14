/**
 * 豆包对话页 MAIN 世界：由 SW executeScript 注入；通过 globalThis.__picpuckDoubaoImage 暴露各步 runner。
 * 选择器以 data-skill-id、role、文案子串为主，禁止依赖 CSS Modules 哈希类名。
 */
(function () {
  const g = typeof globalThis !== 'undefined' ? globalThis : window;

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function findComposerEditor() {
    return (
      document.querySelector('[data-slate-editor="true"][role="textbox"][contenteditable="true"]') ||
      document.querySelector('[role="textbox"][contenteditable="true"][data-slate-editor="true"]') ||
      document.querySelector('[role="textbox"][contenteditable="true"]')
    );
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

  function clickImageGenerationSkill() {
    const bySkill = document.querySelector('button[data-skill-id="skill_bar_button_3"]');
    if (bySkill) {
      bySkill.click();
      return true;
    }
    const items = Array.from(document.querySelectorAll('[data-component-type="skill-item"]'));
    const hit = items.find((el) => (el.textContent || '').includes('图像生成'));
    if (hit) {
      hit.click();
      return true;
    }
    return false;
  }

  function openRatioMenu() {
    const triggers = Array.from(document.querySelectorAll('button[data-slot="dropdown-menu-trigger"]'));
    const t = triggers.find((b) => (b.textContent || '').includes('比例'));
    if (!t) return false;
    t.click();
    return true;
  }

  function clickRatioMenuItem(ratioLabel) {
    const want = String(ratioLabel || '')
      .trim()
      .replace(/\//g, ':');
    const compactWant = want.replace(/\s+/g, '');
    const nodes = Array.from(
      document.querySelectorAll('[role="menuitem"],[role="option"],[data-slot="dropdown-menu-item"]'),
    );
    const m = nodes.find((el) => {
      const tx = (el.textContent || '').replace(/\s+/g, '');
      return tx.includes(compactWant) || tx.includes(want.replace(':', ''));
    });
    if (!m) return false;
    m.click();
    return true;
  }

  async function insertPlainTextIntoEditor(ed, text) {
    ed.focus();
    const s = typeof text === 'string' ? text : '';
    try {
      if (document.execCommand) {
        document.execCommand('insertText', false, s);
      } else {
        ed.appendChild(document.createTextNode(s));
      }
    } catch {
      ed.appendChild(document.createTextNode(s));
    }
    await sleep(200);
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

    async runStep05_doubao_click_image_mode() {
      if (!clickImageGenerationSkill()) {
        return { ok: false, code: 'DOUBAO_SKILL_NOT_FOUND', detail: '未找到图像生成入口' };
      }
      await sleep(600);
      return { ok: true };
    },

    async runStep06_doubao_select_ratio(payload) {
      const raw = payload && payload.ratio != null ? String(payload.ratio).trim() : '16:9';
      const label = raw.replace(/\//g, ':');
      if (!openRatioMenu()) {
        return { ok: false, code: 'DOUBAO_RATIO_MENU_FAILED', detail: '未找到比例下拉' };
      }
      await sleep(450);
      if (!clickRatioMenuItem(label)) {
        return { ok: false, code: 'DOUBAO_RATIO_MENU_FAILED', detail: '未匹配比例菜单项: ' + label };
      }
      await sleep(450);
      return { ok: true };
    },

    async runStep07_doubao_paste_images_and_prompt(payload) {
      const ed = findComposerEditor();
      if (!ed) {
        return { ok: false, code: 'DOUBAO_EDITOR_NOT_FOUND', detail: '未找到对话输入框' };
      }
      const images = Array.isArray(payload.images) ? payload.images.filter((x) => typeof x === 'string' && x) : [];
      for (let i = 0; i < images.length; i += 1) {
        await pasteImageDataUrlIntoEditor(ed, images[i]);
      }
      const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
      await insertPlainTextIntoEditor(ed, prompt);
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
