import crypto from 'node:crypto';
import { getScheduledPath } from '../config/paths.js';
import { readJsonFile, updateJsonFile } from '../config/store.js';
import {
  ScheduledFileSchema,
  DEFAULT_SCHEDULED_FILE,
  type ScheduledEntry,
  type ScheduledMessageContent,
} from '../config/schema.js';
import { encrypt, decrypt } from '../config/crypto.js';
import { getOrCreateMasterKey, getMasterKeyOrThrow } from '../config/keychain.js';

export function listScheduled(): Promise<ScheduledEntry[]> {
  return readJsonFile(getScheduledPath(), ScheduledFileSchema, DEFAULT_SCHEDULED_FILE).then((f) => f.entries);
}

/** Decrypts one entry's message content — same "decrypt only when actually needed" discipline as account credentials. */
export async function decryptContent(entry: ScheduledEntry): Promise<ScheduledMessageContent> {
  const masterKey = await getMasterKeyOrThrow();
  const plaintext = decrypt(masterKey, entry.content);
  return JSON.parse(plaintext) as ScheduledMessageContent;
}

export interface CreateScheduledInput {
  account: string;
  sendAt: string;
  content: ScheduledMessageContent;
}

export async function createScheduledEntry(input: CreateScheduledInput): Promise<ScheduledEntry> {
  const masterKey = await getOrCreateMasterKey();
  const encryptedContent = encrypt(masterKey, JSON.stringify(input.content));
  const scheduledId = crypto.randomUUID();

  const file = await updateJsonFile(getScheduledPath(), ScheduledFileSchema, DEFAULT_SCHEDULED_FILE, (current) => {
    const newEntry: ScheduledEntry = {
      scheduledId,
      account: input.account,
      sendAt: input.sendAt,
      status: 'pending',
      attempts: 0,
      content: encryptedContent,
    };
    return { ...current, entries: [...current.entries, newEntry] };
  });

  return file.entries.find((e) => e.scheduledId === scheduledId)!;
}

/** Only removes a still-pending entry — cancelling something already sent/failed is a no-op (returns undefined). */
export async function cancelScheduledEntry(scheduledId: string): Promise<ScheduledEntry | undefined> {
  let cancelled: ScheduledEntry | undefined;
  await updateJsonFile(getScheduledPath(), ScheduledFileSchema, DEFAULT_SCHEDULED_FILE, (current) => {
    const target = current.entries.find((e) => e.scheduledId === scheduledId);
    if (!target || target.status !== 'pending') {
      return current;
    }
    cancelled = target;
    return { ...current, entries: current.entries.filter((e) => e.scheduledId !== scheduledId) };
  });
  return cancelled;
}

export async function updateScheduledEntry(
  scheduledId: string,
  mutate: (entry: ScheduledEntry) => ScheduledEntry,
): Promise<void> {
  await updateJsonFile(getScheduledPath(), ScheduledFileSchema, DEFAULT_SCHEDULED_FILE, (current) => ({
    ...current,
    entries: current.entries.map((e) => (e.scheduledId === scheduledId ? mutate(e) : e)),
  }));
}
