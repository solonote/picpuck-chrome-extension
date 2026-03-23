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

  /** @param {{ roundId: string }} payload */
  async function runStep12GeminiWaitGeneratedImage(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step12_gemini_wait_generated_image';
    var deadline = Date.now() + WAIT_GENERATED_MS;
    while (Date.now() < deadline) {
      var ge = doc.querySelector('generated-image');
      if (ge) {
        var img = ge.querySelector('single-image img.image, img.image');
        var src = img && (img.getAttribute('src') || '');
        if (src && src.indexOf('googleusercontent') !== -1) {
          if (img.classList && img.classList.contains('loaded')) {
            appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.loadedClass');
            return { ok: true };
          }
          if (img.complete && img.naturalWidth > 0) {
            appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.naturalSize');
            return { ok: true };
          }
        }
        var loader = ge.querySelector('div.loader');
        if (!loader && img && src) {
          appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.noLoaderHasSrc');
          return { ok: true };
        }
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

  /** 与内容脚本握手：先挂上 BUFFER 临时监听并 ARM_READY，再 arm/点击，避免 BUFFER 早于监听入队 */
  function waitGeminiClipboardArmReady() {
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
        window.postMessage({ picpuckBridge: true, kind: 'GEMINI_FULL_IMAGE_CLIPBOARD_ARM' }, window.location.origin);
      } catch (ePost) {
        clearTimeout(t);
        window.removeEventListener('message', onAck);
        reject(ePost);
      }
    });
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
      await waitGeminiClipboardArmReady();
    } catch (eArm) {
      var armMsg = eArm && eArm.message ? String(eArm.message) : String(eArm);
      postGeminiClipboardAbort();
      if (armMsg.indexOf('GEMINI_CLIPBOARD_ARM_TIMEOUT') !== -1) {
        return { ok: false, code: 'GEMINI_CLIPBOARD_ARM_TIMEOUT' };
      }
      return { ok: false, code: 'GEMINI_CLIPBOARD_FAILED' };
    }
    var captureTimeoutMs =
      payload && typeof payload.captureTimeoutMs === 'number' && payload.captureTimeoutMs > 0 ? payload.captureTimeoutMs : 120000;
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
      urlPrefix: 'https://lh3.googleusercontent.com/rd-gg-dl/',
      mimePrefix: 'image/',
    });
    var btn =
      doc.querySelector('generated-image button[data-test-id="download-generated-image-button"]') ||
      doc.querySelector('button[data-test-id="download-generated-image-button"]');
    if (!btn) {
      cap.disarm();
      postGeminiClipboardAbort();
      appendMainLog(roundId, stepKey, 'info', 'Step13.动作失败+未找到下载按钮');
      return { ok: false, code: 'GEMINI_DOWNLOAD_BUTTON_NOT_FOUND' };
    }
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
        return { ok: false, code: 'GEMINI_FULL_IMAGE_CAPTURE_TIMEOUT' };
      }
      return { ok: false, code: 'GEMINI_CLIPBOARD_FAILED' };
    }
  }

  g.__picpuckGeminiImage = {
    runStep06GeminiEnsureMakeImageEntry: runStep06GeminiEnsureMakeImageEntry,
    runStep08GeminiEnsureBardMode: runStep08GeminiEnsureBardMode,
    runStep09GeminiFillInputAndPasteImages: runStep09GeminiFillInputAndPasteImages,
    runStep11GeminiSubmitEnterIfNeeded: runStep11GeminiSubmitEnterIfNeeded,
    runStep12GeminiWaitGeneratedImage: runStep12GeminiWaitGeneratedImage,
    runStep13GeminiDownloadFullImageToClipboard: runStep13GeminiDownloadFullImageToClipboard,
  };
})();
