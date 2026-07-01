import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLaunchdPlist,
  buildCronLine,
  isCronInstalled,
  upsertCronLine,
  buildSchtasksCreateArgs,
} from '../src/scheduler/ticker-install.js';

test('buildLaunchdPlist embeds the send-scheduled --due command and a poll interval', () => {
  const plist = buildLaunchdPlist(120);
  assert.match(plist, /send-scheduled/);
  assert.match(plist, /--due/);
  assert.match(plist, /<integer>120<\/integer>/);
});

test('isCronInstalled detects the mailman marker line', () => {
  assert.equal(isCronInstalled('* * * * * echo hi\n'), false);
  assert.equal(isCronInstalled(`${buildCronLine()}\n`), true);
});

test('upsertCronLine appends the ticker line without touching unrelated entries', () => {
  const existing = '0 9 * * * /usr/bin/backup.sh\n';
  const updated = upsertCronLine(existing);
  assert.match(updated, /backup\.sh/);
  assert.equal(isCronInstalled(updated), true);
});

test('upsertCronLine replaces a prior mailman line instead of duplicating it', () => {
  const first = upsertCronLine('', buildCronLine(3));
  const second = upsertCronLine(first, buildCronLine(5));
  const mailmanLines = second.split('\n').filter((l) => l.includes('mcp-mailman-ticker'));
  assert.equal(mailmanLines.length, 1);
  assert.match(mailmanLines[0], /\*\/5/);
});

test('buildSchtasksCreateArgs includes the task name and due command', () => {
  const args = buildSchtasksCreateArgs(4);
  assert.ok(args.includes('mcp-mailman-ticker'));
  assert.ok(args.includes('npx -y mcp-mailman send-scheduled --due'));
  assert.ok(args.includes('4'));
});
