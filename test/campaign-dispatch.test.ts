import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configureAccount } from '../src/accounts.js';
import { createCampaign, getCampaign, cancelCampaign, eligibleRecipients, tallyRecipients } from '../src/campaigns/store.js';
import { dispatchCampaign, abortLimit, DEFAULT_MAX_ATTEMPTS } from '../src/campaigns/dispatch.js';
import type { OutboundMessage } from '../src/mail/provider.js';
import type { CampaignContent } from '../src/config/schema.js';
import { withIsolatedConfig } from './support/isolate.js';

const noSleep = async () => {};

async function seedAccount() {
  await configureAccount({
    alias: 'x',
    email: 'x@example.com',
    method: 'app-password',
    credentials: { user: 'x@example.com', pass: 'fakepass1234567' },
  });
}

function content(overrides: Partial<CampaignContent> = {}): CampaignContent {
  return {
    subjectTemplate: 'Demo for {{first_name}}',
    bodyTemplate: 'Hi {{first_name}}, come along.',
    bodyType: 'text',
    attachments: [],
    ccFirstOnly: [],
    recipients: [
      { email: 'a@example.com', vars: { email: 'a@example.com', name: 'Ann Aye', first_name: 'Ann' } },
      { email: 'b@example.com', vars: { email: 'b@example.com', name: 'Bob Bee', first_name: 'Bob' } },
      { email: 'c@example.com', vars: { email: 'c@example.com', name: 'Cal Cee', first_name: 'Cal' } },
    ],
    ...overrides,
  };
}

function newCampaign(overrides: Partial<CampaignContent> = {}, throttlePerMinute = 6000) {
  return createCampaign({
    account: 'x',
    throttlePerMinute,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    content: content(overrides),
  });
}

test('dispatchCampaign: sends one message per recipient, each addressed only to that person', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await newCampaign();
    const sends: OutboundMessage[] = [];

    const result = await dispatchCampaign(campaign.campaignId, {
      sleep: noSleep,
      send: async (message) => {
        sends.push(message);
        return { messageId: `<id-${sends.length}>` };
      },
    });

    assert.equal(result.sent, 3);
    assert.equal(result.failed, 0);
    assert.equal(result.status, 'sent');
    assert.equal(sends.length, 3);

    // The whole point of the feature: nobody sees anybody else.
    for (const message of sends) {
      assert.equal(message.to.length, 1);
      assert.equal(message.bcc, undefined);
    }
    assert.deepEqual(
      sends.map((m) => m.to[0]),
      ['a@example.com', 'b@example.com', 'c@example.com'],
    );
  });
});

test('dispatchCampaign: renders each recipient their own subject and body', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await newCampaign();
    const sends: OutboundMessage[] = [];

    await dispatchCampaign(campaign.campaignId, {
      sleep: noSleep,
      send: async (message) => {
        sends.push(message);
        return { messageId: '<id>' };
      },
    });

    assert.equal(sends[0].subject, 'Demo for Ann');
    assert.equal(sends[0].body, 'Hi Ann, come along.');
    assert.equal(sends[2].subject, 'Demo for Cal');
    assert.equal(sends[2].body, 'Hi Cal, come along.');
  });
});

test('dispatchCampaign: ccFirstOnly rides with the first message and nothing after it', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await newCampaign({ ccFirstOnly: ['ceo@example.com'] });
    const sends: OutboundMessage[] = [];

    const result = await dispatchCampaign(campaign.campaignId, {
      sleep: noSleep,
      send: async (message) => {
        sends.push(message);
        return { messageId: '<id>' };
      },
    });

    assert.deepEqual(sends[0].cc, ['ceo@example.com']);
    assert.equal(sends[1].cc, undefined);
    assert.equal(sends[2].cc, undefined);
    assert.equal(result.ccAppliedTo, 'a@example.com');
  });
});

