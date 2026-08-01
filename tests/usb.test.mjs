// M8 Librarian — USB remote-display client tests.
//
// Exercises the SLIP decoder and the draw-command dispatcher in d-usb.js
// against a stub canvas that records every draw call, using the same
// zero-dependency loader pattern as /tmp/m8/tests (evaluate the IIFE source,
// keep the returned module).
//
// Run with:  node port/d-tests.mjs
//      (or:  node --test port/d-tests.mjs)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
const __s = __html.indexOf('const USB = (() => {');
const __e = __html.indexOf('\n})();', __s);
const src = __html.slice(__s, __e + 6);
const USB = new Function(`${src}; return USB;`)();
const T = USB._test;

// ── Stub canvas: records draw ops ──────────────────────────
function stubCanvasFactory() {
  const ops = [];
  const factory = (w, h) => {
    const ctx = {
      fillStyle: '', font: '', textAlign: '', textBaseline: '',
      fillRect(x, y, w2, h2) { ops.push({ op: 'rect', x, y, w: w2, h: h2, style: ctx.fillStyle }); },
      fillText(text, x, y) { ops.push({ op: 'text', text, x, y, style: ctx.fillStyle }); },
    };
    return { width: w, height: h, getContext: () => ctx };
  };
  factory.ops = ops;
  return factory;
}

function makeCore() {
  const factory = stubCanvasFactory();
  const core = T.createCore({ createCanvas: factory });
  factory.ops.length = 0; // discard the initial full-canvas clear
  return { core, ops: factory.ops };
}

// ── SLIP frame builders ────────────────────────────────────
const u16 = v => [v & 0xFF, (v >> 8) & 0xFF];
function slip(payload) {
  const out = [];
  for (const b of payload) {
    if (b === 0xC0) out.push(0xDB, 0xDC);
    else if (b === 0xDB) out.push(0xDB, 0xDD);
    else out.push(b);
  }
  out.push(0xC0);
  return Uint8Array.from(out);
}
const rectCmd = (x, y, w, h, r, g, b) => [0xFE, ...u16(x), ...u16(y), ...u16(w), ...u16(h), r, g, b];
const charCmd = (c, x, y, fr, fg, fb, br, bg, bb) => [0xFD, c, ...u16(x), ...u16(y), fr, fg, fb, br, bg, bb];
const waveCmd = (r, g, b, data) => [0xFC, r, g, b, ...data];

// Geometry constants under test (320x240 device screen at 3x)
const S = 3;

// ── Tests ──────────────────────────────────────────────────

test('rect: full 12-byte command draws a scaled, coloured rectangle', () => {
  const { core, ops } = makeCore();
  assert.equal(core.feed(slip(rectCmd(10, 20, 5, 6, 255, 0, 128))), true);
  assert.deepEqual(ops, [{ op: 'rect', x: 10 * S, y: 20 * S, w: 5 * S, h: 6 * S, style: 'rgb(255,0,128)' }]);
  assert.equal(core.stats.rects, 1);
});

test('rect: short forms (9/8/5 bytes) reuse or set the colour', () => {
  const { core, ops } = makeCore();
  core.feed(slip(rectCmd(0, 0, 2, 2, 10, 20, 30)));          // 12B sets lastColor
  core.feed(slip([0xFE, ...u16(50), ...u16(60), ...u16(3), ...u16(4)]));   // 9B: last colour
  core.feed(slip([0xFE, ...u16(7), ...u16(8), 1, 2, 3]));                  // 8B: 1x1 new colour
  core.feed(slip([0xFE, ...u16(9), ...u16(11)]));                          // 5B: 1x1 last colour
  assert.deepEqual(ops.slice(1), [
    { op: 'rect', x: 50 * S, y: 60 * S, w: 3 * S, h: 4 * S, style: 'rgb(10,20,30)' },
    { op: 'rect', x: 7 * S,  y: 8 * S,  w: S,     h: S,     style: 'rgb(1,2,3)' },
    { op: 'rect', x: 9 * S,  y: 11 * S, w: S,     h: S,     style: 'rgb(1,2,3)' },
  ]);
  assert.equal(core.stats.rects, 4);
});

test('rect: unsupported length is counted and dropped, decoder keeps going', () => {
  const { core, ops } = makeCore();
  core.feed(slip([0xFE, 1, 2, 3, 4, 5, 6]));                 // 7 bytes: no such form
  core.feed(slip(rectCmd(1, 1, 1, 1, 9, 9, 9)));
  assert.equal(core.stats.badLength, 1);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].style, 'rgb(9,9,9)');
});

