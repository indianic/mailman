import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encrypt, decrypt } from '../src/config/crypto.js';

test('encrypt/decrypt round-trips plaintext', () => {
  const key = crypto.randomBytes(32);
  const blob = encrypt(key, 'hello world');
  assert.equal(decrypt(key, blob), 'hello world');
});

test('decrypt throws with the wrong key (GCM auth tag mismatch)', () => {
  const key = crypto.randomBytes(32);
  const wrongKey = crypto.randomBytes(32);
  const blob = encrypt(key, 'secret credentials');
  assert.throws(() => decrypt(wrongKey, blob));
});

test('decrypt throws if the ciphertext was tampered with', () => {
  const key = crypto.randomBytes(32);
  const blob = encrypt(key, 'secret credentials');
  const tampered = { ...blob, ciphertext: Buffer.from('not the real ciphertext').toString('base64') };
  assert.throws(() => decrypt(key, tampered));
});

test('each encryption uses a fresh IV, so identical plaintext yields different ciphertext', () => {
  const key = crypto.randomBytes(32);
  const a = encrypt(key, 'same plaintext');
  const b = encrypt(key, 'same plaintext');
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});
