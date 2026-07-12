import test from "node:test";
import assert from "node:assert/strict";

// The secrets module reads SECRETS_ENC_KEY once at import time, so set it BEFORE the
// first (dynamic) import below — this proves the encrypted path, not just the no-op.
process.env.SECRETS_ENC_KEY = "a".repeat(64); // 32-byte hex key

test("encryptSecret → decryptSecret round-trips and produces an opaque ciphertext", async () => {
  const { encryptSecret, decryptSecret, secretsEncryptionEnabled } = await import("./secrets");
  assert.equal(secretsEncryptionEnabled(), true);
  const plain = "sk-super-secret-key-123";
  const enc = encryptSecret(plain);
  assert.ok(enc.startsWith("enc:v1:"), "carries the version marker");
  assert.ok(!enc.includes(plain), "ciphertext does not contain the plaintext");
  assert.equal(decryptSecret(enc), plain, "round-trips");
  // Idempotent: encrypting an already-encrypted value is a no-op.
  assert.equal(encryptSecret(enc), enc);
});

test("decryptSecret passes through legacy plaintext and empty values", async () => {
  const { decryptSecret, encryptSecret } = await import("./secrets");
  assert.equal(decryptSecret("plain-legacy-value"), "plain-legacy-value");
  assert.equal(decryptSecret(""), "");
  assert.equal(encryptSecret(""), ""); // never encrypt empty
});

test("decryptConfigValues only touches encrypted string values", async () => {
  const { encryptSecret, decryptConfigValues } = await import("./secrets");
  const cfg = { apiKey: encryptSecret("secret"), fromNumber: "+14155238886", gstPercent: 18 };
  const out = decryptConfigValues(cfg);
  assert.equal(out.apiKey, "secret");
  assert.equal(out.fromNumber, "+14155238886");
  assert.equal(out.gstPercent, 18);
});

test("two encryptions of the same value differ (random IV) but both decrypt", async () => {
  const { encryptSecret, decryptSecret } = await import("./secrets");
  const a = encryptSecret("same");
  const b = encryptSecret("same");
  assert.notEqual(a, b, "random IV → different ciphertext");
  assert.equal(decryptSecret(a), "same");
  assert.equal(decryptSecret(b), "same");
});

test("hashToken is deterministic 64-hex and hides the token", async () => {
  const { hashToken } = await import("./secrets");
  const h = hashToken("invite-token-xyz");
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, hashToken("invite-token-xyz"));
  assert.ok(!h.includes("invite-token-xyz"));
});
