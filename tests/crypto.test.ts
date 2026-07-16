import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { encrypt, decrypt } from "@/lib/crypto";

describe("crypto (AES-256-GCM)", () => {
  const key = randomBytes(32);

  it("round-trips plaintext", () => {
    const secret = "sk_live_super_secret_token_12345";
    const enc = encrypt(secret, key);
    expect(enc).not.toContain(secret);
    expect(decrypt(enc, key)).toBe(secret);
  });

  it("produces different ciphertext each time (random IV)", () => {
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });

  it("fails to decrypt tampered ciphertext (auth tag)", () => {
    const enc = encrypt("hello", key);
    const buf = Buffer.from(enc, "base64");
    buf[buf.length - 1] ^= 0xff; // flip a ciphertext bit
    expect(() => decrypt(buf.toString("base64"), key)).toThrow();
  });

  it("fails to decrypt with the wrong key", () => {
    const enc = encrypt("hello", key);
    expect(() => decrypt(enc, randomBytes(32))).toThrow();
  });
});
