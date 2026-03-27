/**
 * Gemini 图片生成：MAIN 世界脚本（设计 §5 / §3.1.1 类比即梦）。
 * 语义对齐旧版 `runGeminiGenerateImage`，不含顶栏 Banner、三连击日志等 R6 排除项。
 */
(function () {
  var g = typeof globalThis !== 'undefined' ? globalThis : window;
  // 同页多次注入：已有完整 watcher API 则跳过，否则重跑 bundle（扩展升级后旧页内对象缺 API）。
  if (g.__picpuckGeminiImage && typeof g.__picpuckGeminiImage.startGeminiRecoverPageWatcher === 'function') {
    return;
  }

  var doc = document;
  var STEP_DELAY_MS = 600;
  var REF_UPLOAD_POLL_MS = 400;
  var REF_UPLOAD_COUNT_DEADLINE_MS = 120000;
  var REF_UPLOAD_PHASE2_MAX_MS = 90000;
  /** 页内无上传进度控件时，预览芯片数达标后至少再等这么久再认为就绪 */
  var REF_UPLOAD_NO_SPINNER_MIN_MS = 1000;
  /** 连续多轮无上传中指示才认为稳定 */
  var REF_UPLOAD_CLEAR_TICKS = 3;
  var GEMINI_RECOVER_TAB_ACTIVATE_MAX_WAIT_MS = 25000;
  var GEMINI_RECOVER_TAB_VISIBLE_SETTLE_MS = 400;
  var GEMINI_WATCH_POLL_MS = 5000;
  var GEMINI_WATCH_MAX_TICKS_NO_FORGE = 36;

  function appendMainLog(roundId, step, level, message) {
    try {
      window.postMessage(
        {
          picpuckBridge: true,
          kind: 'LOG_APPEND',
          entry: { ts: Date.now(), roundId: roundId, step: step, level: level, message: message },
        },
        location.origin,
      );
    } catch (e) {
      /* ignore */
    }
  }

  function delay(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function findByText(root, text, tag) {
    var list = (root || doc).querySelectorAll(tag || '*');
    for (var i = 0; i < list.length; i++) {
      var t = list[i].textContent && list[i].textContent.trim();
      if (t && t.indexOf(text) !== -1) return list[i];
    }
    return null;
  }

  function isVisible(el) {
    return !!(el && el.offsetParent);
  }

  function findVisible(finder) {
    var el = typeof finder === 'function' ? finder() : finder;
    return isVisible(el) ? el : null;
  }

  function clickWhenVisible(finder) {
    var el = findVisible(finder);
    if (!el) return false;
    el.click();
    return true;
  }

  function findToolButton() {
    var drawer = doc.querySelector('toolbox-drawer');
    if (drawer) {
      var btn = drawer.querySelector('button.toolbox-drawer-button') || drawer.querySelector('button[class*="toolbox-drawer-button"]');
      if (btn) return btn;
      var btns = drawer.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var t = (btns[i].textContent && btns[i].textContent.trim()) || '';
        if (t === '工具' || t === 'Tools' || t.indexOf('工具') !== -1 || t.indexOf('Tools') !== -1) return btns[i];
      }
      if (btns.length > 0) return btns[0];
    }
    var byIcon = doc.querySelector('mat-icon[data-mat-icon-name="page_info"]');
    if (byIcon && byIcon.closest) {
      var b = byIcon.closest('button');
      if (b) return b;
    }
    return (
      doc.querySelector('button[aria-label="工具"]') ||
      doc.querySelector('button[aria-label="Tools"]') ||
      findByText(doc.body, '工具', 'button') ||
      findByText(doc.body, 'Tools', 'button')
    );
  }

  /**
   * Gemini UI phase-1：`input-area-v2` + `simplified-input-menu`，工具入口为「+」而非旧版 toolbox 条上的「工具」。
   * 先点此按钮展开 `toolbox-drawer`，再点 `toolbox-drawer-item`「制作图片」（与旧版第二步相同）。
   */
  function findSimplifiedInputToolboxMenuButton() {
    var byLabel = doc.querySelector(
      'button[aria-label="打开输入区域菜单，以选择工具和上传内容类型"]',
    );
    if (byLabel && isVisible(byLabel)) return byLabel;
    var menus = doc.querySelectorAll('simplified-input-menu button.menu-button.open');
    for (var mi = 0; mi < menus.length; mi++) {
      if (isVisible(menus[mi])) return menus[mi];
    }
    var addHost = doc.querySelector('simplified-input-menu mat-icon[data-mat-icon-name="add_2"]');
    if (addHost && addHost.closest) {
      var addBtn = addHost.closest('button');
      if (addBtn && isVisible(addBtn)) return addBtn;
    }
    return null;
  }

  function isAlreadyMakeImageMode() {
    var deselect = doc.querySelector('button.toolbox-drawer-item-deselect-button') || doc.querySelector('button[aria-label*="取消选择"]');
    if (deselect) {
      var t = deselect.textContent && deselect.textContent.trim();
      if (t && t.indexOf('制作图片') !== -1) return true;
      var label = deselect.querySelector && deselect.querySelector('span.toolbox-drawer-item-deselect-button-label');
      if (label && label.textContent && label.textContent.trim().indexOf('制作图片') !== -1) return true;
    }
    var container = doc.querySelector('.toolbox-drawer-button-container.has-selected-item');
    if (container) {
      var lb = container.querySelector('span.toolbox-drawer-item-deselect-button-label');
      if (lb && lb.textContent && lb.textContent.trim().indexOf('制作图片') !== -1) return true;
    }
    return false;
  }

  function isAlreadyFastMode() {
    var modeBtn = doc.querySelector('button[data-test-id="bard-mode-menu-button"]') || doc.querySelector('button[aria-label="打开模式选择器"]');
    if (!modeBtn) return false;
    var t = modeBtn.textContent && modeBtn.textContent.trim();
    return t === '快速' || (t && t.indexOf('快速') !== -1);
  }

  function isAlreadyProMode() {
    var modeBtn = doc.querySelector('button[data-test-id="bard-mode-menu-button"]') || doc.querySelector('button[aria-label="打开模式选择器"]');
    if (!modeBtn) return false;
    var t = modeBtn.textContent && modeBtn.textContent.trim();
    return t === 'Pro' || (t && t.indexOf('Pro') !== -1);
  }

  function findMakeImageButton() {
    var items = doc.querySelectorAll('toolbox-drawer-item');
    for (var i = 0; i < items.length; i++) {
      var t = items[i].textContent && items[i].textContent.trim();
      if (t && t.indexOf('制作图片') !== -1) {
        var btn =
          items[i].querySelector('button.toolbox-drawer-item-list-button') ||
          items[i].querySelector('button[class*="toolbox-drawer-item-list-button"]') ||
          items[i].querySelector('button[role="menuitemcheckbox"]') ||
          items[i].querySelector('button');
        if (btn) return btn;
      }
    }
    var byPhoto = doc.querySelector(
      'toolbox-drawer-item mat-icon[data-mat-icon-name="photo_prints"]',
    );
    if (byPhoto && byPhoto.closest) {
      var row = byPhoto.closest('toolbox-drawer-item');
      if (row) {
        var phBtn =
          row.querySelector('button.toolbox-drawer-item-list-button') ||
          row.querySelector('button[role="menuitemcheckbox"]') ||
          row.querySelector('button');
        if (phBtn && isVisible(phBtn)) return phBtn;
      }
    }
    var label = doc.querySelector('div.label.gds-label-l');
    if (label && label.textContent && label.textContent.trim().indexOf('制作图片') !== -1) {
      var b =
        label.closest &&
        (label.closest('button') || (label.closest('toolbox-drawer-item') && label.closest('toolbox-drawer-item').querySelector('button')));
      if (b) return b;
    }
    return (
      findByText(doc.body, '制作图片', 'button') ||
      (function () {
        var el = findByText(doc.body, '制作图片');
        return el && el.closest ? el.closest('button') : null;
      })()
    );
  }

  /** @param {{ roundId: string }} payload */
  async function runStep06GeminiEnsureMakeImageEntry(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step06_gemini_ensure_make_image_entry';
    var maxWait = 50;
    var wc = 0;
    if (isAlreadyMakeImageMode()) {
      appendMainLog(roundId, stepKey, 'debug', 'Step06.debug.alreadyMakeImage');
      return { ok: true };
    }
    var openedDrawer = false;
    if (findSimplifiedInputToolboxMenuButton()) {
      wc = 0;
      while (wc < maxWait) {
        if (
          clickWhenVisible(function () {
            return findSimplifiedInputToolboxMenuButton();
          })
        ) {
          appendMainLog(roundId, stepKey, 'debug', 'Step06.debug.clickedSimplifiedInputToolboxMenu');
          await delay(STEP_DELAY_MS);
          openedDrawer = true;
          break;
        }
        wc++;
        await delay(300);
      }
    }
    if (!openedDrawer) {
      wc = 0;
      while (wc < maxWait) {
        var toolBtn = findToolButton();
        if (clickWhenVisible(function () {
          return toolBtn;
        })) {
          appendMainLog(roundId, stepKey, 'debug', 'Step06.debug.clickedTool');
          await delay(STEP_DELAY_MS);
          openedDrawer = true;
          break;
        }
        wc++;
        await delay(300);
      }
    }
    if (!openedDrawer) {
      return { ok: false, code: 'GEMINI_UI_NOT_READY' };
    }
    wc = 0;
    while (wc < maxWait) {
      if (isAlreadyMakeImageMode()) {
        return { ok: true };
      }
      var makeImg = findMakeImageButton();
      if (clickWhenVisible(function () {
        return makeImg;
      })) {
        appendMainLog(roundId, stepKey, 'debug', 'Step06.debug.clickedMakeImage');
        await delay(STEP_DELAY_MS);
        return { ok: true };
      }
      wc++;
      await delay(300);
    }
    return { ok: false, code: 'GEMINI_UI_NOT_READY' };
  }

  /** @param {{ roundId: string, bardMode?: string }} payload */
  async function runStep08GeminiEnsureBardMode(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step08_gemini_ensure_bard_mode';
    var bardMode = payload && payload.bardMode === 'pro' ? 'pro' : 'banana2';
    var maxWait = 50;
    var wc = 0;
    if (bardMode === 'pro' && isAlreadyProMode()) {
      appendMainLog(roundId, stepKey, 'debug', 'Step08.debug.alreadyPro');
      return { ok: true };
    }
    if (bardMode !== 'pro' && isAlreadyFastMode()) {
      appendMainLog(roundId, stepKey, 'debug', 'Step08.debug.alreadyFast');
      return { ok: true };
    }
    while (wc < maxWait) {
      var modeBtn =
        doc.querySelector('button[data-test-id="bard-mode-menu-button"]') ||
        doc.querySelector('button[aria-label="打开模式选择器"]') ||
        findByText(doc.body, '快速', 'button') ||
        findByText(doc.body, 'Pro', 'button');
      if (clickWhenVisible(function () {
        return modeBtn;
      })) {
        appendMainLog(roundId, stepKey, 'debug', 'Step08.debug.openedModeMenu');
        await delay(STEP_DELAY_MS);
        break;
      }
      wc++;
      await delay(300);
    }
    if (wc >= maxWait) {
      return { ok: false, code: 'GEMINI_UI_NOT_READY' };
    }
    function resolveModeOption() {
      if (bardMode === 'pro') {
        return (
          doc.querySelector('button[data-test-id="bard-mode-option-pro"]') ||
          doc.querySelector('button[data-mode-id="e6fa609c3fa255c0"]') ||
          (function () {
            var items = doc.querySelectorAll('button[role="menuitemradio"], button.mat-mdc-menu-item');
            for (var i = 0; i < items.length; i++) {
              var title = items[i].querySelector && items[i].querySelector('.mode-title');
              var txt = (title && title.textContent && title.textContent.trim()) || (items[i].textContent && items[i].textContent.trim()) || '';
              if (txt === 'Pro' || txt.indexOf('Pro') !== -1) return items[i];
            }
            return null;
          })()
        );
      }
      return (
        doc.querySelector('button[data-test-id="bard-mode-option-快速"]') ||
        doc.querySelector('button[data-mode-id="56fdd199312815e2"]') ||
        (function () {
          var items = doc.querySelectorAll('button[role="menuitemradio"], button.mat-mdc-menu-item');
          for (var j = 0; j < items.length; j++) {
            var title2 = items[j].querySelector && items[j].querySelector('.mode-title');
            var txt2 = (title2 && title2.textContent && title2.textContent.trim()) || '';
            if (txt2 === '快速' || txt2.indexOf('快速') !== -1) return items[j];
          }
          return null;
        })()
      );
    }
    wc = 0;
    while (wc < maxWait) {
      var opt = resolveModeOption();
      if (clickWhenVisible(function () {
        return opt;
      })) {
        appendMainLog(roundId, stepKey, 'debug', 'Step08.debug.clickedModeOption');
        await delay(STEP_DELAY_MS);
        return { ok: true };
      }
      wc++;
      await delay(300);
    }
    return { ok: false, code: 'GEMINI_UI_NOT_READY' };
  }

  async function removeAllGeminiRefPreviewImages(roundId, stepKey) {
    var maxClicks = 60;
    var n = 0;
    while (n < maxClicks) {
      var btn =
        doc.querySelector('button[data-test-id="cancel-button"]') ||
        doc.querySelector('.uploader-file-preview-container .cancel-button');
      if (!btn) break;
      n++;
      try {
        btn.click();
      } catch (e) {
        /* ignore */
      }
      appendMainLog(roundId, stepKey, 'debug', 'Step09.debug.removedRefPreview n=' + n);
      await delay(280);
    }
  }

  function listGeminiRefPreviewChipRoots() {
    var chips = doc.querySelectorAll('.uploader-file-preview-container uploader-file-preview');
    if (chips.length === 0) {
      chips = doc.querySelectorAll('uploader-file-preview.file-preview-chip');
    }
    return chips;
  }

  /**
   * 统计可见参考图预览「芯片」数量。Gemini 常将多张图放在**一个** `.uploader-file-preview-container` 内，
   * 每张图对应一个 `uploader-file-preview`，不能按容器个数与 images.length 对齐。
   */
  function countVisibleGeminiRefPreviewChips() {
    var chips = listGeminiRefPreviewChipRoots();
    var c = 0;
    for (var i = 0; i < chips.length; i++) {
      if (isVisible(chips[i])) c++;
    }
    return c;
  }

  /** @param {Element} root */
  function geminiRefPreviewShowsUploadProgress(root) {
    if (!root || !root.querySelector) return false;
    var spin =
      root.querySelector('mat-spinner') ||
      root.querySelector('mat-progress-spinner') ||
      root.querySelector('[role="progressbar"]') ||
      root.querySelector('progress');
    if (spin && isVisible(spin)) return true;
    if (root.getAttribute && root.getAttribute('aria-busy') === 'true') return true;
    return false;
  }

  function anyGeminiRefPreviewUploading() {
    var chips = listGeminiRefPreviewChipRoots();
    for (var i = 0; i < chips.length; i++) {
      if (!isVisible(chips[i])) continue;
      if (geminiRefPreviewShowsUploadProgress(chips[i])) return true;
    }
    return false;
  }

  /**
   * 粘贴后等待：可见预览芯片数 ≥ expected，且上传进度消失（无进度条时最短再等 REF_UPLOAD_NO_SPINNER_MIN_MS）。
   * @param {string} roundId
   * @param {string} stepKey
   * @param {number} expectedCount
   */
  /**
   * Gemini 输入区：Enter 会提交；提示词内换行须用软换行（insertLineBreak / Shift+Enter），不可整段 insertText 含 \\n。
   */
  async function insertGeminiEditorTextWithSoftLineBreaks(inputEl, rawText) {
    var s = typeof rawText === 'string' ? rawText : '';
    if (!s || !document.execCommand) return;
    var lines = s.split(/\r\n|\n|\r/);
    var li;
    for (li = 0; li < lines.length; li++) {
      if (li > 0) {
        var broke = false;
        try {
          broke = document.execCommand('insertLineBreak', false, null);
        } catch (eLb) {
          broke = false;
        }
        if (!broke) {
          try {
            inputEl.dispatchEvent(
              new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
              }),
            );
            inputEl.dispatchEvent(
              new KeyboardEvent('keyup', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                shiftKey: true,
                bubbles: true,
                cancelable: true,
              }),
            );
          } catch (eSk) {
            /* ignore */
          }
        }
        await delay(45);
      }
      var seg = lines[li];
      if (seg) {
        try {
          document.execCommand('insertText', false, seg);
        } catch (eIt) {
          /* ignore */
        }
        await delay(25);
      }
    }
  }

  async function waitGeminiRefUploadsComplete(roundId, stepKey, expectedCount) {
    var d1 = Date.now() + REF_UPLOAD_COUNT_DEADLINE_MS;
    while (Date.now() < d1) {
      if (countVisibleGeminiRefPreviewChips() >= expectedCount) break;
      await delay(REF_UPLOAD_POLL_MS);
    }
    var nVisible = countVisibleGeminiRefPreviewChips();
    if (nVisible < expectedCount) {
      appendMainLog(
        roundId,
        stepKey,
        'debug',
        'Step09.debug.refUploadCountTimeout expected=' + expectedCount + ' chips=' + nVisible,
      );
      return { ok: false, code: 'GEMINI_REF_UPLOAD_TIMEOUT', detail: 'preview_chips expected=' + expectedCount + ' visible=' + nVisible };
    }

    var phase2Start = Date.now();
    var sawUploading = false;
    var clearTicks = 0;
    while (Date.now() - phase2Start < REF_UPLOAD_PHASE2_MAX_MS) {
      var uploading = anyGeminiRefPreviewUploading();
      if (uploading) {
        sawUploading = true;
        clearTicks = 0;
      } else {
        clearTicks++;
        if (clearTicks >= REF_UPLOAD_CLEAR_TICKS) {
          if (sawUploading || Date.now() - phase2Start >= REF_UPLOAD_NO_SPINNER_MIN_MS) {
            appendMainLog(
              roundId,
              stepKey,
              'debug',
              'Step09.debug.refUploadsReady chips=' + nVisible + ' sawProgress=' + sawUploading,
            );
            return { ok: true };
          }
        }
      }
      await delay(REF_UPLOAD_POLL_MS);
    }
    appendMainLog(roundId, stepKey, 'debug', 'Step09.debug.refUploadPhase2Timeout sawProgress=' + sawUploading);
    return { ok: false, code: 'GEMINI_REF_UPLOAD_TIMEOUT', detail: 'upload_indicator phase2' };
  }

  /** @param {{ roundId: string, effectivePrompt?: string, images?: string[] }} payload */
  async function runStep09GeminiFillInputAndPasteImages(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step09_gemini_fill_input_and_paste_images';
    var inj = g.__idlinkPicpuckInject;
    if (!inj || typeof inj.dataUrlToBlob !== 'function') {
      return { ok: false, code: 'GEMINI_PAGE_HELPERS_MISSING' };
    }
    var text = typeof payload.effectivePrompt === 'string' ? payload.effectivePrompt : '';
    var images = payload && Array.isArray(payload.images) ? payload.images : [];
    var maxWait = 50;
    var wc = 0;
    while (wc < maxWait) {
      var inputEl =
        doc.querySelector('rich-textarea .ql-editor') ||
        doc.querySelector('[aria-label="为 Gemini 输入提示"]') ||
        doc.querySelector('.ql-editor[contenteditable="true"]');
      if (inputEl && isVisible(inputEl)) {
        inputEl.focus();
        await removeAllGeminiRefPreviewImages(roundId, stepKey);
        try {
          if (document.execCommand) {
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
          }
        } catch (err) {
          /* ignore */
        }
        if (images.length > 0) {
          var re = /(\(参考图片(\d+)\))/g;
          var parts = [];
          var last = 0;
          var m;
          while ((m = re.exec(text)) !== null) {
            if (m.index > last) parts.push({ type: 'text', value: text.slice(last, m.index) });
            parts.push({ type: 'image', index: parseInt(m[2], 10) });
            last = re.lastIndex;
          }
          if (last < text.length) parts.push({ type: 'text', value: text.slice(last) });
          if (parts.length === 0) parts.push({ type: 'text', value: text });
          var pi;
          for (pi = 0; pi < parts.length; pi++) {
            var part = parts[pi];
            if (part.type === 'text' && part.value && document.execCommand) {
              await insertGeminiEditorTextWithSoftLineBreaks(inputEl, part.value);
            }
            if (part.type === 'image' && document.execCommand) {
              document.execCommand('insertText', false, '(参考图片' + part.index + ')');
              await delay(30);
            }
          }
          var dt = new DataTransfer();
          for (var i = 0; i < images.length; i++) {
            var blobG = inj.dataUrlToBlob(images[i]);
            if (blobG) dt.items.add(inj.imageFileFromBlob(blobG, i + 1).file);
          }
          appendMainLog(roundId, stepKey, 'debug', 'Step09.debug.pasteFiles n=' + dt.items.length);
          inputEl.focus();
          try {
            inputEl.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }));
          } catch (e) {
            appendMainLog(roundId, stepKey, 'debug', 'Step09.debug.pasteErr ' + (e && e.message));
          }
          await delay(200);
          var waitR = await waitGeminiRefUploadsComplete(roundId, stepKey, images.length);
          if (!waitR || waitR.ok !== true) {
            return waitR && waitR.code
              ? { ok: false, code: waitR.code, detail: waitR.detail || '' }
              : { ok: false, code: 'GEMINI_REF_UPLOAD_TIMEOUT' };
          }
        } else {
          try {
            if (document.execCommand) {
              document.execCommand('selectAll', false, null);
              document.execCommand('delete', false, null);
            }
          } catch (errClr) {
            /* ignore */
          }
          await insertGeminiEditorTextWithSoftLineBreaks(inputEl, text);
          await delay(120);
        }
        return { ok: true };
      }
      wc++;
      await delay(300);
    }
    return { ok: false, code: 'GEMINI_INPUT_NOT_FOUND' };
  }

  function findGeminiPromptEditor() {
    return (
      doc.querySelector('rich-textarea .ql-editor') ||
      doc.querySelector('[aria-label="为 Gemini 输入提示"]') ||
      doc.querySelector('.ql-editor[contenteditable="true"]')
    );
  }

  /** @param {{ roundId: string }} payload */
  async function runStep11GeminiSubmitEnterIfNeeded(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step11_gemini_submit_enter_if_needed';
    var inputEl = findGeminiPromptEditor();
    if (!inputEl || !isVisible(inputEl)) {
      appendMainLog(roundId, stepKey, 'info', 'Step11.动作失败+未找到输入区');
      return { ok: false, code: 'GEMINI_INPUT_NOT_FOUND' };
    }
    inputEl.focus();
    await delay(80);
    try {
      inputEl.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
      );
      inputEl.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }),
      );
    } catch (e) {
      appendMainLog(roundId, stepKey, 'debug', 'Step11.debug.enterKeyErr ' + (e && e.message));
      return { ok: false, code: 'GEMINI_SEND_FAILED' };
    }
    appendMainLog(roundId, stepKey, 'debug', 'Step11.debug.dispatchedEnter');
    return { ok: true };
  }

  var WAIT_GENERATED_MS = 180000;
  var POLL_MS = 400;
  /** 预览图已加载后至点击「下载完整尺寸」前的固定等待，避免服务端/按钮态未就绪 */
  var GEMINI_DOWNLOAD_POST_LOAD_DELAY_MS = 3000;

  /**
   * 生成结果在 `model-response` 内；用户上传预览在 `user-query`（如 img[data-test-id="uploaded-img"]），
   * 不得与 `generated-image` 混淆。取**文档顺序最后一个**含可见 `generated-image` 的 `model-response`（即本轮新生成块）。
   */
  function findLatestGeminiGeneratedImageHost() {
    var mrs = Array.prototype.slice.call(doc.querySelectorAll('model-response'));
    var i;
    var j;
    for (i = mrs.length - 1; i >= 0; i--) {
      var mr = mrs[i];
      if (!isVisible(mr)) continue;
      var inMr = mr.querySelectorAll('generated-image');
      for (j = inMr.length - 1; j >= 0; j--) {
        var ge = inMr[j];
        if (isVisible(ge)) return ge;
      }
    }
    var all = Array.prototype.slice.call(doc.querySelectorAll('generated-image'));
    for (i = all.length - 1; i >= 0; i--) {
      if (isVisible(all[i]) && !(all[i].closest && all[i].closest('user-query'))) return all[i];
    }
    return null;
  }

  function getGeminiGeneratedPreviewSrcFromHost(ge) {
    if (!ge) return '';
    var img = ge.querySelector('single-image img.image, img.image');
    return img && img.getAttribute ? String(img.getAttribute('src') || '').trim() : '';
  }

  function hasVisibleLoaderInGeneratedHost(ge) {
    if (!ge) return false;
    var img = ge.querySelector('single-image img.image, img.image');
    if (img) {
      if (img.classList && img.classList.contains('loaded')) return false;
      if (img.complete && img.naturalWidth > 0) return false;
    }
    var loader = ge.querySelector('div.loader');
    return !!(loader && isVisible(loader));
  }

  /** 无工作台特征则本 document 非 Gemini 主 UI（如广告 iframe），避免 allFrames 时空转 WAIT_GENERATED_MS */
  function geminiWorkbenchLikelyInThisDocument() {
    try {
      return !!(
        doc.querySelector('rich-textarea .ql-editor') ||
        doc.querySelector('[aria-label="为 Gemini 输入提示"]') ||
        doc.querySelector('input-area-v2') ||
        doc.querySelector('toolbox-drawer') ||
        doc.querySelector('model-response') ||
        doc.querySelector('generated-image')
      );
    } catch (eW) {
      return true;
    }
  }

  /** @param {{ roundId: string }} payload */
  async function runStep12GeminiWaitGeneratedImage(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step12_gemini_wait_generated_image';
    if (!geminiWorkbenchLikelyInThisDocument()) {
      return { ok: false, code: 'GEMINI_STEP12_SKIP_FRAME' };
    }
    var baselineHost = findLatestGeminiGeneratedImageHost();
    var baselineSrc = getGeminiGeneratedPreviewSrcFromHost(baselineHost);
    if (baselineSrc && baselineSrc.indexOf('googleusercontent') !== -1) {
      appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.baselinePrevGen len=' + baselineSrc.length);
    } else {
      appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.baselineNoPrev');
    }
    var deadline = Date.now() + WAIT_GENERATED_MS;
    while (Date.now() < deadline) {
      var latest = findLatestGeminiGeneratedImageHost();
      if (!latest) {
        await delay(POLL_MS);
        continue;
      }
      var img = latest.querySelector('single-image img.image, img.image');
      var src = img && (img.getAttribute('src') || '');
      if (!src || src.indexOf('googleusercontent') === -1) {
        await delay(POLL_MS);
        continue;
      }
      if (baselineSrc && src === baselineSrc) {
        await delay(POLL_MS);
        continue;
      }
      if (hasVisibleLoaderInGeneratedHost(latest)) {
        await delay(POLL_MS);
        continue;
      }
      if (img.classList && img.classList.contains('loaded')) {
        appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.loadedClass');
        return { ok: true };
      }
      if (img.complete && img.naturalWidth > 0) {
        appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.naturalSize');
        return { ok: true };
      }
      var loader = latest.querySelector('div.loader');
      if (!loader && img && src) {
        appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.noLoaderHasSrc');
        return { ok: true };
      }
      await delay(POLL_MS);
    }
    appendMainLog(roundId, stepKey, 'info', 'Step12.动作失败+等待生成图超时');
    return { ok: false, code: 'GEMINI_GENERATED_IMAGE_TIMEOUT' };
  }

  function postGeminiClipboardAbort() {
    try {
      window.postMessage({ picpuckBridge: true, kind: 'GEMINI_FULL_IMAGE_CLIPBOARD_ABORT' }, window.location.origin);
    } catch (eAbort) {
      /* ignore */
    }
  }

  function findGeminiGeneratedPreviewImg() {
    var ge = findLatestGeminiGeneratedImageHost();
    if (!ge) return null;
    return ge.querySelector('single-image img.image, img.image');
  }

  function findGeminiDownloadButtonInLatestHost() {
    var ge = findLatestGeminiGeneratedImageHost();
    if (ge) {
      var b = ge.querySelector('button[data-test-id="download-generated-image-button"]');
      if (b) return b;
    }
    return (
      doc.querySelector('generated-image button[data-test-id="download-generated-image-button"]') ||
      doc.querySelector('button[data-test-id="download-generated-image-button"]')
    );
  }

  /**
   * 整图下载按钮过早点击会报错：须等预览图解码完成后再等待 GEMINI_DOWNLOAD_POST_LOAD_DELAY_MS 再点击。
   * @param {string} roundId
   * @param {string} stepKey
   */
  async function waitGeminiGeneratedPreviewSettledBeforeDownload(roundId, stepKey) {
    var settleDeadline = Date.now() + 30000;
    while (Date.now() < settleDeadline) {
      var img = findGeminiGeneratedPreviewImg();
      if (img) {
        var ready =
          (img.complete && img.naturalWidth > 0) || (img.classList && img.classList.contains('loaded'));
        if (ready) break;
      }
      await delay(POLL_MS);
    }
    var img2 = findGeminiGeneratedPreviewImg();
    if (img2 && typeof img2.decode === 'function') {
      try {
        await img2.decode();
      } catch (eDec) {
        appendMainLog(roundId, stepKey, 'debug', 'Step13.debug.previewDecodeErr ' + (eDec && eDec.message));
      }
    }
    await delay(GEMINI_DOWNLOAD_POST_LOAD_DELAY_MS);
    appendMainLog(roundId, stepKey, 'debug', 'Step13.debug.previewSettledBeforeDownload');
  }

  /**
   * 与内容脚本握手：先挂上 BUFFER 临时监听并 ARM_READY，再 arm/点击，避免 BUFFER 早于监听入队。
   * @param {{ roundId?: string, generationEvent?: Record<string, unknown> }} [relayMeta] 剪贴板成功后回传熔炉页记 GENERATION 事件用
   */
  function waitGeminiClipboardArmReady(relayMeta) {
    return new Promise(function (resolve, reject) {
      var armAckMs = 5000;
      var t = setTimeout(function () {
        window.removeEventListener('message', onAck);
        reject(new Error('GEMINI_CLIPBOARD_ARM_TIMEOUT'));
      }, armAckMs);
      function onAck(ev) {
        if (ev.source !== window) return;
        var d = ev.data;
        if (!d || d.picpuckBridge !== true || d.kind !== 'GEMINI_FULL_IMAGE_CLIPBOARD_ARM_READY') return;
        clearTimeout(t);
        window.removeEventListener('message', onAck);
        resolve();
      }
      window.addEventListener('message', onAck);
      try {
        var rid = relayMeta && relayMeta.roundId ? String(relayMeta.roundId) : '';
        var ge = relayMeta && relayMeta.generationEvent && typeof relayMeta.generationEvent === 'object' ? relayMeta.generationEvent : undefined;
        window.postMessage(
          {
            picpuckBridge: true,
            kind: 'GEMINI_FULL_IMAGE_CLIPBOARD_ARM',
            roundId: rid,
            generationEvent: ge,
          },
          window.location.origin,
        );
      } catch (ePost) {
        clearTimeout(t);
        window.removeEventListener('message', onAck);
        reject(ePost);
      }
    });
  }

  function arrayBufferToBase64(buf) {
    if (!buf || !buf.byteLength) return '';
    var bytes = new Uint8Array(buf);
    var chunk = 8192;
    var binary = '';
    for (var i = 0; i < bytes.length; i += chunk) {
      var sub = bytes.subarray(i, i + chunk);
      binary += String.fromCharCode.apply(null, sub);
    }
    return btoa(binary);
  }

  function findGeminiChatHistoryRoot() {
    return (
      doc.querySelector('[data-test-id="chat-history-container"]') ||
      doc.getElementById('chat-history') ||
      doc.querySelector('.chat-history-scroll-container')
    );
  }

  /**
   * 异步 LAUNCH 提交后：会话 URL（/app/{id}）+ 最后一轮 `conversation-container` 的 id。
   * @param {{ roundId: string, captureTimeoutMs?: number }} payload
   */
  async function runGeminiCaptureAsyncAnchorAfterSubmit(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step12_gemini_async_capture_anchor';
    var timeoutMs =
      payload && typeof payload.captureTimeoutMs === 'number' && payload.captureTimeoutMs > 0
        ? payload.captureTimeoutMs
        : 45000;
    var deadline = Date.now() + timeoutMs;
    var anchorBaselineSet = false;
    var anchorInitialRowCount = 0;
    var anchorInitialLastId = '';
    while (Date.now() < deadline) {
      try {
        var path = location.pathname || '';
        if (path.indexOf('/app/') === 0 && path.length > 5) {
          var hist = findGeminiChatHistoryRoot();
          if (hist) {
            var rows = hist.querySelectorAll('.conversation-container.message-actions-hover-boundary');
            if (rows.length > 0) {
              var last = rows[rows.length - 1];
              var tid = last.id && String(last.id).trim();
              if (tid) {
                if (!anchorBaselineSet) {
                  anchorBaselineSet = true;
                  anchorInitialRowCount = rows.length;
                  anchorInitialLastId = tid;
                }
                var stTurn = geminiTurnDomCompletionState(last);
                var grew = rows.length > anchorInitialRowCount;
                var lastChanged = tid !== anchorInitialLastId;
                var notComplete = stTurn !== 'complete';
                if (!(grew || lastChanged || notComplete)) {
                  await delay(POLL_MS);
                  continue;
                }
                var convUrl = location.origin + path;
                appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.anchor path=' + path + ' turn=' + tid);
                return {
                  ok: true,
                  conversationUrl: convUrl,
                  turnContainerId: tid,
                };
              }
            }
          }
        }
      } catch (e0) {
        appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.anchorErr ' + (e0 && e0.message));
      }
      await delay(POLL_MS);
    }
    appendMainLog(roundId, stepKey, 'info', 'Step12.动作失败+捕获会话锚点超时');
    return { ok: false, code: 'GEMINI_ASYNC_ANCHOR_TIMEOUT' };
  }

  /**
   * 单条 model-response 的完成态（不扫 user-query，避免用户区误报）。
   * @param {Element} mr
   * @returns {'processing'|'complete'|'unknown'}
   */
  function geminiSingleModelResponseCompletionState(mr) {
    if (!mr) return 'unknown';
    var p = mr.querySelector('processing-state');
    if (p && !p.hasAttribute('hidden')) {
      var sec = p.querySelector('section.processing-state_container--processing');
      if (sec && isVisible(sec)) return 'processing';
      var btn = p.querySelector('button.processing-state_button--processing');
      if (btn && isVisible(btn)) return 'processing';
    }
    var loose = mr.querySelector('section.processing-state_container--processing');
    if (loose && isVisible(loose)) return 'processing';
    var footers = mr.querySelectorAll('.response-footer');
    var fi;
    for (fi = 0; fi < footers.length; fi++) {
      var cn = footers[fi].className && String(footers[fi].className);
      if (cn && cn.indexOf('complete') !== -1) return 'complete';
    }
    var mcs = mr.querySelectorAll('message-content[aria-busy]');
    for (var mj = 0; mj < mcs.length; mj++) {
      if (mcs[mj].getAttribute('aria-busy') === 'false') return 'complete';
    }
    return 'unknown';
  }

  /**
   * 一轮 = `.conversation-container`：内含 user-query + 一条或多条 model-response。
   * 整轮 complete 当且仅当「该容器内每一条 model-response」均 complete；任一条 processing → 整轮 processing；
   * 无 model-response 或存在尚未 complete 也非 processing → unknown。
   * @param {Element} root
   * @returns {'processing'|'complete'|'missing'|'unknown'}
   */
  function geminiTurnDomCompletionState(root) {
    if (!root) return 'missing';
    var proc = root.querySelector('processing-state');
    if (proc && !proc.hasAttribute('hidden')) {
      var sec = proc.querySelector('section.processing-state_container--processing');
      if (sec && isVisible(sec)) return 'processing';
      var btn = proc.querySelector('button.processing-state_button--processing');
      if (btn && isVisible(btn)) return 'processing';
    }
    var loose = root.querySelector('section.processing-state_container--processing');
    if (loose && isVisible(loose)) return 'processing';
    var mrs = root.querySelectorAll('model-response');
    if (!mrs.length) return 'unknown';
    var states = [];
    var i;
    for (i = 0; i < mrs.length; i += 1) {
      states.push(geminiSingleModelResponseCompletionState(mrs[i]));
    }
    for (i = 0; i < states.length; i += 1) {
      if (states[i] === 'processing') return 'processing';
    }
    for (i = 0; i < states.length; i += 1) {
      if (states[i] !== 'complete') return 'unknown';
    }
    return 'complete';
  }

  /**
   * @param {{ roundId: string, turnContainerId: string }} payload
   */
  async function runGeminiProbeTurnComplete(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var turnId = payload && payload.turnContainerId ? String(payload.turnContainerId).trim() : '';
    var stepKey = 'step05_gemini_recover_probe';
    if (!turnId) {
      appendMainLog(roundId, stepKey, 'info', 'Step05.动作失败+缺少 turnContainerId');
      return { ok: false, code: 'GEMINI_RECOVER_NO_TURN_ID' };
    }
    var root = doc.getElementById(turnId);
    if (!root) {
      appendMainLog(roundId, stepKey, 'debug', 'Step05.debug.turnNotInDom');
      return { ok: true, outcome: 'not_ready' };
    }
    var st = geminiTurnDomCompletionState(root);
    appendMainLog(roundId, stepKey, 'debug', 'Step05.debug.turnState=' + st);
    if (st === 'complete') return { ok: true, outcome: 'ready' };
    return { ok: true, outcome: 'not_ready' };
  }

  /**
   * @returns {{ el: Element|null, pickIndex: number, total: number }}
   */
  function findGeneratedImageHostInTurnRoot(turnRoot) {
    if (!turnRoot) return { el: null, pickIndex: -1, total: 0 };
    var all = turnRoot.querySelectorAll('generated-image');
    var total = all.length;
    var mrs = turnRoot.querySelectorAll('model-response');
    var mi;
    for (mi = mrs.length - 1; mi >= 0; mi -= 1) {
      var imgs = mrs[mi].querySelectorAll('generated-image');
      var ji;
      for (ji = imgs.length - 1; ji >= 0; ji -= 1) {
        var cand = imgs[ji];
        if (isVisible(cand)) {
          var pickIndex = -1;
          for (var ix = 0; ix < all.length; ix += 1) {
            if (all[ix] === cand) {
              pickIndex = ix;
              break;
            }
          }
          return { el: cand, pickIndex: pickIndex, total: total };
        }
      }
    }
    var i;
    for (i = all.length - 1; i >= 0; i -= 1) {
      if (isVisible(all[i]) && !(all[i].closest && all[i].closest('user-query'))) {
        return { el: all[i], pickIndex: i, total: total };
      }
    }
    return { el: null, pickIndex: -1, total: total };
  }

  /**
   * RECOVER 用：与 Step13 一致只看预览 img，不因 `generated-image` 内残留 `div.loader`（仍占 layout）空转 60s。
   */
  function geminiRecoverGeneratedPreviewImageReady(ge) {
    if (!ge) return false;
    var img = ge.querySelector('single-image img.image, img.image');
    if (!img) return false;
    var ld = img.classList && img.classList.contains('loaded');
    var nw = img.complete && img.naturalWidth > 0;
    return !!(ld || nw);
  }

  /**
   * RELAY 取全图 fetch 前需前台 Tab；与即梦 Step21 同路径：postMessage → CS → SW `focusWorkTab`，再等 `visibilityState===visible`。
   * @param {string} roundId
   * @param {string} stepKey
   */
  async function ensureGeminiWorkTabVisibleForRecoverCollect(roundId, stepKey) {
    if (!document.hidden && document.visibilityState === 'visible') {
      await delay(GEMINI_RECOVER_TAB_VISIBLE_SETTLE_MS);
      appendMainLog(roundId, stepKey, 'info', 'Step05.info.alreadyVisibleSkipActivate');
      return { ok: true };
    }
    try {
      window.postMessage(
        {
          picpuckBridge: true,
          kind: 'GEMINI_REQUEST_ACTIVATE_TAB_FOR_COLLECT',
          roundId: roundId || '',
        },
        location.origin,
      );
    } catch (ePost) {
      /* ignore */
    }
    appendMainLog(
      roundId,
      stepKey,
      'info',
      'Step05.info.requestActivateBeforeCollect hidden=' + (document.hidden ? '1' : '0'),
    );
    var deadline = Date.now() + GEMINI_RECOVER_TAB_ACTIVATE_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      if (!document.hidden && document.visibilityState === 'visible') {
        await delay(GEMINI_RECOVER_TAB_VISIBLE_SETTLE_MS);
        appendMainLog(roundId, stepKey, 'info', 'Step05.info.tabVisibleSettled');
        return { ok: true };
      }
      await delay(100);
    }
    appendMainLog(roundId, stepKey, 'info', 'Step05.动作失败+等待工作Tab置前超时');
    return { ok: false, code: 'GEMINI_RECOVER_TAB_ACTIVATE_TIMEOUT' };
  }

  /**
   * 不走路由剪贴板 ARM：MAIN 独占监听 GEMINI_FULL_IMAGE_BUFFER。
   * @param {{ roundId: string, turnContainerId: string, captureTimeoutMs?: number }} payload
   */
  async function runGeminiRecoverDownloadImageAsBase64(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var turnId = payload && payload.turnContainerId ? String(payload.turnContainerId).trim() : '';
    var stepKey = 'step05_gemini_recover_collect';
    var captureTimeoutMs =
      payload && typeof payload.captureTimeoutMs === 'number' && payload.captureTimeoutMs > 0
        ? payload.captureTimeoutMs
        : 120000;
    if (!turnId) {
      return { ok: false, code: 'GEMINI_RECOVER_NO_TURN_ID' };
    }
    var cap = globalThis.__picpuckFetchCapture;
    if (!cap || typeof cap.arm !== 'function') {
      return { ok: false, code: 'GEMINI_FETCH_CAPTURE_MISSING' };
    }
    var root = doc.getElementById(turnId);
    if (!root) {
      return { ok: false, code: 'GEMINI_RECOVER_TURN_NOT_FOUND' };
    }
    var st0 = geminiTurnDomCompletionState(root);
    if (st0 === 'processing') {
      appendMainLog(roundId, stepKey, 'debug', 'Step05.debug.stillProcessing');
      return { ok: false, code: 'GEMINI_RECOVER_STILL_PROCESSING' };
    }
    var pick = findGeneratedImageHostInTurnRoot(root);
    var ge = pick.el;
    if (!ge) {
      return { ok: false, code: 'GEMINI_RECOVER_NO_GENERATED_IMAGE' };
    }
    var imgWait = Date.now() + 60000;
    while (Date.now() < imgWait) {
      if (geminiRecoverGeneratedPreviewImageReady(ge)) break;
      await delay(POLL_MS);
    }
    var img2 = ge.querySelector('single-image img.image, img.image');
    if (!img2 || !geminiRecoverGeneratedPreviewImageReady(ge)) {
      appendMainLog(roundId, stepKey, 'info', 'Step05.动作失败+预览图未就绪');
      return { ok: false, code: 'GEMINI_RECOVER_PREVIEW_NOT_READY' };
    }
    if (typeof img2.decode === 'function') {
      try {
        await img2.decode();
      } catch (eD) {
        /* ignore */
      }
    }
    await delay(GEMINI_DOWNLOAD_POST_LOAD_DELAY_MS);
    var visRes = await ensureGeminiWorkTabVisibleForRecoverCollect(roundId, stepKey);
    if (!visRes || visRes.ok !== true) {
      return visRes || { ok: false, code: 'GEMINI_RECOVER_TAB_ACTIVATE_TIMEOUT' };
    }
    var btn = ge.querySelector('button[data-test-id="download-generated-image-button"]');
    if (!btn) {
      return { ok: false, code: 'GEMINI_DOWNLOAD_BUTTON_NOT_FOUND' };
    }
    var bufPromise = new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        window.removeEventListener('message', onBuf);
        try {
          cap.disarm();
        } catch (e1) {
          /* ignore */
        }
        reject(new Error('GEMINI_RECOVER_CAPTURE_TIMEOUT'));
      }, captureTimeoutMs);
      function onBuf(ev) {
        if (ev.source !== window) return;
        var d = ev.data;
        if (!d || d.picpuckBridge !== true || d.kind !== 'GEMINI_FULL_IMAGE_BUFFER') return;
        clearTimeout(t);
        window.removeEventListener('message', onBuf);
        var b = d._buffer;
        if (!(b instanceof ArrayBuffer)) {
          reject(new Error('GEMINI_RECOVER_BAD_BUFFER'));
          return;
        }
        var ct = typeof d.contentType === 'string' && d.contentType ? d.contentType.split(';')[0].trim() : 'image/png';
        resolve({ buf: b, ct: ct });
      }
      window.addEventListener('message', onBuf);
    });
    var hb = setInterval(function () {
      appendMainLog(roundId, stepKey, 'debug', 'Step05.debug.awaitingFullImageFetch');
    }, 12000);
    cap.arm({
      minByteLength: 1048576,
      mimePrefix: 'image/',
    });
    btn.click();
    try {
      var got = await bufPromise;
      var b64 = arrayBufferToBase64(got.buf);
      if (!b64) {
        cap.disarm();
        return { ok: false, code: 'GEMINI_RECOVER_EMPTY_IMAGE' };
      }
      appendMainLog(roundId, stepKey, 'debug', 'Step05.debug.capturedBytes=' + got.buf.byteLength);
      return { ok: true, images: [{ imageBase64: b64, contentType: got.ct }] };
    } catch (e2) {
      try {
        cap.disarm();
      } catch (e3) {
        /* ignore */
      }
      var msg = e2 && e2.message ? String(e2.message) : String(e2);
      return { ok: false, code: 'GEMINI_RECOVER_CAPTURE_FAILED', detail: msg };
    } finally {
      clearInterval(hb);
    }
  }

  /**
   * document load 后 1s 首次检测；未 complete 则每 5s 再测。就绪后 postMessage → 扩展触发 PROBE→RELAY（对齐即梦 JimengRecoverWatch）。
   * @param {{ roundId?: string, async_job_id?: string, forgeCallerTabId?: number, recoverPayload?: object }} packed
   */
  function startGeminiRecoverPageWatcher(packed) {
    var prevStop = g.__picpuckGeminiRecoverWatcherStop;
    if (typeof prevStop === 'function') {
      try {
        prevStop();
      } catch (ePrev) {
        /* ignore */
      }
    }
    var stopped = false;
    g.__picpuckGeminiRecoverWatcherStop = function () {
      stopped = true;
    };
    var rp = packed && packed.recoverPayload;
    var turnId =
      rp && typeof rp.geminiTurnContainerId === 'string' ? String(rp.geminiTurnContainerId).trim() : '';
    var roundId = packed && packed.roundId ? String(packed.roundId) : '';
    var asyncJob = packed && packed.async_job_id ? String(packed.async_job_id) : '';
    var forgeTab = packed && typeof packed.forgeCallerTabId === 'number' ? packed.forgeCallerTabId : 0;

    (async function watcherMain() {
      async function waitDomSettledPlus1s() {
        if (document.readyState !== 'complete') {
          await new Promise(function (resolve) {
            window.addEventListener('load', resolve, { once: true });
          });
        }
        await delay(1000);
      }

      await waitDomSettledPlus1s();

      var tick = 0;
      while (!stopped) {
        tick += 1;
        var root = turnId ? doc.getElementById(turnId) : null;
        var st = geminiTurnDomCompletionState(root);
        try {
          console.log(
            '[PicPuck][GeminiRecoverWatch]',
            JSON.stringify({
              tick: tick,
              async_job_id: asyncJob,
              turnState: st,
              turnInDom: !!root,
            }),
          );
        } catch (eStr) {
          /* ignore */
        }

        if (stopped) break;

        if (st === 'complete' && forgeTab > 0) {
          var basePayload = rp && typeof rp === 'object' ? rp : {};
          var mergedPayload = {};
          var k;
          for (k in basePayload) {
            if (Object.prototype.hasOwnProperty.call(basePayload, k)) {
              mergedPayload[k] = basePayload[k];
            }
          }
          try {
            window.postMessage(
              {
                picpuckBridge: true,
                kind: 'GEMINI_PAGE_RECOVER_READY',
                forgeCallerTabId: forgeTab,
                recoverPayload: mergedPayload,
              },
              location.origin,
            );
          } catch (ePm) {
            /* ignore */
          }
          appendMainLog(roundId, 'system', 'info', 'GeminiRecoverWatch.firedRecover async_job_id=' + asyncJob);
          stopped = true;
          break;
        }

        if (forgeTab <= 0 && tick >= GEMINI_WATCH_MAX_TICKS_NO_FORGE) {
          appendMainLog(
            roundId,
            'system',
            'info',
            'GeminiRecoverWatch.stopped_no_forgeCallerTabId ticks=' + tick,
          );
          stopped = true;
          break;
        }

        await delay(GEMINI_WATCH_POLL_MS);
      }
    })();
  }

  /** @param {{ roundId: string, captureTimeoutMs?: number }} payload */
  async function runStep13GeminiDownloadFullImageToClipboard(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step13_gemini_download_full_image_to_clipboard';
    var cap = globalThis.__picpuckFetchCapture;
    if (!cap || typeof cap.arm !== 'function') {
      appendMainLog(roundId, stepKey, 'info', 'Step13.动作失败+捕获模块未就绪');
      return { ok: false, code: 'GEMINI_FETCH_CAPTURE_MISSING' };
    }
    try {
      await waitGeminiClipboardArmReady({
        roundId: roundId,
        generationEvent: payload && payload.generationEvent ? payload.generationEvent : undefined,
      });
    } catch (eArm) {
      var armMsg = eArm && eArm.message ? String(eArm.message) : String(eArm);
      postGeminiClipboardAbort();
      if (armMsg.indexOf('GEMINI_CLIPBOARD_ARM_TIMEOUT') !== -1) {
        return { ok: false, code: 'GEMINI_CLIPBOARD_ARM_TIMEOUT', detail: armMsg };
      }
      return { ok: false, code: 'GEMINI_CLIPBOARD_FAILED', detail: armMsg };
    }
    var captureTimeoutMs =
      payload && typeof payload.captureTimeoutMs === 'number' && payload.captureTimeoutMs > 0 ? payload.captureTimeoutMs : 120000;
    var btn = findGeminiDownloadButtonInLatestHost();
    if (!btn) {
      postGeminiClipboardAbort();
      appendMainLog(roundId, stepKey, 'info', 'Step13.动作失败+未找到下载按钮');
      return { ok: false, code: 'GEMINI_DOWNLOAD_BUTTON_NOT_FOUND' };
    }
    await waitGeminiGeneratedPreviewSettledBeforeDownload(roundId, stepKey);
    btn = findGeminiDownloadButtonInLatestHost();
    if (!btn) {
      postGeminiClipboardAbort();
      appendMainLog(roundId, stepKey, 'info', 'Step13.动作失败+预览就绪后未找到下载按钮');
      return { ok: false, code: 'GEMINI_DOWNLOAD_BUTTON_NOT_FOUND' };
    }
    var p = new Promise(function (resolve, reject) {
      var t = setTimeout(function () {
        window.removeEventListener('message', onDone);
        cap.disarm();
        postGeminiClipboardAbort();
        reject(new Error('GEMINI_FULL_IMAGE_CAPTURE_TIMEOUT'));
      }, captureTimeoutMs);
      function onDone(ev) {
        if (ev.source !== window) return;
        var d = ev.data;
        if (!d || d.picpuckBridge !== true || d.kind !== 'GEMINI_FULL_IMAGE_CLIPBOARD_DONE') return;
        clearTimeout(t);
        window.removeEventListener('message', onDone);
        if (d.ok) resolve(true);
        else reject(new Error(d.error || 'GEMINI_CLIPBOARD_FAILED'));
      }
      window.addEventListener('message', onDone);
    });
    cap.arm({
      minByteLength: 1048576,
      mimePrefix: 'image/',
    });
    btn.click();
    try {
      await p;
      appendMainLog(roundId, stepKey, 'debug', 'Step13.debug.clipboardDone');
      return { ok: true };
    } catch (e) {
      var msg = e && e.message ? String(e.message) : String(e);
      cap.disarm();
      postGeminiClipboardAbort();
      if (msg.indexOf('GEMINI_FULL_IMAGE_CAPTURE_TIMEOUT') !== -1) {
        return { ok: false, code: 'GEMINI_FULL_IMAGE_CAPTURE_TIMEOUT', detail: msg };
      }
      if (msg.indexOf('GEMINI_CLIPBOARD_TAB_FOCUS_TIMEOUT') !== -1) {
        return { ok: false, code: 'GEMINI_CLIPBOARD_TAB_FOCUS_TIMEOUT', detail: msg };
      }
      if (msg.indexOf('GEMINI_CLIPBOARD_TAB_FOCUS_UNAVAILABLE') !== -1) {
        return { ok: false, code: 'GEMINI_CLIPBOARD_TAB_FOCUS_UNAVAILABLE', detail: msg };
      }
      return { ok: false, code: 'GEMINI_CLIPBOARD_FAILED', detail: msg };
    }
  }

  g.__picpuckGeminiImage = {
    startGeminiRecoverPageWatcher: startGeminiRecoverPageWatcher,
    runStep06GeminiEnsureMakeImageEntry: runStep06GeminiEnsureMakeImageEntry,
    runStep08GeminiEnsureBardMode: runStep08GeminiEnsureBardMode,
    runStep09GeminiFillInputAndPasteImages: runStep09GeminiFillInputAndPasteImages,
    runStep11GeminiSubmitEnterIfNeeded: runStep11GeminiSubmitEnterIfNeeded,
    runStep12GeminiWaitGeneratedImage: runStep12GeminiWaitGeneratedImage,
    runGeminiCaptureAsyncAnchorAfterSubmit: runGeminiCaptureAsyncAnchorAfterSubmit,
    runGeminiProbeTurnComplete: runGeminiProbeTurnComplete,
    runGeminiRecoverDownloadImageAsBase64: runGeminiRecoverDownloadImageAsBase64,
    runStep13GeminiDownloadFullImageToClipboard: runStep13GeminiDownloadFullImageToClipboard,
  };
})();
