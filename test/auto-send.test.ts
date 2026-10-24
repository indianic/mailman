import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { draftEmailTool } from '../src/tools/draft-email.js';
import { confirmSendTool } from '../src/tools/confirm-send.js';
import { getDraft } from '../src/drafts.js';
import { configureAccount } from '../src/accounts.js';
import { updateSettings } from '../src/settings.js';
import { ImapSmtpProvider } from '../src/mail/imap-client.js';
import { withIsolatedConfig } from './support/isolate.js';

const parse = (res: { content: Array<{ text: string }> }) => JSON.parse(res.content[0].text);

async function withAccount(autoSend: boolean, fn: (sends: () => number) => Promise<void>): Promise<void> {
  await withIsolatedConfig(async () => {
    await configureAccount({
      alias: 'w',
      email: 'me@example.com',
      method: 'app-password',
      credentials: { user: 'me@example.com', pass: 'aaaa bbbb cccc dddd' },
    });
    await updateSettings((s) => ({ ...s, autoSend, desktopNotifications: false }));
    const send = mock.method(ImapSmtpProvider.prototype, 'send', async () => ({ messageId: '<sent@example.com>' }));
    try {
      await fn(() => send.mock.callCount());
    } finally {
      send.mock.restore();
    }
  });
}

test('autoSend off: draft_email only drafts, and confirm_send still demands confirm:true', async () => {
  await withAccount(false, async (sends) => {
    const res = parse(await draftEmailTool.handler({ to: ['a@b.com'], subject: 's', body: 'hi', bodyType: 'text' }));
    assert.equal(res.sent, undefined);
    assert.equal(getDraft(res.draftId)!.state, 'pending');
    const refused = parse(await confirmSendTool.handler({ draftId: res.draftId }));
    assert.equal(refused.code, 'CONFIRMATION_REQUIRED');
    assert.equal(sends(), 0);
  });
});

test('autoSend on: draft_email sends at once — no confirm step, nothing left to expire', async () => {
  await withAccount(true, async (sends) => {
    const res = parse(await draftEmailTool.handler({ to: ['a@b.com'], subject: 's', body: 'hi', bodyType: 'text' }));
    assert.equal(res.sent, true);
    assert.equal(res.autoSent, true);
    assert.equal(res.messageId, '<sent@example.com>');
    assert.equal(res.preview.subject, 's');
    assert.equal(getDraft(res.draftId)!.state, 'sent');
    assert.equal(sends(), 1);
    // A stray confirm_send afterwards is the idempotent replay, not a second send.
    assert.equal(parse(await confirmSendTool.handler({ draftId: res.draftId })).sent, true);
    assert.equal(sends(), 1);
  });
});
