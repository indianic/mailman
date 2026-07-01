import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';

// One write queue per absolute file path — concurrent tool calls touching
// the *same* file (e.g. two configure_account calls) are serialized;
// unrelated files (accounts.json vs contacts.json) never block each
// other. See docs/PLAN.md's "Data integrity & storage" section.
const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const prior = queues.get(filePath) ?? Promise.resolve();
  const run = prior.then(task, task);
  queues.set(
    filePath,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function readRaw<T>(filePath: string, schema: z.ZodType<T>, defaultValue: T): Promise<T> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return defaultValue;
    }
    throw err;
  }

  try {
    return schema.parse(JSON.parse(raw));
  } catch (parseErr) {
    // Corrupt primary file — fall back to the pre-write backup rather
    // than crashing the whole server over one bad file.
    const bakPath = `${filePath}.bak`;
    try {
      const bakRaw = await fs.readFile(bakPath, 'utf8');
      const recovered = schema.parse(JSON.parse(bakRaw));
      process.stderr.write(`[mcp-mailman] warning: ${filePath} was corrupt, recovered from ${bakPath}\n`);
      return recovered;
    } catch {
      throw new Error(
        `${filePath} is corrupt and no valid backup exists at ${bakPath}: ${
          parseErr instanceof Error ? parseErr.message : String(parseErr)
        }`,
      );
    }
  }
}

async function writeRaw<T>(filePath: string, schema: z.ZodType<T>, value: T): Promise<void> {
  const validated = schema.parse(value);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  // Back up whatever's currently on disk before overwriting it.
  try {
    await fs.copyFile(filePath, `${filePath}.bak`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  // Atomic write: temp file in the same directory, then rename over the
  // real path — a crash mid-write leaves the old file intact, never a
  // half-written blob.
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmpPath, JSON.stringify(validated, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

export function readJsonFile<T>(filePath: string, schema: z.ZodType<T>, defaultValue: T): Promise<T> {
  return enqueue(filePath, () => readRaw(filePath, schema, defaultValue));
}

export function writeJsonFile<T>(filePath: string, schema: z.ZodType<T>, value: T): Promise<void> {
  return enqueue(filePath, () => writeRaw(filePath, schema, value));
}

/** Read-modify-write, atomic with respect to other callers of this file. */
export function updateJsonFile<T>(
  filePath: string,
  schema: z.ZodType<T>,
  defaultValue: T,
  mutator: (current: T) => T,
): Promise<T> {
  return enqueue(filePath, async () => {
    const current = await readRaw(filePath, schema, defaultValue);
    const next = schema.parse(mutator(current));
    await writeRaw(filePath, schema, next);
    return next;
  });
}
