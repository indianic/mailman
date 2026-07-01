/** RFC 5322 "From" header value — bare address when the account has no display name set. */
export function formatFromAddress(email: string, displayName?: string): string {
  return displayName ? `${displayName} <${email}>` : email;
}

/**
 * Appended at draft time (not send time) so the preview shown to the user
 * for confirmation matches exactly what confirm_send later dispatches.
 */
export function appendSignature(body: string, signature: string | undefined, bodyType: 'text' | 'html'): string {
  if (!signature) return body;
  const separator = bodyType === 'html' ? '<br><br>' : '\n\n';
  return `${body}${separator}${signature}`;
}
