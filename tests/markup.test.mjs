// M8 Librarian — markup integrity tests
//
// Guards against the parser landmines that a single-file app is prone to:
// a literal "</style>" or "</script>" inside comments/strings terminates
// the block early in a real browser (regex-based extraction won't notice),
// and a nested "<!--" corrupts HTML comments.
//
// Run with:  node tests/markup.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');

test('exactly one </style>, terminating the real style block', () => {
  assert.equal((html.match(/<\/style/gi) || []).length, 1);
});

test('exactly one </script>, terminating the real script block', () => {
  assert.equal((html.match(/<\/script/gi) || []).length, 1);
});

test('no CSS comment contains a literal style closer', () => {
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  for (const m of style.matchAll(/\/\*([\s\S]*?)\*\//g))
    assert.ok(!/<\/style/i.test(m[1]), 'CSS comment contains </style');
});

test('no HTML comment nests another comment opener', () => {
  for (const m of html.matchAll(/<!--([\s\S]*?)-->/g))
    assert.ok(!m[1].includes('<!--'), 'nested <!-- inside HTML comment: ' + m[1].slice(0, 60));
});

test('script body never contains a literal script closer', () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(!/<\/script/i.test(script));
});
