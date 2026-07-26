/**
 * A.2 — identity normalization.
 *
 * Extracts the handles a record can be joined on later (a person's email, a
 * phone number, a provider-side id) into ONE canonical shape, so that
 * "Alice@Acme.com " from a sheet and "alice@acme.com" from a CRM are the same
 * handle. Stored on `events.identifiers` at write time.
 *
 * Deliberately conservative: this normalizes FORMAT, it does not decide that
 * two handles are the same person. Entity resolution is a later, separate
 * decision — this exists so it will not need a schema change or a re-ingest.
 */

/** Keys we look for, in priority order, when harvesting from a record. */
const EMAIL_KEYS = ["email", "email_address", "emailAddress", "contact_email", "lead_email", "to", "from", "subject"];
const PHONE_KEYS = ["phone", "phone_number", "phoneNumber", "mobile", "to_number", "from_number", "number"];

/** Lowercase + trim. (No dot/plus folding: that is provider-specific policy.) */
export function normalizeEmail(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v.includes("@") || v.startsWith("@") || v.endsWith("@") || /\s/.test(v)) return null;
  return v;
}

/**
 * E.164-ish: keep digits, preserve a leading +, and assume NANP for bare
 * 10-digit numbers (the dominant case here). Anything else is returned digit
 * -only rather than guessed at — a wrong country code is worse than none.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/[0-9]/.test(trimmed)) return null;
  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  if (digits.length < 7) return null; // too short to be a real number
  if (hadPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

export type Identifiers = { emails?: string[]; phones?: string[] };

/**
 * Harvest identifiers from a canonical event's subject + properties. Values are
 * de-duplicated and sorted, so the stored JSON is stable — an unchanged record
 * must not look "changed" to the writer's content comparison.
 */
export function extractIdentifiers(input: { subject?: string | null; properties?: Record<string, unknown> | null }): Identifiers {
  const emails = new Set<string>();
  const phones = new Set<string>();

  const consider = (key: string, value: unknown) => {
    if (typeof value !== "string" || value === "") return;
    const k = key.toLowerCase();
    if (EMAIL_KEYS.some((e) => k.includes(e.toLowerCase())) || value.includes("@")) {
      const e = normalizeEmail(value);
      if (e) emails.add(e);
    }
    if (PHONE_KEYS.some((p) => k.includes(p.toLowerCase()))) {
      const p = normalizePhone(value);
      if (p) phones.add(p);
    }
  };

  if (input.subject) consider("subject", input.subject);
  for (const [k, v] of Object.entries(input.properties ?? {})) consider(k, v);

  const out: Identifiers = {};
  if (emails.size > 0) out.emails = [...emails].sort();
  if (phones.size > 0) out.phones = [...phones].sort();
  return out;
}
