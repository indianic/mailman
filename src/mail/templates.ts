/**
 * Message templates. Consistent with the project's "mailman stays dumb, Claude
 * composes" philosophy: a template is a `subjectPrefix` + a one-line structural
 * `hint` the AI uses to phrase its OWN composition. mailman does NOT substitute
 * text — the only mechanical templates (kind: 'mechanical') are fwd/reply, which
 * have a real fixed format worth building (see buildForwardedBody / quoteReply).
 *
 * The catalog is plain data so it can grow without code changes; list_templates
 * exposes it (filterable by category/search) and draft_email accepts `template`.
 */

export type TemplateKind = 'hint' | 'mechanical';

export interface EmailTemplate {
  key: string;
  category: string;
  /** Prepended to the subject (empty string = no prefix, e.g. thank-you). */
  subjectPrefix: string;
  /** Structural guidance the AI uses when composing — never substituted verbatim. */
  hint: string;
  kind: TemplateKind;
}

/** Recommended default set surfaced by list_templates when no filter is given. */
export const CORE_KEYS = new Set([
  'fyi', 'heads-up', 'follow-up', 'reminder', 'checking-in', 'request',
  'quick-question', 'action-required', 'approval-request', 'feedback-request',
  'review-request', 'meeting-request', 'reschedule', 'status-update', 'eod-report',
  'blocker', 'decision-needed', 'intro', 'thank-you', 'congrats', 'apology',
  'announcement', 'fwd', 'reply',
]);

