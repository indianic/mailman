import { multiselect, select, isCancel, cancel } from '@clack/prompts';
import { EDITORS, resolveTools, writeEditorConfig, type Scope } from './editor-config.js';
import { section, detail, fail } from './tree.js';

/**
 * Interactive editor picker + config writer, shared by `init` and the
 * `register --tools …` CLI path. Mirrors `@indianic/contextbrain init`'s
 * "which tools?" step. Returns the ids actually written (empty if the user
 * picked none), so callers can tailor their closing message.
 */
export async function promptAndWriteEditorConfigs(defaultScope: Scope = 'global'): Promise<string[]> {
  const picked = await multiselect({
    message: 'Register mailman with which AI tools? (writes each tool\'s MCP config for you — space to select, enter to confirm)',
    options: EDITORS.map((e) => ({ value: e.id, label: e.label })),
    required: false,
  });
  if (isCancel(picked)) {
    cancel('Cancelled.');
    process.exit(1);
  }
  const tools = picked as string[];
  if (tools.length === 0) {
    return [];
  }

  // Only ask about scope if at least one picked editor actually honors it —
  // Gemini/Windsurf/Codex are user-level only, so a scope question would be noise.
  let scope: Scope = defaultScope;
  const anyScoped = tools.some((id) => !EDITORS.find((e) => e.id === id)?.userLevelOnly);
  if (anyScoped) {
    const chosen = await select({
      message: 'Config scope',
      options: [
        { value: 'global', label: 'Global — available in every project (recommended)' },
        { value: 'project', label: 'This project only — writes into the current folder' },
      ],
      initialValue: defaultScope,
    });
    if (isCancel(chosen)) {
      cancel('Cancelled.');
      process.exit(1);
    }
    scope = chosen as Scope;
  }

  return writeSelectedEditors(tools, scope);
}

/** Non-interactive core: write configs for the given editor ids at the given scope, printing a tree summary. */
export function writeSelectedEditors(toolIds: string[], scope: Scope): string[] {
  const written: string[] = [];
  section('editor config');
  for (const id of toolIds) {
    const editor = EDITORS.find((e) => e.id === id);
    if (!editor) continue;
    try {
      const result = writeEditorConfig(editor, scope);
      detail(`${result.label}: ${result.action} ${result.file}`);
      written.push(id);
    } catch (err) {
      fail(`${editor.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return written;
}

export { resolveTools };
