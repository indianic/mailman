# Personalised sending (campaigns) — specification

> Status: **Phase 1 shipped in 1.5.0**
> Origin: a real send on 5 Aug 2026 that exposed the gap — see §1.
> What actually landed, and where it departs from this document: **§9**.

Written 2026-08-05 against the 1.4.1 source; §3's survey of what already existed
is from that tree.

---

## 1. The problem, from a real send

On 5 Aug 2026 a product announcement went to 40 people through MailMan:

```
To  : kalpesh.gamit@indianic.com
Cc  : sandeep@indianic.com (CEO), jigarpanchal@indianic.com (Sales Head)
Bcc : 37 colleagues
Body: "Hi team, ..."
```

That is the only shape MailMan can produce today: **one message, one `to`/`cc`/`bcc` set**. It worked, and for that particular email it was the right choice (§2.1). But it forced three compromises:

1. **"Hi team"** — the body cannot address anyone by name, because there is one body for 40 people.
2. **`To:` is the sender.** A Bcc-only message needs something in `To`, or it arrives with an empty `To` header, which many corporate filters score as bulk.
3. **37 hidden recipients on one envelope** is a textbook bulk-mail signature. Deliverability suffers exactly when it matters — an announcement people are meant to act on.

The request that followed was: *why not "Hi Yash" with the recipient in `To`?*

That is a merge/campaign feature. MailMan has no part of it today.

---

## 2. What senders actually want — four modes

Designing for "personalisation" alone under-serves the problem. In practice there are four distinct modes, and MailMan currently supports one and a half.

### 2.1 Broadcast — *one message, many recipients*

**Wants:** a shared announcement where everyone can see it is a group message. Leadership visible in `Cc` as an endorsement. One thread if anyone replies.

**Correct for:** company announcements, policy changes, "the demo is Thursday".

**Honesty matters here.** "Hi Yash" on a message that says *"bring your questions to the session"* pretends to be 1:1 when it plainly is not. Recipients notice, and it cheapens the sender. **Broadcast is not a degraded mode — for genuinely collective messages it is the right one.**

**Status: supported today.** Keep it.

### 2.2 Personalised merge — *N messages, one per recipient*

**Wants:** each recipient in their own `To:`, addressed by name, no other recipients visible or inferable. Looks and behaves like ordinary correspondence.

**Correct for:** sales outreach, individual nudges, "your account needs X", anything asking one person to act.

**Status: not supported.** This is the core of this spec.

### 2.3 Sequenced / follow-up — *N messages over time, conditional*

**Wants:** send, wait, then send a follow-up **only to those who did not reply**.

**Correct for:** sales cadences, chase-ups on an unanswered request.

**Status: not supported.** Requires reply detection — MailMan can read mail (`canRead: true`), so it is feasible, but it is a much larger feature. **Explicitly out of scope here**; noted so the data model in §4 does not preclude it.

### 2.4 Transactional — *one message, one recipient, triggered*

**Wants:** programmatic single sends from another system.

**Status: effectively supported** via `draft_email` + `confirm_send`, though `alwaysConfirm` makes it awkward for automation.

---

### Recommendation

Build **2.2 (personalised merge)**. Leave 2.1 alone. Design the store so 2.3 is possible later without a migration.

---

## 3. What exists today

Grounded in the v1.4.1 source, because it changes what needs building:

| Component | File | Reusable for campaigns? |
|---|---|---|
| Draft lifecycle | `src/drafts.ts` | **No.** In-memory only, 10-minute TTL (`draftTtlMinutes: 10`). A 39-recipient campaign that fails at #20 must survive a restart; an in-memory map does not. |
| Scheduled sends | `src/scheduler/store.ts` | **Yes — this is the foundation.** Already persists entries with `status`, `attempts`, encrypted content, plus `createScheduledEntry` / `updateScheduledEntry` / `cancelScheduledEntry`. A campaign is conceptually N scheduled entries sharing a parent. |
| Ticker | `src/scheduler/ticker-install.ts` | **Yes.** Already the mechanism for "send this later"; throttled campaign sends are the same problem. |
| Contacts | `src/contacts.ts` | **Yes.** `listContacts()` returns `{email, name}`, so `{{name}}` resolves without a new store. |
| Templates | `src/mail/templates.ts` | **Partly.** 182 templates, but they are subject-prefix + structural hint only. No variable substitution. |
| Recipient parsing | `src/mail/recipients.ts` | Yes. |
| Compose / MIME | `src/mail/compose.ts`, `src/mail/mime.ts` | Yes — per-recipient rendering happens above this layer. |

