/**
 * 仅用于本地验证：在 MAIN 世界 patch fetch / XHR，在控制台打印响应摘要。
 *
 * 触发（地址栏）：
 * - `?picpuck_net_hook=1`：只打日志到与下载链相关的 URL（googleusercontent / fife / gg-dl 等）
 * - `?picpuck_net_hook=all`：对该 Tab 上所有 fetch/XHR 都打日志（极吵，仅排障）
 *
 * 须整页刷新或带参数打开，使内容脚本发起注入。
 */
(function () {
  if (typeof window === 'undefined') return;
  if (window.__picpuckGeminiNetHookTest) return;
  window.__picpuckGeminiNetHookTest = true;

  var PREFIX = '[PicPuck net-test]';
  var logAll = /[?&]picpuck_net_hook=all(?:&|$)/.test(window.location.search || '');

  function shouldLogUrl(u) {
    if (logAll) return true;
    if (u == null) return true;
    var s = typeof u === 'string' ? u : String(u);
    if (!s) return false;
    return /googleusercontent|fife\.usercontent|gg-dl|rd-gg-dl|google\.com\/.*(gg-dl|rd-gg-dl)/i.test(s);
  }

  /** @param {string} label */
  function logFetchResponse(url, response, bodyInfo) {
    try {
      console.log(PREFIX, 'fetch', {
        url: url,
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
        body: bodyInfo,
      });
    } catch (e) {
      console.warn(PREFIX, 'fetch log error', e);
    }
  }

  var origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      var url =
        typeof input === 'string'
          ? input
          : input && typeof input === 'object' && 'url' in input
            ? String(/** @type {Request} */ (input).url)
            : '';
      return origFetch.apply(this, arguments).then(function (response) {
        if (!shouldLogUrl(url)) return response;
        try {
          var clone = response.clone();
          var ct = clone.headers.get('content-type') || '';
          if (/^image\//i.test(ct)) {
            clone.arrayBuffer().then(function (buf) {
              logFetchResponse(url, response, { kind: 'image', byteLength: buf.byteLength });
            });
          } else if (/^application\/json/i.test(ct)) {
            clone
              .text()
              .then(function (t) {
                logFetchResponse(url, response, { kind: 'json', textLen: t.length, sample: t.slice(0, 300) });
              })
              .catch(function () {
                logFetchResponse(url, response, { kind: 'json', readFailed: true });
              });
          } else {
            clone
              .arrayBuffer()
              .then(function (buf) {
                logFetchResponse(url, response, { kind: 'other', byteLength: buf.byteLength, contentType: ct });
              })
              .catch(function () {
                logFetchResponse(url, response, { kind: 'other', readFailed: true, contentType: ct });
              });
          }
        } catch (e) {
          console.warn(PREFIX, 'fetch clone error', url, e);
        }
        return response;
      });
    };
  }

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      this.__picpuckUrl = typeof url === 'string' ? url : String(url);
    } catch (e) {
      this.__picpuckUrl = '';
    }
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    if (!xhr.__picpuckXhrHooked) {
      xhr.__picpuckXhrHooked = true;
      xhr.addEventListener(
        'load',
        function () {
          var u = xhr.__picpuckUrl || '';
          if (!shouldLogUrl(u)) return;
          try {
            var ct = xhr.getResponseHeader('content-type') || '';
            var bodyInfo = { kind: 'unknown' };
            var rt = xhr.responseType;
            if (rt === '' || rt === 'text') {
              var t = xhr.responseText;
              bodyInfo = { kind: 'text', length: t ? t.length : 0, sample: t ? t.slice(0, 300) : '' };
            } else if (rt === 'arraybuffer' && xhr.response) {
              bodyInfo = { kind: 'arraybuffer', byteLength: xhr.response.byteLength };
            } else if (rt === 'blob' && xhr.response) {
              bodyInfo = { kind: 'blob', size: xhr.response.size };
            } else if (rt === 'json') {
              bodyInfo = { kind: 'json', value: xhr.response };
            } else {
              bodyInfo = { kind: 'opaque', responseType: rt };
            }
            console.log(PREFIX, 'xhr', {
              url: u,
              status: xhr.status,
              contentType: ct,
              response: bodyInfo,
            });
          } catch (e) {
            console.warn(PREFIX, 'xhr log error', e);
          }
        },
        false,
      );
    }
    return origSend.apply(this, arguments);
  };

  console.info(PREFIX, 'MAIN world hook installed (fetch + XHR). Filter: googleusercontent / fife / gg-dl / rd-gg-dl.');
})();
