# redBus Point Picker

Drop two pins on a map once — where you're leaving from, where you're going —
and every redBus boarding and dropping point gets ranked by how far it actually
is from them. No more searching each point name in Maps one at a time.

![panel](docs/panel.png)

## Status

Phase 1. The pipeline works end to end and is covered by tests, but **it has
never run against the real redbus.in** — the machine it was built on couldn't
reach the site. See [Known unknowns](#known-unknowns) before trusting it.

## Install

Chrome / Edge:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this folder

Firefox (desktop, 128+):

1. `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**
2. Pick `manifest.json`

## Use

1. Click the toolbar icon. Tap the map to set your **pickup** pin, switch to
   **drop-off**, tap again. Drag either pin to fine-tune, or paste
   `12.9716, 77.5946` (a pasted Google Maps URL works too).
2. Save them as named locations — you almost certainly reuse the same two or
   three, and then you never open the picker again.
3. Search on redbus.in. A **Points** button appears bottom-right; the panel
   lists the nearest boarding and dropping points with distances and a `map`
   link for walking directions.

Distances are straight-line, which is the right metric for *ranking* candidates
but can mislead where a river or flyover sits between you and the point. The
`map` link is there for exactly that check on your top two or three.

## Known unknowns

The one thing that decides how well this works is whether redBus's own API
returns coordinates for boarding points. That could not be verified during
development, so the extension is built to tell you the answer rather than
assume it:

- **If coordinates are present** — everything works as shown above.
- **If they aren't** — the panel says so, lists the points it found, and leaves
  distances blank. Resolving names to coordinates is Phase 4 (see
  [ARCHITECTURE.md](ARCHITECTURE.md)).

To find out, open the popup → **Developer / recon** → tick **Capture mode**,
run one redBus search, open a bus's *Boarding & Dropping Points*, then
**Export captures**. The export contains, for each captured response:

- `discoveries` — every array scored on how much it resembles a stop list,
  with the signals that fired and its JSON path
- `shape` — the payload structure with arrays collapsed, readable at a glance
- `withCoords` / `withoutCoords` — the actual answer to the question above

Turn capture mode back off afterwards; it stores raw payloads.

## Tests

```sh
npm test        # 38 unit tests, no dependencies
npm run smoke   # loads the real extension into Chromium against a local stand-in
```

The smoke test needs Playwright and skips cleanly without it. It exercises the
part unit tests can't: MAIN-world fetch patching, the cross-world message hop,
storage round-trip, and the rendered panel.

## Mobile

Not yet, and the ceiling is lower than it looks: Chrome for Android has never
supported extensions, and Kiwi is discontinued. Firefox for Android (128+) runs
MV3 and is the only realistic target — the code is kept Firefox-compatible for
that reason. Integrating with the redBus **native app** is a different product
entirely; ARCHITECTURE.md sketches what it would cost.

## Scope and etiquette

This reads data redBus already sent to your own browser, in your own session.
It adds no requests of its own and does not automate anything on the site. If
later phases start fetching point lists for every bus in a result set, that
should be throttled and cached — see ARCHITECTURE.md.
