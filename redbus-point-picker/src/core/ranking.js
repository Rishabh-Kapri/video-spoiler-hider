/**
 * Ranks normalized points against the user's two pins.
 * No browser APIs — keep portable.
 */
(function (root, factory) {
  var mod = factory(
    (typeof module === 'object' && module.exports) ? require('./geo.js') : root.RB.geo
  );
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.RB = root.RB || {};
  root.RB.ranking = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (geo) {
  'use strict';

  // Two stops this far apart are different places that happen to share a name.
  var SAME_STOP_KM = 2;

  function dedupeKey(pt) {
    return (pt.name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  /**
   * Identity is the name; the coordinate is an attribute of it. Keying on both
   * would strand a coordinate-less copy of a stop in its own group, which is
   * exactly the copy that most needs to inherit a coordinate from its twin.
   */
  function canMerge(a, b) {
    if (!a.coord || !b.coord) return true;
    var d = geo.haversineKm(a.coord, b.coord);
    return d === null || d <= SAME_STOP_KM;
  }

  /**
   * Collapse repeats. The same physical stop appears once per operator, so a
   * route with 100 buses yields the same 30 names over and over.
   */
  function dedupe(points) {
    var buckets = Object.create(null);
    var out = [];
    for (var i = 0; i < points.length; i++) {
      var pt = points[i];
      var key = dedupeKey(pt);
      if (!key) continue;

      var bucket = buckets[key] || (buckets[key] = []);
      var merged = false;
      for (var j = 0; j < bucket.length; j++) {
        if (!canMerge(bucket[j].point, pt)) continue;
        bucket[j].occurrences++;
        // Prefer the copy that actually carries a coordinate.
        if (!bucket[j].point.coord && pt.coord) bucket[j].point = pt;
        merged = true;
        break;
      }
      if (merged) continue;

      var entry = { point: pt, occurrences: 1 };
      bucket.push(entry);
      out.push(entry);
    }
    return out;
  }

  function rankAgainst(entries, pin) {
    var ranked = [];
    for (var i = 0; i < entries.length; i++) {
      var pt = entries[i].point;
      ranked.push({
        point: pt,
        occurrences: entries[i].occurrences,
        distanceKm: pt.coord && pin ? geo.haversineKm(pin, pt.coord) : null,
        kindUncertain: pt.kind === 'unknown'
      });
    }
    ranked.sort(function (a, b) {
      // Unresolved points sink to the bottom rather than sorting as zero.
      if (a.distanceKm === null && b.distanceKm === null) {
        return (a.point.name || '').localeCompare(b.point.name || '');
      }
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
    for (var r = 0; r < ranked.length; r++) ranked[r].rank = r + 1;
    return ranked;
  }

  /**
   * @param points  normalized points from the adapter
   * @param pins    { origin?: {lat,lng}, destination?: {lat,lng} }
   *
   * Points whose kind couldn't be determined appear in both lists, flagged
   * `kindUncertain`, rather than being silently dropped or guessed at.
   */
  function rankPoints(points, pins) {
    pins = pins || {};
    var boardingSrc = [];
    var droppingSrc = [];

    for (var i = 0; i < points.length; i++) {
      var pt = points[i];
      if (pt.kind === 'boarding') boardingSrc.push(pt);
      else if (pt.kind === 'dropping') droppingSrc.push(pt);
      else { boardingSrc.push(pt); droppingSrc.push(pt); }
    }

    return {
      boarding: rankAgainst(dedupe(boardingSrc), pins.origin),
      dropping: rankAgainst(dedupe(droppingSrc), pins.destination),
      resolvedCount: points.filter(function (p) { return !!p.coord; }).length,
      totalCount: points.length
    };
  }

  return { rankPoints: rankPoints, dedupe: dedupe, rankAgainst: rankAgainst };
});
