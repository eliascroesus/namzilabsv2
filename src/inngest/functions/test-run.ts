import { and, eq } from "drizzle-orm";
import { inngest } from "../client";
import { getDb } from "@/db/client";
import { testRuns } from "@/db/schema";
import { executeAndSettleTestRun } from "@/lib/flow/test-run";

/**
 * D.1-full — the interactive Test lane. Its own function = its own queue,
 * unaffected by sweep backlog; the priority boost keeps it ahead of any future
 * same-function traffic, and per-org concurrency keeps one workspace's
 * click-storm from starving another's.
 */
export const runFlowTest = inngest.createFunction(
  {
    id: "run-flow-test",
    // Interactive: a failed run settles the row as error and the user re-tests;
    // automatic retries would just make the editor spinner lie.
    retries: 0,
    concurrency: [{ limit: 6 }, { key: "event.data.orgId", limit: 2 }],
    /* `event.data.priority`, not `?? 180` — CEL has no `??`. See the note in
       process-event.ts. `startNodeTestAction` is this event's only sender and
       always sets priority: 180. */
    priority: { run: "event.data.priority" },
    triggers: [{ event: "flow/test.requested" }],
    onFailure: async ({ event }) => {
      // Belt-and-braces: if the run itself died (OOM, crash), settle the row so
      // the editor stops polling with a real message instead of spinning out.
      const original = event.data.event?.data as { testRunId?: string; orgId?: string } | undefined;
      if (!original?.testRunId || !original.orgId) return;
      await getDb()
        .update(testRuns)
        .set({ status: "error", error: "The test run crashed — try again.", updatedAt: new Date() })
        .where(and(eq(testRuns.id, original.testRunId), eq(testRuns.orgId, original.orgId)));
    },
  },
  async ({ event, step }) => {
    const { testRunId, orgId, graph, nodeId } = event.data as {
      testRunId: string;
      orgId: string;
      graph: unknown;
      nodeId: string;
    };
    return step.run("execute-test", () => executeAndSettleTestRun(getDb(), orgId, testRunId, graph, nodeId));
  },
);
