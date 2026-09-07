/* The page itself: one file, no dependencies, and the pieces it promises. */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { readInlineScript, INDEX_HTML } = require('./harness/env.js');

const html = fs.readFileSync(INDEX_HTML, 'utf8');
const root = path.dirname(INDEX_HTML);

test('the site stays a single self-contained page', () => {
  assert.equal(readInlineScript(html).length > 1000, true, 'the script lives inline');
  assert.equal(/<script[^>]*\bsrc=/.test(html), false, 'no external scripts');
  assert.equal(/<link[^>]+rel="stylesheet"[^>]+href="http/.test(html), false, 'no remote stylesheets');
});

test('the page declares its language, viewport and title', () => {
  assert.match(html, /<html[^>]+lang="en"/);
  assert.match(html, /<meta[^>]+name="viewport"/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta[^>]+name="description"[^>]+content="[^"]{40,}"/);
});

test('the social card points at an asset that is committed', () => {
  const og = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/);
  const twitter = html.match(/<meta[^>]+name="twitter:image"[^>]+content="([^"]+)"/);
  assert.ok(og, 'og:image is declared');
  assert.ok(twitter, 'twitter:image is declared');
  assert.equal(og[1], twitter[1], 'both cards use the same image');

  /* the published url ends in the path the repo actually serves */
  const relative = new URL(og[1]).pathname.split('/').slice(2).join('/');
  assert.ok(fs.existsSync(path.join(root, relative)), `${relative} exists on disk`);
});

test('the canvas the sky is drawn on is in the markup', () => {
  assert.match(html, /<canvas[^>]+id="sky"/);
});

test('the interactive furniture the script reaches for is present', () => {
  for (const id of ['sky', 'star-card', 'music-toggle', 'music-note', 'secret', 'secret-close']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} exists in the page`);
  }
  for (const cls of ['sc-name', 'sc-year', 'sc-line', 'sc-link', 'mt-label']) {
    assert.match(html, new RegExp(`class="[^"]*${cls}`), `.${cls} exists in the page`);
  }
});

test('the music button is announced as a toggle', () => {
  const button = html.match(/<button[^>]+id="music-toggle"[^>]*>/);
  assert.ok(button, 'the button exists');
  assert.match(button[0], /aria-pressed="false"/, 'it starts unpressed');
});

test('every chapter carries a focus and reduced motion is respected', () => {
  assert.ok([...html.matchAll(/data-focus="/g)].length >= 8, 'the chapters are marked up');
  assert.match(html, /prefers-reduced-motion/, 'the page honours reduced motion');
});
