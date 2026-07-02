import { test } from 'node:test';
import assert from 'node:assert/strict';
import { section, check, attention, detail, result } from '../src/cli/tree.js';

// Captures what actually hits stdout, stripped of ANSI color codes — a
// regression guard against a future @clack/prompts bump silently changing
// which glyph these map to (see docs/SKILLS.md's "Terminal output
// convention"). Each helper's meaning depends on the exact glyph it
// renders, not just "some icon."
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

test('section() renders a filled diamond ◆', () => {
  const out = captureStdout(() => section('accounts'));
  assert.match(out, /◆ {2}accounts/);
});

test('check(true) renders a hollow diamond ◇', () => {
  const out = captureStdout(() => check(true, 'master key found'));
  assert.match(out, /◇ {2}master key found/);
});

test('check(false) renders a filled red square ■', () => {
  const out = captureStdout(() => check(false, 'master key not found'));
  assert.match(out, /■ {2}master key not found/);
});

test('result(true) renders a filled diamond ◆ (flat top-level pass)', () => {
  const out = captureStdout(() => result(true, 'Node version: v20.0.0'));
  assert.match(out, /◆ {2}Node version/);
});

test('result(false) renders a filled red square ■ (flat top-level fail)', () => {
  const out = captureStdout(() => result(false, 'SMTP unreachable'));
  assert.match(out, /■ {2}SMTP unreachable/);
});

test('attention() renders a triangle ▲', () => {
  const out = captureStdout(() => attention('claude cli not registered'));
  assert.match(out, /▲ {2}claude cli not registered/);
});

test('detail() renders no icon, just the continuation bar', () => {
  const out = captureStdout(() => detail('sent: 2   read: 7'));
  assert.match(out, /│ {2}sent: 2 {3}read: 7/);
  assert.doesNotMatch(out, /[◆◇■▲]/);
});
