import { intro, outro } from '@clack/prompts';
import { resolveTools, writeSelectedEditors, promptAndWriteEditorConfigs } from './register-editors.js';
import type { Scope } from './editor-config.js';

/**
 * `mcp-mailman register` — register mailman with your AI editors.
 *
 * Three modes:
 *  - `register` (bare): prints the copy-pasteable `claude mcp add …` line,
 *    unchanged from before. Kept as the zero-magic default — the line is
 *    meant to be selected and pasted, so it stays plain (no tree glyphs).
 *  - `register --tools <a,b,…|all> [--scope global|project]`: non-interactive;
 *    writes each tool's MCP config directly (same engine `init` uses).
 *  - `register --interactive` (or `-i`): the multiselect wizard.
 */
export async function runRegister(args: string[]): Promise<void> {
  const toolsIdx = args.indexOf('--tools');
  const scopeIdx = args.indexOf('--scope');
  const interactive = args.includes('--interactive') || args.includes('-i');
  const scope: Scope = scopeIdx >= 0 && args[scopeIdx + 1] === 'project' ? 'project' : 'global';

  if (toolsIdx >= 0) {
    intro('mailman — register');
    const tools = resolveTools(args[toolsIdx + 1]);
    const written = writeSelectedEditors(tools, scope);
    outro(written.length > 0 ? `Registered with ${written.length} tool(s). Restart them to load mailman.` : 'No known tools matched — nothing written.');
    return;
  }

  if (interactive) {
    intro('mailman — register');
    const written = await promptAndWriteEditorConfigs(scope);
    outro(written.length > 0 ? `Registered with ${written.length} tool(s). Restart them to load mailman.` : 'Nothing selected — no changes made.');
    return;
  }

  // Bare form — print the copy-pasteable command (plain, no tree glyphs so a paste is clean).
  process.stdout.write('claude mcp add mailman -- npx -y @indianic/mailman\n');
}
