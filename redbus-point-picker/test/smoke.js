/**
 * End-to-end smoke test: `node test/smoke.js`
 *
 * Unit tests can't cover the risky integration — MAIN-world fetch patching,
 * postMessage across worlds, storage round-trip, panel render. This loads the
 * real unpacked extension into Chromium and points it at a local stand-in for
 * redBus (via --host-resolver-rules), so the content scripts match their normal
 * `*://*.redbus.in/*` pattern without weakening the manifest.
 *
 * Requires Playwright. Skips cleanly if it isn't installed.
 */
'use strict';

var http = require('http');
var path = require('path');
var crypto = require('crypto');

var chromium;
try {
  chromium = require(require.resolve('playwright', {
    paths: [process.env.NODE_PATH || '/opt/node22/lib/node_modules', module.paths].flat()
  })).chromium;
} catch (e) {
  console.log('playwright not available — skipping smoke test');
  process.exit(0);
}

var EXT_DIR = path.resolve(__dirname, '..');
var PORT = 8899;

// Bengaluru boarding points, Hyderabad dropping points, with coordinates.
var FAKE_PAYLOAD = {
  status: 'SUCCESS',
  data: {
    inventories: [
      {
        operator: 'Orange Travels',
        boardingPoints: [
          { bpId: 1, name: 'Madiwala Check Post', address: 'Hosur Road', time: '21:30', lat: 12.9223, lng: 77.6194 },
          { bpId: 2, name: 'Electronic City', address: 'NH44', time: '22:10', lat: 12.8452, lng: 77.6602 },
          { bpId: 3, name: 'Anand Rao Circle', address: 'Gubbi Thotadappa Rd', time: '20:45', lat: 12.9784, lng: 77.5713 }
        ],
        droppingPoints: [
          { dpId: 9, name: 'Miyapur', address: 'Miyapur X Road', time: '06:15', lat: 17.4948, lng: 78.3578 },
          { dpId: 10, name: 'LB Nagar', address: 'LB Nagar Ring Road', time: '07:05', lat: 17.3457, lng: 78.5522 }
        ]
      }
    ]
  }
};

var PAGE_HTML = [
  '<!doctype html><html><head><meta charset="utf-8"><title>Fake redBus</title></head>',
  '<body><h1>Fake redBus search</h1><div id="out">loading…</div>',
  '<script>',
  // Exercise both intercepted transports.
  'fetch("/api/search").then(r=>r.json()).then(j=>{document.getElementById("out").textContent="fetch ok";});',
  'var x=new XMLHttpRequest();x.open("GET","/api/bpdp");x.send();',
  '</script></body></html>'
].join('');

function startServer() {
  return new Promise(function (resolve) {
    var server = http.createServer(function (req, res) {
      if (req.url.indexOf('/api/') === 0) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(FAKE_PAYLOAD));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(PAGE_HTML);
    });
    server.listen(PORT, '127.0.0.1', function () { resolve(server); });
  });
}

/** Chrome derives an unpacked extension's ID from the SHA-256 of its path. */
function unpackedExtensionId(dir) {
  var hash = crypto.createHash('sha256').update(dir, 'utf8').digest('hex').slice(0, 32);
  return hash.split('').map(function (c) {
    return String.fromCharCode(97 + parseInt(c, 16));
  }).join('');
}

var failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log('  ok   ' + name);
  } else {
    failures++;
    console.log('  FAIL ' + name + (detail ? '\n       ' + detail : ''));
  }
}

