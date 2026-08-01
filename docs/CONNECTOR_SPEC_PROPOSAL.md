# A declarative connector spec and a generic prober

**PROPOSAL. Nothing here is built.** Written after the Close event-log
investigation cost four rounds, a production deploy and a custom prober to find
something stated in the first paragraph of the provider's documentation.

Two parts: what the Close finding actually is once checked against the code
(section 1), and what to build so the next one is caught by a machine instead of
by a person re-reading docs (sections 2–5).

---

## 1. The Close findings, verified against the code

All five hold. Two are worse than stated and one has a consequence worth
deciding before anything is written.

### 1.1 The filter is `date_updated`, not `date_created` — and our bound has never worked

`src/connectors/close.ts:344` sends `date_created__gte` on every poll request,
and `:495` sends it again in `testFetchLatest`. If the endpoint only accepts
`date_updated__gte` / `date_updated__lte` and silently drops unknown params, then
**every request Close has ever served us was unbounded**.

That reframes `FIRST_SYNC_DAYS`. It is not belt-and-braces that happens to
duplicate a provider limit — it is a bound that has never once been applied. The
only thing that has ever limited a Close first sync is the provider's own 30-day
retention. The connector's 43-line docstring explaining why the bound is
load-bearing describes a request parameter the server was throwing away.

Nothing was lost, because the retention window and our intended window are both
30 days. That is luck, not design.

### 1.2 The peek is not merely useless — it is a provable duplicate request

`FIRST_RUNG_DAYS` (`close.ts:97`) opens a first sync with one request bounded to
the last day, then steps out to the full 30. Both requests differ **only** in
`date_created__gte`. With that param dropped, the peek request and the target
request are byte-identical, and the step-out clears `cur.cont` — so a first sync
issues the same request twice and re-reads page 1.

Dropping it removes `FIRST_RUNG_DAYS`, the peek gate, the step-out branch, the
coverage-mark clearing that exists only to stop the peek overstating progress,
and the `PREVIEW_*` search in `testFetchLatest`: **100 lines**, all of which exist
to work around a bound that was never applied and an ordering field that was
never checked.

### 1.3 C4 checks the wrong field, in two places

`dateMs()` (`close.ts:550`) reads `date_created`, and `isNewestFirst()` (`:559`)
orders by it. `scripts/verify-close-pagination.ts` does the same throughout
(C2, C4, C8). If the log is ordered by `date_updated`, every one of those checks
is asking about a field the provider never claimed to sort on.

The 20-line "THE ORDERING, settled" docstring at `close.ts:45-64` is therefore
right about the *direction* and wrong about the *axis* — which is the more
dangerous half, because it reads as settled.

### 1.4 Two fields, two jobs — and one consequence to decide

Confirmed: `cur.hw`, `maxSeen`, `covLo` and `covHi` are all computed from
`date_created` (`close.ts:391-394`), while `occurredAt` is also `date_created`
(`:573`). Your fix is right — the watermark must be the frontier of the field the
filter uses, or it is not a frontier at all.

Two things fall out that are not in your list:

**Stored cursors need no migration.** Existing cursors hold `date_created`
values. Read as a `date_updated` floor they sit *lower* than the true frontier
(`date_created ≤ date_updated` always), so the first sweep after the change
over-reads and `event_id` dedup absorbs it. Safe in the one direction that
matters.

**`importProgress` changes meaning, and would say something false.** `covLo` /
`covHi` become a span of `date_updated`, but the note renders as *"covering 12 of
30 days"* and a user reads that as *how much history do I have* — a `date_created`
question. On a workspace where old records are edited, a `date_updated` span of
30 days can hold records created over years, or a `date_updated` span of 2 days
can hold a full month of history. Either way the sentence is wrong.

Options, in order of preference:

1. Track **both**: `hw` on `date_updated` (correctness), coverage marks on
   `date_created` (honesty). Two marks, two jobs — the same argument as the fix
   itself, applied one layer up. Cheap: four lines in the ingest loop.
