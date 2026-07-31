/**
 * Place search for the pin picker, against Nominatim (OpenStreetMap).
 *
 * URL building and response parsing are pure so they can be tested and reused;
 * the actual fetch belongs to the shell. Nominatim's usage policy allows
 * interactive single-user querying but forbids bulk automation — callers must
 * debounce and cache, which is why `minQueryLength` and the cache live here
 * rather than being left to each call site.
 *
 * No browser APIs — keep portable.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.RB = root.RB || {};
  root.RB.geocode = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var ENDPOINT = 'https://nominatim.openstreetmap.org/search';
  var MIN_QUERY_LENGTH = 3;
  var LIMIT = 6;

  /**
   * @param query   free text, e.g. "koramangala bangalore"
   * @param opts.viewbox  optional [west, south, east, north] to bias results
   *                      toward what the user is currently looking at
   * @param opts.countryCodes  defaults to India
   */
  function buildSearchUrl(query, opts) {
    opts = opts || {};
    var params = [
      'format=jsonv2',
      'addressdetails=1',
      'limit=' + (opts.limit || LIMIT),
      'q=' + encodeURIComponent(String(query || '').trim())
    ];

    var cc = opts.countryCodes === null ? null : (opts.countryCodes || 'in');
    if (cc) params.push('countrycodes=' + encodeURIComponent(cc));

    // Bias, not restrict: "Madiwala" exists in more than one city, and the map
    // the user is looking at is the best available hint about which they mean.
    if (opts.viewbox && opts.viewbox.length === 4) {
      params.push('viewbox=' + opts.viewbox.map(Number).join(','));
      params.push('bounded=0');
    }

    return ENDPOINT + '?' + params.join('&');
  }

  /** Trim Nominatim's verbose display_name to something that fits a list row. */
  function shortLabel(displayName) {
    if (typeof displayName !== 'string') return '';
    var parts = displayName.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    if (parts.length <= 3) return parts.join(', ');
    // Leading name + the two most locally meaningful trailing parts.
    return [parts[0], parts[1], parts[parts.length - 3] || parts[parts.length - 2]]
      .filter(Boolean)
      .join(', ');
  }

  function parseResults(json) {
    if (!Array.isArray(json)) return [];
    var out = [];
    for (var i = 0; i < json.length; i++) {
      var r = json[i];
      if (!r) continue;
      var lat = Number(r.lat);
      var lng = Number(r.lon);
      if (!isFinite(lat) || !isFinite(lng)) continue;
      out.push({
        lat: lat,
        lng: lng,
        label: shortLabel(r.display_name) || r.name || 'Unnamed',
        fullLabel: r.display_name || '',
        type: r.type || r.category || ''
      });
    }
    return out;
  }

  function isQueryable(query) {
    return typeof query === 'string' && query.trim().length >= MIN_QUERY_LENGTH;
  }

  return {
    ENDPOINT: ENDPOINT,
    MIN_QUERY_LENGTH: MIN_QUERY_LENGTH,
    buildSearchUrl: buildSearchUrl,
    parseResults: parseResults,
    shortLabel: shortLabel,
    isQueryable: isQueryable
  };
});
