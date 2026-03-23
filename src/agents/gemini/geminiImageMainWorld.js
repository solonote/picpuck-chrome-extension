/**
 * Gemini 图片生成：MAIN 世界脚本（设计 §5 / §3.1.1 类比即梦）。
 * 语义对齐旧版 `runGeminiGenerateImage`，不含顶栏 Banner、三连击日志等 R6 排除项。
 */
(function () {
  var g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (g.__picpuckGeminiImage) return;

  var doc = document;
  var STEP_DELAY_MS = 600;

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
          items[i].querySelector('button');
        if (btn) return btn;
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
    while (wc < maxWait) {
      var toolBtn = findToolButton();
      if (clickWhenVisible(function () {
        return toolBtn;
      })) {
        appendMainLog(roundId, stepKey, 'debug', 'Step06.debug.clickedTool');
        await delay(STEP_DELAY_MS);
        break;
      }
      wc++;
      await delay(300);
    }
    if (wc >= maxWait) {
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
              document.execCommand('insertText', false, part.value);
            }
            if (part.type === 'image' && document.execCommand) {
              document.execCommand('insertText', false, '(参考图片' + part.index + ')');
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
          await delay(150);
        } else {
          try {
            if (document.execCommand) {
              document.execCommand('selectAll', false, null);
              document.execCommand('insertText', false, text);
            }
            if (inputEl.textContent !== text && inputEl.innerText !== text) {
              inputEl.textContent = text;
              inputEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
          } catch (err2) {
            /* ignore */
          }
          await delay(150);
        }
        return { ok: true };
      }
      wc++;
      await delay(300);
    }
    return { ok: false, code: 'GEMINI_INPUT_NOT_FOUND' };
  }

  /** @param {{ roundId: string }} payload */
  async function runStep11GeminiClickSendIfNeeded(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step11_gemini_click_send_if_needed';
    var maxWait = 50;
    var wc = 0;
    while (wc < maxWait) {
      var sendBtn =
        doc.querySelector('button.send-button[aria-label="发送"]') ||
        doc.querySelector('button[aria-label="发送"]') ||
        (function () {
          var icon = doc.querySelector('mat-icon[data-mat-icon-name="send"]');
          return icon && icon.closest ? icon.closest('button') : null;
        })();
      if (clickWhenVisible(function () {
        return sendBtn;
      })) {
        appendMainLog(roundId, stepKey, 'debug', 'Step11.debug.clickedSend');
        return { ok: true };
      }
      wc++;
      await delay(300);
    }
    return { ok: false, code: 'GEMINI_SEND_FAILED' };
  }

  g.__picpuckGeminiImage = {
    runStep06GeminiEnsureMakeImageEntry: runStep06GeminiEnsureMakeImageEntry,
    runStep08GeminiEnsureBardMode: runStep08GeminiEnsureBardMode,
    runStep09GeminiFillInputAndPasteImages: runStep09GeminiFillInputAndPasteImages,
    runStep11GeminiClickSendIfNeeded: runStep11GeminiClickSendIfNeeded,
  };
})();