2. Say what it actually measures: *"covering 12 of 30 days of changes"*.
3. Drop `importProgress` for Close. Worst option — it exists because a number
   that climbs for days with no explanation is what started all of this.

I would take (1). It is the only one where the number means what it says.

### 1.5 Phase 9 is unblocked

`object_type` and `action` as filters means the request-shaping flowField can
request only the six types `canonicalType` maps (`close.ts:211-222`) instead of
every field edit and note change. The plan gated Phase 9 on Phase 6 (the backfill
lane, because per-flow scoping makes Close a Records-class stream) — **that
dependency is now satisfied**: `src/lib/backfill/jobs.ts` and `run.ts` are on
`main` with three test files.

### 1.6 The check that would have caught this already exists

`scripts/verify-close-pagination.ts:432` compares a bounded request's id set
against an unbounded control and prints:

> `IDENTICAL id sets (N events) — the bound changed nothing, i.e. date_created__gte was IGNORED`

C5 is exactly the right test. It has never run to completion — an earlier live
run aborted before reaching it (`STATE.md`, "What is blocked").

**This is the whole lesson, and it is not "we should have read the docs".** The
correct check was written, in the correct form, by the correct instinct — and
then parked behind a live API key, a manual GitHub Action and a human
remembering to look at the output. The proposal below is mostly about moving
that class of check from *a script someone runs* to *a gate a connector cannot
ship without passing*.

---

## 2. The measurement you asked for

Measured, not estimated. Line counts are `wc -l`; classification is by explicit
line range across the three files you named.

### 2.1 First correction: the 3,721 is not all per-app

| | lines |
|---|---|
| **Shared infrastructure** — `types.ts` 463, `catalog.ts` 445, `field-utils.ts` 197, `registry.ts` 31 | **1,136** |
| **Per-app connectors** — close 583, calendly 526, gsheets 392, instantly 373, sendblue 337, gcal 242, catch-hook 132 | **2,585** |
| total | 3,721 |

So the addressable surface is **2,585 lines across seven connectors**, not 3,721.
Of the per-app lines, **43% are comments** (1,016 of 2,389 non-blank) — close.ts
alone is 52% comment. That matters for what "absorbed" means: see 2.4.

### 2.2 The three files, classified

**Absorbed by declaration** = the value becomes a field in the spec.
**Absorbed by runtime** = generic code the framework writes once for everyone.
**Deleted** = exists only to work around something the spec makes correct.
**Irreducible** = genuinely this provider, and stays hand-written.

| | close.ts | sendblue.ts | calendly.ts | total |
|---|---|---|---|---|
| total lines | 583 | 337 | 526 | 1,446 |
| absorbed by declaration | 67 | 31 | 62 | 160 |
| absorbed by runtime | 343 | 196 | 116 | 655 |
| deleted outright | 100 | 0 | 0 | 100 |
| **irreducible** | **73** | **110** | **348** | **531** |
| **irreducible %** | **13%** | **33%** | **66%** | **37%** |

### 2.3 What is irreducible, concretely

- **close.ts (73)** — `canonicalType` map (13), `verifySignature` (8),
  `normalize` (22), `registerWebhook`'s subscription payload (18), `mapEvent`
  (12).
- **sendblue.ts (110)** — six candidate secret-header names (9),
  `verifySignature` (14), `verifyWebhookSubscription` (26), `messageDate`'s
  four-field fallback (3), `toCanonical` incl. the one-row-per-message lifecycle
  collapse (42), `deliveryStage` (13), `normalize` (3).
- **calendly.ts (348)** — the two-sided outward-from-now scan and its cursor
  (~144), `listOptions` config pickers (48), `identity` / `resolveTarget` /
  `scopeOf` (45), `bookedEvent` + `canceledEvent` dual-row semantics (39),
  `meetingFacts` flattening (31), `normalize` (22), `verifySignature` (11),
  `EVENT_TYPE_MAP` (8).