test('dispatchCampaign: the Cc follows the first message that actually sends, not the first attempted', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await newCampaign({ ccFirstOnly: ['ceo@example.com'] });
    const sends: OutboundMessage[] = [];

    const result = await dispatchCampaign(campaign.campaignId, {
      sleep: noSleep,
      send: async (message) => {
        sends.push(message);
        if (message.to[0] === 'a@example.com') throw new Error('550 recipient rejected');
        return { messageId: '<id>' };
      },
    });

    // Recipient A carried it and failed; B must carry it instead, so
    // leadership sees the campaign exactly once rather than never.
    assert.deepEqual(sends[0].cc, ['ceo@example.com']);
    assert.deepEqual(sends[1].cc, ['ceo@example.com']);
    assert.equal(sends[2].cc, undefined);
    assert.equal(result.ccAppliedTo, 'b@example.com');
  });
});

test('dispatchCampaign: a recipient is marked sent only after a message id comes back', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await newCampaign();

    await dispatchCampaign(campaign.campaignId, {
      sleep: noSleep,
      send: async (message) => {
        if (message.to[0] === 'b@example.com') throw new Error('timeout');
        return { messageId: '<ok>' };
      },
    });

    const reloaded = (await getCampaign(campaign.campaignId))!;
    const byEmail = (seq: number) => reloaded.recipients.find((r) => r.seq === seq)!;
    assert.equal(byEmail(0).status, 'sent');
    assert.equal(byEmail(0).messageId, '<ok>');
    assert.equal(byEmail(1).status, 'failed');
    assert.equal(byEmail(1).messageId, undefined);
    assert.match(byEmail(1).error ?? '', /timeout/);
    assert.equal(byEmail(2).status, 'sent');
  });
});

test('dispatchCampaign: re-running resumes — already-sent recipients are never re-sent', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await newCampaign();

    let failB = true;
    const firstRun: string[] = [];
    await dispatchCampaign(campaign.campaignId, {
      sleep: noSleep,
      send: async (message) => {
        firstRun.push(message.to[0]);
        if (failB && message.to[0] === 'b@example.com') throw new Error('temporary');
        return { messageId: '<ok>' };
      },
    });
    assert.deepEqual(firstRun, ['a@example.com', 'b@example.com', 'c@example.com']);

    failB = false;
    const secondRun: string[] = [];
    const result = await dispatchCampaign(campaign.campaignId, {
      sleep: noSleep,
      send: async (message) => {
        secondRun.push(message.to[0]);
        return { messageId: '<ok2>' };
      },
    });

    // This is the assertion the whole design exists for: a retry that also
    // re-sent A and C would put duplicates in two colleagues' inboxes.
    assert.deepEqual(secondRun, ['b@example.com']);
    assert.equal(result.sent, 3);
    assert.equal(result.failed, 0);
    assert.equal(result.status, 'sent');
    assert.equal(result.resumable, false);
  });
});

test('dispatchCampaign: a recipient stops being retriable once attempts hit the cap', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await createCampaign({
      account: 'x',
      throttlePerMinute: 6000,
      maxAttempts: 2,
      content: content({ recipients: [{ email: 'a@example.com', vars: { email: 'a@example.com', first_name: 'Ann' } }] }),
    });

    for (let i = 1; i <= 3; i++) {
      await dispatchCampaign(campaign.campaignId, { sleep: noSleep, send: async () => { throw new Error('always'); } });
      const reloaded = (await getCampaign(campaign.campaignId))!;
      // Attempts stop accruing at the cap because the recipient is no longer eligible.
      assert.equal(reloaded.recipients[0].attempts, Math.min(i, 2));
      assert.equal(reloaded.recipients[0].status, 'failed');
    }

    const final = (await getCampaign(campaign.campaignId))!;
    assert.equal(eligibleRecipients(final).length, 0);
  });
});

test('dispatchCampaign: one attempt per recipient per run — a run does not loop retries internally', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await newCampaign();
    let calls = 0;

    await dispatchCampaign(campaign.campaignId, {
      sleep: noSleep,
      send: async () => {
        calls += 1;
        throw new Error('nope');
      },
    });

    assert.equal(calls, 3, 'three recipients, one attempt each');
  });
});

