import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { resolveAttachments } from '../src/tools/resolve-attachments.js';
import { draftEmailTool } from '../src/tools/draft-email.js';
import { scheduleSendTool } from '../src/tools/schedule-send.js';
import { draftCampaignTool } from '../src/tools/draft-campaign.js';
import { listScheduled, decryptContent, createScheduledEntry } from '../src/scheduler/store.js';
import { dispatchOne } from '../src/scheduler/dispatch.js';
import { listCampaigns, decryptCampaignContent } from '../src/campaigns/store.js';
import { configureAccount } from '../src/accounts.js';
import { addContact } from '../src/contacts.js';
import { withIsolatedConfig } from './support/isolate.js';

/**
 * T-008 finding #1: an LLM steered by hostile text could attach SSH keys,
 * mailman's own accounts.json or its master key, while the preview showed only
 * a file name. Everything here runs against a throwaway HOME: fake keys, a fake
 * config dir and key file, and stub `crontab`/`launchctl`/`schtasks` on PATH so
 * schedule_send's ticker install never touches the real machine.
 */
interface FakeHome {
  home: string;
  configDir: string;
  keyFile: string;
}

const parse = (res: { content: Array<{ text: string }> }) => JSON.parse(res.content[0].text);

async function withFakeHome(fn: (h: FakeHome) => Promise<void>): Promise<void> {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'mailman-fake-home-')));
  const configDir = path.join(home, '.config', 'mcp-mailman');
  const keyFile = path.join(home, '.local', 'state', 'mailman', 'master.key');
  const stubBin = path.join(home, 'stubbin');

  await fs.mkdir(path.join(home, '.ssh'), { recursive: true });
  await fs.writeFile(path.join(home, '.ssh', 'id_rsa'), 'FAKE PRIVATE KEY');
  await fs.mkdir(path.join(home, '.aws'), { recursive: true });
  await fs.writeFile(path.join(home, '.aws', 'credentials'), 'FAKE AWS');
  await fs.mkdir(path.join(home, '.gnupg'), { recursive: true });
  await fs.writeFile(path.join(home, '.gnupg', 'secring.gpg'), 'FAKE GPG');
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(path.dirname(keyFile), { recursive: true });
  await fs.writeFile(keyFile, 'FAKE KEY');
  await fs.mkdir(path.join(home, 'Documents'), { recursive: true });
  await fs.writeFile(path.join(home, 'Documents', 'notes.txt'), 'hello');
  await fs.symlink(path.join(home, '.ssh', 'id_rsa'), path.join(home, 'Documents', 'report.pdf'));
  await fs.mkdir(path.join(home, 'Projects'), { recursive: true });
  await fs.writeFile(path.join(home, 'Projects', 'real-invoice.pdf'), 'invoice');
  await fs.mkdir(stubBin, { recursive: true });
  for (const name of ['crontab', 'launchctl', 'schtasks']) {
    await fs.writeFile(path.join(stubBin, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }

  const savedPath = process.env.PATH;
  try {
    await withIsolatedConfig(() => fn({ home, configDir, keyFile }), {
      env: {
        HOME: home,
        MCP_MAILMAN_CONFIG_DIR: configDir,
        MAILMAN_MASTER_KEY_FILE: keyFile,
        PATH: `${stubBin}${path.delimiter}${savedPath ?? ''}`,
      },
    });
  } finally {
    process.env.PATH = savedPath;
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function withAccount(fn: (h: FakeHome) => Promise<void>): Promise<void> {
  await withFakeHome(async (h) => {
    await configureAccount({
      alias: 'x',
      email: 'x@example.com',
      method: 'app-password',
      credentials: { user: 'x@example.com', pass: 'fakepass1234567' },
    });
    await fn(h);
  });
}

// The eight forms from handover-files/raksha-t-008/proofs/input/poc-attach.mts,
// plus `~/`, the config file and the key file named directly.
function hostileInputs(h: FakeHome): Array<[string, string]> {
  const relativeToCwd = path.relative(process.cwd(), path.join(h.home, '.ssh', 'id_rsa'));
  return [
    ['absolute ~/.ssh/id_rsa', path.join(h.home, '.ssh', 'id_rsa')],
    ['traversal', `${h.home}/Documents/../.ssh/id_rsa`],
    ['relative to cwd', relativeToCwd],
    ['symlink report.pdf', path.join(h.home, 'Documents', 'report.pdf')],
    ['dir listing ~/.ssh', path.join(h.home, '.ssh')],
    ['glob ~/.ss*/*', `${h.home}/.ss*/*`],
    ['glob Documents/*.pdf', `${h.home}/Documents/*.pdf`],
    ['glob recursive config', `${h.home}/.config/**/*.json`],
    ['tilde', '~/.ssh/id_rsa'],
    ['~/.aws', `${h.home}/.aws/credentials`],
    ['~/.gnupg', `${h.home}/.gnupg/secring.gpg`],
    ['accounts.json', path.join(h.configDir, 'accounts.json')],
    ['master key file', h.keyFile],
  ];
}

test('resolveAttachments refuses every hostile form from the T-008 proof', async () => {
  await withFakeHome(async (h) => {
    await fs.writeFile(path.join(h.configDir, 'accounts.json'), '{"fake":true}');
    for (const [label, input] of hostileInputs(h)) {
      const result = await resolveAttachments([input]);
      assert.ok('code' in result, `${label}: resolved instead of refused (${input})`);
      assert.equal(result.code, 'ATTACHMENT_DENIED', `${label}: ${result.message}`);
    }
  });
});

test('resolveAttachments refuses the whole call when one of several inputs is hostile', async () => {
  await withFakeHome(async (h) => {
    const result = await resolveAttachments([path.join(h.home, 'Documents', 'notes.txt'), '~/.ssh/id_rsa']);
    assert.ok('code' in result);
    assert.equal(result.code, 'ATTACHMENT_DENIED');
  });
});

test('resolveAttachments reports the real path and name behind a symlink', async () => {
  await withFakeHome(async (h) => {
    const link = path.join(h.home, 'Documents', 'invoice.pdf');
    await fs.symlink(path.join(h.home, 'Projects', 'real-invoice.pdf'), link);

    const result = await resolveAttachments([link]);
    assert.ok('files' in result, JSON.stringify(result));
    assert.equal(result.files[0].path, path.join(h.home, 'Projects', 'real-invoice.pdf'));
    assert.equal(result.files[0].name, 'real-invoice.pdf');
  });
});

test('resolveAttachments expands ~/ to the home directory', async () => {
  await withFakeHome(async (h) => {
    const result = await resolveAttachments(['~/Documents/notes.txt']);
    assert.ok('files' in result, JSON.stringify(result));
    assert.equal(result.files[0].path, path.join(h.home, 'Documents', 'notes.txt'));
  });
});

test('ordinary attachments from ~/Documents and the cwd still resolve, as absolute paths', async () => {
  await withFakeHome(async (h) => {
    const savedCwd = process.cwd();
    process.chdir(path.join(h.home, 'Projects'));
    try {
      const result = await resolveAttachments([`${h.home}/Documents/*.txt`, 'real-invoice.pdf']);
      assert.ok('files' in result, JSON.stringify(result));
      assert.deepEqual(
        result.files.map((f) => f.path),
        [path.join(h.home, 'Documents', 'notes.txt'), path.join(h.home, 'Projects', 'real-invoice.pdf')],
      );
    } finally {
      process.chdir(savedCwd);
    }
  });
});

test('draft_email preview shows the real path of every attachment', async () => {
  await withAccount(async (h) => {
    const res = parse(await draftEmailTool.handler({
      to: ['a@example.com'], subject: 's', body: 'b', attachments: ['~/Documents/notes.txt'],
    }));
    assert.deepEqual(res.preview.attachments.map((a: { path: string }) => a.path), [
      path.join(h.home, 'Documents', 'notes.txt'),
    ]);
  });
});

test('draft_email refuses a symlink named report.pdf that points at ~/.ssh/id_rsa', async () => {
  await withAccount(async (h) => {
    const res = parse(await draftEmailTool.handler({
      to: ['a@example.com'], subject: 's', body: 'b', attachments: [path.join(h.home, 'Documents', 'report.pdf')],
    }));
    assert.equal(res.code, 'ATTACHMENT_DENIED');
  });
});

test('schedule_send stores the file list the preview showed, not the glob', async () => {
  await withAccount(async (h) => {
    const drafted = parse(await draftEmailTool.handler({
      to: ['a@example.com'], subject: 's', body: 'b', attachments: [`${h.home}/Documents/*.txt`],
    }));
    const scheduled = parse(await scheduleSendTool.handler({
      draftId: drafted.draftId,
      sendAt: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    assert.ok(scheduled.scheduledId, JSON.stringify(scheduled));

    const content = await decryptContent((await listScheduled())[0]);
    assert.deepEqual(content.attachments, [path.join(h.home, 'Documents', 'notes.txt')]);
  });
});

test('draft_campaign previews real paths and stores that file list, not the glob', async () => {
  await withAccount(async (h) => {
    await addContact('yash@example.com', 'Yash');
    const res = parse(await draftCampaignTool.handler({
      recipients: ['yash@example.com'],
      subject: 'Hi',
      body: 'Hello {{first_name|there}}',
      attachments: [`${h.home}/Documents/*.txt`],
    }));
    const expected = [path.join(h.home, 'Documents', 'notes.txt')];
    assert.deepEqual(res.attachments.map((a: { path: string }) => a.path), expected, JSON.stringify(res));

    const content = await decryptCampaignContent((await listCampaigns())[0]);
    assert.deepEqual(content.attachments, expected);
  });
});

test('a scheduled entry stored with a hostile glob is refused at fire time, before any send', async () => {
  await withAccount(async () => {
    // An entry written by 1.8.0, which stored the raw input.
    const entry = await createScheduledEntry({
      account: 'x',
      sendAt: new Date(Date.now() - 1000).toISOString(),
      content: { to: ['b@example.com'], cc: [], bcc: [], subject: 's', body: 'b', bodyType: 'text', attachments: ['~/.ss*/*'] },
    });
    assert.equal(await dispatchOne(entry), 'retry-pending');
    const [reloaded] = await listScheduled();
    assert.match(reloaded.lastError ?? '', /refused/);
  });
});
