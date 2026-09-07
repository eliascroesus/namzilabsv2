# Connector kit, generic OAuth, and the first twenty apps

Design specification. Approved in outline by Elias on 7 September 2026
("Kit + generic OAuth + population tests", "API-key and secret apps only" for
the first batch, "ship from docs + fixtures, flag as unprobed"). The research it
rests on is the 99-app catalogue produced the same day (ten category agents plus
a completeness critic, every docs URL fetched live), and a full read of the
connector layer and its 39 consumers.

## Summary

The connector layer is already data-driven: one catalog entry drives the
gallery, the connect form, the webhook URL, the guarantee label and the budget
keys; the registry is a Map; `connections.source` is plain text; the webhook
route is generic; four tests iterate the catalog. What is not smart is (1) OAuth
is Google-only, (2) the windowed page walk is hand-written four times and the
stranding bug was fixed three times because of it, (3) two test rosters must be
joined by hand and a missed entry silently vacates coverage, (4) three consumers
branch on a source name where the connector should declare a hook, (5) nothing
documents how to add a connector.

This spec builds a **kit** new connectors compose (not a framework the old ones
must migrate to), a **provider-agnostic OAuth** flow that Google moves onto, and
**population tests** that replace the rosters. Then it adds nineteen API-key and
secret-signed connectors, each built from the provider's live documentation with
fixture tests and a generated live prober. OAuth apps follow in a second batch
once Elias has registered developer apps.

## Goals and non-goals

Goals
- Adding a connector is one module built on the kit, one catalog entry, one test
  file and one prober. No roster to join, no brand map to edit, no route to add.
- Every provider fact in a catalog entry cites the doc URL and the date it was
  read. Every new connector records whether a live prober has run.
- The seven existing connectors keep their tests and behaviour untouched.
- Reliability and accuracy first: every behavioural change gets a test that fails
  on the old code; no new path writes events without marking staleness.

Non-goals
- Migrating Close, Calendly, Instantly, Whop, Sheets, Calendar or the catch-hook
  onto the kit. They stay as they are.
- The declarative `ConnectorSpec` from `docs/CONNECTOR_SPEC_PROPOSAL.md`. The kit
  absorbs the same duplicated code as functions rather than as a typed spec; the
  proposal's live-gate idea survives as the per-connector prober.
- Any change to the flow builder's UI (off-limits by standing instruction).
- OAuth connectors in batch 1. The abstraction is built and Google proves it;
  HubSpot, Shopify, Salesforce, Zendesk, Front, QuickBooks, Xero and the ads
  platforms wait for developer-app credentials.

## Decisions already made by the owner

1. Kit + generic OAuth + population tests; the existing seven are not migrated.
2. Batch 1 is API-key and secret apps only.
3. Nothing is live-probed now. Each connector ships from docs and fixtures with
   `verified.live: null`; a prober script is generated so it can run the moment a
   key exists.

## Part 1 — the kit (`src/connectors/kit/`)

Composable helpers. A connector imports what it needs; nothing is required.

**`walk.ts` — `windowedWalk`.** The `{hw, cont, maxSeen, floor, covLo, covHi}`
walk generalised from Close (91 lines), Instantly (20) and Whop, written once and
tested once. Same cursor encoding as Close so `holdsWindowContinuation`,
`cursorSaysImporting` and the tests' `hwMark` keep working unchanged.

```ts
type WindowedWalkOpts<Row> = {
  cursor: string | null;                 // PollArgs.cursor
  budget?: PollBudget;                   // PollArgs.budget
  windowFloor?: Date | null;             // PollArgs.windowFloor
  defaults: { pagesPerPoll: number; maxPagesPerPoll: number; firstSyncDays: number; overlapMs: number };
  fetchPage: (q: { since: Date; cont: string | null }) =>
    Promise<{ rows: Row[]; next: string | null; rateLimit?: ObservedRateLimit | null }>;
  changedAt: (row: Row) => string | null;   // the axis the provider FILTERS on — the watermark
  happenedAt?: (row: Row) => string | null; // the coverage axis; defaults to changedAt
  map: (row: Row) => CanonicalEvent | null;
  expiredContinuation?: (err: unknown) => boolean; // e.g. HttpError 400 → drop cont, resume from hw
};
export function windowedWalk<Row>(o: WindowedWalkOpts<Row>): Promise<PollResult>;
export function walkImportProgress(cursor: string | null, now?: number): ImportCoverage | null;
```

