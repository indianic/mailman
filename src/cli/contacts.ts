import { intro, outro, log } from '@clack/prompts';
import { listContacts, addContact, removeContact } from '../contacts.js';
import { section, detail } from './tree.js';

/** `mcp-mailman contacts list` */
export async function runContactsList(_args: string[]): Promise<void> {
  intro('mailman — contacts');
  const contacts = await listContacts();
  if (contacts.length === 0) {
    outro('No contacts yet — they build up automatically as you send mail, or add one manually.');
    return;
  }

  section('contacts');
  for (const c of contacts) {
    const flags = [c.source, `used: ${c.useCount}`, c.lastUsedAt ? `last: ${c.lastUsedAt}` : null].filter(Boolean).join('   ');
    detail(`${c.email}${c.name ? `   ${c.name}` : ''}   ${flags}`);
  }
  outro(`${contacts.length} contact(s)`);
}

/** `mcp-mailman contacts add <email> [--name "..."]` */
export async function runContactsAdd(args: string[]): Promise<void> {
  const email = args.find((a) => !a.startsWith('--'));
  const nameIndex = args.indexOf('--name');
  const name = nameIndex >= 0 ? args[nameIndex + 1] : undefined;

  intro('mailman — add contact');

  if (!email) {
    log.error('Usage: mcp-mailman contacts add <email> [--name "..."]');
    process.exit(1);
  }

  await addContact(email, name);
  outro(`Added ${email}${name ? ` (${name})` : ''}.`);
}

/** `mcp-mailman contacts remove <email>` */
export async function runContactsRemove(args: string[]): Promise<void> {
  const email = args[0];

  intro('mailman — remove contact');

  if (!email) {
    log.error('Usage: mcp-mailman contacts remove <email>');
    process.exit(1);
  }
  await removeContact(email);
  outro(`Removed ${email}.`);
}