test('char: background cell + stand-in glyph with fg colour', () => {
  const { core, ops } = makeCore();
  core.feed(slip(charCmd(65 /* A */, 8, 16, 1, 2, 3, 4, 5, 6)));
  assert.deepEqual(ops, [
    { op: 'rect', x: 8 * S, y: 16 * S, w: T.FONT_W * S, h: T.FONT_H * S, style: 'rgb(4,5,6)' },
    { op: 'text', text: 'A', x: (8 + T.FONT_W / 2) * S, y: (16 + T.FONT_H / 2) * S, style: 'rgb(1,2,3)' },
  ]);
  assert.equal(core.stats.chars, 1);
});

test('char: fg === bg skips the background fill (m8c behaviour)', () => {
  const { core, ops } = makeCore();
  core.feed(slip(charCmd(66, 0, 0, 7, 7, 7, 7, 7, 7)));
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, 'text');
  assert.equal(ops[0].text, 'B');
});

test('char: non-printable codepoints render as a placeholder glyph', () => {
  const { core, ops } = makeCore();
  core.feed(slip(charCmd(200, 0, 0, 1, 1, 1, 0, 0, 0)));
  assert.equal(ops[1].text, '·');
});

test('waveform: clears the top-right strip then plots one point per column', () => {
  const { core, ops } = makeCore();
  core.feed(slip(waveCmd(0, 255, 0, [0, 5, 10, 255])));      // 255 clamps into strip
  const n = 4, x0 = T.DEV_W - n;
  assert.deepEqual(ops[0], { op: 'rect', x: x0 * S, y: 0, w: n * S, h: T.WAVE_MAX_H * S, style: 'rgb(0,0,0)' });
  assert.deepEqual(ops.slice(1), [
    { op: 'rect', x: (x0 + 0) * S, y: 0 * S,  w: S, h: S, style: 'rgb(0,255,0)' },
    { op: 'rect', x: (x0 + 1) * S, y: 5 * S,  w: S, h: S, style: 'rgb(0,255,0)' },
    { op: 'rect', x: (x0 + 2) * S, y: 10 * S, w: S, h: S, style: 'rgb(0,255,0)' },
    { op: 'rect', x: (x0 + 3) * S, y: (T.WAVE_MAX_H - 1) * S, w: S, h: S, style: 'rgb(0,255,0)' },
  ]);
  assert.equal(core.stats.waves, 1);
});

test('waveform: N = 0 clears the whole strip and draws nothing else', () => {
  const { core, ops } = makeCore();
  core.feed(slip(waveCmd(9, 9, 9, [])));
  assert.deepEqual(ops, [
    { op: 'rect', x: 0, y: 0, w: T.DEV_W * S, h: T.WAVE_MAX_H * S, style: 'rgb(0,0,0)' },
  ]);
});

test('waveform: strip is cleared with the last full-screen rect colour', () => {
  const { core, ops } = makeCore();
  core.feed(slip(rectCmd(0, 0, 320, 240, 30, 20, 10)));      // theme background clear
  core.feed(slip(waveCmd(1, 1, 1, [])));
  assert.equal(ops[1].style, 'rgb(30,20,10)');
});

test('SLIP: a frame split across arbitrary chunk boundaries still decodes', () => {
  const { core, ops } = makeCore();
  const frame = slip(rectCmd(300, 200, 2, 2, 1, 2, 3));
  assert.equal(core.feed(frame.subarray(0, 5)), false);      // nothing complete yet
  assert.equal(core.feed(frame.subarray(5)), true);
  assert.deepEqual(ops, [{ op: 'rect', x: 300 * S, y: 200 * S, w: 2 * S, h: 2 * S, style: 'rgb(1,2,3)' }]);
});

test('SLIP: escaped END (0xC0) and ESC (0xDB) bytes inside a payload', () => {
  const { core, ops } = makeCore();
  // x = 0xC0 = 192 → low byte C0 must arrive escaped; colour contains 0xDB
  const frame = slip(rectCmd(0xC0, 3, 1, 1, 0xDB, 0xC0, 5));
  assert.ok(frame.includes(0xDB), 'encoder produced escapes');
  core.feed(frame);
  assert.deepEqual(ops, [{ op: 'rect', x: 0xC0 * S, y: 3 * S, w: S, h: S, style: 'rgb(219,192,5)' }]);
});

