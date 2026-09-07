/*
 * Loads the page's inline script into a sandbox and hands its internals back.
 *
 * index.html is deliberately left untouched: everything the site does lives in
 * one IIFE with no exports, so the harness appends a single line of accessor
 * code to the *string* it evaluates. Production bytes never change, and the
 * tests still get at CONSTELLATIONS, project(), hitTest(), the render loop and
 * the score.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { FakeNode, createCanvas, createAudioContextClass } = require('./dom.js');

const INDEX_HTML = path.join(__dirname, '..', '..', 'index.html');
const HOOK_GLOBAL = '__wysInternals';

/* The internals the page never exports, surfaced for assertions. */
const HOOK = `
;globalThis.${HOOK_GLOBAL} = {
  CONSTELLATIONS: CONSTELLATIONS,
  FOCI: FOCI,
  bgStars: bgStars,
  meteors: meteors,
  state: state,
  POLE: POLE,
  SKY_W: SKY_W,
  SKY_H: SKY_H,
  reduceMotion: reduceMotion,
  Music: Music,
  project: project,
  baseScale: baseScale,
  hitTest: hitTest,
  findStar: findStar,
  showCard: showCard,
  resize: resize,
  spawnMeteor: spawnMeteor,
  polarisShower: polarisShower,
  get cam() { return cam; },
  set cam(v) { cam = v; },
  get target() { return target; },
  get activeKey() { return activeKey; },
  get allRevealed() { return allRevealed; },
  get skyRot() { return skyRot; },
  set skyRot(v) { skyRot = v; },
  get par() { return par; },
  get viewport() { return { W: W, H: H, DPR: DPR }; }
};
`;

/** Pulls the single inline <script> body out of the page. */
function readInlineScript(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) {
    throw new Error(`expected exactly one inline <script>, found ${scripts.length}`);
  }
  return scripts[0][1];
}

/** Appends the accessor hook inside the IIFE, just before it closes. */
function instrument(source) {
  const close = source.lastIndexOf('})();');
  if (close < 0) throw new Error('could not find the closing of the page IIFE');
  return source.slice(0, close) + HOOK + source.slice(close);
}

function buildDocument(canvas) {
  const document = new FakeNode('#document');
  const body = new FakeNode('body');
  document.body = body;

  const starCard = new FakeNode('div', { id: 'star-card' });
  const scName = new FakeNode('div');
  const scYear = new FakeNode('div');
  const scLine = new FakeNode('div');
  const scLink = new FakeNode('a');
  starCard.register('.sc-name', scName);
  starCard.register('.sc-year', scYear);
  starCard.register('.sc-line', scLine);
  starCard.register('.sc-link', scLink);

  const musicToggle = new FakeNode('button', { id: 'music-toggle', 'aria-pressed': 'false' });
  const musicLabel = new FakeNode('span');
  musicToggle.register('.mt-label', musicLabel);

  const musicNote = new FakeNode('div', { id: 'music-note' });
  const secret = new FakeNode('div', { id: 'secret' });
  const secretClose = new FakeNode('button', { id: 'secret-close' });

  const byId = {
    sky: canvas,
    'star-card': starCard,
    'music-toggle': musicToggle,
    'music-note': musicNote,
    secret: secret,
    'secret-close': secretClose
  };

  /* chapter sections and their cards, as the page's observers expect them */
  const focusKeys = [
    'wide', 'machine', 'cure', 'hearth', 'runner',
    'charter', 'polaris', 'offrecord', 'world', 'wide-final'
  ];
  const sections = focusKeys.map(key => {
    const section = new FakeNode('section', { 'data-focus': key });
    const card = new FakeNode('div');
    card.classList.add('card');
    section.register('.card', card);
    return section;
  });

  const starTags = ['Engajer', 'God', 'Arqon'].map(
    name => new FakeNode('span', { 'data-star': name })
  );

  const selectorMap = {
    '[data-focus]': sections,
    '.card': sections.map(s => s.querySelector('.card')),
    '.starlist [data-star]': starTags
  };

  document.getElementById = id => byId[id] || null;
  document.querySelector = sel => {
    const hit = selectorMap[sel];
    return Array.isArray(hit) ? hit[0] || null : hit || null;
  };
  document.querySelectorAll = sel => {
    const hit = selectorMap[sel];
    if (!hit) return [];
    return Array.isArray(hit) ? hit : [hit];
  };

  return { document, nodes: { ...byId, scName, scYear, scLine, scLink, musicLabel }, sections, starTags };
}

/**
 * Creates a fresh page instance.
 *
 * @param {object} [opts]
 * @param {number} [opts.width=1200]
 * @param {number} [opts.height=800]
 * @param {number} [opts.dpr=1]
 * @param {boolean} [opts.reduceMotion=false]
 * @param {() => number} [opts.random] replaces Math.random inside the page
 */
