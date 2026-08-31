/* Touching the sky: hit testing, the star card, the hidden door, gold tags. */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { loadPage } = require('./harness/env.js');
const { FakeNode } = require('./harness/dom.js');

/** A page with a still sky, so screen positions are predictable. */
function fixture(opts = {}) {
  const page = loadPage(opts);
  page.settleParallax();
  page.api.skyRot = 0;
  return page;
}

const emptySky = () => new FakeNode('div');

/** Where a named star currently sits on screen. */
function screenPos(page, name) {
  const star = page.api.findStar(name);
  assert.ok(star, `no such star: ${name}`);
  const [x, y] = page.api.project(star.x, star.y);
  return { star, x, y };
}

test('findStar walks every constellation and gives up honestly', () => {
  const page = fixture();
  assert.equal(page.api.findStar('Engajer').year, 'Founded 2010');
  assert.equal(page.api.findStar('God').divine, true);
  assert.equal(page.api.findStar('Friends & Family').kinstar, true);
  assert.equal(page.api.findStar('Betelgeuse'), null);
  assert.equal(page.api.findStar(''), null);
});

test('hitTest finds the star under the pointer', () => {
  const page = fixture();
  const { star, x, y } = screenPos(page, 'Engajer');
  const hit = page.api.hitTest(x, y);
  assert.ok(hit);
  assert.equal(hit.star.name, star.name);
  assert.ok(Math.abs(hit.x - x) < 1e-9 && Math.abs(hit.y - y) < 1e-9);
});

test('hitTest has a 28px reach and nothing beyond it', () => {
  const page = fixture();
  const { x, y } = screenPos(page, 'Reflux Healed');
  assert.ok(page.api.hitTest(x + 27, y), 'inside the reach');
  assert.equal(page.api.hitTest(x + 29, y), null, 'outside the reach');
  assert.equal(page.api.hitTest(-500, -500), null, 'off screen');
});

test('hitTest prefers the nearer of two stars', () => {
  const page = fixture();
  const a = screenPos(page, 'Tristan');
  const b = screenPos(page, 'God');
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const towardA = page.api.hitTest(mid.x + (a.x - mid.x) * 0.8, mid.y + (a.y - mid.y) * 0.8);
  const towardB = page.api.hitTest(mid.x + (b.x - mid.x) * 0.8, mid.y + (b.y - mid.y) * 0.8);
  assert.equal(towardA.star.name, 'Tristan');
  assert.equal(towardB.star.name, 'God');
});

test('the card shows a star, its year, its line and its link', () => {
  const page = fixture();
  const star = page.api.findStar('Arqon');
  page.api.showCard({ star, x: 400, y: 300 });

  const { nodes } = page;
  assert.equal(nodes.scName.textContent, 'Arqon');
  assert.equal(nodes.scYear.textContent, star.year);
  assert.equal(nodes.scLine.textContent, star.line);
  assert.equal(nodes.scLink.style.display, 'inline-block');
  assert.equal(nodes.scLink.href, star.url);
  assert.ok(nodes['star-card'].classList.contains('show'));
});

test('a star with no link hides the link instead of pointing nowhere', () => {
  const page = fixture();
  page.api.showCard({ star: page.api.findStar('The Castellanos'), x: 400, y: 300 });
  assert.equal(page.nodes.scLink.style.display, 'none');
});

test('the card stays on screen at every edge', () => {
  const page = fixture({ width: 1000, height: 700 });
  const star = page.api.findStar('Engajer');
  const card = page.nodes['star-card'];

  page.api.showCard({ star, x: 200, y: 300 });
  assert.equal(card.style.left, '222px', 'normally sits to the right of the star');
  assert.equal(card.style.top, '280px');

  page.api.showCard({ star, x: 900, y: 300 });
  assert.equal(card.style.left, '558px', 'flips to the left near the right edge');

  page.api.showCard({ star, x: 40, y: 10 });
  assert.equal(card.style.left, '62px');
  assert.equal(card.style.top, '16px', 'clamped to the top padding');

  page.api.showCard({ star, x: 200, y: 690 });
  assert.equal(card.style.top, '480px', 'clamped so the card body fits');
});

test('the card fades itself out after a while', () => {
  const page = fixture();
  const card = page.nodes['star-card'];
  page.api.showCard({ star: page.api.findStar('VIMS'), x: 300, y: 300 });
  const timer = page.timers.timeouts.at(-1);
  assert.equal(timer.ms, 6000);
  timer.fn();
  assert.equal(card.classList.contains('show'), false);
});