**The single most important consequence:** build campaigns on the **scheduler** store, not the **drafts** store.

---

## 4. Specification

### 4.1 Data model

A campaign is a parent record plus one child per recipient. Children carry independent state — that is what makes a partial failure recoverable.

```ts
export type CampaignStatus =
  | 'draft'       // rendered, awaiting confirmation
  | 'sending'     // ticker is working through recipients
  | 'sent'        // every recipient terminal
  | 'cancelled'   // cancelled before completion
  | 'failed';     // aborted — see abortReason

export interface Campaign {
  id: string;                    // cmp_*
  account: string;
  subject: string;               // may contain {{placeholders}}
  bodyTemplate: string;          // may contain {{placeholders}}
  bodyType: 'text' | 'html';
  theme: 'plain' | 'polished';
  status: CampaignStatus;
  createdAt: string;
  /** Cc applied ONLY to the first message — see §4.5. */
  ccFirstOnly: string[];
  throttle: { perMinute: number; };
  totals: { total: number; sent: number; failed: number; pending: number; };
  abortReason?: string;
}

export type RecipientStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface CampaignRecipient {
  campaignId: string;
  email: string;
  vars: Record<string, string>;  // {name: "Yash Suryawanshi", first_name: "Yash", ...}
  status: RecipientStatus;
  attempts: number;
  messageId?: string;
  sentAt?: string;
  error?: string;
}
```

Persist exactly as `scheduler/store.ts` does — encrypted at rest, same keystore path.

> **Why `vars` is frozen at creation, not resolved at send time:** a contact renamed mid-campaign must not produce two different greetings for the same run. Render inputs are captured once, at confirm.

### 4.2 Placeholders

Minimum viable set, resolved from `contacts.ts` with a per-recipient override:

| Token | Source | Fallback when unknown |
|---|---|---|
| `{{name}}` | contact `name` | **see below — do not silently blank** |
| `{{first_name}}` | first word of `name` | as above |
| `{{email}}` | recipient address | always available |

**Unknown-name handling is the make-or-break detail.** `Hi ,` is worse than any group greeting and will happen — your own address book has entries like `chetan@indianic.com` and `brinda@indianic.com` with no surname, and several with no name at all.

Three options, in order of preference:

1. **Refuse to draft.** `draft_campaign` returns an error naming every recipient with an unresolvable token. Sender fixes contacts or supplies overrides. *Recommended — it fails loudly at the safest moment.*
2. **Per-token fallback**, e.g. `{{name|there}}` → "Hi there,". Explicit and predictable.
3. Silent blank. **Never do this.**

### 4.3 Tools (MCP surface)

Two new tools, mirroring the existing draft/confirm split so the mental model carries over:

#### `draft_campaign`

```
recipients: Array<{email, vars?}> | string[]   // bare emails resolve vars from contacts
subject, body, bodyType, theme, account, template, attachments
ccFirstOnly?: string[]
throttlePerMinute?: number                     // default 20
```

Returns **without sending**:

```json
{
  "campaignId": "cmp_…",
  "total": 39,
  "throttlePerMinute": 20,
  "estimatedDuration": "~2 min",
  "samples": [
    {"email": "yash.s@indianic.com", "subject": "…", "bodyPreview": "Hi Yash, …"},
    {"email": "brinda@indianic.com", "subject": "…", "bodyPreview": "Hi Brinda, …"}
  ],
  "unresolved": [],
  "warnings": []
}
```

**Sample selection matters.** Do not return the first two alphabetically. Return:
- one recipient with a full name,
- one whose name came from a fallback or is single-word,
- any recipient whose rendering differs structurally.

The reviewer needs to see the *ugly* case, not the flattering one.

#### `confirm_campaign`

```
campaignId, confirm: true
```

One approval covers all N sends. With `alwaysConfirm: true` (the default), approving 39 sends individually is unusable — this is the escape hatch, and it is why the preview must be trustworthy.

Extend `cancel_scheduled` (or add `cancel_campaign`) to stop an in-flight run: pending recipients become `skipped`, already-sent are untouched and reported.

### 4.4 Throttle

Default **20/minute**, configurable. Gmail app-password accounts have daily and burst limits; 39 rapid sends can trip them, and a tripped account fails the *rest* of the campaign.

The ticker already exists — reuse it. Do not spawn a tight loop.

### 4.5 Cc semantics

Cc'ing the CEO on all 39 messages sends the CEO 39 emails. That is the obvious failure and it must be impossible.

**`ccFirstOnly`** — the Cc list is attached to the first message only, then dropped. Leadership sees the campaign went out, once.

