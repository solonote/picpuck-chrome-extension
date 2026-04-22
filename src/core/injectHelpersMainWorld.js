/**
 * MAIN 世界页内工具：由 `frameworkStep03_ensurePageHelpers` 经 `executeScript` + `files` 注入。
 * 挂载 `globalThis.__idlinkPicpuckInject`（dataURL→Blob、参考图 file input 收集等），供站点业务步骤使用。
 */
(function () {
  var g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (g.__idlinkPicpuckInject) return;
  g.__idlinkPicpuckInject = {
    /** 页首对齐；与站点无关，供各 agent 经 MAIN 调用 */
    scrollDocumentToTop: function () {
      try {
        window.scrollTo(0, 0);
        if (document.documentElement) document.documentElement.scrollTop = 0;
        if (document.body) document.body.scrollTop = 0;
        if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      } catch (e) {
        /* ignore */
      }
    },
    scrollDocumentToBottom: function () {
      try {
        var w = window;
        var g = w;
        var bi;
        var btn;
        var tx;
        var r;
        var st;
        var buttons = document.querySelectorAll('button.lv-btn');
        for (bi = 0; bi < buttons.length; bi++) {
          btn = buttons[bi];
          if (!btn || btn.tagName !== 'BUTTON' || btn.disabled) continue;
          tx = btn.textContent || '';
          if (tx.indexOf('回到底部') === -1) continue;
          r = btn.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          st = g.getComputedStyle(btn);
          if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) continue;
          btn.click();
          break;
        }
        /* 虚拟列表滚动轴：用 scroll-container 语义前缀，勿写死 scroll-container-xxxxx 整段类名 */
        var sc =
          document.querySelector('[class*="record-list-container"] [class*="scroll-container"]') ||
          document.querySelector('[class*="record-virtual-list"] [class*="scroll-container"]') ||
          document.querySelector('#dreamina-ui-configuration-content-wrapper [class*="scroll-container"]');
        if (sc && sc.scrollHeight > sc.clientHeight + 4) {
          var mt = Math.max(0, (sc.scrollHeight || 0) - (sc.clientHeight || 0));
          sc.scrollTop = Math.max(sc.scrollTop || 0, mt);
        }
        var innerH = w.innerHeight || 0;
        var se = document.scrollingElement || document.documentElement;
        var b = document.body;
        var docH = 0;
        if (se) docH = Math.max(docH, se.scrollHeight || 0);
        if (b) docH = Math.max(docH, b.scrollHeight || 0);
        var maxWin = Math.max(0, docH - innerH);
        var y = w.scrollY != null ? w.scrollY : w.pageYOffset;
        w.scrollTo(0, Math.max(y, maxWin));
        if (se) {
          var t = Math.max(0, (se.scrollHeight || 0) - (se.clientHeight || innerH));
          se.scrollTop = Math.max(se.scrollTop || 0, t);
        }
        if (b && b !== se) {
          var tb = Math.max(0, (b.scrollHeight || 0) - (b.clientHeight || 0));
          b.scrollTop = Math.max(b.scrollTop || 0, tb);
        }
      } catch (e2) {
        /* ignore */
      }
    },
    dataUrlToBlob: function (dataUrl) {
      if (!dataUrl || typeof dataUrl !== 'string') return null;
      var match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) return null;
      var type = match[1] || 'image/png';
      try {
        var bin = atob(match[2]);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: type });
      } catch (e) {
        return null;
      }
    },
    imageFileFromBlob: function (blob, index1Based) {
      var ext = 'png';
      var mime = (blob && blob.type) || '';
      if (mime.indexOf('jpeg') !== -1 || mime.indexOf('jpg') !== -1) ext = 'jpg';
      else if (mime.indexOf('webp') !== -1) ext = 'webp';
      else if (mime.indexOf('gif') !== -1) ext = 'gif';
      var fileType = mime && mime.indexOf('image/') === 0 ? mime : 'image/png';
      var file = new File([blob], 'image' + index1Based + '.' + ext, { type: fileType });
      return { file: file, fileType: fileType };
    },
    collectJimengReferenceFileInputs: function (doc) {
      var seen = {};
      var out = [];
      function consider(inp) {
        if (!inp || seen[inp]) return;
        seen[inp] = 1;
        out.push(inp);
      }
      var groups = doc.querySelectorAll('[class*="reference-group"]');
      var gi, g, gr, j, inps;
      for (gi = 0; gi < groups.length; gi++) {
        g = groups[gi];
        gr = g.getBoundingClientRect();
        if (!(gr.width > 0 && gr.height > 0)) continue;
        inps = g.querySelectorAll('input[type="file"]');
        for (j = 0; j < inps.length; j++) consider(inps[j]);
      }
      if (out.length === 0) {
        var pec = doc.querySelector('[class*="prompt-editor-container"]');
        if (pec) {
          inps = pec.querySelectorAll('input[type="file"]');
          for (j = 0; j < inps.length; j++) consider(inps[j]);
        }
      }
      return out;
    },
    /** 小云雀 xyq.jianying.com 工作台：`inputContainer` / `promptContainer` 内附件与参考槽 */
    collectXyqWorkbenchFileInputs: function (doc) {
      var seen = {};
      var out = [];
      function consider(inp) {
        if (!inp || seen[inp]) return;
        seen[inp] = 1;
        out.push(inp);
      }
      var shells = doc.querySelectorAll('[class*="inputContainer"], [class*="promptContainer"]');
      var si;
      var sh;
      var j;
      var inps;
      for (si = 0; si < shells.length; si++) {
        sh = shells[si];
        if (!sh) continue;
        inps = sh.querySelectorAll('[class*="reference-group"] input[type="file"]');
        for (j = 0; j < inps.length; j++) consider(inps[j]);
        inps = sh.querySelectorAll(
          '[class*="attachmentsBar"] input[type="file"], [class*="fileUploaderWrapper"] input[type="file"], [class*="uploadInputArea"] input[type="file"]',
        );
        for (j = 0; j < inps.length; j++) consider(inps[j]);
      }
      return out;
    },
    jimengPasteBrief: function (dataUrlStr, blob, file) {
      var magic = 'n/a';
      if (dataUrlStr && typeof dataUrlStr === 'string') {
        var dm = dataUrlStr.match(/^data:[^;]+;base64,(.+)$/);
        if (dm && dm[1]) {
          var chunk = dm[1].replace(/\s/g, '').slice(0, 12);
          try {
            var bin = atob(chunk);
            var hex = [];
            for (var hi = 0; hi < Math.min(8, bin.length); hi++) {
              hex.push(('0' + (bin.charCodeAt(hi) & 0xff).toString(16)).slice(-2));
            }
            magic = hex.join('');
          } catch (eh) {
            magic = '?';
          }
        }
      }
      return (
        'mime=' +
        (blob && blob.type ? blob.type : '?') +
        ' bytes=' +
        (blob ? blob.size : 0) +
        ' file=' +
        (file ? file.name : '?') +
        ' magic8=' +
        magic
      );
    },
    xyqPasteBrief: function (dataUrlStr, blob, file) {
      var magic = 'n/a';
      if (dataUrlStr && typeof dataUrlStr === 'string') {
        var dm = dataUrlStr.match(/^data:[^;]+;base64,(.+)$/);
        if (dm && dm[1]) {
          var chunk = dm[1].replace(/\s/g, '').slice(0, 12);
          try {
            var bin = atob(chunk);
            var hex = [];
            for (var hi = 0; hi < Math.min(8, bin.length); hi++) {
              hex.push(('0' + (bin.charCodeAt(hi) & 0xff).toString(16)).slice(-2));
            }
            magic = hex.join('');
          } catch (eh) {
            magic = '?';
          }
        }
      }
      return (
        'mime=' +
        (blob && blob.type ? blob.type : '?') +
        ' bytes=' +
        (blob ? blob.size : 0) +
        ' file=' +
        (file ? file.name : '?') +
        ' magic8=' +
        magic
      );
    },
  };
})();
