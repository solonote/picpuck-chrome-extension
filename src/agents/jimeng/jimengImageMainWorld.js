/**
 * 即梦图片生成：MAIN 世界业务脚本（设计 §3.1.1）。
 * 由 SW `executeScript` `files` 注入；通过 `postMessage` 写日志（§3.2）。
 * 源语义对齐旧版 `runJimengGenerateImage`（不含 Banner / 三连击日志，R6 排除）。
 *
 * DOM：禁止写死 CSS Modules 哈希类名（如 label-l6Zq3t、button-text-xxxxx）。优先稳定文案、role、data-*；
 * 若用 class 子串，仅用可预期的语义前缀（如 commercial-content、toolbar-button、lv-select-view-value）。
 */
(function () {
  var g = typeof globalThis !== 'undefined' ? globalThis : window;
  // 同页可能多次注入：LAUNCH 已创建 __picpuckJimengImage 后，仅当已含 watcher API 才跳过；
  // 否则须重新跑完整 bundle（例如扩展升级后旧页内对象缺 startJimengRecoverPageWatcher）。
  if (g.__picpuckJimengImage && typeof g.__picpuckJimengImage.startJimengRecoverPageWatcher === 'function') {
    return;
  }

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

  /**
   * 画幅/分辨率按钮内的「比例 + 清晰度」合成标签：以 `commercial-content` 父级 span 或
   * 「含 N:M + divider/超清/K」的 span 识别，不依赖 button-text 后缀哈希类名。
   */
  function jimengParamButtonLabelSpan(btn) {
    if (!btn || !btn.querySelector) return null;
    var comm = btn.querySelector('[class*="commercial-content"]');
    if (comm) {
      var par = comm.parentElement;
      if (par && par.tagName === 'SPAN') return par;
    }
    var spans = btn.querySelectorAll('span');
    var si;
    var sp;
    var t;
    for (si = 0; si < spans.length; si++) {
      sp = spans[si];
      t = (sp.textContent && sp.textContent.trim()) || '';
      if (!/\d+\s*:\s*\d+/.test(t)) continue;
      if (sp.querySelector('[class*="commercial-content"]')) return sp;
      if (sp.querySelector('[class*="divider"]')) return sp;
      if (/[234]\s*[Kk]|超清/.test(t)) return sp;
    }
    return null;
  }

  function findJimengParamToolbarButton() {
    var i;
    var toolbar = findJimengGeneratorToolbar();
    if (toolbar) {
      var cands = toolbar.querySelectorAll('button[class*="toolbar-button"]');
      for (i = 0; i < cands.length; i++) {
        var b = cands[i];
        if (!b.offsetParent) continue;
        if (jimengParamButtonLabelSpan(b)) return b;
      }
    }
    var all = doc.querySelectorAll('button[class*="toolbar-button"]');
    for (i = 0; i < all.length; i++) {
      var b2 = all[i];
      if (!b2.offsetParent) continue;
      if (jimengParamButtonLabelSpan(b2)) return b2;
    }
    var byText =
      findByText(doc.body, '16:9', 'button') ||
      findByText(doc.body, '9:16', 'button') ||
      findByText(doc.body, '21:9', 'button') ||
      findByText(doc.body, '3:4', 'button') ||
      findByText(doc.body, '1:1', 'button');
    if (byText) {
      var btn = byText.tagName === 'BUTTON' ? byText : byText.closest && byText.closest('button');
      if (btn && jimengParamButtonLabelSpan(btn)) return btn;
    }
    return null;
  }

  function getCurrentParams() {
    var btn = findJimengParamToolbarButton();
    if (!btn) return { ratio: '', resolution: '' };
    var span = jimengParamButtonLabelSpan(btn);
    var ratio = '';
    var res = '';
    if (span) {
      var resEl = span.querySelector('[class*="commercial-content"]');
      res = (resEl && resEl.textContent && resEl.textContent.trim()) || '';
      var cn = span.childNodes;
      var k;
      for (k = 0; k < cn.length; k++) {
        if (cn[k].nodeType === 3) {
          var tr = String(cn[k].textContent || '').trim();
          if (tr) {
            ratio = tr;
            break;
          }
        }
      }
      if (!ratio) {
        var full = (span.textContent && span.textContent.trim()) || '';
        if (res && full.indexOf(res) !== -1) ratio = full.split(res)[0].replace(/\s+/g, ' ').trim();
        else ratio = full;
      }
    } else {
      ratio = (btn.textContent && btn.textContent.trim()) || '';
    }
    if (res && ratio.indexOf(res) !== -1) ratio = ratio.replace(res, '').replace(/\s+/g, ' ').trim();
    return { ratio: ratio, resolution: res };
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
    var paramBtn = findJimengParamToolbarButton();
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

  /** 画幅/分辨率浮层：含「选择比例」的 lv-popover-content，避免扫到其它 popover。 */
  function getVisibleRatioResolutionPopups() {
    var all = doc.querySelectorAll('div[class*="lv-popover-content"]');
    var out = [];
    var i;
    for (i = 0; i < all.length; i++) {
      if (!all[i].offsetParent) continue;
      var tx = all[i].textContent || '';
      if (tx.indexOf('选择比例') !== -1) out.push(all[i]);
    }
    return out;
  }

  /** 弹层内常有「比例」「分辨率」两个 radiogroup，不用 field-/title- 哈希类；用选项形态区分。 */
  function findRatioRadiogroupInPopup(popup) {
    var groups = popup.querySelectorAll('[role="radiogroup"]');
    if (groups.length <= 1) return groups.length ? groups[0] : null;
    var g;
    var rg;
    var labs;
    var L;
    var t;
    for (g = 0; g < groups.length; g++) {
      rg = groups[g];
      if (rg.querySelector('input[type="radio"][value*=":"]')) return rg;
      if (rg.querySelector('input[type="radio"][value="智能"]')) return rg;
      labs = rg.querySelectorAll('label');
      for (L = 0; L < labs.length; L++) {
        t = (labs[L].textContent && labs[L].textContent.trim()) || '';
        if (/\d+\s*:\s*\d+/.test(t)) return rg;
      }
    }
    return groups[0];
  }

  function clickParamPopoverRatio(wantRatio) {
    var r = (wantRatio || '').trim();
    if (!r) return false;
    var popups = getVisibleRatioResolutionPopups();
    var pi;
    for (pi = 0; pi < popups.length; pi++) {
      var scope = findRatioRadiogroupInPopup(popups[pi]) || popups[pi];
      var inp = null;
      if (r === '智能') {
        var radios = scope.querySelectorAll('input[type="radio"]');
        var ri;
        for (ri = 0; ri < radios.length; ri++) {
          var v = radios[ri].getAttribute('value');
          if (v === null || v === '') {
            inp = radios[ri];
            break;
          }
        }
      } else {
        inp = scope.querySelector('input[type="radio"][value="' + r + '"]');
      }
      if (inp && inp.closest && inp.closest('label')) {
        inp.closest('label').click();
        return true;
      }
    }
    return false;
  }

  function resolutionRadioValueFromLabel(wantRes) {
    var s = (wantRes || '').trim();
    if (!s) return '';
    if (s.indexOf('4K') !== -1 || s.toLowerCase().indexOf('4k') !== -1) return '4k';
    if (s.indexOf('2K') !== -1 || s.toLowerCase().indexOf('2k') !== -1) return '2k';
    return '';
  }

  function clickParamPopoverResolution(wantRes) {
    var val = resolutionRadioValueFromLabel(wantRes);
    if (!val) return false;
    var popups = getVisibleRatioResolutionPopups();
    var pi;
    for (pi = 0; pi < popups.length; pi++) {
      var p = popups[pi];
      var inp =
        p.querySelector('[class*="resolution-radio"] input[type="radio"][value="' + val + '"]') ||
        p.querySelector('input[type="radio"][value="' + val + '"]');
      if (inp && inp.closest && inp.closest('label')) {
        inp.closest('label').click();
        return true;
      }
    }
    return false;
  }

  function getClickableOption(el) {
    if (!el || !el.closest) return el;
    var label = el.closest('label[class*="lv-radio"], label.lv-radio');
    return label || el;
  }

  function findOptionInPopup(text) {
    var ratioPopups = getVisibleRatioResolutionPopups();
    var popups = ratioPopups.length ? ratioPopups : getVisiblePopups();
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
        '[class*="select-option"], [class*="option-label"], [class*="resolution-commercial-option"], [class*="label-"], div, span',
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
    var paramBtn = findJimengParamToolbarButton();
    var paramClicked = clickWhenVisible(function () {
      return paramBtn;
    });
    if (!paramClicked) {
      return { ok: false, code: 'JIMENG_MODE_OR_PARAM_FAILED' };
    }
    await delay(DELAY_OPEN);
    if (needRatio) {
      var ratioClicked = clickParamPopoverRatio(wantRatio) || clickOptionWhenVisible(wantRatio);
      appendMainLog(roundId, stepKey, 'debug', 'Step11.debug.ratioClicked=' + ratioClicked);
      await delay(DELAY_AFTER_OPTION);
    }
    if (needRes) {
      var resClicked = clickParamPopoverResolution(wantRes) || clickOptionWhenVisible(wantRes);
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

  /**
   * 即梦 ProseMirror：整段 insertText 含 \\n 可能被当成提交或块分裂异常；换行用 insertLineBreak / Shift+Enter。
   */
  async function insertJimengContenteditableSoftLineBreaks(target, plain) {
    var s = typeof plain === 'string' ? plain : '';
    if (!s) return;
    target.focus();
    var lines = s.split(/\r\n|\n|\r/);
    var li;
    for (li = 0; li < lines.length; li++) {
      if (li > 0) {
        var broke = false;
        try {
          broke = doc.execCommand('insertLineBreak', false, null);
        } catch (eLb) {
          broke = false;
        }
        if (!broke) {
          try {
            target.dispatchEvent(
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
            target.dispatchEvent(
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
      if (!seg) continue;
      var inserted = false;
      try {
        inserted = doc.execCommand('insertText', false, seg);
      } catch (ei) {
        inserted = false;
      }
      if (!inserted) {
        try {
          var dtT = new DataTransfer();
          dtT.setData('text/plain', seg);
          target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dtT }));
        } catch (ep) {
          /* ignore */
        }
      }
      await delay(25);
    }
  }

  /**
   * 参考项内是否已有实际上传的预览图。
   * 空槽示例：`reference-item` 内仅有 `reference-upload` + 加号 SVG + file input，无 `<img>`，`--reference-count: 1` 亦可。
   * 有图：`img[data-apm-action="content-generator-reference-image"]`，或带 blob/https 且足够大的预览 img。
   */
  function jimengReferenceItemHasPreviewImage(item) {
    if (!item || !item.querySelectorAll) return false;
    if (!item.querySelector('img')) return false;
    if (item.querySelector && item.querySelector('img[data-apm-action="content-generator-reference-image"]')) return true;
    var imgs = item.querySelectorAll('img');
    var i;
    for (i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      var rect = im.getBoundingClientRect();
      if (rect.width < 20 || rect.height < 20) continue;
      var src = (im.getAttribute('src') || '').trim();
      if (!src) continue;
      if (src.indexOf('record-loading') !== -1) continue;
      if (src.indexOf('blob:') === 0 || src.indexOf('http://') === 0 || src.indexOf('https://') === 0) return true;
    }
    return false;
  }

  function jimengReferencesRoot() {
    var pec = doc.querySelector('[class*="prompt-editor-container"]');
    return (pec && pec.querySelector('[class*="references-"]')) || doc.querySelector('[class*="references-"]');
  }

  /**
   * 按 reference-item 遍历：仅对有预览图的项点移除。
   * `remove-button-container-*` 的 class 也含子串 remove-button，若先点到外层容器常无法触发移除，会触发 sameTarget 提前结束。
   * 排除含 `remove-button-container` 的节点，优先带关闭图标的可点层（内层 div.remove-button-*）。
   */
  function pickNextJimengRefRemoveButton() {
    var refRoot = jimengReferencesRoot();
    var items = (refRoot || doc).querySelectorAll('[class*="reference-item"]');
    var ii;
    var jj;
    var item;
    var nodes;
    var c;
    var cls;
    var r;
    var best;
    var bestR;
    for (ii = 0; ii < items.length; ii++) {
      item = items[ii];
      if (!jimengReferenceItemHasPreviewImage(item)) continue;
      nodes = item.querySelectorAll('[class*="remove-button"]');
      best = null;
      bestR = -1;
      for (jj = 0; jj < nodes.length; jj++) {
        c = nodes[jj];
        cls = (c.className && String(c.className)) || '';
        if (cls.indexOf('remove-button-container') !== -1) continue;
        r = c.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (c.querySelector && c.querySelector('svg')) {
          return c;
        }
        if (r.width * r.height > bestR) {
          bestR = r.width * r.height;
          best = c;
        }
      }
      if (best) return best;
    }
    return null;
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
    var removeRefMaxClicks = 24;
    var lastRemoveEl = null;
    var sameTargetStreak = 0;
    while (true) {
      var btn = pickNextJimengRefRemoveButton();
      if (!btn) break;
      if (removeCount >= removeRefMaxClicks) break;
      if (btn === lastRemoveEl) {
        sameTargetStreak++;
        if (sameTargetStreak >= 2) {
          appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.removeStopSameTarget');
          break;
        }
      } else {
        sameTargetStreak = 0;
      }
      lastRemoveEl = btn;
      removeCount++;
      try {
        btn.click();
      } catch (eRm) {
        appendMainLog(roundId, stepKey, 'debug', 'Step12.debug.removeErr ' + (eRm && eRm.message));
      }
      await delay(480);
    }
    return { ok: true };
  }

  var PASTE_GAP_MS = 1000;
  var BEFORE_FIRST_PASTE_MS = 500;
  var AFTER_LAST_PASTE_SETTLE_MS = 1200;
  /** @ 后等待即梦「可能@的内容」下拉：须出现 .lv-select-popup 且已有 li[role="option"]（选项渲染完） */
  var AT_POPUP_WAIT_MAX_MS = 12000;
  /** 连续这么久仍无弹层则删掉 @ 再 insertText @ 一次（比合成左右键易生效） */
  var AT_POPUP_STUCK_SLICE_MS = 1000;
  var AT_POPUP_POLL_MS = 100;
  var AT_POPUP_REINSERT_SETTLE_MS = 50;
  var AFTER_OPTION_MS_AT = 450;
  /** 防止异常 DOM 死循环；正常每轮应处理掉一个 (参考图片N) */
  var STEP15_MAX_PLACEHOLDER_ROUNDS = 64;

  function tryJimengAtSelectPopupReady() {
    var popup = doc.querySelector('.lv-select-popup');
    if (!popup) return null;
    var r = popup.getBoundingClientRect();
    var visible = r.width > 1 && r.height > 1;
    var options = popup.querySelectorAll('li[role="option"]');
    if (visible && options.length > 0) {
      return popup;
    }
    return null;
  }

  /** 折叠选区下删除光标前一字（优先 Range，否则 Backspace 事件） */
  function deleteOneCharBackwardInPromptEditable(rootEl) {
    if (!rootEl) return false;
    try {
      rootEl.focus();
    } catch (eF) {
      /* ignore */
    }
    var sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      var r = sel.getRangeAt(0);
      if (!r.collapsed) {
        r.deleteContents();
        try {
          rootEl.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (eIn) {
          /* ignore */
        }
        return true;
      }
      var n = r.startContainer;
      var off = r.startOffset;
      if (n.nodeType === Node.TEXT_NODE && off >= 1) {
        r.setStart(n, off - 1);
        r.setEnd(n, off);
        r.deleteContents();
        sel.removeAllRanges();
        sel.addRange(r);
        sel.collapseToStart();
        try {
          rootEl.dispatchEvent(new Event('input', { bubbles: true }));
        } catch (eIn2) {
          /* ignore */
        }
        return true;
      }
    }
    var down = new KeyboardEvent('keydown', {
      key: 'Backspace',
      code: 'Backspace',
      keyCode: 8,
      which: 8,
      bubbles: true,
      cancelable: true,
    });
    var up = new KeyboardEvent('keyup', {
      key: 'Backspace',
      code: 'Backspace',
      keyCode: 8,
      which: 8,
      bubbles: true,
      cancelable: true,
    });
    rootEl.dispatchEvent(down);
    rootEl.dispatchEvent(up);
    try {
      rootEl.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (eIn3) {
      /* ignore */
    }
    return true;
  }

  /** 删掉当前 @ 再 insertText @，用于弹层卡住时重触发 */
  async function retryJimengAtByDeleteAndReinsertAt(rootEl) {
    if (!rootEl) return false;
    deleteOneCharBackwardInPromptEditable(rootEl);
    await delay(AT_POPUP_REINSERT_SETTLE_MS);
    var insOk = false;
    try {
      insOk = doc.execCommand('insertText', false, '@');
    } catch (eIns) {
      /* ignore */
    }
    try {
      rootEl.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (eIn) {
      /* ignore */
    }
    return insOk;
  }

  /**
   * 轮询直至 @ 下拉挂载且至少有一条 option。若连续 AT_POPUP_STUCK_SLICE_MS 仍无弹层，则删掉 @ 再插入 @（总时长 AT_POPUP_WAIT_MAX_MS）。
   * @param {Element | null} targetForReinsert 提示词可编辑根节点
   * @returns {Promise<{ ok: true, popup: Element } | { ok: false, code: string }>}
   */
  async function waitForJimengAtSelectPopupReady(roundId, stepKey, targetForReinsert) {
    var deadline = Date.now() + AT_POPUP_WAIT_MAX_MS;
    while (Date.now() < deadline) {
      var sliceEnd = Date.now() + AT_POPUP_STUCK_SLICE_MS;
      if (sliceEnd > deadline) sliceEnd = deadline;
      while (Date.now() < sliceEnd) {
        var popupOk = tryJimengAtSelectPopupReady();
        if (popupOk) {
          var nOpt = popupOk.querySelectorAll('li[role="option"]').length;
          appendMainLog(roundId, stepKey, 'debug', 'Step15.debug.atPopupReady options=' + nOpt);
          return { ok: true, popup: popupOk };
        }
        await delay(AT_POPUP_POLL_MS);
      }
      if (Date.now() >= deadline) break;
      appendMainLog(roundId, stepKey, 'debug', 'Step15.debug.atPopupStuckReinsertAt');
      var reinsertOk = await retryJimengAtByDeleteAndReinsertAt(targetForReinsert);
      if (!reinsertOk) {
        appendMainLog(roundId, stepKey, 'debug', 'Step15.debug.atPopupStuckReinsertAtInsertFailed');
      }
      await delay(AT_POPUP_REINSERT_SETTLE_MS);
    }
    appendMainLog(roundId, stepKey, 'info', 'Step15.动作失败+@ 下拉未在时限内加载完成');
    return { ok: false, code: 'JIMENG_AT_POPUP_TIMEOUT' };
  }

  /**
   * @param {Element} [rootPopup] 若已由上一步 wait 得到，避免多实例时 query 到错误弹层
   */
  async function clickJimengReferenceOption(imageNum, rootPopup) {
    var popup = rootPopup || doc.querySelector('.lv-select-popup');
    var options = popup ? popup.querySelectorAll('li[role="option"]') : [];
    for (var oi = 0; oi < options.length; oi++) {
      var li = options[oi];
      var mm = (li.textContent || '').match(/图片(\d+)/);
      if (mm && parseInt(mm[1], 10) === imageNum) {
        await delay(100);
        li.click();
        return true;
      }
    }
    return false;
  }

  /** @param {{ roundId: string, images?: string[] }} payload */
  async function runStep13PasteReferenceClearPrompt(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step13_jimeng_paste_reference_clear_prompt';
    var raw = payload && Array.isArray(payload.images) ? payload.images : [];
    var images = [];
    var ri;
    for (ri = 0; ri < raw.length; ri++) {
      if (typeof raw[ri] === 'string' && raw[ri].trim().length > 0) images.push(raw[ri]);
    }
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
      await insertJimengContenteditableSoftLineBreaks(target, prompt);
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
      appendMainLog(roundId, stepKey, 'info', 'Step15.无参考图+跳过@引用占位符展开');
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
    var round = 0;
    while (round < STEP15_MAX_PLACEHOLDER_ROUNDS) {
      round++;
      var inner = target.innerText || target.textContent || '';
      var m = inner.match(/\(参考图片(\d+)\)/);
      if (!m) {
        return { ok: true };
      }
      var token = m[0];
      var n = parseInt(m[1], 10);
      if (!selectTextInElement(target, token)) {
        appendMainLog(roundId, stepKey, 'info', 'Step15.动作失败+无法选中占位符');
        return { ok: false, code: 'JIMENG_AT_PLACEHOLDER_SELECT_FAILED' };
      }
      var insAt = false;
      try {
        insAt = doc.execCommand('insertText', false, '@');
      } catch (eAt) {
        /* ignore */
      }
      if (!insAt) {
        appendMainLog(roundId, stepKey, 'info', 'Step15.动作失败+无法插入@');
        return { ok: false, code: 'JIMENG_AT_INSERT_FAILED' };
      }
      target.dispatchEvent(new Event('input', { bubbles: true }));
      var wPop = await waitForJimengAtSelectPopupReady(roundId, stepKey, target);
      if (!wPop.ok) {
        return { ok: false, code: wPop.code };
      }
      var clicked = await clickJimengReferenceOption(n, wPop.popup);
      appendMainLog(roundId, stepKey, 'debug', 'Step15.debug.refOption n=' + n + ' ok=' + clicked);
      if (!clicked) {
        appendMainLog(roundId, stepKey, 'info', 'Step15.动作失败+下拉已加载但无图片' + n);
        return { ok: false, code: 'JIMENG_AT_OPTION_NOT_FOUND' };
      }
      await delay(AFTER_OPTION_MS_AT);
    }
    appendMainLog(roundId, stepKey, 'info', 'Step15.动作失败+@ 展开超过最大轮次');
    return { ok: false, code: 'JIMENG_AT_EXPAND_EXHAUSTED' };
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

  /** @param {{ roundId: string, jimengSubmitMode?: string }} payload */
  async function runStep17ClickGenerateIfNeeded(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step17_jimeng_click_generate_if_needed';
    var mode = payload && payload.jimengSubmitMode;
    if (mode !== 'toolbar' && mode !== 'enter' && mode !== 'none') {
      appendMainLog(roundId, stepKey, 'info', 'Step17.动作失败+jimengSubmitMode 非法或缺失');
      return { ok: false, code: 'JIMENG_SUBMIT_MODE_INVALID' };
    }
    if (mode !== 'toolbar') {
      appendMainLog(roundId, stepKey, 'info', 'Step17.跳过工具栏生成按钮+submitMode=' + mode);
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

  /**
   * 即梦虚拟列表：`data-index="0"` 为当前最新一条（在列表底部一侧）。
   * 在 `record-list-container` 内取 `item-*[data-index="0"]`；若 DOM 中有多块，取 `getBoundingClientRect().bottom` 最大者（最靠视口下方）。
   * 新版：`record-box-wrapper-*` / `image-record-content-*` 包裹多图结果；外层仍常见 `item-*` + `data-index="0"` + `data-id`。
   */
  function findLatestJimengGenerationRecordRoot(docRef) {
    var d = docRef || doc;
    var shell = d.querySelector('#dreamina-ui-configuration-content-wrapper') || d.querySelector('main');
    var scope = shell || d.body || d;

    function bestRecordByClassFragment(frag) {
      var nodes = scope.querySelectorAll('[class*="' + frag + '"]');
      var best = null;
      var bestBottom = -1e9;
      var i;
      var el;
      var r;
      var nImg;
      for (i = 0; i < nodes.length; i++) {
        el = nodes[i];
        nImg = el.querySelectorAll('img[data-apm-action="ai-generated-image-record-card"]').length;
        if (nImg < 1) continue;
        r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.bottom > bestBottom) {
          bestBottom = r.bottom;
          best = el;
        }
      }
      return best;
    }

    var listRoot = scope.querySelector('[class*="record-list-container"]') || scope;
    var candidates = listRoot.querySelectorAll('[data-index="0"][data-id]');
    var i;
    var el;
    var best = null;
    var bestBottom = -1e9;
    for (i = 0; i < candidates.length; i++) {
      el = candidates[i];
      if (!el.getAttribute || el.getAttribute('data-index') !== '0') continue;
      var cname = (el.className && String(el.className)) || '';
      if (cname.indexOf('item-') === -1) continue;
      var r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      if (r.bottom > bestBottom) {
        bestBottom = r.bottom;
        best = el;
      }
    }
    if (best) return best;
    var nodes = scope.querySelectorAll('div[class*="item-"][data-id][data-index]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el.getAttribute('data-index') === '0') return el;
    }
    var newUiBox = bestRecordByClassFragment('record-box-wrapper');
    if (newUiBox) return newUiBox;
    var newUiContent = bestRecordByClassFragment('image-record-content');
    if (newUiContent) return newUiContent;
    var alt =
      scope.querySelector('[class*="ai-generated-record-content"]') ||
      scope.querySelector('[class*="image-record-content"]');
    return alt || null;
  }

  /**
   * 从即梦列表项根节点取锚点（提交后出现、生成中与完成后 id/data-id 不变），供 Step20/21 锁定同一条记录。
   * 选择器用 `[class*="prompt-value-container"]`，避免写死 CSS Modules 哈希段。
   */
  function extractJimengRecordAnchorFromRoot(root) {
    if (!root || !root.getAttribute) return null;
    var dataId = root.getAttribute('data-id') || '';
    var recordItemId = root.getAttribute('id') || '';
    var promptPreview = '';
    try {
      var pv = root.querySelector('[class*="prompt-value-container"]');
      if (pv) promptPreview = String(pv.innerText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000);
    } catch (eP) {
      /* ignore */
    }
    if (!dataId.trim() && !recordItemId.trim()) return null;
    return { dataId: dataId.trim(), recordItemId: recordItemId.trim(), promptPreview: promptPreview };
  }

  function normalizeJimengPromptText(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * 有 promptPreview 时必须与当前 DOM 一致（规范化后全等或前缀一致），避免用户后续又生成导致误认别的条。
   * 无 promptPreview 时仅信 id。
   */
  function jimengPromptMatchesAnchor(root, anchor) {
    if (!root || !anchor || typeof anchor !== 'object') return true;
    var exp = anchor.promptPreview;
    if (typeof exp !== 'string' || !exp.trim()) return true;
    var pv = root.querySelector('[class*="prompt-value-container"]');
    var dom = normalizeJimengPromptText(pv ? pv.innerText : '');
    var want = normalizeJimengPromptText(exp);
    if (!want) return true;
    if (dom === want) return true;
    var max = Math.min(300, want.length, dom.length);
    if (max >= 40 && dom.slice(0, max) === want.slice(0, max)) return true;
    return false;
  }

  function isJimengRecordRootVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width >= 4 && r.height >= 4;
  }

  /** 同一 data-id 可能对应多个 DOM 节点（嵌套），只取 `item-*` 列表项且可见者。 */
  function listJimengItemRootsByDataId(d, dataId) {
    var idVal = String(dataId).trim();
    if (!idVal) return [];
    var esc = idVal.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    var sel = 'div[class*="item-"][data-id="' + esc + '"]';
    var nodes;
    try {
      nodes = d.querySelectorAll(sel);
    } catch (e) {
      return [];
    }
    var out = [];
    var i;
    var el;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (el.getAttribute && el.getAttribute('data-id') === idVal && isJimengRecordRootVisible(el)) out.push(el);
    }
    return out;
  }

  function pickJimengRecordRootFromCandidates(candidates, anchor) {
    if (!candidates || candidates.length < 1) return null;
    var matched = [];
    var i;
    var el;
    for (i = 0; i < candidates.length; i++) {
      el = candidates[i];
      if (!isJimengRecordRootVisible(el)) continue;
      if (jimengPromptMatchesAnchor(el, anchor)) matched.push(el);
    }
    if (matched.length >= 1) return matched[0];
    return null;
  }

  /**
   * 找回记录：**不用 data-index**（用户可能继续生成，index 会变）。依赖 Step19 记录的 `recordItemId`、`data-id` + 提示词对比。
   * 无 anchor 时仍用「最新一条」启发式（仅 Step19 首次发现）。
   * @param {Document} docRef
   * @param {{ dataId?: string, recordItemId?: string, promptPreview?: string } | null | undefined} anchor
   */
  function resolveJimengRecordRoot(docRef, anchor) {
    var d = docRef || doc;
    if (!anchor || typeof anchor !== 'object') {
      return findLatestJimengGenerationRecordRoot(d);
    }

    var hasId =
      (typeof anchor.recordItemId === 'string' && anchor.recordItemId.trim()) ||
      (typeof anchor.dataId === 'string' && anchor.dataId.trim());
    if (!hasId) {
      return null;
    }

    var rid = anchor.recordItemId;
    if (typeof rid === 'string' && rid.trim()) {
      try {
        var byId = d.getElementById(rid.trim());
        if (byId && isJimengRecordRootVisible(byId) && jimengPromptMatchesAnchor(byId, anchor)) {
          return byId;
        }
      } catch (eId) {
        /* ignore */
      }
    }

    var dataId = anchor.dataId;
    if (typeof dataId === 'string' && dataId.trim()) {
      var candidates = listJimengItemRootsByDataId(d, dataId);
      var picked = pickJimengRecordRootFromCandidates(candidates, anchor);
      if (picked) return picked;
    }

    return null;
  }

  /** 生成中：loading 视频 / 造梦进度 / 结果区 loading 容器（与「已完成」DOM 互斥，recover 不靠 img decode） */
  function isJimengRecordGenerating(root) {
    if (!root) return false;
    var t = root.textContent || '';
    if (t.indexOf('智能创意中') !== -1) return true;
    if (root.querySelector('video[src*="record-loading-animation"]')) return true;
    if (root.querySelector('[class*="loading-container"]')) return true;
    return /\d+%\s*造梦中/.test(t);
  }

  function isValidJimengResultImg(img) {
    if (!img || img.tagName !== 'IMG') return false;
    var src = img.getAttribute('src') || '';
    if (src.indexOf('http://') !== 0 && src.indexOf('https://') !== 0) return false;
    if (src.indexOf('record-loading-animation') !== -1) return false;
    return img.complete && img.naturalWidth > 0;
  }

  /**
   * 与 listJimengResultImagesOrdered 相同的结果区根。
   * 列表项内可能出现多个 `record-box-wrapper`：首个常为占位/空壳。
   * 评分 = max(APM 结果图 img 数, responsive-image-grid 内 image-card-wrapper 数)；取最高分盒子。
   * 未激活 Tab 下 lazy 图可能尚无 src，靠 wrapper 计数仍能选中正确盒子；若均为 0 则退回整棵 root。
   */
  function jimengResultImagesScopeElement(root) {
    if (!root || !root.querySelectorAll) return null;
    var boxes = root.querySelectorAll('[class*="record-box-wrapper"]');
    var apmSel = 'img[data-apm-action="ai-generated-image-record-card"]';
    var best = null;
    var bestScore = -1;
    var i;
    var el;
    var apmN;
    var grid;
    var wrapN;
    var score;
    for (i = 0; i < boxes.length; i++) {
      el = boxes[i];
      apmN = el.querySelectorAll(apmSel).length;
      grid = el.querySelector('[class*="responsive-image-grid"]') || el;
      wrapN = grid.querySelectorAll('[class*="image-card-wrapper"]').length;
      score = Math.max(apmN, wrapN);
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best && bestScore > 0) return best;
    return root;
  }

  /** RECOVER 就绪用：不依赖 https/src 已加载，仅数槽位（APM 节点或结果区 image-card-wrapper）。 */
  function countJimengStructuralResultSlots(root) {
    var scope = jimengResultImagesScopeElement(root);
    if (!scope || !scope.querySelectorAll) return 0;
    var apmSel = 'img[data-apm-action="ai-generated-image-record-card"]';
    var apmN = scope.querySelectorAll(apmSel).length;
    var grid = scope.querySelector('[class*="responsive-image-grid"]') || scope;
    var wrapN = grid.querySelectorAll('[class*="image-card-wrapper"]').length;
    return Math.max(apmN, wrapN);
  }

  /** 生成完成后记录区常见「再次生成」，生成中通常不出现；作未激活页无图时的兜底。 */
  function hasJimengRecordPostGenerateOperations(root) {
    if (!root) return false;
    var t = root.textContent || '';
    return t.indexOf('再次生成') !== -1;
  }

  /**
   * 结果卡槽位（含 https src，不要求已 decode）。多图时用于与「有效图」张数对齐，避免 loading=lazy 只加载首张导致 Step20 过早 n=1。
   */
  function listJimengResultCardSlotElements(root) {
    var scope = jimengResultImagesScopeElement(root);
    if (!scope || !scope.querySelectorAll) return [];
    var nodes = scope.querySelectorAll('img[data-apm-action="ai-generated-image-record-card"]');
    var out = [];
    var i;
    var src;
    for (i = 0; i < nodes.length; i++) {
      src = (nodes[i].getAttribute('src') || '').trim();
      if (src.indexOf('http://') !== 0 && src.indexOf('https://') !== 0) continue;
      if (src.indexOf('record-loading-animation') !== -1) continue;
      out.push(nodes[i]);
    }
    return out;
  }

  function listJimengResultImagesOrdered(root) {
    if (!root) return [];
    var scope = jimengResultImagesScopeElement(root);
    if (!scope) return [];
    var prefer = scope.querySelectorAll('img[data-apm-action="ai-generated-image-record-card"]');
    var out = [];
    var i;
    for (i = 0; i < prefer.length; i++) {
      if (isValidJimengResultImg(prefer[i])) out.push(prefer[i]);
    }
    if (out.length > 0) return out;
    var all = scope.querySelectorAll('img');
    for (i = 0; i < all.length; i++) {
      if (isValidJimengResultImg(all[i])) out.push(all[i]);
    }
    return out;
  }

  /** 促使 lazy 图进入视口；与 listJimengResultCardSlotElements 搭配使用。 */
  function nudgeJimengLazyResultCardsIntoView(root, slotImgs) {
    if (!root) return;
    try {
      root.scrollIntoView({ block: 'center', behavior: 'instant' });
    } catch (eR) {
      /* ignore */
    }
    var j;
    var im;
    for (j = 0; j < slotImgs.length; j++) {
      im = slotImgs[j];
      if (!im || im.tagName !== 'IMG') continue;
      if (im.complete && im.naturalWidth > 0) continue;
      try {
        im.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      } catch (eI) {
        /* ignore */
      }
    }
  }

  /** recoverDomSnapshot 单条 JSON 长度上限，避免拖垮日志通道 */
  var RECOVER_DOM_LOG_HTML_MAX = 1800;
  /** 整条 recoverDomSnapshot JSON 上限；过小会截断尾部字段，控制台 [PicPuck] 预览也看不清 */
  var RECOVER_DOM_LOG_JSON_MAX = 65536;
  /**
   * 记录外壳 innerHTML：分片写入多条 appendLog。上限仅防极端页面撑爆通道；
   * `shellInnerHTMLLoggedComplete` / `shellInnerHTMLDroppedChars` 标明是否一字不漏。
   */
  var SHELL_INNER_HTML_MAX_TOTAL = 500000;
  var SHELL_INNER_HTML_CHUNK = 4000;
  var SHELL_INNER_HTML_MAX_PARTS = 130;

  function truncateRecoverLogStr(s, max) {
    var t = typeof s === 'string' ? s : String(s == null ? '' : s);
    var m = max || 800;
    if (t.length <= m) return t;
    return t.slice(0, m) + '…[+' + (t.length - m) + 'chars]';
  }

  function summarizeImgNodesForRecoverLog(nodes, maxN) {
    var out = [];
    var lim = Math.min(nodes.length, maxN == null ? 8 : maxN);
    var i;
    for (i = 0; i < lim; i++) {
      var el = nodes[i];
      if (!el || el.tagName !== 'IMG') continue;
      var src = (el.getAttribute && el.getAttribute('src')) || '';
      out.push({
        i: i,
        complete: !!el.complete,
        nw: el.naturalWidth,
        nh: el.naturalHeight,
        srcTail: truncateRecoverLogStr(src, 120),
      });
    }
    if (nodes.length > lim) {
      out.push({ note: '…+' + (nodes.length - lim) + ' more imgs' });
    }
    return out;
  }

  /**
   * 精简：单行 info，无 JSON / 无 innerHTML 分片。`recoverDomVerbose` 未开时用此路径。
   */
  function logRecoverDomBrief(roundId, stepKey, reason, docRef, root, anchor, extra) {
    var hidden = !!document.hidden;
    var vis = typeof document.visibilityState === 'string' ? document.visibilityState : '';
    var parts = ['reason=' + (reason || ''), 'hidden=' + (hidden ? '1' : '0'), 'vis=' + vis, 'root=' + (root ? '1' : '0')];
    if (extra && typeof extra === 'object') {
      if (extra.slotsCount != null) parts.push('slots=' + extra.slotsCount);
      if (extra.validCount != null) parts.push('valid=' + extra.validCount);
      if (extra.n != null) parts.push('n=' + extra.n);
      if (extra.isGenerating) parts.push('generating=1');
    }
    appendMainLog(roundId, stepKey, 'info', 'Step04.info.recoverDomBrief ' + parts.join(' '));
  }

  /**
   * RECOVER 判定瞬间的页面/DOM 快照（JSON）。仅 `payload.recoverDomVerbose===true` 时写入。
   * 若已解析到记录 root：另含 `recoverDomShellPart` 分片与完整性 info。
   */
  function logRecoverDomSnapshot(verbose, roundId, stepKey, reason, docRef, root, anchor, extra) {
    if (!verbose) {
      logRecoverDomBrief(roundId, stepKey, reason, docRef, root, anchor, extra);
      return;
    }
    var d = docRef || doc;
    /** @type {{ inner: string, numChunks: number, chunkSize: number } | null} */
    var shellPartsToLog = null;
    var snap = {
      v: 1,
      reason: reason || '',
      visibilityState: typeof document.visibilityState === 'string' ? document.visibilityState : '',
      hidden: !!document.hidden,
      href: truncateRecoverLogStr(String(location.href || ''), 280),
    };
    if (anchor && typeof anchor === 'object') {
      snap.anchor = {
        dataId: truncateRecoverLogStr(String(anchor.dataId || ''), 80),
        recordItemId: truncateRecoverLogStr(String(anchor.recordItemId || ''), 80),
        promptPreviewLen: typeof anchor.promptPreview === 'string' ? anchor.promptPreview.length : 0,
      };
    }
    snap.rootFound = !!root;
    if (anchor && typeof anchor === 'object' && typeof anchor.dataId === 'string' && anchor.dataId.trim()) {
      try {
        var cands = listJimengItemRootsByDataId(d, anchor.dataId.trim());
        snap.dataIdVisibleRootsCount = cands ? cands.length : 0;
      } catch (eC) {
        snap.dataIdVisibleRootsCount = -1;
      }
    }
    if (anchor && typeof anchor === 'object' && typeof anchor.recordItemId === 'string' && anchor.recordItemId.trim()) {
      try {
        var rid = anchor.recordItemId.trim();
        var byId = d.getElementById(rid);
        snap.recordItemIdElementExists = !!byId;
        if (byId && byId.getBoundingClientRect) {
          var br = byId.getBoundingClientRect();
          snap.recordItemIdRect = { w: Math.round(br.width), h: Math.round(br.height) };
        }
      } catch (eR) {
        snap.recordItemIdElementExists = false;
      }
    }
    try {
      snap.latestRecordFallbackExists = !!findLatestJimengGenerationRecordRoot(d);
    } catch (eL) {
      snap.latestRecordFallbackExists = false;
    }
    if (root && root.nodeType === 1) {
      var rr = root.getBoundingClientRect();
      var rawInner = root.innerHTML || '';
      var fullInnerLen = rawInner.length;
      var inner = rawInner;
      var innerTrunc = false;
      if (inner.length > SHELL_INNER_HTML_MAX_TOTAL) {
        inner = inner.slice(0, SHELL_INNER_HTML_MAX_TOTAL);
        innerTrunc = true;
      }
      var numChunks = inner.length === 0 ? 1 : Math.ceil(inner.length / SHELL_INNER_HTML_CHUNK);
      if (numChunks > SHELL_INNER_HTML_MAX_PARTS) {
        inner = inner.slice(0, SHELL_INNER_HTML_CHUNK * SHELL_INNER_HTML_MAX_PARTS);
        innerTrunc = true;
        numChunks = SHELL_INNER_HTML_MAX_PARTS;
      }
      shellPartsToLog = { inner: inner, numChunks: numChunks, chunkSize: SHELL_INNER_HTML_CHUNK };
      var droppedInnerChars = fullInnerLen > inner.length ? fullInnerLen - inner.length : 0;
      var shellLoggedComplete = !innerTrunc && inner.length === fullInnerLen;
      snap.root = {
        shellInnerHTMLLoggedComplete: shellLoggedComplete,
        shellInnerHTMLDroppedChars: shellLoggedComplete ? 0 : droppedInnerChars,
        shellInnerHTMLLen: fullInnerLen,
        shellInnerHTMLLoggedChars: inner.length,
        shellInnerHTMLParts: numChunks,
        shellInnerHTMLTruncated: innerTrunc,
        tag: root.tagName,
        id: truncateRecoverLogStr(root.id || '', 100),
        className: truncateRecoverLogStr(String(root.className || ''), 220),
        outerHTML: truncateRecoverLogStr(root.outerHTML || '', RECOVER_DOM_LOG_HTML_MAX),
        rect: { x: Math.round(rr.x), y: Math.round(rr.y), w: Math.round(rr.width), h: Math.round(rr.height) },
        textSnippet: truncateRecoverLogStr((root.textContent || '').replace(/\s+/g, ' '), 400),
      };
    }
    if (extra && typeof extra === 'object') {
      var k;
      for (k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) {
          snap[k] = extra[k];
        }
      }
    }
    var json;
    try {
      json = JSON.stringify(snap);
    } catch (eJ) {
      json = '{"recoverDomSnapshotError":"JSON.stringify failed"}';
    }
    if (json.length > RECOVER_DOM_LOG_JSON_MAX) {
      json = json.slice(0, RECOVER_DOM_LOG_JSON_MAX) + '…[json truncated]';
    }
    appendMainLog(roundId, stepKey, 'debug', 'Step04.debug.recoverDomSnapshot ' + json);
    if (root && root.nodeType === 1 && snap.root && typeof snap.root.shellInnerHTMLLoggedComplete === 'boolean') {
      appendMainLog(
        roundId,
        stepKey,
        'info',
        'Step04.info.recoverDomShellIntegrity shellFull=' +
          (snap.root.shellInnerHTMLLoggedComplete ? '1' : '0') +
          ' dropped=' +
          snap.root.shellInnerHTMLDroppedChars +
          ' innerLen=' +
          snap.root.shellInnerHTMLLen +
          ' parts=' +
          snap.root.shellInnerHTMLParts,
      );
    }
    if (shellPartsToLog) {
      var ci;
      for (ci = 0; ci < shellPartsToLog.numChunks; ci++) {
        var start = ci * shellPartsToLog.chunkSize;
        var chunk = shellPartsToLog.inner.slice(start, start + shellPartsToLog.chunkSize);
        appendMainLog(
          roundId,
          stepKey,
          'debug',
          'Step04.debug.recoverDomShellPart ' + (ci + 1) + '/' + shellPartsToLog.numChunks + ' ' + chunk,
        );
      }
    }
    var sumParts = ['reason=' + (reason || '')];
    sumParts.push('hidden=' + (snap.hidden ? '1' : '0'));
    sumParts.push('vis=' + (snap.visibilityState || ''));
    sumParts.push('root=' + (snap.rootFound ? '1' : '0'));
    if (snap.dataIdVisibleRootsCount != null) {
      sumParts.push('dataIdRoots=' + snap.dataIdVisibleRootsCount);
    }
    if (snap.recordItemIdElementExists === false) {
      sumParts.push('ridEl=0');
    }
    if (snap.slotsCount != null) {
      sumParts.push('slots=' + snap.slotsCount);
    }
    if (snap.validCount != null) {
      sumParts.push('valid=' + snap.validCount);
    }
    if (snap.isGenerating) {
      sumParts.push('generating=1');
    }
    if (snap.n != null) {
      sumParts.push('n=' + snap.n);
    }
    if (shellPartsToLog) {
      sumParts.push('shellParts=' + shellPartsToLog.numChunks);
      sumParts.push('shellChars=' + shellPartsToLog.inner.length);
      if (snap.root && typeof snap.root.shellInnerHTMLLoggedComplete === 'boolean') {
        sumParts.push('shellFull=' + (snap.root.shellInnerHTMLLoggedComplete ? '1' : '0'));
      }
      if (snap.root && snap.root.shellInnerHTMLDroppedChars > 0) {
        sumParts.push('shellDrop=' + snap.root.shellInnerHTMLDroppedChars);
      }
    }
    appendMainLog(roundId, stepKey, 'info', 'Step04.info.recoverDomSummary ' + sumParts.join(' '));
  }

  /** 即梦结果卡：data-apm-action 在内部 img 上，不能对 role=button 用 closest(该选择器)。菜单入口常在 class 含 context-menu-trigger 的层上。 */
  function resolveContextMenuDispatchTarget(img) {
    if (!img || img.tagName !== 'IMG') return { target: img, degraded: true, via: 'img' };
    var trigger = null;
    var cur = img;
    while (cur) {
      var c = (cur.className && String(cur.className)) || '';
      if (c.indexOf('context-menu-trigger') !== -1) {
        trigger = cur;
        break;
      }
      cur = cur.parentElement;
    }
    cur = img;
    var cardButton = null;
    while (cur) {
      if (
        cur.getAttribute &&
        cur.getAttribute('role') === 'button' &&
        String(cur.getAttribute('tabindex')) === '0' &&
        cur.querySelector &&
        cur.querySelector('[data-apm-action="ai-generated-image-record-card"]')
      ) {
        cardButton = cur;
        break;
      }
      cur = cur.parentElement;
    }
    var dispatchTarget = trigger || cardButton || img;
    var degraded = !trigger && !cardButton;
    var via = trigger ? 'context-menu-trigger' : cardButton ? 'role-button-card' : 'img';
    return { target: dispatchTarget, degraded: degraded, via: via };
  }

  /** 首张结果图外层的可点击卡片（role=button）；部分新版 DOM 需先左键点一次，合成右键「复制图片」链才响应。 */
  function findJimengResultImageCardRoleButton(imgEl) {
    if (!imgEl) return null;
    var cur = imgEl;
    var depth = 0;
    while (cur && depth < 22) {
      if (
        cur.getAttribute &&
        cur.getAttribute('role') === 'button' &&
        String(cur.getAttribute('tabindex')) === '0' &&
        cur.querySelector &&
        cur.querySelector('[data-apm-action="ai-generated-image-record-card"]')
      ) {
        return cur;
      }
      cur = cur.parentElement;
      depth++;
    }
    return null;
  }

  /**
   * 即梦新版：首张 lazy 图或卡片未激活时，仅派发自定义 contextmenu 会卡住；人工右键一次后恢复。
   * 在 Step21 首张复制前：滚入视口 + 对卡片做一次合成左键点击（必要时再点 context 层），模拟「先点选再右键」。
   */
  async function primeJimengFirstResultCardBeforeContextMenu(card, imgEl, roundId, stepKey) {
    var clickTarget = findJimengResultImageCardRoleButton(imgEl) || card;
    try {
      if (imgEl && imgEl.scrollIntoView) {
        imgEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      } else if (clickTarget.scrollIntoView) {
        clickTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    } catch (eSc) {
      /* ignore */
    }
    await delay(120);
    try {
      if (clickTarget.focus && typeof clickTarget.focus === 'function') {
        clickTarget.focus({ preventScroll: true });
      }
    } catch (eF) {
      /* ignore */
    }
    var r = clickTarget.getBoundingClientRect ? clickTarget.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    var lx = r.left + Math.min(Math.max(r.width / 2, 24), 100);
    var ly = r.top + Math.min(Math.max(r.height / 2, 24), 100);
    var base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: lx,
      clientY: ly,
      button: 0,
      buttons: 1,
    };
    try {
      if (typeof PointerEvent !== 'undefined') {
        clickTarget.dispatchEvent(
          new PointerEvent(
            'pointerdown',
            Object.assign({}, base, { pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: 0.5 }),
          ),
        );
      }
      clickTarget.dispatchEvent(new MouseEvent('mousedown', base));
      clickTarget.dispatchEvent(new MouseEvent('mouseup', Object.assign({}, base, { buttons: 0 })));
      clickTarget.dispatchEvent(new MouseEvent('click', Object.assign({}, base, { buttons: 0 })));
      if (typeof PointerEvent !== 'undefined') {
        clickTarget.dispatchEvent(
          new PointerEvent(
            'pointerup',
            Object.assign({}, base, {
              pointerId: 1,
              pointerType: 'mouse',
              isPrimary: true,
              pressure: 0,
              buttons: 0,
            }),
          ),
        );
      }
    } catch (eClk) {
      appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.firstCardPrimeClickErr ' + (eClk && eClk.message));
    }
    appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.firstCardPrimed');
    await delay(400);
  }

  /** Step21：等结果图 decode + 尺寸稳定后再右键，避免复制到未加载完的低清/空图 */
  async function ensureJimengResultImageReadyForCopy(imgEl, roundId, stepKey) {
    var deadline = Date.now() + 35000;
    var MIN_WH = 120;
    var lastKey = '';
    var stableSince = 0;
    var STABLE_NEED_MS = 500;
    while (Date.now() < deadline) {
      if (!imgEl || imgEl.tagName !== 'IMG') return false;
      try {
        if (imgEl.decode && typeof imgEl.decode === 'function') {
          await imgEl.decode();
        }
      } catch (eD) {
        /* ignore */
      }
      var nw = imgEl.naturalWidth || 0;
      var nh = imgEl.naturalHeight || 0;
      var now = Date.now();
      if (imgEl.complete && nw >= MIN_WH && nh >= MIN_WH) {
        var key = nw + 'x' + nh;
        if (key === lastKey) {
          if (now - stableSince >= STABLE_NEED_MS) {
            await delay(550);
            return true;
          }
        } else {
          lastKey = key;
          stableSince = now;
        }
      } else {
        lastKey = '';
        stableSince = 0;
      }
      await delay(130);
    }
    appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.imgReadyTimeout');
    return false;
  }

  function dispatchSyntheticContextMenu(el, cx, cy) {
    var base = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: cx,
      clientY: cy,
      button: 2,
      buttons: 2,
    };
    if (typeof PointerEvent !== 'undefined') {
      try {
        var pi = {
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          width: 1,
          height: 1,
          pressure: 0.5,
        };
        el.dispatchEvent(new PointerEvent('pointerdown', Object.assign({}, base, pi)));
        el.dispatchEvent(new MouseEvent('mousedown', base));
        el.dispatchEvent(new MouseEvent('contextmenu', base));
        el.dispatchEvent(new PointerEvent('pointerup', Object.assign({}, base, pi, { pressure: 0 })));
        el.dispatchEvent(new MouseEvent('mouseup', base));
        return;
      } catch (ePtr) {
        /* fall through */
      }
    }
    el.dispatchEvent(new MouseEvent('mousedown', base));
    el.dispatchEvent(new MouseEvent('contextmenu', base));
    el.dispatchEvent(new MouseEvent('mouseup', base));
  }

  function isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return false;
    var st = doc.defaultView && doc.defaultView.getComputedStyle ? doc.defaultView.getComputedStyle(el) : null;
    if (st && (st.visibility === 'hidden' || st.display === 'none')) return false;
    return true;
  }

  function findMenuItemCopyImageExact(root) {
    var walk = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    var v;
    while ((n = walk.nextNode())) {
      v = n.nodeValue != null ? String(n.nodeValue).trim() : '';
      if (v === '复制图片' || v === '复制图像') {
        return n.parentElement || null;
      }
      if (/^复制\s*图片$/.test(v)) {
        return n.parentElement || null;
      }
      if (v === 'Copy image' || v === 'Copy Image') {
        return n.parentElement || null;
      }
    }
    return null;
  }

  function findVisibleJimengContextMenuWithCopy() {
    var divs = doc.querySelectorAll('div');
    var i;
    var d;
    var cls;
    var itemEl;
    var hit;
    for (i = 0; i < divs.length; i++) {
      d = divs[i];
      cls = (d.className && String(d.className)) || '';
      if (cls.indexOf('context-menu-') === -1) continue;
      if (cls.indexOf('context-menu-trigger') !== -1) continue;
      if (!isElementVisible(d)) continue;
      itemEl = findMenuItemCopyImageExact(d);
      if (itemEl) return { menuRoot: d, itemEl: itemEl };
    }
    var menus = doc.querySelectorAll('[role="menu"], [role="listbox"]');
    for (i = 0; i < menus.length; i++) {
      d = menus[i];
      if (!isElementVisible(d)) continue;
      itemEl = findMenuItemCopyImageExact(d);
      if (itemEl) return { menuRoot: d, itemEl: itemEl };
    }
    var portalish = doc.querySelectorAll(
      'div[class*="dropdown"], div[class*="Dropdown"], div[class*="popover"], div[class*="Popover"], div[class*="Popup"], div[class*="popup"]',
    );
    for (i = 0; i < portalish.length; i++) {
      d = portalish[i];
      cls = (d.className && String(d.className)) || '';
      if (cls.indexOf('context-menu-trigger') !== -1) continue;
      if (!isElementVisible(d)) continue;
      itemEl = findMenuItemCopyImageExact(d);
      if (itemEl) return { menuRoot: d, itemEl: itemEl };
    }
    var walk = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null);
    var n;
    var v;
    var up;
    var depth;
    while ((n = walk.nextNode())) {
      v = n.nodeValue != null ? String(n.nodeValue).trim() : '';
      if (v !== '复制图片' && v !== '复制图像' && v !== 'Copy image' && v !== 'Copy Image' && !/^复制\s*图片$/.test(v)) {
        continue;
      }
      itemEl = n.parentElement;
      if (!itemEl) continue;
      up = itemEl;
      depth = 0;
      while (up && depth < 18) {
        if (isElementVisible(up)) {
          cls = (up.className && String(up.className)) || '';
          if (
            (cls.indexOf('context-menu-') !== -1 && cls.indexOf('context-menu-trigger') === -1) ||
            cls.indexOf('dropdown') !== -1 ||
            cls.indexOf('Dropdown') !== -1 ||
            cls.indexOf('popover') !== -1 ||
            cls.indexOf('Popup') !== -1 ||
            cls.indexOf('popup') !== -1 ||
            up.getAttribute('role') === 'menu' ||
            up.getAttribute('role') === 'listbox'
          ) {
            hit = findMenuItemCopyImageExact(up);
            if (hit) return { menuRoot: up, itemEl: hit };
          }
        }
        up = up.parentElement;
        depth++;
      }
    }
    return null;
  }

  function jimengTextIndicatesCopyProgress(t) {
    if (!t || typeof t !== 'string') return false;
    return (
      t.indexOf('复制中') !== -1 ||
      t.indexOf('下载中') !== -1 ||
      t.indexOf('图片复制') !== -1 ||
      t.indexOf('正在复制') !== -1 ||
      t.indexOf('复制处理') !== -1
    );
  }

  /**
   * 点「复制图片」后的进度 UI：实际多为「复制中」+ `spin-*` + `loading-icon`，
   * 亦兼容旧版顶部 `lv-message-wrapper` 含「下载中」。
   */
  function findVisibleJimengCopyDownloadToast() {
    var i;
    var el;
    var t;
    var nodes = doc.querySelectorAll(
      '[class*="lv-message-wrapper"], [class*="arco-message"], [class*="semi-toast"], [class*="message-wrapper"]',
    );
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (!isElementVisible(el)) continue;
      t = el.textContent || '';
      if (jimengTextIndicatesCopyProgress(t)) return el;
    }
    nodes = doc.querySelectorAll('[class*="spin-message"]');
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (!isElementVisible(el)) continue;
      t = el.textContent || '';
      if (jimengTextIndicatesCopyProgress(t)) return el;
    }
    var svs = doc.querySelectorAll('svg[class*="loading-icon"]');
    var cur;
    var depth;
    for (i = 0; i < svs.length; i++) {
      cur = svs[i].parentElement;
      depth = 0;
      while (cur && depth < 14) {
        if (isElementVisible(cur)) {
          t = cur.textContent || '';
          if (
            jimengTextIndicatesCopyProgress(t) &&
            cur.querySelector &&
            cur.querySelector('[class*="spin-"]')
          ) {
            return cur;
          }
        }
        cur = cur.parentElement;
        depth++;
      }
    }
    return null;
  }

  /** 复制完成：全局 Message 成功态（Step21 在剪贴板前必等此条） */
  function jimengTextIndicatesCopySuccess(t) {
    if (!t || typeof t !== 'string') return false;
    return (
      t.indexOf('复制成功') !== -1 ||
      t.indexOf('已复制') !== -1 ||
      t.indexOf('复制完成') !== -1 ||
      t.indexOf('已拷贝') !== -1
    );
  }

  function findVisibleJimengCopySuccessToast() {
    var nodes = doc.querySelectorAll(
      '[class*="lv-message-success"], [class*="message-success"], [class*="arco-message-success"], [class*="arco-message"]',
    );
    var i;
    var el;
    var t;
    for (i = 0; i < nodes.length; i++) {
      el = nodes[i];
      if (!isElementVisible(el)) continue;
      t = el.textContent || '';
      if (jimengTextIndicatesCopySuccess(t)) return el;
    }
    return null;
  }

  function tryDismissJimengFloatingUi() {
    try {
      doc.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
      );
      doc.dispatchEvent(
        new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
      );
    } catch (eEsc) {
      /* ignore */
    }
  }

  function waitJimengClipboardReadFromIsolatedWorld(roundId, previousImageBase64, timeoutMs) {
    return new Promise(function (resolve) {
      var reqId =
        'jimeng_clip_' +
        String(roundId).slice(0, 8) +
        '_' +
        Date.now() +
        '_' +
        Math.random().toString(36).slice(2, 9);
      var finished = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        var p = ev.data;
        if (!p || p.picpuckBridge !== true || p.kind !== 'JIMENG_CLIPBOARD_READ_RESULT') return;
        if (p.requestId !== reqId) return;
        window.removeEventListener('message', onMsg);
        finished = true;
        resolve(p);
      }
      window.addEventListener('message', onMsg);
      try {
        window.postMessage(
          {
            picpuckBridge: true,
            kind: 'JIMENG_CLIPBOARD_READ_ARM',
            requestId: reqId,
            roundId: roundId,
            previousImageBase64: typeof previousImageBase64 === 'string' ? previousImageBase64 : '',
          },
          location.origin,
        );
      } catch (e1) {
        window.removeEventListener('message', onMsg);
        resolve({ ok: false, code: 'JIMENG_CLIPBOARD_IMAGE_TIMEOUT' });
        return;
      }
      setTimeout(function () {
        if (finished) return;
        window.removeEventListener('message', onMsg);
        resolve({ ok: false, code: 'JIMENG_CLIPBOARD_IMAGE_TIMEOUT' });
      }, timeoutMs);
    });
  }

  /** @param {{ roundId: string, jimengSubmitMode?: string }} payload */
  async function runStep18SubmitPromptEnterIfConfigured(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step18_jimeng_submit_prompt_enter_if_configured';
    if (!payload || payload.jimengSubmitMode !== 'enter') {
      appendMainLog(roundId, stepKey, 'info', 'Step18.非Enter提交模式+未在提示词区派发Enter');
      return { ok: true, skipped: true };
    }
    var target = findJimengPromptField();
    if (!target) {
      appendMainLog(roundId, stepKey, 'info', 'Step18.动作失败+未找到提示词输入区域');
      return { ok: false, code: 'JIMENG_PROMPT_FIELD_NOT_FOUND' };
    }
    try {
      target.focus();
    } catch (e0) {
      /* ignore */
    }
    var evDown = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    });
    var evUp = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(evDown);
    target.dispatchEvent(evUp);
    appendMainLog(roundId, stepKey, 'info', 'Step18.已在提示词区派发 Enter 键提交');
    return { ok: true };
  }

  /** @param {{ roundId: string, enterAtMs: number }} payload */
  async function runStep19WaitGenerationStarted(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step19_jimeng_wait_generation_started';
    var enterAtMs = payload && typeof payload.enterAtMs === 'number' ? payload.enterAtMs : Date.now();
    var deadlineStart = enterAtMs + 120000;
    while (Date.now() < deadlineStart) {
      var root = resolveJimengRecordRoot(doc, null);
      if (root && isJimengRecordGenerating(root)) {
        var jimengRecordAnchor = extractJimengRecordAnchorFromRoot(root);
        if (jimengRecordAnchor && jimengRecordAnchor.dataId) {
          appendMainLog(
            roundId,
            stepKey,
            'debug',
            'Step19.debug.jimengRecordAnchor dataId=' + jimengRecordAnchor.dataId.slice(0, 8) + '…',
          );
        }
        appendMainLog(roundId, stepKey, 'info', 'Step19.已检测到生成中状态');
        return { ok: true, jimengRecordAnchor: jimengRecordAnchor || undefined };
      }
      await delay(200);
    }
    appendMainLog(roundId, stepKey, 'info', 'Step19.动作失败+等待生成开始超时');
    return { ok: false, code: 'JIMENG_GENERATE_START_TIMEOUT' };
  }

  /** @param {{ roundId: string, enterAtMs: number, expectCount?: number }} payload */
  async function runStep20WaitGenerationFinished(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step20_jimeng_wait_generation_finished';
    var anchor = payload && payload.jimengRecordAnchor;
    var enterAtMs = payload && typeof payload.enterAtMs === 'number' ? payload.enterAtMs : Date.now();
    var deadlineTotal = enterAtMs + 600000;
    var lastSlotCount = -1;
    var tick = 0;
    while (Date.now() < deadlineTotal) {
      var root = resolveJimengRecordRoot(doc, anchor);
      if (!root) {
        await delay(350);
        continue;
      }
      if (isJimengRecordGenerating(root)) {
        lastSlotCount = -1;
        await delay(350);
        continue;
      }
      var slots = listJimengResultCardSlotElements(root);
      var slotCount = slots.length;
      if (tick % 3 === 0) {
        nudgeJimengLazyResultCardsIntoView(root, slots);
      }
      var valid = listJimengResultImagesOrdered(root);
      if (slotCount >= 1) {
        if (slotCount !== lastSlotCount) {
          lastSlotCount = slotCount;
          appendMainLog(roundId, stepKey, 'debug', 'Step20.debug.resultSlots=' + slotCount + ' valid=' + valid.length);
        }
        if (valid.length === slotCount) {
          appendMainLog(roundId, stepKey, 'info', 'Step20.生成完成+有效结果图张数=' + valid.length);
          return { ok: true, n: valid.length };
        }
      } else if (valid.length >= 1) {
        appendMainLog(roundId, stepKey, 'info', 'Step20.生成完成+有效结果图张数=' + valid.length);
        return { ok: true, n: valid.length };
      }
      tick++;
      await delay(400);
    }
    var root2 = resolveJimengRecordRoot(doc, anchor);
    if (root2 && !isJimengRecordGenerating(root2)) {
      var slots2 = listJimengResultCardSlotElements(root2);
      var v2 = listJimengResultImagesOrdered(root2);
      if (slots2.length >= 1 && v2.length < slots2.length) {
        appendMainLog(
          roundId,
          stepKey,
          'info',
          'Step20.动作失败+结果图未全部加载 slots=' + slots2.length + ' valid=' + v2.length,
        );
        appendMainLog(roundId, stepKey, 'debug', 'Step20.debug.JIMENG_RESULT_LAZY_TIMEOUT');
        return { ok: false, code: 'JIMENG_RESULT_LAZY_TIMEOUT' };
      }
      if (v2.length === 0) {
        appendMainLog(roundId, stepKey, 'info', 'Step20.动作失败+生成结束但无有效结果图');
        return { ok: false, code: 'JIMENG_GENERATE_NO_OUTPUT' };
      }
    }
    appendMainLog(roundId, stepKey, 'info', 'Step20.动作失败+等待生成完成超时');
    return { ok: false, code: 'JIMENG_GENERATE_WAIT_TIMEOUT' };
  }

  /** 无 step20 时由 SW 调用：与 Step20 一致，等槽位与已 decode 张数对齐后再报 n。 */
  async function runJimengCountNewestRecordImages(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step21_jimeng_infer_n_from_dom';
    var anchor = payload && payload.jimengRecordAnchor;
    var inferDeadline = Date.now() + 30000;
    var lastLogSlots = -1;
    while (Date.now() < inferDeadline) {
      var root = resolveJimengRecordRoot(doc, anchor);
      if (!root) break;
      var slots = listJimengResultCardSlotElements(root);
      var sc = slots.length;
      nudgeJimengLazyResultCardsIntoView(root, slots);
      var valid = listJimengResultImagesOrdered(root);
      if (sc >= 1) {
        if (sc !== lastLogSlots) {
          lastLogSlots = sc;
          appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.inferNFromDom slots=' + sc + ' valid=' + valid.length);
        }
        if (valid.length === sc) {
          appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.inferNFromDom n=' + valid.length);
          return { ok: true, n: valid.length };
        }
      } else if (valid.length >= 1) {
        appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.inferNFromDom n=' + valid.length);
        return { ok: true, n: valid.length };
      }
      await delay(400);
    }
    var root2 = resolveJimengRecordRoot(doc, anchor);
    var slots2 = listJimengResultCardSlotElements(root2);
    var imgs = listJimengResultImagesOrdered(root2);
    var n = imgs.length;
    appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.inferNFromDom fallback n=' + n + ' slots=' + slots2.length);
    if (n < 1) {
      appendMainLog(roundId, stepKey, 'info', 'Step21.动作失败+未找到最新记录上的结果图');
      return { ok: false, code: 'JIMENG_GENERATE_NO_OUTPUT' };
    }
    if (slots2.length >= 1 && n < slots2.length) {
      appendMainLog(roundId, stepKey, 'info', 'Step21.动作失败+结果图未全部加载 slots=' + slots2.length + ' valid=' + n);
      return { ok: false, code: 'JIMENG_RESULT_LAZY_TIMEOUT' };
    }
    return { ok: true, n: n };
  }

  var STEP21_TAB_ACTIVATE_MAX_WAIT_MS = 25000;
  var STEP21_TAB_VISIBLE_SETTLE_MS = 400;

  /**
   * Step21 右键/剪贴板依赖前台 Tab；MAIN 无 chrome.*，经 postMessage → SW `focusWorkTab`，再等到 `visibilityState===visible`。
   * @param {string} roundId
   * @param {string} stepKey
   */
  async function ensureJimengWorkTabVisibleForStep21Collect(roundId, stepKey) {
    if (!document.hidden && document.visibilityState === 'visible') {
      await delay(STEP21_TAB_VISIBLE_SETTLE_MS);
      appendMainLog(roundId, stepKey, 'info', 'Step21.info.alreadyVisibleSkipActivate');
      return { ok: true };
    }
    try {
      window.postMessage(
        {
          picpuckBridge: true,
          kind: 'JIMENG_REQUEST_ACTIVATE_TAB_FOR_COLLECT',
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
      'Step21.info.requestActivateBeforeCollect hidden=' + (document.hidden ? '1' : '0'),
    );
    var deadline = Date.now() + STEP21_TAB_ACTIVATE_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      if (!document.hidden && document.visibilityState === 'visible') {
        await delay(STEP21_TAB_VISIBLE_SETTLE_MS);
        appendMainLog(roundId, stepKey, 'info', 'Step21.info.tabVisibleSettled');
        return { ok: true };
      }
      await delay(100);
    }
    appendMainLog(roundId, stepKey, 'info', 'Step21.动作失败+等待工作Tab置前超时');
    return { ok: false, code: 'JIMENG_COLLECT_TAB_ACTIVATE_TIMEOUT' };
  }

  /** @param {{ roundId: string, n: number }} payload */
  async function runStep21CollectImagesViaContextMenu(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var stepKey = 'step21_jimeng_collect_images_via_context_menu';
    var anchor = payload && payload.jimengRecordAnchor;
    var n = payload && typeof payload.n === 'number' ? payload.n : 0;
    if (n < 1) {
      appendMainLog(roundId, stepKey, 'info', 'Step21.动作失败+结果图张数无效');
      return { ok: false, code: 'JIMENG_GENERATE_NO_OUTPUT' };
    }
    var visRes = await ensureJimengWorkTabVisibleForStep21Collect(roundId, stepKey);
    if (!visRes || visRes.ok !== true) {
      return visRes || { ok: false, code: 'JIMENG_COLLECT_TAB_ACTIVATE_TIMEOUT' };
    }
    appendMainLog(roundId, stepKey, 'info', 'Step21.开始从即梦结果区逐张复制图片+目标张数=' + n);
    var alignDeadline = Date.now() + 20000;
    var imgs0 = [];
    var root0 = null;
    while (Date.now() < alignDeadline) {
      root0 = resolveJimengRecordRoot(doc, anchor);
      if (root0) {
        nudgeJimengLazyResultCardsIntoView(root0, listJimengResultCardSlotElements(root0));
      }
      imgs0 = listJimengResultImagesOrdered(root0);
      if (imgs0.length >= n) break;
      await delay(400);
    }
    if (imgs0.length < n) {
      appendMainLog(roundId, stepKey, 'info', 'Step21.动作失败+结果图数量不足 need=' + n + ' have=' + imgs0.length);
      return { ok: false, code: 'JIMENG_GENERATE_NO_OUTPUT' };
    }
    var collected = [];
    var prevB64 = '';
    var ii;
    for (ii = 0; ii < n; ii++) {
      var rootFresh = resolveJimengRecordRoot(doc, anchor);
      var imgsFresh = listJimengResultImagesOrdered(rootFresh);
      if (imgsFresh.length <= ii) {
        appendMainLog(roundId, stepKey, 'info', 'Step21.动作失败+结果图数量不足');
        return { ok: false, code: 'JIMENG_GENERATE_NO_OUTPUT' };
      }
      var imgEl = imgsFresh[ii];
      var readyOk = await ensureJimengResultImageReadyForCopy(imgEl, roundId, stepKey);
      if (!readyOk) {
        appendMainLog(roundId, stepKey, 'info', 'Step21.动作失败+结果图未加载完成');
        return { ok: false, code: 'JIMENG_GENERATE_NO_OUTPUT' };
      }
      appendMainLog(
        roundId,
        stepKey,
        'debug',
        'Step21.debug.imgReady idx=' + ii + ' ' + imgEl.naturalWidth + 'x' + imgEl.naturalHeight,
      );
      var pick = resolveContextMenuDispatchTarget(imgEl);
      appendMainLog(
        roundId,
        stepKey,
        'debug',
        'Step21.debug.contextmenuTarget idx=' + ii + ' via=' + pick.via + ' degraded=' + pick.degraded,
      );
      var card = pick.target;
      if (ii === 0) {
        await primeJimengFirstResultCardBeforeContextMenu(card, imgEl, roundId, stepKey);
      }
      var rCard = card.getBoundingClientRect();
      var cx = rCard.left + Math.min(rCard.width / 2, 120);
      var cy = rCard.top + Math.min(rCard.height / 2, 120);
      var COPY_RETRY_MAX = 3;
      var COPY_PROGRESS_WAIT_MS = 2000;
      var COPY_SUCCESS_WAIT_MS = 45000;
      var clipReadMs = 20000;
      var copyAttempt = 0;
      var clipRes = null;
      copyRetry: while (copyAttempt < COPY_RETRY_MAX) {
        copyAttempt++;
        tryDismissJimengFloatingUi();
        await delay(220);
        try {
          dispatchSyntheticContextMenu(card, cx, cy);
        } catch (eCm) {
          appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.contextmenuErr ' + (eCm && eCm.message));
          return { ok: false, code: 'JIMENG_CONTEXT_MENU_FAILED' };
        }
        await delay(500);
        var menuFound = null;
        var tMenu = Date.now() + 8000;
        while (Date.now() < tMenu) {
          menuFound = findVisibleJimengContextMenuWithCopy();
          if (menuFound) break;
          await delay(80);
        }
        if (!menuFound) {
          appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.noCopyMenu attempt=' + copyAttempt);
          if (copyAttempt >= COPY_RETRY_MAX) {
            appendMainLog(roundId, stepKey, 'info', 'Step21.动作失败+未找到复制图片菜单');
            return { ok: false, code: 'JIMENG_CONTEXT_MENU_FAILED' };
          }
          await delay(400);
          continue copyRetry;
        }
        await delay(500);
        var menuNow = findVisibleJimengContextMenuWithCopy();
        if (!menuNow) {
          appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.menuVanishedAfterSettle a=' + copyAttempt);
          if (copyAttempt >= COPY_RETRY_MAX) {
            return { ok: false, code: 'JIMENG_CONTEXT_MENU_FAILED' };
          }
          await delay(400);
          continue copyRetry;
        }
        try {
          var clickEl = menuNow.itemEl;
          if (clickEl && clickEl.click) clickEl.click();
          else menuNow.menuRoot.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } catch (eCk) {
          if (copyAttempt >= COPY_RETRY_MAX) return { ok: false, code: 'JIMENG_CONTEXT_MENU_FAILED' };
          await delay(400);
          continue copyRetry;
        }
        await delay(120);
        var sawProgress = false;
        var tProg = Date.now() + COPY_PROGRESS_WAIT_MS;
        while (Date.now() < tProg) {
          if (findVisibleJimengCopyDownloadToast()) {
            sawProgress = true;
            break;
          }
          await delay(45);
        }
        if (!sawProgress) {
          appendMainLog(
            roundId,
            stepKey,
            'debug',
            'Step21.debug.copyNoProgressToast2s a=' + copyAttempt,
          );
          if (copyAttempt >= COPY_RETRY_MAX) {
            appendMainLog(roundId, stepKey, 'info', 'Step21.动作失败+复制后未出现复制中或下载中进度提示');
            return { ok: false, code: 'JIMENG_CONTEXT_MENU_FAILED' };
          }
          await delay(400);
          continue copyRetry;
        }
        appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.sawCopyProgressToast a=' + copyAttempt);
        var sawSuccessToast = false;
        var tOk = Date.now() + COPY_SUCCESS_WAIT_MS;
        while (Date.now() < tOk) {
          if (findVisibleJimengCopySuccessToast()) {
            sawSuccessToast = true;
            break;
          }
          await delay(90);
        }
        if (!sawSuccessToast) {
          appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.copySuccessToastTimeout a=' + copyAttempt);
          if (copyAttempt >= COPY_RETRY_MAX) {
            appendMainLog(roundId, stepKey, 'info', 'Step21.动作失败+复制后未出现复制成功提示');
            return { ok: false, code: 'JIMENG_CONTEXT_MENU_FAILED' };
          }
          await delay(400);
          continue copyRetry;
        }
        appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.sawCopySuccessToast a=' + copyAttempt);
        await delay(250);
        clipRes = await waitJimengClipboardReadFromIsolatedWorld(roundId, prevB64, clipReadMs);
        if (!clipRes || !clipRes.ok || typeof clipRes.imageBase64 !== 'string' || !clipRes.imageBase64) {
          appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.clipboardEmptyOrTimeout firstPass a=' + copyAttempt);
          await delay(400);
          clipRes = await waitJimengClipboardReadFromIsolatedWorld(roundId, prevB64, clipReadMs);
        }
        if (clipRes && clipRes.ok && typeof clipRes.imageBase64 === 'string' && clipRes.imageBase64) {
          break copyRetry;
        }
        appendMainLog(roundId, stepKey, 'debug', 'Step21.debug.clipboardRetryAfterToast a=' + copyAttempt);
        if (copyAttempt >= COPY_RETRY_MAX) {
          appendMainLog(roundId, stepKey, 'info', 'Step21.动作失败+剪贴板读取图片超时或失败');
          return { ok: false, code: clipRes && clipRes.code ? clipRes.code : 'JIMENG_CLIPBOARD_IMAGE_TIMEOUT' };
        }
        await delay(500);
      }
      prevB64 = clipRes.imageBase64;
      collected.push({
        imageBase64: clipRes.imageBase64,
        contentType: typeof clipRes.contentType === 'string' && clipRes.contentType ? clipRes.contentType : 'image/png',
      });
      await delay(200);
    }
    appendMainLog(roundId, stepKey, 'info', 'Step21.已从剪贴板收集即梦结果图+张数=' + collected.length);
    return { ok: true, images: collected };
  }

  /** RECOVER：在页内轮询直至结果区可观测（结构槽位 / https 槽位 / 完成态文案）或超时，避免 SW 一进来就读空 DOM。 */
  var RECOVER_DOM_READY_TIMEOUT_MS = 45000;
  var RECOVER_DOM_READY_POLL_MS = 400;
  var RECOVER_DOM_READY_LOG_EVERY_MS = 8000;

  /**
   * @param {string} roundId
   * @param {string} stepKey
   * @param {{ dataId?: string, recordItemId?: string, promptPreview?: string }} anchor
   * @returns {Promise<Element|null>}
   */
  async function awaitJimengRecoverDomReadyForObservation(roundId, stepKey, anchor) {
    var deadline = Date.now() + RECOVER_DOM_READY_TIMEOUT_MS;
    var lastRoot = null;
    var lastLogAt = 0;
    while (Date.now() < deadline) {
      var root = resolveJimengRecordRoot(doc, anchor);
      lastRoot = root;
      if (!root) {
        await delay(RECOVER_DOM_READY_POLL_MS);
        continue;
      }
      if (isJimengRecordGenerating(root)) {
        await delay(RECOVER_DOM_READY_POLL_MS);
        continue;
      }
      var st = countJimengStructuralResultSlots(root);
      var httpsN = listJimengResultCardSlotElements(root).length;
      if (st >= 1 || httpsN >= 1 || hasJimengRecordPostGenerateOperations(root)) {
        appendMainLog(
          roundId,
          stepKey,
          'debug',
          'Step04.debug.recoverDomReady structural=' + st + ' httpsSlots=' + httpsN,
        );
        return root;
      }
      var now = Date.now();
      if (now - lastLogAt >= RECOVER_DOM_READY_LOG_EVERY_MS) {
        lastLogAt = now;
        appendMainLog(roundId, stepKey, 'info', 'Step04.info.等待结果区挂载或生成结束');
      }
      await delay(RECOVER_DOM_READY_POLL_MS);
    }
    appendMainLog(roundId, stepKey, 'info', 'Step04.info.等待结果DOM超时+按当前DOM继续检查');
    return lastRoot;
  }

  /**
   * 异步第二阶段单次轮询：按锚点定位记录；仍在生成则 not_ready。
   * 就绪判定不依赖图片已加载（未激活 Tab 下 lazy 可无 src），用结构槽位与「再次生成」等完成态；取图仍由 Step21 在页内等待 decode。
   * @param {{ roundId?: string, jimengRecordAnchor?: { dataId?: string, recordItemId?: string, promptPreview?: string } }} payload
   * @returns {Promise<{ ok: boolean, code?: string, outcome?: 'not_ready'|'ready', images?: Array<{ imageBase64: string, contentType?: string }> }>}
   */
  async function runJimengRecoverPipeline(payload) {
    var roundId = payload && payload.roundId ? payload.roundId : '';
    var anchor = payload && payload.jimengRecordAnchor;
    var stepKey = 'step04_jimeng_recover_fetch';
    var recoverDomVerbose = !!(payload && payload.recoverDomVerbose);
    if (!anchor || typeof anchor !== 'object') {
      return { ok: false, code: 'JIMENG_RECOVER_NO_ANCHOR' };
    }
    var did = anchor.dataId && String(anchor.dataId).trim();
    var rid = anchor.recordItemId && String(anchor.recordItemId).trim();
    if (!did && !rid) {
      return { ok: false, code: 'JIMENG_RECOVER_NO_ANCHOR' };
    }
    var root = await awaitJimengRecoverDomReadyForObservation(roundId, stepKey, anchor);
    var dbgItemByDid = 0;
    var dbgIdElVisible = false;
    if (did) {
      try {
        var escDbg = String(did).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        dbgItemByDid = doc.querySelectorAll('div[class*="item-"][data-id="' + escDbg + '"]').length;
      } catch (eDbg) {
        dbgItemByDid = -1;
      }
    }
    if (rid) {
      try {
        var elById = doc.getElementById(rid);
        dbgIdElVisible = !!(elById && isJimengRecordRootVisible(elById));
      } catch (eId) {
        dbgIdElVisible = false;
      }
    }
    var docApmTotal = 0;
    var rootApmTotal = 0;
    try {
      docApmTotal = doc.querySelectorAll('img[data-apm-action="ai-generated-image-record-card"]').length;
    } catch (eApmDoc) {
      docApmTotal = -1;
    }
    if (root) {
      try {
        rootApmTotal = root.querySelectorAll('img[data-apm-action="ai-generated-image-record-card"]').length;
      } catch (eApmRoot) {
        rootApmTotal = -1;
      }
    }
    if (!root) {
      logRecoverDomSnapshot(recoverDomVerbose, roundId, stepKey, 'no_root', doc, null, anchor, {});
      appendMainLog(roundId, stepKey, 'info', 'Step04.即梦记录未出现在DOM');
      return { ok: true, outcome: 'not_ready' };
    }
    if (isJimengRecordGenerating(root)) {
      logRecoverDomSnapshot(recoverDomVerbose, roundId, stepKey, 'still_generating', doc, root, anchor, { isGenerating: true });
      appendMainLog(roundId, stepKey, 'info', 'Step04.即梦仍在生成中');
      return { ok: true, outcome: 'not_ready' };
    }
    var scopeEl = jimengResultImagesScopeElement(root);
    var apmForNudge = [];
    if (scopeEl) {
      var apmQ = scopeEl.querySelectorAll('img[data-apm-action="ai-generated-image-record-card"]');
      var zi;
      for (zi = 0; zi < apmQ.length; zi++) apmForNudge.push(apmQ[zi]);
    }
    var slotsHttps = listJimengResultCardSlotElements(root);
    nudgeJimengLazyResultCardsIntoView(root, apmForNudge.length ? apmForNudge : slotsHttps);
    /** recover 就绪：不依赖图片已加载（未激活 Tab lazy 无 https）；用结构槽位数 + 完成态文案兜底 */
    var structuralN = countJimengStructuralResultSlots(root);
    var n = Math.max(structuralN, slotsHttps.length);
    if (n < 1 && hasJimengRecordPostGenerateOperations(root)) {
      n = 1;
    }
    var validDecoded = listJimengResultImagesOrdered(root);
    if (n < 1) {
      logRecoverDomSnapshot(recoverDomVerbose, roundId, stepKey, 'no_result_slots', doc, root, anchor, {
        slotsCount: slotsHttps.length,
        validCount: validDecoded.length,
        slotImgs: summarizeImgNodesForRecoverLog(slotsHttps),
        validImgs: summarizeImgNodesForRecoverLog(validDecoded),
      });
      appendMainLog(roundId, stepKey, 'info', 'Step04.即梦记录上尚无结果槽位或未完成');
      return { ok: true, outcome: 'not_ready' };
    }
    /** 后台 Tab：结构槽齐但 decode 为 0；全量回收前 Step21 会请求激活 Tab。探查阶段 probeOnly 时仍报 ready，由后续 RELAY 轮聚焦再收集。 */
    var probeOnly = !!(payload && payload.probeOnly === true);
    if (n >= 1 && validDecoded.length < 1 && document.hidden) {
      if (!probeOnly) {
        appendMainLog(
          roundId,
          stepKey,
          'info',
          'Step04.info.后台Tab无已解码结果图+Step21暂不执行+延后取回 structuralN=' +
            structuralN +
            ' httpsSlots=' +
            slotsHttps.length,
        );
        logRecoverDomBrief(roundId, stepKey, 'hidden_tab_no_decoded_for_step21', doc, root, anchor, {
          slotsCount: slotsHttps.length,
          validCount: validDecoded.length,
          structuralN: structuralN,
          n: n,
        });
        return { ok: true, outcome: 'not_ready' };
      }
      appendMainLog(
        roundId,
        stepKey,
        'info',
        'Step04.info.probeOnly.hiddenStructuralReady structuralN=' + structuralN + ' httpsSlots=' + slotsHttps.length,
      );
    }
    logRecoverDomSnapshot(recoverDomVerbose, roundId, stepKey, 'before_step21_collect', doc, root, anchor, {
      slotsCount: slotsHttps.length,
      validCount: validDecoded.length,
      structuralN: structuralN,
      n: n,
      slotImgs: summarizeImgNodesForRecoverLog(slotsHttps),
      validImgs: summarizeImgNodesForRecoverLog(validDecoded),
    });
    if (probeOnly) {
      appendMainLog(roundId, stepKey, 'info', 'Step04.info.probeOnlyDone outcome=ready n=' + n);
      return { ok: true, outcome: 'ready' };
    }
    var collectPayload = {
      roundId: roundId,
      n: n,
      jimengSubmitMode: 'enter',
      jimengRecordAnchor: anchor,
    };
    var colRes = await runStep21CollectImagesViaContextMenu(collectPayload);
    if (!colRes || colRes.ok !== true) {
      return colRes;
    }
    return { ok: true, outcome: 'ready', images: colRes.images };
  }

  /** 页内 watcher：控制台打印当前观测 scope 片段；与 runJimengRecoverPipeline 就绪判定一致（结构槽 / https 槽 / 再次生成） */
  var WATCH_SCOPE_HTML_MAX = 6000;
  var WATCH_MAX_TICKS_NO_FORGE = 36;

  function buildJimengRecoverWatcherSnapshot(anchor) {
    var root = resolveJimengRecordRoot(doc, anchor);
    var docApmTotal = 0;
    try {
      docApmTotal = doc.querySelectorAll('img[data-apm-action="ai-generated-image-record-card"]').length;
    } catch (eApm) {
      docApmTotal = -1;
    }
    var out = {
      ts: Date.now(),
      rootFound: !!root,
      generating: false,
      structuralN: 0,
      httpsSlots: 0,
      n: 0,
      ready: false,
      docApmTotal: docApmTotal,
      rootApmTotal: 0,
      scopeTag: '',
      scopeClassTail: '',
      scopeHtmlSnip: '',
      hidden: !!document.hidden,
      visibilityState: typeof document.visibilityState === 'string' ? document.visibilityState : '',
    };
    if (!root) return out;
    try {
      out.rootApmTotal = root.querySelectorAll('img[data-apm-action="ai-generated-image-record-card"]').length;
    } catch (eR) {
      out.rootApmTotal = -1;
    }
    if (isJimengRecordGenerating(root)) {
      out.generating = true;
      return out;
    }
    var structuralN = countJimengStructuralResultSlots(root);
    var slotsHttps = listJimengResultCardSlotElements(root);
    var httpsN = slotsHttps.length;
    var n = Math.max(structuralN, httpsN);
    if (n < 1 && hasJimengRecordPostGenerateOperations(root)) n = 1;
    out.structuralN = structuralN;
    out.httpsSlots = httpsN;
    out.n = n;
    out.ready = n >= 1;
    var scopeEl = jimengResultImagesScopeElement(root);
    if (scopeEl) {
      out.scopeTag = scopeEl.tagName || '';
      var cn = scopeEl.className && String(scopeEl.className);
      out.scopeClassTail = cn ? truncateRecoverLogStr(cn, 200) : '';
      var html = scopeEl.outerHTML || '';
      out.scopeHtmlSnip = truncateRecoverLogStr(html, WATCH_SCOPE_HTML_MAX);
    }
    return out;
  }

  /**
   * document load 完成后等待 1s 首次检测；未就绪则每 5s 再测。就绪后 postMessage → 扩展触发 RECOVER。
   * @param {{ roundId?: string, async_job_id?: string, forgeCallerTabId?: number, recoverPayload?: Record<string, unknown> }} packed
   */
  function startJimengRecoverPageWatcher(packed) {
    var prevStop = g.__picpuckJimengRecoverWatcherStop;
    if (typeof prevStop === 'function') {
      try {
        prevStop();
      } catch (ePrev) {}
    }
    var stopped = false;
    g.__picpuckJimengRecoverWatcherStop = function () {
      stopped = true;
    };
    var rp = packed && packed.recoverPayload;
    var anchor = rp && rp.jimengRecordAnchor;
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
        var snap = buildJimengRecoverWatcherSnapshot(anchor);
        snap.tick = tick;
        snap.async_job_id = asyncJob;
        snap.roundId = roundId;
        try {
          console.log('[PicPuck][JimengRecoverWatch]', JSON.stringify(snap));
        } catch (eStr) {}

        if (stopped) break;

        if (snap.ready && forgeTab > 0) {
          var rootNow = resolveJimengRecordRoot(doc, anchor);
          var freshAnchor = rootNow ? extractJimengRecordAnchorFromRoot(rootNow) : null;
          var basePayload = rp && typeof rp === 'object' ? rp : {};
          var mergedPayload = {};
          var k;
          for (k in basePayload) {
            if (Object.prototype.hasOwnProperty.call(basePayload, k)) {
              mergedPayload[k] = basePayload[k];
            }
          }
          if (freshAnchor && typeof freshAnchor === 'object') {
            mergedPayload.jimengRecordAnchor = freshAnchor;
          }
          try {
            window.postMessage(
              {
                picpuckBridge: true,
                kind: 'JIMENG_PAGE_RECOVER_READY',
                forgeCallerTabId: forgeTab,
                recoverPayload: mergedPayload,
              },
              location.origin,
            );
          } catch (ePm) {}
          appendMainLog(roundId, 'system', 'info', 'JimengRecoverWatch.firedRecover async_job_id=' + asyncJob);
          stopped = true;
          break;
        }

        if (forgeTab <= 0 && tick >= WATCH_MAX_TICKS_NO_FORGE) {
          appendMainLog(
            roundId,
            'system',
            'info',
            'JimengRecoverWatch.stopped_no_forgeCallerTabId ticks=' + tick,
          );
          stopped = true;
          break;
        }

        await delay(5000);
      }
    })();
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
    runStep18SubmitPromptEnterIfConfigured: runStep18SubmitPromptEnterIfConfigured,
    runStep19WaitGenerationStarted: runStep19WaitGenerationStarted,
    runStep20WaitGenerationFinished: runStep20WaitGenerationFinished,
    runJimengCountNewestRecordImages: runJimengCountNewestRecordImages,
    runStep21CollectImagesViaContextMenu: runStep21CollectImagesViaContextMenu,
    runJimengRecoverPipeline: runJimengRecoverPipeline,
    startJimengRecoverPageWatcher: startJimengRecoverPageWatcher,
  };
})();
