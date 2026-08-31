/*
 * Minimal DOM / Canvas / WebAudio doubles.
 *
 * The site is a single hand-written page with no build step and no runtime
 * dependencies, so the tests keep that property: everything the page touches is
 * faked here with plain objects instead of pulling in jsdom.
 */

'use strict';

class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) {
    names.forEach(n => this.set.add(n));
  }
  remove(...names) {
    names.forEach(n => this.set.delete(n));
  }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : !!force;
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  contains(name) {
    return this.set.has(name);
  }
  get value() {
    return [...this.set].join(' ');
  }
}

class FakeNode {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.classList = new ClassList();
    this.style = {};
    this.attributes = { ...attrs };
    this.children = [];
    this.textContent = '';
    this.listeners = new Map();
  }

  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    return child;
  }

  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  dispatch(type, event = {}) {
    const list = [...(this.listeners.get(type) || [])];
    list.forEach(fn => fn({ type, target: this, preventDefault() {}, ...event }));
    return list.length;
  }

  contains(other) {
    if (other === this) return true;
    return this.children.some(c => c.contains && c.contains(other));
  }

  /* selectors are matched by exact registration, never parsed */
  querySelector(sel) {
    return (this.selectorMap && this.selectorMap[sel]) || null;
  }

  querySelectorAll(sel) {
    const hit = this.selectorMap && this.selectorMap[sel];
    if (!hit) return [];
    return Array.isArray(hit) ? hit : [hit];
  }

  register(sel, node) {
    if (!this.selectorMap) this.selectorMap = {};
    this.selectorMap[sel] = node;
    if (Array.isArray(node)) node.forEach(n => this.appendChild(n));
    else this.appendChild(node);
    return node;
  }
}

/* Canvas 2D context double: records nothing, accepts everything. */
function createContext2D(calls) {
  const gradient = () => ({ addColorStop() {} });
  const noop = name => (...args) => {
    calls.push({ name, args });
  };
  const ctx = {
    createLinearGradient: (...a) => {
      calls.push({ name: 'createLinearGradient', args: a });
      return gradient();
    },
    createRadialGradient: (...a) => {
      calls.push({ name: 'createRadialGradient', args: a });
      return gradient();
    },
    measureText: text => ({ width: text.length * 6 })
  };
  const methods = [
    'setTransform', 'clearRect', 'fillRect', 'beginPath', 'closePath', 'moveTo',
    'lineTo', 'arc', 'fill', 'stroke', 'save', 'restore', 'translate', 'rotate',
    'scale', 'fillText', 'strokeText', 'ellipse', 'quadraticCurveTo', 'bezierCurveTo',
    'setLineDash', 'clip', 'drawImage'
  ];
  methods.forEach(m => { ctx[m] = noop(m); });
  return ctx;
}

function createCanvas(calls) {
  const canvas = new FakeNode('canvas');
  canvas.width = 0;
  canvas.height = 0;
  const context = createContext2D(calls);
  canvas.getContext = () => context;
  canvas.context = context;
  return canvas;
}

/* ---------- WebAudio doubles ---------- */

function createParam(name, log) {
  return {
    name,
    value: 0,
    setValueAtTime(v, t) { log.push({ node: name, op: 'setValueAtTime', value: v, when: t }); return this; },
    linearRampToValueAtTime(v, t) { log.push({ node: name, op: 'linearRamp', value: v, when: t }); return this; },
    exponentialRampToValueAtTime(v, t) { log.push({ node: name, op: 'expRamp', value: v, when: t }); return this; },
    cancelScheduledValues(t) { log.push({ node: name, op: 'cancel', when: t }); return this; }
  };
}

function createAudioContextClass(audio) {
  return class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.destination = { kind: 'destination', connect() {} };
      audio.contexts.push(this);
    }
    resume() {
      this.state = 'running';
      audio.resumes++;
      return Promise.resolve();
    }
    createGain() {
      const node = { kind: 'gain', gain: createParam('gain', audio.params), connect() {} };
      audio.nodes.push(node);
      return node;
    }
    createDynamicsCompressor() {
      const node = {
        kind: 'compressor',
        threshold: createParam('threshold', audio.params),
        ratio: createParam('ratio', audio.params),
        connect() {}
      };
      audio.nodes.push(node);
      return node;
    }
    createDelay(max) {
      const node = { kind: 'delay', maxDelay: max, delayTime: createParam('delayTime', audio.params), connect() {} };
      audio.nodes.push(node);
      return node;
    }
    createBiquadFilter() {
      const node = { kind: 'filter', type: '', frequency: createParam('frequency', audio.params), connect() {} };
      audio.nodes.push(node);
      return node;
    }
    createOscillator() {
      const node = {
        kind: 'osc',
        type: '',
        frequency: createParam('frequency', audio.params),
        detune: createParam('detune', audio.params),
        connect() {},
        start(when) { node.startedAt = when; audio.started.push(node); },
        stop(when) { node.stoppedAt = when; }
      };
      audio.nodes.push(node);
      return node;
    }
  };
}

module.exports = { ClassList, FakeNode, createCanvas, createContext2D, createAudioContextClass };
