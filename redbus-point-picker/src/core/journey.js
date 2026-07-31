/**
 * Identifies which journey a page is showing, so captured points survive
 * in-page navigation.
 *
 * The naive "pathname + query" key resets state on any URL change, including
 * redBus's own tab switches (Select Seats → Board/Drop point), which wiped
 * every captured point mid-session. A journey is defined by its city pair and
 * date and nothing else; tabs, filters, scroll anchors and tracking params are
 * all noise.
 *
 * No browser APIs — keep portable.
 */
(function (root, factory) {
  var mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.RB = root.RB || {};
  root.RB.journey = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // "bangalore-to-hyderabad", "new-delhi-to-jaipur"
  var CITY_PAIR_RE = /([a-z0-9]+(?:-[a-z0-9]+)*?)-to-([a-z0-9]+(?:-[a-z0-9]+)*)/;

  // Params that genuinely change which buses are listed.
  var DATE_PARAM_RE = /(date|onward|doj|journey|dep|travel)/i;

  function parse(href) {
    try {
      return new URL(href);
    } catch (e) {
      return null;
    }
  }

  /**
   * Stable identity for the journey a URL describes. Two URLs that differ only
   * by tab, filter or tracking parameter produce the same key.
   */
  function journeyKey(href) {
    var u = parse(href);
    if (!u) return String(href || '');

    var pathname = (u.pathname || '').toLowerCase();

    var dates = [];
    try {
      u.searchParams.forEach(function (value, key) {
        if (DATE_PARAM_RE.test(key)) dates.push(key.toLowerCase() + '=' + value);
      });
    } catch (e) {
      /* older URL implementations */
    }
    dates.sort();
    var datePart = dates.join('&');

    var pair = pathname.match(CITY_PAIR_RE);
    if (pair) return pair[1] + '>' + pair[2] + '|' + datePart;

    // No recognisable city pair — fall back to the path alone. Still far less
    // trigger-happy than including the whole query string.
    return pathname + '|' + datePart;
  }

  /** Does this URL name a city pair? Absence means "sub-page", not "new search". */
  function hasCityPair(href) {
    var u = parse(href);
    var pathname = u ? (u.pathname || '') : String(href || '');
    return CITY_PAIR_RE.test(pathname.toLowerCase());
  }

  /**
   * Should captured points be discarded when moving from one URL to another?
   *
   * Only when both URLs identify a journey and those journeys differ. A move to
   * or from a page with no city pair is a detail view, not a new search — and
   * throwing away the points there is exactly the bug this guards against.
   */
  function isNewJourney(prevHref, nextHref) {
    if (!hasCityPair(prevHref) || !hasCityPair(nextHref)) return false;
    return journeyKey(prevHref) !== journeyKey(nextHref);
  }

  return {
    journeyKey: journeyKey,
    hasCityPair: hasCityPair,
    isNewJourney: isNewJourney,
    CITY_PAIR_RE: CITY_PAIR_RE
  };
});
