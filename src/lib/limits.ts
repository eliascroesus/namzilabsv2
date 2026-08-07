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
