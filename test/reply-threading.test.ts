import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftEmailTool } from '../src/tools/draft-email.js';
import { scheduleSendTool } from '../src/tools/schedule-send.js';
import { getDraft } from '../src/drafts.js';
import { listScheduled, decryptContent } from '../src/scheduler/store.js';
import { configureAccount } from '../src/accounts.js';
import { withIsolatedConfig } from './support/isolate.js';

/**
 * End-to-end threading through the tool surface: draft_email must carry
 * In-Reply-To/References into the draft, and schedule_send must carry them into
 * the stored entry — otherwise a reply scheduled for 9am lands detached from its
 * thread even though the immediate send would have threaded fine.
 *
 * The two transports are covered separately (gmail-api-send.test.ts and
 * integration-app-password-send.test.ts assert the compiled headers); this file
 * covers everything upstream of them.
 */
const PARENT = '<CAF=abc123@mail.gmail.com>';

const parse = (res: { content: Array<{ text: string }> }) => JSON.parse(res.content[0].text);

async function withAccount(fn: () => Promise<void>): Promise<void> {
  await withIsolatedConfig(async () => {
    await configureAccount({
      alias: 'w',
      email: 'me@example.com',
      method: 'app-password',
      credentials: { user: 'me@example.com', pass: 'aaaa bbbb cccc dddd' },
    });
    await fn();
  });
}

test('draft_email carries inReplyTo into the draft', async () => {
  await withAccount(async () => {
    const res = parse(await draftEmailTool.handler({
      to: ['sandeep@indianic.com'],
      subject: 'Re: headless Linux',
      body: 'done',
      inReplyTo: PARENT,
    }));
    const draft = getDraft(res.draftId)!;
    assert.equal(draft.inReplyTo, PARENT);
  });
});

test('references defaults to [inReplyTo] so a caller only needs the one id', async () => {
  await withAccount(async () => {
    // read_email hands back a single messageId; requiring the caller to also
    // build a References array would mean most replies simply omitted it.
    const res = parse(await draftEmailTool.handler({
      to: ['a@b.com'], subject: 'Re: x', body: 'y', inReplyTo: PARENT,
    }));
    assert.deepEqual(getDraft(res.draftId)!.references, [PARENT]);
  });
});

test('an explicit references chain is preserved, not overwritten by the default', async () => {
  await withAccount(async () => {
    const chain = ['<root@x.com>', '<second@x.com>', PARENT];
    const res = parse(await draftEmailTool.handler({
      to: ['a@b.com'], subject: 'Re: deep', body: 'y', inReplyTo: PARENT, references: chain,
    }));
    assert.deepEqual(getDraft(res.draftId)!.references, chain);
  });
});

test('a fresh message gets no threading fields at all', async () => {
  await withAccount(async () => {
    const res = parse(await draftEmailTool.handler({ to: ['a@b.com'], subject: 'fresh', body: 'y' }));
    const draft = getDraft(res.draftId)!;
    assert.equal(draft.inReplyTo, undefined);
    assert.equal(draft.references, undefined);
  });
});

test('a scheduled reply keeps its threading through encryption and back', async () => {
  await withAccount(async () => {
    const drafted = parse(await draftEmailTool.handler({
      to: ['sandeep@indianic.com'], subject: 'Re: headless Linux', body: 'later', inReplyTo: PARENT,
    }));
    const scheduled = parse(await scheduleSendTool.handler({
      draftId: drafted.draftId,
      sendAt: new Date(Date.now() + 86_400_000).toISOString(),
    }));
    assert.ok(scheduled.scheduledId);

    // The entry's content is encrypted at rest, so this also proves the fields
    // survive the round trip through the scheduled store's schema.
    const content = await decryptContent((await listScheduled())[0]);
    assert.equal(content.inReplyTo, PARENT);
    assert.deepEqual(content.references, [PARENT]);
  });
});

test('scheduled entries written before threading existed still parse', async () => {
  await withAccount(async () => {
    // The fields are optional precisely so an entry queued by an older version
    // does not become unreadable on upgrade — that would silently kill pending
    // sends, the same class of failure rotate-key had.
    const { createScheduledEntry } = await import('../src/scheduler/store.js');
    const entry = await createScheduledEntry({
      account: 'w',
      sendAt: new Date(Date.now() + 86_400_000).toISOString(),
      content: {
        to: ['a@b.com'], cc: [], bcc: [], subject: 'legacy', body: 'b',
        bodyType: 'text', attachments: [],
      } as never,
    });
    const content = await decryptContent(entry);
    assert.equal(content.subject, 'legacy');
    assert.equal(content.inReplyTo, undefined);
  });
});

test('the draft_email schema documents inReplyTo as the read_email messageId', async () => {
  // A model that passes read_email's `id` here would produce an In-Reply-To that
  // matches nothing, and the reply would silently fail to thread. The schema has
  // to say which of the two identifiers it wants.
  const schema = draftEmailTool.definition.inputSchema as {
    properties: Record<string, { description?: string }>;
  };
  const desc = schema.properties.inReplyTo?.description ?? '';
  assert.match(desc, /messageId/);
  assert.match(desc, /read_email/);
});