export const TEMPLATES: EmailTemplate[] = [
  // ── Informational / context ─────────────────────────────────────────────
  { key: 'fyi', category: 'informational', subjectPrefix: 'FYI:', hint: 'No action needed — just sharing context. Keep it brief.', kind: 'hint' },
  { key: 'heads-up', category: 'informational', subjectPrefix: 'Heads-up:', hint: 'Early warning about something coming; state what and when.', kind: 'hint' },
  { key: 'for-your-review', category: 'informational', subjectPrefix: 'For your review:', hint: 'Share something for a light look; invite optional feedback.', kind: 'hint' },
  { key: 'for-awareness', category: 'informational', subjectPrefix: 'For awareness:', hint: 'Broad awareness, no action expected.', kind: 'hint' },
  { key: 'sharing', category: 'informational', subjectPrefix: 'Sharing:', hint: 'Pass along a resource/link with one line of why it matters.', kind: 'hint' },
  { key: 'note', category: 'informational', subjectPrefix: 'Note:', hint: 'A short memo/note.', kind: 'hint' },
  { key: 'context', category: 'informational', subjectPrefix: 'Context:', hint: 'Give background needed before a decision.', kind: 'hint' },
  { key: 'recap', category: 'informational', subjectPrefix: 'Recap:', hint: 'Summarize what happened, in tight bullets.', kind: 'hint' },
  { key: 'meeting-notes', category: 'informational', subjectPrefix: 'Meeting notes:', hint: 'Structured minutes: attendees, decisions, action items.', kind: 'hint' },
  { key: 'tldr', category: 'informational', subjectPrefix: 'TL;DR:', hint: 'Lead with a one-line summary, then optional detail.', kind: 'hint' },

  // ── Follow-ups & reminders ──────────────────────────────────────────────
  { key: 'follow-up', category: 'follow-up', subjectPrefix: 'Follow-up:', hint: 'Reference the prior thread and state the ask or next step.', kind: 'hint' },
  { key: 'reminder', category: 'follow-up', subjectPrefix: 'Reminder:', hint: 'Nudge on something already discussed; restate the item.', kind: 'hint' },
  { key: 'gentle-reminder', category: 'follow-up', subjectPrefix: 'Gentle reminder:', hint: 'Soft, friendly nudge — no pressure.', kind: 'hint' },
  { key: 'second-reminder', category: 'follow-up', subjectPrefix: 'Reminder (2nd):', hint: 'Escalating nudge; note it is the second.', kind: 'hint' },
  { key: 'final-reminder', category: 'follow-up', subjectPrefix: 'Final reminder:', hint: 'Last nudge before escalating; state the consequence tone.', kind: 'hint' },
  { key: 'checking-in', category: 'follow-up', subjectPrefix: 'Checking in:', hint: 'Friendly status ask on an open item.', kind: 'hint' },
  { key: 'bump', category: 'follow-up', subjectPrefix: '', hint: 'Short bump to resurface a thread; keep the original subject.', kind: 'hint' },
  { key: 'revisit', category: 'follow-up', subjectPrefix: 'Revisiting:', hint: 'Reopen an older topic; remind of prior context.', kind: 'hint' },
  { key: 'awaiting-reply', category: 'follow-up', subjectPrefix: 'Following up:', hint: 'Politely note you are awaiting a response.', kind: 'hint' },

  // ── Requests & asks ─────────────────────────────────────────────────────
  { key: 'request', category: 'request', subjectPrefix: 'Request:', hint: 'Make a clear, single ask up front.', kind: 'hint' },
  { key: 'quick-question', category: 'request', subjectPrefix: 'Quick question:', hint: 'One small, easy-to-answer question.', kind: 'hint' },
  { key: 'favor', category: 'request', subjectPrefix: 'Quick favor:', hint: 'Ask a small favor; make it easy to say yes.', kind: 'hint' },
  { key: 'input-needed', category: 'request', subjectPrefix: 'Input needed:', hint: 'Ask for an opinion or specific data point.', kind: 'hint' },
  { key: 'action-required', category: 'request', subjectPrefix: 'Action required:', hint: 'Recipient must do something; state the action + deadline.', kind: 'hint' },
  { key: 'approval-request', category: 'request', subjectPrefix: 'Approval needed:', hint: 'Ask for sign-off; set an implicit deadline tone.', kind: 'hint' },
  { key: 'feedback-request', category: 'request', subjectPrefix: 'Feedback requested:', hint: 'Ask for feedback; specify what and by when.', kind: 'hint' },
  { key: 'review-request', category: 'request', subjectPrefix: 'Review requested:', hint: 'Ask to review a doc/PR; link it and note scope.', kind: 'hint' },
  { key: 'info-request', category: 'request', subjectPrefix: 'Information requested:', hint: 'Ask for specific information; list exactly what.', kind: 'hint' },
  { key: 'access-request', category: 'request', subjectPrefix: 'Access request:', hint: 'Request access/permissions; state resource + reason.', kind: 'hint' },
  { key: 'clarification', category: 'request', subjectPrefix: 'Clarification needed:', hint: 'Ask to clarify a specific point.', kind: 'hint' },
  { key: 'estimate-request', category: 'request', subjectPrefix: 'Estimate requested:', hint: 'Ask for an estimate/quote; give scope.', kind: 'hint' },
  { key: 'availability', category: 'request', subjectPrefix: 'Availability?', hint: 'Ask for free times; propose a couple of options.', kind: 'hint' },
  { key: 'rsvp', category: 'request', subjectPrefix: 'RSVP:', hint: 'Ask the recipient to confirm attendance by a date.', kind: 'hint' },

  // ── Meetings & scheduling ───────────────────────────────────────────────
  { key: 'meeting-request', category: 'meetings', subjectPrefix: 'Meeting request:', hint: 'Propose a time/call; give purpose and 2-3 slots.', kind: 'hint' },
  { key: 'meeting-invite', category: 'meetings', subjectPrefix: 'Invitation:', hint: 'Formal invite with time, place/link, and agenda.', kind: 'hint' },
  { key: 'reschedule', category: 'meetings', subjectPrefix: 'Reschedule:', hint: 'Move a meeting; apologize briefly, propose new times.', kind: 'hint' },
  { key: 'cancel-meeting', category: 'meetings', subjectPrefix: 'Meeting cancelled:', hint: 'Cancel clearly; offer to reschedule if relevant.', kind: 'hint' },
  { key: 'confirm-meeting', category: 'meetings', subjectPrefix: 'Confirmed:', hint: 'Confirm a meeting; restate time, place/link.', kind: 'hint' },
  { key: 'agenda', category: 'meetings', subjectPrefix: 'Agenda:', hint: 'Share an agenda as ordered bullets with owners/times.', kind: 'hint' },
  { key: 'meeting-recap', category: 'meetings', subjectPrefix: 'Meeting recap:', hint: 'Summary + decisions + action items with owners.', kind: 'hint' },
  { key: 'calendar-hold', category: 'meetings', subjectPrefix: 'Hold the date:', hint: 'Tentative hold; note details to follow.', kind: 'hint' },
  { key: 'call-request', category: 'meetings', subjectPrefix: 'Call request:', hint: 'Request a phone call; give reason and windows.', kind: 'hint' },
  { key: 'sync', category: 'meetings', subjectPrefix: 'Quick sync:', hint: 'Propose a short sync; state the one topic.', kind: 'hint' },

  // ── Status & reporting ──────────────────────────────────────────────────
  { key: 'status-update', category: 'reporting', subjectPrefix: 'Status update:', hint: 'Progress framing: done / in-progress / next / blockers.', kind: 'hint' },
  { key: 'daily-update', category: 'reporting', subjectPrefix: 'Daily update:', hint: 'Concise daily summary of progress.', kind: 'hint' },
  { key: 'weekly-update', category: 'reporting', subjectPrefix: 'Weekly update:', hint: 'Weekly highlights, metrics, and next week focus.', kind: 'hint' },
  { key: 'eod-report', category: 'reporting', subjectPrefix: 'EOD report:', hint: 'End-of-day: what shipped, what is pending, blockers.', kind: 'hint' },
  { key: 'progress-report', category: 'reporting', subjectPrefix: 'Progress report:', hint: 'Milestone progress against plan; % and dates.', kind: 'hint' },
  { key: 'blocker', category: 'reporting', subjectPrefix: 'Blocker:', hint: 'Flag a blocker; what, impact, what you need to unblock.', kind: 'hint' },
  { key: 'risk-alert', category: 'reporting', subjectPrefix: 'Risk:', hint: 'Flag a risk; likelihood, impact, mitigation.', kind: 'hint' },
  { key: 'milestone', category: 'reporting', subjectPrefix: 'Milestone reached:', hint: 'Celebrate a milestone; what and what is next.', kind: 'hint' },
  { key: 'kickoff', category: 'reporting', subjectPrefix: 'Project kickoff:', hint: 'Start a project: goals, scope, roles, timeline.', kind: 'hint' },
  { key: 'wrap-up', category: 'reporting', subjectPrefix: 'Project wrap-up:', hint: 'Close a project: outcomes, learnings, thanks.', kind: 'hint' },
  { key: 'handover', category: 'reporting', subjectPrefix: 'Handover:', hint: 'Transfer ownership: state, access, open items, contacts.', kind: 'hint' },

  // ── Decisions & approvals ───────────────────────────────────────────────
  { key: 'decision', category: 'decisions', subjectPrefix: 'Decision:', hint: 'Communicate a decision and the reasoning briefly.', kind: 'hint' },
  { key: 'decision-needed', category: 'decisions', subjectPrefix: 'Decision needed:', hint: 'Ask for a decision; present options + recommendation.', kind: 'hint' },
  { key: 'sign-off', category: 'decisions', subjectPrefix: 'Sign-off requested:', hint: 'Ask for final sign-off; what exactly is being approved.', kind: 'hint' },
  { key: 'approved', category: 'decisions', subjectPrefix: 'Approved:', hint: 'Grant approval; note any conditions.', kind: 'hint' },
  { key: 'not-approved', category: 'decisions', subjectPrefix: 'Not approved:', hint: 'Decline with a clear, respectful reason.', kind: 'hint' },
  { key: 'go-ahead', category: 'decisions', subjectPrefix: 'Go-ahead:', hint: 'Greenlight; state scope and any constraints.', kind: 'hint' },
  { key: 'on-hold', category: 'decisions', subjectPrefix: 'On hold:', hint: 'Pause something; why, and when to revisit.', kind: 'hint' },

  // ── Introductions & networking ──────────────────────────────────────────
  { key: 'intro', category: 'networking', subjectPrefix: 'Introduction:', hint: 'Introduce two people; who, why, and a suggested next step.', kind: 'hint' },
  { key: 'self-intro', category: 'networking', subjectPrefix: 'Introduction:', hint: 'Introduce yourself: who you are, why reaching out, the ask.', kind: 'hint' },
  { key: 'reconnect', category: 'networking', subjectPrefix: 'Reconnecting:', hint: 'Reconnect with a contact; recall the prior connection.', kind: 'hint' },
  { key: 'warm-intro', category: 'networking', subjectPrefix: 'Intro:', hint: 'Warm introduction with shared context.', kind: 'hint' },
  { key: 'referral', category: 'networking', subjectPrefix: 'Referral:', hint: 'Refer someone; who and why they are a good fit.', kind: 'hint' },
  { key: 'nice-to-connect', category: 'networking', subjectPrefix: 'Nice to connect:', hint: 'Post-event follow-up; recall where you met.', kind: 'hint' },

  // ── Gratitude & recognition ─────────────────────────────────────────────
  { key: 'thank-you', category: 'gratitude', subjectPrefix: '', hint: 'Warm, specific acknowledgment framing — no subject prefix.', kind: 'hint' },
  { key: 'thanks-quick', category: 'gratitude', subjectPrefix: 'Thanks!', hint: 'Very short thanks.', kind: 'hint' },
  { key: 'appreciation', category: 'gratitude', subjectPrefix: 'Appreciation:', hint: 'Recognize specific effort/impact sincerely.', kind: 'hint' },
  { key: 'congrats', category: 'gratitude', subjectPrefix: 'Congratulations!', hint: 'Congratulate warmly and specifically.', kind: 'hint' },
  { key: 'kudos', category: 'gratitude', subjectPrefix: 'Kudos:', hint: 'Public-style praise to a person/team.', kind: 'hint' },
  { key: 'welcome', category: 'gratitude', subjectPrefix: 'Welcome!', hint: 'Welcome someone warmly; next steps if any.', kind: 'hint' },

  // ── Apologies & corrections ─────────────────────────────────────────────
  { key: 'apology', category: 'apologies', subjectPrefix: 'Apologies:', hint: 'Own it, be brief, state the fix or next step.', kind: 'hint' },
  { key: 'correction', category: 'apologies', subjectPrefix: 'Correction:', hint: 'Correct prior info clearly; state old vs new.', kind: 'hint' },
  { key: 'delay-apology', category: 'apologies', subjectPrefix: 'Apologies for the delay:', hint: 'Apologize for a late reply/deliverable; give new timing.', kind: 'hint' },
  { key: 'oversight', category: 'apologies', subjectPrefix: 'Apologies — oversight:', hint: 'Own a miss briefly and state the remedy.', kind: 'hint' },
  { key: 'retraction', category: 'apologies', subjectPrefix: 'Please disregard:', hint: 'Retract a prior email; say what to ignore and why.', kind: 'hint' },

  // ── Announcements ───────────────────────────────────────────────────────
  { key: 'announcement', category: 'announcements', subjectPrefix: 'Announcement:', hint: 'Lead with the news; then who it affects and next steps.', kind: 'hint' },
  { key: 'launch', category: 'announcements', subjectPrefix: 'Launching:', hint: 'Announce a launch; what, why it matters, how to try.', kind: 'hint' },
  { key: 'release', category: 'announcements', subjectPrefix: 'Release:', hint: 'Release notes: highlights, changes, upgrade steps.', kind: 'hint' },
  { key: 'policy-update', category: 'announcements', subjectPrefix: 'Policy update:', hint: 'State the policy change, effective date, action needed.', kind: 'hint' },
  { key: 'maintenance', category: 'announcements', subjectPrefix: 'Scheduled maintenance:', hint: 'Planned downtime: window, impact, what to expect.', kind: 'hint' },
  { key: 'outage', category: 'announcements', subjectPrefix: 'Service update:', hint: 'Incident/outage: status, impact, ETA, next update.', kind: 'hint' },
  { key: 'org-change', category: 'announcements', subjectPrefix: 'Organizational update:', hint: 'Reorg/role change; what changes and effective when.', kind: 'hint' },
  { key: 'new-hire', category: 'announcements', subjectPrefix: 'Please welcome:', hint: 'Introduce a new team member: role, background, welcome.', kind: 'hint' },

  // ── Sales & outreach ────────────────────────────────────────────────────
  { key: 'outreach', category: 'sales', subjectPrefix: '', hint: 'Cold outreach: lead with value/relevance, short, one ask.', kind: 'hint' },
  { key: 'proposal', category: 'sales', subjectPrefix: 'Proposal:', hint: 'Send a proposal; summarize scope, value, next step.', kind: 'hint' },
  { key: 'quote', category: 'sales', subjectPrefix: 'Quote:', hint: 'Pricing quote; itemize and note validity.', kind: 'hint' },
  { key: 'offer', category: 'sales', subjectPrefix: 'Offer:', hint: 'Special offer; what, savings, deadline.', kind: 'hint' },
  { key: 'demo-invite', category: 'sales', subjectPrefix: 'Demo invitation:', hint: 'Offer a demo; value + a couple of time options.', kind: 'hint' },
  { key: 'case-study', category: 'sales', subjectPrefix: 'Case study:', hint: 'Share proof; the result and relevance to them.', kind: 'hint' },
  { key: 'pricing', category: 'sales', subjectPrefix: 'Pricing:', hint: 'Share pricing details clearly.', kind: 'hint' },

  // ── Support & customer ──────────────────────────────────────────────────
  { key: 'support-reply', category: 'support', subjectPrefix: 'Re:', hint: 'Support response; acknowledge, answer, next step.', kind: 'hint' },
  { key: 'resolved', category: 'support', subjectPrefix: 'Resolved:', hint: 'Confirm an issue is resolved; what was done.', kind: 'hint' },
  { key: 'workaround', category: 'support', subjectPrefix: 'Workaround:', hint: 'Give an interim fix and note the real fix timing.', kind: 'hint' },
  { key: 'escalation', category: 'support', subjectPrefix: 'Escalation:', hint: 'Escalate an issue; severity, impact, what you need.', kind: 'hint' },
  { key: 'csat', category: 'support', subjectPrefix: 'How did we do?', hint: 'Ask for satisfaction feedback; make it one click.', kind: 'hint' },
  { key: 'renewal', category: 'support', subjectPrefix: 'Renewal:', hint: 'Renewal notice; date, terms, action needed.', kind: 'hint' },
  { key: 'win-back', category: 'support', subjectPrefix: "We'd love you back:", hint: 'Re-engage a churned user; acknowledge + incentive.', kind: 'hint' },

  // ── People / HR / recruiting ────────────────────────────────────────────
  { key: 'job-offer', category: 'people', subjectPrefix: 'Offer of employment:', hint: 'Formal offer; role, comp summary, next steps.', kind: 'hint' },
  { key: 'interview-invite', category: 'people', subjectPrefix: 'Interview invitation:', hint: 'Invite to interview; format, who, time options.', kind: 'hint' },
  { key: 'application-received', category: 'people', subjectPrefix: 'Application received:', hint: 'Acknowledge an application; timeline for next steps.', kind: 'hint' },
  { key: 'candidate-update', category: 'people', subjectPrefix: 'Update on your application:', hint: 'Decision to a candidate; kind and clear.', kind: 'hint' },
  { key: 'reference-request', category: 'people', subjectPrefix: 'Reference request:', hint: 'Ask for a reference; who, role, what to speak to.', kind: 'hint' },
  { key: 'pto-request', category: 'people', subjectPrefix: 'Time-off request:', hint: 'Request leave; dates and coverage plan.', kind: 'hint' },
  { key: 'pto-approved', category: 'people', subjectPrefix: 'Time off approved:', hint: 'Approve leave; confirm dates.', kind: 'hint' },
  { key: 'onboarding', category: 'people', subjectPrefix: 'Welcome aboard:', hint: 'Onboarding info; first-day logistics and links.', kind: 'hint' },
  { key: 'offboarding', category: 'people', subjectPrefix: 'Offboarding:', hint: 'Exit process; steps, timeline, handover.', kind: 'hint' },

  // ── Finance / legal ─────────────────────────────────────────────────────
  { key: 'invoice', category: 'finance', subjectPrefix: 'Invoice:', hint: 'Send an invoice; amount, due date, payment info.', kind: 'hint' },
  { key: 'payment-reminder', category: 'finance', subjectPrefix: 'Payment reminder:', hint: 'Overdue nudge; amount, due date, how to pay.', kind: 'hint' },
  { key: 'receipt', category: 'finance', subjectPrefix: 'Receipt:', hint: 'Payment confirmation; amount, date, reference.', kind: 'hint' },
  { key: 'payment-received', category: 'finance', subjectPrefix: 'Payment received:', hint: 'Confirm payment and thank.', kind: 'hint' },
  { key: 'contract', category: 'finance', subjectPrefix: 'Contract:', hint: 'Send a contract; note key terms and signature step.', kind: 'hint' },
  { key: 'nda', category: 'finance', subjectPrefix: 'NDA:', hint: 'Send an NDA; brief purpose and signature ask.', kind: 'hint' },
  { key: 'legal-notice', category: 'finance', subjectPrefix: 'Legal notice:', hint: 'Formal legal notice; precise, no fluff.', kind: 'hint' },
  { key: 'expense', category: 'finance', subjectPrefix: 'Expense report:', hint: 'Submit expenses; total, period, attachments.', kind: 'hint' },

  // ── Urgency & escalation ────────────────────────────────────────────────
  { key: 'urgent', category: 'urgency', subjectPrefix: 'URGENT:', hint: 'Time-critical; lead with the ask and deadline.', kind: 'hint' },
  { key: 'time-sensitive', category: 'urgency', subjectPrefix: 'Time-sensitive:', hint: 'Deadline soon; state it up front.', kind: 'hint' },
  { key: 'deadline', category: 'urgency', subjectPrefix: 'Need by:', hint: 'Hard-deadline ask; date and what is needed.', kind: 'hint' },
  { key: 'incident', category: 'urgency', subjectPrefix: 'Incident:', hint: 'Active incident; impact, status, next update time.', kind: 'hint' },

  // ── Developer / engineering ─────────────────────────────────────────────
  { key: 'pr-review', category: 'engineering', subjectPrefix: 'PR review:', hint: 'Ask to review a PR; link, scope, what to focus on.', kind: 'hint' },
  { key: 'bug-report', category: 'engineering', subjectPrefix: 'Bug:', hint: 'Report a bug: steps, expected vs actual, severity.', kind: 'hint' },
  { key: 'hotfix', category: 'engineering', subjectPrefix: 'Hotfix:', hint: 'Urgent fix shipped; what it fixes, impact.', kind: 'hint' },
  { key: 'deploy-notice', category: 'engineering', subjectPrefix: 'Deployed:', hint: 'Deployment note; version, changes, rollback plan.', kind: 'hint' },
  { key: 'rollback', category: 'engineering', subjectPrefix: 'Rollback:', hint: 'Reverted a change; why and current state.', kind: 'hint' },
  { key: 'code-freeze', category: 'engineering', subjectPrefix: 'Code freeze:', hint: 'Announce a freeze window and what is allowed.', kind: 'hint' },
  { key: 'postmortem', category: 'engineering', subjectPrefix: 'Postmortem:', hint: 'Incident write-up: timeline, root cause, actions.', kind: 'hint' },
  { key: 'api-change', category: 'engineering', subjectPrefix: 'API change:', hint: 'Breaking/API change; what, when, migration.', kind: 'hint' },
  { key: 'dependency-update', category: 'engineering', subjectPrefix: 'Dependency update:', hint: 'Bump/security patch; what changed, action needed.', kind: 'hint' },
  { key: 'access-granted', category: 'engineering', subjectPrefix: 'Access granted:', hint: 'Confirm access; scope and any caveats.', kind: 'hint' },

  // ── Events ──────────────────────────────────────────────────────────────
  { key: 'event-invite', category: 'events', subjectPrefix: "You're invited:", hint: 'Event invite; what, when, where, RSVP.', kind: 'hint' },
  { key: 'webinar', category: 'events', subjectPrefix: 'Webinar:', hint: 'Webinar invite; topic, time, register link.', kind: 'hint' },
  { key: 'save-the-date', category: 'events', subjectPrefix: 'Save the date:', hint: 'Teaser; date and that details follow.', kind: 'hint' },
  { key: 'event-reminder', category: 'events', subjectPrefix: 'Reminder:', hint: 'Event nudge; time, place/link, what to bring.', kind: 'hint' },
  { key: 'post-event', category: 'events', subjectPrefix: 'Thanks for attending:', hint: 'Post-event follow-up; recap, resources, next step.', kind: 'hint' },
  { key: 'speaker-request', category: 'events', subjectPrefix: 'Speaking invitation:', hint: 'Invite to speak; topic, audience, date, logistics.', kind: 'hint' },
  { key: 'ticket-confirm', category: 'events', subjectPrefix: 'Your ticket:', hint: 'Registration confirmation; details and access.', kind: 'hint' },

  // ── Orders / e-commerce ─────────────────────────────────────────────────
  { key: 'order-confirmation', category: 'orders', subjectPrefix: 'Order confirmed:', hint: 'Confirm an order; items, total, next step.', kind: 'hint' },
  { key: 'shipped', category: 'orders', subjectPrefix: 'Shipped:', hint: 'Shipment dispatched; tracking and ETA.', kind: 'hint' },
  { key: 'out-for-delivery', category: 'orders', subjectPrefix: 'Out for delivery:', hint: 'En route today; window if known.', kind: 'hint' },
  { key: 'delivered', category: 'orders', subjectPrefix: 'Delivered:', hint: 'Delivery confirmation; support if issues.', kind: 'hint' },
  { key: 'return-request', category: 'orders', subjectPrefix: 'Return request:', hint: 'Initiate a return; reason and item.', kind: 'hint' },
  { key: 'refund', category: 'orders', subjectPrefix: 'Refund:', hint: 'Refund processed; amount and timing.', kind: 'hint' },
  { key: 'back-in-stock', category: 'orders', subjectPrefix: 'Back in stock:', hint: 'Restock alert; item and link.', kind: 'hint' },
  { key: 'abandoned-cart', category: 'orders', subjectPrefix: 'Still thinking it over?', hint: 'Cart nudge; friendly, one clear CTA.', kind: 'hint' },

  // ── Partnerships & PR ───────────────────────────────────────────────────
  { key: 'partnership', category: 'partnerships', subjectPrefix: 'Partnership:', hint: 'Partnership proposal; mutual value, next step.', kind: 'hint' },
  { key: 'collaboration', category: 'partnerships', subjectPrefix: 'Collaboration:', hint: 'Propose a collaboration; idea and why fit.', kind: 'hint' },
  { key: 'sponsorship', category: 'partnerships', subjectPrefix: 'Sponsorship:', hint: 'Sponsor ask/offer; audience, tiers, ask.', kind: 'hint' },
  { key: 'co-marketing', category: 'partnerships', subjectPrefix: 'Co-marketing:', hint: 'Joint marketing idea; reach and split.', kind: 'hint' },
  { key: 'press-release', category: 'partnerships', subjectPrefix: 'Press release:', hint: 'PR announcement; headline, quote, boilerplate.', kind: 'hint' },
  { key: 'media-inquiry', category: 'partnerships', subjectPrefix: 'Media inquiry:', hint: 'Press question; who, outlet, deadline.', kind: 'hint' },
  { key: 'interview-request', category: 'partnerships', subjectPrefix: 'Interview request:', hint: 'Request an interview; topic, format, timing.', kind: 'hint' },
  { key: 'embargo', category: 'partnerships', subjectPrefix: 'Under embargo:', hint: 'Embargoed news; state the lift time clearly.', kind: 'hint' },

  // ── Community / feedback / newsletter ────────────────────────────────────
  { key: 'newsletter', category: 'community', subjectPrefix: '', hint: 'Periodic newsletter; scannable sections, one CTA.', kind: 'hint' },
  { key: 'digest', category: 'community', subjectPrefix: 'Weekly digest:', hint: 'Curated digest; short items with links.', kind: 'hint' },
  { key: 'roundup', category: 'community', subjectPrefix: 'Roundup:', hint: 'Highlights roundup; grouped bullets.', kind: 'hint' },
  { key: 'survey', category: 'community', subjectPrefix: 'Quick survey:', hint: 'Ask to fill a survey; length and why it helps.', kind: 'hint' },
  { key: 'nps', category: 'community', subjectPrefix: 'How likely are you to recommend us?', hint: 'NPS ask; one question, one click.', kind: 'hint' },
  { key: 'testimonial-request', category: 'community', subjectPrefix: 'Would you share a review?', hint: 'Request a testimonial; make it easy.', kind: 'hint' },
  { key: 'feature-suggestion-ack', category: 'community', subjectPrefix: 'Thanks for the suggestion:', hint: 'Acknowledge an idea; status/next step.', kind: 'hint' },
  { key: 'beta-invite', category: 'community', subjectPrefix: "You're in the beta:", hint: 'Beta access; how to start, how to give feedback.', kind: 'hint' },
  { key: 'feedback-summary', category: 'community', subjectPrefix: 'What we heard:', hint: 'Summarize feedback and what you will do.', kind: 'hint' },

  // ── Personal / social ───────────────────────────────────────────────────
  { key: 'birthday', category: 'personal', subjectPrefix: 'Happy birthday!', hint: 'Warm birthday wishes; personal touch.', kind: 'hint' },
  { key: 'condolences', category: 'personal', subjectPrefix: 'With sympathy:', hint: 'Sincere condolences; brief and warm.', kind: 'hint' },
  { key: 'get-well', category: 'personal', subjectPrefix: 'Get well soon:', hint: 'Well-wishes; warm and light.', kind: 'hint' },
  { key: 'catch-up', category: 'personal', subjectPrefix: "Let's catch up:", hint: 'Reconnect socially; suggest a time.', kind: 'hint' },
  { key: 'personal-invite', category: 'personal', subjectPrefix: "You're invited:", hint: 'Personal event invite; warm, details, RSVP.', kind: 'hint' },
  { key: 'congrats-personal', category: 'personal', subjectPrefix: 'Congratulations!', hint: 'Personal milestone congrats; heartfelt.', kind: 'hint' },
  { key: 'happy-holidays', category: 'personal', subjectPrefix: "Season's greetings:", hint: 'Holiday greeting; warm and inclusive.', kind: 'hint' },
  { key: 'farewell', category: 'personal', subjectPrefix: 'Farewell:', hint: 'Goodbye note; gratitude and staying in touch.', kind: 'hint' },

  // ── Scheduling / deadlines / compliance ─────────────────────────────────
  { key: 'deadline-reminder', category: 'compliance', subjectPrefix: 'Deadline reminder:', hint: 'Upcoming due date; what and when.', kind: 'hint' },
  { key: 'deadline-extension', category: 'compliance', subjectPrefix: 'Deadline extended:', hint: 'Grant more time; new date and why.', kind: 'hint' },
  { key: 'terms-update', category: 'compliance', subjectPrefix: 'Terms update:', hint: 'ToS/agreement change; what, effective date, action.', kind: 'hint' },
  { key: 'compliance-notice', category: 'compliance', subjectPrefix: 'Compliance notice:', hint: 'Compliance/regulatory item; precise and actionable.', kind: 'hint' },
  { key: 'data-request', category: 'compliance', subjectPrefix: 'Data request:', hint: 'GDPR/DSAR handling; scope and timeline.', kind: 'hint' },
  { key: 'renewal-reminder', category: 'compliance', subjectPrefix: 'Renewal reminder:', hint: 'Upcoming renewal; date and action.', kind: 'hint' },
  { key: 'final-notice', category: 'compliance', subjectPrefix: 'Final notice:', hint: 'Last escalation step; consequence and how to resolve.', kind: 'hint' },

  // ── Mechanical (mailman builds the format) ──────────────────────────────
  { key: 'fwd', category: 'mechanical', subjectPrefix: 'Fwd:', hint: 'Forwards a message with a quoted block. Pass forwardedFrom/forwardedDate/forwardedSubject/forwardedTo/forwardedBody.', kind: 'mechanical' },
  { key: 'reply', category: 'mechanical', subjectPrefix: 'Re:', hint: 'Reply framing; quotes the prior message under your composition (pass forwardedBody as the quoted text).', kind: 'mechanical' },
  { key: 'reply-all', category: 'mechanical', subjectPrefix: 'Re:', hint: 'Reply-all framing; same as reply, addressed to all recipients.', kind: 'mechanical' },
  { key: 'quote-inline', category: 'mechanical', subjectPrefix: 'Re:', hint: 'Inline-quoted reply; interleave responses with quoted lines.', kind: 'mechanical' },
];

