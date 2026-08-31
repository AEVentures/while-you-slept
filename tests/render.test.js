/* The living sky: the seeded starfield, the wheel, chapter focus, meteors. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadPage } = require('./harness/env.js');

const START = 1000; /* performance.now() at load, per the harness */

test('the background starfield is seeded, so the sky is the same every night', () => {
  /* the page seeds a Lehmer generator with 42; reproduce it here */
  let s = 42;
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const expected = [];
  for (let i = 0; i < 520; i++) {
    expected.push({
      x: rnd() * 2000,
      y: rnd() * 1400,
      r: 0.3 + rnd() * 1.1,
      a: 0.15 + rnd() * 0.55,
      tw: 0.5 + rnd() * 2.2,
      ph: rnd() * Math.PI * 2,
      warm: rnd() < 0.17
    });
  }

  const first = loadPage().api.bgStars;
  const second = loadPage().api.bgStars;
  assert.equal(first.length, 520);
  assert.equal(second.length, 520);
  first.forEach((star, i) => {
    const want = expected[i];
    for (const field of ['x', 'y', 'r', 'a', 'tw', 'ph', 'warm']) {
      assert.equal(star[field], want[field], `star ${i}.${field}`);
      assert.equal(second[i][field], want[field], `star ${i}.${field} on reload`);
    }
  });
});

test('the starfield stays inside the sky, faint and small', () => {
  const { bgStars, SKY_W, SKY_H } = loadPage().api;
  for (const s of bgStars) {
    assert.ok(s.x >= 0 && s.x <= SKY_W);
    assert.ok(s.y >= 0 && s.y <= SKY_H);
    assert.ok(s.r >= 0.3 && s.r <= 1.4);
    assert.ok(s.a >= 0.15 && s.a <= 0.7);
  }
  const warm = bgStars.filter(s => s.warm).length;
  assert.ok(warm > 40 && warm < 140, `friends and family are a minority (${warm})`);
});

test('the heavens wheel once every forty minutes', () => {
  const page = loadPage();
  assert.equal(page.api.skyRot, 0);
  page.stepFrame(START + 600_000); /* ten minutes */
  assert.ok(Math.abs(page.api.skyRot - Math.PI / 2) < 1e-9, 'a quarter turn');
  page.stepFrame(START + 2_400_000); /* forty minutes */
  assert.ok(Math.abs(page.api.skyRot - Math.PI * 2) < 1e-9, 'a full revolution');
});

test('reduced motion stops the wheel and the meteors', () => {
  const page = loadPage({ reduceMotion: true });
  assert.equal(page.api.reduceMotion, true);
  page.runFrames(200);
  assert.equal(page.api.skyRot, 0, 'the sky holds still');
  assert.equal(page.api.meteors.length, 0, 'no meteors fall');
});

test('every frame paints the sky and requests the next one', () => {
  const page = loadPage();
  const calls = page.stepFrame(START + 16);
  assert.ok(calls.some(c => c.name === 'createLinearGradient'), 'the sky gradient');
  assert.ok(calls.some(c => c.name === 'fillRect'), 'the backdrop');
  assert.ok(calls.filter(c => c.name === 'arc').length > 100, 'the stars');
  assert.equal(page.frames.length, 1, 'the loop keeps going');
});

test('entering a chapter retargets the camera, which eases in behind it', () => {
  const page = loadPage({ reduceMotion: true }); /* ease = 1: arrives in one frame */
  page.enterSection('machine');
  assert.equal(page.api.activeKey, 'machine');
  assert.equal(page.api.target.zoom, page.api.FOCI.machine.zoom);

  page.stepFrame(START + 16);
  assert.ok(Math.abs(page.api.cam.x - page.api.FOCI.machine.x) < 1e-6);
  assert.ok(Math.abs(page.api.cam.y - page.api.FOCI.machine.y) < 1e-6);
  assert.ok(Math.abs(page.api.cam.zoom - page.api.FOCI.machine.zoom) < 1e-6);
});

test('the camera creeps toward a new chapter instead of jumping', () => {
  const page = loadPage();
  const from = { ...page.api.cam };
  page.enterSection('cure');
  page.stepFrame(START + 16);
  const moved = Math.hypot(page.api.cam.x - from.x, page.api.cam.y - from.y);
  const total = Math.hypot(page.api.FOCI.cure.x - from.x, page.api.FOCI.cure.y - from.y);
  assert.ok(moved > 0, 'it moves');
  assert.ok(moved < total * 0.1, 'but only a fraction of the way per frame');

  page.runFrames(400, START + 32);
  assert.ok(Math.abs(page.api.cam.zoom - page.api.FOCI.cure.zoom) < 0.01, 'it arrives');
});