### 2.4 The honest reading

**The spread is the finding, not the average.** A spec pays for itself on
connectors shaped like Close and Sendblue — a list endpoint, a date filter, a
cursor or offset, newest-first — and pays for almost nothing on Calendly, whose
outward-alternating traversal, config pickers and dual-row semantics are all
genuinely its own. Quoting "63% absorbed" as a single number would be the kind of
average that hides the thing you need to know.

**Half the absorbed lines are prose, and prose does not vanish.** The single
biggest absorbable block is the `{hw, cont, maxSeen}` cursor: **close.ts
implements it in 91 lines, sendblue.ts in 51, instantly.ts in 20** — three
implementations of one idea, each with its own docstring explaining the same
reasoning in different words, and `calendly.ts` hand-rolls a fourth cursor
parse/serialize pair for a different shape. The framework does not delete that
reasoning. It writes it **once**, in one place, where a correction lands for
everybody instead of for whoever's file you happened to be in.

That is also the strongest single argument for doing this at all: Defect #2 (the
stranding bug) was found in Close, fixed in Close, then found again in Instantly,
then found again in Sendblue — the same defect, three times, because the walk was
written three times.

**What the numbers do not capture.** The four rounds this cost were not spent
writing lines. They were spent being *confident about the wrong thing*. A spec
whose every claim carries a citation, and whose uncited claims are refused, is
aimed at that — and there is no line count for it.

---

## 3. The declaration

One file per connector, adjacent to it, typed and validated at build. Sketch,
not final syntax:

```ts
export const closeSpec: ConnectorSpec = {
  source: "close",
  guarantee: "incremental",
  baseUrl: "https://api.close.com/api/v1",
  auth: { kind: "basic", username: "@credentials.apiKey" },

  list: {
    path: "/event/",
    itemsAt: "data",
    pageSize: { param: "_limit", value: 50,
                cite: "developer.close.com/api/resources/events — '_limit' max 50" },
    pagination: { style: "cursor", nextAt: "cursor_next", param: "_cursor",
                  expired: { status: 400 } },
    pageCap: 4,                        // ours, not theirs — no citation needed
  },

  time: {
    // The two fields, and the two jobs. Naming them separately is the fix
    // from §1.4 expressed as a constraint rather than as a convention.
    cursorField:    { path: "date_updated", filter: "date_updated__gte",
                      cite: "…filters on date_updated__gte / date_updated__lte" },
    upperBound:     { filter: "date_updated__lte", cite: "same line" },
    occurredAtField:{ path: "date_created",
                      cite: "…consolidated events keep their original date_created" },
    overlapMs: 300_000,
    retentionDays: { value: 30, cite: "'up to 30 days back in history'" },
  },

  ordering: { field: "date_updated", direction: "desc",
              cite: "'Events are always ordered by date (latest first), i.e. the date_updated field'" },

  filters: [
    { param: "object_type", cite: "…supported filters: object_type, action" },
    { param: "action",      cite: "…supported filters: object_type, action" },
  ],

  rateLimits: PROBED,   // no citation → must come from observed headers
};
```

Three rules make this worth having rather than just another config file:

1. **Every claim about the provider carries a citation.** Not a URL — the line.
   A claim with no citation is a guess and the type system says so: the field's
   type is `Cited<T>`, and the only other inhabitant is `PROBED`, which will not
   compile until a probe result for it is committed.
2. **Claims about *us* need no citation** (`pageCap`, `overlapMs` policy). The
   distinction is the point: it makes "what did the provider tell us" and "what
   did we decide" two different kinds of statement, which is exactly the
   confusion that produced a 43-line docstring about a bound that was never sent.
3. **The declaration is the only place a param name appears.** `date_created__gte`
   currently appears in two places in `close.ts` and eleven in the verify script.
   One wrong word should be one wrong word in one place.

