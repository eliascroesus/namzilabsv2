# Security audit — 15 September 2026

A full read of the product against the bug classes that matter for a company
whose job is other people's customer records. Every claim below was checked
against the code or the wire, not inferred; where I could not check something,
it says so under **Not covered**.

**Two serious findings, both fixed in this pass.**

1. **Next.js was two criticals behind.** `pnpm audit` reported 24
   vulnerabilities — 2 critical, 11 high. Both criticals were unauthenticated
   **remote code execution** in Next < 16.3.3, one of them in the Image
   Optimization API via a crafted AVIF. We ran 16.2.10. Now 16.3.5, and the
   dependency tree is at **zero known vulnerabilities**.
2. **The app sent no security headers at all.** No CSP, no HSTS, no framing
   policy, no `Referrer-Policy`. Seven now ship on every route.

Everything I wrote the product's own code for held: tenant isolation, action
gating, SQL escaping, credential encryption, webhook authentication, MCP
scoping. The two findings were both in the perimeter rather than the logic —
which is worth noticing, because the perimeter is the part no amount of careful
code review reaches.

**Follow-up pass, same day.** Three of the seven gaps under **Not covered** were
then closed, chosen on one criterion — *can the product RESPOND when something
goes wrong?* Prevention was already in good shape; detection and response were
where the holes were.

| | Was | Now |
|---|---|---|
| **Governance audit trail** (§10) | No record of who changed a rank, took a workspace, or destroyed one | 18 acts recorded, append-only, outliving the workspace, holding nothing personal |
| **Dependency scanning** (§6) | Clean once, by hand, never again | In CI on every push and weekly on a schedule |
| **Key rotation** (§4) | Impossible — a compromised key meant break everything or do nothing | Three-step rotation with a dry-run script and a two-key read path |