Semantics, pinned by tests: page cap = `min(maxPagesPerPoll, budget.maxCalls)`
else `pagesPerPoll`; deadline checked between pages; first sync bounds at
`firstSyncDays` unless `windowFloor` is deeper; overlap subtracted from `hw`;
records deduped by `eventId` within a poll; a drained window settles to a bare
`hw` string; an unfinished window returns `incomplete: true` with
`importProgress`; an expired continuation restarts from `hw` without loss;
`providerCalls` and `rateLimit` reported.

**`paged.ts` — `drainPages`.** The simpler loop for `listOptions` and whole-window
reads: follow `next` under a page cap, no watermark.

**`verify.ts` — signature schemes, each fails closed without a secret.**
- `standardWebhooksVerify` — `webhook-id`.`webhook-timestamp`.body, `v1,`
  base64, timestamp freshness (Stripe-style Svix, Whop, Retell, many others).
- `timestampedHmacVerify` — `t=…,v1=…` style with a caller-supplied message
  builder (Stripe `Stripe-Signature`, Paddle `ts;h1`, OnceHub `t=,s=`).
- `hmacHeaderVerify` — one header carrying hex or base64 HMAC over the raw body
  with an optional `sha256=` prefix (Cal.com, Typeform, Thinkific, Help Scout,
  Attio, Tally).
- `sharedTokenVerify` — a bare token compared in constant time (Lemlist,
  providers with no HMAC), documented as weaker.

**`http.ts`** — `bearerJson`, `basicJson`, `headerKeyJson` over `fetchJson`:
capture `parseRateLimit` via `onResponse`, map 401 to a reconnect hint naming the
provider, keep `HttpError` for everything else.

**`ids.ts`** — `eventId(source, connectionId, ...parts)` and `naturalOrHash`.
**`dates.ts`** — `parseDate`, `ymd`, `epochToDate(v, "s" | "ms")`.

Tests: `tests/kit-windowed-walk.test.ts` (stranding burst, page cap, deadline,
expired continuation, overlap, floor, settle, importProgress span),
`tests/kit-verify.test.ts` (every scheme: valid, wrong secret, missing header,
stale timestamp, no secret), `tests/kit-http.test.ts`.

## Part 2 — connector hooks replace the source-name branches

- `Connector.importProgress?(cursor, now?)` → `ImportCoverage | null`.
  `import-status.ts` calls it instead of `c.source === "close" ? … : null`. Close
  sets `importProgress: closeImportProgress`; behaviour identical; the
  connections page test pins the same output for a Close cursor.
- `Connector.retention?: { days: number; watermarkOf: (cursor) => string | null }`.
  `invariants.ts` runs one generic cursor-lag scan over every connector that
  declares it; Close declares `{ days: 30, watermarkOf: (c) => parseCloseCursor(c).hw }`.
  The log line becomes `[cursor-lag] source=close …`; `tests/invariant-scan.test.ts`
  is updated to the new shape with the old finding still produced.
- The Sheets `DateColumnField` branch in the builder stays (UI, off-limits, and
  no batch-1 connector is a timestamp-less mirror).

## Part 3 — catalog additions

- `brand: { color: string; short: string }` — required. The seven existing
  entries gain it; `source-style.ts` becomes a catalog lookup with the same
  neutral fallback and the same export, so the builder's imports do not change.
- `connect: "apiKey" | "google" | "oauth"` and `oauthProvider?: string`. The two
  Google entries keep `"google"` (routed through the generic flow).
