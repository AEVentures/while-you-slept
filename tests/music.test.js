/* The score: the toggle, the chord cycle, a star's voice, the Polaris swell. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadPage } = require('./harness/env.js');

const PENTA = [523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];

/** Frequencies of every oscillator started so far. */
const pitches = page => page.audio.started.map(o => o.frequency.value);

function silentPage(opts = {}) {
  const page = loadPage({ random: () => 0.5, ...opts });
  return page;
}

test('the sky is silent until asked to sing', () => {
  const page = silentPage();
  assert.equal(page.audio.contexts.length, 0, 'no audio context is built on load');
  page.api.Music.chime(page.api.findStar('Engajer'));
  page.api.Music.swell();
  assert.equal(page.audio.contexts.length, 0, 'and none is built by a silent chime');
});

test('the toggle opens an audio context, resumes it and fades the master in', () => {
  const page = silentPage();
  assert.equal(page.api.Music.toggle(), true);

  assert.equal(page.audio.contexts.length, 1);
  assert.equal(page.audio.contexts[0].state, 'running', 'a suspended context is resumed');
  assert.equal(page.audio.resumes, 1);

  const ramps = page.audio.params.filter(p => p.node === 'gain' && p.op === 'linearRamp');
  assert.ok(ramps.some(r => r.value === 1 && r.when === 3), 'three second fade in');
  assert.equal(page.timers.intervals.at(-1).ms, 16000, 'a chord every sixteen seconds');
});

test('the toggle fades out, stops the clock and can be resumed', () => {
  const page = silentPage();
  page.api.Music.toggle();
  const intervalsBefore = page.timers.intervals.length;
  const clearedBefore = page.timers.cleared.length;

  assert.equal(page.api.Music.toggle(), false);
  assert.ok(page.timers.cleared.length > clearedBefore, 'the chord clock is cleared');
  const fade = page.audio.params.filter(p => p.node === 'gain' && p.op === 'linearRamp').at(-1);
  assert.equal(fade.value, 0);
  assert.equal(fade.when, 1.5);

  const startedBefore = page.audio.started.length;
  assert.equal(page.api.Music.toggle(), true, 'it sings again');
  assert.ok(page.audio.started.length > startedBefore);
  assert.equal(page.audio.contexts.length, 1, 'reusing the same audio context');
  assert.equal(page.timers.intervals.length, intervalsBefore + 1);
});

test('each chord lays down a drone, a five-note pad and a few bells', () => {
  const page = silentPage();
  page.api.Music.toggle();

  /* Cmaj9: root 65.41 with a five-note pad above it */
  const started = pitches(page);
  assert.ok(started.includes(65.41), 'the drone');
  [130.81, 164.81, 196.00, 246.94, 293.66].forEach(f => {
    assert.ok(started.includes(f), `pad tone ${f}`);
  });

  /* voices are doubled and detuned; bells ring an octave pair above the pad */
  const drone = page.audio.started.filter(o => o.frequency.value === 65.41);
  assert.equal(drone.length, 2, 'the drone is two oscillators');
  assert.deepEqual(drone.map(o => o.detune.value), [0, 3], 'the second one is detuned');
  const pad = page.audio.started.filter(o => o.frequency.value === 196.00);
  assert.deepEqual(pad.map(o => o.detune.value), [0, 5], 'pad voices spread wider');
  const bells = started.filter(f => f > 1000);
  assert.ok(bells.length > 0, 'bells fall from the chord');
});

test('the chords walk their four-step round and come back home', () => {
  const page = silentPage();
  page.api.Music.toggle();
  const step = page.timers.intervals.at(-1).fn;

  const roots = [65.41, 55.00, 43.65, 49.00];
  const seen = [];
  for (let i = 0; i < 5; i++) {
    const before = page.audio.started.length;
    if (i > 0) step();
    const fresh = page.audio.started.slice(i === 0 ? 0 : before).map(o => o.frequency.value);
    seen.push(roots.find(r => fresh.includes(r)));
  }
  assert.deepEqual(seen, [...roots, roots[0]], 'Cmaj9 · Am9 · Fmaj9 · G9sus, then round again');
});

test('a stopped score ignores the chord clock', () => {
  const page = silentPage();
  page.api.Music.toggle();
  const step = page.timers.intervals.at(-1).fn;
  page.api.Music.toggle();

  const before = page.audio.started.length;
  step();
  assert.equal(page.audio.started.length, before, 'no chord is played after stopping');
});

test('every star has a voice drawn from its place in the sky', () => {
  const page = silentPage();
  page.api.Music.toggle();

  for (const name of ['Engajer', 'God', 'ARTG', 'GOPcast']) {
    const star = page.api.findStar(name);
    const before = page.audio.started.length;
    page.api.Music.chime(star);
    const fresh = page.audio.started.slice(before);
    const expected = PENTA[Math.floor((star.x + star.y) % PENTA.length)];
    assert.equal(fresh.length, 2, `${name}: a bell is two oscillators`);
    assert.equal(fresh[0].frequency.value, expected, `${name}: pitch from its coordinates`);
    assert.equal(fresh[1].frequency.value, expected * 2.01, `${name}: with its shimmer above`);
  }
});

test('a chime is silent while the score is off', () => {
  const page = silentPage();
  page.api.Music.toggle();
  page.api.Music.toggle();
  const before = page.audio.started.length;
  page.api.Music.chime(page.api.findStar('VIMS'));
  assert.equal(page.audio.started.length, before);
});

test('Polaris answers with a four-note rose-coloured arpeggio', () => {
  const page = silentPage();
  page.api.Music.toggle();
  const before = page.audio.started.length;
  page.api.Music.swell();

  const fresh = page.audio.started.slice(before);
  assert.equal(fresh.length, 8, 'four bells, two oscillators each');
  const roots = fresh.filter((_, i) => i % 2 === 0).map(o => o.frequency.value);
  assert.deepEqual(roots, [523.25, 659.25, 783.99, 987.77]);
  const starts = fresh.filter((_, i) => i % 2 === 0).map(o => o.startedAt);
  starts.forEach((when, i) => {
    assert.ok(Math.abs(when - i * 0.22) < 1e-9, 'staggered by 220ms');
  });
});

test('the music button reports its state to the page and to screen readers', () => {
  const page = silentPage();
  const button = page.nodes['music-toggle'];
  const note = page.nodes['music-note'];

  button.dispatch('click');
  assert.ok(button.classList.contains('playing'));
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.equal(page.nodes.musicLabel.textContent, 'The sky is singing');
  assert.ok(note.classList.contains('show'), 'the note appears the first time');

  const hide = page.timers.timeouts.at(-1);
  assert.equal(hide.ms, 7000);
  hide.fn();
  assert.equal(note.classList.contains('show'), false);

  button.dispatch('click');
  assert.equal(button.classList.contains('playing'), false);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(page.nodes.musicLabel.textContent, 'Let the sky sing');

  button.dispatch('click');
  assert.equal(note.classList.contains('show'), false, 'the note is only shown once');
});

test('clicking a star while the score plays gives it its voice', () => {
  const page = silentPage();
  page.settleParallax();
  page.api.skyRot = 0;
  page.api.Music.toggle();

  const star = page.api.findStar('Little Cures');
  const [x, y] = page.api.project(star.x, star.y);
  const before = page.audio.started.length;
  page.dispatch('pointerdown', { target: page.document.body, clientX: x, clientY: y });

  const fresh = page.audio.started.slice(before);
  assert.ok(fresh.length >= 2, 'the star sounded');
  assert.equal(fresh[0].frequency.value, PENTA[Math.floor((star.x + star.y) % PENTA.length)]);
});
