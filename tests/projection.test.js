/* The camera: sky rotation around the pole, scale, zoom, parallax, resize. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadPage } = require('./harness/env.js');

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} to be within ${eps} of ${b}`);

/* the page runs in its own realm, so compare plain values, not object identity */
const viewportOf = page => {
  const v = page.api.viewport;
  return { W: v.W, H: v.H, DPR: v.DPR };
};

/** A page with the camera parked and parallax settled. */
function fixture(opts = {}) {
  const page = loadPage(opts);
  page.settleParallax();
  page.api.skyRot = 0;
  page.api.cam = { x: 1000, y: 660, zoom: 1 };
  return page;
}

test('baseScale covers the sky in both axes at 0.92 of the tightest fit', () => {
  const cases = [
    [1200, 800], [2000, 1400], [600, 900], [3840, 1080]
  ];
  for (const [w, h] of cases) {
    const page = fixture({ width: w, height: h });
    const { SKY_W, SKY_H } = page.api;
    near(page.api.baseScale(), Math.max(w / SKY_W, h / SKY_H) * 0.92, 1e-12);
  }
});

test('resize tracks the viewport and clamps the pixel ratio at 2', () => {
  const page = fixture({ width: 1000, height: 700, dpr: 3 });
  assert.deepEqual(viewportOf(page), { W: 1000, H: 700, DPR: 2 });
  assert.deepEqual(
    { w: page.canvas.width, h: page.canvas.height },
    { w: 2000, h: 1400 }
  );
  assert.equal(page.canvas.style.width, '1000px');

  page.resizeTo(800, 600, 1);
  assert.deepEqual(viewportOf(page), { W: 800, H: 600, DPR: 1 });
  assert.deepEqual({ w: page.canvas.width, h: page.canvas.height }, { w: 800, h: 600 });
  assert.equal(page.canvas.style.height, '600px');
});

test('the camera centre lands in the middle of the screen', () => {
  const page = fixture({ width: 1200, height: 800 });
  page.api.cam = { x: 700, y: 500, zoom: 1.3 };
  const [x, y] = page.api.project(700, 500);
  near(x, 600);
  near(y, 400);
});

test('the pole does not move, however far the sky has turned', () => {
  const page = fixture();
  const { POLE } = page.api;
  const atRest = page.api.project(POLE.x, POLE.y);
  for (const rot of [0.1, 1, Math.PI, 4.5, -2]) {
    page.api.skyRot = rot;
    const turned = page.api.project(POLE.x, POLE.y);
    near(turned[0], atRest[0], 1e-9);
    near(turned[1], atRest[1], 1e-9);
  }
});

test('rotation is rigid: distance from the pole is preserved', () => {
  const page = fixture();
  const { POLE } = page.api;
  const pole = page.api.project(POLE.x, POLE.y);
  const star = page.api.CONSTELLATIONS.machine.stars[0];
  const radius = Math.hypot(...page.api.project(star.x, star.y).map((v, i) => v - pole[i]));
  for (const rot of [0.4, 2.2, 5.9]) {
    page.api.skyRot = rot;
    const p = page.api.project(star.x, star.y);
    near(Math.hypot(p[0] - pole[0], p[1] - pole[1]), radius, 1e-9);
  }
});

test('a quarter turn takes a star a quarter of the way round the pole', () => {
  const page = fixture();
  const { POLE } = page.api;
  page.api.skyRot = Math.PI / 2;
  const [x, y] = page.api.project(POLE.x + 100, POLE.y);
  const [px, py] = page.api.project(POLE.x, POLE.y);
  const scale = page.api.baseScale();
  near(x - px, 0, 1e-9);
  near(y - py, 100 * scale, 1e-9);
});

test('zoom scales distance from the camera linearly', () => {
  const page = fixture();
  page.api.cam = { x: 1000, y: 660, zoom: 1 };
  const one = page.api.project(1200, 760);
  page.api.cam = { x: 1000, y: 660, zoom: 2 };
  const two = page.api.project(1200, 760);
  const { W, H } = viewportOf(page);
  near(two[0] - W / 2, (one[0] - W / 2) * 2, 1e-9);
  near(two[1] - H / 2, (one[1] - H / 2) * 2, 1e-9);
});

test('panning the camera slides the sky the other way', () => {
  const page = fixture();
  const before = page.api.project(1200, 760);
  page.api.cam = { x: 1100, y: 660, zoom: 1 };
  const after = page.api.project(1200, 760);
  near(after[0] - before[0], -100 * page.api.baseScale(), 1e-9);
  near(after[1], before[1], 1e-9);
});

test('pointer parallax offsets the whole sky, bounded by its own limits', () => {
  const page = fixture();
  const before = page.api.project(1200, 760);

  page.dispatch('pointermove', { clientX: 0, clientY: 0 });
  const par = page.api.par;
  near(par.tx, 7);
  near(par.ty, 5);

  page.dispatch('pointermove', { clientX: page.window.innerWidth, clientY: page.window.innerHeight });
  near(page.api.par.tx, -7);
  near(page.api.par.ty, -5);

  /* the offset only reaches the projection once the easing in frame() applies it */
  par.x = 3; par.y = -2;
  const after = page.api.project(1200, 760);
  near(after[0] - before[0], 3);
  near(after[1] - before[1], -2);
});

test('parallax eases toward the pointer target across frames', () => {
  const page = loadPage();
  page.dispatch('pointermove', { clientX: 0, clientY: 0 });
  const par = page.api.par;
  assert.equal(par.x, 0);
  page.runFrames(1);
  assert.ok(par.x > 0 && par.x < par.tx, 'moved part of the way');
  const first = par.x;
  page.runFrames(30);
  assert.ok(par.x > first, 'keeps closing the gap');
  assert.ok(par.x < par.tx, 'never overshoots');
});

test('the whole chart is on screen at the wide focus', () => {
  const page = fixture({ width: 1440, height: 900 });
  const { W, H } = viewportOf(page);
  for (const star of page.allStars()) {
    const [x, y] = page.api.project(star.x, star.y);
    assert.ok(x > -W && x < W * 2, `${star.name} is not far off screen horizontally`);
    assert.ok(y > -H && y < H * 2, `${star.name} is not far off screen vertically`);
  }
});
