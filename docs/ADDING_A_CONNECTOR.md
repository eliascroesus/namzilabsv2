# Adding a connector

One module, one catalog entry, one registry line, one test file, one prober.
Nothing else: no roster to join, no brand map, no route. The population test
(`tests/connector-population.test.ts`) tells you what you forgot.

## 1. Read the docs first, and write down when

Open the provider's API reference and webhook guide. For every fact the
connector relies on — base URL, list endpoint, the parameter that FILTERS by
time, the field that says when a record CHANGED, the field that says when the
thing HAPPENED, page size and pagination style, the signature scheme, rate
limits, history retention — note the page and the date. They go on the catalog
entry (`docs: { url, readOn, webhooks }`) and in comments next to each figure,
the way the Instantly entry cites its rate limit. A claim without a date is
folklore.

## 2. Scaffold

    pnpm connector:new <source> --name "<Name>" --auth apiKey|secret|oauth [--instant] [--poll] [--stream <fieldKey>]

- `--instant`: the provider delivers webhooks. You will implement
  `verifySignature` (fails closed: no secret, no acceptance) and `normalize`.
- `--poll`: the provider has a dated list endpoint. You will implement `poll`
  on `windowedWalk` from `src/connectors/kit`.
- `--stream <fieldKey>`: the resource is chosen per flow (a form, a campaign,
  a base). The flow field is declared on the entry and `listOptions` lists them.

Paste the printed catalog entry into `CONNECTOR_CATALOG` and the registry line
into `registry.ts`. Replace every `FILL-ME`. Pick the brand colour from the
vendor's own guidelines.

## 3. The four rules

**Date by when it HAPPENED.** `occurredAt` is the moment the countable thing
occurred: a booking is dated when it was booked, a payment when it settled, a
call when it started. A meeting's start time, a deal's forecast close date, an
SLA deadline and an accountant's editable transaction date are NOT that; keep
them in `properties`. Every window on the dashboard excludes the future.

**The watermark is the field the provider FILTERS on.** `changedAt` in
`windowedWalk` must be the same field the request bounds with `since`. Close
sent `date_created__gte` while the API filtered on `date_updated`, and every
request was unbounded for months.

**Fail closed.** `verifySignature` returns false without a secret. The only
open endpoint is the custom webhook, whose openness is the product.

**Namespace every id.** `eventId(source, connectionId, …)` — two customers'
record 42 must never collide, and neither must two of one customer's resources
(embed the stream hash where natural ids repeat across resources).

## 4. What the kit gives you

- `windowedWalk` — cursor-forward polling with overlap, bounded by budget and
  deadline, that never strands a record. Same cursor grammar as Close.
- `standardWebhooksVerify`, `timestampedHmacVerify`, `hmacHeaderVerify`,
  `sharedTokenVerify` — every signature scheme seen so far.
- `bearerClient` / `basicClient` / `headerKeyClient` — URL joining, params,
  rate-limit capture, a 401 that says "reconnect".
- `eventId`, `naturalOrHash`, `epochToDate`, `ymd`, `isoOrNull`, `parseDate`.

Budgets: declare `operations` and the matching `rateLimits` keys, or leave both
off for a provider with one account-wide limit (`"*"`).

## 5. Tests that must exist

`tests/<source>.test.ts` covers: signature (valid, wrong secret, missing
header, stale timestamp, no secret); normalize (each event type → eventType,
occurredAt, subject, value); poll (pages under a budget, cursor round trip, a
burst larger than the page cap is fully drained). The scaffold writes the
skeleton.

## 6. Verify live when you can

`scripts/verify-<source>.ts` prints measurements against a real account. Run
it the day you get a key, put the date in `verified.live`, and fix what it
contradicts. Until then the entry says `verified: { live: null }` and
`pnpm connector:inventory` shows it as unprobed. The `Verify providers`
workflow runs every prober whose `<SOURCE>_API_KEY` secret exists.

## 7. Provider forgets its history?

Declare `retention: { days, alarmAfterDays, watermarkOf }` on the connector and
add a `historyNote` to the entry. The nightly scan alarms before data behind
the watermark becomes unfetchable. Declare `importProgress` if a first sync
walks in pages, so the connection page can say "covering 12 of 30 days".
