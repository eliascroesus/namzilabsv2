import { and, eq } from "drizzle-orm";
import { accessGrants } from "@/db/schema";
import type { DB } from "@/db/types";
import { PLANS } from "./plans";
import { workspacePlan } from "./state";

/**
 * TRIAL EMAILS — the three a trial gets: seven days out, the day before, and
 * the day it ends. Plain, short, and honest about the one thing people worry
 * about: nothing is ever deleted.
 */

export type ReminderKind = "7d" | "1d" | "ended";
export type Email = { subject: string; text: string; html: string };

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const KEEP = `your first ${PLANS.free.limits.metrics} metrics and ${PLANS.free.limits.apps} apps keep working`;

export function trialEmail(kind: ReminderKind, input: { planName: string; endsAt: Date; billingUrl: string }): Email {
  const { planName, endsAt, billingUrl } = input;
  const lines =
    kind === "7d"
      ? {
          subject: `Your ${planName} trial ends in 7 days`,
          body: [
            `Your ${planName} trial ends on ${day(endsAt)} — 7 days from now.`,
            `Add a card now and nothing changes: you won't be charged until the trial ends.`,
            `If you don't, the workspace moves to the Free plan — ${KEEP}, and everything else waits, untouched, until you upgrade.`,
          ],
          cta: "Choose your plan",
        }
      : kind === "1d"
        ? {
            subject: `Your ${planName} trial ends tomorrow`,
            body: [
              `Your ${planName} trial ends tomorrow, ${day(endsAt)}.`,
              `Add a card to keep everything exactly as it is.`,
              `Otherwise the workspace moves to the Free plan — ${KEEP}, and nothing is deleted.`,
            ],
            cta: "Keep " + planName,
          }
        : {
            subject: `Your ${planName} trial has ended`,
            body: [
              `Your ${planName} trial ended on ${day(endsAt)}, and the workspace is now on the Free plan.`,
              `Nothing has been deleted: ${KEEP}, and the rest unlock the moment you upgrade.`,
            ],
            cta: "Upgrade",
          };
  const text = [...lines.body, "", `${lines.cta}: ${billingUrl}`, "", "— Namzilabs"].join("\n");
  const html = [
    ...lines.body.map((p) => `<p style="margin:0 0 14px;font:15px/1.5 -apple-system,Segoe UI,sans-serif;color:#121212">${esc(p)}</p>`),
    `<p style="margin:22px 0"><a href="${esc(billingUrl)}" style="display:inline-block;background:#568CFF;color:#121212;font:600 15px -apple-system,Segoe UI,sans-serif;padding:11px 18px;border-radius:10px;text-decoration:none">${esc(lines.cta)}</a></p>`,
    `<p style="margin:0;font:13px -apple-system,Segoe UI,sans-serif;color:#6e6e6e">— Namzilabs</p>`,
  ].join("\n");
  return { subject: lines.subject, text, html };
}

/**
 * STILL WORTH SENDING? Checked at send time, not when it was scheduled: a
 * reminder that the trial is ending goes only to a workspace still on its trial
 * (not paying, not given a plan); the "it ended" note only to one now on Free.
 */
export async function reminderDue(db: DB, orgId: string, kind: ReminderKind): Promise<boolean> {
  const plan = await workspacePlan(db, orgId);
  if (kind !== "ended") return plan.source === "trial";
  if (plan.plan !== "free") return false;
  // A deleted workspace is "on Free" too — but its grants went with it, so a
  // missing trial grant means there is nobody left to tell.
  const [trial] = await db
    .select({ id: accessGrants.id })
    .from(accessGrants)
    .where(and(eq(accessGrants.orgId, orgId), eq(accessGrants.kind, "trial")))
    .limit(1);
  return trial != null;
}

/** Resend, from `BILLING_EMAIL_FROM`. Unconfigured is a quiet no-op, never an error. */
export async function sendBillingEmail(to: string, email: Email): Promise<{ sent: boolean }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.BILLING_EMAIL_FROM;
  if (!key || !from) return { sent: false };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: email.subject, text: email.text, html: email.html }),
  });
  return { sent: res.ok };
}
