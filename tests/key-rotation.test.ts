import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { decrypt, decryptStored, encrypt, getEncryptionKey } from "@/lib/crypto";
import { rotateCiphertext } from "../scripts/rotate-encryption-key";

/**
 * ROTATING THE KEY THAT PROTECTS EVERY STORED CREDENTIAL.
 *
 * The Sep 2026 audit's finding was that this was impossible: one key, no way to
 * change it, so a suspected compromise had two options — do nothing, or break
 * every connection in the product at once.
 *
 * THE PROPERTY THE WHOLE DESIGN RESTS ON is that AES-GCM is AUTHENTICATED: a
 * wrong key FAILS rather than returning plausible garbage. "Try the new key,
 * then the old" is only safe because of that, and it is the first thing
 * asserted below — if it ever stopped being true (somebody switching the mode
 * to CBC, say) every other guarantee here would become silent corruption
 * instead of a visible error.
 */

const ORIGINAL = process.env.ENCRYPTION_KEY;
const ORIGINAL_PREV = process.env.ENCRYPTION_KEY_PREVIOUS;

const b64 = () => randomBytes(32).toString("base64");

afterEach(() => {
  // Restored explicitly: these are process-wide, and a leaked key variable
  // would change the behaviour of whatever test file runs next.
  if (ORIGINAL === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL;
  if (ORIGINAL_PREV === undefined) delete process.env.ENCRYPTION_KEY_PREVIOUS;
  else process.env.ENCRYPTION_KEY_PREVIOUS = ORIGINAL_PREV;
});

describe("the assumption underneath the fallback", () => {
  it("fails on the wrong key rather than returning garbage", () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    const payload = encrypt("a refresh token", a);
    // If this ever RETURNS instead of throwing, `decryptStored` is silently
    // handing wrong plaintext to connectors and the rotation script is
    // re-encrypting nonsense. It is the load-bearing assumption, so it is the
    // first test.
    expect(() => decrypt(payload, b)).toThrow();
    expect(decrypt(payload, a)).toBe("a refresh token");
  });

  it("gives every encryption a fresh nonce", () => {
    // Same plaintext, same key, different ciphertext — GCM's requirement, and
    // the reason rotating produces a new payload even for an unchanged secret.
    const key = randomBytes(32);
    expect(encrypt("same", key)).not.toBe(encrypt("same", key));
  });
});

describe("decryptStored during a rotation", () => {
  it("reads the current key with no previous key set", () => {
    process.env.ENCRYPTION_KEY = b64();
    delete process.env.ENCRYPTION_KEY_PREVIOUS;
    const payload = encrypt("hello", getEncryptionKey());
    expect(decryptStored(payload)).toBe("hello");
  });

  it("falls back to the previous key for anything already stored", () => {
    // What step 1 of a rotation looks like: the key changed under data that
    // was written before it did.
    const oldKey = b64();
    process.env.ENCRYPTION_KEY = oldKey;
    const stored = encrypt("an api key", getEncryptionKey());

    process.env.ENCRYPTION_KEY = b64();
    process.env.ENCRYPTION_KEY_PREVIOUS = oldKey;
    expect(decryptStored(stored)).toBe("an api key");
  });

  it("still throws when NEITHER key opens it", () => {
    /**
     * The fail-closed path, and it must stay a throw. The webhook route turns
     * this into a 401 rather than "no secret configured" — its own comment
     * records that collapsing those two states WAS the exposure — and
     * `decryptCredentials` turns it into `{}` so a connection reads as broken.
     * A fallback return value in `decryptStored` would quietly undo both.
     */
    process.env.ENCRYPTION_KEY = b64();
    const orphan = encrypt("written under a key nobody has", randomBytes(32));
    process.env.ENCRYPTION_KEY_PREVIOUS = b64();
    expect(() => decryptStored(orphan)).toThrow();
  });

  it("ignores a malformed previous key instead of failing the read", () => {
    process.env.ENCRYPTION_KEY = b64();
    const payload = encrypt("readable", getEncryptionKey());
    // A typo in the outgoing key must not take down reads the CURRENT key can
    // satisfy perfectly well.
    process.env.ENCRYPTION_KEY_PREVIOUS = "not-a-32-byte-key";
    expect(decryptStored(payload)).toBe("readable");
  });
});

