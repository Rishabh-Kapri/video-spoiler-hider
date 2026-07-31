/**
 * Isolated-world orchestrator: receives payloads from the MAIN-world
 * interceptor, normalizes them, ranks against the user's pins, renders a panel.
 *
 * Everything arriving over postMessage is page-controlled and therefore
 * untrusted — it is only ever written to the DOM via textContent, and any URL
 * derived from it is scheme-checked before becoming an href.
 */
(function () {
  'use strict';

  var geo = RB.geo;
  var adapter = RB.adapter;
  var ranking = RB.ranking;
  var storage = RB.storage;

  var MAX_POINTS = 5000;
  var MAX_PAYLOAD_CHARS = 3 * 1024 * 1024;
  var TOP_N = 8;

  var state = {
    points: [],
    seen: Object.create(null),
    pins: { origin: null, destination: null },
    settings: { captureMode: false, panelOpen: true, debug: false },
    payloadsSeen: 0,
    payloadsMatched: 0,
    lastDiscoveries: [],
    journeyKey: RB.journey.journeyKey(location.href)
  };

  var els = null;
  var renderQueued = false;
  var persistQueued = false;

  function debug() {
    if (!state.settings.debug) return;
    var args = ['[rbpp]'].concat(Array.prototype.slice.call(arguments));
    try {
      console.log.apply(console, args);
    } catch (e) {}
  }

  // --- payload handling ------------------------------------------------------

  function handlePayload(msg) {
    if (typeof msg.body !== 'string' || msg.body.length > MAX_PAYLOAD_CHARS) return;

    var json;
    try {
      json = JSON.parse(msg.body);
    } catch (e) {
      debug('unparseable body from', msg.url);
      return;
    }

    state.payloadsSeen++;

    var res;
    try {
      res = adapter.extractPoints(json);
    } catch (e) {
      debug('adapter threw on', msg.url, e);
      return;
    }

    debug('payload', msg.url, '->', res.points.length, 'points',
      '(' + res.withCoords + ' with coords)');

    if (res.discoveries && res.discoveries.length) {
      state.lastDiscoveries = res.discoveries.slice(0, 10);
    }

    if (res.points.length) {
      state.payloadsMatched++;
      mergePoints(res.points);
      scheduleRender();
    }

    if (state.settings.captureMode) {
      storage.addCapture({
        url: msg.url,
        ts: msg.ts || Date.now(),
        pageUrl: location.href,
        pointCount: res.points.length,
        withCoords: res.withCoords,
        withoutCoords: res.withoutCoords,
        discoveries: res.discoveries,
        shape: safeShape(json),
        body: msg.body
      });
    }
  }

  function safeShape(json) {
    try {
      return adapter.summarizeShape(json);
    } catch (e) {
      return null;
    }
  }

  function mergePoints(points) {
    var added = 0;
    for (var i = 0; i < points.length; i++) {
      if (state.points.length >= MAX_POINTS) break;
      var p = points[i];
      var key = p.kind + '|' + (p.name || '') + '|' + (p.coord ? p.coord.lat + ',' + p.coord.lng : p.path);
      if (state.seen[key]) continue;
      state.seen[key] = true;
      state.points.push(p);
      added++;
    }
    if (added) schedulePersist();
    return added;
  }

  /** Cache to storage so an in-page navigation doesn't lose what we captured. */
  function schedulePersist() {
    if (persistQueued) return;
    persistQueued = true;
    setTimeout(function () {
      persistQueued = false;
      storage.setCachedPoints(state.journeyKey, state.points).then(function () {
        debug('persisted', state.points.length, 'points for', state.journeyKey);
      });
    }, 1000);
  }

  function resetForNewJourney(nextKey) {
    debug('journey changed', state.journeyKey, '->', nextKey, '- clearing points');
    state.points = [];
    state.seen = Object.create(null);
    state.payloadsSeen = 0;
    state.payloadsMatched = 0;
    state.journeyKey = nextKey;
    rehydrate();
    scheduleRender();
  }

  /** Pull previously captured points for this journey back into memory. */
  function rehydrate() {
    var key = state.journeyKey;
    return storage.getCachedPoints(key).then(function (cached) {
      if (key !== state.journeyKey || !cached.length) return;
      var restored = mergePoints(cached);
      debug('rehydrated', restored, 'points for', key);
      if (restored) scheduleRender();
    });
  }

  // --- rendering -------------------------------------------------------------

  function scheduleRender() {
    if (renderQueued) return;
    renderQueued = true;
    // Coalesce bursts — a single search fires many XHRs back to back.
    setTimeout(function () {
      renderQueued = false;
      try {
        render();
      } catch (e) {
        /* a render bug must not take the page down with it */
      }
    }, 150);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function buildShell() {
    var root = el('div');
    root.id = 'rbpp-root';

    var panel = el('div');
    panel.id = 'rbpp-panel';

    var head = el('div', 'rbpp-head');
    head.appendChild(el('span', 'rbpp-title', 'Nearest points'));
    var close = el('button', 'rbpp-close', '×');
    close.setAttribute('aria-label', 'Hide panel');
    close.addEventListener('click', function () {
      state.settings.panelOpen = false;
      storage.setSettings({ panelOpen: false });
      render();
    });
    head.appendChild(close);

    var body = el('div', 'rbpp-body');
    var foot = el('div', 'rbpp-foot');

    panel.appendChild(head);
    panel.appendChild(body);
    panel.appendChild(foot);

    var toggle = el('button', null, 'Points');
    toggle.id = 'rbpp-toggle';
    var badge = el('span', null, '');
    badge.id = 'rbpp-badge';
    toggle.appendChild(badge);
    toggle.addEventListener('click', function () {
      state.settings.panelOpen = !state.settings.panelOpen;
      storage.setSettings({ panelOpen: state.settings.panelOpen });
      render();
    });

    root.appendChild(panel);
    root.appendChild(toggle);
    document.documentElement.appendChild(root);

    return { root: root, panel: panel, body: body, foot: foot, badge: badge };
  }

  function note(text, kind) {
    var n = el('div', 'rbpp-note' + (kind === 'info' ? ' rbpp-info' : ''));
    n.appendChild(el('div', null, text));
    return n;
  }

  function distanceClass(km) {
    if (km === null || km === undefined) return 'rbpp-unknown';
    if (km < 1.5) return 'rbpp-near';
    if (km < 5) return 'rbpp-mid';
    return 'rbpp-far';
  }

  function safeHttpUrl(u) {
    if (typeof u !== 'string') return null;
    return /^https:\/\//.test(u) ? u : null;
  }

  function renderList(container, title, pin, rows) {
    var head = el('div', 'rbpp-section-title');
    head.appendChild(el('span', null, title));
    head.appendChild(el('span', 'rbpp-pin', pin ? (pin.label || 'pin set') : 'no pin'));
    container.appendChild(head);

    if (!rows.length) {
      container.appendChild(note('Nothing captured yet.', 'info'));
      return;
    }

    var ul = el('ul', 'rbpp-list');
    for (var i = 0; i < Math.min(rows.length, TOP_N); i++) {
      var r = rows[i];
      var li = el('li', 'rbpp-item ' + distanceClass(r.distanceKm));

      li.appendChild(el('span', 'rbpp-rank', r.rank));

      var main = el('div', 'rbpp-main');
      var name = el('span', 'rbpp-name', r.point.name || '(unnamed)');
      if (r.kindUncertain) {
        var flag = el('span', 'rbpp-flag', '?');
        flag.title = 'Could not tell whether this is a boarding or dropping point';
        name.appendChild(flag);
      }
      main.appendChild(name);

      var subBits = [];
      if (r.point.time) subBits.push(r.point.time);
      if (r.point.address) subBits.push(r.point.address);
      if (r.occurrences > 1) subBits.push(r.occurrences + ' buses');
      if (subBits.length) main.appendChild(el('span', 'rbpp-sub', subBits.join(' · ')));
      li.appendChild(main);

      li.appendChild(el('span', 'rbpp-dist', geo.formatDistance(r.distanceKm)));

      if (r.point.coord) {
        var href = safeHttpUrl(geo.mapsDirectionsUrl(pin, r.point.coord));
        if (href) {
          var a = el('a', 'rbpp-link', 'map');
          a.href = href;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          li.appendChild(a);
        }
      }

      ul.appendChild(li);
    }
    container.appendChild(ul);
  }

  function render() {
    if (!els) {
      if (!document.documentElement) return;
      els = buildShell();
    }

    var panel = els.panel;
    var body = els.body;
    body.textContent = '';

    var hasPins = !!(state.pins.origin || state.pins.destination);
    var ranked = ranking.rankPoints(state.points, state.pins);

    panel.hidden = !state.settings.panelOpen;
    els.badge.textContent = String(ranked.boarding.length + ranked.dropping.length);

    if (!hasPins) {
      body.appendChild(
        note('Set your pickup and drop-off pins first — click the extension icon in the toolbar.', 'info')
      );
    }

    if (state.points.length === 0) {
      body.appendChild(
        note(
          state.payloadsSeen === 0
            ? 'Waiting for redBus data. Run a search on this page.'
            : 'Saw ' + state.payloadsSeen + ' responses but found no point lists yet. Open a bus’s "Boarding & Dropping Points".',
          'info'
        )
      );
    } else {
      if (ranked.resolvedCount === 0) {
        body.appendChild(
          note(
            'Found ' + ranked.totalCount + ' points, but none carry coordinates. ' +
            'Distances need the geocoding step (Phase 4) — turn on Capture mode and export, so the payload shape can be checked.'
          )
        );
      } else if (ranked.resolvedCount < ranked.totalCount) {
        body.appendChild(
          note(
            ranked.resolvedCount + ' of ' + ranked.totalCount +
            ' points have coordinates. The rest are listed last until geocoding lands.'
          )
        );
      }

      if (hasPins) {
        renderList(body, 'Boarding', state.pins.origin, ranked.boarding);
        renderList(body, 'Dropping', state.pins.destination, ranked.dropping);
      }
    }

    els.foot.textContent =
      state.payloadsMatched + '/' + state.payloadsSeen + ' responses matched · ' +
      state.points.length + ' points' +
      (state.settings.captureMode ? ' · capturing' : '');
  }

  // --- wiring ----------------------------------------------------------------

  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.__rbpp !== 'RBPP_CAPTURE') return;
    try {
      handlePayload(d);
    } catch (e) {
      /* ignore malformed frames */
    }
  });

  // redBus is a SPA; a new search replaces the results without a page load.
  // Keyed on the journey, not the raw URL — switching to the Board/Drop point
  // tab changes the URL but is emphatically not a new search.
  var lastHref = location.href;
  setInterval(function () {
    var href = location.href;
    if (href === lastHref) return;
    var prev = lastHref;
    lastHref = href;
    if (RB.journey.isNewJourney(prev, href)) {
      resetForNewJourney(RB.journey.journeyKey(href));
    }
  }, 1000);

  var api = globalThis.browser || globalThis.chrome;
  if (api && api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener(function (changes, areaName) {
      if (areaName !== 'local') return;
      if (changes[storage.KEYS.pins]) {
        state.pins = changes[storage.KEYS.pins].newValue || { origin: null, destination: null };
        scheduleRender();
      }
      if (changes[storage.KEYS.settings]) {
        state.settings = Object.assign({}, state.settings, changes[storage.KEYS.settings].newValue || {});
        scheduleRender();
      }
    });
  }

  function start() {
    Promise.all([storage.getPins(), storage.getSettings()]).then(function (vals) {
      state.pins = vals[0] || { origin: null, destination: null };
      state.settings = vals[1] || state.settings;
      debug('started on', state.journeyKey);
      render();
      return rehydrate();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
