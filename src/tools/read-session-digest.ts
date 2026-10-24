import { z } from 'zod';
import { toolResponse, toolError } from '../response.js';
import { buildIndex, resolveSessionIds } from '../sessions/index.js';
import { extractSkeleton, renderDigest, type SessionSkeleton } from '../sessions/skeleton.js';
import type { Tool } from './types.js';

const InputSchema = z.object({
  sessionIds: z.union([z.string(), z.array(z.string()).min(1)]),
  maxTurns: z.number().int().positive().optional(),
  includeTurns: z.boolean().optional(),
});

// One call's context cost is bounded by both of these. Ten sessions of 80
// turns is already a long read; beyond that a summary should be built in
// batches rather than in one enormous call.
const MAX_SESSIONS = 10;
const MAX_TURNS_CAP = 200;

async function handler(rawArgs: Record<string, unknown>) {
  const parsed = InputSchema.safeParse(rawArgs);
  if (!parsed.success) {
    return toolError('INVALID_INPUT', parsed.error.message);
  }
  const input = parsed.data;

  const ids = (Array.isArray(input.sessionIds) ? input.sessionIds : input.sessionIds.split(','))
    .map((v) => v.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return toolError('INVALID_INPUT', 'sessionIds is empty.');
  }
  if (ids.length > MAX_SESSIONS) {
    return toolError(
      'INVALID_INPUT',
      `${ids.length} sessions requested; the cap is ${MAX_SESSIONS} per call. Digest them in batches and combine the summaries yourself.`,
    );
  }

  const index = await buildIndex();
  const { found, missing } = resolveSessionIds(index.sessions, ids);
  if (missing.length > 0) {
    return toolError('SESSION_NOT_FOUND', `No session matched: ${missing.join(', ')}. Call list_sessions for valid ids.`);
  }

  const maxTurns = input.maxTurns ? Math.min(input.maxTurns, MAX_TURNS_CAP) : undefined;
  const skeletons: SessionSkeleton[] = [];
  for (const meta of found) {
    try {
      skeletons.push(await extractSkeleton(meta, { maxTurns }));
    } catch (err) {
      return toolError('SESSION_READ_FAILED', `Could not read ${meta.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return toolResponse({
    sessions: skeletons.map((s) => ({
      id: s.meta.id,
      title: s.meta.title,
      project: s.meta.project,
      branch: s.meta.gitBranch || null,
      startedAt: s.meta.startedAt,
      endedAt: s.meta.endedAt,
      userPrompts: s.userPrompts,
      filesTouched: s.filesTouched,
      commits: s.commits,
      toolCounts: s.toolCounts,
      truncated: s.truncated,
      // Turns are the expensive half — opt in when the mechanical facts
      // above aren't enough to write a real narrative.
      ...(input.includeTurns === false ? {} : { turns: s.turns }),
    })),
    digest: renderDigest(skeletons),
    redaction: 'Tool results are dropped entirely; known secret shapes (keys, tokens, JWTs, assignments) are redacted; home paths shortened to ~.',
    next_steps: [
      'Write the summary yourself from these skeletons — this tool never summarizes.',
      'For several sessions, group by project and synthesize across them rather than concatenating per-session blurbs.',
      'Send with draft_email (template: "session-report"), show the preview, then confirm_send only after the user approves.',
      'The transcript may still contain sensitive project detail — show the full body before sending, never auto-confirm.',
    ],
  });
}

export const readSessionDigestTool: Tool = {
  definition: {
    name: 'read_session_digest',
    description:
      'Return a compact, secret-scrubbed skeleton of one or more past sessions (prompts, truncated replies, tool call targets, files touched, commits) — never the raw transcript. Ids come from list_sessions. This tool does NOT summarize; compose the summary yourself, then send it with draft_email.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionIds: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: `Session ids (full or unique prefix) from list_sessions. An array, or one comma-separated string. Max ${MAX_SESSIONS} per call.`,
        },
        maxTurns: { type: 'number', description: `Turns kept per session before the middle is dropped (default 80, capped at ${MAX_TURNS_CAP})` },
        includeTurns: { type: 'boolean', description: 'Set false for facts only (files, commits, tool counts) — much cheaper' },
      },
      required: ['sessionIds'],
      additionalProperties: false,
    },
  },
  handler,
};
