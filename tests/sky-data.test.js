/* The chart itself: constellations, stars, edges, chapter foci, gold tags. */

'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const { loadPage, INDEX_HTML } = require('./harness/env.js');

const page = loadPage();
const { CONSTELLATIONS, FOCI, SKY_W, SKY_H, POLE } = page.api;
const keys = Object.keys(CONSTELLATIONS);
const html = fs.readFileSync(INDEX_HTML, 'utf8');

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: '\u00a0',
  rsquo: '\u2019', lsquo: '\u2018', mdash: '\u2014', ndash: '\u2013', middot: '\u00b7'
};

/* attribute values as the browser would hand them to getAttribute() */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m);
}

test('every constellation is well formed', () => {
  assert.ok(keys.length > 0);
  for (const key of keys) {
    const c = CONSTELLATIONS[key];
    assert.equal(typeof c.label, 'string', `${key}: label`);
    assert.ok(c.cx > 0 && c.cx < SKY_W, `${key}: cx in sky`);
    assert.ok(c.cy > 0 && c.cy < SKY_H, `${key}: cy in sky`);
    assert.ok(Array.isArray(c.stars) && c.stars.length > 0, `${key}: has stars`);
    assert.ok(Array.isArray(c.edges), `${key}: has edges`);
  }
});

test('every star carries a name, a place in the sky and a radius', () => {
  for (const key of keys) {
    for (const s of CONSTELLATIONS[key].stars) {
      const at = `${key}/${s.name}`;
      assert.equal(typeof s.name, 'string', `${at}: name is a string`);
      assert.ok(s.name.length > 0, `${at}: name is not empty`);
      assert.ok(s.x > 0 && s.x < SKY_W, `${at}: x in sky`);
      assert.ok(s.y > 0 && s.y < SKY_H, `${at}: y in sky`);
      assert.ok(s.r > 0 && s.r < 10, `${at}: plausible radius`);
      assert.equal(typeof s.year, 'string', `${at}: year is a string`);
      assert.equal(typeof s.line, 'string', `${at}: line is a string`);
      assert.ok('url' in s, `${at}: url is declared`);
    }
  }
});

test('named stars say something; only the unnamed star stays silent', () => {
  for (const key of keys) {
    for (const s of CONSTELLATIONS[key].stars) {
      if (s.secret) {
        assert.equal(s.line, '', 'the secret star has no card text');
        continue;
      }
      assert.ok(s.year.length > 0, `${key}/${s.name}: has a year`);
      assert.ok(s.line.length > 10, `${key}/${s.name}: has a line`);
    }
  }
});

test('star links are absolute https urls or explicitly null', () => {
  for (const key of keys) {
    for (const s of CONSTELLATIONS[key].stars) {
      if (s.url === null) continue;
      assert.equal(typeof s.url, 'string', `${key}/${s.name}: url type`);
      const url = new URL(s.url);
      assert.equal(url.protocol, 'https:', `${key}/${s.name}: https`);
      assert.ok(url.hostname.includes('.'), `${key}/${s.name}: real hostname`);
    }
  }
});

test('edges connect real stars, never a star to itself, never twice', () => {
  for (const key of keys) {
    const c = CONSTELLATIONS[key];
    const seen = new Set();
    for (const edge of c.edges) {
      assert.equal(edge.length, 2, `${key}: edge is a pair`);
      const [a, b] = edge;
      for (const i of edge) {
        assert.ok(Number.isInteger(i), `${key}: index ${i} is an integer`);
        assert.ok(i >= 0 && i < c.stars.length, `${key}: index ${i} refers to a star`);
      }
      assert.notEqual(a, b, `${key}: edge ${a}-${b} is not a self loop`);
      const id = [a, b].sort((x, y) => x - y).join('-');
      assert.ok(!seen.has(id), `${key}: edge ${id} appears once`);
      seen.add(id);
    }
  }
});

