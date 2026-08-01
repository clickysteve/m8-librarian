// M8 Librarian — generator port test suite
//
// Zero-dependency: loads the Gen module from ./generators.js the same way
// tests/parser.test.mjs extracts M8 from index.html (the file holds a plain
// `const Gen = (() => { ... })();` IIFE, so evaluate it and return Gen).
//
// Run with:  node port/generators.test.mjs
//      (or:  node --test port/generators.test.mjs  for TAP summary output)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ── Load the Gen module from generators.js ─────────────────
const __html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const __s = __html.indexOf('const Gen = (() => {');
const __e = __html.indexOf('\n})();', __s);
const src = __html.slice(__s, __e + 6);
assert.ok(src.includes('const Gen = (() => {'), 'Gen module not found in generators.js');
const Gen = new Function(`${src}; return Gen;`)();

const EMPTY = 0xFF;

// A phrase with some notes to work on.
function fixtureSteps() {
  const steps = Array.from({ length: 16 }, Gen.emptyStep);
  const put = (i, note, instr = 2, vol = 0x50) => {
    steps[i].note = note; steps[i].instr = instr; steps[i].vol = vol;
    steps[i].fx[0] = { cmd: 0x03, val: 0x01 };     // GRV 01 — must survive untouched
  };
  put(0, 36); put(4, 39); put(8, 43); put(12, 48);
  return steps;
}

const deepCopy = steps => steps.map(s => ({
  note: s.note, vol: s.vol, instr: s.instr,
  fx: s.fx.map(f => ({ cmd: f.cmd, val: f.val })),
}));

// ── Determinism ────────────────────────────────────────────
test('same seed gives identical output; different seed differs', () => {
  const steps = fixtureSteps();
  for (const run of [
    () => Gen.arp({ steps, root: 48, chord: 'min7', pattern: 'random', octaves: 2, seed: 7 }),
    () => Gen.vary(steps, { similarity: 30, seed: 7 }),
    () => Gen.humanise(steps, { base: 0x60, spread: 0x20, seed: 7 }),
  ]) {
    assert.deepEqual(run(), run(), 'two runs with the same seed must match');
  }
  const a = Gen.vary(steps, { similarity: 10, seed: 1 });
  const b = Gen.vary(steps, { similarity: 10, seed: 2 });
  assert.notDeepEqual(a, b, 'different seeds should diverge at low similarity');
});

test('inputs are never mutated', () => {
  const steps = fixtureSteps();
  const before = deepCopy(steps);
  Gen.euclid({ steps, hits: 5 });
  Gen.arp({ steps, root: 40, pattern: 'random', seed: 3 });
  Gen.vary(steps, { similarity: 0, seed: 3 });
  Gen.humanise(steps, { seed: 3 });
  Gen.conform(steps, Gen.scaleMask('C', 'Major'));
  assert.deepEqual(steps, before);
});

// ── Euclid pulse counts ────────────────────────────────────
test('euclidPattern places exactly `hits` pulses, downbeat first', () => {
  for (const [hits, steps] of [[0, 16], [1, 16], [3, 8], [5, 8], [7, 16], [16, 16], [4, 12]]) {
    const pat = Gen.euclidPattern(hits, steps);
    assert.equal(pat.length, steps);
    assert.equal(pat.filter(Boolean).length, hits, `E(${hits},${steps}) pulse count`);
    if (hits > 0) assert.equal(pat[0], true, 'rotation 0 puts a hit on the downbeat');
  }
  // the tresillo, exactly
  assert.deepEqual(Gen.euclidPattern(3, 8).map(v => v ? 1 : 0), [1, 0, 0, 1, 0, 0, 1, 0]);
  // rotation preserves the pulse count and slides the figure
  const rot = Gen.euclidPattern(3, 8, 1);
  assert.equal(rot.filter(Boolean).length, 3);
  assert.deepEqual(rot.map(v => v ? 1 : 0), [0, 1, 0, 0, 1, 0, 0, 1]);
});

test('euclid writes notes on hits and clears non-hits', () => {
  const out = Gen.euclid({ hits: 4, note: 36, instr: 1, vol: 0x40 });
  const hits = out.filter(s => s.note !== EMPTY);
  assert.equal(hits.length, 4);
  for (const h of hits) {
    assert.equal(h.note, 36);
    assert.equal(h.instr, 1);
    assert.equal(h.vol, 0x40);
  }
  // clear=false leaves existing content on non-hit steps
  const src = fixtureSteps();
  const keep = Gen.euclid({ steps: src, hits: 2, note: 60, clear: false });
  assert.equal(keep[4].note === EMPTY ? EMPTY : keep[4].note, keep[4].note); // untouched or hit
  const cleared = Gen.euclid({ steps: src, hits: 2, note: 60, clear: true });
  assert.equal(cleared.filter(s => s.note !== EMPTY).length, 2);
});

// ── Arp chord tones ────────────────────────────────────────
test('arp emits only chord tones (pitch classes of root + intervals)', () => {
  for (const chord of Gen.CHORDS) {
    const root = 48;
    const allowed = new Set(chord.iv.map(iv => (root + iv) % 12));
    for (const pattern of ['up', 'down', 'updown', 'downup', 'random']) {
      const out = Gen.arp({ root, chord: chord.n, pattern, octaves: 2, seed: 5 });
      const notes = out.filter(s => s.note !== EMPTY).map(s => s.note);
      assert.ok(notes.length > 0, `${chord.n}/${pattern} produced notes`);
      for (const n of notes)
        assert.ok(allowed.has(n % 12), `${chord.n}/${pattern}: note ${n} is a chord tone`);
    }
  }
});

