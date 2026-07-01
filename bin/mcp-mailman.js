#!/usr/bin/env node
const args = process.argv.slice(2);

// No CLI subcommand/flag → this is the MCP host launching the stdio
// server (e.g. `claude mcp add mailman -- npx -y mcp-mailman`). Anything
// else is a human running a terminal command — see docs/CLI.md.
if (args.length === 0) {
  await import('../dist/index.js');
} else {
  const { runCli } = await import('../dist/cli/main.js');
  await runCli(args);
}
