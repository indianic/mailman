import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { promises as fs, constants as fsConstants } from 'node:fs';
import { KeyringUnavailableError } from './errors.js';
import { MASTER_KEY_BYTES, type KeystoreBackend, type PreparedKey, type KeyIntent } from './types.js';
import { writeKeystoreRecord } from './pointer.js';
import type { KeystoreRecord } from '../schema.js';

export const KEY_FILE_ENV = 'MAILMAN_MASTER_KEY_FILE';

const KEY_FILE_MODE = 0o600;
const KEY_DIR_MODE = 0o700;

/**
 * Deliberately NOT in the config dir. `accounts.json` lives there, and the one
 * property the security model rests on is that copying the config dir yields
 * useless ciphertext — a key file inside it would end up in the same rsync, the
 * same `docker COPY`, the same accidental commit.
 *
 * Under MCP_MAILMAN_CONFIG_DIR the default path is namespaced into the temp dir
 * the same way getServiceName() namespaces the keychain entry, so an isolated
 * profile or a test run can never touch the real key file.
 *
 * `platform` is a parameter for the same reason installHint's is: the Windows
 * branch is otherwise unverifiable from a Mac or a Linux container, and getting it
 * wrong there is not a visible error — it would put the key in the *roaming*
 * profile, which Windows copies between machines by design, quietly undoing the
 * one property this backend exists to provide.
 */
export function defaultKeyFilePath(platform: string = process.platform): string {
  const override = process.env[KEY_FILE_ENV];
  if (override) return override;

  const isolated = process.env.MCP_MAILMAN_CONFIG_DIR;
  if (isolated) {
    const hash = crypto.createHash('sha256').update(isolated).digest('hex').slice(0, 12);
    return path.join(os.tmpdir(), `mailman-keystore-${hash}`, 'master.key');
  }

  if (platform === 'win32') {
    // LOCALAPPDATA, not APPDATA: the config dir is under Roaming, and a roaming
    // profile is copied between machines by design.
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'mailman', 'master.key');
  }
  const stateHome = process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state');
  return path.join(stateHome, 'mailman', 'master.key');
}

/**
 * A 0600 key file. Opt-in only, via `MAILMAN_KEYSTORE=file`, and reported by
 * `doctor` as degraded rather than healthy.
 *
 * The honest case for it is the cron ticker on a bare server: something has to
 * be readable without a human present, and `MAILMAN_MASTER_PASSPHRASE` sitting
 * in a crontab is a key file with extra steps — a worse one, since a passphrase
 * is likelier to be reused somewhere else than 32 random bytes are.
 *
 * What it protects against: the config dir being copied somewhere with the key
 * left behind. What it does NOT protect against: anything that can read the
 * file. On a headless box an auto-unlocked gnome-keyring is roughly this, with
 * more moving parts.
 */
export function fileBackend(record: KeystoreRecord | null): KeystoreBackend {
  const keyFile = (record?.backend === 'file' ? record.keyFile : undefined) ?? defaultKeyFilePath();

  const persist = async (key: Buffer, exclusive: boolean): Promise<void> => {
    await fs.mkdir(path.dirname(keyFile), { recursive: true, mode: KEY_DIR_MODE });
    // 'wx' (O_CREAT|O_EXCL) on create: if something is already there, it may be
    // the key that a config dir on this machine is encrypted with, and
    // truncating it destroys those credentials with no way back.
    await fs.writeFile(keyFile, `${key.toString('base64')}\n`, { encoding: 'utf8', flag: exclusive ? 'wx' : 'w', mode: KEY_FILE_MODE });
    // writeFile's `mode` only applies when it CREATES the file, so an existing
    // file keeps whatever permissions it had — hence the re-assertion.
    //
    // Tolerated rather than required, matching config/store.ts: POSIX modes do
    // not exist on Windows, FAT/exFAT volumes or some network mounts, where
    // chmod throws. Losing the write — and with it the only copy of the master
    // key — because a permission bit could not be set would be far worse. On
    // such a filesystem there are no mode bits to leak through anyway, and
    // read() warns on every load if the file is group/world readable.
    try {
      await fs.chmod(keyFile, KEY_FILE_MODE);
    } catch {
      // Best effort; the create-time mode above is the actual guarantee.
    }
  };

  const recordSelf = (): Promise<void> =>
    writeKeystoreRecord({ backend: 'file', keyFile, createdAt: new Date().toISOString() });

  return {
    name: 'file',
    degraded: true,

    describe() {
      return `a 0600 key file at ${keyFile}: readable by anything running as this user, but kept outside the config dir so it is not copied along with accounts.json`;
    },

    async read() {
      let raw: string;
      try {
        raw = await fs.readFile(keyFile, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw new KeyringUnavailableError(
          `Could not read the master key file at ${keyFile}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const key = Buffer.from(raw.trim(), 'base64');
      if (key.length !== MASTER_KEY_BYTES) {
        throw new KeyringUnavailableError(
          `${keyFile} does not contain a ${MASTER_KEY_BYTES}-byte base64 key (decoded to ${key.length} bytes). ` +
            'It is truncated or was overwritten — restore it from wherever you back it up, or ' +
            '`mailman reset --yes` and set up again.',
        );
      }

      // Loud but non-fatal: refusing to start over file permissions would lock
      // someone out of their own mail, but silently reading a world-readable key
      // is not something to let pass either.
      try {
        const { mode } = await fs.stat(keyFile);
        if (mode & 0o077) {
          process.stderr.write(
            `[mcp-mailman] warning: ${keyFile} is readable by other users (mode ${(mode & 0o777).toString(8)}) — ` +
              `run: chmod 600 ${keyFile}\n`,
          );
        }
      } catch {
        // stat failing after a successful read isn't worth failing the read over
      }

      return key;
    },

    canStore: true,

    async store(key: Buffer) {
      await persist(key, false);
      await recordSelf();
    },

    prepareKey(intent: KeyIntent): Promise<PreparedKey> {
      const key = crypto.randomBytes(MASTER_KEY_BYTES);
      return Promise.resolve({
        key,
        commit: async () => {
          // Adopting uses O_EXCL: if a key file is already there it may be what
          // another profile on this machine is encrypted with, and truncating it
          // destroys those credentials with no way back. Rotating overwrites,
          // which is the whole point.
          try {
            await persist(key, intent === 'adopt');
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
              throw new KeyringUnavailableError(
                `A key file already exists at ${keyFile}, so mailman will not overwrite it — it may be the key ` +
                  'another profile on this machine is encrypted with. Point ' +
                  `${KEY_FILE_ENV} somewhere else, or delete that file if you are certain it is unused.`,
              );
            }
            throw err;
          }
          await recordSelf();
          if (intent === 'adopt') {
            process.stderr.write(
              `[mcp-mailman] the master key is now a plain file: ${keyFile} (mode 600).\n` +
                '[mcp-mailman] Anything able to read it can decrypt your stored credentials. Back it up ' +
                'separately from the config dir — losing it makes those credentials unrecoverable.\n',
            );
          }
        },
      });
    },

    async remove() {
      try {
        await fs.access(keyFile, fsConstants.F_OK);
        await fs.rm(keyFile, { force: true });
      } catch {
        // already gone — nothing to do
      }
    },
  };
}
