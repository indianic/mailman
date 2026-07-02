import { intro, outro, log, confirm, isCancel, cancel } from '@clack/prompts';
import { getAccountsPath } from '../config/paths.js';
import { readJsonFile, writeJsonFile } from '../config/store.js';
import { AccountsFileSchema, DEFAULT_ACCOUNTS_FILE } from '../config/schema.js';
import { encrypt, decrypt } from '../config/crypto.js';
import { getMasterKeyOrThrow, generateMasterKey, setMasterKey, NoMasterKeyError, KeyringUnavailableError } from '../config/keychain.js';
import { requireTty } from './interactive.js';

/**
 * CLI-only, never an MCP tool — re-keying every stored credential is a
 * high-privilege, hard-to-reverse operation that shouldn't be triggerable
 * by anything an LLM session could be talked into calling. See
 * docs/PLAN.md's "Data integrity & storage" section.
 */
export async function runRotateKey(_args: string[]): Promise<void> {
  intro('mailman — rotate master key');
  requireTty('`mailman auth rotate-key`');

  const file = await readJsonFile(getAccountsPath(), AccountsFileSchema, DEFAULT_ACCOUNTS_FILE);
  if (file.accounts.length === 0) {
    outro('No accounts configured — nothing to rotate.');
    return;
  }

  let oldKey;
  try {
    oldKey = await getMasterKeyOrThrow();
  } catch (err) {
    if (err instanceof NoMasterKeyError || err instanceof KeyringUnavailableError) {
      log.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const proceed = await confirm({
    message: `Re-encrypt ${file.accounts.length} account(s) with a new master key?`,
  });
  if (isCancel(proceed) || !proceed) {
    cancel('Cancelled — no changes made.');
    return;
  }

  const newKey = generateMasterKey();
  const reencryptedAccounts = file.accounts.map((account) => {
    const plaintext = decrypt(oldKey, account.credentials);
    return { ...account, credentials: encrypt(newKey, plaintext) };
  });

  // Write the re-encrypted file before swapping the stored key, so a crash
  // mid-rotation leaves old-key-encrypted data with the old key still
  // recoverable, rather than new-key-encrypted data with an old key.
  await writeJsonFile(getAccountsPath(), AccountsFileSchema, { ...file, accounts: reencryptedAccounts });
  await setMasterKey(newKey);

  outro(`Rotated the master key and re-encrypted ${reencryptedAccounts.length} account(s).`);
}