Consider a **separate summary** to `ccFirstOnly` addresses instead: *"This went to 39 people, here is the content."* Cleaner than making the CEO recipient #1 of a merge. Worth prototyping both.

### 4.6 Idempotency

**The requirement that makes this feature safe.**

- Every recipient row transitions `pending → sent | failed` exactly once.
- Mark `sent` **after** the SMTP transaction returns a message ID, never before.
- Re-running `confirm_campaign` on a partially-sent campaign resumes; it does **not** restart. Only `pending` and `failed` (under `maxAttempts`) are eligible.
- A crash mid-campaign is recoverable because state is on disk after every recipient. This is precisely why `drafts.ts` cannot host it.
- Cap `attempts` (suggest 3). Exhausted → `failed`, campaign continues.
- If failures exceed a threshold (suggest 25%), **abort the run** and set `abortReason`. A systematically broken campaign — bad auth, rate limit — should not grind through 39 recipients producing 39 failures.

---

## 5. Expected emails

### 5.1 What is sent today — broadcast

One message, 40 recipients:

```
From: Kalpesh Gamit <kalpesh.gamit@indianic.com>
To:   kalpesh.gamit@indianic.com
Cc:   sandeep@indianic.com, jigarpanchal@indianic.com
Bcc:  aadil.a@…, abhishek.dubey@…, (35 more)
Subject: NewRa Agent — ready for product demo

Hi team,

We will be demoing NewRa Agent shortly. …
```

Sender sees: 1 message in Sent.

### 5.2 What a campaign sends — 39 messages

**Message 1 of 39** (carries the `ccFirstOnly` list):

```
From: Kalpesh Gamit <kalpesh.gamit@indianic.com>
To:   Yash Suryawanshi <yash.s@indianic.com>
Cc:   sandeep@indianic.com, jigarpanchal@indianic.com
Subject: NewRa Agent — ready for product demo

Hi Yash,

We will be demoing NewRa Agent shortly. …
```

**Message 2 of 39** (no Cc):

```
From: Kalpesh Gamit <kalpesh.gamit@indianic.com>
To:   Brinda <brinda@indianic.com>
Subject: NewRa Agent — ready for product demo

Hi Brinda,

We will be demoing NewRa Agent shortly. …
```

**Message 17 of 39** — recipient with no name on file, using `{{first_name|there}}`:

```
To:   chetan@indianic.com
Subject: NewRa Agent — ready for product demo

Hi there,

We will be demoing NewRa Agent shortly. …
```

Sender sees: 39 messages in Sent. Each recipient sees a message addressed solely to them, with no evidence of the other 38.

### 5.3 The preview the sender approves

```
Campaign cmp_a1b2c3 — 39 recipients, ~2 min at 20/min

  Cc on first message only: sandeep@indianic.com, jigarpanchal@indianic.com

  Sample 1 — yash.s@indianic.com
    Subject: NewRa Agent — ready for product demo
    Hi Yash, …

  Sample 2 — chetan@indianic.com          ← fallback greeting
    Subject: NewRa Agent — ready for product demo
    Hi there, …

  ⚠ 3 recipients have no name on file; they will receive "Hi there,"
      chetan@indianic.com, brinda@indianic.com, tarun@indianic.com

Confirm to send 39 messages.
```

### 5.4 A partial failure, reported honestly

```
Campaign cmp_a1b2c3 — completed with errors
  sent    : 36
  failed  :  3
    - div.patel@indianic.com    550 5.1.1 recipient rejected  (3 attempts)
    - laukik.patel@indianic.com 550 5.1.1 recipient rejected  (3 attempts)
    - tarun@indianic.com        timeout                       (3 attempts)

Re-run confirm_campaign to retry the 3 failures. The 36 sent will not be re-sent.
```

---

## 6. Failure modes to design against

| Failure | Consequence | Mitigation |
|---|---|---|
| Crash mid-campaign | Unknown who received it | Persist per-recipient state after every send (§4.6) |
| Retry re-sends | Colleagues get duplicates; trust in the tool gone | Resume-not-restart; terminal states never re-eligible |
| Rate limit hit | Account throttled or suspended | Throttle (§4.4) + abort threshold |
| Missing name | "Hi ," | Refuse to draft, or explicit fallback (§4.2) |
| Cc on every message | CEO receives 39 emails | `ccFirstOnly` (§4.5) |
| Reply fragmentation | 39 threads, no shared context | Accept it — inherent to the mode. Use broadcast when discussion is wanted. |
| Wrong mode chosen | Fake intimacy on a group message | Document §2. Consider warning when a campaign body contains "team"/"everyone". |

---

## 7. Suggested phasing

