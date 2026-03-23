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

  g.__picpuckJimengImage = {
    runStep07EnsureWorkbenchReady: runStep07EnsureWorkbenchReady,
    runStep08CloseOpenPopovers: runStep08CloseOpenPopovers,
    runStep09EnsureModeImageGeneration: runStep09EnsureModeImageGeneration,
    runStep10EnsureModel: runStep10EnsureModel,
    runStep11EnsureRatioResolution: runStep11EnsureRatioResolution,
  };
})();
