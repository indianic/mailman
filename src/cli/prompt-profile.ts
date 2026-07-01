import { text, isCancel, cancel } from '@clack/prompts';

/** Shared by the app-password and oauth2 account-creation flows in account.ts/auth-login.ts. */
export async function promptProfileDetails(): Promise<{ displayName?: string; signature?: string }> {
  const displayName = await text({
    message: '"From Name" shown to recipients (optional — e.g. "Kalpesh Gamit")',
  });
  if (isCancel(displayName)) {
    cancel('Cancelled.');
    process.exit(1);
  }

  const signature = await text({
    message: 'Signature appended to every draft from this account (optional)',
  });
  if (isCancel(signature)) {
    cancel('Cancelled.');
    process.exit(1);
  }

  return {
    displayName: String(displayName).trim() || undefined,
    signature: String(signature).trim() || undefined,
  };
}