**Phase 1 — merge, no scheduling.** `draft_campaign` + `confirm_campaign`, persistent per-recipient state, throttle, `ccFirstOnly`, refuse-on-unresolved. Delivers the whole ask in §1.

**Phase 2 — resilience.** Resume after crash, retry failures, abort threshold, `campaign_status` tool.

**Phase 3 — reporting.** Per-campaign log, `list_campaigns`, bounce capture via the read side.

**Phase 4 — sequencing (§2.3).** Reply detection and conditional follow-ups. Large; only if outreach becomes a real use case.

Phase 1 alone would have let the 5 Aug email be personalised. Everything after is about doing it safely at scale.

---

## 8. Open questions

1. **Does the sender want a copy?** 39 messages in Sent is noise. Option: a single summary to self instead of appearing in every thread.
2. **`ccFirstOnly` vs a separate leadership summary** (§4.5) — which reads better to a CEO? Worth asking Sandeep directly.
3. **Unsubscribe/suppression.** Internal colleague mail does not need it. If MailMan is ever pointed at clients, it does — legally, not just as courtesy. Decide before that happens, not after.
4. **Attachment handling** — same file to all recipients is easy; per-recipient attachments are a much larger feature. Recommend explicitly not supporting the latter in Phase 1.
5. **Should broadcast warn?** If a campaign body contains "Hi team" / "everyone", flag it — the sender probably wants broadcast, not merge.

---

## 9. What shipped

Phase 1 (§7), plus the parts of Phase 2 that Phase 1 turned out to need.

### Surface

| Tool | Notes |
|---|---|
| `draft_campaign` | Renders and previews. Persists nothing when a placeholder is unresolvable. |
| `confirm_campaign` | One approval, N sends. Re-callable — resumes, never restarts. |
| `campaign_status` | Per-recipient state; no `campaignId` lists every campaign. |
| `cancel_campaign` | Pending → `skipped`; already-sent reported back, not hidden. |

### Where it departs from this document

- **`cancel_campaign`, not an extended `cancel_scheduled`** (§4.3 allowed either).
  `scheduledId` and `campaignId` are different namespaces with different
  semantics — one deletes a queue row, the other stops a partially-delivered
  run and has to report what already went out. Overloading one tool with both
  would have made its description a disclaimer.

- **`campaign_status` shipped in Phase 1, not Phase 2.** Resume-not-restart is
  only trustworthy if you can see what a partial run actually did. Shipping the
  resume semantics without the inspection tool would have meant asking the
  sender to trust an invisible state machine.

- **State lives in `campaigns.json`, not as N rows in `scheduled.json`.** §3
  called the scheduler store "the foundation", and it is — this file is built to
  the same pattern (encrypted `content`, plaintext bookkeeping, the same atomic
  `updateJsonFile` path). But putting campaign children in the scheduled queue
  would have exposed them to the ticker before confirmation, which is a way to
  send 39 unapproved emails. Recipients are keyed by `seq`, so no address sits
  in the plaintext half.

- **Sending is inline and paced, not handed to the ticker.** §7 says Phase 1 is
  "merge, no scheduling"; the ticker also runs on a 3-minute interval, which is
  coarser than a 20/min throttle. `confirm_campaign` sends within a runtime
  budget (default 600s) and leaves any remainder `pending` — the same resume
  path a crash uses, so a long campaign costs an extra call rather than a held-
  open tool call.

- **One attempt per recipient per run.** §4.6 caps attempts at 3; retries happen
  by calling `confirm_campaign` again rather than by looping inside a run. A
  transport failing for structural reasons gets an explicit second decision
  instead of three rapid-fire attempts against an account that may already be
  rate-limited.

- **The Cc follows the first message that *sends*,** not the first attempted.
  Handing `ccFirstOnly` to a message that then fails would mean leadership never
  sees the campaign at all — a quieter version of the bug §4.5 exists to prevent.

### Two things worth knowing

- **`auth rotate-key` / `auth migrate-keystore` now re-encrypt three files**, not
  two. A campaign left behind by a rotation would be a half-delivered merge whose
  remaining recipients can no longer be read — neither resumable nor listable.

- **Merged values are HTML-escaped** in an HTML body. `Sales & Marketing` and
  `O'Brien` are real address-book entries, and a name carried verbatim into HTML
  is at best mangled and at worst markup the recipient's client executes.

### Still open

Phases 3 and 4 (per-campaign log, bounce capture, reply-conditional sequencing)
are untouched, as are the §8 questions — whether the sender wants a copy,
`ccFirstOnly` versus a separate leadership summary, and suppression lists before
this is ever pointed at clients rather than colleagues.
