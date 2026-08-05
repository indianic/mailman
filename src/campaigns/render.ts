import { escapeHtml } from '../mail/compose.js';

/**
 * `{{name}}`, `{{first_name|there}}`, `{{email}}`. Deliberately narrow: a token
 * is a bare identifier plus an optional literal fallback after `|`. No
 * expressions, no nesting, no filters — a merge field in an email is not a
 * place to grow a template language, and every feature added here is one more
 * way to be surprised by what 39 people actually received.
 *
 * Built per call rather than shared: a /g regex carries `lastIndex` between
 * uses, and a module-level one would make the second render of the same
 * template start halfway through it.
 */
function tokenPattern(): RegExp {
  return /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\|\s*([^}]*?))?\s*\}\}/g;
}

export interface RenderedTemplate {
  text: string;
  /** Tokens that had no value AND no fallback — the refuse-to-draft trigger. */
  unresolved: string[];
  /** Tokens that fell back to their literal, e.g. "Hi there," instead of a name. */
  fallbacks: string[];
}

/**
 * Substitute one recipient's vars into a template.
 *
 * Values are HTML-escaped for an HTML body. This is not decoration: an
 * address book contains `Sales & Marketing` and `O'Brien`, and a name carried
 * verbatim into HTML is at best mangled and at worst markup the recipient's
 * client executes. The literal fallback is escaped on the same footing —
 * whoever writes `{{name|the team}}` is writing text, not tags.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
  bodyType: 'text' | 'html',
): RenderedTemplate {
  const unresolved: string[] = [];
  const fallbacks: string[] = [];
  const escape = (value: string) => (bodyType === 'html' ? escapeHtml(value) : value);

  const text = template.replace(tokenPattern(), (whole, token: string, fallback: string | undefined) => {
    const value = vars[token];
    if (value !== undefined && value !== '') {
      return escape(value);
    }
    if (fallback !== undefined) {
      fallbacks.push(token);
      return escape(fallback);
    }
    unresolved.push(token);
    return whole; // left intact so a caller that ignores `unresolved` still shows the gap
  });

  return { text, unresolved, fallbacks };
}

/** Every token a template references, in order, de-duplicated. */
export function listTokens(template: string): string[] {
  const seen = new Set<string>();
  for (const match of template.matchAll(tokenPattern())) {
    seen.add(match[1]);
  }
  return [...seen];
}

export const BUILT_IN_TOKENS = ['name', 'first_name', 'email'] as const;

/**
 * The render inputs for one recipient, frozen at draft time.
 *
 * `name` is only populated when there is a real one — an empty or whitespace
 * contact name resolves to *absent*, not to `''`. That distinction is the
 * whole point: absent trips the unresolved check and refuses to draft, whereas
 * an empty string would sail through and send "Hi ,".
 */
export function deriveVars(
  email: string,
  contactName: string | undefined,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const vars: Record<string, string> = { email };

  const name = (overrides.name ?? contactName ?? '').trim();
  if (name) vars.name = name;

  const firstName = (overrides.first_name ?? name.split(/\s+/)[0] ?? '').trim();
  if (firstName) vars.first_name = firstName;

  // Caller-supplied vars win outright, including any custom token the
  // template invented ({{company}}, {{renewal_date}}).
  for (const [key, value] of Object.entries(overrides)) {
    if (value.trim()) vars[key] = value;
  }

  return vars;
}

export interface RecipientPlan {
  seq: number;
  email: string;
  vars: Record<string, string>;
  subject: string;
  /** Rendered from the caller's raw body — preview text, not the wire body. */
  bodyPreview: string;
  unresolved: string[];
  fallbacks: string[];
}

/** True when the recipient's greeting came from a fallback or a one-word name. */
export function isAwkwardName(plan: RecipientPlan): boolean {
  return plan.fallbacks.length > 0 || !plan.vars.name || !plan.vars.name.includes(' ');
}

/**
 * Pick the two or three renderings a human should actually look at.
 *
 * Not the first two alphabetically. A reviewer approving 39 sends needs to see
 * the *ugly* case — the one-word name, the fallback greeting — because that is
 * the one that embarrasses them. Showing two flattering samples and hiding the
 * awkward one is how "Hi ," reaches an inbox with a signed-off preview behind it.
 */
export function selectSamples(plans: RecipientPlan[], limit = 3): RecipientPlan[] {
  if (plans.length === 0) return [];

  const chosen: RecipientPlan[] = [];
  const take = (plan: RecipientPlan | undefined) => {
    if (plan && !chosen.some((c) => c.seq === plan.seq)) chosen.push(plan);
  };

  take(plans.find((p) => !isAwkwardName(p)));
  take(plans.find((p) => p.fallbacks.length > 0));
  take(plans.find((p) => isAwkwardName(p)));
  take(plans[0]);
  take(plans[plans.length - 1]);

  return chosen.slice(0, limit).sort((a, b) => a.seq - b.seq);
}

/** "~2 min" / "~45 sec" — how long the throttle will take to work through the list. */
export function estimateDuration(total: number, throttlePerMinute: number): string {
  if (total <= 1) return '~instant';
  const seconds = Math.round(((total - 1) * 60) / throttlePerMinute);
  if (seconds < 90) return `~${seconds} sec`;
  return `~${Math.max(1, Math.round(seconds / 60))} min`;
}
