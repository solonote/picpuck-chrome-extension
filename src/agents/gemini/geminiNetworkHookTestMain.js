/**
 * 仅用于本地验证：在 MAIN 世界 patch fetch / XHR，在控制台打印响应摘要。
 *
 * 触发（地址栏）：
 * - `?picpuck_net_hook=1`：只打日志到与下载链相关的 URL（googleusercontent / fife / gg-dl 等）
 * - `?picpuck_net_hook=all`：对该 frame 上所有 fetch/XHR 都打日志（极吵，仅排障）
 *
 * 说明：相对路径会先按当前 `location` 解析成绝对 URL 再过滤；注入使用 `allFrames:true` 覆盖 iframe。
 * 若仍无日志：请求可能发自 **Worker / Service Worker**，本脚本无法挂钩（需别方案）。
 */
(function () {
  if (typeof window === 'undefined') return;
  if (window.__picpuckGeminiNetHookTest) return;
  window.__picpuckGeminiNetHookTest = true;

  var PREFIX = '[PicPuck net-test]';
  var logAll = /[?&]picpuck_net_hook=all(?:&|$)/.test(window.location.search || '');
  var baseHref = typeof window.location !== 'undefined' ? window.location.href : 'https://gemini.google.com/';

  function resolveUrl(maybe) {
    if (maybe == null || maybe === '') return '';
    var s = typeof maybe === 'string' ? maybe : String(maybe);
    try {
      return new URL(s, baseHref).href;
    } catch (e) {
      return s;
    }
  }

  function fetchInputUrl(input) {
    try {
      if (typeof input === 'string') return input;
      if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
      if (input && typeof input === 'object' && typeof input.url === 'string') return input.url;
    } catch (e) {
      /* ignore */
    }
    return '';
  }

  function shouldLogAbsoluteUrl(absUrl) {
    if (logAll) return true;
    if (!absUrl) return false;
    return /googleusercontent|fife\.usercontent|gg-dl|rd-gg-dl|google\.com\/.*(gg-dl|rd-gg-dl)/i.test(absUrl);
  }

  function logFetchResponse(absUrl, response, bodyInfo) {
    try {
      console.log(PREFIX, 'fetch response', {
        url: absUrl,
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get('content-type'),
        body: bodyInfo,
      });
    } catch (e) {
      console.warn(PREFIX, 'fetch log error', e);
    }
  }

  function wrapFetchResponse(absUrl, response) {
    if (!shouldLogAbsoluteUrl(absUrl)) return response;
    try {
      var clone = response.clone();
      var ct = clone.headers.get('content-type') || '';
      if (/^image\//i.test(ct)) {
        clone.arrayBuffer().then(function (buf) {
          logFetchResponse(absUrl, response, { kind: 'image', byteLength: buf.byteLength });
        });
      } else if (/^application\/json/i.test(ct) || /[?&]format=json\b/i.test(absUrl)) {
        clone
          .text()
          .then(function (t) {
            var body = { kind: 'json', textLen: t.length, text: t.slice(0, 12000) };
            try {
              body.parsed = JSON.parse(t);
            } catch (e1) {
              body.parseError = String(e1 && e1.message ? e1.message : e1);
            }
            logFetchResponse(absUrl, response, body);
          })
          .catch(function () {
            logFetchResponse(absUrl, response, { kind: 'json', readFailed: true });
          });
      } else if (/^text\//i.test(ct)) {
        clone
          .text()
          .then(function (t) {
            logFetchResponse(absUrl, response, { kind: 'text', textLen: t.length, text: t.slice(0, 12000) });
          })
          .catch(function () {
            logFetchResponse(absUrl, response, { kind: 'text', readFailed: true });
          });
      } else {
        clone
          .arrayBuffer()
          .then(function (buf) {
            var info = { kind: 'binary', byteLength: buf.byteLength, contentType: ct };
            if (buf.byteLength > 0 && buf.byteLength <= 65536) {
              try {
                info.utf8Preview = new TextDecoder('utf-8', { fatal: false }).decode(buf).slice(0, 12000);
              } catch (e2) {
                info.decodeNote = 'utf-8 decode failed';
              }
            }
            logFetchResponse(absUrl, response, info);
          })
          .catch(function () {
            logFetchResponse(absUrl, response, { kind: 'binary', readFailed: true, contentType: ct });
          });
      }
    } catch (e) {
      console.warn(PREFIX, 'fetch clone error', absUrl, e);
    }
    return response;
  }

  function patchedFetch(input, init) {
    var raw = fetchInputUrl(input);
    var absUrl = resolveUrl(raw);
    if (logAll) {
      console.log(PREFIX, 'fetch call', { raw: raw, resolved: absUrl });
    }
    var p = origFetch.call(this, input, init);
    if (!p || typeof p.then !== 'function') return p;
    return p.then(
      function (response) {
        wrapFetchResponse(absUrl, response);
        return response;
      },
      function (err) {
        if (shouldLogAbsoluteUrl(absUrl)) {
          console.log(PREFIX, 'fetch rejected', { url: absUrl, error: String(err && err.message ? err.message : err) });
        }
        throw err;
      },
    );
  }

  var origFetch = globalThis.fetch;
  if (typeof origFetch === 'function') {
    globalThis.fetch = patchedFetch;
    if (typeof window !== 'undefined' && window.fetch !== patchedFetch) {
      window.fetch = patchedFetch;
    }
  }

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      var raw = typeof url === 'string' ? url : String(url);
      this.__picpuckUrlRaw = raw;
      this.__picpuckUrl = resolveUrl(raw);
    } catch (e) {
      this.__picpuckUrlRaw = '';
      this.__picpuckUrl = '';
    }
    return origOpen.apply(this, arguments);
  };

  function logXhrDone(xhr) {
    var absUrl = xhr.__picpuckUrl || '';
    if (logAll) {
      console.log(PREFIX, 'xhr call', { raw: xhr.__picpuckUrlRaw, resolved: absUrl });
    }
    if (!shouldLogAbsoluteUrl(absUrl)) return;
    try {
      var ct = xhr.getResponseHeader('content-type') || '';
      var bodyInfo = { kind: 'unknown' };
      var rt = xhr.responseType;
      if (rt === '' || rt === 'text') {
        var t = xhr.responseText;
        bodyInfo = { kind: 'text', textLen: t ? t.length : 0, text: t ? t.slice(0, 12000) : '' };
        if (/[?&]format=json\b/i.test(absUrl) || /^application\/json/i.test(ct)) {
          try {
            bodyInfo.parsed = JSON.parse(t || '{}');
          } catch (e3) {
            bodyInfo.parseError = String(e3 && e3.message ? e3.message : e3);
          }
        }
      } else if (rt === 'arraybuffer' && xhr.response) {
        bodyInfo = { kind: 'arraybuffer', byteLength: xhr.response.byteLength };
      } else if (rt === 'blob' && xhr.response) {
        bodyInfo = { kind: 'blob', size: xhr.response.size };
      } else if (rt === 'json') {
        bodyInfo = { kind: 'json', value: xhr.response };
      } else {
        bodyInfo = { kind: 'opaque', responseType: rt };
      }
      console.log(PREFIX, 'xhr response', {
        url: absUrl,
        status: xhr.status,
        contentType: ct,
        response: bodyInfo,
      });
    } catch (e) {
      console.warn(PREFIX, 'xhr log error', e);
    }
  }

  XMLHttpRequest.prototype.send = function () {
    var xhr = this;
    if (!xhr.__picpuckXhrHooked) {
      xhr.__picpuckXhrHooked = true;
      xhr.addEventListener(
        'readystatechange',
        function () {
          if (xhr.readyState === 4) {
            logXhrDone(xhr);
          }
        },
        false,
      );
    }
    return origSend.apply(this, arguments);
  };

  var inIframe = typeof window !== 'undefined' && window.self !== window.top;
  console.info(PREFIX, 'MAIN hook installed', {
    fetch: typeof origFetch === 'function',
    inIframe: inIframe,
    href: typeof window.location !== 'undefined' ? window.location.href : '',
    filter: logAll ? 'ALL' : 'googleusercontent|fife|gg-dl|rd-gg-dl',
  });
  if (!logAll) {
    console.info(PREFIX, '若无任何 fetch/xhr 日志：试 ?picpuck_net_hook=all；若在 Worker 里发请求则本脚本看不到。');
  }
})();
