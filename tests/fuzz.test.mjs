// M8 Librarian — fuzz & property tests
//
// Seeded (deterministic) randomized testing of the binary parsers and
// writers. The invariant under test everywhere: NO parser may throw on
// arbitrary bytes — they return null or a well-formed object, because a
// single corrupt file on a card must never break scanning or rendering.
//
// Run with:  node tests/fuzz.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import zlib from 'node:zlib';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
function extractModule(marker) {
  const start = html.indexOf(marker);
  assert.ok(start > 0, marker + ' not found');
  const end = html.indexOf('\n})();', start);
  const src = html.slice(start, end + '\n})();'.length);
  const name = marker.split(' ')[1];
  return new Function(`${src}; return ${name};`)();
}
const M8 = extractModule('const M8 = (() => {');
const Zip = extractModule('const Zip = (() => {');

// ── Deterministic PRNG (mulberry32) ────────────────────────
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(0x4D38); // fixed seed → reproducible failures
const randInt = (n) => Math.floor(rand() * n);
const randBytes = (len) => { const b = new Uint8Array(len); for (let i = 0; i < len; i++) b[i] = randInt(256); return b; };

// Valid fixture builders (subset of parser.test.mjs)
const INSTR_TABLE = 80446, ISIZE = 215, SAMP_OFF = 0x57, SONG_SIZE = 0x1AD09;
function writeStr(b, off, s) { for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i); }
function validSong() {
  const b = new Uint8Array(SONG_SIZE);
  writeStr(b, 0, 'M8VERSION'); b[10] = 0x02; b[11] = 0x04; b[13] = 0x00;
  writeStr(b, 148, 'FUZZSONG');
  new DataView(b.buffer).setFloat32(0x8F, 120, true);
  b.fill(0xFF, 0x2EE, 0x2EE + 2048);
  b.fill(0xFF, 0x9A5E, 0x9A5E + 255 * 32);
  b.fill(0xFF, 0xAEE, 0xAEE + 255 * 144);
  b.fill(0xFF, INSTR_TABLE, INSTR_TABLE + 128 * ISIZE);
  b.fill(0x00, INSTR_TABLE, INSTR_TABLE + ISIZE);
  b[INSTR_TABLE] = 0x02; writeStr(b, INSTR_TABLE + 1, 'FUZZ');
  writeStr(b, INSTR_TABLE + SAMP_OFF, '/Samples/f.wav');
  return b;
}
function validWavHead() {
  const b = new Uint8Array(60); const dv = new DataView(b.buffer);
  writeStr(b, 0, 'RIFF'); dv.setUint32(4, 52, true); writeStr(b, 8, 'WAVE');
  writeStr(b, 12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
  dv.setUint32(24, 44100, true); dv.setUint32(28, 176400, true);
  dv.setUint16(32, 4, true); dv.setUint16(34, 16, true);
  writeStr(b, 36, 'data'); dv.setUint32(40, 44100, true);
  return b;
}

// ── 1. Parsers never throw on random garbage ───────────────
test('parsers survive 500 random buffers of random lengths', () => {
  const parsers = [M8.parseSong, M8.parseInstrFile, M8.parseTheme, M8.parseGroove, M8.parseSongPatterns];
  for (let i = 0; i < 500; i++) {
    const len = randInt(120000);
    const b = randBytes(len);
    for (const p of parsers) {
      const r = p(b); // must not throw
      assert.ok(r === null || typeof r === 'object');
    }
  }
});

test('parsers survive garbage stamped with a valid magic+type', () => {
  for (const [type, parser] of [[0x00, M8.parseSong], [0x10, M8.parseInstrFile], [0x20, M8.parseTheme], [0x30, M8.parseGroove]]) {
    for (let i = 0; i < 100; i++) {
      const b = randBytes(randInt(SONG_SIZE + 1000));
      if (b.length >= 14) { writeStr(b, 0, 'M8VERSION'); b[9] = 0; b[13] = type; }
      const r = parser(b);
      assert.ok(r === null || typeof r === 'object');
      if (r && type === 0x00) {
        // structural invariants on anything parseSong accepts
        assert.equal(typeof r.name, 'string');
        assert.ok(Array.isArray(r.instruments) && r.instruments.length <= 128);
        for (const inst of r.instruments) {
          assert.ok(inst.slot >= 0 && inst.slot < 128);
          assert.equal(typeof inst.name, 'string');
          assert.equal(typeof inst.samplePath, 'string');
        }
        assert.ok(Array.isArray(r.samplePaths));
      }
    }
  }
});

test('parsers survive truncations of a valid song at every region boundary', () => {
  const full = validSong();
  const cuts = [0, 5, 13, 14, 100, 147, 0x2EE, 0x2EF, 0xAEE, 0x9A5E, 0xBA3E,
    INSTR_TABLE, INSTR_TABLE + 1, INSTR_TABLE + ISIZE, INSTR_TABLE + 128 * ISIZE - 1,
    INSTR_TABLE + 128 * ISIZE, SONG_SIZE - 1];
  for (const cut of cuts) {
    const b = full.slice(0, cut);
    assert.doesNotThrow(() => M8.parseSong(b));
    assert.doesNotThrow(() => M8.parseSongPatterns(b));
  }
  // random truncations
  for (let i = 0; i < 200; i++) {
    const b = full.slice(0, randInt(SONG_SIZE));
    M8.parseSong(b); M8.parseSongPatterns(b);
  }
});

test('parseSong survives random single-byte mutations of a valid song', () => {
  const full = validSong();
  for (let i = 0; i < 300; i++) {
    const b = full.slice();
    for (let m = 0; m < 1 + randInt(8); m++) b[randInt(b.length)] = randInt(256);
    const r = M8.parseSong(b); // may be null (mutated magic) or object — never throws
    if (r) {
      assert.equal(typeof r.name, 'string');
      for (const inst of r.instruments) assert.equal(typeof inst.samplePath, 'string');
    }
    M8.parseSongPatterns(b);
  }
});

// ── 2. decodeInstrParams bounds ────────────────────────────
test('decodeInstrParams never throws within its guard, for all kinds and versions', () => {
  const versions = [{major:1,minor:0,patch:0},{major:2,minor:7,patch:0},{major:3,minor:0,patch:0},{major:4,minor:1,patch:0}];
  for (let i = 0; i < 300; i++) {
    const b = randBytes(14 + ISIZE + randInt(100));
    b[14] = [0x00,0x01,0x02,0x03,0x04,0x05,0x06,0xFF,randInt(256)][randInt(9)];
    for (const v of versions) {
      const r = M8.decodeInstrParams(b, 14, v);
      assert.ok(r === null || typeof r === 'object');
      if (r) for (const m of r.mods) assert.equal(typeof m.type, 'string');
    }
  }
});

// ── 3. writeSamplePath properties ──────────────────────────
test('writeSamplePath round-trips random paths through parseSong (property)', () => {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _-.';
  for (let i = 0; i < 150; i++) {
    const b = validSong();
    const slot = randInt(128);
    // make the slot a sampler first
    const base = INSTR_TABLE + slot * ISIZE;
    b.fill(0x00, base, base + ISIZE);
    b[base] = 0x02; writeStr(b, base + 1, 'S' + slot);
    let path = '/Samples/';
    const n = randInt(100);
    for (let c = 0; c < n; c++) path += chars[randInt(chars.length)];
    path += '.wav';
    if (new TextEncoder().encode(path).length > 127) continue;
    M8.writeSamplePath(b, base, path);
    const parsed = M8.parseSong(b);
    const inst = parsed.instruments.find(x => x.slot === slot);
    assert.equal(inst.samplePath, path);
    // and the write stayed inside the slot: neighbours unaffected
    const neighbour = parsed.instruments.find(x => x.slot === 0 && slot !== 0);
    if (neighbour) assert.equal(neighbour.samplePath, '/Samples/f.wav');
  }
});

test('writeSamplePath refuses out-of-bounds targets instead of silently corrupting', () => {
  const short = new Uint8Array(150); // too short for base 14 + 0x57 + 128
  assert.throws(() => M8.writeSamplePath(short, 14, '/a.wav'));
  const song = validSong();
  assert.throws(() => M8.writeSamplePath(song, SONG_SIZE - 50, '/a.wav'));
});

test('parseInstrFile yields empty samplePath (not NUL garbage) for truncated sampler files', () => {
  const b = new Uint8Array(150); // header + kind but not a full slot
  writeStr(b, 0, 'M8VERSION'); b[10]=0x00; b[11]=0x03; b[13] = 0x10; b[14] = 0x02;
  writeStr(b, 15, 'TRUNC');
  const r = M8.parseInstrFile(b);
  assert.ok(r);
  assert.equal(r.samplePath, '');
  assert.equal(r.params, null);
});

// ── 4. parseWavHeader fuzz ─────────────────────────────────
test('parseWavHeader survives random and mutated inputs, always terminates', () => {
  for (let i = 0; i < 400; i++) {
    const b = randBytes(randInt(600));
    const r = M8.parseWavHeader(b, randInt(1 << 30));
    assert.ok(r === null || typeof r === 'object');
    if (r) { assert.ok(Number.isFinite(r.sampleRate)); assert.ok(r.duration === null || Number.isFinite(r.duration)); }
  }
  // mutations of a valid header, including hostile chunk sizes
  const valid = validWavHead();
  for (let i = 0; i < 200; i++) {
    const b = valid.slice();
    const dv = new DataView(b.buffer);
    dv.setUint32(16, [0, 1, 0xFFFFFFFF, randInt(1<<30)][randInt(4)], true);  // fmt size
    dv.setUint32(40, [0, 0xFFFFFFFF, randInt(1<<30)][randInt(3)], true);      // data size
    if (rand() < 0.3) dv.setUint32(28, 0, true);                              // byteRate 0
    const r = M8.parseWavHeader(b, 44 + 100);
    assert.ok(r === null || typeof r === 'object');
  }
});

// ── 5. FX / note / scale formatting totality ───────────────
test('fxStr/fxName/noteStr are total over their input space', () => {
  const types = ['WAVSYNTH','MACROSYNTH','SAMPLER','MIDIOUT','FMSYNTH','HYPERSYNTH','EXTERNALINST','NONE',undefined,'BOGUS'];
  for (let cmd = 0; cmd <= 0xFF; cmd++) {
    for (const t of types) {
      const s = M8.fxStr(cmd, 0xAB, t);
      assert.equal(typeof s, 'string');
      assert.ok(s.length >= 4 && s.length <= 7, `fxStr(${cmd}) → "${s}"`);
    }
    assert.equal(typeof M8.noteStr(cmd), 'string');
  }
});

test('detectScales is total over arbitrary phrase data', () => {
  for (let i = 0; i < 100; i++) {
    const phrases = [];
    for (let p = 0; p < randInt(20); p++) {
      const steps = [];
      for (let s = 0; s < 16; s++) steps.push({note: randInt(256), vol: randInt(256), instr: randInt(256), fx: []});
      phrases.push(steps);
    }
    const { bins, total, candidates } = M8.detectScales(phrases);
    assert.equal(bins.length, 12);
    assert.ok(total >= 0);
    for (const c of candidates) assert.ok(Number.isFinite(c.score));
  }
});

// ── 6. ZIP writer produces valid archives (verified vs zlib.crc32) ──
test('Zip.Writer output validates: signatures, CRCs, offsets (property)', async () => {
  for (let round = 0; round < 20; round++) {
    const chunks = [];
    const w = new Zip.Writer({ write: async u8 => chunks.push(u8) });
    const files = [];
    const nFiles = 1 + randInt(20);
    for (let f = 0; f < nFiles; f++) {
      const name = `Dir${randInt(5)}/fïle_${round}_${f}.bin`;
      const data = randBytes(randInt(5000));
      files.push({name, data});
      await w.add(name, data, 1700000000000 + randInt(1e9));
    }
    await w.finish();
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const buf = Buffer.concat(chunks.map(c => Buffer.from(c)), total);
    // EOCD
    const eocd = buf.length - 22;
    assert.equal(buf.readUInt32LE(eocd), 0x06054B50, 'EOCD signature');
    assert.equal(buf.readUInt16LE(eocd + 10), nFiles, 'entry count');
    const cdStart = buf.readUInt32LE(eocd + 16);
    // walk central directory, verify every entry against local header + data
    let off = cdStart;
    for (let f = 0; f < nFiles; f++) {
      assert.equal(buf.readUInt32LE(off), 0x02014B50, 'CD signature');
      const crc = buf.readUInt32LE(off + 16);
      const size = buf.readUInt32LE(off + 20);
      const nameLen = buf.readUInt16LE(off + 28);
      const lho = buf.readUInt32LE(off + 42);
      const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
      const expected = files.find(x => x.name === name);
      assert.ok(expected, 'name in CD matches an added file');
      assert.equal(size, expected.data.length);
      assert.equal(crc, zlib.crc32(expected.data) >>> 0, 'CRC matches zlib');
      // local header
      assert.equal(buf.readUInt32LE(lho), 0x04034B50, 'local header signature');
      const lNameLen = buf.readUInt16LE(lho + 26);
      const dataStart = lho + 30 + lNameLen;
      assert.ok(buf.slice(dataStart, dataStart + size).equals(Buffer.from(expected.data)), 'stored bytes intact');
      off += 46 + nameLen;
    }
  }
});
