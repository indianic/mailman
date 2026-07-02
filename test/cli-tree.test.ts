import { test } from 'node:test';
import assert from 'node:assert/strict';
import { section, check, attention, detail, fail, info } from '../src/cli/tree.js';

// Captures what actually hits stdout, stripped of ANSI color codes — a
// regression guard pinning both the glyph AND the spacing each helper
// renders (see docs/SKILLS.md's "Terminal output convention"). Spacing is
// part of the design: rows attach tightly; the single blank rail line
// belongs to ◆ section headers only (a real user flagged the airy
// double-spaced look this replaced).
function captureStdout(fn: () => void): string {
  const originalWrite = process.stdout.write.bind(process.stdout);
  let out = '';
  process.stdout.write = ((chunk: string) => {
    out += chunk;
    return true;
  }) as typeof process.stdout.write;
  try {
    fn();
  } finally {
    process.stdout.write = originalWrite;
  }
  return out.replace(/\x1b\[[0-9;]*m/g, '');
}

test('section() renders a leading blank rail then a filled diamond ◆', () => {
  const out = captureStdout(() => section('accounts'));
  assert.equal(out, '│\n◆  accounts\n');
});

test('check(true) renders a hollow diamond ◇, tight (no leading blank)', () => {
  const out = captureStdout(() => check(true, 'master key found'));
  assert.equal(out, '◇  master key found\n');
});

test('check(false) renders a filled red square ■, tight', () => {
  const out = captureStdout(() => check(false, 'master key not found'));
  assert.equal(out, '■  master key not found\n');
});

test('attention() renders a triangle ▲, tight', () => {
  const out = captureStdout(() => attention('claude cli not registered'));
  assert.equal(out, '▲  claude cli not registered\n');
});

test('fail() renders a red square ■, tight', () => {
  const out = captureStdout(() => fail('Usage: mailman settings set <key> <value>'));
  assert.equal(out, '■  Usage: mailman settings set <key> <value>\n');
});

test('info() renders a filled circle ●, tight', () => {
  const out = captureStdout(() => info('Opening the consent screen...'));
  assert.equal(out, '●  Opening the consent screen...\n');
});

test('detail() renders no icon, just the rail — consecutive details touch', () => {
  const out = captureStdout(() => {
    detail('sent: 2   read: 7');
    detail('draftTtlMinutes   10');
  });
  assert.equal(out, '│  sent: 2   read: 7\n│  draftTtlMinutes   10\n');
  assert.doesNotMatch(out, /[◆◇■▲●]/);
});

test('multi-line messages keep the rail unbroken on continuation lines', () => {
  const out = captureStdout(() => fail('line one\nline two\nline three'));
  assert.equal(out, '■  line one\n│  line two\n│  line three\n');
});
