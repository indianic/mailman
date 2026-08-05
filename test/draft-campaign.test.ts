import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftCampaignTool } from '../src/tools/draft-campaign.js';
import { confirmCampaignTool } from '../src/tools/confirm-campaign.js';
import { campaignStatusTool } from '../src/tools/campaign-status.js';
import { cancelCampaignTool } from '../src/tools/cancel-campaign.js';
import { configureAccount } from '../src/accounts.js';
import { addContact } from '../src/contacts.js';
import { updateSettings } from '../src/settings.js';
import { listCampaigns } from '../src/campaigns/store.js';
import { withIsolatedConfig } from './support/isolate.js';
import type { ToolResponse } from '../src/response.js';

// Untyped on purpose, matching test/configure-account.test.ts's `parse` — the
// point of these tests is the JSON a host actually receives, and restating its
// shape as a local interface would let the two drift silently.
function body(response: ToolResponse) {
  return JSON.parse(response.content[0].text);
}

async function seed() {
  await configureAccount({
    alias: 'x',
    email: 'x@example.com',
    method: 'app-password',
    credentials: { user: 'x@example.com', pass: 'fakepass1234567' },
  });
  await addContact('yash@example.com', 'Yash Suryawanshi');
  await addContact('brinda@example.com', 'Brinda');
  await addContact('chetan@example.com'); // deliberately nameless
}

const draft = (args: Record<string, unknown>) => draftCampaignTool.handler(args);

test('draft_campaign: refuses to draft when a placeholder has no value, and persists nothing', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const response = await draft({
      recipients: ['yash@example.com', 'chetan@example.com'],
      subject: 'Demo',
      body: 'Hi {{first_name}}, come along.',
      bodyType: 'text',
    });

    assert.equal(response.isError, true);
    const result = body(response);
    assert.equal(result.code, 'CAMPAIGN_UNRESOLVED');
    assert.match(result.message, /chetan@example\.com/);
    assert.match(result.message, /\{\{first_name\}\}/);
    // Names the way out rather than just the problem.
    assert.match(result.message, /fallback/);

    assert.deepEqual(await listCampaigns(), [], 'a refused draft must leave nothing on disk');
  });
});

test('draft_campaign: an explicit fallback resolves the nameless recipient and warns about it', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['yash@example.com', 'chetan@example.com'],
        subject: 'Demo',
        body: 'Hi {{first_name|there}}, come along.',
        bodyType: 'text',
      }),
    );

    assert.equal(result.total, 2);
    assert.ok(result.campaignId.startsWith('cmp_'));
    assert.deepEqual(result.unresolved, []);
    assert.ok(
      result.warnings.some((w: string) => w.includes('chetan@example.com') && w.includes('fallback')),
      `expected a fallback warning naming the recipient, got ${JSON.stringify(result.warnings)}`,
    );
  });
});

test('draft_campaign: samples include the awkward rendering, not two flattering ones', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['yash@example.com', 'brinda@example.com', 'chetan@example.com'],
        subject: 'Demo',
        body: 'Hi {{first_name|there}}, come along.',
        bodyType: 'text',
      }),
    );

    const previews = result.samples.map((s: { bodyPreview: string }) => s.bodyPreview);
    assert.ok(previews.includes('Hi Yash, come along.'));
    assert.ok(previews.includes('Hi there, come along.'), `fallback sample missing: ${JSON.stringify(previews)}`);
    const fallbackSample = result.samples.find((s: { to: string }) => s.to === 'chetan@example.com');
    assert.deepEqual(fallbackSample.usedFallbackFor, ['first_name']);
  });
});

test('draft_campaign: an inline "Name <addr>" supplies the name for someone not in contacts', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['Priya Nair <priya@example.com>'],
        subject: 'Demo',
        body: 'Hi {{first_name}},',
        bodyType: 'text',
      }),
    );
    assert.equal(result.total, 1);
    assert.equal(result.samples[0].bodyPreview, 'Hi Priya,');
  });
});

test('draft_campaign: per-recipient vars override contacts and carry custom tokens', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: [{ email: 'yash@example.com', vars: { name: 'Yash S', company: 'IndiaNIC' } }],
        subject: '{{company}} demo',
        body: 'Hi {{first_name}}, from {{company}}.',
        bodyType: 'text',
      }),
    );
    assert.equal(result.samples[0].subject, 'IndiaNIC demo');
    assert.equal(result.samples[0].bodyPreview, 'Hi Yash, from IndiaNIC.');
  });
});

test('draft_campaign: warns when the body addresses a group — the wrong-mode trap', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['yash@example.com', 'brinda@example.com'],
        subject: 'Demo',
        body: 'Hi team, {{first_name}} bring your questions.',
        bodyType: 'text',
      }),
    );
    assert.ok(result.warnings.some((w: string) => /broadcast/i.test(w)));
  });
});

test('draft_campaign: warns when a ccFirstOnly address is also a recipient', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['yash@example.com', 'brinda@example.com'],
        subject: 'Demo',
        body: 'Hi {{first_name}},',
        bodyType: 'text',
        ccFirstOnly: 'yash@example.com',
      }),
    );
    assert.ok(result.warnings.some((w: string) => w.includes('two emails')));
  });
});