The remaining four gaps, and why each was left, are set out under
[What the follow-up pass deliberately left alone](#what-the-follow-up-pass-deliberately-left-alone).

---

## What was checked, and what it found

### 1. Tenant isolation — PASS (the finding that matters most)

Twenty-five of twenty-nine tables carry `org_id`. One customer's records
rendered into another customer's dashboard is the failure that ends a data
company, and it would be silent.

A static pass over every Drizzle statement in the tree reported **114**
unscoped. Reading them, almost all were correct: an ingestion pipeline reading
`raw_events` by its own id, a backfill job reading itself by job id, a sweep
updating a connection it was handed. Those are walled by a **generated UUID**,
which is a stronger wall than a tenant id — a v4 cannot be guessed — and the
tenant is then derived from the row.

Narrowing to the boundary that matters — code reachable from the internet,
`src/app`, where an id arrives from somebody who may not own the row it names —
left **3**, and all three are correct:

| Site | Why it is right |
|---|---|
| `actions.ts` workspace cap | Counts what a **person** created, across tenants, on purpose — being invited into a dozen workspaces must not spend your own three |
| `api/webhooks/[connectionId]` ×2 | An unauthenticated delivery has no session to scope by; the connection is found by the UUID in its own URL and the tenant comes off that row. The only order that can work |

Now enforced by `pnpm check:tenancy`, which fails on any new request-facing
query that does not name `org_id`, with allowlisting by file+table and a stated
reason.

### 2. Server actions — PASS

Every server action is a public HTTP endpoint; Next's obscure action id is in
the client bundle and is not a wall. All **48** exported actions were inventoried
by gate and by identity source.

- 43 use `requireOrg()` (session + tenant), 3 use `withAuth()` (acts about a
  person rather than a workspace).
- **2 are ungated, both correctly.** `signOutAction` — ending a session you do
  not have is a no-op. `switchOrgAction` — it hands an org id to WorkOS's
  `switchToOrganization`, and I read the installed SDK rather than trusting the
  comment: it calls `refreshSession({ organizationId, ensureSignedIn: true })`,
  and the IdP's token endpoint refuses an org the refresh token is not entitled
  to. The wall is real and it is at WorkOS.
- **No action reads a tenant id from a form.** The only id that arrives from the
  browser is the transfer-ownership target, walled by a membership check against
  WorkOS before use.

Enforced by `tests/security.test.ts`, which fails naming any new action that
skips both gates.

### 3. SQL injection — PASS, with one assumption now documented

Three `sql.raw` sites take dynamic content:

- `metrics/compute.ts` inlines `timeBucket`. It is a Zod enum (`day|week|month`),
  validated on write **and** re-parsed on every read, so a row poisoned by some
  other path still cannot reach SQL. Inlining is required — a bound param makes
  SELECT and GROUP BY differ byte-wise and Postgres rejects the grouping.
- `sync/locks.ts` inlines a lock timeout through `Math.floor(Number(…))`.
- `flow/compile/operators.ts` inlines a **user-typed JSON path**. This is the one
  place in the product where user text becomes SQL rather than a bound
  parameter — the field picker lets somebody type a path. `jsonExtractText`
  doubles `'`, which is correct and complete for a standard string literal.

**Assumption now written down** beside the escaping: doubling is complete only
while `standard_conforming_strings` is on. With it off, `\'` would close the
literal. Every supported Postgres ships it on, Neon does not change it, and
nothing here issues `SET standard_conforming_strings`. The existing test covered
`o'key`; it now also exercises five attack-shaped paths and asserts the result is
still a single balanced literal.

### 4. Credentials at rest — PASS

AES-256-GCM, layout `base64(iv | tag | ciphertext)`, a fresh 96-bit nonce per
message from `randomBytes`, the auth tag stored and verified on decrypt, and a
key that must decode to exactly 32 bytes or throw. GCM's real failure mode is
nonce reuse; per-call random nonces are the standard answer and are safe to
~2³² messages per key.

**Rotation, added in the follow-up pass.** The original audit listed "no
`ENCRYPTION_KEY` rotation path" as a gap, and it was the sharpest of the seven:
a suspected key compromise had two available responses, do nothing or break
every connection in the product at once. There is now a three-step rotation —
set `ENCRYPTION_KEY_PREVIOUS`, run `pnpm rotate:key`, remove it again — built on
the property that makes it safe at all: **AES-GCM is authenticated**, so "try
the new key, then the old" cannot silently return the wrong plaintext, it
throws. `tests/key-rotation.test.ts` asserts that property first, because every
other guarantee in the mechanism is downstream of it.

Two details worth stating because they are the ones that go wrong: the script is
a **dry run** until `--live`, since the columns it rewrites are every customer's
access to their own connected accounts; and `decryptStored` **warns on every
fallback**, so an unfinished rotation is noisy rather than comfortable. Two live
keys is weaker than one, and step 3 is the step people skip.

### 5. Webhook ingestion — PASS, and better than I expected

The raw bytes are read before parsing (HMAC must be computed over them), the
body is size-capped twice, and the signature is verified before anything is
persisted. The part worth calling out: a connection whose signing secret exists
but **cannot be decrypted** fails **closed** — 401, rejection logged — including
for the deliberately-open catch-hook. A rotated `ENCRYPTION_KEY` does not swing
a protected endpoint open.

**Residual, by design:** a connection with **no** signing secret accepts
deliveries from anyone who knows its UUID. That is the operator's choice for a
generic catch-hook, and it is why item 6 matters.

### 6. Dependencies — **FAIL, fixed in this pass, and the worst finding here**

I had written this section as "not covered in this pass", then ran it. That was
the mistake worth recording: the single most severe issue in the system was one
command away, and I had been about to ship an audit that listed it as out of
scope.

`pnpm audit` reported **24 vulnerabilities — 2 critical, 11 high**. Both
criticals were the same package:

| Advisory | Severity | Reachable here? |
|---|---|---|
| Next.js unauthenticated **RCE** in the Image Optimization API via AVIF (GHSA-2xp9-vwfh-vxw4) | critical | **Yes** — Linux hosting does not save you; this is the image pipeline |
| Next.js unauthenticated **RCE** on Windows-hosted servers (GHSA-p293-qw3h-jr36) | critical | Not on Linux, but a one-line fix either way |

Both patched in **16.3.3**; we were on **16.2.10**. Now **16.3.5**.

The remaining 22 came down in three steps, and each step is written into
`pnpm-workspace.yaml` beside the pin:

- The Next upgrade cleared both criticals and 8 highs (`sharp`/libheif among
  them) → 8 left.
- `brace-expansion` ×2 and `nanoid` (high) were transitive through
  inngest→opentelemetry→glob and next→postcss — build and telemetry paths no
  request touches. Pinned anyway: "not reachable" is a property of today's call
  graph, not of the package.
- Five moderates were dev-only (esbuild's dev server, postcss source maps,
  vitest's mocker, a browser-data table). Pinned, and vitest taken to 5.0.0.

**Result: no known vulnerabilities.** Note the trap that cost the first attempt:
`pnpm.overrides` in `package.json` is **no longer read by pnpm 11** — it warns
and ignores the field, so the first set of pins silently changed nothing. They
live in `pnpm-workspace.yaml` now.

`vitest` crossing a major version is the one upgrade with real blast radius
here; all 3,666 tests pass on it, and the production build, typecheck and
thirteen browser checks were re-run against Next 16.3.5.

### 7. Security headers — **FAIL, fixed in this pass**

The app sent **none**: no CSP, no HSTS, no framing policy, no `Referrer-Policy`,
no `nosniff`, no `Permissions-Policy`. There is no `vercel.json` and nothing in
the repo set them.

Why it mattered more this week:

- **Clickjacking over two irreversible controls.** The product just grew *delete
  this workspace* and *delete this account* behind a typed confirmation. With no
  framing policy those can be iframed and overlaid.
- **`Referer` leakage of a capability.** A connection's webhook URL is
  `/api/webhooks/<uuid>`, and for a source with no signing secret that UUID *is*
  the capability (item 5). The same UUID is in the address bar at
  `/connections/<uuid>`, and with no policy set every outbound link hands the
  full URL to a third party.
- No HSTS, and no defence-in-depth if an XSS ever lands.

Seven headers now ship from `next.config.mjs` on `/:path*` — **not** from
middleware, because the auth proxy's matcher deliberately excludes the machine
endpoints (webhooks, inngest, health, mcp), which are exactly the routes a
middleware header would miss. `pnpm headers` proves all seven are on the wire
**including on those routes**, checks the CSP's directives individually, and
presses a button to confirm the bundle still runs.

**Stated weakness:** `script-src` carries `'unsafe-inline'`. Next's App Router
emits inline bootstrap and hydration scripts; removing it needs a nonce threaded
through every response, which is not a config change. What the directive still
buys is real and asserted — no script from another **origin** executes, which is
the half that turns a reflected XSS into an exfiltration channel. Every other
directive is unweakened.

### 8. AI assistant access (MCP) — PASS

Three layers, and the ordering is right. The bearer token is verified with
`jwtVerify` against the AuthKit JWKS, pinned to issuer **and** audience. Its
`org_id` claim is treated as a **hint, not an authorization** — the resolver
checks active membership against WorkOS before scoping anything, then a
per-workspace grant, then a workspace-level `aiAssistantsEnabled` switch. The
token is hashed for the binding key and never stored or forwarded.

### 9. XSS, eval, redirects, logs — PASS

- No `dangerouslySetInnerHTML` anywhere. No `eval`, no `new Function`.
- No open redirect: every `returnTo` is a literal or `APP_BASE_URL` from env.
- No secret in any log line. The two greps that fired were the provider's *name*
  (`p.key` → `"google"`). Now enforced by a test.
- The referral cookie is `httpOnly`, `sameSite=lax` (required — sign-up leaves
  for WorkOS and comes back) and `secure` in production.

### 10. Governance audit trail — **was the largest gap; built in the follow-up pass**

Every gate in this product held under the audit. What the audit could not find
anywhere was a **record**. Who became an admin, who was handed the workspace,
who destroyed it, whose credential was replaced, when the AI assistant was let
in — `console.info` at best, in a stream with no retention, no query path and no
tenant scoping. An incident that opens "when did this person become an admin?"
had no answer.

`audit_log` now records **eighteen acts**, and the line is deliberate: the acts
that change WHO CAN REACH THE DATA, DESTROY SOME OF IT, MOVE A CREDENTIAL, or
OPEN A PATH FOR IT TO LEAVE. Of seventy-eight server actions, eighteen qualify.
Moving a tile and renaming a flow do not, and leaving them out is the point — a
log that records everything is a log nobody reads, and the signal that matters
(a rank widened at 3am) would be four hundred rows deep in somebody rearranging
a dashboard.

**It outlives the workspace it describes.** This is the one deliberate exception
to the product's hard-delete promise, and it is load-bearing rather than an
oversight: the product has a one-click irreversible workspace delete, and
deleting the workspace to destroy the record of what you did inside it is the
canonical anti-forensics move. An audit log the audited act erases answers
nothing.

**What makes that defensible is what is not in it.** No email, no display name,
no credential, no customer record, no free text. An invited address — the one
audited subject that genuinely is personal data — is stored as a truncated
SHA-256 with only the domain in clear, so a suspected address can be *confirmed*
but addresses cannot be *enumerated*. `tests/audit.test.ts` enforces this
mechanically at every call site, and `tests/destroy.test.ts` carries the
exemption with its reason attached. The two run in the same suite on purpose: if
the no-personal-data invariant ever breaks, the exemption becomes indefensible,
and the test that permits it should fail in the same run as the test that
guarded it.

**Append-only.** No update path and no delete path exists anywhere in `src/`,
and a test fails if one appears. An audit log the application can rewrite is one
that anybody with application access can rewrite — which is precisely the access
an incident is investigating.

### 11. Deletion — PASS (built in the previous pass)

Hard delete, no grace period. Twenty-five tables swept with a coverage test that
walks the schema and fails **naming** any `org_id` table left behind. Provider
webhooks torn down and **OAuth grants revoked** before the encrypted row goes —
deleting our copy of a token is not the same act as ending the customer's
authorisation. Our data before WorkOS's, so a half-finished sweep is retryable.

---

## Not covered — read this before trusting the above

1. **No live penetration testing.** Everything here is a code and header read.
   Nothing was attacked at runtime: no attempt to actually forge a webhook, ride
   a session, or reach another tenant's row through the running app.
2. ~~**No scheduled dependency scanning.**~~ **Closed in the follow-up pass.**
   `pnpm check:deps` now runs in CI on every push (catching a bad dependency
   being ADDED) and `.github/workflows/dependency-audit.yml` runs it weekly
   (catching an existing one GOING BAD — which no push-triggered check can see,
   because the lockfile does not change when the advisory lands). `pnpm
   check:tenancy` was added to CI in the same pass; it had been a laptop-only
   gate, which is the wrong home for the check that guards the one bug class
   that ends a data company. *Residual risk:* a red scheduled run still depends
   on somebody noticing it. Nothing pages.
3. **Rate limiting is uneven.** Outbound provider calls have a fleet budget.
   Inbound has body caps but no per-connection request throttle: a party holding
   a valid signing secret can write at will. Low severity (that is the real
   provider) but it is not bounded.
4. ~~**No audit log of governance acts.**~~ **Closed in the follow-up pass** —
   see §10. *Residual risk:* there is no UI for it yet. The rows are queryable
   and indexed two ways (by workspace and by actor, both newest-first), but
   reading them today means reaching for SQL.
5. **Backup and recovery are unexamined.** Hard delete with no grace period puts
   real weight on Neon's PITR window. Nobody has tested a restore.
6. ~~**`ENCRYPTION_KEY` has no rotation path.**~~ **Closed in the follow-up
   pass** — see §4. *Residual risk:* the procedure has never been run against
   production. It is covered by unit tests and a dry-run mode, which is not the
   same as having done it once on purpose.
7. **Session lifetime and revocation** are WorkOS's defaults; nobody has decided
   what they should be, and there is no "sign out everywhere".

## What the follow-up pass deliberately left alone

Three of the seven gaps were closed (2, 4, 6 above). The other four were left,
and the reasoning is as much a part of the audit as the fixes:

- **Rate limiting (3)** — the wall on inbound is the signing secret, and a party
  holding a valid one is the real provider. Real, bounded, low.
- **Penetration testing (1)** and **backup restore (5)** cannot be done from a
  code change. They need a human with production access, and writing code that
  gestures at them would only make the gap harder to see.
- **Session lifetime (7)** is a decision plus WorkOS configuration, not code. It
  needs an answer to "how long should a session live" that nobody has given yet.

The three that were fixed share a property the four do not: each one was a case
where the product could not RESPOND to something going wrong. No record of who
did what, no way to learn a dependency went bad, no way to rotate a compromised
key. Prevention was already in good shape; detection and response were where the
holes were.

## One thing found and NOT fixed

`pnpm board:drag` fails four assertions, and it is **not** from this pass — the
same four fail with every change here stashed. Diagnosis: the check looks for
`[data-view-tab]` on `/design/board` and gets `null`, so the control-row
assertions are testing a page shape that moved out from under them. A failing
check is a check nobody reads, so it is worth fixing — but it is a board layout
concern, not a security one, and folding it into this commit would mix the two.

## The checks this audit leaves behind

| Command | What it holds |
|---|---|
| `pnpm check:tenancy` | No request-facing query touches tenant data without `org_id` |
| `pnpm headers` | All seven headers on the wire on every route class; CSP directives intact; the bundle still runs |
| `pnpm vitest run tests/security.test.ts` | Every action gated; no tenant id from a form; SQL escaping survives attack-shaped paths; GCM used correctly; no secret logged |
| `pnpm vitest run tests/destroy.test.ts` | Deletion reaches every tenant table; grants revoked; ours before WorkOS's; the one exemption states its reason |
| `pnpm vitest run tests/audit.test.ts` | All 18 governance acts recorded; no email, name, credential or free text reaches a row; the table is append-only |
| `pnpm vitest run tests/key-rotation.test.ts` | GCM still fails closed on the wrong key; the fallback reads both keys; the rotation script is dry-run by default and prints no secret |
| `pnpm check:deps` | No known high or critical advisory in the shipped tree |
| `pnpm rotate:key` | *(operational, not a gate)* Dry-runs a key rotation and reports what it would rewrite |

**Three of these now run in CI** rather than on a laptop: `check:tenancy` and
`check:deps` on every push, and `check:deps` again weekly on a schedule. The two
new test files run with the rest of the suite. `pnpm headers` still needs a live
server and stays local.
