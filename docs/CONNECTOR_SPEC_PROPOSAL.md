# The live verification gate, and a declarative connector spec

**PROPOSAL.** Nothing in §1–§5 is built. The Close fix in §6 is written and sits
on branch `close/date-updated`, held until the live check in §1.5 has run —
which is the rule this document proposes, applied to itself.

Written after the Close event-log investigation cost four rounds, a production
deploy and a custom prober to find something stated in the first paragraph of
the provider's documentation.

**The order of this document is the argument.** The gate comes first because the
check that would have caught this already existed and was simply never required
to run. The declarative spec comes second because it is the smaller half of the
problem: it reduces how much there is to get wrong, but it cannot tell you
whether what you wrote down is true.

---

## 1. The gate: a connector must not reach main with an unverified claim

### 1.1 The check existed. It was parked.

`scripts/verify-close-pagination.ts:432` compares a bounded request's id set
against an unbounded control and prints:

> `IDENTICAL id sets (N events) — the bound changed nothing, i.e. date_created__gte was IGNORED`

That is exactly the right test, in exactly the right form, written by exactly
the right instinct. It has never run to completion — an earlier live run aborted
before reaching it (`STATE.md`, "What is blocked").

**So the failure was not a knowledge failure.** Nobody needed to know more about
Close. The check was behind a live API key, a manual GitHub Action, and a person
remembering to look at the output — three optional steps, each individually
reasonable, which together meant a connector shipped for months sending a
parameter the provider discards.

That is the same shape as a migration reaching main before its SQL is applied,
and this codebase already refuses to let that happen. The rule there is written
down in `STATE.md`: *paste the block, confirm it landed, then deploy the code.*
The proposal is that provider claims get the same treatment.

### 1.2 The rule

**A connector may not merge with a claim about a provider that has not been
observed.** Concretely:

1. Every provider claim is declared explicitly (§4) rather than implied by code.
2. Each claim is either **cited** (a doc line) or **probed** (an observation).
3. A cited claim is a *hypothesis*. It becomes a fact when the live prober
   confirms it, and the prober's output is committed next to the declaration as
   a dated evidence file.
4. The build fails if a declaration has claims with no evidence, or if the
   evidence is older than N days.

The last one matters more than it looks: providers change. Evidence with a date
on it is the difference between "we checked" and "someone checked once".

### 1.3 The part that cannot work, stated before the part that can

**A CI prober cannot catch the bug that started this.** The failure is a server
silently ignoring an unknown parameter. Any mock is built from the declaration,
so it will honour whatever the declaration says — running against a fixture
proves only that the code agrees with itself.

Pretending otherwise would be the same mistake one level up. So the prober is
two lanes and they catch different things:

| lane | needs | catches | runs |
|---|---|---|---|
| **contract** | nothing | bugs in *our code* | every CI run |
| **live** | provider credentials | bugs in *our beliefs* | before a connector ships, and on a schedule after |

**Only the live lane is the gate.** The contract lane is valuable and cheap and
would not have caught this.

### 1.4 Contract lane (CI, free, every push)

Generalizes `tests/stranding-contract.test.ts`, which already runs four
connectors through a synthetic burst. Driven by the declaration, so a new
connector gets all of it by declaring:

- **Stranding** — synthesize more records than `pageCap × pageSize`, feed each
  `nextCursor` back, assert every record is reachable. (Exists; becomes generic.)
- **Cursor never skips** — no watermark advances past unread data.
- **Watermark field agreement** — the field the cursor advances on is the field
  the filter names. *This is the Close §6.3 defect, checked mechanically.*
- **Page cap holds** — the walk stops at `pageCap`, reports `incomplete`, and
  resumes from the persisted continuation.
- **Ordering is not assumed where it is not declared** — feed pages reversed and
  assert the walk still ingests everything.
- **Undated records are ingested, not dropped** — the Sendblue `t = 0` bug.

One discipline the Close fix suggests: **the mock must honour only what the
provider honours.** `tests/close-poll.test.ts` now filters on `date_updated`
alone, so a connector that goes back to sending `date_created__gte` reads as
unbounded in the fixture exactly as it would live. The old mock honoured both
names, which is why every test passed while the connector was unbounded in
production.

### 1.5 Live lane (credentials, gated, evidence committed)

Every check is a **comparison**, because comparison is what works:

- **Does the declared filter filter?** Bounded request vs unbounded control.
  Identical id sets means the parameter was ignored.
- **Which field is it ordered by?** Check the declared field *and the others*.
  "Ordered by `date_updated`, NOT by `date_created`" is the sentence nobody had.
- **Do the declared filters COMBINE?** A filter that works alone and is rejected
  or ignored alongside the incremental bound is worse than no filter.
- **Does the upper bound exclude?** Same control comparison.
- **How deep does history go?** Walk until empty; compare to declared retention.
- **What are the real rate limits?** Read the headers; fill every `PROBED`.

### 1.6 The worked example: `_limit`, where the docs are the wrong source