- `docs: { url: string; readOn: string; webhooks?: string }` — required on every
  entry whose `source` is not one of the legacy seven. Provenance for rate limits
  and field names lives in the entry's comments next to the figure, as Instantly
  already does.
- `verified?: { live: string | null }` — `null` means unprobed. Not rendered in
  the product; `scripts/connector-inventory.ts` prints the table.

## Part 4 — generic OAuth

- `src/lib/oauth/providers.ts`: `OAuthProvider = { key, authorizeUrl, tokenUrl,
  scopesFor(source), clientIdEnv, clientSecretEnv, pkce?, extraAuthParams?,
  refresh: "standard" | "none", identity?(tokens) }` and `OAUTH_PROVIDERS` with
  `google` (scopes per source exactly as `GOOGLE_SCOPES` today).
- `src/lib/oauth/flow.ts`: `buildAuthUrl`, `exchangeCode`, `refreshTokens` —
  the current Google code generalised (form-encoded token exchange, `expiresAt`
  from `expires_in`, refresh token preserved when the refresh omits it).
- `src/lib/oauth-state.ts`: state carries `{ nonce, provider, source }`;
  `parseOAuthState` validates `source` against the catalog instead of a two-name
  union. `GoogleSource` stays exported for the existing test.
- Routes: `src/app/api/oauth/[provider]/start` and `callback`. The Google routes
  stay as thin delegates so the redirect URIs registered in Google Cloud keep
  working. Error codes unchanged (`integrations-errors.test.ts` gains the new
  route files as emitters).
- `credentials.ts`: refresh when the entry's provider says `refresh: "standard"`
  and the token is within 60 s of expiry; the `isGoogle` literal is gone. The
  `invalid_grant` message names the provider.
- `integrations/page.tsx` builds `oauthHref` from `connect`/`oauthProvider`.
- Tests: `oauth-state` extended for the provider field; `oauth-providers.test.ts`
  pins Google's authorize URL and scopes byte-for-byte against the old builder
  so the migration is provably a no-op; a route test covers a non-Google
  provider end-to-end with a stubbed token endpoint.

## Part 5 — population tests

- `connectors-signatures.test.ts` "who may accept an unsigned request": iterate
  `CONNECTOR_CATALOG` → `getConnector`; the open set must equal `["webhook"]`.
- `held-continuation.test.ts`: the explicit five become "every registered
  connector either omits `holdsContinuation` or returns false for `null` and for
  a bare string"; the Close/Instantly positive cases stay.
- New `tests/connector-population.test.ts`: every catalog entry has a registered
  connector and vice versa; `brand` present; non-legacy entries carry
  `docs.readOn` in `YYYY-MM-DD` form; `authType` agrees with `connect`; `instant`
  ⇒ `verifySignature` fails closed without a secret (webhook excepted); `poll` ⇒
  `poll` defined; `autoWebhook` ⇒ `registerWebhook` defined; a `dynamic`
  flowField ⇒ `listOptions` defined; `connect: "oauth"` ⇒ `oauthProvider` is a
  registered provider.

## Part 6 — scaffold, prober harness, docs

- `scripts/new-connector.ts <source> --name … --auth apiKey|secret|oauth
  [--instant] [--poll]` writes the connector module from a kit template, the
  catalog entry with `docs.readOn` left as a marker the population test rejects,
  the registry line, `tests/<source>.test.ts` and `scripts/verify-<source>.ts`.
- `scripts/lib/probe.ts`: `check`, `note`, `skip`, `head`, `section`, `attempt`
  extracted from `verify-close-pagination.ts` (the three existing probers are
  left untouched). A prober prints measurements and asserts only comparisons
  between its own responses, per the proposal doc's rule.
- `.github/workflows/verify-providers.yml`: the three bespoke steps stay; one
  generic step runs every `scripts/verify-<source>.ts` whose `<SOURCE>_API_KEY`
  secret is set and skips the rest with a warning.
