import { inngest } from "../client";
import { getDb } from "@/db/client";
import { materializeFlow } from "@/lib/flow/materialize";

/**
 * Recompute a published flow's stored dashboard results. Enqueued on publish,
 * on manual refresh, and (M4) when relevant data changes or on a schedule.
 */
export const materializeFlowFn = inngest.createFunction(
  { id: "materialize-flow", retries: 3, triggers: [{ event: "flow/materialize.requested" }] },
  async ({ event, step }) => {
    const { orgId, flowId } = event.data as { orgId: string; flowId: string };
    return step.run("materialize", () => materializeFlow(getDb(), orgId, flowId));
  },
);