test('drawn constellations are connected graphs; only the loose rings have no edges', () => {
  for (const key of keys) {
    const c = CONSTELLATIONS[key];
    if (c.edges.length === 0) {
      assert.ok(c.kin || c.hidden, `${key}: only kin/hidden groups may be edgeless`);
      continue;
    }
    const linked = new Set(c.edges.flat());
    c.stars.forEach((s, i) => {
      assert.ok(linked.has(i), `${key}/${s.name}: is drawn into the figure`);
    });
  }
});

test('Polaris is the fixed star at the pole', () => {
  const polaris = CONSTELLATIONS.polaris;
  assert.equal(polaris.isPolaris, true);
  const north = polaris.stars[0];
  assert.equal(north.name, 'God');
  assert.equal(north.divine, true);
  assert.deepEqual({ x: north.x, y: north.y }, { x: POLE.x, y: POLE.y });
  assert.ok(
    polaris.stars.every(s => s === north || s.r < north.r),
    'the north star is the brightest of its constellation'
  );
});

test('the hidden door holds exactly one secret star', () => {
  const door = CONSTELLATIONS.door;
  assert.equal(door.hidden, true);
  assert.equal(door.label, '');
  assert.equal(door.stars.length, 1);
  assert.equal(door.stars[0].secret, true);
  const secrets = page.allStars().filter(s => s.secret);
  assert.equal(secrets.length, 1, 'there is only one way in');
});

test('the kin ring is anonymous and uniform', () => {
  const kin = CONSTELLATIONS.kin;
  assert.equal(kin.kin, true);
  assert.ok(kin.stars.length >= 8);
  const names = new Set(kin.stars.map(s => s.name));
  assert.deepEqual([...names], ['Friends & Family']);
  kin.stars.forEach(s => {
    assert.equal(s.kinstar, true);
    assert.ok(s.r < 2, 'kin stars are faint');
    assert.equal(s.url, null);
  });
});

test('named stars outside the kin ring are unique', () => {
  const counts = new Map();
  for (const key of keys) {
    if (CONSTELLATIONS[key].kin) continue;
    for (const s of CONSTELLATIONS[key].stars) {
      counts.set(s.name, (counts.get(s.name) || 0) + 1);
    }
  }
  const dupes = [...counts].filter(([, n]) => n > 1).map(([name]) => name);
  assert.deepEqual(dupes, []);
});

test('every chapter in the page has a focus, and every focus is reachable', () => {
  const inPage = [...html.matchAll(/data-focus="([^"]+)"/g)].map(m => m[1]);
  assert.ok(inPage.length > 0, 'the page declares chapters');
  for (const key of new Set(inPage)) {
    assert.ok(FOCI[key], `data-focus="${key}" has a focus target`);
  }
  for (const key of Object.keys(FOCI)) {
    assert.ok(inPage.includes(key), `FOCI["${key}"] is used by a chapter`);
  }
});

test('focus targets sit inside the sky at a sane zoom', () => {
  for (const [key, f] of Object.entries(FOCI)) {
    assert.ok(f.x > 0 && f.x < SKY_W, `${key}: x in sky`);
    assert.ok(f.y > 0 && f.y < SKY_H, `${key}: y in sky`);
    assert.ok(f.zoom >= 0.9 && f.zoom <= 2, `${key}: zoom ${f.zoom} is sane`);
  }
});

test('chapter foci point at the constellation they name', () => {
  for (const key of keys) {
    const f = FOCI[key];
    if (!f) continue;
    const c = CONSTELLATIONS[key];
    assert.ok(Math.hypot(f.x - c.cx, f.y - c.cy) < 40, `${key}: focus is on its constellation`);
  }
});

test('every gold tag in the page resolves to a star', () => {
  const tagged = [...html.matchAll(/data-star="([^"]+)"/g)].map(m => decodeEntities(m[1]));
  assert.ok(tagged.length > 0, 'the page has gold tags');
  for (const name of tagged) {
    assert.ok(page.api.findStar(name), `data-star="${name}" finds its star`);
  }
});
