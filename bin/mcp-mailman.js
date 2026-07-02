#!/usr/bin/env node

// Node-version guard, FIRST thing — before any `await import` of dist/, whose
// modules use `node:`-scheme imports that Node < 14.18 rejects with a cryptic
// ERR_UNSUPPORTED_ESM_URL_SCHEME crash. package.json's "engines" is advisory
// only (npm warns, doesn't enforce at runtime), so a user with an old `node`
// on their PATH would otherwise hit that stack trace on their very first
// `mailman init`. This turns it into one clear line. Keep this block free of
// any import/`node:`/top-level-await so it runs even on the oldest runtimes.
const MIN_NODE_MAJOR = 18;
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < MIN_NODE_MAJOR) {
  process.stderr.write(
    `mailman requires Node >= ${MIN_NODE_MAJOR}, but this command is running on Node ${process.versions.node}.\n` +
      `Your shell's \`node\` is too old — switch to Node ${MIN_NODE_MAJOR}+ (e.g. \`nvm use ${MIN_NODE_MAJOR}\`) and re-run.\n`,
  );
  process.exit(1);
}

// Wrapped in an async function rather than using top-level `await` so the
// version guard above still runs on Nodes old enough to reject top-level
// await at parse time — the whole point is a clean message on old runtimes.
async function main() {
  const args = process.argv.slice(2);

  // No CLI subcommand/flag → this is the MCP host launching the stdio
  // server (e.g. `claude mcp add mailman -- npx -y @indianic/mailman`).
  // Anything else is a human running a terminal command — see docs/CLI.md.
  if (args.length === 0) {
    await import('../dist/index.js');
  } else {
    const { runCli } = await import('../dist/cli/main.js');
    await runCli(args);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack || err.message : String(err)}\n`);
  process.exit(1);
});