test('dispatchCampaign: aborts a systematically failing run instead of grinding through everyone', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const recipients = Array.from({ length: 20 }, (_, i) => ({
      email: `r${i}@example.com`,
      vars: { email: `r${i}@example.com`, first_name: `R${i}` },
    }));
    const campaign = await newCampaign({ recipients });

    let calls = 0;
    const result = await dispatchCampaign(campaign.campaignId, {
      sleep: noSleep,
      send: async () => {
        calls += 1;
        throw new Error('535 authentication failed');
      },
    });

    assert.equal(calls, abortLimit(20), 'stopped at the abort limit, not at recipient 20');
    assert.equal(result.status, 'failed');
    assert.match(result.abortReason ?? '', /systematic/);
    assert.ok(result.pending > 0, 'the untouched recipients stay pending, not failed');
  });
});

test('abortLimit: a 25% share, floored so a tiny campaign is not abandoned over one bad address', () => {
  assert.equal(abortLimit(39), 10);
  assert.equal(abortLimit(4), 3);
  assert.equal(abortLimit(100), 25);
});

test('dispatchCampaign: cancelling mid-run stops it and leaves already-sent recipients alone', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await newCampaign();
    const sends: string[] = [];

    const result = await dispatchCampaign(campaign.campaignId, {
      sleep: noSleep,
      send: async (message) => {
        sends.push(message.to[0]);
        if (sends.length === 1) await cancelCampaign(campaign.campaignId);
        return { messageId: '<ok>' };
      },
    });

    assert.deepEqual(sends, ['a@example.com'], 'the cancel is honoured before the next message, not after the last');
    assert.equal(result.status, 'cancelled');
    assert.equal(result.sent, 1);
    assert.equal(result.skipped, 2);
    assert.equal(result.resumable, false);
  });
});

test('dispatchCampaign: the runtime budget leaves the remainder pending and resumable', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await newCampaign();
    let clock = 0;
    const sends: string[] = [];

    const result = await dispatchCampaign(campaign.campaignId, {
      maxRuntimeMs: 100,
      sleep: noSleep,
      now: () => clock,
      send: async (message) => {
        sends.push(message.to[0]);
        clock += 60; // each send "takes" 60ms against a 100ms budget
        return { messageId: '<ok>' };
      },
    });

    assert.equal(sends.length, 2);
    assert.equal(result.sent, 2);
    assert.equal(result.pending, 1);
    assert.equal(result.resumable, true);
    assert.equal(result.status, 'sending');
  });
});

test('dispatchCampaign: paces sends against the throttle', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await newCampaign({}, 20); // 20/min → one every 3s
    const waits: number[] = [];

    await dispatchCampaign(campaign.campaignId, {
      sleep: async (ms) => {
        waits.push(ms);
      },
      send: async () => ({ messageId: '<ok>' }),
    });

    // No wait before the first message; ~3s between the rest.
    assert.equal(waits.length, 2);
    for (const wait of waits) assert.ok(wait > 2000 && wait <= 3000, `unexpected pacing wait: ${wait}`);
  });
});

test('tallyRecipients: counts every terminal and non-terminal state', () => {
  const totals = tallyRecipients([
    { seq: 0, status: 'sent', attempts: 1 },
    { seq: 1, status: 'failed', attempts: 3 },
    { seq: 2, status: 'skipped', attempts: 0 },
    { seq: 3, status: 'pending', attempts: 0 },
  ]);
  assert.deepEqual(totals, { total: 4, sent: 1, failed: 1, skipped: 1, pending: 1 });
});

test('cancelCampaign: pending become skipped, sent are untouched', async () => {
  await withIsolatedConfig(async () => {
    await seedAccount();
    const campaign = await newCampaign();
    await dispatchCampaign(campaign.campaignId, {
      maxRuntimeMs: 0,
      sleep: noSleep,
      now: () => 0,
      send: async () => ({ messageId: '<ok>' }),
    });

    const cancelled = (await cancelCampaign(campaign.campaignId))!;
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(tallyRecipients(cancelled.recipients).skipped, 3);
  });
});
