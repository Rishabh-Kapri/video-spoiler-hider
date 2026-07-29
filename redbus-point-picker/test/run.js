/**
 * Zero-dependency test runner: `node test/run.js`
 *
 * The adapter is the risky part — redBus's real payload shape is unverified, so
 * these cases cover the encodings it plausibly uses plus the false positives we
 * must not fall for (seat grids, array indices).
 */
'use strict';

var assert = require('assert');
var geo = require('../src/core/geo.js');
var adapter = require('../src/core/adapter.js');
var ranking = require('../src/core/ranking.js');

var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name);
    console.log('       ' + (e && e.message ? e.message : e));
  }
}

function group(name) {
  console.log('\n' + name);
}

// --- geo ---------------------------------------------------------------------

group('geo');

test('haversine matches one degree of latitude', function () {
  var d = geo.haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
  assert.ok(Math.abs(d - 111.19) < 0.5, 'expected ~111.19 km, got ' + d);
});

test('haversine across Bengaluru is in the right ballpark', function () {
  var majestic = { lat: 12.9774, lng: 77.5726 };
  var silkBoard = { lat: 12.9172, lng: 77.6229 };
  var d = geo.haversineKm(majestic, silkBoard);
  assert.ok(d > 8 && d < 9.5, 'expected 8-9.5 km, got ' + d);
});

test('haversine returns null for missing points', function () {
  assert.strictEqual(geo.haversineKm(null, { lat: 1, lng: 1 }), null);
  assert.strictEqual(geo.haversineKm({ lat: 1, lng: 1 }, undefined), null);
});

test('plausible coords accept a real Indian pin', function () {
  assert.strictEqual(geo.isPlausibleCoord({ lat: 12.9716, lng: 77.5946 }), true);
});

test('plausible coords reject integer pairs (grid indices)', function () {
  assert.strictEqual(geo.isPlausibleCoord({ lat: 12, lng: 77 }), false);
});

test('plausible coords reject out-of-region and null island', function () {
  assert.strictEqual(geo.isPlausibleCoord({ lat: 48.8566, lng: 2.3522 }), false);
  assert.strictEqual(geo.isPlausibleCoord({ lat: 0, lng: 0 }), false);
});

test('formatDistance switches units sensibly', function () {
  assert.strictEqual(geo.formatDistance(0.85), '850 m');
  assert.strictEqual(geo.formatDistance(2.34), '2.3 km');
  assert.strictEqual(geo.formatDistance(23.4), '23 km');
  assert.strictEqual(geo.formatDistance(null), '—');
});

test('maps links are https and encode the destination', function () {
  var url = geo.mapsDirectionsUrl({ lat: 12.9, lng: 77.5 }, { lat: 12.97, lng: 77.59 });
  assert.ok(url.indexOf('https://') === 0);
  assert.ok(url.indexOf('12.97%2C77.59') > -1, url);
});

// --- adapter: coordinate extraction -----------------------------------------

group('adapter / extractCoord');

test('flat lat + lng', function () {
  assert.deepStrictEqual(adapter.extractCoord({ lat: 12.9716, lng: 77.5946 }), { lat: 12.9716, lng: 77.5946 });
});

test('latitude + longitude spelled out', function () {
  assert.deepStrictEqual(adapter.extractCoord({ latitude: 12.9716, longitude: 77.5946 }), { lat: 12.9716, lng: 77.5946 });
});

test('prefixed bpLat / bpLng', function () {
  assert.deepStrictEqual(adapter.extractCoord({ bpLat: 12.9716, bpLng: 77.5946 }), { lat: 12.9716, lng: 77.5946 });
});

test('prefixes are paired, not crossed', function () {
  var c = adapter.extractCoord({ bpLat: 12.9716, bpLng: 77.5946, dpLat: 17.385, dpLng: 78.4867 });
  assert.deepStrictEqual(c, { lat: 12.9716, lng: 77.5946 });
});

test('combined "lat,lng" string', function () {
  assert.deepStrictEqual(adapter.extractCoord({ latLong: '12.9716,77.5946' }), { lat: 12.9716, lng: 77.5946 });
});

test('combined string with whitespace', function () {
  assert.deepStrictEqual(adapter.extractCoord({ latLng: ' 12.9716 , 77.5946 ' }), { lat: 12.9716, lng: 77.5946 });
});

test('numeric strings in separate fields', function () {
  assert.deepStrictEqual(adapter.extractCoord({ lat: '12.9716', lng: '77.5946' }), { lat: 12.9716, lng: 77.5946 });
});

test('GeoJSON-style [lng, lat] is re-ordered', function () {
  assert.deepStrictEqual(adapter.extractCoord({ coordinates: [77.5946, 12.9716] }), { lat: 12.9716, lng: 77.5946 });
});

