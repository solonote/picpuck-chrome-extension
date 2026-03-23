/**
 * 即梦图片生成：MAIN 世界业务脚本（设计 §3.1.1）。
 * 由 SW `executeScript` `files` 注入；通过 `postMessage` 写日志（§3.2）。
 * 源语义对齐旧版 `runJimengGenerateImage`（不含 Banner / 三连击日志，R6 排除）。
 */
(function () {
  var g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (g.__picpuckJimengImage) return;

  var doc = document;
  var DELAY_OPEN = 1000;
  var DELAY_AFTER_OPTION = 600;

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

  function findJimengPromptField() {
    var list = doc.querySelectorAll('[class*="prompt-editor-container"] .tiptap.ProseMirror[contenteditable="true"]');
    var i;
    var el;
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (!el || !el.offsetParent) continue;
      if (el.closest && el.closest('[class*="prompt-editor-sizer"]')) continue;
      return el;
    }
    var pm = doc.querySelectorAll('.tiptap.ProseMirror[contenteditable="true"][role="textbox"]');
    for (i = 0; i < pm.length; i++) {
      el = pm[i];
      if (!el || !el.offsetParent) continue;
      if (el.closest && el.closest('[class*="prompt-editor-sizer"]')) continue;
      return el;
    }
    var ta = doc.querySelector('textarea[class*="lv-textarea"], textarea[placeholder*="描述"], [class*="prompt-container"] textarea');
    if (ta && ta.offsetParent) return ta;
    return null;
  }

  function hasForm() {
    var pe = findJimengPromptField();
    var anySelect = doc.querySelector('[class*="lv-select-view"]') || doc.querySelector('[class*="lv-select"]');
    return !!(pe && anySelect);
  }

  function hasOpenPopover() {
    var popup = doc.querySelector('div[class*="lv-select-popup"], div[class*="lv-popover-content"]');
    return !!(popup && popup.offsetParent);
  }

  function findJimengGeneratorToolbar() {
    var pec = doc.querySelector('[class*="prompt-editor-container"]');
    var parent = pec && pec.parentElement;
    if (parent) {
      var ch = parent.children;
      for (var i = 0; i < ch.length; i++) {
        var c = ch[i];
        var cls = (c.className && String(c.className)) || '';
        if (!/\btoolbar-/i.test(cls)) continue;
        var ls = c.querySelector('[class*="lv-select"]');
        if (ls && ls.offsetParent) return c;
      }
    }
    var all = doc.querySelectorAll('[class*="toolbar"]');
    var best = null;
    var bestCount = 0;
    for (var j = 0; j < all.length; j++) {
      var t = all[j];
      var ls0 = t.querySelector('[class*="lv-select"]');
      if (!ls0 || !ls0.offsetParent) continue;
      var n = t.querySelectorAll('[class*="lv-select"]').length;
      if (n > bestCount) {
        bestCount = n;
        best = t;
      }
    }
    return best;
  }

  function findTypeSelect() {
    var toolbar = findJimengGeneratorToolbar();
    if (!toolbar) return null;
    var el =
      toolbar.querySelector('[class*="type-select"]') ||
      toolbar.querySelector('[class*="toolbar-select"]') ||
      toolbar.querySelector('[class*="lv-select"]');
    return el && el.offsetParent ? el : null;
  }

  function findSelectByValueText(text) {
    var selects = doc.querySelectorAll('[class*="lv-select"]');
    for (var i = 0; i < selects.length; i++) {
      var val = selects[i].querySelector('[class*="lv-select-view-value"]');
      var t = (val && val.textContent && val.textContent.trim()) || '';
      if (t && t.indexOf(text) !== -1) return selects[i];
    }
    return null;
  }

  function getCurrentMode() {
    var sel = findTypeSelect();
    if (!sel) return '';
    var val = sel.querySelector('[class*="lv-select-view-value"]');
    return (val && val.textContent && val.textContent.trim()) || '';
  }

  function getCurrentModel(wantModelLabel) {
    var want = wantModelLabel || '图片5.0 Lite';
    var sel = findSelectByValueText('图片5.0') || findSelectByValueText('图片4.') || findSelectByValueText(want);
    if (!sel) return '';
    var val = sel.querySelector('[class*="lv-select-view-value"]');
    return (val && val.textContent && val.textContent.trim()) || '';
  }

  function getCurrentParams() {
    var btn = findByText(doc.body, '16:9', 'button') || findByText(doc.body, '9:16', 'button') || doc.querySelector('[class*="button-text-lDBpQJ"]');
    if (!btn) return { ratio: '', resolution: '' };
    if (btn.classList && btn.classList.contains && !btn.classList.contains('lv-btn')) btn = btn.closest ? btn.closest('button') : btn.parentElement;
    if (!btn) return { ratio: '', resolution: '' };
    var t = (btn.textContent && btn.textContent.trim()) || '';
    var resEl = btn.querySelector && btn.querySelector('[class*="commercial-content"]');
    var res = (resEl && resEl.textContent && resEl.textContent.trim()) || '';
    return { ratio: t, resolution: res };
  }

  function findFormAndOpen() {
    var container = doc.getElementById('AIGeneratedRecord');
    if (container) {
      var badge = container.querySelector('[class*="badge"]');
      if (badge) badge.click();
      else {
        var first = findByText(container, '1');
        if (first) first.click();
        else container.click();
      }
    }
    var ta = doc.querySelector('textarea[class*="lv-textarea"], [class*="prompt-container"] textarea');
    if (ta) ta.click();
    var pe = findJimengPromptField();
    if (pe && pe.click) pe.click();
  }

  function clickImageGenerationCard() {
    var nodes = doc.querySelectorAll('div, section, a, button, [role="button"]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!el.offsetParent) continue;
      var t = (el.textContent && el.textContent.trim()) || '';
      if (t.indexOf('图片生成') === -1) continue;
      if (t.indexOf('智能美学') !== -1 || (el.querySelector && el.querySelector('[class*="card"]'))) {
        var clickable = el;
        if (el.tagName !== 'A' && el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') {
          clickable = el.closest ? el.closest('a, button, [role="button"]') : null;
          if (!clickable) clickable = el;
        }
        if (clickable && clickable.click) {
          clickable.click();
          return true;
        }
      }
    }
    var cardByText = findByText(doc.body, '图片生成', 'div');
    if (cardByText) {
      var parent = cardByText.closest ? cardByText.closest('a, button, [role="button"], [class*="card"]') : cardByText.parentElement;
      if (parent && parent.click) {
        parent.click();
        return true;
      }
      if (cardByText.click) {
        cardByText.click();
        return true;
      }
    }
    return false;
  }

  function clickJimengHomeInspiration() {
    var el = doc.getElementById('Home');
    if (!el || !el.offsetParent) return false;
    if (el.getAttribute && el.getAttribute('role') !== 'menuitem') return false;
    try {
      el.click();
      return true;
    } catch (eh) {
      return false;
    }
  }

  function closePopover() {
    var paramBtn = findByText(doc.body, '16:9', 'button') || doc.querySelector('button[class*="toolbar-button"]');
    if (paramBtn && paramBtn.closest && paramBtn.closest('button')) paramBtn = paramBtn.closest('button');
    else if (paramBtn && paramBtn.tagName !== 'BUTTON' && paramBtn.parentElement && paramBtn.parentElement.tagName === 'BUTTON')
      paramBtn = paramBtn.parentElement;
    if (paramBtn && paramBtn.offsetParent && paramBtn.click) {
      paramBtn.click();
      return;
    }
    var ta = findJimengPromptField();
    if (ta && ta.offsetParent) {
      ta.focus();
      if (ta.click) ta.click();
      return;
    }
    var ph = doc.querySelector('[class*="empty-placeholder"]');
    if (ph) {
      ph.click();
      return;
    }
    var overlay = doc.querySelector('[class*="lv-overlay"], [class*="overlay"], [class*="popover-backdrop"], [class*="select-overlay"], [class*="mask"]');
    if (overlay && overlay.offsetParent) {
      overlay.click();
      return;
    }
    var popup = doc.querySelector('div[class*="lv-select-popup"], div[class*="lv-popover-content"]');
    if (popup && popup.offsetParent) {
      var ev = new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true });
      popup.dispatchEvent(ev);
      doc.documentElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    }
    doc.body.click();
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

  function getVisiblePopups() {
    var list = doc.querySelectorAll('div[class*="lv-select-popup"], div[class*="lv-popover-content"], [role="listbox"]');
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].offsetParent) out.push(list[i]);
    }
    return out;
  }

  function getClickableOption(el) {
    if (!el || !el.closest) return el;
    var label = el.closest('label[class*="lv-radio"], label.lv-radio');
    return label || el;
  }

  function findOptionInPopup(text) {
    var popups = getVisiblePopups();
    for (var p = 0; p < popups.length; p++) {
      var popup = popups[p];
      var labels = popup.querySelectorAll('label.lv-radio, label[class*="lv-radio"]');
      for (var L = 0; L < labels.length; L++) {
        var lab = labels[L];
        if (!lab.offsetParent) continue;
        var tl = (lab.textContent && lab.textContent.trim()) || '';
        if (tl.indexOf(text) !== -1) return lab;
      }
      var options = popup.querySelectorAll('li.lv-select-option, li[role="option"]');
      for (var j = 0; j < options.length; j++) {
        var el = options[j];
        if (!el.offsetParent) continue;
        var txt = (el.textContent && el.textContent.trim()) || '';
        if (txt.indexOf(text) !== -1) return el;
      }
      options = popup.querySelectorAll('[role="option"]');
      for (var k = 0; k < options.length; k++) {
        var node = options[k];
        if (!node.offsetParent) continue;
        var t = (node.textContent && node.textContent.trim()) || '';
        if (t.indexOf(text) !== -1) return node;
      }
      var fallback = popup.querySelectorAll(
        '[class*="select-option"], [class*="option-label"], [class*="label-l6Zq3t"], [class*="resolution-commercial-option"], div, span',
      );
      for (var m = 0; m < fallback.length; m++) {
        if (!fallback[m].offsetParent) continue;
        var s = (fallback[m].textContent && fallback[m].textContent.trim()) || '';
        if (s.indexOf(text) !== -1) return getClickableOption(fallback[m]);
      }
    }
    return null;
  }

  function clickOptionWhenVisible(text) {
    return clickWhenVisible(function () {
      return findOptionInPopup(text);
    });
  }

  /** @param {{ roundId: string }} payload */
  async function runStep07EnsureWorkbenchReady(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step07_jimeng_ensure_workbench_ready';
    var step0Max = 8;
    var step0Retries = 0;
    while (!hasForm()) {
      if (step0Retries >= step0Max) {
        appendMainLog(roundId, stepKey, 'debug', 'Step07.debug.workbenchMaxRetries=' + step0Max);
        return { ok: false, code: 'JIMENG_WORKBENCH_NOT_READY' };
      }
      step0Retries++;
      var clicked = clickImageGenerationCard();
      appendMainLog(roundId, stepKey, 'debug', 'Step07.debug.retry=' + step0Retries + ' clickCard=' + clicked);
      if (clicked) {
        await delay(2500);
        continue;
      }
      findFormAndOpen();
      if (step0Retries === 3 || step0Retries === 6) {
        var homeOk = clickJimengHomeInspiration();
        appendMainLog(roundId, stepKey, 'debug', 'Step07.debug.clickHome=' + homeOk + ' retry=' + step0Retries);
      }
      var waitAfter = step0Retries === 3 || step0Retries === 6 ? 2200 : 1000;
      await delay(waitAfter);
    }
    return { ok: true };
  }

  /** @param {{ roundId: string }} payload */
  async function runStep08CloseOpenPopovers(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step08_jimeng_close_open_popovers';
    var step2CloseMax = 30;
    var retries = 0;
    while (hasOpenPopover()) {
      retries++;
      if (retries > step2CloseMax) {
        appendMainLog(roundId, stepKey, 'debug', 'Step08.debug.popoverCloseMax=' + step2CloseMax);
        break;
      }
      closePopover();
      await delay(500);
    }
    return { ok: true };
  }

  /** @param {{ roundId: string }} payload */
  async function runStep09EnsureModeImageGeneration(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step09_jimeng_ensure_mode_image_generation';
    var step34Max = 3;
    var modeRetries = 0;
    while (true) {
      var mode = getCurrentMode();
      if (mode.indexOf('图片生成') !== -1) {
        return { ok: true };
      }
      var typeClicked = clickWhenVisible(findTypeSelect);
      appendMainLog(roundId, stepKey, 'debug', 'Step09.debug.clickTypeSelect=' + typeClicked);
      await delay(DELAY_OPEN);
      var optionClicked = clickOptionWhenVisible('图片生成');
      appendMainLog(roundId, stepKey, 'debug', 'Step09.debug.clickOption图片生成=' + optionClicked);
      await delay(DELAY_AFTER_OPTION);
      var modeNow = getCurrentMode();
      var typeOk = modeNow.indexOf('图片生成') !== -1;
      if (typeOk) {
        return { ok: true };
      }
      modeRetries++;
      if (modeRetries >= step34Max) {
        appendMainLog(roundId, stepKey, 'debug', 'Step09.debug.modeRetryExceeded=' + modeRetries);
        return { ok: false, code: 'JIMENG_MODE_OR_PARAM_FAILED' };
      }
      await delay(600);
    }
  }

  /** @param {{ roundId: string, modelLabel?: string }} payload */
  async function runStep10EnsureModel(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step10_jimeng_ensure_model';
    var wantModel =
      payload && payload.modelLabel && String(payload.modelLabel).trim() ? String(payload.modelLabel).trim() : '图片5.0 Lite';
    var cur = getCurrentModel(wantModel);
    appendMainLog(roundId, stepKey, 'debug', 'Step10.debug.currentModel=' + cur + ' want=' + wantModel);
    if (cur.indexOf(wantModel) !== -1 || !wantModel) {
      return { ok: true };
    }
    var modelSelect = findSelectByValueText('图片5.0') || findSelectByValueText('图片4.') || findSelectByValueText(wantModel);
    var modelClicked = clickWhenVisible(function () {
      return modelSelect;
    });
    appendMainLog(roundId, stepKey, 'debug', 'Step10.debug.openModelSelect=' + modelClicked);
    if (!modelClicked) {
      return { ok: false, code: 'JIMENG_MODE_OR_PARAM_FAILED' };
    }
    await delay(DELAY_OPEN);
    var modelOptionClicked = clickOptionWhenVisible(wantModel);
    appendMainLog(roundId, stepKey, 'debug', 'Step10.debug.clickModelOption=' + modelOptionClicked);
    await delay(DELAY_AFTER_OPTION);
    await delay(500);
    return { ok: true };
  }

  /** @param {{ roundId: string, ratioLabel?: string, resolutionLabel?: string }} payload */
  async function runStep11EnsureRatioResolution(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step11_jimeng_ensure_ratio_resolution';
    var wantRatio = payload && payload.ratioLabel && String(payload.ratioLabel).trim() ? String(payload.ratioLabel).trim() : '16:9';
    var wantRes =
      payload && payload.resolutionLabel && String(payload.resolutionLabel).trim()
        ? String(payload.resolutionLabel).trim()
        : '超清 4K';
    var params = getCurrentParams();
    var needRatio = wantRatio && params.ratio.indexOf(wantRatio) === -1;
    var needRes = wantRes && params.resolution.indexOf(wantRes) === -1;
    appendMainLog(roundId, stepKey, 'debug', 'Step11.debug.params=' + JSON.stringify(params) + ' needRatio=' + needRatio + ' needRes=' + needRes);
    if (!needRatio && !needRes) {
      return { ok: true };
    }
    var paramBtn = findByText(doc.body, '16:9', 'button') || doc.querySelector('[class*="button-text-lDBpQJ"]');
    if (paramBtn && paramBtn.closest && paramBtn.closest('button')) paramBtn = paramBtn.closest('button');
    else if (paramBtn && paramBtn.parentElement && paramBtn.parentElement.tagName === 'BUTTON') paramBtn = paramBtn.parentElement;
    var paramClicked = clickWhenVisible(function () {
      return paramBtn;
    });
    if (!paramClicked) {
      return { ok: false, code: 'JIMENG_MODE_OR_PARAM_FAILED' };
    }
    await delay(DELAY_OPEN);
    if (needRatio) {
      var ratioClicked = clickOptionWhenVisible(wantRatio);
      appendMainLog(roundId, stepKey, 'debug', 'Step11.debug.ratioClicked=' + ratioClicked);
      await delay(DELAY_AFTER_OPTION);
    }
    if (needRes) {
      var resClicked = clickOptionWhenVisible(wantRes);
      appendMainLog(roundId, stepKey, 'debug', 'Step11.debug.resClicked=' + resClicked);
      await delay(DELAY_AFTER_OPTION);
    }
    closePopover();
    await delay(500);
    return { ok: true };
  }

  function clearEditorHardOnTarget(target) {
    var isTa0 = target.tagName === 'TEXTAREA';
    if (isTa0) {
      target.value = '';
    } else {
      try {
        target.focus();
        if (doc.execCommand) {
          doc.execCommand('selectAll', false, null);
          doc.execCommand('delete', false, null);
        }
      } catch (ec) {
        /* ignore */
      }
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
    var pin0 = doc.querySelector('input[class*="prompt-input"]');
    if (pin0) {
      pin0.value = '';
      pin0.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function insertPlainOnTarget(target, plain) {
    var isTa = target.tagName === 'TEXTAREA';
    var s = typeof plain === 'string' ? plain : '';
    if (isTa) {
      target.value = s;
      return;
    }
    if (!s) return;
    target.focus();
    var inserted = false;
    try {
      inserted = doc.execCommand('insertText', false, s);
    } catch (ei) {
      /* ignore */
    }
    if (!inserted) {
      try {
        var dtT = new DataTransfer();
        dtT.setData('text/plain', s);
        target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dtT }));
      } catch (ep) {
        /* ignore */
      }
    }
  }

  function pickNextJimengRefRemoveButton() {
    var candidates = doc.querySelectorAll('[class*="remove-button"]');
    var i;
    var c;
    var r;
    for (i = 0; i < candidates.length; i++) {
      c = candidates[i];
      r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return c;
    }
    return candidates.length ? candidates[0] : null;
  }

  function selectTextInElement(rootEl, substring) {
    if (!rootEl || !substring) return false;
    var walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest && node.parentElement.closest('[class*="prompt-editor-sizer"]')) {
        continue;
      }
      var text = node.textContent || '';
      var idx = text.indexOf(substring);
      if (idx !== -1) {
        var range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + substring.length);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        try {
          rootEl.focus();
        } catch (ef) {
          /* ignore */
        }
        return true;
      }
    }
    return false;
  }

  function clickJimengReferenceOption(imageNum) {
    var popup = doc.querySelector('.lv-select-popup');
    var options = popup ? popup.querySelectorAll('li[role="option"]') : [];
    for (var oi = 0; oi < options.length; oi++) {
      var li = options[oi];
      var mm = (li.textContent || '').match(/图片(\d+)/);
      if (mm && parseInt(mm[1], 10) === imageNum) {
        li.click();
        return true;
      }
    }
    return false;
  }

  /** @param {{ roundId: string }} payload */
  async function runStep12ClearForm(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step12_jimeng_clear_form';
    var target = findJimengPromptField();
    if (!target) {
      appendMainLog(roundId, stepKey, 'info', 'Step12.动作失败+未找到提示词输入区域');
      return { ok: false, code: 'JIMENG_PROMPT_FIELD_NOT_FOUND' };
    }
    target.focus();
    appendMainLog(roundId, stepKey, 'info', 'Step12.清空提示词');
    clearEditorHardOnTarget(target);
    appendMainLog(roundId, stepKey, 'info', 'Step12.移除参考图');
    var removeCount = 0;
    var removeRefMaxClicks = 80;
    while (true) {
      var btn = pickNextJimengRefRemoveButton();
      if (!btn) break;
      if (removeCount >= removeRefMaxClicks) break;
      removeCount++;
      try {
        btn.click();
      } catch (eRm) {
        appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.removeErr ' + (eRm && eRm.message));
      }
      await delay(320);
    }
    return { ok: true };
  }

  var PASTE_GAP_MS = 1000;
  var BEFORE_FIRST_PASTE_MS = 500;
  var AFTER_LAST_PASTE_SETTLE_MS = 1200;
  var POPUP_WAIT_MS_AT = 550;
  var AFTER_OPTION_MS_AT = 450;

  /** @param {{ roundId: string, images?: string[] }} payload */
  async function runStep13PasteReferenceClearPrompt(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step13_jimeng_paste_reference_clear_prompt';
    var images = payload && Array.isArray(payload.images) ? payload.images : [];
    if (images.length === 0) {
      return { ok: true, skipped: true };
    }
    var inj = g.__idlinkPicpuckInject;
    if (!inj || typeof inj.dataUrlToBlob !== 'function' || typeof inj.collectJimengReferenceFileInputs !== 'function') {
      return { ok: false, code: 'JIMENG_PAGE_HELPERS_MISSING' };
    }
    var target = findJimengPromptField();
    if (!target) {
      return { ok: false, code: 'JIMENG_PROMPT_FIELD_NOT_FOUND' };
    }
    target.focus();
    await delay(BEFORE_FIRST_PASTE_MS);
    var sizes = [];
    var failIdx = [];
    var idx;
    for (idx = 0; idx < images.length; idx++) {
      var blob = inj.dataUrlToBlob(images[idx]);
      if (!blob) {
        failIdx.push(idx);
        appendMainLog(roundId, stepKey, 'debug', 'Step13.debug.dataUrlToBlobFail idx=' + idx);
        await delay(PASTE_GAP_MS);
        continue;
      }
      sizes.push(blob.size);
      var fi = inj.imageFileFromBlob(blob, idx + 1);
      var fileOne = fi.file;
      var fileType = fi.fileType;
      var dtOne = new DataTransfer();
      dtOne.items.add(fileOne);
      appendMainLog(roundId, stepKey, 'debug', 'Step13.debug.paste idx=' + idx + ' ' + inj.jimengPasteBrief(images[idx], blob, fileOne));

      var slotInputs = inj.collectJimengReferenceFileInputs(doc);
      var fileInp = slotInputs.length > idx ? slotInputs[idx] : slotInputs[0];
      if (fileInp) {
        try {
          var dtFile = new DataTransfer();
          dtFile.items.add(fileOne);
          fileInp.files = dtFile.files;
          fileInp.dispatchEvent(new Event('change', { bubbles: true }));
          appendMainLog(roundId, stepKey, 'debug', 'Step13.debug.fileInput idx=' + idx + ' slots=' + slotInputs.length);
          await delay(PASTE_GAP_MS);
          continue;
        } catch (ef) {
          appendMainLog(roundId, stepKey, 'debug', 'Step13.debug.fileInputErr ' + (ef && ef.message));
        }
      }

      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        var clipMap = {};
        clipMap[fileType] = blob;
        try {
          await navigator.clipboard.write([new ClipboardItem(clipMap)]);
          target.focus();
          var execOk = false;
          try {
            execOk = document.execCommand('paste');
          } catch (ex) {
            /* ignore */
          }
          appendMainLog(roundId, stepKey, 'debug', 'Step13.debug.clipboardPaste idx=' + idx + ' execOk=' + execOk);
        } catch (err) {
          appendMainLog(roundId, stepKey, 'debug', 'Step13.debug.clipboardWriteFail ' + (err && err.message));
          try {
            target.focus();
            target.dispatchEvent(new ClipboardEvent('paste', { bubbles: false, cancelable: true, clipboardData: dtOne }));
          } catch (e1) {
            appendMainLog(roundId, stepKey, 'debug', 'Step13.debug.syntheticPasteErr ' + (e1 && e1.message));
          }
        }
        await delay(PASTE_GAP_MS);
        continue;
      }

      try {
        target.focus();
        target.dispatchEvent(new ClipboardEvent('paste', { bubbles: false, cancelable: true, clipboardData: dtOne }));
      } catch (e2) {
        /* ignore */
      }
      await delay(PASTE_GAP_MS);
    }
    appendMainLog(
      roundId,
      stepKey,
      'debug',
      'Step13.debug.sequentialDone bytes=' + JSON.stringify(sizes) + ' failIdx=[' + failIdx.join(',') + ']',
    );
    await delay(AFTER_LAST_PASTE_SETTLE_MS);
    clearEditorHardOnTarget(target);
    await delay(250);
    clearEditorHardOnTarget(target);
    return { ok: true };
  }

  /** @param {{ roundId: string, prompt?: string }} payload */
  async function runStep14FillPromptText(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step14_jimeng_fill_prompt_text';
    var target = findJimengPromptField();
    if (!target) {
      appendMainLog(roundId, stepKey, 'info', 'Step14.动作失败+未找到提示词输入区域');
      return { ok: false, code: 'JIMENG_PROMPT_FIELD_NOT_FOUND' };
    }
    var prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
    target.focus();
    var isTa = target.tagName === 'TEXTAREA';
    if (isTa) {
      target.value = prompt;
    } else if (!prompt) {
      clearEditorHardOnTarget(target);
    } else {
      insertPlainOnTarget(target, prompt);
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
    return { ok: true };
  }

  /** @param {{ roundId: string, prompt?: string, images?: string[] }} payload */
  async function runStep15ExpandAtMentions(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step15_jimeng_expand_at_mentions';
    var images = payload && Array.isArray(payload.images) ? payload.images : [];
    if (images.length === 0) {
      appendMainLog(roundId, stepKey, 'info', 'Step15.本步跳过');
      return { ok: true, skipped: true };
    }
    var prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
    var v;
    for (v = 1; v <= images.length; v++) {
      var needTok = '(参考图片' + v + ')';
      if (prompt.indexOf(needTok) === -1) {
        appendMainLog(roundId, stepKey, 'info', 'Step15.动作失败+提示词缺少占位符');
        return { ok: false, code: 'JIMENG_PROMPT_PLACEHOLDER_MISMATCH' };
      }
    }
    var target = findJimengPromptField();
    if (!target) {
      return { ok: false, code: 'JIMENG_PROMPT_FIELD_NOT_FOUND' };
    }
    var isTa = target.tagName === 'TEXTAREA';
    if (isTa) {
      appendMainLog(roundId, stepKey, 'debug', 'Step15.debug.textareaSkipAt');
      return { ok: true };
    }
    var maxIter = 120;
    var iter = 0;
    while (iter < maxIter) {
      iter++;
      var inner = target.innerText || target.textContent || '';
      var m = inner.match(/\(参考图片(\d+)\)/);
      if (!m) {
        return { ok: true };
      }
      var token = m[0];
      var n = parseInt(m[1], 10);
      if (!selectTextInElement(target, token)) {
        return { ok: true };
      }
      var insAt = false;
      try {
        insAt = doc.execCommand('insertText', false, '@');
      } catch (eAt) {
        /* ignore */
      }
      if (!insAt) {
        return { ok: true };
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
      await delay(POPUP_WAIT_MS_AT);
      var clicked = clickJimengReferenceOption(n);
      appendMainLog(roundId, stepKey, 'debug', 'Step15.debug.refOption n=' + n + ' ok=' + clicked);
      await delay(AFTER_OPTION_MS_AT);
    }
    return { ok: true };
  }

  /** @param {{ roundId: string }} payload */
  async function runStep16SetLoggedInMarker(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step16_jimeng_set_logged_in_marker';
    try {
      var hasPersonal = !!(doc.getElementById('Personal') || (doc.querySelector && doc.querySelector('[id="Personal"]')));
      if (doc.body) doc.body.setAttribute('data-idlink-jimeng-logged-in', hasPersonal ? '1' : '0');
    } catch (e) {
      appendMainLog(roundId, stepKey, 'debug', 'Step16.debug.err ' + (e && e.message));
    }
    return { ok: true };
  }

  /** @param {{ roundId: string, fillOnly?: boolean }} payload */
  async function runStep17ClickGenerateIfNeeded(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step17_jimeng_click_generate_if_needed';
    var fillOnly = !!(payload && payload.fillOnly);
    if (fillOnly) {
      appendMainLog(roundId, stepKey, 'info', 'Step17.跳过生成按钮+fillOnly');
      return { ok: true };
    }
    var genBtn = doc.querySelector('[class*="toolbar-actions"]');
    genBtn = genBtn ? genBtn.querySelector('button[class*="lv-btn"]') : null;
    var genClicked = clickWhenVisible(function () {
      return genBtn;
    });
    appendMainLog(roundId, stepKey, 'debug', 'Step17.debug.clickGenerate=' + genClicked);
    return { ok: true };
  }

  g.__picpuckJimengImage = {
    runStep07EnsureWorkbenchReady: runStep07EnsureWorkbenchReady,
    runStep08CloseOpenPopovers: runStep08CloseOpenPopovers,
    runStep09EnsureModeImageGeneration: runStep09EnsureModeImageGeneration,
    runStep10EnsureModel: runStep10EnsureModel,
    runStep11EnsureRatioResolution: runStep11EnsureRatioResolution,
    runStep12ClearForm: runStep12ClearForm,
    runStep13PasteReferenceClearPrompt: runStep13PasteReferenceClearPrompt,
    runStep14FillPromptText: runStep14FillPromptText,
    runStep15ExpandAtMentions: runStep15ExpandAtMentions,
    runStep16SetLoggedInMarker: runStep16SetLoggedInMarker,
    runStep17ClickGenerateIfNeeded: runStep17ClickGenerateIfNeeded,
  };
})();