test('draft_campaign: warns when nothing is actually personalised', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['yash@example.com', 'brinda@example.com'],
        subject: 'Demo',
        body: 'The demo is Thursday.',
        bodyType: 'text',
      }),
    );
    assert.ok(result.warnings.some((w: string) => /identical text/.test(w)));
  });
});

test('draft_campaign: requires a subject', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const response = await draft({ recipients: ['yash@example.com'], body: 'Hi {{first_name}},', bodyType: 'text' });
    assert.equal(response.isError, true);
    assert.match(body(response).message, /subject/i);
  });
});

test('draft_campaign: rejects an unusable address rather than silently dropping the recipient', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const response = await draft({
      recipients: ['yash@example.com', 'not an address'],
      subject: 'Demo',
      body: 'Hi {{first_name}},',
      bodyType: 'text',
    });
    assert.equal(response.isError, true);
    assert.match(body(response).message, /not an address/);
  });
});

test('draft_campaign: de-duplicates a repeated recipient', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['yash@example.com', 'YASH@example.com'],
        subject: 'Demo',
        body: 'Hi {{first_name}},',
        bodyType: 'text',
      }),
    );
    assert.equal(result.total, 1);
  });
});

test('confirm_campaign: refuses without confirm:true while alwaysConfirm is on', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const drafted = body(
      await draft({ recipients: ['yash@example.com'], subject: 'Demo', body: 'Hi {{first_name}},', bodyType: 'text' }),
    );

    const response = await confirmCampaignTool.handler({ campaignId: drafted.campaignId });
    assert.equal(response.isError, true);
    const result = body(response);
    assert.equal(result.code, 'CONFIRMATION_REQUIRED');
    // The number matters: one approval covering N sends must say N.
    assert.match(result.message, /1 separate emails?/);

    const [stored] = await listCampaigns();
    assert.equal(stored.status, 'draft', 'a refused confirm must not move the campaign to sending');
  });
});

test('confirm_campaign: a campaign with 39 recipients says so in the confirmation gate', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const recipients = Array.from({ length: 39 }, (_, i) => ({ email: `r${i}@example.com`, vars: { name: `R ${i}` } }));
    const drafted = body(
      await draft({ recipients, subject: 'Demo', body: 'Hi {{first_name}},', bodyType: 'text' }),
    );
    assert.equal(drafted.total, 39);
    assert.equal(drafted.estimatedDuration, '~2 min');

    const response = await confirmCampaignTool.handler({ campaignId: drafted.campaignId });
    assert.match(body(response).message, /39 separate emails/);
  });
});

test('confirm_campaign: unknown campaign id is a clean error, not a throw', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const response = await confirmCampaignTool.handler({ campaignId: 'cmp_nope', confirm: true });
    assert.equal(response.isError, true);
    assert.equal(body(response).code, 'CAMPAIGN_NOT_FOUND');
  });
});

test('campaign_status: lists campaigns, then details one per recipient', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const drafted = body(
      await draft({
        recipients: ['yash@example.com', 'brinda@example.com'],
        subject: 'Demo',
        body: 'Hi {{first_name}},',
        bodyType: 'text',
      }),
    );

    const list = body(await campaignStatusTool.handler({}));
    assert.equal(list.campaigns.length, 1);
    assert.equal(list.campaigns[0].status, 'draft');
    assert.equal(list.campaigns[0].total, 2);

    const detail = body(await campaignStatusTool.handler({ campaignId: drafted.campaignId }));
    assert.equal(detail.subject, 'Demo');
    assert.deepEqual(
      detail.recipients.map((r: { email: string }) => r.email),
      ['yash@example.com', 'brinda@example.com'],
    );
    assert.ok(detail.recipients.every((r: { status: string }) => r.status === 'pending'));
  });
});

test('cancel_campaign: reports what had already gone out instead of just "cancelled"', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const drafted = body(
      await draft({ recipients: ['yash@example.com'], subject: 'Demo', body: 'Hi {{first_name}},', bodyType: 'text' }),
    );

    const result = body(await cancelCampaignTool.handler({ campaignId: drafted.campaignId }));
    assert.equal(result.cancelled, true);
    assert.equal(result.status, 'cancelled');
    assert.equal(result.skipped, 1);
    assert.match(result.note, /Nothing had been sent/);

    const after = await confirmCampaignTool.handler({ campaignId: drafted.campaignId, confirm: true });
    assert.equal(after.isError, true);
    assert.equal(body(after).code, 'CAMPAIGN_CANCELLED');
  });
});

test('draft_campaign: an HTML body escapes the merged value', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    await addContact('sales@example.com', 'Sales & <Marketing>');
    const drafted = body(
      await draft({
        recipients: ['sales@example.com'],
        subject: 'Demo',
        body: '<p>Hi {{name}},</p>',
        bodyType: 'html',
        theme: 'plain',
      }),
    );
    assert.match(drafted.samples[0].bodyPreview, /Sales &amp; &lt;Marketing&gt;/);
  });
});

test('confirm_campaign: with alwaysConfirm off, a bare call still needs the campaign to exist', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    await updateSettings((current) => ({ ...current, alwaysConfirm: false }));
    const response = await confirmCampaignTool.handler({ campaignId: 'cmp_missing' });
    assert.equal(body(response).code, 'CAMPAIGN_NOT_FOUND');
  });
});
