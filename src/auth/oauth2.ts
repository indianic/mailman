import nodemailer from 'nodemailer';
import { formatFromAddress } from '../mail/compose.js';
import type { OutboundMessage } from '../mail/provider.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const BACKOFF_MS = [500, 1500];

export interface OAuth2Credentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class OAuth2AuthError extends Error {}
export class OAuth2RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterMs: number,
  ) {
    super(message);
  }
}

/** Public entry point for callers that just need a valid access token (e.g. the People API client). */
export function getAccessToken(credentials: OAuth2Credentials): Promise<string> {
  return refreshAccessToken(credentials);
}

async function refreshAccessToken(credentials: OAuth2Credentials): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: credentials.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new OAuth2AuthError(`Refresh token exchange failed (${response.status}): ${body}`);
  }
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

function createXOAuth2Transport(user: string, accessToken: string) {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { type: 'OAuth2', user, accessToken },
  });
}

type RetryClassification = 'auth' | 'transient' | 'fatal';

// SMTP doesn't hand back clean HTTP status codes — 535 (auth failure) is
// the SMTP-side analog of a REST 401, and 421/454/5xx map to "retry with
// backoff." Phase 6/7's real HTTP-based Gmail/People API calls can pass
// their own classifier to this same retry helper against real status
// codes, without this SMTP-specific mapping.
function classifySmtpError(err: unknown): RetryClassification {
  const code = (err as { responseCode?: number })?.responseCode;
  if (code === 535) {
    return 'auth';
  }
  if (code === 421 || code === 454 || (typeof code === 'number' && code >= 500)) {
    return 'transient';
  }
  return 'fatal';
}

/**
 * One retry on an auth failure (after refreshing the access token); up to
 * two more retries on a transient/5xx failure with exponential backoff
 * (~500ms/1500ms); then throws OAuth2AuthError/OAuth2RateLimitError. See
 * docs/PLAN.md's "Provider-level retries" section.
 */
export async function withOAuth2Retry<T>(
  credentials: OAuth2Credentials,
  attempt: (accessToken: string) => Promise<T>,
  classify: (err: unknown) => RetryClassification = classifySmtpError,
): Promise<T> {
  let accessToken = await refreshAccessToken(credentials);
  let usedAuthRetry = false;
  let backoffIndex = 0;

  for (;;) {
    try {
      return await attempt(accessToken);
    } catch (err) {
      const classification = classify(err);

      if (classification === 'auth' && !usedAuthRetry) {
        usedAuthRetry = true;
        accessToken = await refreshAccessToken(credentials);
        continue;
      }
      if (classification === 'transient' && backoffIndex < BACKOFF_MS.length) {
        await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[backoffIndex]));
        backoffIndex += 1;
        continue;
      }
      if (classification === 'auth') {
        throw new OAuth2AuthError('OAuth2 authentication failed even after refreshing the access token — run `mcp-mailman auth login` again.');
      }
      if (classification === 'transient') {
        throw new OAuth2RateLimitError(
          'Gmail rate-limited or errored repeatedly — try again shortly.',
          BACKOFF_MS[BACKOFF_MS.length - 1],
        );
      }
      throw err;
    }
  }
}

export async function sendViaOAuth2(
  credentials: OAuth2Credentials,
  fromEmail: string,
  message: OutboundMessage,
): Promise<{ messageId: string }> {
  const info = await withOAuth2Retry(credentials, async (accessToken) => {
    const transport = createXOAuth2Transport(fromEmail, accessToken);
    return transport.sendMail({
      from: formatFromAddress(fromEmail, message.fromDisplayName),
      to: message.to.join(', '),
      cc: message.cc?.join(', '),
      bcc: message.bcc?.join(', '),
      subject: message.subject,
      text: message.bodyType === 'html' ? undefined : message.body,
      html: message.bodyType === 'html' ? message.body : undefined,
      attachments: message.attachments?.map((a) => ({
        filename: a.name,
        path: a.path,
        contentType: a.mimeType,
      })),
    });
  });
  return { messageId: info.messageId };
}