test('a chapter brightens its own constellation and dims the rest', () => {
  const page = loadPage();
  page.enterSection('hearth');
  page.runFrames(120);
  const state = page.api.state;
  assert.ok(state.hearth.active > 0.9, 'the chapter in view is lit');
  assert.ok(state.hearth.draw > 0.9, 'and fully drawn');
  assert.ok(state.machine.active < 0.35, 'the others recede');
  assert.equal(state.machine.draw, 0, 'and stay undrawn');
});

test('the last chapter reveals the whole chart at once', () => {
  const page = loadPage();
  assert.equal(page.api.allRevealed, false);
  page.enterSection('wide-final');
  assert.equal(page.api.allRevealed, true);
  assert.equal(page.api.activeKey, 'none');
  page.runFrames(120);
  for (const key of Object.keys(page.api.CONSTELLATIONS)) {
    assert.ok(page.api.state[key].draw > 0.9, `${key} is drawn`);
  }
});

test('a chapter card fades in once, then stops being watched', () => {
  const page = loadPage();
  const card = page.sections[1].querySelector('.card');
  assert.equal(card.classList.contains('visible'), false);

  const [observer] = page.intersect(card, false);
  assert.equal(card.classList.contains('visible'), false, 'off screen, still hidden');
  assert.ok(!observer.disconnected);

  page.intersect(card, true);
  assert.ok(card.classList.contains('visible'));
  assert.ok(observer.disconnected, 'the card is revealed only once');
});

test('scrolling a chapter into view also reveals its card', () => {
  const page = loadPage();
  const section = page.enterSection('runner');
  assert.ok(section.querySelector('.card').classList.contains('visible'));
});

test('the wide chapters keep every constellation quiet', () => {
  const page = loadPage();
  page.enterSection('wide');
  assert.equal(page.api.activeKey, 'none');
  page.runFrames(60);
  for (const key of Object.keys(page.api.CONSTELLATIONS)) {
    assert.equal(page.api.state[key].draw, 0, `${key} is not drawn yet`);
  }
});

test('the kin ring answers to Polaris', () => {
  const page = loadPage();
  page.enterSection('polaris');
  page.runFrames(200);
  assert.ok(page.api.state.kin.active > 0.7, 'the ring warms with the pole');

  const other = loadPage();
  other.enterSection('charter');
  other.runFrames(200);
  assert.ok(other.api.state.kin.active < 0.35, 'and stays dim elsewhere');
});

test('meteors cross the sky from one side or the other', () => {
  const page = loadPage({ width: 1000, height: 800 });
  page.setRandom([0.1, 0.5, 0.5, 0.5]); /* fromLeft */
  page.api.spawnMeteor(false);
  const left = page.api.meteors.at(-1);
  assert.ok(left.x < 0, 'enters from the left');
  assert.ok(left.vx > 0, 'travelling right');
  assert.ok(left.vy > 0, 'and falling');
  assert.equal(left.rose, false);

  page.setRandom([0.9, 0.5, 0.5, 0.5]); /* fromRight */
  page.api.spawnMeteor(true);
  const right = page.api.meteors.at(-1);
  assert.ok(right.x > 1000, 'enters from the right');
  assert.ok(right.vx < 0, 'travelling left');
  assert.equal(right.rose, true);
});

test('meteors move, fade and are swept up when they leave', () => {
  const page = loadPage();
  page.api.meteors.push({ x: 100, y: 100, vx: 5, vy: 3, life: 1, rose: false });
  page.stepFrame(START + 16);
  const m = page.api.meteors[0];
  assert.equal(m.x, 105);
  assert.equal(m.y, 103);
  assert.ok(m.life < 1, 'it fades');

  page.api.meteors.push({ x: 100, y: 100, vx: 0, vy: 0, life: 0.005, rose: false });
  page.api.meteors.push({ x: 100, y: 100, vx: 5000, vy: 0, life: 1, rose: false });
  page.stepFrame(START + 32);
  assert.equal(page.api.meteors.length, 1, 'the spent and the departed are gone');
  assert.equal(page.api.meteors[0].x, 110);
});

test('the shower rises from the star nearest the pole, in every direction', () => {
  const page = loadPage();
  page.setRandom(() => 0.5);
  page.api.polarisShower();
  const shower = page.api.meteors;
  assert.equal(shower.length, 9);
  const origin = page.api.project(993, 602);
  shower.forEach(m => {
    assert.ok(Math.abs(m.x - origin[0]) < 1e-9);
    assert.ok(Math.abs(m.y - origin[1]) < 1e-9);
    assert.ok(m.rose);
    assert.ok(Math.hypot(m.vx, m.vy) > 0, 'it is going somewhere');
  });
  const angles = shower.map(m => Math.atan2(m.vy, m.vx));
  assert.equal(new Set(angles.map(a => a.toFixed(3))).size, 9, 'nine different directions');
});

test('the sky eventually throws a meteor of its own accord', () => {
  const page = loadPage();
  page.setRandom(() => 0.5);
  page.runFrames(400);
  assert.ok(page.api.meteors.length > 0, 'something fell');
});
