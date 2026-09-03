/**
 * tests/crypto.test.mjs
 * Run with: node tests/crypto.test.mjs
 *
 * Tests the QFE1 crypto format:
 *   - encrypt (Node tool logic) → decrypt (browser helper logic) round-trip
 *   - wrong passphrase fails
 *   - tampered byte fails
 *   - wrong magic rejected
 *   - PBKDF2 is deterministic
 *
 * Uses Node 24 built-in WebCrypto (globalThis.crypto.subtle).
 * All crypto functions here mirror encrypt_publish.mjs (Node) and the
 * inline _qfeDeriveKey/_qfeDecrypt helpers in index.html / quiz.html.
 */

import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;
const getRandomValues = (arr) => webcrypto.getRandomValues(arr);
const MAGIC = Buffer.from('QFE1', 'ascii');

// ── Tool-side helpers (mirrors encrypt_publish.mjs) ───────────────────────────
async function toolDeriveKey(passphrase, saltB64, usage) {
  const enc = new TextEncoder();
  const km = await subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  const salt = Buffer.from(saltB64, 'base64');
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 200000 },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    usage || ['encrypt', 'decrypt']
  );
}

async function toolEncrypt(key, plaintext) {
  const iv = new Uint8Array(12);
  getRandomValues(iv);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  return Buffer.concat([MAGIC, Buffer.from(iv), Buffer.from(ct)]);
}

// ── Browser-side helpers (mirrors _qfeDeriveKey/_qfeDecrypt in HTML files) ────
async function browserDeriveKey(passphrase, saltB64, usage) {
  const enc = new TextEncoder();
  const km = await subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  // Browser uses Uint8Array.from(atob(saltB64), c => c.charCodeAt(0))
  // which is equivalent to Buffer.from(saltB64, 'base64') for the same bytes
  const saltStr = Buffer.from(saltB64, 'base64').toString('binary');
  const salt = Uint8Array.from(saltStr, c => c.charCodeAt(0));
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 200000 },
    km,
    { name: 'AES-GCM', length: 256 },
    false,
    usage || ['decrypt']
  );
}

async function browserDecrypt(buf, key) {
  const d = new Uint8Array(buf instanceof Buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : buf);
  if (d[0] !== 0x51 || d[1] !== 0x46 || d[2] !== 0x45 || d[3] !== 0x31)
    throw new Error('invalid QFE1 magic');
  const iv = d.slice(4, 16);
  const ct = d.slice(16);
  return subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
}