function loadPage(opts = {}) {
  const width = opts.width ?? 1200;
  const height = opts.height ?? 800;
  const dpr = opts.dpr ?? 1;
  const reduceMotion = opts.reduceMotion ?? false;
  let randomFn = opts.random ?? Math.random;

  const drawCalls = [];
  const canvas = createCanvas(drawCalls);
  const { document, nodes, sections, starTags } = buildDocument(canvas);

  const audio = { contexts: [], nodes: [], started: [], params: [], resumes: 0 };
  const frames = [];
  const timers = { timeouts: [], intervals: [], cleared: [] };
  const observers = [];
  let now = 1000;

  const window = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: dpr,
    document,
    Node: FakeNode,
    matchMedia: query => ({ media: query, matches: /reduce/.test(query) && reduceMotion }),
    AudioContext: createAudioContextClass(audio),
    performance: { now: () => now },
    requestAnimationFrame: fn => {
      frames.push(fn);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
    IntersectionObserver: class {
      constructor(cb, options) {
        this.cb = cb;
        this.options = options;
        this.targets = [];
        observers.push(this);
      }
      observe(el) { this.targets.push(el); }
      unobserve(el) { this.targets = this.targets.filter(t => t !== el); }
      disconnect() { this.disconnected = true; }
    },
    setTimeout: (fn, ms) => {
      timers.timeouts.push({ fn, ms });
      return timers.timeouts.length;
    },
    clearTimeout: id => { timers.cleared.push(id); },
    setInterval: (fn, ms) => {
      timers.intervals.push({ fn, ms });
      return timers.intervals.length;
    },
    clearInterval: id => { timers.cleared.push(id); }
  };

  const windowListeners = new Map();
  window.addEventListener = (type, fn) => {
    if (!windowListeners.has(type)) windowListeners.set(type, []);
    windowListeners.get(type).push(fn);
  };
  window.removeEventListener = (type, fn) => {
    const list = windowListeners.get(type) || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  };

  const sandbox = window;
  sandbox.window = window;
  sandbox.globalThis = window;
  /* the page's own Math, so tests can pin Math.random without touching the host */
  const pageMath = Object.create(Math);
  pageMath.random = () => randomFn();
  sandbox.Math = pageMath;
  sandbox.console = console;

  const source = instrument(readInlineScript(fs.readFileSync(INDEX_HTML, 'utf8')));
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'index.html:inline' });

  const api = sandbox[HOOK_GLOBAL];
  if (!api) throw new Error('the page did not expose its internals');

  /** Fires a window-level event, as the browser would. */
  const dispatch = (type, event = {}) => {
    const list = [...(windowListeners.get(type) || [])];
    list.forEach(fn => fn({ type, preventDefault() {}, ...event }));
    return list.length;
  };

  /** Runs one animation frame at `t` ms and returns the draw calls it made. */
  const stepFrame = t => {
    const fn = frames.shift();
    if (!fn) throw new Error('no animation frame is pending');
    const before = drawCalls.length;
    now = t;
    fn(t);
    return drawCalls.slice(before);
  };

  /** Advances the frame loop by `count` frames, 1/60s apart. */
  const runFrames = (count, start = 1000, dt = 1000 / 60) => {
    for (let i = 0; i < count; i++) stepFrame(start + i * dt);
  };

  /** Tells every observer watching `node` whether it is on screen. */
  const intersect = (node, isIntersecting = true) => {
    const watching = observers.filter(o => o.targets.includes(node));
    if (watching.length === 0) throw new Error('nothing is observing that node');
    watching.forEach(o => o.cb([{ isIntersecting, target: node }], o));
    return watching;
  };

  /** Scrolls a chapter into view, the way the IntersectionObserver would. */
  const enterSection = focus => {
    const section = sections.find(s => s.getAttribute('data-focus') === focus);
    if (!section) throw new Error(`unknown chapter: ${focus}`);
    intersect(section, true);
    return section;
  };

  /** Resizes the viewport and lets the page react. */
  const resizeTo = (w, h, ratio) => {
    window.innerWidth = w;
    window.innerHeight = h;
    if (ratio !== undefined) window.devicePixelRatio = ratio;
    dispatch('resize');
  };

  /** Settles the pointer parallax so projection is deterministic. */
  const settleParallax = () => {
    const par = api.par;
    par.tx = 0; par.ty = 0; par.x = 0; par.y = 0;
  };

  return {
    api,
    window,
    document,
    nodes,
    sections,
    starTags,
    canvas,
    drawCalls,
    audio,
    timers,
    observers,
    frames,
    dispatch,
    intersect,
    stepFrame,
    runFrames,
    enterSection,
    resizeTo,
    settleParallax,
    /** Pins Math.random inside the page; pass a function or a value sequence. */
    setRandom: next => {
      randomFn = typeof next === 'function'
        ? next
        : (() => { let i = 0; return () => next[i++ % next.length]; })();
    },
    allStars: () => Object.keys(api.CONSTELLATIONS).flatMap(k => api.CONSTELLATIONS[k].stars)
  };
}

module.exports = { loadPage, readInlineScript, instrument, INDEX_HTML, HOOK_GLOBAL, HOOK };