describe("the rotation script's decision", () => {
  const current = randomBytes(32);
  const previous = randomBytes(32);

  it("re-encrypts what only the old key opens", () => {
    const stored = encrypt("secret-value", previous);
    const { outcome, next } = rotateCiphertext(stored, current, previous);
    expect(outcome).toBe("rotated");
    expect(next).not.toBeNull();
    expect(next).not.toBe(stored);
    // The whole point: same plaintext, now readable under the new key alone.
    expect(decrypt(next!, current)).toBe("secret-value");
    expect(() => decrypt(next!, previous)).toThrow();
  });

  it("skips what is already current, which is what makes a re-run safe", () => {
    const stored = encrypt("secret-value", current);
    const { outcome, next } = rotateCiphertext(stored, current, previous);
    expect(outcome).toBe("already-current");
    // `null` rather than a fresh re-encryption: an interrupted run is resumed
    // by running it again, and rewriting rows that need nothing would make a
    // second pass indistinguishable from a first.
    expect(next).toBeNull();
  });

  it("leaves what neither key opens completely alone", () => {
    const orphan = encrypt("from an older key", randomBytes(32));
    const { outcome, next } = rotateCiphertext(orphan, current, previous);
    expect(outcome).toBe("unreadable");
    // Reported, never destroyed — it is the only remaining chance of
    // recovering that credential.
    expect(next).toBeNull();
  });

  it("treats corrupt bytes as unreadable rather than throwing", () => {
    const { outcome } = rotateCiphertext("not base64 ciphertext at all", current, previous);
    expect(outcome).toBe("unreadable");
  });
});

describe("the rotation script's safety rails", () => {
  const script = readFileSync(join(process.cwd(), "scripts/rotate-encryption-key.ts"), "utf8");
  const body = script.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

  it("writes nothing without --live", () => {
    expect(body).toContain('const LIVE = process.argv.includes("--live")');
    // The guard sits before the write, not after it.
    const guard = body.indexOf("if (!LIVE) continue;");
    const write = body.indexOf("db.update(connections)");
    expect(guard, "the --live guard must come before the update").toBeGreaterThan(0);
    expect(guard).toBeLessThan(write);
  });

  it("refuses a rotation where both keys are the same", () => {
    expect(body).toMatch(/current\.equals\(previous\)/);
  });

  it("prints no plaintext and no key", () => {
    /**
     * Every VALUE a `console.*` call would print, checked for the identifiers
     * that hold a secret. A rotation script that leaks what it protects into a
     * terminal scrollback has defeated its own purpose.
     *
     * THE MESSAGE TEXT IS NOT THE VALUE, and separating the two is the whole
     * substance of this check — the first version failed on its own output,
     * because "already under the current key" contains the word `current`. So
     * the literal text is dropped and only the interpolations and bare
     * arguments are examined: `${rowsWritten}` is a value, "the current key"
     * is a label.
     */
    const logged = [...body.matchAll(/console\.\w+\(([^;]*)\)/g)].map((m) => m[1]);
    expect(logged.length, "no console calls found — this check would pass vacuously").toBeGreaterThan(5);

    const values: string[] = [];
    for (const args of logged) {
      /**
       * Interpolated expressions inside template literals ARE values — with
       * their own quoted strings stripped, because a PROPERTY KEY is not a
       * value either: `tally["already-current"]` prints a count, and the word
       * `current` in it names a bucket rather than a key.
       */
      for (const [, expr] of args.matchAll(/\$\{([^}]*)\}/g)) values.push(expr.replace(/"[^"]*"|'[^']*'/g, ""));
      // Then drop every literal, leaving bare arguments (a variable logged
      // directly, which is the other way a secret gets printed).
      values.push(args.replace(/`[^`]*`|"[^"]*"|'[^']*'/g, ""));
    }
    // Would pass vacuously on a script that only ever logged literals; this
    // script interpolates counts, so there is something to check.
    expect(values.some((v) => /rowsWritten|tally|rows\.length/.test(v)), "no interpolated values found").toBe(true);

    for (const value of values) {
      expect(value, `a console call prints a secret: ${value.trim().slice(0, 80)}`).not.toMatch(
        /\bplaintext\b|\bcurrent\b|\bprevious\b|\bpayload\b|\bnext\b|previousRaw|getEncryptionKey/,
      );
    }
  });
});