test('SLIP: invalid escape sequence drops that frame, next frame is fine', () => {
  const { core, ops } = makeCore();
  core.feed(Uint8Array.from([0xFE, 0xDB, 0x41, 0x00, 0xC0]));  // 0xDB 0x41 is illegal
  core.feed(slip(rectCmd(1, 1, 1, 1, 8, 8, 8)));
  assert.equal(core.stats.dropped, 1);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].style, 'rgb(8,8,8)');
});

test('SLIP: garbage interleaved between frames is tolerated', () => {
  const { core, ops } = makeCore();
  const good = rectCmd(2, 2, 2, 2, 4, 4, 4);
  const bytes = [
    0x00, 0x37, 0x99, 0xC0,          // junk "frame" → unknown command, dropped
    ...slip(good),
    0x13, 0x13, 0xC0,                // more junk
    ...slip(good),
    0xC0, 0xC0,                      // empty frames → ignored
  ];
  core.feed(Uint8Array.from(bytes));
  assert.equal(ops.filter(o => o.op === 'rect').length, 2);
  assert.ok(core.stats.unknown >= 2, 'junk packets counted as unknown');
});

test('SLIP: oversized frame is dropped without wedging the decoder', () => {
  const { core, ops } = makeCore();
  const big = new Uint8Array(3000).fill(0x11); // no END for 3000 bytes
  core.feed(big);
  core.feed(Uint8Array.from([0xC0]));          // terminator for the monster
  core.feed(slip(rectCmd(1, 1, 1, 1, 2, 2, 2)));
  assert.equal(ops.length, 1);
  assert.equal(core.stats.dropped >= 1, true);
});

test('sysinfo: hardware + firmware parsed, extra bytes kept raw', () => {
  const { core } = makeCore();
  core.feed(slip([0xFF, 2, 4, 0, 1, 0x01]));
  const info = core.getInfo();
  assert.equal(info.hardware, 'Production M8');
  assert.equal(info.version, '4.0.1');
  assert.deepEqual(info.extra, [0x01]);
  assert.match(info.summary, /Production M8 — firmware 4\.0\.1/);
});

test('sysinfo: unknown hardware code parses defensively', () => {
  const { core } = makeCore();
  core.feed(slip([0xFF, 9, 1, 2, 3]));
  assert.match(core.getInfo().hardware, /Unknown hardware/);
  assert.equal(core.getInfo().version, '1.2.3');
});

test('sysinfo: Model:02 refits the logical screen at 2x, letterboxed', () => {
  const { core, ops } = makeCore();
  core.feed(slip([0xFF, 3, 4, 0, 0, 0]));
  const g = core.geometry();
  assert.deepEqual([g.devW, g.devH, g.scale, g.ox, g.oy], [480, 320, 2, 0, 40]);
  ops.length = 0;
  core.feed(slip(rectCmd(0, 0, 1, 1, 5, 5, 5)));
  assert.deepEqual(ops, [{ op: 'rect', x: 0, y: 40, w: 2, h: 2, style: 'rgb(5,5,5)' }]);
});

test('feed() reports whether the screen changed and fires onDraw once per batch', () => {
  const { core } = makeCore();
  let fires = 0;
  core.onDraw(() => fires++);
  const batch = Uint8Array.from([
    ...slip(rectCmd(0, 0, 1, 1, 1, 1, 1)),
    ...slip(rectCmd(1, 0, 1, 1, 1, 1, 1)),
  ]);
  assert.equal(core.feed(batch), true);
  assert.equal(fires, 1, 'one onDraw per feed, not per packet');
  assert.equal(core.feed(Uint8Array.from([0x07, 0xC0])), false, 'junk draws nothing');
  assert.equal(fires, 1);
});

test('module loads without a DOM and exposes the Mirror-facing surface', () => {
  assert.equal(typeof USB.connect, 'function');
  assert.equal(typeof USB.disconnect, 'function');
  assert.equal(typeof USB.onFrame, 'function');
  assert.equal(USB.isConnected(), false);
  assert.equal(USB.supported(), false, 'no navigator.serial under node');
  assert.deepEqual(USB.KEY, { EDGE: 1, OPTION: 2, RIGHT: 4, PLAY: 8, SHIFT: 16, DOWN: 32, UP: 64, LEFT: 128 });
});