test('arp chord tones stay inside a matching scale', () => {
  // C min7 (C Eb G Bb) is a subset of C Nat. Minor — with root 48 (C)
  const mask = Gen.scaleMask('C', 'Nat. Minor');
  const out = Gen.arp({ root: 48, chord: 'min7', pattern: 'updown', octaves: 2, seed: 9 });
  for (const s of out)
    if (s.note !== EMPTY)
      assert.ok(Gen.inScale(s.note, mask), `note ${s.note} in C Nat. Minor`);
});

test('arp `every` spacing and up pattern order', () => {
  const out = Gen.arp({ root: 60, chord: 'maj', pattern: 'up', every: 2, seed: 1 });
  for (let i = 0; i < out.length; i++) {
    if (i % 2 === 0) assert.notEqual(out[i].note, EMPTY);
    else assert.equal(out[i].note, EMPTY, 'gap steps are cleared');
  }
  assert.deepEqual(out.filter(s => s.note !== EMPTY).map(s => s.note).slice(0, 4),
    [60, 64, 67, 60]);
});

// ── Vary ───────────────────────────────────────────────────
test('vary at similarity 100 is the identity', () => {
  const steps = fixtureSteps();
  assert.deepEqual(Gen.vary(steps, { similarity: 100, seed: 42 }), deepCopy(steps));
});

test('vary only ever touches the note field', () => {
  const steps = fixtureSteps();
  const out = Gen.vary(steps, { similarity: 0, seed: 11 });
  out.forEach((s, i) => {
    assert.equal(s.vol, steps[i].vol);
    assert.equal(s.instr, steps[i].instr);
    assert.deepEqual(s.fx, steps[i].fx);
  });
});

test('vary with a mask keeps moved notes in key', () => {
  const mask = Gen.scaleMask('C', 'Major');
  const steps = fixtureSteps();          // 36/39/43/48 — 39 (Eb) is out of key but only MOVED notes must land in key
  const out = Gen.vary(steps, { similarity: 0, seed: 4, mask });
  out.forEach((s, i) => {
    if (s.note !== EMPTY && s.note !== steps[i].note)
      assert.ok(Gen.inScale(s.note, mask), `changed note ${s.note} is in C Major`);
  });
});

// ── Humanise ───────────────────────────────────────────────
test('humanise only touches vol, and only on steps with a note', () => {
  const steps = fixtureSteps();
  const out = Gen.humanise(steps, { base: 0x60, spread: 0x20, accent: 0x20, accentEvery: 4, seed: 3 });
  out.forEach((s, i) => {
    assert.equal(s.note, steps[i].note, 'note untouched');
    assert.equal(s.instr, steps[i].instr, 'instr untouched');
    assert.deepEqual(s.fx, steps[i].fx, 'fx untouched');
    if (steps[i].note === EMPTY)
      assert.equal(s.vol, steps[i].vol, 'no-note steps keep their vol');
    else {
      assert.notEqual(s.vol, EMPTY, 'note steps get an explicit vol');
      assert.ok(s.vol >= 0 && s.vol <= 0xFE, 'vol below the 0xFF default sentinel');
    }
  });
});

test('humanise accents the beat with spread 0', () => {
  const steps = fixtureSteps();          // notes at 0, 4, 8, 12 — all on the accent grid
  const out = Gen.humanise(steps, { base: 0x40, spread: 0, accent: 0x20, accentEvery: 4, seed: 1 });
  for (const i of [0, 4, 8, 12]) assert.equal(out[i].vol, 0x60);
  const off = Gen.humanise(steps, { base: 0x40, spread: 0, accent: 0x20, accentEvery: 5, seed: 1 });
  assert.equal(off[0].vol, 0x60);        // step 0 always accented
  assert.equal(off[4].vol, 0x40);        // step 4 no longer on the accent grid
});

// ── Scale helpers ──────────────────────────────────────────
test('scaleMask, inScale, snapToScale, transposeInScale, conform', () => {
  const mask = Gen.scaleMask('C', 'Major');
  assert.ok(mask[0] && mask[2] && mask[4] && !mask[1] && !mask[3]);
  assert.equal(Gen.scaleMask('C', 'None (Chromatic)'), null);
  assert.equal(Gen.scaleMask('C', null), null);
  assert.ok(Gen.inScale(EMPTY, mask), 'empty note is never out of key');
  assert.ok(Gen.inScale(60, mask) && !Gen.inScale(61, mask));
  assert.ok(Gen.outOfKey(61, mask) && !Gen.outOfKey(62, mask));
  assert.equal(Gen.snapToScale(61, mask), 60, 'tie prefers the lower note');
  assert.equal(Gen.snapToScale(61, mask, 1), 62, 'dir +1 searches up only');
  assert.equal(Gen.transposeInScale(64, mask, 1), 65, 'E +1 degree = F in C Major');
  assert.equal(Gen.transposeInScale(64, mask, -1), 62, 'E -1 degree = D');
  const steps = fixtureSteps();          // 39 (Eb) and 43 (G): Eb is out of C Major
  const { steps: fixed, moved } = Gen.conform(steps, mask);
  assert.equal(moved, 1);
  assert.ok(Gen.inScale(fixed[4].note, mask));
  assert.equal(fixed[8].note, 43, 'in-key notes untouched');
});
