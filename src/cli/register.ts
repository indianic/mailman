/** `mcp-mailman register` — prints the copy-pasteable registration command, never runs it. */
export async function runRegister(_args: string[]): Promise<void> {
  process.stdout.write('claude mcp add mailman -- npx -y mcp-mailman\n');
}
