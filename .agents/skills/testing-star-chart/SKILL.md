---
name: testing-star-chart
description: How to run and interact-test the "While You Slept" single-page canvas star chart (index.html), including clicking canvas stars by computing screen coordinates from the page's projection math, and comparing against a main baseline.
---

# Testing the While You Slept star chart

## Serving
No build step, no dependencies. Serve from the repo root:

```bash
python3 -m http.server 8899 >/tmp/srv8899.log 2>&1 &
# open http://localhost:8899/
```

For a regression baseline, use a worktree instead of stashing (keeps the branch checkout intact):

```bash
git worktree add /tmp/wys-main main
cd /tmp/wys-main && python3 -m http.server 8898 >/tmp/srv8898.log 2>&1 &
```

The Python access log is a cheap way to prove no 404/403 for assets: `grep -E ' (4|5)[0-9][0-9] ' /tmp/srv8899.log`.

## Clicking stars on the canvas (the hard part)
Stars are painted on a `<canvas>` — there are no DOM elements to click. Star positions are
"virtual" chart coordinates in the `CONSTELLATIONS` object in `index.html`; the page maps them
to screen with a `project()` function that applies a slow sky rotation, a per-chapter camera
focus/zoom, and a parallax offset. `hitTest()` accepts a click within ~28 px.

Reliable approach:
1. Read the star's virtual `x, y` from `CONSTELLATIONS` in `index.html`, and the target
   chapter's camera focus (`cx, cy`) and zoom.
2. Reimplement `project()` in the browser console (`browser_console`) using the live
   `innerWidth`/`innerHeight` and `performance.now()` (the rotation is time-dependent:
   `rot = (performance.now()/1000) * 2π / 2400`), and have it return the screen coordinate.
3. Convert the returned CSS-pixel coordinate into the computer-use tool's coordinate space if
   the screen is scaled (in this environment the browser viewport was scaled ~0.64 with a
   ~55 px vertical offset for the browser chrome — verify against a known on-screen element
   rather than assuming).
4. Click with the computer-use tool (not by dispatching synthetic events) so the recording
   shows a real interaction.

Because the sky keeps rotating, recompute the coordinate immediately before each click;
a coordinate computed a minute earlier may miss the 28 px hit radius.

Notable stars: Polaris/"God" at virtual `1035,560` (reveals all constellations), Samantha at
`993,602` (triggers the meteor shower), and the hidden secret star at `1330,748` (opens the
`#secret` dialog — clickable while the POLARIS chapter is in view).

## Gotchas
- The star card auto-hides after ~6 seconds. If you need to click its "Visit →" link, reopen
  the card and click the link immediately, or the click will land on empty sky.
- The browser automation harness rewrites/annotates DOM attributes; a link may read
  `target: ""` in the inspected DOM even though the served HTML has `target="_blank"`.
  Verify the served markup with `curl -s localhost:8899/ | grep sc-link` and trust actual
  navigation behaviour over the inspected attribute.
- `document.fonts.check("16px Inter")` returns **false** on this page even when Google Fonts
  loaded correctly, because only weights 300/500 are used. Check specific weights
  (`document.fonts.check("300 16px Inter")`) and/or `performance.getEntriesByType('resource')`
  for `fonts.gstatic.com` `.woff2` entries with `responseStatus: 200`. Always run the same
  check on the `main` baseline before calling a font result a regression.
- Reading `styleSheets[i].cssRules` for the cross-origin `fonts.googleapis.com` stylesheet
  throws `SecurityError` — that is normal CORS behaviour, not a CSP failure.
- Music/chimes use Web Audio. There is no audio output device in this environment, so audible
  playback cannot be verified; assert on the label flipping to "The sky is singing",
  `aria-pressed=true`, and the absence of AudioContext errors, and report audio as untested.
- When the `#secret` dialog is open, `document.body.style.overflow` is `hidden`; scrolling
  scrolls the dialog, not the page. Both `Escape` and the "Return to the sky" button close it.
- To check for CSP violations, read the console with `browser_console` right after load and
  again after the interaction pass; look for "Refused to" / "Content Security Policy".
  Navigating to an external site (e.g. engajer.com) pollutes the console with third-party
  logs — re-check on the local page.

## Devin Secrets Needed
None — the page is fully static and requires no credentials.