Close's documentation states the Event Log **does not support `_limit`**. The
live API honours `_limit=50` and rejects `_limit=51` with an error naming
`max_limit=50` — and an ignored parameter cannot reject a value. The endpoint
reads it. The docs are wrong.

Put beside the original bug this is the whole case for two sources:

| | what the docs said | what the API did | who was wrong |
|---|---|---|---|
| `date_created__gte` | filter is on `date_updated` | silently discarded our param | **our code** — we never read the docs |
| `_limit` | not supported | honoured, with an enforced cap | **the docs** — we never asked the API |

A docs-first rule gets `_limit` wrong. A code-first rule gets
`date_created__gte` wrong. **Neither source is authoritative alone**, which is
why the gate is a comparison rather than a lookup, and why a declaration records
*where each claim came from* rather than just what it is.

This is also the honest limit of the citation discipline in §4: a citation makes
a claim checkable, not true.

---

## 2. The measurement

Measured, not estimated. Line counts are `wc -l`; classification is by explicit
line range across the three files named in the brief.

### 2.1 First correction: the 3,721 is not all per-app

| | lines |
|---|---|
| **Shared infrastructure** — `types.ts` 463, `catalog.ts` 445, `field-utils.ts` 197, `registry.ts` 31 | **1,136** |
| **Per-app connectors** — close 583, calendly 526, gsheets 392, instantly 373, sendblue 337, gcal 242, catch-hook 132 | **2,585** |
| total | 3,721 |

The addressable surface is **2,585 lines across seven connectors**, not 3,721.
Of the per-app lines, **43% are comments** (1,016 of 2,389 non-blank);
`close.ts` alone is 52% comment.

### 2.2 The three files

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
| **irreducible %** | **13%** | **33%** | **66%** | — |

**Do not average these.** The spread is the finding. A spec pays for itself on
connectors shaped like Close and Sendblue — a list endpoint, a date filter, a
cursor or offset, latest-first — and pays for almost nothing on Calendly, whose
outward-alternating traversal, config pickers and dual-row semantics are all
genuinely its own. A single blended number would hide precisely the thing that
decides whether to build this.

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

**Half the absorbed lines are prose, and prose does not vanish.** The single
largest absorbable block is the `{hw, cont, maxSeen}` cursor: **close.ts
implements it in 91 lines, sendblue.ts in 51, instantly.ts in 20** — three
implementations of one idea, each with its own docstring explaining the same
reasoning in different words, and `calendly.ts` hand-rolls a fourth
parse/serialize pair for a different shape. The framework does not delete that
reasoning; it writes it **once**, where a correction lands for everybody.

That is the strongest argument for the spec at all: Defect #2 (the stranding
bug) was found in Close, fixed in Close, then found again in Instantly, then
found again in Sendblue. The same defect, three times, because the walk was
written three times.

**What the numbers do not capture.** The four rounds this cost were not spent
writing lines. They were spent being confident about the wrong thing — and no
line count measures that. It is what §1 is for.

---

## 3. Why the gate comes first

The spec and the gate are separable, and they are worth different amounts:

- **The gate without the spec** still works. It is a discipline plus a
  generalized version of a script that exists. It would have caught this bug.
- **The spec without the gate** would have declared `date_created__gte` in a
  neat typed field with a citation to a doc line nobody checked, and shipped the
  identical bug with better formatting.

So if only one gets built, build the gate.

---

## 4. The declaration

One file per connector, adjacent to it, typed and validated at build:

```ts
export const closeSpec: ConnectorSpec = {
  source: "close",
  guarantee: "incremental",
  baseUrl: "https://api.close.com/api/v1",
  auth: { kind: "basic", username: "@credentials.apiKey" },

  list: {
    path: "/event/",
    itemsAt: "data",
    // CONFLICTING SOURCES, recorded as such. The docs say `_limit` is not
    // supported; the API honours 50 and rejects 51 naming max_limit=50.
    pageSize: { param: "_limit", value: 50, source: "PROBED", contradicts: "docs say unsupported" },
    pagination: { style: "cursor", nextAt: "cursor_next", param: "_cursor", expired: { status: 400 } },
    pageCap: 4,                        // ours, not theirs — no citation needed
  },

  time: {
    // The two fields and the two jobs, as a constraint rather than a convention.
    cursorField:     { path: "date_updated", filter: "date_updated__gte",
                       cite: "…filters on date_updated__gte / date_updated__lte" },
    occurredAtField: { path: "date_created",
                       cite: "…consolidated events keep their original date_created" },
    overlapMs:       { value: 300_000, cite: "…recommends scanning the latest 5 minutes" },
    retentionDays:   { value: 30, cite: "'up to 30 days back in history'" },
  },

  ordering: { field: "date_updated", direction: "desc",
              cite: "'always ordered by date (latest first), i.e. the date_updated field'" },

  // Declared as combinations, never as a flat list — see §6.5.
  filterCombinations: PROBED,
  rateLimits: PROBED,
};
```

Four rules make this worth having rather than being another config file:

1. **Every provider claim carries its SOURCE** — `cite` (a doc line), `PROBED`
   (an observation), or both when they disagree. `_limit` above is the case that
   forces the third option to exist.
2. **Claims about *us* need no source** (`pageCap`, and the page-budget policy).
   The distinction is the point: it separates "what the provider told us" from
   "what we decided", which is the confusion that produced a 43-line docstring
   about a bound that was never sent.
3. **A `cite` is a hypothesis until the live lane confirms it.** Typed so, and
   the build enforces it (§1.2).
4. **The declaration is the only place a param name appears.**
   `date_created__gte` appeared in two places in `close.ts` and eleven in the
   verify script. One wrong word should be one wrong word in one place.

---

## 5. Recommendation

**Build it for the next connector only.** In order:

1. **The Close fix by hand** — done, §6, pending its live run. Doing it by hand
   is what makes the spec's fields honest rather than invented.
2. **The live lane**, by generalizing `verify-close-pagination.ts`, which already
   contains the technique. This is the gate and it is worth the most.
3. **The declaration type + contract lane**, extracted from what Close, Sendblue
   and Instantly already share. Do **not** migrate them; run the contract lane
   against them as a conformance check, which is free and says whether the
   abstraction fits three real connectors before it has to fit a fourth.
4. **Connector #8, declaration-first.** If it needs escape hatches, that is the
   answer: the spec covers what it covers and bespoke code stays bespoke.

**Where I expect it to fail.** If connector #8 is Calendly-shaped — bespoke
traversal, config pickers, dual-row semantics — the spec absorbs a third of it
and the exercise looks like overhead. §2.2 says so plainly. The mitigation is
that the gate is the cheap half and the valuable half, and it is worth having
even for a connector whose traversal is entirely hand-written.

---

## 6. The Close findings, verified against the code

All confirmed against `src/connectors/close.ts` and against the docs.

### 6.1 The filter is `date_updated` — and our bound had never worked

`close.ts` sent `date_created__gte` on every poll request and again in
`testFetchLatest`. Close drops unknown query parameters silently, so **every
request the connector ever issued was unbounded.** `FIRST_SYNC_DAYS` was not
belt-and-braces duplicating a provider limit; it was a bound that had never once
been applied. Nothing was lost only because Close retains 30 days anyway — the
provider's own retention was doing the bounding, at exactly the depth intended.
Luck, not design.

### 6.2 The peek was a provable duplicate request

`FIRST_RUNG_DAYS` opened a first sync one request shallower than the target.
Both requests differed **only** in `date_created__gte` — the discarded
parameter — so they were byte-identical, and the step-out cleared the
continuation: a first sync issued the same query twice and re-read page 1.

Removing it took **100 lines**: the constant, the peek gate, the step-out branch,
the coverage-mark clearing that existed only to stop the peek overstating
progress, and the six-request "proven newest" search in `testFetchLatest` (whose
every request carried the same discarded bound, so it was six identical
unbounded calls narrowing a window that never moved).

### 6.3 The ordering checks asked about the wrong field

`dateMs()` and `isNewestFirst()` read `date_created`; the verify script did the
same throughout. The docs are explicit — *"always ordered by date (latest
first), i.e. the `date_updated` field"* — and consolidation means the two fields
do not move together, so a `date_created` ordering check on a
`date_updated`-sorted list measures noise.

### 6.4 Two fields, two jobs — plus two consequences

The watermark now tracks `date_updated` (the filtered field); `occurred_at`
stays `date_created` (when the thing happened). Both halves had to move
together: correcting the parameter name alone would have introduced a data-loss
bug that did not previously exist, because a watermark on one field cannot bound
a window filtered on another.

**Stored cursors need no migration.** Existing cursors hold `date_created`
values, now read as `date_updated` floors. A record's creation never post-dates
its last edit, so such a mark sits at or below the true frontier: the first
sweep over-reads and dedup absorbs it. The other direction would skip.

**Coverage moved to the other axis, and got a clamp.** `covLo`/`covHi` track
`date_created` so that "covering 12 of 30 days" stays a statement about history
rather than about the change stream. Consolidation means a record inside the
30-day change window can have been created years ago, so the raw span can exceed
the window being reported against — "covering 700 of 30 days". The extra records
are kept; they just do not count toward a fraction they would make nonsense of.

### 6.5 Phase 9 is ON HOLD, and the question changed

`object_type` and `action` are supported filters, but the docs say `date_updated`
"can be optionally used with any allowed filter combination" followed by a
restricted list. **The question is not whether `object_type` is supported — it is
whether `object_type` combines with `date_updated__gte`.** If it does not,
filtering by type costs the incremental bound: a filtered unbounded window in
place of a bounded one, which is a bad trade at any filtering ratio.

`scripts/verify-close-pagination.ts` SECTION 7 now probes each filter alone and
in combination, and reports accepted-and-ignored as loudly as rejected. Nothing
gets built until a human has read that output.

Phase 9's other gate — the backfill lane, since per-flow scoping makes Close a
Records-class stream — **is** satisfied: `src/lib/backfill/` is on `main`.
