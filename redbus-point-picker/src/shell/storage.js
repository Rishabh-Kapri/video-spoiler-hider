/**
 * The only module that touches extension APIs. Everything in src/core stays
 * free of them so the engine can move to a native shell later.
 */
(function (root) {
  'use strict';

  var api = root.browser || root.chrome;
  var area = api && api.storage ? api.storage.local : null;

  var KEYS = {
    pins: 'pins',
    saved: 'savedLocations',
    captures: 'captures',
    settings: 'settings',
    points: 'pointsCache'
  };

  var MAX_CAPTURES = 5;
  var MAX_CAPTURE_BYTES = 400 * 1024;

  // Points survive navigation within a journey. Cap both dimensions: a busy
  // route can yield thousands of points and storage.local is only 10 MB.
  var MAX_CACHED_JOURNEYS = 4;
  var MAX_CACHED_POINTS = 800;
  var POINTS_TTL_MS = 6 * 60 * 60 * 1000;

  var DEFAULT_SETTINGS = { captureMode: false, panelOpen: true, debug: false };

  function get(key, fallback) {
    if (!area) return Promise.resolve(fallback);
    return Promise.resolve(area.get(key))
      .then(function (res) {
        var v = res && res[key];
        return v === undefined || v === null ? fallback : v;
      })
      .catch(function () { return fallback; });
  }

  function set(key, value) {
    if (!area) return Promise.resolve(false);
    var obj = {};
    obj[key] = value;
    return Promise.resolve(area.set(obj)).then(function () { return true; })
      .catch(function () { return false; });
  }

  function getPins() {
    return get(KEYS.pins, { origin: null, destination: null });
  }

  function setPins(pins) {
    return set(KEYS.pins, pins);
  }

  function getSavedLocations() {
    return get(KEYS.saved, []);
  }

  function setSavedLocations(list) {
    return set(KEYS.saved, list);
  }

  function getSettings() {
    return get(KEYS.settings, DEFAULT_SETTINGS).then(function (s) {
      return Object.assign({}, DEFAULT_SETTINGS, s || {});
    });
  }

  function setSettings(patch) {
    return getSettings().then(function (cur) {
      return set(KEYS.settings, Object.assign({}, cur, patch));
    });
  }

  function getCaptures() {
    return get(KEYS.captures, []);
  }

  /**
   * Ring buffer of recent payloads for the recon workflow. Raw bodies are
   * truncated and capped in count — storage.local is 10 MB and a single redBus
   * search response can be a couple of those on its own.
   */
  function addCapture(entry) {
    return getCaptures().then(function (list) {
      var trimmed = Object.assign({}, entry);
      if (typeof trimmed.body === 'string' && trimmed.body.length > MAX_CAPTURE_BYTES) {
        trimmed.body = trimmed.body.slice(0, MAX_CAPTURE_BYTES);
        trimmed.truncated = true;
      }
      list.unshift(trimmed);
      return set(KEYS.captures, list.slice(0, MAX_CAPTURES));
    });
  }

  function clearCaptures() {
    return set(KEYS.captures, []);
  }

  /**
   * Points cached per journey key, so switching between redBus's own tabs — or
   * a full page load — doesn't throw away everything already captured.
   */
  function getCachedPoints(journeyKey) {
    return get(KEYS.points, {}).then(function (cache) {
      var entry = cache && cache[journeyKey];
      if (!entry || !Array.isArray(entry.points)) return [];
      if (Date.now() - (entry.ts || 0) > POINTS_TTL_MS) return [];
      return entry.points;
    });
  }

  function setCachedPoints(journeyKey, points) {
    return get(KEYS.points, {}).then(function (cache) {
      cache = cache || {};

      // `raw` holds the entire original object per point — useful in memory for
      // debugging, far too heavy to persist.
      var slim = points.slice(0, MAX_CACHED_POINTS).map(function (p) {
        return {
          id: p.id, name: p.name, address: p.address, time: p.time,
          kind: p.kind, coord: p.coord, path: p.path
        };
      });

      cache[journeyKey] = { ts: Date.now(), points: slim };

      var keys = Object.keys(cache).sort(function (a, b) {
        return (cache[b].ts || 0) - (cache[a].ts || 0);
      });
      var pruned = {};
      keys.slice(0, MAX_CACHED_JOURNEYS).forEach(function (k) { pruned[k] = cache[k]; });

      return set(KEYS.points, pruned);
    });
  }

  root.RB = root.RB || {};
  root.RB.storage = {
    KEYS: KEYS,
    getPins: getPins,
    setPins: setPins,
    getSavedLocations: getSavedLocations,
    setSavedLocations: setSavedLocations,
    getSettings: getSettings,
    setSettings: setSettings,
    getCaptures: getCaptures,
    addCapture: addCapture,
    clearCaptures: clearCaptures,
    getCachedPoints: getCachedPoints,
    setCachedPoints: setCachedPoints
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
