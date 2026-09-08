/**
 * What a sender actually POSTs, turned into something a flow can read.
 *
 * The catch-hook's promise is "point any app at this URL". A JSON-only reader
 * breaks that promise for the two commonest non-JSON shapes on the web —
 * `application/x-www-form-urlencoded` (every PHP cart, most WordPress plugins,
 * Twilio, a great many "post to a URL" features) and JSON sent with a wrong or
 * absent Content-Type. Both used to land as one opaque `{_raw: "..."}` string
 * with no readable field, which is indistinguishable from a broken integration.
 *
 * The rules, in order, and each one exists because a real sender needs it:
 *
 * 1. SNIFF, DO NOT TRUST. Content-Type is a hint. A body that starts with `{`
 *    or `[` is parsed as JSON whatever the header claims, because senders
 *    routinely post JSON as `text/plain` or with no header at all.
 * 2. FORM BODIES ARE OBJECTS. `a=1&b=2` becomes `{a: "1", b: "2"}`. A repeated
 *    key becomes an array — that is what the form encoding means, and dropping
 *    all but the last would silently lose data.
 * 3. THE QUERY STRING IS PART OF THE PAYLOAD. Senders put identity and routing
 *    in the URL (`?source=fb&tenant=acme`). Zapier merges it; so do we. The
 *    BODY WINS on a collision: it is the primary channel, and a query param
 *    that shadowed a body field would be a silent overwrite.
 * 4. NOTHING IS EVER LOST. A body we cannot parse is still stored, verbatim,
 *    under `_raw`, alongside `_contentType` — so a customer can see what they
 *    sent and we can add a parser later without having discarded the evidence.
 */

export type ParsedBody =
  | { kind: "json"; payload: unknown }
  | { kind: "form"; payload: Record<string, unknown> }
  | { kind: "raw"; payload: Record<string, unknown> }
  | { kind: "empty"; payload: Record<string, unknown> };

/** `a=1&a=2` is a repeated key and means a list; `a=1` is a scalar. */
function formToObject(raw: string): Record<string, unknown> {
  const params = new URLSearchParams(raw);
  const out: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    out[key] = all.length > 1 ? all : all[0];
  }
  return out;
}

function looksLikeJson(body: string): boolean {
  const t = body.trimStart();
  return t.startsWith("{") || t.startsWith("[");
}

function looksLikeForm(body: string): boolean {
  // At least one `k=v` pair and no whitespace outside the values — enough to
  // separate `a=1&b=2` from a sentence that happens to contain an equals sign.
  return /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body.trim());
}

/**
 * Turn a raw request body into a payload object.
 *
 * `contentType` is the header as received (may be null, may carry a charset).
 * `query` is the inbound URL's search params, merged under rule 3 above.
 */
export function parseWebhookBody(rawBody: string, contentType: string | null, query?: URLSearchParams): ParsedBody {
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  const body = rawBody ?? "";
  const queryFields = query ? formToObject(query.toString()) : {};
  const hasQuery = Object.keys(queryFields).length > 0;

  /** Body wins: a query param never shadows a field the sender put in the body. */
  const withQuery = (payload: unknown): unknown => {
    if (!hasQuery) return payload;
    if (payload && typeof payload === "object" && !Array.isArray(payload)) {
      return { ...queryFields, ...(payload as Record<string, unknown>) };
    }
    return payload;
  };

  if (!body.trim()) {
    // An empty body with a query string is a real delivery shape — some senders
    // put the whole event in the URL. With neither, it is a ping.
    return { kind: "empty", payload: queryFields };
  }

  if (looksLikeJson(body)) {
    try {
      return { kind: "json", payload: withQuery(JSON.parse(body)) };
    } catch {
      // Falls through: a body that opens like JSON but is malformed is kept raw
      // rather than guessed at.
    }
  }

  if (type === "application/x-www-form-urlencoded" || (!type && looksLikeForm(body)) || (type.startsWith("text/") && looksLikeForm(body))) {
    return { kind: "form", payload: { ...queryFields, ...formToObject(body) } };
  }

  if (type === "application/json" || type.endsWith("+json")) {
    try {
      return { kind: "json", payload: withQuery(JSON.parse(body)) };
    } catch {
      /* keep raw */
    }
  }

  return { kind: "raw", payload: { ...queryFields, _raw: body, _contentType: type || null } };
}

/**
 * The verification handshake several platforms require before they will save a
 * URL: a GET carrying a challenge that must be echoed back verbatim.
 *
 * Meta/Facebook and a number of others use `hub.challenge`; others use plainer
 * spellings. Returning the value as the whole body is what every one of them
 * expects. With no challenge present this is simply a liveness check, which is
 * also what a customer pasting the URL into a browser is doing.
 */
export const CHALLENGE_PARAMS = ["hub.challenge", "challenge", "crc_token", "validationToken"] as const;

export function challengeFrom(query: URLSearchParams): string | null {
  for (const key of CHALLENGE_PARAMS) {
    const v = query.get(key);
    if (v) return v;
  }
  return null;
}
