# Tests

`index.html` is the whole site: one hand-written page, no build step, no runtime
dependencies. The tests keep it that way — they are plain Node scripts with zero
`npm install`, and **they never ask the page to change shape**.

```sh
npm test          # run every suite
npm run coverage  # coverage of the inline script, in index.html line numbers
```

Requires Node 20 or newer. Nothing else.

## How the page is loaded

Everything the site does lives inside one IIFE that exports nothing, so
`tests/harness/env.js`:

1. reads `index.html` and pulls out the single inline `<script>`;
2. appends a few accessor lines to that **string** — `CONSTELLATIONS`,
   `project()`, `hitTest()`, the camera, the score — so the production file is
   never touched;
3. evaluates it in a `node:vm` context wired to hand-written doubles for the
   DOM, the 2D canvas, WebAudio, `IntersectionObserver`,
   `requestAnimationFrame` and the timers (`tests/harness/dom.js`).

The render loop is driven by hand (`stepFrame`, `runFrames`), `Math.random` and
`performance.now` are pinnable, and no real timers or animation frames are ever
scheduled — so every test is deterministic.

If a suite starts failing after an edit to `index.html`, the likely causes are
the accessor hook (a renamed internal) or the selectors registered in
`buildDocument` (a renamed element or class).

## The suites

| file | what it covers |
| --- | --- |
| `sky-data.test.js` | the chart: constellations, star fields, edge indices, chapter foci, gold tags, links |
| `projection.test.js` | the camera: sky rotation around the pole, base scale, zoom, panning, parallax, resize and DPR clamping |
| `interaction.test.js` | hit testing, the star card and its edge clamping, the hidden room, Escape, the North Star reveal, the Polaris shower, gold tags, cursor feedback |
| `render.test.js` | the seeded starfield, the 40-minute wheel, reduced motion, chapter easing and reveal, card fade-in, meteor spawn/travel/culling |
| `music.test.js` | the toggle and its fades, the four-chord round, a star's pitch from its coordinates, the Polaris swell, the button's `aria-pressed` |
| `page.test.js` | the markup contract: single self-contained page, meta tags, social card asset, the elements the script reaches for |

## Coverage

`npm run coverage` runs the suites in-process under V8 precise coverage and
reports the inline script's coverage mapped back to `index.html` line numbers —
`node --test --experimental-test-coverage` cannot see it, because the code is
not a file on disk. Use `npm run coverage:harness` for coverage of the harness
itself, and `node tools/coverage-page.js --verbose` to list functions no test
ever calls.
