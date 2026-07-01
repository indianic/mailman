import { getContactsPath } from './config/paths.js';
import { readJsonFile, updateJsonFile } from './config/store.js';
import { ContactsFileSchema, DEFAULT_CONTACTS_FILE, type Contact } from './config/schema.js';

export function listContacts(): Promise<Contact[]> {
  return readJsonFile(getContactsPath(), ContactsFileSchema, DEFAULT_CONTACTS_FILE).then((f) => f.contacts);
}

function findByEmail(contacts: Contact[], email: string): Contact | undefined {
  const target = email.toLowerCase();
  return contacts.find((c) => c.email.toLowerCase() === target);
}

/**
 * Called for every recipient of a successful confirm_send — auto-builds
 * the local address book from actual usage. `source` stays whatever it
 * was when the contact was first learned about (manual vs recents);
 * useCount/lastUsedAt update regardless of source.
 */
export async function upsertRecipient(email: string, name?: string): Promise<void> {
  await updateJsonFile(getContactsPath(), ContactsFileSchema, DEFAULT_CONTACTS_FILE, (current) => {
    const now = new Date().toISOString();
    const existing = findByEmail(current.contacts, email);
    if (existing) {
      return {
        ...current,
        contacts: current.contacts.map((c) =>
          c === existing ? { ...c, name: c.name ?? name, useCount: c.useCount + 1, lastUsedAt: now } : c,
        ),
      };
    }
    const newContact: Contact = { email, name, source: 'recents', useCount: 1, lastUsedAt: now };
    return { ...current, contacts: [...current.contacts, newContact] };
  });
}

export async function addContact(email: string, name?: string): Promise<void> {
  await updateJsonFile(getContactsPath(), ContactsFileSchema, DEFAULT_CONTACTS_FILE, (current) => {
    const existing = findByEmail(current.contacts, email);
    if (existing) {
      return {
        ...current,
        contacts: current.contacts.map((c) => (c === existing ? { ...c, name: name ?? c.name } : c)),
      };
    }
    const newContact: Contact = { email, name, source: 'manual', useCount: 0, lastUsedAt: null };
    return { ...current, contacts: [...current.contacts, newContact] };
  });
}

/** Idempotent — removing an email that isn't there is a no-op, not an error. */
export async function removeContact(email: string): Promise<void> {
  await updateJsonFile(getContactsPath(), ContactsFileSchema, DEFAULT_CONTACTS_FILE, (current) => ({
    ...current,
    contacts: current.contacts.filter((c) => c.email.toLowerCase() !== email.toLowerCase()),
  }));
}

function matchScore(contact: { email: string; name?: string }, query: string): number {
  const email = contact.email.toLowerCase();
  const name = contact.name?.toLowerCase() ?? '';
  if (email.startsWith(query) || name.startsWith(query)) {
    return 2;
  }
  if (email.includes(query) || name.includes(query)) {
    return 1;
  }
  return 0;
}

function byRecencyAndUsage(a: Contact, b: Contact): number {
  if (b.useCount !== a.useCount) {
    return b.useCount - a.useCount;
  }
  return (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '');
}

/** Fuzzy-ish substring/prefix match, ranked by relevance then usage/recency. */
export function rankContactsByQuery(contacts: Contact[], query: string): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [...contacts].sort(byRecencyAndUsage);
  }
  return contacts
    .map((contact) => ({ contact, score: matchScore(contact, q) }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || byRecencyAndUsage(a.contact, b.contact))
    .map((scored) => scored.contact);
}

export interface SuggestionEntry {
  email: string;
  name?: string;
  source: 'recents' | 'manual' | 'google-contacts';
  useCount?: number;
  lastUsedAt?: string;
}

function toSuggestionEntry(c: Contact): SuggestionEntry {
  return { email: c.email, name: c.name, source: c.source, useCount: c.useCount, lastUsedAt: c.lastUsedAt ?? undefined };
}

/**
 * Local contacts always come first, unchanged; Google Contacts fills in
 * anything not already known locally, labeled "google-contacts" — a
 * contact known both ways keeps its local useCount/lastUsedAt rather than
 * being flattened to a bare Google result. Optionally ranks each side
 * against `query` first (used by suggest_recipients; list_contacts passes
 * no query and gets everything, local-usage-sorted then unordered Google
 * results).
 */
export function mergeWithGoogleContacts(
  local: Contact[],
  google: Array<{ email: string; name?: string }>,
  query?: string,
): SuggestionEntry[] {
  const localEmails = new Set(local.map((c) => c.email.toLowerCase()));
  const rankedLocal = query !== undefined ? rankContactsByQuery(local, query) : local;
  const localEntries = rankedLocal.map(toSuggestionEntry);

  const googleOnly = google.filter((g) => !localEmails.has(g.email.toLowerCase()));
  const rankedGoogle =
    query !== undefined
      ? googleOnly
          .map((g) => ({ contact: g, score: matchScore(g, query.trim().toLowerCase()) }))
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((s) => s.contact)
      : googleOnly;

  const googleEntries: SuggestionEntry[] = rankedGoogle.map((g) => ({
    email: g.email,
    name: g.name,
    source: 'google-contacts',
  }));

  return [...localEntries, ...googleEntries];
}
