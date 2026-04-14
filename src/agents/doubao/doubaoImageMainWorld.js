/**
 * 豆包对话页 MAIN 世界：由 SW executeScript 注入；通过 globalThis.__picpuckDoubaoImage 暴露各步 runner。
 * 选择器以 data-skill-id、role、文案子串为主，禁止依赖 CSS Modules 哈希类名。
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
   * 工作台打开后，页内往往同时存在「主对话」与「图像/视频生成」两处 contenteditable；
   * 必须优先 `#input-engine-container` 内的输入区，否则词会写进错误 Slate，随后被工作台状态清掉（表现为填完瞬间消失）。
   */
  function findComposerEditor() {
    const host = document.querySelector('#input-engine-container');
    const candidates = Array.from(
      document.querySelectorAll(
        '[data-slate-editor="true"][role="textbox"][contenteditable="true"], [role="textbox"][contenteditable="true"]',
      ),
    ).filter(editorRectUsable);
    if (host) {
      const inner = candidates.find((el) => host.contains(el));
      if (inner) return inner;
    }
    const slate = candidates.find((el) => el.getAttribute('data-slate-editor') === 'true');
    return slate || candidates[0] || null;
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
   * 是否已在「图像生成」工作台：选技能后豆包常把入口收成 chip（div + data-value，不再渲染 skill_bar_button_3 按钮）。
   * 与下方「比例」下拉同源信号，避免用户已选手动仍报 DOUBAO_SKILL_NOT_FOUND。
   */
  function isDoubaoImageGenerationModeActive() {
    const chips = Array.from(document.querySelectorAll('[data-value="3"]'));
    for (let i = 0; i < chips.length; i += 1) {
      const el = chips[i];
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (String(el.textContent || '').includes('图像生成')) return true;
    }
    const triggers = Array.from(document.querySelectorAll('[data-slot="dropdown-menu-trigger"]'));
    if (triggers.some((t) => String(t.textContent || '').includes('比例'))) return true;
    return false;
  }

  function clickImageGenerationSkill() {
    if (isDoubaoImageGenerationModeActive()) return true;
    const bySkill = document.querySelector('[data-skill-id="skill_bar_button_3"]');
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

  /** Tab 文案归一：豆包页内常见空白 / NBSP，避免 trim 后仍不等于「视频」。 */
  function normalizeWorkbenchTabLabel(el) {
    return (el.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 图像生成面板内「图像 / 视频」切换：点「视频」Tab（不依赖 Radix 动态 id）。 */
  function clickVideoTabInGenerationWorkbench() {
    const tabSelectors =
      '[data-slot="tabs"] button[role="tab"], [data-slot="tabs-list"] button[role="tab"], button[role="tab"][data-slot="tabs-trigger"]';
    /** 你提供的整页 HTML 中，图像/视频 Tab 位于 `#input-engine-container` 内；先限定范围避免点到页面上其它 role=tab。 */
    const roots = [];
    const inputHost = document.querySelector('#input-engine-container');
    if (inputHost) roots.push(inputHost);
    roots.push(document);

    for (let r = 0; r < roots.length; r += 1) {
      const scoped = Array.from(roots[r].querySelectorAll(tabSelectors));
      const byText = scoped.find((b) => normalizeWorkbenchTabLabel(b) === '视频');
      if (byText) {
        byText.click();
        return true;
      }
    }

    const anyTab = Array.from(document.querySelectorAll('button[role="tab"][data-slot="tabs-trigger"]'));
    const loose = anyTab.find((b) => normalizeWorkbenchTabLabel(b) === '视频');
    if (loose) {
      loose.click();
      return true;
    }
    return false;
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

    async runStep05b_doubao_click_video_tab() {
      await sleep(900);
      if (!clickVideoTabInGenerationWorkbench()) {
        return { ok: false, code: 'DOUBAO_VIDEO_TAB_NOT_FOUND', detail: '未找到「视频」Tab' };
      }
      await sleep(500);
      return { ok: true };
    },

    async runStep07_doubao_paste_images_and_prompt(payload) {
      let ed = findComposerEditor();
      if (!ed) {
        return { ok: false, code: 'DOUBAO_EDITOR_NOT_FOUND', detail: '未找到对话输入框' };
      }
      const images = Array.isArray(payload.images) ? payload.images.filter((x) => typeof x === 'string' && x) : [];
      for (let i = 0; i < images.length; i += 1) {
        ed = findComposerEditor() || ed;
        await pasteImageDataUrlIntoEditor(ed, images[i]);
      }
      const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
      ed = findComposerEditor() || ed;
      if (!ed) {
        return { ok: false, code: 'DOUBAO_EDITOR_NOT_FOUND', detail: '贴图后未找到输入框' };
      }
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
