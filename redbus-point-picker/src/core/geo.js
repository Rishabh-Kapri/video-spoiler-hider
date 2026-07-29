/**
 * Pure geo math. No browser APIs — this file must stay portable to a native
 * shell (see ARCHITECTURE.md).
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.RB = root.RB || {};
  root.RB.geo = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var EARTH_RADIUS_KM = 6371;

  // Mainland India + islands, generous. Used to reject numbers that merely look
  // like coordinates — redBus seat layouts carry x/y grid indices that would
  // otherwise sail through a naive "is it a number" check.
  var INDIA_BBOX = { minLat: 6, maxLat: 38, minLng: 68, maxLng: 98 };

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  /** Great-circle distance in km, or null if either point is missing. */
  function haversineKm(a, b) {
    if (!isLatLng(a) || !isLatLng(b)) return null;
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var lat1 = toRad(a.lat);
    var lat2 = toRad(b.lat);
    var h =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function isLatLng(p) {
    return (
      !!p &&
      typeof p.lat === 'number' &&
      typeof p.lng === 'number' &&
      isFinite(p.lat) &&
      isFinite(p.lng)
    );
  }

  /**
   * Is this a plausible real-world coordinate for our region?
   *
   * Requires at least one component to have a fractional part. Integer pairs
   * inside the box (say lat 12, lng 77) are far more likely to be array indices
   * or grid positions than an actual pin.
   */
  function isPlausibleCoord(p, bbox) {
    if (!isLatLng(p)) return false;
    var b = bbox || INDIA_BBOX;
    if (p.lat < b.minLat || p.lat > b.maxLat) return false;
    if (p.lng < b.minLng || p.lng > b.maxLng) return false;
    if (p.lat === 0 && p.lng === 0) return false;
    var fractional = p.lat % 1 !== 0 || p.lng % 1 !== 0;
    return fractional;
  }

  /** "850 m" under a km, "2.3 km" above it. */
  function formatDistance(km) {
    if (km === null || km === undefined || !isFinite(km)) return '—';
    if (km < 1) return Math.round(km * 1000) + ' m';
    if (km < 10) return km.toFixed(1) + ' km';
    return Math.round(km) + ' km';
  }

  /** Deep link that works on both desktop and the Google Maps mobile apps. */
  function mapsDirectionsUrl(from, to) {
    if (!isLatLng(to)) return null;
    var dest = to.lat + ',' + to.lng;
    var base = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(dest);
    if (isLatLng(from)) {
      base += '&origin=' + encodeURIComponent(from.lat + ',' + from.lng);
    }
    return base + '&travelmode=walking';
  }

  function mapsPinUrl(p) {
    if (!isLatLng(p)) return null;
    return (
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent(p.lat + ',' + p.lng)
    );
  }

  return {
    EARTH_RADIUS_KM: EARTH_RADIUS_KM,
    INDIA_BBOX: INDIA_BBOX,
    haversineKm: haversineKm,
    isLatLng: isLatLng,
    isPlausibleCoord: isPlausibleCoord,
    formatDistance: formatDistance,
    mapsDirectionsUrl: mapsDirectionsUrl,
    mapsPinUrl: mapsPinUrl
  };
});
