import { log } from '@clack/prompts';
import { listContacts, addContact, removeContact } from '../contacts.js';

/** `mcp-mailman contacts list` */
export async function runContactsList(_args: string[]): Promise<void> {
  const contacts = await listContacts();
  if (contacts.length === 0) {
    process.stdout.write('No contacts yet — they build up automatically as you send mail, or add one manually.\n');
    return;
  }
  console.table(
    contacts.map((c) => ({
      email: c.email,
      name: c.name ?? '',
      source: c.source,
      useCount: c.useCount,
      lastUsedAt: c.lastUsedAt ?? '',
    })),
  );
}

/** `mcp-mailman contacts add <email> [--name "..."]` */
export async function runContactsAdd(args: string[]): Promise<void> {
  const email = args.find((a) => !a.startsWith('--'));
  const nameIndex = args.indexOf('--name');
  const name = nameIndex >= 0 ? args[nameIndex + 1] : undefined;

  if (!email) {
    log.error('Usage: mcp-mailman contacts add <email> [--name "..."]');
    process.exit(1);
  }

  await addContact(email, name);
  process.stdout.write(`Added ${email}${name ? ` (${name})` : ''}.\n`);
}

/** `mcp-mailman contacts remove <email>` */
export async function runContactsRemove(args: string[]): Promise<void> {
  const email = args[0];
  if (!email) {
    log.error('Usage: mcp-mailman contacts remove <email>');
    process.exit(1);
  }
  await removeContact(email);
  process.stdout.write(`Removed ${email}.\n`);
}