(async function main() {
  var server = await startServer();
  var userDataDir = path.join(require('os').tmpdir(), 'rbpp-smoke-' + Date.now());
  var extId = unpackedExtensionId(EXT_DIR);

  var context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    // Extensions only load under the new headless mode, which `channel:
    // 'chromium'` selects. Plain `headless: true` silently loads nothing.
    channel: 'chromium',
    args: [
      '--disable-extensions-except=' + EXT_DIR,
      '--load-extension=' + EXT_DIR,
      '--host-resolver-rules=MAP www.redbus.in 127.0.0.1:' + PORT,
      '--no-sandbox'
    ]
  });

  try {
    console.log('\nsmoke (extension id ' + extId + ')');

    // Nominatim is a third party; stub it so the suite stays hermetic.
    var geocodeRequests = [];
    await context.route('**nominatim.openstreetmap.org**', function (route) {
      geocodeRequests.push(route.request().url());
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          { lat: '12.9345', lon: '77.6266', display_name: 'Koramangala, Bengaluru, Karnataka, 560034, India', type: 'suburb' },
          { lat: '12.9279', lon: '77.6271', display_name: 'Koramangala 5th Block, Bengaluru, Karnataka, India', type: 'neighbourhood' }
        ])
      });
    });

    // 1. Set both pins through the popup UI.
    var popup = await context.newPage();
    await popup.goto('chrome-extension://' + extId + '/src/ui/popup.html');
    await popup.waitForSelector('#map', { timeout: 15000 });
    check('popup loads', true);

    await popup.fill('#coord-input', '12.9223, 77.6194');
    await popup.click('#coord-apply');
    await popup.click('#slot-destination');
    await popup.fill('#coord-input', '17.4948, 78.3578');
    await popup.click('#coord-apply');

    var originText = await popup.textContent('#val-origin');
    var destText = await popup.textContent('#val-destination');
    check('pickup pin persists', /12\.92230/.test(originText), 'got: ' + originText);
    check('drop-off pin persists', /17\.49480/.test(destText), 'got: ' + destText);

    // 1b. Place search — the reason you shouldn't have to hunt on the map.
    await popup.click('#slot-origin');
    await popup.fill('#search-input', 'koramangala');
    await popup.click('#search-go');
    await popup.waitForSelector('#search-results .result', { timeout: 10000 });

    var resultCount = await popup.evaluate(function () {
      return document.querySelectorAll('#search-results .result').length;
    });
    check('search renders results', resultCount === 2, 'got ' + resultCount);

    check('search query is country-scoped and viewbox-biased',
      geocodeRequests.length > 0 &&
      /countrycodes=in/.test(geocodeRequests[0]) &&
      /viewbox=/.test(geocodeRequests[0]),
      geocodeRequests[0]);

    await popup.click('#search-results .result');
    await popup.waitForTimeout(400);
    var afterSearch = await popup.textContent('#val-origin');
    check('picking a result sets the pin with its label',
      /Koramangala/.test(afterSearch) && /12\.93450/.test(afterSearch),
      'got: ' + afterSearch);

    // Restore the pin the ranking assertions below depend on.
    await popup.fill('#coord-input', '12.9223, 77.6194');
    await popup.click('#coord-apply');
    await popup.waitForTimeout(300);

    // 2. Load the stand-in redBus page and let the interceptor work.
    var page = await context.newPage();
    var pageErrors = [];
    page.on('pageerror', function (e) { pageErrors.push(String(e)); });
    var SRP = 'http://www.redbus.in/bus-tickets/bangalore-to-hyderabad?onward=15-Aug-2026';
    await page.goto(SRP, { waitUntil: 'networkidle' });

    await page.waitForSelector('#rbpp-panel', { timeout: 15000 });
    check('panel injects on redbus.in', true);

    await page.waitForFunction(
      function () {
        var el = document.querySelector('#rbpp-panel .rbpp-list');
        return !!el && el.children.length > 0;
      },
      null,
      { timeout: 15000 }
    );

    var result = await page.evaluate(function () {
      function rows(section) {
        var titles = Array.prototype.slice.call(document.querySelectorAll('#rbpp-panel .rbpp-section-title'));
        var head = titles.filter(function (t) { return t.textContent.indexOf(section) === 0; })[0];
        if (!head) return [];
        var list = head.nextElementSibling;
        if (!list || list.tagName !== 'UL') return [];
        return Array.prototype.slice.call(list.children).map(function (li) {
          return {
            name: li.querySelector('.rbpp-name').textContent,
            dist: li.querySelector('.rbpp-dist').textContent
          };
        });
      }
      return {
        boarding: rows('Boarding'),
        dropping: rows('Dropping'),
        foot: document.querySelector('#rbpp-panel .rbpp-foot').textContent,
        badge: document.querySelector('#rbpp-badge').textContent
      };
    });

    check('fetch payload was intercepted and matched',
      /[1-9]\d*\/[1-9]/.test(result.foot), 'footer: ' + result.foot);

    check('boarding points ranked', result.boarding.length === 3,
      JSON.stringify(result.boarding));
    check('nearest boarding point is the one at the pin',
      result.boarding[0] && result.boarding[0].name === 'Madiwala Check Post',
      JSON.stringify(result.boarding));
    check('nearest boarding distance rounds to metres',
      result.boarding[0] && /^\d+ m$/.test(result.boarding[0].dist),
      result.boarding[0] && result.boarding[0].dist);
    check('boarding points sorted ascending',
      result.boarding[1] && result.boarding[1].name === 'Anand Rao Circle',
      JSON.stringify(result.boarding));

    check('dropping points ranked against the second pin',
      result.dropping[0] && result.dropping[0].name === 'Miyapur',
      JSON.stringify(result.dropping));

    check('page reported no script errors', pageErrors.length === 0, pageErrors.join('; '));

    // 3. The interceptor must leave page behaviour untouched.
    var pageOk = await page.textContent('#out');
    check('patched fetch still resolves for the page', pageOk === 'fetch ok', 'got: ' + pageOk);

    // 4. Regression: switching redBus's own tabs used to wipe every point,
    //    because the route key was pathname+query and the tab lives in the query.
    async function boardingCount() {
      return page.evaluate(function () {
        var ul = document.querySelector('#rbpp-panel .rbpp-list');
        return ul ? ul.children.length : 0;
      });
    }

    var before = await boardingCount();
    await page.evaluate(function () {
      history.pushState({}, '', location.pathname + location.search + '&tab=boardingDropping');
    });
    await page.waitForTimeout(2000); // the journey check runs on a 1s interval
    var afterTab = await boardingCount();
    check('points survive a tab switch', afterTab === before && before > 0,
      'before=' + before + ' after=' + afterTab);

    // A genuinely different search must still clear them.
    await page.evaluate(function () {
      history.pushState({}, '', '/bus-tickets/pune-to-goa?onward=15-Aug-2026');
    });
    await page.waitForTimeout(2000);
    var afterNewSearch = await boardingCount();
    check('a different city pair does clear points', afterNewSearch === 0,
      'got ' + afterNewSearch + ' rows');

    console.log('\n' + (failures ? failures + ' failed' : 'all smoke checks passed'));
  } catch (e) {
    failures++;
    console.log('\nsmoke test error: ' + (e && e.message ? e.message : e));
  } finally {
    await context.close();
    server.close();
  }

  process.exit(failures ? 1 : 0);
})();
