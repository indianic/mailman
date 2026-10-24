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

test('draft_campaign: mixes bare addresses and vars objects in one array', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    // The shape a real campaign actually has: most people resolve from
    // contacts, one or two need a name supplied. Requiring all-or-nothing here
    // meant rewriting every entry as an object because of one exception.
    const result = body(
      await draft({
        recipients: [
          'yash@example.com',
          { email: 'chetan@example.com', vars: { name: 'Chetan Kumar' } },
          'brinda@example.com',
        ],
        subject: 'Demo',
        body: 'Hi {{first_name}},',
        bodyType: 'text',
      }),
    );
    // chetan has no name in contacts, so a successful draft is itself the
    // proof that the object form's vars were applied — without them this call
    // would have come back CAMPAIGN_UNRESOLVED.
    assert.equal(result.total, 3);
    assert.deepEqual(result.unresolved, []);
    assert.deepEqual(result.warnings, [], 'every name resolved, so nothing to warn about');
    for (const sample of result.samples) {
      assert.doesNotMatch(sample.bodyPreview, /\{\{/, `placeholder survived: ${sample.bodyPreview}`);
    }
  });
});

test('draft_campaign: a name from the object form renders in the body', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['yash@example.com', { email: 'chetan@example.com', vars: { name: 'Chetan Kumar' } }],
        subject: 'Demo',
        body: 'Hi {{first_name}},',
        bodyType: 'text',
      }),
    );
    const chetan = result.samples.find((s: { to: string }) => s.to === 'chetan@example.com');
    assert.ok(chetan, `chetan missing from samples: ${JSON.stringify(result.samples)}`);
    assert.equal(chetan.bodyPreview, 'Hi Chetan,');
  });
});

test('draft_campaign: de-duplicates across the two recipient forms', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['yash@example.com', { email: 'YASH@example.com', vars: { name: 'Duplicate' } }],
        subject: 'Demo',
        body: 'Hi {{first_name}},',
        bodyType: 'text',
      }),
    );
    assert.equal(result.total, 1, 'the same address in both forms must not be sent to twice');
  });
});

test('draft_campaign: an unreadable recipients argument gets a remedy, not a zod union dump', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const response = await draft({ recipients: [{ nope: 'x' }], subject: 'Demo', body: 'Hi,', bodyType: 'text' });
    assert.equal(response.isError, true);
    const message = body(response).message;
    assert.doesNotMatch(message, /unionErrors|invalid_union|ZodError/, 'a raw zod dump tells a caller nothing');
    assert.match(message, /mixed freely|either an address/i);
  });
});

/**
 * cc/bcc on a campaign. The tool used to accept both and throw them away —
 * zod strips unknown keys, so `cc: ["boss@x.com"]` returned a cheerful success
 * with nobody copied, and the sender believed their boss had seen it. Silent
 * loss, found by a user asking for exactly this.
 */
test('draft_campaign: a plain cc is refused and redirected, never silently dropped', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const response = await draft({
      recipients: ['yash@example.com'],
      subject: 'Demo',
      body: 'Hi {{first_name}},',
      bodyType: 'text',
      cc: ['boss@example.com'],
    });
    assert.equal(response.isError, true);
    const message = body(response).message;
    assert.match(message, /ccFirstOnly/, 'must name the field to use instead');
    assert.match(message, /every message/, 'must say why a plain cc is wrong here');
    assert.deepEqual(await listCampaigns(), [], 'a refused draft persists nothing');
  });
});

test('draft_campaign: a plain bcc and a stray to are refused the same way', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const common = { recipients: ['yash@example.com'], subject: 'D', body: 'Hi {{first_name}},', bodyType: 'text' };

    const bcc = body(await draft({ ...common, bcc: ['archive@example.com'] }));
    assert.match(bcc.message, /bccFirstOnly/);

    const to = body(await draft({ ...common, to: ['someone@example.com'] }));
    assert.match(to.message, /recipients/);
  });
});

test('draft_campaign: a typo\'d parameter is an error, not a silently ignored no-op', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    // "throttlePerMin" would otherwise send at the default 20/min while the
    // caller believed they had set something else.
    const response = await draft({
      recipients: ['yash@example.com'],
      subject: 'Demo',
      body: 'Hi {{first_name}},',
      bodyType: 'text',
      throttlePerMin: 5,
    });
    assert.equal(response.isError, true);
    assert.match(body(response).message, /unknown parameter\(s\): throttlePerMin/);
  });
});

test('draft_campaign: bccFirstOnly is accepted and echoed back', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['yash@example.com', 'brinda@example.com'],
        subject: 'Demo',
        body: 'Hi {{first_name}},',
        bodyType: 'text',
        ccFirstOnly: 'boss@example.com',
        bccFirstOnly: 'archive@example.com',
      }),
    );
    assert.deepEqual(result.ccFirstOnly, ['boss@example.com']);
    assert.deepEqual(result.bccFirstOnly, ['archive@example.com']);
  });
});

test('draft_campaign: warns when an address is on both ccFirstOnly and bccFirstOnly', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['yash@example.com'],
        subject: 'Demo',
        body: 'Hi {{first_name}},',
        bodyType: 'text',
        ccFirstOnly: 'boss@example.com',
        bccFirstOnly: 'boss@example.com',
      }),
    );
    assert.ok(
      result.warnings.some((w: string) => /defeats the point/.test(w)),
      `expected a both-lists warning, got ${JSON.stringify(result.warnings)}`,
    );
  });
});

test('draft_campaign: warns when a bccFirstOnly address is also a recipient', async () => {
  await withIsolatedConfig(async () => {
    await seed();
    const result = body(
      await draft({
        recipients: ['yash@example.com', 'brinda@example.com'],
        subject: 'Demo',
        body: 'Hi {{first_name}},',
        bodyType: 'text',
        bccFirstOnly: 'brinda@example.com',
      }),
    );
    assert.ok(result.warnings.some((w: string) => w.includes('bccFirstOnly') && w.includes('two emails')));
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
