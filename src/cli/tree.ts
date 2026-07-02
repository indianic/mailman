import { log } from '@clack/prompts';

/**
 * Shared terminal-tree vocabulary every human-facing CLI command renders
 * through, so `status`/`account list`/`settings get`/etc. all look like one
 * tool instead of a grab-bag of console.table/JSON.stringify/plain-text
 * ad hoc output. See docs/SKILLS.md's "Terminal output convention" section
 * for the reference design and which commands are deliberately exempt
 * (machine-consumed output, raw copy-pasteable commands, --help text).
 *
 * Maps onto @clack/prompts' own log methods rather than hand-rolling
 * unicode — `log.success`/`log.step` render as a filled ◆ / hollow ◇ in
 * this installed version (verified against the actual rendered bytes, not
 * assumed from memory), which is exactly the two-tier hierarchy the
 * reference design uses: ◆ for a top-level section, ◇ for a single
 * confirmatory fact nested under one.
 */

/** Top-level section header, e.g. `section('accounts')` — renders as a filled ◆. */
export function section(title: string): void {
  log.success(title);
}

/**
 * A single confirmatory fact nested under a section (e.g. "master key
 * found", analogous to a health check's "running (pid ...)" line nested
 * under a "dev server" section in the reference design). Renders as a
 * hollow ◇ when `ok`, or a red ■ (via log.error) when not.
 */
export function check(ok: boolean, text: string): void {
  if (ok) {
    log.step(text);
  } else {
    log.error(text);
  }
}

/**
 * A flat, top-level pass/fail result with no wrapping section — `doctor`'s
 * checks are the whole content of that command, not nested under
 * anything, so they carry the same filled-◆ weight as `section()` rather
 * than `check()`'s nested hollow ◇. Renders as a filled ◆ when `ok`, or a
 * red ■ (via log.error) when not.
 */
export function result(ok: boolean, text: string): void {
  if (ok) {
    log.success(text);
  } else {
    log.error(text);
  }
}

/** A single fact worth flagging without being a hard failure — yellow ▲. */
export function attention(text: string): void {
  log.warn(text);
}

/** Plain data/detail line — no icon, just the tree's continuation bar. Use for tabular rows, counts, key: value pairs. */
export function detail(text: string): void {
  log.message(text);
}