---

## 4. The prober — and the part that cannot work

### 4.1 The uncomfortable constraint, stated first

**A CI prober cannot catch the bug that started this.** The bug is that the
server silently ignores an unknown parameter. Any mock will honour whatever the
declaration says, because the mock is built from the declaration. Running it
against a fixture proves the code agrees with itself.

So the prober is two lanes, and pretending otherwise would be the same mistake
one level up:

| lane | needs | catches | runs |
|---|---|---|---|
| **contract** | nothing | bugs in *our* code | every CI run |
| **live** | provider credentials | bugs in *our beliefs* | once per connector, before it ships, and on a schedule after |

### 4.2 Contract lane (CI, free, every push)

Generalizes `tests/stranding-contract.test.ts`, which already runs four
connectors through a synthetic burst. Driven by the declaration, so a new
connector gets all of it by declaring:

- **Stranding** — synthesize more records than `pageCap × pageSize`, feed each
  `nextCursor` back, assert every record is reachable. (Exists; becomes generic.)
- **Cursor never skips** — no watermark advances past unread data.
- **Watermark field agreement** — the field the cursor advances on is the field
  the filter names. *This alone is §1.4, checked mechanically.*
- **Page cap holds** — the walk stops at `pageCap`, reports `incomplete`, and
  resumes from the persisted continuation.
- **Ordering is not assumed where it is not declared** — feed pages in reverse
  and assert the walk still ingests everything.
- **Undated records are ingested, not dropped** — the Sendblue `t = 0` bug.

### 4.3 Live lane (credentials, gated, evidence committed)

Each check is a *comparison*, because that is what worked:

- **Does the declared filter filter?** Bounded request vs unbounded control. If
  the id sets are identical, the parameter was ignored. **This is C5, generalized
  to every declared filter on every connector.**
- **Which field is it ordered by?** Check the declared ordering field, and check
  the others too — reporting *"ordered by date_updated, NOT by date_created"* is
  the sentence nobody had.
- **Does the upper bound exclude?** Same control comparison.
- **How deep does history go?** Walk until empty; compare against declared
  `retentionDays`.
- **What are the real rate limits?** Read the headers; fill every `PROBED`.

Output is a JSON evidence file committed next to the declaration, with a
timestamp. The build fails if a declaration has `PROBED` fields with no evidence
file, or if the evidence is older than N days. **A connector ships when the
provider has been observed, not when the docs have been read.**

### 4.4 What this would have done to the Close incident

The declaration would have carried `date_created__gte` with a citation. Writing
the citation is where a person notices the docs say `date_updated` — and if they
did not, the live lane's control comparison prints *"the bound changed nothing,
i.e. date_created__gte was IGNORED"* before the connector ships, in round one.

---

## 5. What I recommend

**Build it for the next connector only**, as you said. Concretely:

1. Fix Close by hand first (§1.1–1.5). It is the evidence base, and doing it by
   hand is what makes the spec's fields honest rather than invented.
2. Extract the declaration type + contract lane from what Close, Sendblue and
   Instantly already share — the `{hw, cont, maxSeen}` walk. Do **not** migrate
   them; run the contract lane against them as a conformance check, which is free
   and tells you whether the abstraction actually fits three real connectors
   before it has to fit a fourth.
3. Write the live lane by generalizing `verify-close-pagination.ts`, which
   already contains the technique.
4. Build connector #8 declaration-first. If it needs escape hatches, that is the
   answer: the spec covers what it covers and bespoke code stays bespoke.

**Where I would expect it to fail.** If connector #8 is Calendly-shaped —
bespoke traversal, config pickers, dual-row semantics — the spec absorbs a third
of it and the exercise looks like overhead. That is a real risk and the
measurement above says so plainly. The mitigation is that the spec's *cheapest*
and *highest-value* part is the citation discipline and the live control
comparison, and those are worth having even for a connector whose traversal is
entirely hand-written.
