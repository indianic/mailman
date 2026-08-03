import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLaunchdPlist,
  buildCronLine,
  isCronInstalled,
  upsertCronLine,
  buildSchtasksCreateArgs,
  cronEnvPrefix,
  cronLineHasDbus,
  tickerEnv,
} from '../src/scheduler/ticker-install.js';
import { getPackageName } from '../src/version.js';

test('buildLaunchdPlist embeds the send-scheduled --due command and a poll interval', () => {
  const plist = buildLaunchdPlist(120);
  assert.match(plist, /send-scheduled/);
  assert.match(plist, /--due/);
  assert.match(plist, /<integer>120<\/integer>/);
  // npx must resolve the published scoped package, not the (unpublished)
  // bare binary name — a regression here silently breaks every scheduled send.
  assert.ok(plist.includes(getPackageName()));
});

test('buildLaunchdPlist bakes the node bin dir into PATH — launchd default PATH lacks Homebrew/nvm', () => {
  const plist = buildLaunchdPlist(120, '/opt/fake/node/bin');
  assert.match(plist, /<key>EnvironmentVariables<\/key>/);
  assert.match(plist, /<key>PATH<\/key><string>\/opt\/fake\/node\/bin:.*\/usr\/bin:\/bin<\/string>/);
});

test('buildCronLine sets PATH inline so cron (default /usr/bin:/bin) finds npx', () => {
  assert.ok(/PATH=\/opt\/fake\/node\/bin:\S* npx -y /.test(buildCronLine(3, '/opt/fake/node/bin')));
  assert.ok(buildCronLine(3, '/opt/fake/node/bin').includes(`npx -y ${getPackageName()}`));
});

test('isCronInstalled detects the mailman marker line', () => {
  assert.equal(isCronInstalled('* * * * * echo hi\n'), false);
  assert.equal(isCronInstalled(`${buildCronLine()}\n`), true);
});

test('buildCronLine npx-resolves the scoped package, not the bare binary name', () => {
  assert.ok(buildCronLine().includes(`npx -y ${getPackageName()} send-scheduled --due`));
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

/**
 * cron gets no D-Bus session. On a Linux box whose keyring worked perfectly from
 * a terminal, every scheduled send still died with `Cannot autolaunch D-Bus
 * without X11 $DISPLAY` — the ticker line carried PATH and nothing else.
 */
test('buildCronLine carries the D-Bus session address so the ticker can reach the keyring', () => {
  const line = buildCronLine(3, '/opt/fake/node/bin', {
    DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
    XDG_RUNTIME_DIR: '/run/user/1000',
    MAILMAN_KEYSTORE: 'os-keychain',
  });
  assert.match(line, /DBUS_SESSION_BUS_ADDRESS='unix:path=\/run\/user\/1000\/bus'/);
  assert.match(line, /XDG_RUNTIME_DIR='\/run\/user\/1000'/);
  assert.match(line, /MAILMAN_KEYSTORE='os-keychain'/);
  // PATH must still come first, and the command must still be the last thing.
  assert.ok(line.indexOf('PATH=') < line.indexOf('DBUS_SESSION_BUS_ADDRESS='));
  assert.ok(line.indexOf('DBUS_SESSION_BUS_ADDRESS=') < line.indexOf('npx -y '));
});

test('buildCronLine with no captured environment is unchanged from before', () => {
  // A desktop-less box may legitimately have none of these set; the line must not
  // grow a stray empty assignment that cron would reject.
  const line = buildCronLine(3, '/opt/fake/node/bin', {});
  assert.ok(/PATH=\/opt\/fake\/node\/bin:\S* npx -y /.test(line), line);
});

test('cronEnvPrefix escapes the two characters that would break a crontab', () => {
  // Unescaped `%` means "everything after this is stdin" to cron, silently
  // truncating the command — and D-Bus addresses carry percent-encoded paths.
  assert.equal(cronEnvPrefix({ A: 'unix:path=/run/user/1000/bus%2Fx' }), "A='unix:path=/run/user/1000/bus\\%2Fx'");
  assert.equal(cronEnvPrefix({ B: "it's" }), "B='it'\\''s'");
  assert.equal(cronEnvPrefix({}), '');
});

test('cronLineHasDbus only looks at the mailman-managed line', () => {
  const withDbus = buildCronLine(3, '/x/bin', { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' });
  const without = buildCronLine(3, '/x/bin', {});
  assert.equal(cronLineHasDbus(withDbus), true);
  assert.equal(cronLineHasDbus(without), false);
  // Someone else's crontab entry mentioning D-Bus must not read as ours being fine.
  assert.equal(cronLineHasDbus(`0 9 * * * DBUS_SESSION_BUS_ADDRESS=x /usr/bin/other\n${without}`), false);
});

test('tickerEnv captures only non-secret variables', () => {
  const saved = { ...process.env };
  try {
    process.env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/run/user/1000/bus';
    process.env.MCP_MAILMAN_CONFIG_DIR = '/tmp/profile';
    process.env.MAILMAN_MASTER_PASSPHRASE = 'must never be captured';
    process.env.MAILMAN_MASTER_KEY = 'must never be captured';

    const env = tickerEnv();
    assert.equal(env.DBUS_SESSION_BUS_ADDRESS, 'unix:path=/run/user/1000/bus');
    assert.equal(env.MCP_MAILMAN_CONFIG_DIR, '/tmp/profile');
    // mailman writing a passphrase or a raw key into a crontab on the user's
    // behalf is not a decision it gets to make.
    assert.ok(!('MAILMAN_MASTER_PASSPHRASE' in env));
    assert.ok(!('MAILMAN_MASTER_KEY' in env));
    assert.ok(!JSON.stringify(env).includes('must never be captured'));
  } finally {
    for (const name of ['DBUS_SESSION_BUS_ADDRESS', 'MCP_MAILMAN_CONFIG_DIR', 'MAILMAN_MASTER_PASSPHRASE', 'MAILMAN_MASTER_KEY']) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test('buildLaunchdPlist carries the same environment, XML-escaped', () => {
  const plist = buildLaunchdPlist(120, '/opt/fake/node/bin', {
    MCP_MAILMAN_CONFIG_DIR: '/tmp/a&b',
    MAILMAN_KEYSTORE: 'passphrase',
  });
  assert.match(plist, /<key>MCP_MAILMAN_CONFIG_DIR<\/key><string>\/tmp\/a&amp;b<\/string>/);
  assert.match(plist, /<key>MAILMAN_KEYSTORE<\/key><string>passphrase<\/string>/);
  // A raw & would make the plist unparseable and launchd would drop the job.
  assert.doesNotMatch(plist, /a&b/);
});

test('buildSchtasksCreateArgs includes the task name and due command', () => {
  const args = buildSchtasksCreateArgs(4);
  assert.ok(args.includes('mcp-mailman-ticker'));
  assert.ok(args.includes(`npx -y ${getPackageName()} send-scheduled --due`));
  assert.ok(args.includes('4'));
});
