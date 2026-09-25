import type { DB } from "@/db/types";
import { PLANS, type PlanFeatures, type PlanId } from "./plans";
import { billingEnabled, workspacePlan } from "./state";
import { countApps, countMembers, countMetrics } from "./usage";

/**
 * THE PLAN LIMITS, CHECKED ON THE SERVER AT THE MOMENT OF CREATION.
 *
 * Every entry point that adds an app, publishes a metric, invites a person or
 * reaches a paid feature calls one of these first. The UI hides buttons as a
 * courtesy; these are the wall. All of them are no-ops while billing is off,
 * which is the launch switch's whole promise.
 *
 * A refusal is a `PlanLimitError`, never a generic error, so every caller can
 * turn it into the upgrade dialog instead of a red banner.
 */

export type LimitKind = "apps" | "metrics" | "members" | "feature";
export type FeatureKey = keyof PlanFeatures;

const NOUN: Record<Exclude<LimitKind, "feature">, [string, string]> = {
  apps: ["app", "apps"],
  metrics: ["metric", "metrics"],
  members: ["member", "members"],
};

const FEATURE_NAME: Record<FeatureKey, string> = {
  shareTemplates: "Sharing templates",
  aiAssistant: "The AI assistant",
};

export class PlanLimitError extends Error {
  readonly kind: LimitKind;
  readonly plan: PlanId;
  readonly limit: number;
  readonly feature?: FeatureKey;

  constructor(kind: LimitKind, plan: PlanId, limit: number, feature?: FeatureKey) {
    const planName = PLANS[plan].name;
    super(
      kind === "feature"
        ? `${FEATURE_NAME[feature!]} isn't included in the ${planName} plan. Upgrade to use it.`
        : `You've reached the ${limit} ${NOUN[kind][limit === 1 ? 0 : 1]} included in the ${planName} plan. Upgrade to add more.`,
    );
    this.name = "PlanLimitError";
    this.kind = kind;
    this.plan = plan;
    this.limit = limit;
    this.feature = feature;
  }
}

/** The sentence the plan page shows for a `?upgrade=` kind — the refusal's own words. Null for anything else. */
export function upgradeMessage(kind: string, plan: PlanId): string | null {
  if (kind === "apps" || kind === "metrics" || kind === "members") return new PlanLimitError(kind, plan, PLANS[plan].limits[kind]).message;
  if (kind === "shareTemplates" || kind === "aiAssistant") return new PlanLimitError("feature", plan, 0, kind).message;
  return null;
}

/** Where every refusal sends someone: the plan page, told why they came. */
export function upgradeHref(kind: LimitKind | FeatureKey): string {
  return `/dashboard/settings/billing?upgrade=${kind}`;
}

/** Connecting one more app. */
export async function assertCanAddApp(db: DB, orgId: string): Promise<void> {
  if (!billingEnabled()) return;
  const { plan } = await workspacePlan(db, orgId);
  const limit = PLANS[plan].limits.apps;
  if ((await countApps(db, orgId)) >= limit) throw new PlanLimitError("apps", plan, limit);
}

/**
 * Publishing a flow that will show `metricsInFlow` numbers. The flow's own
 * existing results are left out of the count, so republishing an unchanged
 * flow at the limit is always allowed.
 */
export async function assertCanPublish(db: DB, orgId: string, flowId: string, metricsInFlow: number): Promise<void> {
  if (!billingEnabled()) return;
  const { plan } = await workspacePlan(db, orgId);
  const limit = PLANS[plan].limits.metrics;
  const others = await countMetrics(db, orgId, { excludeFlowId: flowId });
  if (others + metricsInFlow > limit) throw new PlanLimitError("metrics", plan, limit);
}

/**
 * Inviting one more person. `members` is injectable because the count is a
 * WorkOS call; the default is the real one.
 */
export async function assertCanInvite(
  db: DB,
  orgId: string,
  members: () => Promise<number> = () => countMembers(orgId),
): Promise<void> {
  if (!billingEnabled()) return;
  const { plan } = await workspacePlan(db, orgId);
  const limit = PLANS[plan].limits.members;
  if ((await members()) >= limit) throw new PlanLimitError("members", plan, limit);
}

/** Reaching a feature a plan may not include. */
export async function assertFeature(db: DB, orgId: string, feature: FeatureKey): Promise<void> {
  if (!billingEnabled()) return;
  const { plan } = await workspacePlan(db, orgId);
  if (!PLANS[plan].features[feature]) throw new PlanLimitError("feature", plan, 0, feature);
}
