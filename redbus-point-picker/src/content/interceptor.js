/**
 * Runs in the page's own JS context (manifest `world: "MAIN"`) so it can see
 * fetch/XHR. Chrome 111+ and Firefox 128+ support declarative MAIN world.
 *
 * Read-only: every patch returns exactly what the original returned, and every
 * observation path is wrapped so a throw here can never surface as a page error.
 * Response bodies are read from a clone, never the original stream.
 */
(function () {
  'use strict';

  var TAG = 'RBPP_CAPTURE';
  var MAX_BODY = 3 * 1024 * 1024;

  function post(url, bodyText) {
    try {
      if (typeof bodyText !== 'string' || !bodyText) return;
      if (bodyText.length > MAX_BODY) return;
      var trimmed = bodyText.slice(0, 64).replace(/^﻿/, '').trim();
      // Cheap pre-filter: only forward things that could parse as JSON.
      if (trimmed.charAt(0) !== '{' && trimmed.charAt(0) !== '[') return;
      window.postMessage({ __rbpp: TAG, url: String(url || ''), body: bodyText, ts: Date.now() }, '*');
    } catch (e) {
      /* never let instrumentation break the page */
    }
  }

  function looksJson(contentType) {
    return typeof contentType === 'string' && contentType.toLowerCase().indexOf('json') > -1;
  }

  // --- fetch -----------------------------------------------------------------
  try {
    var origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function () {
        var promise = origFetch.apply(this, arguments);
        try {
          // Registered before the page's own handler, so the body is still
          // unread here and clone() is guaranteed to succeed.
          promise.then(function (res) {
            try {
              if (!res || !res.headers || !looksJson(res.headers.get('content-type'))) return;
              res.clone().text().then(function (t) { post(res.url, t); }, function () {});
            } catch (e) {}
          }, function () {});
        } catch (e) {}
        return promise;
      };
      try {
        window.fetch.toString = function () { return origFetch.toString(); };
      } catch (e) {}
    }
  } catch (e) {}

  // --- XMLHttpRequest --------------------------------------------------------
  try {
    var XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype) {
      var origOpen = XHR.prototype.open;
      var origSend = XHR.prototype.send;

      XHR.prototype.open = function (method, url) {
        try { this.__rbppUrl = url; } catch (e) {}
        return origOpen.apply(this, arguments);
      };

      XHR.prototype.send = function () {
        try {
          this.addEventListener('load', function () {
            try {
              if (!looksJson(this.getResponseHeader('content-type'))) return;
              var rt = this.responseType;
              var body = null;
              if (rt === '' || rt === 'text') body = this.responseText;
              else if (rt === 'json') body = JSON.stringify(this.response);
              else return; // blob/arraybuffer/document — not worth the cost
              post(this.__rbppUrl || this.responseURL, body);
            } catch (e) {}
          });
        } catch (e) {}
        return origSend.apply(this, arguments);
      };
    }
  } catch (e) {}
})();