test('nested location object', function () {
  assert.deepStrictEqual(
    adapter.extractCoord({ name: 'X', location: { lat: 12.9716, lng: 77.5946 } }),
    { lat: 12.9716, lng: 77.5946 }
  );
});

test('seat grid coordinates are not mistaken for a pin', function () {
  assert.strictEqual(adapter.extractCoord({ x: 3, y: 12, seatNo: 'A1' }), null);
  assert.strictEqual(adapter.extractCoord({ row: 2, column: 30 }), null);
  assert.strictEqual(adapter.extractCoord({ coordinates: [3, 12] }), null);
});

test('out-of-region coordinates are rejected', function () {
  assert.strictEqual(adapter.extractCoord({ lat: 48.8566, lng: 2.3522 }), null);
});

test('objects with no coordinate at all', function () {
  assert.strictEqual(adapter.extractCoord({ name: 'Madiwala', time: '22:30' }), null);
  assert.strictEqual(adapter.extractCoord(null), null);
});

// --- adapter: kind classification -------------------------------------------

group('adapter / classifyKind');

test('boarding keys classify as boarding', function () {
  assert.strictEqual(adapter.classifyKind('data.boardingPoints', 'boardingPoints'), 'boarding');
  assert.strictEqual(adapter.classifyKind('bpList', 'bpList'), 'boarding');
});

test('dropping keys classify as dropping', function () {
  assert.strictEqual(adapter.classifyKind('data.droppingPoints', 'droppingPoints'), 'dropping');
  assert.strictEqual(adapter.classifyKind('dpList', 'dpList'), 'dropping');
});

test('ambiguous container names stay unknown rather than guessing', function () {
  assert.strictEqual(adapter.classifyKind('bpDpDetails', 'bpDpDetails'), 'unknown');
  assert.strictEqual(adapter.classifyKind('data.stops', 'stops'), 'unknown');
});

// --- adapter: whole payloads -------------------------------------------------

group('adapter / extractPoints');

var payloadWithCoords = {
  status: 'SUCCESS',
  data: {
    inventories: [
      {
        operator: 'Orange Travels',
        boardingPoints: [
          { bpId: 1, name: 'Madiwala Check Post', address: 'Hosur Road', time: '21:30', lat: 12.9223, lng: 77.6194 },
          { bpId: 2, name: 'Electronic City', address: 'NH44', time: '22:10', lat: 12.8452, lng: 77.6602 }
        ],
        droppingPoints: [
          { dpId: 9, name: 'Miyapur', address: 'Miyapur X Road', time: '06:15', lat: 17.4948, lng: 78.3578 }
        ]
      }
    ]
  }
};

test('finds boarding and dropping points with coordinates', function () {
  var res = adapter.extractPoints(payloadWithCoords);
  assert.strictEqual(res.points.length, 3);
  assert.strictEqual(res.withCoords, 3);
  assert.strictEqual(res.withoutCoords, 0);
  var boarding = res.points.filter(function (p) { return p.kind === 'boarding'; });
  var dropping = res.points.filter(function (p) { return p.kind === 'dropping'; });
  assert.strictEqual(boarding.length, 2);
  assert.strictEqual(dropping.length, 1);
  assert.strictEqual(boarding[0].name, 'Madiwala Check Post');
  assert.strictEqual(boarding[0].time, '21:30');
});

test('records the JSON path so the shape can be hardened later', function () {
  var res = adapter.extractPoints(payloadWithCoords);
  assert.ok(/inventories\[0\]\.boardingPoints\[0\]/.test(res.points[0].path), res.points[0].path);
});

test('handles points that carry no coordinates (the geocoding case)', function () {
  var res = adapter.extractPoints({
    bpList: [
      { name: 'Anand Rao Circle', time: '20:00' },
      { name: 'Yeshwantpur', time: '20:40' }
    ]
  });
  assert.strictEqual(res.points.length, 2);
  assert.strictEqual(res.withCoords, 0);
  assert.strictEqual(res.withoutCoords, 2);
  assert.strictEqual(res.points[0].coord, null);
});

test('falls back to address when no name field exists', function () {
  var res = adapter.extractPoints({
    boardingPoints: [{ address: 'Kalasipalya Bus Stand, Bengaluru', time: '19:00' }]
  });
  assert.strictEqual(res.points.length, 1);
  assert.strictEqual(res.points[0].name, 'Kalasipalya Bus Stand, Bengaluru');
});

test('ignores seat layouts that superficially resemble point lists', function () {
  var res = adapter.extractPoints({
    seatLayout: {
      seats: [
        { name: 'A1', x: 1, y: 1, fare: 900 },
        { name: 'A2', x: 2, y: 1, fare: 900 },
        { name: 'A3', x: 3, y: 1, fare: 900 }
      ]
    }
  });
  assert.strictEqual(res.points.length, 0);
});

