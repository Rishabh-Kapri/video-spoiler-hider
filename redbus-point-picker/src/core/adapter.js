/**
 * Turns arbitrary redBus JSON into normalized boarding/dropping points.
 *
 * This is deliberately heuristic rather than a fixed schema mapping. redBus's
 * internal API is undocumented and changes without notice, so instead of
 * pinning field names we score every array in the payload on how much it looks
 * like a list of stops. When the shape shifts, this usually keeps working; when
 * it doesn't, `discoveries` tells you exactly where to look.
 *
 * No browser APIs — keep portable.
 */
(function (root, factory) {
  var mod = factory(
    (typeof module === 'object' && module.exports) ? require('./geo.js') : root.RB.geo
  );
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.RB = root.RB || {};
  root.RB.adapter = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (geo) {
  'use strict';

  var MAX_DEPTH = 12;
  var SCORE_THRESHOLD = 5;

  function normKey(k) {
    return String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  var LAT_RE = /^(bp|dp|src|dest|dst|from|to|start|end|point|stop|stage)?(lat|latitude)$/;
  var LNG_RE = /^(bp|dp|src|dest|dst|from|to|start|end|point|stop|stage)?(lng|lon|long|longitude)$/;
  var COMBINED_KEYS = ['latlong', 'latlng', 'latlon', 'geo', 'geocode', 'coordinates', 'coords', 'location', 'position', 'latitudelongitude'];
  var NAME_KEYS = ['name', 'bpname', 'dpname', 'pointname', 'stagename', 'stopname', 'landmark', 'boardingpoint', 'droppingpoint', 'title', 'label'];
  var ADDR_KEYS = ['address', 'fulladdress', 'addr', 'address1', 'addressline', 'landmark', 'locality'];
  var TIME_KEYS = ['time', 'bptime', 'dptime', 'departuretime', 'arrivaltime', 'reportingtime', 'boardingtime', 'droppingtime'];
  var ID_KEYS = ['id', 'bpid', 'dpid', 'pointid', 'stageid', 'code', 'bpcode', 'dpcode'];

  /**
   * Split an identifier into lowercase words: `bpDpDetails` -> ['bp','dp','details'],
   * `BPInformationList` -> ['bpinformation','list'].
   *
   * Tokenizing rather than substring-matching a flattened string is what keeps
   * `bpDpDetails` (a container holding *both* lists) from reading as boarding.
   */
  function tokenize(s) {
    return String(s || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .filter(Boolean)
      .map(function (t) { return t.toLowerCase(); });
  }

  function markers(s) {
    var joined = tokenize(s).join(' ');
    // A single token carrying both abbreviations is a container, not a list.
    if (/bpdp|dpbp/.test(joined)) return { board: true, drop: true };
    return {
      board: /(^| )bp/.test(joined) || /board|pickup/.test(joined),
      drop: /(^| )dp/.test(joined) || /drop|alight/.test(joined)
    };
  }

  /** Map of normalized key -> original value, for one object. */
  function keyIndex(obj) {
    var idx = {};
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) idx[normKey(k)] = obj[k];
    }
    return idx;
  }

  function firstMatch(idx, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = idx[keys[i]];
      if (typeof v === 'string' && v.trim()) return v.trim();
      if (typeof v === 'number') return String(v);
    }
    return null;
  }

  /** Pair of numbers in unknown order — pick the ordering that's plausible. */
  function coordFromPair(a, b) {
    var asLatLng = { lat: a, lng: b };
    if (geo.isPlausibleCoord(asLatLng)) return asLatLng;
    var asLngLat = { lat: b, lng: a };
    if (geo.isPlausibleCoord(asLngLat)) return asLngLat;
    return null;
  }

  function parseNum(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && v.trim() !== '') {
      var n = Number(v.trim());
      return isFinite(n) ? n : NaN;
    }
    return NaN;
  }

  /**
   * Pull a coordinate out of one object, trying every encoding redBus and its
   * upstream operators plausibly use.
   */
  function extractCoord(obj) {
    if (!obj || typeof obj !== 'object') return null;
    var idx = keyIndex(obj);
    var k;

    // 1. Separate lat / lng fields, paired by matching prefix where possible.
    var lats = [];
    var lngs = [];
    for (k in idx) {
      if (LAT_RE.test(k)) lats.push({ key: k, prefix: k.replace(/(lat|latitude)$/, ''), val: parseNum(idx[k]) });
      if (LNG_RE.test(k)) lngs.push({ key: k, prefix: k.replace(/(lng|lon|long|longitude)$/, ''), val: parseNum(idx[k]) });
    }
    for (var i = 0; i < lats.length; i++) {
      for (var j = 0; j < lngs.length; j++) {
        if (lats[i].prefix !== lngs[j].prefix) continue;
        var c = { lat: lats[i].val, lng: lngs[j].val };
        if (geo.isPlausibleCoord(c)) return c;
      }
    }
    if (lats.length && lngs.length) {
      var loose = { lat: lats[0].val, lng: lngs[0].val };
      if (geo.isPlausibleCoord(loose)) return loose;
    }

    // 2. Combined values: "12.97,77.59", [lng, lat], or a nested {lat,lng}.
    for (var ci = 0; ci < COMBINED_KEYS.length; ci++) {
      var v = idx[COMBINED_KEYS[ci]];
      if (v === undefined || v === null) continue;

      if (typeof v === 'string' && v.indexOf(',') > -1) {
        var parts = v.split(',');
        if (parts.length === 2) {
          var a = parseNum(parts[0]);
          var b = parseNum(parts[1]);
          if (isFinite(a) && isFinite(b)) {
            var fromStr = coordFromPair(a, b);
            if (fromStr) return fromStr;
          }
        }
      } else if (Array.isArray(v) && v.length === 2) {
        var pa = parseNum(v[0]);
        var pb = parseNum(v[1]);
        if (isFinite(pa) && isFinite(pb)) {
          var fromArr = coordFromPair(pa, pb);
          if (fromArr) return fromArr;
        }
      } else if (typeof v === 'object') {
        var nested = extractCoord(v);
        if (nested) return nested;
      }
    }

    return null;
  }

  function majority(items, pred) {
    if (!items.length) return false;
    var hits = 0;
    for (var i = 0; i < items.length; i++) if (pred(items[i])) hits++;
    return hits / items.length >= 0.6;
  }

  function hasAny(obj, keys) {
    var idx = keyIndex(obj);
    for (var i = 0; i < keys.length; i++) {
      var v = idx[keys[i]];
      if (v !== undefined && v !== null && v !== '') return true;
    }
    return false;
  }

  /** How much does this array look like a list of stops? */
  function scoreArray(arr, key) {
    if (!Array.isArray(arr) || arr.length === 0) return { score: 0 };
    var objs = [];
    for (var i = 0; i < arr.length; i++) {
      if (arr[i] && typeof arr[i] === 'object' && !Array.isArray(arr[i])) objs.push(arr[i]);
    }
    if (objs.length / arr.length < 0.6) return { score: 0 };

    var sample = objs.slice(0, 12);
    var km = markers(key);
    var score = 0;
    var signals = [];

    if (km.board || km.drop) {
      score += 5;
      signals.push('key-name');
    }
    if (majority(sample, function (o) { return hasAny(o, NAME_KEYS); })) {
      score += 2;
      signals.push('names');
    }
    if (majority(sample, function (o) { return hasAny(o, TIME_KEYS); })) {
      score += 1;
      signals.push('times');
    }
    if (majority(sample, function (o) { return hasAny(o, ADDR_KEYS); })) {
      score += 2;
      signals.push('addresses');
    }
    if (majority(sample, function (o) { return !!extractCoord(o); })) {
      score += 3;
      signals.push('coords');
    }

    return { score: score, signals: signals, count: objs.length };
  }

  /**
   * The key is more specific than the path, so it decides first; the path is
   * only consulted when the key says nothing. An ambiguous signal stays
   * 'unknown' — the UI shows such points under both headings rather than
   * silently guessing one.
   */
  function classifyKind(path, key) {
    var m = markers(key);
    if (m.board && !m.drop) return 'boarding';
    if (m.drop && !m.board) return 'dropping';
    if (!m.board && !m.drop) {
      var p = markers(path);
      if (p.board && !p.drop) return 'boarding';
      if (p.drop && !p.board) return 'dropping';
    }
    return 'unknown';
  }

  function toPoint(obj, kind, path, index) {
    var idx = keyIndex(obj);
    var name = firstMatch(idx, NAME_KEYS);
    var address = firstMatch(idx, ADDR_KEYS);
    // A bare address is better than no label at all.
    if (!name && address) name = address;
    return {
      id: firstMatch(idx, ID_KEYS),
      name: name,
      address: address && address !== name ? address : null,
      time: firstMatch(idx, TIME_KEYS),
      kind: kind,
      coord: extractCoord(obj),
      path: path + '[' + index + ']',
      raw: obj
    };
  }

  /**
   * Depth-first walk, collecting arrays that score above threshold.
   * Cycle-guarded; payloads from the page are untrusted and may self-reference.
   */
  function findPointArrays(json) {
    var found = [];
    var all = [];
    var seen = typeof WeakSet === 'function' ? new WeakSet() : null;

    function visit(node, path, key, depth) {
      if (!node || typeof node !== 'object' || depth > MAX_DEPTH) return;
      if (seen) {
        if (seen.has(node)) return;
        seen.add(node);
      }

      if (Array.isArray(node)) {
        var res = scoreArray(node, key);
        if (res.score > 0) {
          all.push({ path: path, key: key, score: res.score, signals: res.signals, count: res.count });
        }
        if (res.score >= SCORE_THRESHOLD) {
          found.push({ path: path, key: key, arr: node, score: res.score, signals: res.signals });
          // Don't descend into a matched stop list; its children aren't stops.
          return;
        }
        for (var i = 0; i < node.length && i < 200; i++) {
          visit(node[i], path + '[' + i + ']', key, depth + 1);
        }
        return;
      }

      for (var k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        visit(node[k], path ? path + '.' + k : k, k, depth + 1);
      }
    }

    visit(json, '', '', 0);
    return { matched: found, candidates: all };
  }

  /**
   * Main entry. Returns normalized points plus a discovery report describing
   * what was found and what was nearly found — the report is what makes the
   * capture/recon workflow useful.
   */
  function extractPoints(json) {
    var result = { points: [], discoveries: [], withCoords: 0, withoutCoords: 0 };
    if (!json || typeof json !== 'object') return result;

    var scan;
    try {
      scan = findPointArrays(json);
    } catch (e) {
      result.error = String(e && e.message ? e.message : e);
      return result;
    }

    for (var i = 0; i < scan.matched.length; i++) {
      var m = scan.matched[i];
      var kind = classifyKind(m.path, m.key);
      for (var j = 0; j < m.arr.length; j++) {
        var o = m.arr[j];
        if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
        var pt = toPoint(o, kind, m.path, j);
        if (!pt.name) continue;
        if (pt.coord) result.withCoords++; else result.withoutCoords++;
        result.points.push(pt);
      }
    }

    result.discoveries = scan.candidates.sort(function (a, b) { return b.score - a.score; }).slice(0, 40);
    return result;
  }

  /**
   * Compact structural summary for the recon export — keys and types with
   * arrays collapsed to their first element, so a 2 MB payload exports as
   * something a human can actually read.
   */
  function summarizeShape(node, depth) {
    depth = depth || 0;
    if (depth > 6) return '…';
    if (node === null) return 'null';
    if (Array.isArray(node)) {
      if (!node.length) return '[]';
      return [summarizeShape(node[0], depth + 1), '× ' + node.length];
    }
    if (typeof node === 'object') {
      var out = {};
      var n = 0;
      for (var k in node) {
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        if (n++ > 40) { out['…'] = '…'; break; }
        out[k] = summarizeShape(node[k], depth + 1);
      }
      return out;
    }
    return typeof node;
  }

  return {
    SCORE_THRESHOLD: SCORE_THRESHOLD,
    normKey: normKey,
    tokenize: tokenize,
    markers: markers,
    extractCoord: extractCoord,
    scoreArray: scoreArray,
    classifyKind: classifyKind,
    findPointArrays: findPointArrays,
    extractPoints: extractPoints,
    summarizeShape: summarizeShape
  };
});
