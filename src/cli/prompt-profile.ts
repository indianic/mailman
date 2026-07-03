import { text, isCancel, cancel } from '@clack/prompts';

/** Shared by the app-password and oauth2 account-creation flows in account.ts/auth-login.ts. */
export async function promptProfileDetails(): Promise<{ displayName?: string; signature?: string }> {
  // These are OPTIONAL, so no validate — but @clack's text() returns
  // `undefined` on an empty submit, and `String(undefined)` is the truthy
  // string "undefined", which would get stored as the literal From Name /
  // signature. `defaultValue: ''` makes an empty submit return '' instead,
  // and the guard below still collapses whitespace-only input to undefined.
  const displayName = await text({
    message: '"From Name" shown to recipients (optional — e.g. "Kalpesh Gamit")',
    defaultValue: '',
  });
  if (isCancel(displayName)) {
    cancel('Cancelled.');
    process.exit(1);
  }

  const signature = await text({
    message: 'Signature appended to every draft from this account (optional)',
    defaultValue: '',
  });
  if (isCancel(signature)) {
    cancel('Cancelled.');
    process.exit(1);
  }

  const clean = (v: unknown) => (v == null ? undefined : String(v).trim() || undefined);
  return {
    displayName: clean(displayName),
    signature: clean(signature),
  };
}