const BY_KEY = new Map(TEMPLATES.map((t) => [t.key, t]));

export function getTemplate(key: string): EmailTemplate | undefined {
  return BY_KEY.get(key.trim().toLowerCase());
}

export function listCategories(): string[] {
  return [...new Set(TEMPLATES.map((t) => t.category))];
}

/** List templates, optionally filtered by category and/or a free-text search. */
export function listTemplates(opts: { category?: string; search?: string } = {}): EmailTemplate[] {
  const category = opts.category?.trim().toLowerCase();
  const search = opts.search?.trim().toLowerCase();
  return TEMPLATES.filter((t) => {
    if (category && t.category !== category) return false;
    if (search) {
      const hay = `${t.key} ${t.category} ${t.subjectPrefix} ${t.hint}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

/**
 * Prefix a subject with the template prefix, avoiding duplication (so
 * "Re: Re:" or "FYI: FYI:" never happen) and handling the empty-prefix case.
 * This is a real subject *improvement*: consistent, de-duplicated framing.
 */
export function applySubjectPrefix(prefix: string, subject: string): string {
  const s = (subject ?? '').trim();
  if (!prefix) return s;
  if (!s) return prefix;
  if (s.toLowerCase().startsWith(prefix.toLowerCase())) return s;
  return `${prefix} ${s}`;
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface ForwardedFields {
  forwardedFrom?: string;
  forwardedDate?: string;
  forwardedSubject?: string;
  forwardedTo?: string;
  forwardedBody?: string;
}

/**
 * Build the standard "---------- Forwarded message ---------" block (matching
 * Gmail/Outlook) and append it under the composed body. Real mechanical format,
 * not free-form prose.
 */
export function buildForwardedBody(
  composedBody: string,
  fwd: ForwardedFields,
  bodyType: 'text' | 'html',
): string {
  const header: string[] = ['---------- Forwarded message ---------'];
  if (fwd.forwardedFrom) header.push(`From: ${fwd.forwardedFrom}`);
  if (fwd.forwardedDate) header.push(`Date: ${fwd.forwardedDate}`);
  if (fwd.forwardedSubject) header.push(`Subject: ${fwd.forwardedSubject}`);
  if (fwd.forwardedTo) header.push(`To: ${fwd.forwardedTo}`);
  const quoted = fwd.forwardedBody ?? '';

  if (bodyType === 'html') {
    const headerHtml = header.map(escapeHtml).join('<br>');
    return `${composedBody}<br><br><div style="border-left:3px solid #e2e8f0;padding-left:12px;color:#475569">${headerHtml}<br><br>${quoted}</div>`;
  }
  return `${composedBody}\n\n${header.join('\n')}\n\n${quoted}`;
}
