import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { buildIndex, filterSessions, listProjects, parseSince } from '../sessions/index.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  project: z.string().optional(),
  search: z.string().optional(),
  since: z.string().optional(),
  branch: z.string().optional(),
  limit: z.number().int().positive().optional(),
  projectsOnly: z.boolean().optional(),
  refresh: z.boolean().optional(),
});

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const input = parsed.data;

  let since: Date | undefined;
  if (input.since) {
    const resolved = parseSince(input.since);
    if (!resolved) {
      return toolError('INVALID_INPUT', `Unrecognized "since": "${input.since}". Use 24h, 7d, 2w, 3mo, or an ISO date.`);
    }
    since = resolved;
  }

  const index = await buildIndex({ refresh: input.refresh });
  if (index.sessions.length === 0) {
    return toolError(
      'SESSIONS_NOT_FOUND',
      `No session transcripts found under ${index.root}. Set MAILMAN_SESSIONS_DIR if this host stores them elsewhere.`,
    );
  }

  const matched = filterSessions(index.sessions, {
    project: input.project,
    search: input.search,
    branch: input.branch,
    since,
  });

  // The project roll-up alone is the cheap first call for "what have I been
  // working on" — it avoids returning hundreds of session rows to pick from.
  if (input.projectsOnly) {
    return toolResponse({
      total: matched.length,
      projects: listProjects(matched),
      next_steps: ['Call list_sessions again with `project` set to drill into one project.'],
    });
  }

  const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const page = matched.slice(0, limit);

  return toolResponse({
    total: matched.length,
    returned: page.length,
    ...(matched.length > page.length ? { truncated: true } : {}),
    projects: input.project ? undefined : listProjects(matched).slice(0, 10),
    sessions: page.map((s) => ({
      id: s.id,
      title: s.title,
      project: s.project,
      projectPath: s.projectPath,
      branch: s.gitBranch || null,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      messages: s.messages,
      sizeBytes: s.sizeBytes,
    })),
    next_steps: [
      'Show these to the user and let them pick one or more.',
      'Pass the chosen ids to read_session_digest, then compose the summary yourself and send it with draft_email.',
    ],
  });
}

export const listSessionsTool: Tool = {
  definition: {
    name: 'list_sessions',
    description:
      "Search this machine's past AI coding sessions by project, text, branch, or recency — the input to a session summary email. Returns metadata only (id, title, project, dates, size), never transcript content. Use projectsOnly:true first for a project roll-up, then drill in.",
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Substring of the project label or its absolute path, e.g. "mailman"' },
        search: { type: 'string', description: 'Free-text match on session title, project, and branch' },
        since: { type: 'string', description: 'Recency window: "24h", "7d", "2w", "3mo", or an ISO date' },
        branch: { type: 'string', description: 'Exact git branch the session ran on' },
        limit: { type: 'number', description: `Max sessions to return (default ${DEFAULT_LIMIT}, capped at ${MAX_LIMIT})` },
        projectsOnly: { type: 'boolean', description: 'Return only the per-project roll-up, no session rows' },
        refresh: { type: 'boolean', description: 'Force a full re-scan instead of using the cached index' },
      },
      required: [],
      additionalProperties: false,
    },
  },
  handler,
};
