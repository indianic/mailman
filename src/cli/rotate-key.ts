import { intro, outro, confirm, isCancel, cancel } from '@clack/prompts';
import { getMasterKeyOrThrow } from '../config/keychain.js';
import { resolveForRead } from '../config/keystore/index.js';
import { rekeyStoredData, type RekeyOutcome } from '../rekey.js';
import { requireTty } from './interactive.js';
import { fail, attention } from './tree.js';

/**
 * CLI-only, never an MCP tool — re-keying every stored credential is a
 * high-privilege, hard-to-reverse operation that shouldn't be triggerable
 * by anything an LLM session could be talked into calling. See
 * docs/PLAN.md's "Data integrity & storage" section.
 *
 * Works on every keystore backend. What "a new key" means depends on the backend:
 * `os-keychain` and `file` get fresh random bytes, `passphrase` re-derives from
 * the existing passphrase against a fresh salt, and `env` refuses — its key is
 * owned by the platform, so there is nowhere for mailman to put a new one.
 */
export async function runRotateKey(_args: string[]): Promise<void> {
  intro('mailman — rotate master key');
  requireTty('`mailman auth rotate-key`');

  let outcome: RekeyOutcome;
  try {
    const backend = await resolveForRead();
    outcome = await rekeyStoredData({
      loadOldKey: getMasterKeyOrThrow,
      prepareNewKey: () => backend.prepareKey('rotate'),
      warn: (message) => attention(message),
      confirm: async ({ accounts, scheduled }) => {
        const answer = await confirm({
          message:
            `Re-encrypt ${accounts} account(s)${scheduled > 0 ? ` and ${scheduled} scheduled send(s)` : ''} ` +
            `with a new master key on \`${backend.name}\`?`,
        });
        return !isCancel(answer) && answer;
      },
    });
  } catch (err) {
    // NoMasterKeyError, KeyringUnavailableError, KeystoreNotStorableError (env)
    // and the partial-rotation error all want the same treatment: print the
    // message, exit non-zero.
    fail(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (outcome.status === 'nothing-to-do') {
    outro('No accounts or scheduled sends configured — nothing to rotate.');
    return;
  }
  if (outcome.status === 'blocked') {
    fail(`Cannot rotate: ${outcome.reason}`);
    process.exit(1);
  }
  if (outcome.status === 'cancelled') {
    cancel('Cancelled — no changes made.');
    return;
  }

  const { accountsRekeyed, scheduledRekeyed } = outcome.summary;
  outro(
    `Rotated the master key: re-encrypted ${accountsRekeyed} account(s)` +
      `${scheduledRekeyed > 0 ? ` and ${scheduledRekeyed} scheduled send(s)` : ''}.`,
  );
}
