import pc from 'picocolors';

/**
 * Shared terminal-tree vocabulary every human-facing CLI command renders
 * through, so `status`/`account list`/`help`/etc. all look like one tool.
 * See docs/SKILLS.md's "Terminal output convention" for the reference
 * design and the (narrow, functional) exemptions.
 *
 * Rows are written directly rather than through @clack/prompts' log.*
 * helpers — clack emits a spacer `│` line before EVERY message, which
 * double-spaced our lists (a real user flagged the airy output against the
 * tight ContextBrain reference). Here, consecutive rows touch; the single
 * blank connector line comes before each ◆ section header, nowhere else.
 * intro()/outro() stay clack's — they already render `┌ title` and
 * `│\n└ text` exactly right.
 */

const BAR = pc.gray('│');

/** Prefix continuation lines of a multi-line message so the tree's rail stays unbroken. */
function writeRow(glyph: string, text: string): void {
  const [first, ...rest] = text.split('\n');
  process.stdout.write(`${glyph}  ${first}\n`);
  for (const line of rest) {
    process.stdout.write(`${BAR}  ${line}\n`);
  }
}

/** Top-level section header — a blank rail line for breathing room, then a filled ◆. */
export function section(title: string): void {
  process.stdout.write(`${BAR}\n`);
  writeRow(pc.green('◆'), title);
}

/**
 * A single confirmatory fact nested under a section (e.g. "master key
 * found", like the reference design's "running (pid …)" under a "dev
 * server" section). Hollow ◇ when ok, red ■ when not. Tight — attaches
 * directly to the row above.
 */
export function check(ok: boolean, text: string): void {
  writeRow(ok ? pc.green('◇') : pc.red('■'), text);
}

/**
 * A flat, top-level pass/fail result with no wrapping section — `doctor`'s
 * checks are the whole content of that command, so each carries section
 * weight: same leading blank rail + filled ◆ (or red ■ on failure).
 */
export function result(ok: boolean, text: string): void {
  process.stdout.write(`${BAR}\n`);
  writeRow(ok ? pc.green('◆') : pc.red('■'), text);
}

/** A fact worth flagging without being a hard failure — yellow ▲, tight. */
export function attention(text: string): void {
  writeRow(pc.yellow('▲'), text);
}

/** Plain data/detail line — no icon, just the rail. Tight: consecutive details touch. */
export function detail(text: string): void {
  writeRow(BAR, text);
}
