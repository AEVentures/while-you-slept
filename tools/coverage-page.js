#!/usr/bin/env node
/*
 * Coverage for the page's inline script.
 *
 * `node --test --experimental-test-coverage` can only see files on disk, and
 * the site's whole program lives inside index.html. This runs the same test
 * files in-process under V8 precise coverage and reports how much of that
 * inline script they reach, in index.html line numbers.
 *
 *   node tools/coverage-page.js [--verbose]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const inspector = require('node:inspector');
const Module = require('node:module');

const { readInlineScript, instrument, INDEX_HTML, HOOK } = require('../tests/harness/env.js');

const TESTS_DIR = path.join(__dirname, '..', 'tests');
const verbose = process.argv.includes('--verbose');

/* ---------- run the suites in this process, with a stand-in for node:test ---------- */

function runSuites() {
  const results = { pass: 0, fail: 0, failures: [] };
  const stub = (name, fn) => {
    try {
      fn({ name });
      results.pass++;
    } catch (err) {
      results.fail++;
      results.failures.push(`${name}: ${err.message.split('\n')[0]}`);
    }
  };
  stub.test = stub;

  const realRequire = Module.prototype.require;
  Module.prototype.require = function (id) {
    if (id === 'node:test' || id === 'test') return stub;
    return realRequire.apply(this, arguments);
  };

  try {
    fs.readdirSync(TESTS_DIR)
      .filter(f => f.endsWith('.test.js'))
      .sort()
      .forEach(f => realRequire.call(module, path.join(TESTS_DIR, f)));
  } finally {
    Module.prototype.require = realRequire;
  }
  return results;
}

/* ---------- V8 coverage, folded down to bytes and lines ---------- */

function withCoverage(run) {
  const session = new inspector.Session();
  session.connect();
  const post = (method, params) =>
    new Promise((resolve, reject) =>
      session.post(method, params, (err, res) => (err ? reject(err) : resolve(res)))
    );

  return (async () => {
    await post('Profiler.enable');
    await post('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    const result = run();
    const { result: scripts } = await post('Profiler.takePreciseCoverage');
    await post('Profiler.stopPreciseCoverage');
    session.disconnect();
    return { result, scripts };
  })();
}

/** Marks each byte of the script covered or not, honouring nested ranges. */
function byteCoverage(functions, length) {
  const covered = new Uint8Array(length);
  const ranges = functions
    .flatMap(fn => fn.ranges)
    .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  for (const r of ranges) {
    const value = r.count > 0 ? 1 : 0;
    for (let i = r.startOffset; i < Math.min(r.endOffset, length); i++) covered[i] = value;
  }
  return covered;
}

function lineReport(source, covered, skip) {
  const lines = [];
  let line = { covered: 0, total: 0 };
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') {
      lines.push(line);
      line = { covered: 0, total: 0 };
      continue;
    }
    if (skip(i)) continue;
    if (/\s/.test(source[i])) continue;
    line.total++;
    if (covered[i]) line.covered++;
  }
  lines.push(line);
  return lines;
}

/** Collapses [3,4,5,9] into "3-5 9". */
function ranges(numbers) {
  const out = [];
  let start = null, prev = null;
  for (const n of numbers) {
    if (start === null) { start = prev = n; continue; }
    if (n === prev + 1) { prev = n; continue; }
    out.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = n;
  }
  if (start !== null) out.push(start === prev ? `${start}` : `${start}-${prev}`);
  return out.join(' ');
}

async function main() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const inline = readInlineScript(html);
  const source = instrument(inline);
  const hookStart = source.indexOf(HOOK);
  const hookEnd = hookStart + HOOK.length;
  const skip = offset => offset >= hookStart && offset < hookEnd;

  /* index.html line number of the first line of the inline script */
  const scriptLine = html.slice(0, html.indexOf(inline)).split('\n').length;

  const { result, scripts } = await withCoverage(runSuites);

  const entry = scripts.find(s => s.url.includes('index.html'));
  if (!entry) {
    console.error('the inline script was never evaluated — no coverage to report');
    process.exit(1);
  }

  const covered = byteCoverage(entry.functions, source.length);
  let bytes = 0, coveredBytes = 0;
  for (let i = 0; i < source.length; i++) {
    if (skip(i) || /\s/.test(source[i])) continue;
    bytes++;
    if (covered[i]) coveredBytes++;
  }

  const namedFunctions = entry.functions.filter(
    fn => fn.functionName && !skip(fn.ranges[0].startOffset)
  );
  const calledFunctions = namedFunctions.filter(fn => fn.ranges[0].count > 0);

  const lines = lineReport(source, covered, skip);
  const executable = lines.filter(l => l.total > 0);
  const fullyCovered = executable.filter(l => l.covered === l.total);
  const uncovered = lines
    .map((l, i) => ({ line: i + scriptLine, ...l }))
    .filter(l => l.total > 0 && l.covered === 0)
    .map(l => l.line);

  const pct = (a, b) => (b === 0 ? 100 : (a / b) * 100).toFixed(2);

  console.log('');
  console.log('index.html — inline script coverage');
  console.log('-'.repeat(52));
  console.log(`lines      ${pct(fullyCovered.length, executable.length).padStart(6)} %   (${fullyCovered.length}/${executable.length})`);
  console.log(`bytes      ${pct(coveredBytes, bytes).padStart(6)} %   (${coveredBytes}/${bytes})`);
  console.log(`functions  ${pct(calledFunctions.length, namedFunctions.length).padStart(6)} %   (${calledFunctions.length}/${namedFunctions.length})`);
  console.log('-'.repeat(52));
  console.log(`tests      ${result.pass} passed, ${result.fail} failed`);
  if (uncovered.length) console.log(`uncovered  ${ranges(uncovered)}`);
  if (verbose) {
    const cold = namedFunctions
      .filter(fn => fn.ranges[0].count === 0)
      .map(fn => fn.functionName);
    console.log(`never run  ${cold.length ? cold.join(', ') : 'none'}`);
  }
  console.log('');

  result.failures.forEach(f => console.error(`FAIL ${f}`));
  process.exit(result.fail === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
