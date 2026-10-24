import test from 'node:test';
import assert from 'node:assert/strict';
import type { DetailedPeerCertificate } from 'node:tls';
import { isTlsTrustError, tlsFailureReason, tlsTrustGuidance } from '../src/auth/tls-trust.js';
import { classifyVerifyError } from '../src/auth/verify.js';
import { rootIssuerName } from '../src/cli/doctor.js';

/**
 * The regression these guard: a Windows user with corporate TLS inspection saw
 * "Gmail rejected these credentials ✗" followed by "self-signed certificate in
 * certificate chain" and retyped a working App Password. Gmail never saw it.
 */

test('recognises the exact error nodemailer surfaces for an intercepted handshake', () => {
  // nodemailer's _formatError overwrites .code with ESOCKET, so only the
  // message survives from the SMTP path — detection must not depend on .code.
  const err = Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'ESOCKET' });
  assert.equal(isTlsTrustError(err), true);
});

test('recognises the OpenSSL 1.x spelling without the hyphen', () => {
  assert.equal(isTlsTrustError(new Error('self signed certificate in certificate chain')), true);
});

test('recognises trust failures by OpenSSL code when the code survives', () => {
  for (const code of ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'CERT_HAS_EXPIRED']) {
    assert.equal(isTlsTrustError(Object.assign(new Error('handshake failed'), { code })), true, code);
  }
});

test('unwraps the cause chain that fetch hides the real error behind', () => {
  // Node's fetch (the OAuth2 token exchange) reports only "fetch failed".
  const cause = Object.assign(new Error('unable to verify the first certificate'), {
    code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  });
  const err = Object.assign(new TypeError('fetch failed'), { cause });
  assert.equal(isTlsTrustError(err), true);
  assert.equal(tlsFailureReason(err), 'unable to verify the first certificate');
});

test('does not mistake a real credential rejection for a trust problem', () => {
  const err = Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), {
    code: 'EAUTH',
    responseCode: 535,
  });
  assert.equal(isTlsTrustError(err), false);
});

test('survives a self-referential cause without looping forever', () => {
  const err: { message: string; cause?: unknown } = { message: 'boom' };
  err.cause = err;
  assert.equal(isTlsTrustError(err), false);
});

test('classifies an intercepted handshake as tls, not auth', () => {
  const err = Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'ESOCKET' });
  const { kind, error } = classifyVerifyError(err);
  assert.equal(kind, 'tls');
  // The headline claim: the user must be told their password was never sent.
  assert.match(error, /not a wrong App Password/);
  assert.match(error, /before any password was sent/);
});

test('still classifies a 535 rejection as auth', () => {
  const err = Object.assign(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), {
    code: 'EAUTH',
    responseCode: 535,
  });
  assert.equal(classifyVerifyError(err).kind, 'auth');
});

test('classifies the anti-abuse block separately from a bad password', () => {
  assert.equal(classifyVerifyError(new Error('454 4.7.0 Too many login attempts, please try again later')).kind, 'throttled');
});

test('classifies a dead network as network', () => {
  assert.equal(classifyVerifyError(Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' })).kind, 'network');
});

test('guidance gives Windows shell syntax on win32', () => {
  const text = tlsTrustGuidance('self-signed certificate in certificate chain', {
    platform: 'win32',
    systemCaSupported: true,
  });
  assert.match(text, /\$env:NODE_OPTIONS = "--use-system-ca"/);
  assert.match(text, /set NODE_OPTIONS=--use-system-ca/);
  assert.match(text, /NODE_EXTRA_CA_CERTS=C:\\path\\to\\root\.cer/);
  assert.match(text, /Windows certificate store/);
  assert.doesNotMatch(text, /export NODE_OPTIONS/);
});

test('guidance gives POSIX shell syntax elsewhere', () => {
  const text = tlsTrustGuidance('self-signed certificate in certificate chain', {
    platform: 'darwin',
    systemCaSupported: true,
  });
  assert.match(text, /export NODE_OPTIONS=--use-system-ca/);
  assert.doesNotMatch(text, /certmgr\.msc/);
});

test('guidance does not recommend --use-system-ca on a Node that rejects it', () => {
  const text = tlsTrustGuidance('self-signed certificate in certificate chain', {
    platform: 'win32',
    systemCaSupported: false,
  });
  assert.match(text, /too old for --use-system-ca/);
  assert.doesNotMatch(text, /\$env:NODE_OPTIONS/);
  // The manual route must still be offered — an old Node is not a dead end.
  assert.match(text, /NODE_EXTRA_CA_CERTS/);
});

/** Minimal stand-in for the chain shape `getPeerCertificate(true)` returns. */
function certChain(...subjects: string[]): DetailedPeerCertificate {
  const nodes = subjects.map((cn) => ({ subject: { CN: cn }, issuer: { CN: cn } }) as unknown as DetailedPeerCertificate);
  nodes.forEach((node, i) => {
    // The root is its own issuer — the loop condition the walk has to survive.
    (node as { issuerCertificate: DetailedPeerCertificate }).issuerCertificate = nodes[i + 1] ?? node;
  });
  return nodes[0];
}

test('rootIssuerName walks a leaf → root chain to the interceptor', () => {
  const chain = certChain('smtp.gmail.com', 'ESET SSL Filter CA');
  assert.equal(rootIssuerName(chain, 'smtp.gmail.com'), 'ESET SSL Filter CA');
});

test('rootIssuerName names nothing when the chain is a bare self-signed leaf', () => {
  // A single self-signed cert for the host itself identifies no third party —
  // reporting 'issued by "smtp.gmail.com", not by Google' would be nonsense.
  assert.equal(rootIssuerName(certChain('smtp.gmail.com'), 'smtp.gmail.com'), undefined);
});

test('rootIssuerName falls back to the organisation when the root has no CN', () => {
  const root = { subject: { O: ['Zscaler Inc.', 'ignored'] }, issuer: {} } as unknown as DetailedPeerCertificate;
  (root as { issuerCertificate: DetailedPeerCertificate }).issuerCertificate = root;
  const leaf = { subject: { CN: 'smtp.gmail.com' }, issuer: {}, issuerCertificate: root } as unknown as DetailedPeerCertificate;
  assert.equal(rootIssuerName(leaf, 'smtp.gmail.com'), 'Zscaler Inc.');
});

test("guidance drops Node's own truncated --use-system-ca hint from the quoted reason", () => {
  const text = tlsTrustGuidance(
    'self-signed certificate; if the root CA is installed locally, try running Node.js with --use-system-ca',
    { platform: 'win32', systemCaSupported: true },
  );
  assert.match(text, /verified \(self-signed certificate\), so the connection/);
  assert.doesNotMatch(text, /if the root CA is installed locally/);
});

test('guidance names the root it found without asserting interception', () => {
  const text = tlsTrustGuidance('self-signed certificate in certificate chain', {
    platform: 'win32',
    issuer: 'Kaspersky Anti-Virus Personal Root Certificate',
  });
  assert.match(text, /chain ends at "Kaspersky Anti-Virus Personal Root Certificate"/);
  // A broken CA store fails identically and ends at a legitimate root
  // (Gmail's is "GTS Root R1") — the text must not call that interception.
  assert.match(text, /If that isn't a public certificate authority you recognise/);
});
