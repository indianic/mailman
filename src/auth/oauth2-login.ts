import http from 'node:http';
import open from 'open';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

// contacts.readonly is requested now so Phase 6's recipient suggestions
// don't need a second consent round; gmail.readonly is added in Phase 7
// once reading mail actually exists (see docs/PLAN.md's Auth section).
export const OAUTH_SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/contacts.readonly'];

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface OAuthLoginResult {
  refreshToken: string;
}

function startLoopbackServer(): Promise<{ port: number; waitForCode: () => Promise<string> }> {
  return new Promise((resolve, reject) => {
    let settleCode: ((code: string) => void) | undefined;
    let settleError: ((err: Error) => void) | undefined;
    const codePromise = new Promise<string>((res, rej) => {
      settleCode = res;
      settleError = rej;
    });

    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (code) {
        res.end('<html><body>Signed in — you can close this tab and return to the terminal.</body></html>');
        settleCode?.(code);
      } else {
        res.end(`<html><body>Authorization failed: ${error ?? 'unknown error'}. You can close this tab.</body></html>`);
        settleError?.(new Error(error ?? 'No authorization code received'));
      }
      server.close();
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to bind the loopback OAuth listener'));
        return;
      }
      resolve({ port: address.port, waitForCode: () => codePromise });
    });
  });
}

function buildAuthUrl(client: OAuthClientConfig, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

async function exchangeCodeForTokens(client: OAuthClientConfig, code: string, redirectUri: string): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as { refresh_token?: string };
  if (!data.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. This usually means you already granted access once before — ' +
        'revoke it at https://myaccount.google.com/permissions and run `auth login` again.',
    );
  }
  return data.refresh_token;
}

/**
 * Reachable-local-browser check. A real GUI environment on macOS/Windows
 * is assumed reachable; on Linux, DISPLAY/WAYLAND_DISPLAY being unset is
 * the standard signal for "no display server" (headless/SSH/container).
 */
export function isLocalBrowserAvailable(noBrowserFlag: boolean): boolean {
  if (noBrowserFlag) {
    return false;
  }
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return true;
  }
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

/**
 * Loopback redirect only — no Device Authorization Grant. Google's device
 * flow doesn't support Gmail/Contacts scopes on any client type, so it
 * can't be used here (see docs/PLAN.md's Auth section). When no local
 * browser is reachable, this prints an `ssh -L` port-forward command
 * instead of a different OAuth mechanism — same listener, same code path,
 * just opened from wherever the user's actual browser lives.
 */
export async function runOAuthLogin(
  client: OAuthClientConfig,
  opts: { noBrowser?: boolean; onInstructions?: (message: string) => void } = {},
): Promise<OAuthLoginResult> {
  const { port, waitForCode } = await startLoopbackServer();
  const redirectUri = `http://127.0.0.1:${port}`;
  const authUrl = buildAuthUrl(client, redirectUri);

  if (isLocalBrowserAvailable(Boolean(opts.noBrowser))) {
    await open(authUrl);
  } else {
    opts.onInstructions?.(
      `No local browser detected. From your LOCAL machine, forward this port back here:\n\n` +
        `  ssh -L ${port}:localhost:${port} <user>@<this-host>\n\n` +
        `Then open this URL in your local browser and approve:\n\n  ${authUrl}\n`,
    );
  }

  const code = await waitForCode();
  const refreshToken = await exchangeCodeForTokens(client, code, redirectUri);
  return { refreshToken };
}
