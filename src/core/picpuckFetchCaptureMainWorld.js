/**
 * MAIN 世界公共组件：patch fetch / XHR，在 arm 期间将首条满足条件的二进制响应通过 postMessage 交给内容脚本（含 transferable ArrayBuffer）。
 * 不使用 console.log；与页面凭证一致，适用于 lh3 rd-gg-dl 等需同页 Cookie 的请求。
 */
(function () {
  var g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (g.__picpuckFetchCapture) return;

  var armed = false;
  var delivered = false;
  var opts = {
    minByteLength: 1048576,
    urlPrefix: 'https://lh3.googleusercontent.com/rd-gg-dl/',
    mimePrefix: 'image/',
  };

  var installed = false;
  var origFetch = g.fetch;
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  function resolveUrl(maybe) {
    if (maybe == null || maybe === '') return '';
    var s = typeof maybe === 'string' ? maybe : String(maybe);
    try {
      return new URL(s, g.location.href).href;
    } catch (e) {
      return s;
    }
  }

  function fetchInputUrl(input) {
    try {
      if (typeof input === 'string') return input;
      if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
      if (input && typeof input === 'object' && typeof input.url === 'string') return input.url;
    } catch (e1) {
      /* ignore */
    }
    return '';
  }

  function matches(absUrl, ct, byteLength) {
    if (!armed || delivered) return false;
    if (!absUrl || byteLength <= opts.minByteLength) return false;
    if (opts.urlPrefix && absUrl.indexOf(opts.urlPrefix) !== 0) return false;
    var c = (ct || '').split(';')[0].trim().toLowerCase();
    if (opts.mimePrefix && c.indexOf(opts.mimePrefix.toLowerCase()) !== 0) return false;
    return true;
  }

  function emitBuffer(buf, ct, absUrl) {
    if (delivered || !armed) return;
    delivered = true;
    armed = false;
    try {
      var ctOut = (ct && ct.split(';')[0].trim()) || 'image/png';
      g.postMessage(
        {
          picpuckBridge: true,
          kind: 'GEMINI_FULL_IMAGE_BUFFER',
          contentType: ctOut,
          byteLength: buf.byteLength,
          url: absUrl,
          _buffer: buf,
        },
        g.location.origin,
        [buf],
      );
    } catch (e2) {
      delivered = false;
      armed = true;
    }
  }

  function install() {
    if (installed) return;
    installed = true;

    if (typeof origFetch === 'function') {
      g.fetch = function (input, init) {
        var raw = fetchInputUrl(input);
        var absUrl = resolveUrl(raw);
        return origFetch.apply(this, arguments).then(function (response) {
          if (!armed || delivered || !response || !response.ok) return response;
          var ct = '';
          try {
            ct = response.headers.get('content-type') || '';
          } catch (e3) {
            /* ignore */
          }
          var clone = response.clone();
          clone.arrayBuffer().then(function (buf) {
            if (matches(absUrl, ct, buf.byteLength)) emitBuffer(buf, ct, absUrl);
          });
          return response;
        });
      };
    }

    XMLHttpRequest.prototype.open = function (method, url) {
      try {
        this.__picpuckCapUrl = resolveUrl(typeof url === 'string' ? url : String(url));
      } catch (e4) {
        this.__picpuckCapUrl = '';
      }
      return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      var xhr = this;
      if (!xhr.__picpuckCapHooked) {
        xhr.__picpuckCapHooked = true;
        xhr.addEventListener(
          'readystatechange',
          function () {
            if (xhr.readyState !== 4 || !xhr.__picpuckCapUrl) return;
            var ct = '';
            try {
              ct = xhr.getResponseHeader('content-type') || '';
            } catch (e5) {
              /* ignore */
            }
            var absUrl = xhr.__picpuckCapUrl;
            var rt = xhr.responseType;
            try {
              if (rt === 'arraybuffer' && xhr.response) {
                var buf = xhr.response;
                if (matches(absUrl, ct, buf.byteLength)) {
                  var copy = buf.slice(0);
                  emitBuffer(copy, ct, absUrl);
                }
              } else if (rt === 'blob' && xhr.response) {
                xhr.response.arrayBuffer().then(function (b) {
                  if (matches(absUrl, ct, b.byteLength)) emitBuffer(b, ct, absUrl);
                });
              }
            } catch (e7) {
              /* ignore */
            }
          },
          false,
        );
      }
      return origSend.apply(this, arguments);
    };
  }

  function arm(o) {
    if (o) {
      if (o.minByteLength != null) opts.minByteLength = o.minByteLength;
      if (o.urlPrefix != null) opts.urlPrefix = o.urlPrefix;
      if (o.mimePrefix != null) opts.mimePrefix = o.mimePrefix;
    }
    delivered = false;
    armed = true;
  }

  function disarm() {
    armed = false;
  }

  g.__picpuckFetchCapture = {
    install: install,
    arm: arm,
    disarm: disarm,
  };
})();