test('survives an unrecognised payload without throwing', function () {
  assert.strictEqual(adapter.extractPoints({ foo: 'bar' }).points.length, 0);
  assert.strictEqual(adapter.extractPoints(null).points.length, 0);
  assert.strictEqual(adapter.extractPoints([]).points.length, 0);
});

test('survives a self-referencing payload', function () {
  var cyclic = { data: {} };
  cyclic.data.self = cyclic;
  cyclic.data.boardingPoints = [{ name: 'Hebbal', lat: 13.0358, lng: 77.5970 }];
  var res = adapter.extractPoints(cyclic);
  assert.strictEqual(res.points.length, 1);
});

test('reports scored candidates for recon even below threshold', function () {
  var res = adapter.extractPoints(payloadWithCoords);
  assert.ok(res.discoveries.length > 0);
  assert.ok(res.discoveries[0].score >= adapter.SCORE_THRESHOLD);
  assert.ok(Array.isArray(res.discoveries[0].signals));
});

test('summarizeShape collapses arrays instead of dumping them', function () {
  var shape = adapter.summarizeShape(payloadWithCoords);
  assert.strictEqual(shape.status, 'string');
  assert.ok(Array.isArray(shape.data.inventories));
  assert.strictEqual(shape.data.inventories[1], '× 1');
});

// --- ranking -----------------------------------------------------------------

group('ranking');

var pins = {
  origin: { lat: 12.9223, lng: 77.6194 },
  destination: { lat: 17.4948, lng: 78.3578 }
};

test('sorts boarding points by distance from the origin pin', function () {
  var res = adapter.extractPoints(payloadWithCoords);
  var ranked = ranking.rankPoints(res.points, pins);
  assert.strictEqual(ranked.boarding[0].point.name, 'Madiwala Check Post');
  assert.ok(ranked.boarding[0].distanceKm < 0.1);
  assert.ok(ranked.boarding[1].distanceKm > ranked.boarding[0].distanceKm);
  assert.strictEqual(ranked.boarding[0].rank, 1);
});

test('points without coordinates sort last, not as zero', function () {
  var points = [
    { name: 'No coords', kind: 'boarding', coord: null, path: 'a[0]' },
    { name: 'Far', kind: 'boarding', coord: { lat: 12.8452, lng: 77.6602 }, path: 'a[1]' },
    { name: 'Near', kind: 'boarding', coord: { lat: 12.9223, lng: 77.6194 }, path: 'a[2]' }
  ];
  var ranked = ranking.rankPoints(points, pins);
  assert.strictEqual(ranked.boarding[0].point.name, 'Near');
  assert.strictEqual(ranked.boarding[1].point.name, 'Far');
  assert.strictEqual(ranked.boarding[2].point.name, 'No coords');
});

test('repeated stops collapse and count their occurrences', function () {
  var points = [
    { name: 'Madiwala', kind: 'boarding', coord: { lat: 12.9223, lng: 77.6194 }, path: 'a[0]' },
    { name: 'Madiwala', kind: 'boarding', coord: { lat: 12.9223, lng: 77.6194 }, path: 'b[0]' },
    { name: 'Madiwala', kind: 'boarding', coord: { lat: 12.9224, lng: 77.6195 }, path: 'c[0]' }
  ];
  var ranked = ranking.rankPoints(points, pins);
  assert.strictEqual(ranked.boarding.length, 1);
  assert.strictEqual(ranked.boarding[0].occurrences, 3);
});

test('dedupe prefers the copy that carries a coordinate', function () {
  var entries = ranking.dedupe([
    { name: 'Hebbal', kind: 'boarding', coord: null, path: 'a[0]' },
    { name: 'Hebbal', kind: 'boarding', coord: { lat: 13.0358, lng: 77.597 }, path: 'b[0]' }
  ]);
  assert.strictEqual(entries.length, 1);
  assert.ok(entries[0].point.coord, 'expected the coordinate-bearing copy to win');
});

test('unclassified points appear in both lists, flagged', function () {
  var points = [{ name: 'Somewhere', kind: 'unknown', coord: { lat: 12.9223, lng: 77.6194 }, path: 'a[0]' }];
  var ranked = ranking.rankPoints(points, pins);
  assert.strictEqual(ranked.boarding.length, 1);
  assert.strictEqual(ranked.dropping.length, 1);
  assert.strictEqual(ranked.boarding[0].kindUncertain, true);
});

test('missing pins degrade to a listing rather than throwing', function () {
  var res = adapter.extractPoints(payloadWithCoords);
  var ranked = ranking.rankPoints(res.points, {});
  assert.strictEqual(ranked.boarding.length, 2);
  assert.strictEqual(ranked.boarding[0].distanceKm, null);
});

// --- summary -----------------------------------------------------------------

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
