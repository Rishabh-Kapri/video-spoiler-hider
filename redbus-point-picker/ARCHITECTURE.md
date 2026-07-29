# Architecture

## The one rule

`src/core/` contains **no browser APIs**. Not `chrome.*`, not `document`, not
`fetch`. It is plain JavaScript that runs unchanged in Node (which is how the
tests drive it).

This is not tidiness for its own sake. The eventual target is Android, and the
only paths there — a Firefox Android build, a WebView shell, or a native app —
all reuse the same two things: the ranking engine and the gazetteer of point
names to coordinates. The extension shell around them is disposable. Keeping
the core free of browser APIs is what makes that swap cheap instead of a
rewrite.

## Layers

```
interceptor.js   MAIN world   patches fetch/XHR, forwards raw JSON
      │ postMessage
content.js       ISOLATED     orchestrates, renders the panel
      │
core/adapter.js               redBus JSON → normalized points   ← redBus-specific
core/ranking.js               dedupe, rank against pins
core/geo.js                   haversine, formatting, map links
shell/storage.js              the only chrome.storage caller
ui/popup.*                    Leaflet picker, saved locations, recon export
```

`adapter.js` is the only file that knows anything about redBus. When the site
changes, that is where it breaks, and nowhere else.

## Why the adapter is heuristic

redBus's internal API is undocumented and was unreachable during development, so
there was no schema to map. Rather than guess at field names and ship something
that silently returns nothing, the adapter walks the payload and scores every
array on how much it resembles a list of stops:

| Signal | Score |
|---|---|
| Key name says boarding/dropping | +5 |
| Most entries have a name field | +2 |
| Most entries have an address | +2 |
| Most entries have a coordinate | +3 |
| Most entries have a time | +1 |

At or above 5, it's treated as a stop list. A key called `boardingPoints`
qualifies on its own; so does an unnamed array whose entries carry names,
addresses and coordinates.

Coordinates are read from any of: `lat`/`lng`, `latitude`/`longitude`, prefixed
`bpLat`/`bpLng`, a combined `"12.97,77.59"` string, a GeoJSON `[lng, lat]` pair
(re-ordered on the way in), or a nested `location` object.

Two decisions worth keeping:

- **Coordinates are validated against a region box, and integer pairs are
  rejected.** redBus seat layouts carry `x`/`y` grid indices; without this,
  seat 12/77 reads as a pin in Bengaluru.
- **Ambiguous classification stays ambiguous.** A container named `bpDpDetails`
  holds both lists, so it resolves to `unknown`, and such points appear under
  both headings flagged `?` rather than being silently filed as one.

Once you've done a recon export and know the real shape, tighten this — but
keep the fallback. The heuristic is what makes a schema change degrade instead
of fail.

## Deduplication

Stop identity is the **name**; the coordinate is an attribute of it. Keying on
both would strand a coordinate-less copy of a stop in its own group — precisely
the copy that most needs to inherit a coordinate from its twin. Same-named
points more than 2 km apart are kept separate, since those are genuinely
different places that happen to share a name.

This matters at scale: a route with 100 buses yields the same ~30 stop names
over and over, and it's also what makes Phase 4 affordable.

## Roadmap

**Phase 2 — rank the whole result list.** Badge each bus card with its nearest
boarding/dropping distance and allow sorting by it. This is where the real
value is: boarding points differ per operator, so ranking one bus at a time
still means opening every bus. If point lists turn out to be lazy-loaded per
bus, fetch only for visible or filtered cards, throttle, and cache per
route+date.

**Phase 3 — Firefox, then Firefox Android.** The manifest already declares
`browser_specific_settings` and targets 128+ (the first release with both MV3
and `world: "MAIN"` on Android). Expect the mobile web DOM to differ from
desktop; forcing "Desktop site" avoids supporting two surfaces.

**Phase 4 — geocoding, only if recon says it's needed.** The ladder, in order:

1. coordinate from the payload
2. cached gazetteer (`normalized name → coords`)
3. geocode on demand, city-biased, throttled, deduplicated
4. unknown → user drops a pin, which writes back to the cache

Step 3 looks impossible (100 buses × 10 points = 1000 lookups) and isn't:
distinct names per city are more like 50–100 because operators share landmarks.
Dedupe first, cache permanently, and the tool gets faster with use. Note that
Nominatim's usage policy forbids bulk automated querying — that path needs a
real User-Agent, hard throttling, and probably a bundled seed gazetteer for
your regular cities. A background service worker is the right home for that
queue; there is deliberately none yet.

## Testing

`test/run.js` covers the core, with emphasis on the adapter's false-positive
cases — seat grids, array indices, out-of-region numbers.

`test/smoke.js` loads the actual unpacked extension into Chromium and points it
at a local HTTP server standing in for redbus.in via
`--host-resolver-rules`, so the content scripts match their normal
`*://*.redbus.in/*` pattern without weakening the manifest for tests.

One trap worth recording: extensions **do not load** under Playwright's default
`headless: true`. It fails silently — no error, no extension. `channel:
'chromium'` selects the new headless mode, which does load them.
