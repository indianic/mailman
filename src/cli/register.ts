/**
 * `mcp-mailman register` — prints the copy-pasteable registration command,
 * never runs it. Deliberately exempt from the tree-output convention (see
 * docs/SKILLS.md's "Terminal output convention") — this line is meant to
 * be selected and pasted straight into a shell, and tree glyphs/indent
 * would corrupt that.
 */
export async function runRegister(_args: string[]): Promise<void> {
  process.stdout.write('claude mcp add mailman -- npx -y @indianic/mailman\n');
}
