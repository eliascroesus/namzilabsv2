import { inngest } from "../client";
import { getDb } from "@/db/client";
import { PLANS, isPaidPlan } from "@/lib/billing/plans";
import { reminderDue, sendBillingEmail, trialEmail, type ReminderKind } from "@/lib/billing/emails";

const DAY = 86_400_000;

/**
 * TRIAL REMINDERS — one durable run per trial.
 *
 * It sleeps (`step.sleepUntil`) to seven days before the end, the day before,
 * and just after, and at each checks the workspace NOW before sending — so a
 * customer who paid on day 3 never hears their trial is ending. Sleeping costs
 * nothing: no worker, no database, until each moment arrives.
 */
export const trialReminders = inngest.createFunction(
  { id: "billing-trial-reminders", retries: 2, triggers: [{ event: "billing/trial.started" }] },
  async ({ event, step }) => {
    const { orgId, email, plan, endsAt } = event.data as { orgId: string; email?: string; plan: string; endsAt: string };
    const end = new Date(endsAt).getTime();
    const base = (process.env.APP_BASE_URL ?? "https://namzilabs.co").replace(/\/$/, "");
    const planName = isPaidPlan(plan) ? PLANS[plan].name : "paid";
    const moments: Array<[ReminderKind, number]> = [
      ["7d", end - 7 * DAY],
      ["1d", end - DAY],
      ["ended", end + 5 * 60_000],
    ];
    const outcome: Record<string, string> = {};
    for (const [kind, at] of moments) {
      await step.sleepUntil(`wait-${kind}`, new Date(at));
      outcome[kind] = await step.run(`remind-${kind}`, async () => {
        if (!email || !(await reminderDue(getDb(), orgId, kind))) return "skipped";
        const message = trialEmail(kind, { planName, endsAt: new Date(end), billingUrl: `${base}/dashboard/settings/billing` });
        return (await sendBillingEmail(email, message)).sent ? "sent" : "not-sent";
      });
    }
    return outcome;
  },
);