test('clicking a star opens its card; clicking empty sky closes it', () => {
  const page = fixture();
  const card = page.nodes['star-card'];
  const { x, y } = screenPos(page, 'UCE Charter');

  page.dispatch('pointerdown', { target: emptySky(), clientX: x, clientY: y });
  assert.ok(card.classList.contains('show'));
  assert.equal(page.nodes.scName.textContent, 'UCE Charter');

  page.dispatch('pointerdown', { target: emptySky(), clientX: 5, clientY: 5 });
  assert.equal(card.classList.contains('show'), false);
});

test('clicks inside the card, or on the music button, are left alone', () => {
  const page = fixture();
  const card = page.nodes['star-card'];
  const { x, y } = screenPos(page, 'UCE Charter');

  page.dispatch('pointerdown', { target: page.nodes.scLink, clientX: 5, clientY: 5 });
  assert.equal(card.classList.contains('show'), false, 'no card was opened');

  page.dispatch('pointerdown', { target: page.nodes['music-toggle'], clientX: x, clientY: y });
  assert.equal(card.classList.contains('show'), false, 'the star underneath was not hit');
});

test('the unnamed star opens the hidden room and locks the scroll', () => {
  const page = fixture();
  const secret = page.nodes.secret;
  const { x, y } = screenPos(page, 'The Unnamed Star');

  page.dispatch('pointerdown', { target: emptySky(), clientX: x, clientY: y });
  assert.ok(secret.classList.contains('open'));
  assert.equal(page.document.body.style.overflow, 'hidden');
  assert.equal(page.nodes['star-card'].classList.contains('show'), false, 'no card for the secret');

  /* while the room is open, the sky ignores the pointer */
  page.dispatch('pointerdown', { target: emptySky(), clientX: screenPos(page, 'God').x, clientY: screenPos(page, 'God').y });
  assert.equal(page.nodes.scName.textContent, '');

  page.nodes['secret-close'].dispatch('click');
  assert.equal(secret.classList.contains('open'), false);
  assert.equal(page.document.body.style.overflow, '');
});

test('escape closes the hidden room too', () => {
  const page = fixture();
  const secret = page.nodes.secret;
  secret.classList.add('open');
  page.document.body.style.overflow = 'hidden';

  page.dispatch('keydown', { key: 'a' });
  assert.ok(secret.classList.contains('open'), 'other keys do nothing');

  page.dispatch('keydown', { key: 'Escape' });
  assert.equal(secret.classList.contains('open'), false);
  assert.equal(page.document.body.style.overflow, '');
});

test('touching the North Star reveals every constellation', () => {
  const page = fixture();
  assert.equal(page.api.allRevealed, false);
  const { x, y } = screenPos(page, 'God');
  page.dispatch('pointerdown', { target: emptySky(), clientX: x, clientY: y });
  assert.equal(page.api.allRevealed, true);
  assert.equal(page.nodes.scName.textContent, 'God');
});

test('the nearest light to the pole answers with a meteor shower', () => {
  const page = fixture();
  assert.equal(page.api.meteors.length, 0);
  const { x, y } = screenPos(page, 'Samantha Christie Castellano');
  page.dispatch('pointerdown', { target: emptySky(), clientX: x, clientY: y });
  assert.equal(page.api.meteors.length, 9);
  assert.ok(page.api.meteors.every(m => m.rose), 'the shower is rose-coloured');
});

test('the gold tags are a second road to their star', () => {
  const page = fixture();
  const tag = page.starTags.find(t => t.getAttribute('data-star') === 'Engajer');
  tag.dispatch('click', { clientX: 120, clientY: 240 });
  assert.equal(page.nodes.scName.textContent, 'Engajer');
  assert.ok(page.nodes['star-card'].classList.contains('show'));

  const unknown = page.starTags[0];
  unknown.attributes['data-star'] = 'Nowhere';
  page.nodes.scName.textContent = '';
  unknown.dispatch('click', { clientX: 10, clientY: 10 });
  assert.equal(page.nodes.scName.textContent, '', 'an unknown tag does nothing');
});

test('the cursor becomes a pointer only over a star', () => {
  const page = fixture();
  const { x, y } = screenPos(page, 'GOPcast');
  page.dispatch('pointermove', { clientX: x, clientY: y });
  assert.equal(page.document.body.style.cursor, 'pointer');
  page.dispatch('pointermove', { clientX: 2, clientY: 2 });
  assert.equal(page.document.body.style.cursor, '');
});
