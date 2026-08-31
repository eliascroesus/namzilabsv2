/**
 * Per-org creation caps — a BLAST-RADIUS BOUND, not billing.
 *
 * Connections and flows are the multipliers of every runtime cost: the sweep
 * polls per stream per connection, materialization runs per published flow,
 * and one connection's Google traffic draws on the Cloud-project quota every
 * customer shares. Provider budgets already meter runtime per connection
 * (src/lib/provider-gateway/budget.ts); what nothing bounded was how many
 * multipliers one workspace could create — a runaway script minting 500
 * webhook connections would be 500 sweeps' worth of standing cost.
 *
 * Counts-at-create is sufficient at invite-only scale: tenants are
 * hand-picked, so this guards against accidents, not adversaries. A race
 * between two concurrent creates can overshoot by one — fine for a guard
 * that isn't billing. Disabled connections still count: they keep their data
 * and can be reconnected for free, so they still hold the quota; permanent
 * delete frees it.
 */

/** Thrown by the create paths; callers map it to a friendly banner. */
export class CapError extends Error {
  constructor(kind: "connections" | "flows", cap: number) {
    super(
      `This workspace has reached its limit of ${cap} ${kind}. ` +
        `Contact us and we'll raise it — the cap exists to catch runaway scripts, not real use.`,
    );
    this.name = "CapError";
  }
}

const intEnv = (name: string, fallback: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function connectionCap(): number {
  return intEnv("MAX_CONNECTIONS_PER_ORG", 10);
}

export function flowCap(): number {
  return intEnv("MAX_FLOWS_PER_ORG", 25);
}

/**
 * How many columns one workspace may put on its dashboard.
 *
 * A BLAST-RADIUS BOUND, not a product opinion — the number exists so a runaway
 * client cannot mint ten thousand rows, and it should never be the thing a real
 * workspace runs into. The board scrolls sideways without limit, so "more
 * columns than fit on screen" is a normal state here rather than a broken one,
 * and there is no reason for this to be tight.
 */
export function boardGroupCap(): number {
  return intEnv("MAX_BOARD_GROUPS_PER_ORG", 100);
}

/**
 * How many saved tile positions one workspace may hold.
 *
 * Bounded in practice by the number of metrics, and unbounded in principle:
 * placements outlive their tiles ON PURPOSE, so the ceiling is every tile the
 * workspace has ever published. Deleting the flow or metric clears them; this
 * is what catches the case where nobody does.
 *
 * It doubles as the batch limit on the placement write, so a single request
 * cannot ask for more rows than the workspace is allowed to have.
 */
export function boardPlacementCap(): number {
  return intEnv("MAX_BOARD_PLACEMENTS_PER_ORG", 2000);
}

/**
 * How many views one workspace may put above its board.
 *
 * The same blast-radius bound as the rest, and it counts the default view — the
 * one with no row — so a workspace really can have this many tabs rather than
 * this many plus one.
 */
export function boardViewCap(): number {
  return intEnv("MAX_BOARD_VIEWS_PER_ORG", 30);
}

/**
 * HOW MANY BACKFILL SLICES ONE INVOCATION MAY DRAIN.
 *
 * The worker used to run exactly one and wait for the next dispatch tick — five
 * minutes per slice, so a hundred-slice import took over eight hours. The gap
 * was never a rate limit (`claimCalls` is, and it is inside the slice); it was
 * an artifact of how the work was scheduled.
 *
 * TWELVE, because the ceiling that matters is the invocation's own: the Inngest
 * route declares `maxDuration = 60`, and while each STEP gets its own request
 * and its own sixty seconds, a run that never ends is a run nobody can reason
 * about. Twelve slices against a provider answering in a second or two is a
 * minute of real work and two orders of magnitude better than one per tick.
 *
 * A COUNT RATHER THAN ONLY A CLOCK because Inngest replays the function body
 * after every step: a `Date.now()` in the body differs on each replay, so the
 * count is the deterministic bound and the clock below is the secondary guard.
 */
export function backfillSlicesPerRun(): number {
  return intEnv("BACKFILL_SLICES_PER_RUN", 12);
}

/**
 * The wall-clock ceiling on one backfill invocation, measured from a memoized
 * start. Approximate on purpose — it is read on every replay, so it includes
 * replay overhead and errs towards stopping early. That is the safe direction:
 * a stopped loop leaves a checkpointed job the next sweep tick resumes.
 */
export function backfillRunBudgetMs(): number {
  return intEnv("BACKFILL_RUN_BUDGET_MS", 45_000);
}

/**
 * How many workspaces one person may CREATE.
 *
 * Three, for now, and deliberately low: a workspace is a whole tenant — its own
 * connections, its own flows, its own billing surface later — so the cost of a
 * runaway here is not a slow page, it is orphaned infrastructure nobody is
 * looking at. Raising it is one env var.
 *
 * COUNTED OVER ACTIVE MEMBERSHIPS, WHICH IS NOT THE SAME AS "MADE BY YOU", and
 * the difference is the honest one: being invited into five workspaces must not
 * stop you making your own, so `createOrganizationAction` counts only the orgs
 * this user OWNS (`workspace_owners.source = 'created'`). Somebody who has been
 * added to a dozen still has their three.
 */
export function workspaceCap(): number {
  return intEnv("MAX_WORKSPACES_PER_USER", 3);
}

/**
 * How many charts one custom view may hold.
 *
 * PER VIEW, not per org, and that is the honest unit: a view is what renders,
 * so it is what a runaway count would actually break. A workspace with twenty
 * views has twenty boards, each of which is fine.
 *
 * The same blast-radius bound as the rest — high enough that no real board runs
 * into it, low enough that a scripted client cannot mint ten thousand rows. It
 * doubles as the batch limit on the layout write, so one request cannot ask for
 * more rows than a view is allowed to have.
 */
export function boardTileCap(): number {
  return intEnv("MAX_BOARD_TILES_PER_VIEW", 60);
}