// ── Test runner ───────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log('PASS ' + name);
    passed++;
  } catch (e) {
    console.error('FAIL ' + name + ': ' + (e && e.message ? e.message : e));
    failed++;
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// ── Fixed test fixtures ───────────────────────────────────────────────────────
const PASSPHRASE = 'test-only-passphrase-for-crypto-unit-tests';
const SALT_B64   = Buffer.from(new Uint8Array(16).fill(42)).toString('base64'); // deterministic
const PLAINTEXT  = Buffer.from(JSON.stringify({ id: 'test', questions: [{ text: 'Q1', options: ['A', 'B'], correct: 0 }] }));

// ── Tests ─────────────────────────────────────────────────────────────────────

await test('round-trip: tool encrypt → browser decrypt recovers plaintext', async () => {
  const encKey = await toolDeriveKey(PASSPHRASE, SALT_B64, ['encrypt']);
  const decKey = await browserDeriveKey(PASSPHRASE, SALT_B64, ['decrypt']);
  const enc = await toolEncrypt(encKey, PLAINTEXT);
  const dec = await browserDecrypt(enc, decKey);
  assert(Buffer.from(dec).equals(PLAINTEXT), 'decrypted bytes do not match original');
});

await test('round-trip: same key object can encrypt then decrypt', async () => {
  const key = await toolDeriveKey(PASSPHRASE, SALT_B64, ['encrypt', 'decrypt']);
  const enc = await toolEncrypt(key, PLAINTEXT);
  const dec = await browserDecrypt(enc, key);
  assert(Buffer.from(dec).equals(PLAINTEXT), 'round-trip with same key object failed');
});

await test('wrong passphrase fails to decrypt', async () => {
  const encKey = await toolDeriveKey(PASSPHRASE, SALT_B64, ['encrypt']);
  const enc = await toolEncrypt(encKey, PLAINTEXT);
  const wrongKey = await browserDeriveKey('definitely-wrong-passphrase', SALT_B64, ['decrypt']);
  let threw = false;
  try { await browserDecrypt(enc, wrongKey); } catch (_) { threw = true; }
  assert(threw, 'expected decryption failure with wrong passphrase');
});

await test('tampered ciphertext byte triggers AES-GCM auth failure', async () => {
  const key = await toolDeriveKey(PASSPHRASE, SALT_B64, ['encrypt', 'decrypt']);
  const enc = await toolEncrypt(key, PLAINTEXT);
  // Flip the last byte of the ciphertext (within the auth tag)
  enc[enc.length - 1] ^= 0xff;
  let threw = false;
  try { await browserDecrypt(enc, key); } catch (_) { threw = true; }
  assert(threw, 'expected decryption failure with tampered ciphertext');
});

await test('tampered IV byte triggers AES-GCM auth failure', async () => {
  const key = await toolDeriveKey(PASSPHRASE, SALT_B64, ['encrypt', 'decrypt']);
  const enc = await toolEncrypt(key, PLAINTEXT);
  // Flip one IV byte (bytes 4-15)
  enc[5] ^= 0x01;
  let threw = false;
  try { await browserDecrypt(enc, key); } catch (_) { threw = true; }
  assert(threw, 'expected decryption failure with tampered IV');
});

await test('wrong magic bytes ("QFE2") are rejected before crypto', async () => {
  const key = await toolDeriveKey(PASSPHRASE, SALT_B64, ['decrypt']);
  const bad = Buffer.from('QFE2' + 'x'.repeat(28));
  let threw = false;
  let msg = '';
  try { await browserDecrypt(bad, key); } catch (e) { threw = true; msg = e.message; }
  assert(threw, 'expected error for wrong magic');
  assert(msg.includes('QFE1'), 'error should mention QFE1 magic');
});

await test('PBKDF2 key derivation is deterministic across two calls', async () => {
  const k1 = await toolDeriveKey(PASSPHRASE, SALT_B64, ['encrypt', 'decrypt']);
  const k2 = await browserDeriveKey(PASSPHRASE, SALT_B64, ['decrypt']);
  // Encrypt with k1, decrypt with k2: must succeed if deterministic
  const enc = await toolEncrypt(k1, PLAINTEXT);
  const dec = await browserDecrypt(enc, k2);
  assert(Buffer.from(dec).equals(PLAINTEXT), 'PBKDF2 derivation not deterministic');
});

await test('different salt produces different key (cross-decrypt fails)', async () => {
  const salt2 = Buffer.from(new Uint8Array(16).fill(99)).toString('base64');
  const keyA  = await toolDeriveKey(PASSPHRASE, SALT_B64, ['encrypt']);
  const keyB  = await browserDeriveKey(PASSPHRASE, salt2, ['decrypt']);
  const enc = await toolEncrypt(keyA, PLAINTEXT);
  let threw = false;
  try { await browserDecrypt(enc, keyB); } catch (_) { threw = true; }
  assert(threw, 'expected failure when salt differs');
});

await test('encrypted output starts with QFE1 magic', async () => {
  const key = await toolDeriveKey(PASSPHRASE, SALT_B64, ['encrypt']);
  const enc = await toolEncrypt(key, PLAINTEXT);
  assert(enc.slice(0, 4).toString('ascii') === 'QFE1', 'output does not start with QFE1');
});

await test('encrypted output length is 4 (magic) + 12 (IV) + plaintext + 16 (tag)', async () => {
  const key = await toolDeriveKey(PASSPHRASE, SALT_B64, ['encrypt']);
  const enc = await toolEncrypt(key, PLAINTEXT);
  const expected = 4 + 12 + PLAINTEXT.length + 16;
  assert(enc.length === expected,
    'expected length ' + expected + ', got ' + enc.length);
});

await test('two encryptions of same plaintext produce different ciphertexts (random IV)', async () => {
  const key = await toolDeriveKey(PASSPHRASE, SALT_B64, ['encrypt']);
  const e1 = await toolEncrypt(key, PLAINTEXT);
  const e2 = await toolEncrypt(key, PLAINTEXT);
  assert(!e1.equals(e2), 'expected different ciphertexts due to random IV');
});

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