- `docs/ADDING_A_CONNECTOR.md`: the checklist; the dating rule (`occurredAt` is
  when it happened; scheduled and forecast dates go in `properties`); the eventId
  rule; fail-closed verification; what the population test enforces; how to run a
  prober. `docs/DATA_MODEL.md`'s guarantee table and
  `docs/HOW_THE_BACKEND_WORKS.md` §4 are updated.

## Part 7 — batch 1, nineteen connectors

Each: catalog entry (`docs`, `brand`, cited `rateLimits`, `eventTypeLabels`,
`commonFields`, `flowFields` where stream-scoped), a module on the kit, a test
file (verify: valid/invalid/missing/stale/no-secret; normalize: every event type
→ eventType, occurredAt, subject, value; poll: walk under budget, cursor
round-trip, stranding burst), and a prober. Built by reading the provider's docs
live for endpoints, params, timestamp fields, signature scheme and limits.

| source | auth | instant | poll | scope |
|---|---|---|---|---|
| stripe | secret key + pasted `webhookSecret` | `Stripe-Signature` t=,v1= | `/v1/events` created[gte], 30-day horizon | connection |
| calcom | API key | `x-cal-signature-256` hex | `/v2/bookings` afterCreatedAt | connection |
| aircall | api_id:api_token (basic) | token/HMAC per docs | `/v1/calls` from= | connection |
| pipedrive | api_token | v2 webhooks, basic auth | deals + stage changelog | connection |
| attio | bearer | `Attio-Signature` hex | records query, `active_from` | connection |
| typeform | personal token | `Typeform-Signature` base64 | `/forms/{id}/responses` since | stream (form) |
| tally | API key | `tally-signature` | `/forms/{id}/submissions` | stream (form) |
| smartlead | API key | HMAC (header unconfirmed) | campaign statistics | stream (campaign) |
| lemlist | basic `:key` | shared token in body | `/activities` | connection |
| helpscout | app id/secret (client credentials) | `X-HelpScout-Signature` base64 | `/v2/conversations` modifiedSince | connection |
| paddle | bearer | `Paddle-Signature` ts;h1 | `/events` after, 90-day horizon | connection |
| justcall | key:secret | per docs | `/v2.1/calls` | connection |
| thrivecart | pasted secret | secret compare | — (webhook-only) | connection |
| thinkific | subdomain + key | `X-Thinkific-Hmac-Sha256` | orders, enrollments | connection |
| savvycal | bearer | per docs | `/v1/events` | connection |
| oncehub | `API-Key` header | `Oncehub-Signature` t=,s= | `/bookings` | connection |
| customerio | app API bearer | `X-CIO-Signature` | limited; webhook-primary | connection |
| airtable | PAT | webhooks API MAC (7-day expiry → refresh) | records list, mirror | stream (base, table) |
| retell | bearer | `x-retell-signature` | `/v2/list-calls`, epoch ms | connection |

Build order: Stripe, Cal.com, Aircall, Pipedrive, Typeform, Tally, Smartlead,
Help Scout, Attio, Lemlist, Paddle, JustCall, OnceHub, SavvyCal, Thinkific,
ThriveCart, Retell, Customer.io, Airtable.

Where the research flagged a dating trap the connector dates by when the thing
happened and stores the scheduled or forecast date in `properties`. Where a
provider retains less history than a customer expects (Stripe 30 days, Paddle 90)
the entry carries a `historyNote`.

## Part 8 — verification and delivery

- Gates per module: `pnpm typecheck`, `pnpm check:orphans`, `pnpm check:ui`, the
  module's tests. Full `pnpm test` at each push with the dev server stopped
  (`pnpm vitest run --maxWorkers=2` when the machine is busy).
- Worktree `worktree-figma-overview-match`; pushed to `origin/main` when green,
  in legible batches: infra (Parts 1–6) first, then connectors in groups of
  four to six.
- Elias does nothing for batch 1. For batch 2 he registers OAuth apps and sets
  `<PROVIDER>_CLIENT_ID` / `_SECRET` in Vercel. For live probing he adds
  `<SOURCE>_API_KEY` repository secrets.
