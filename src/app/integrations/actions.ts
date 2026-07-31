"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import {
  createConnection,
  deleteConnectionPermanently,
  disableConnection,
  reconnectConnection,
  updateConnectionName,
  getConnection,
} from "@/lib/connections";
import { catalogEntry } from "@/connectors/catalog";
import { inngest } from "@/inngest/client";
import { promoteToBaseCadence } from "@/lib/sync/cadence";
import { activeStreams } from "@/lib/sync/streams";
import { defaultTargetFloor, requestBackfill } from "@/lib/backfill/jobs";
import { getDb } from "@/db/client";
import { setEventTime, type EventTimeChoice } from "@/lib/webhooks/event-time";

/**
 * Connect an API-key / token based source (Calendly, Close, Instantly, Sendblue, custom
 * webhook). Auth only — there is no "what to pull" config here; that lives on each
 * flow's Get data step.
 */
export async function connectApiKeyAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const source = String(formData.get("source") ?? "");
  const entry = catalogEntry(source);
  if (!entry || entry.connect !== "apiKey") throw new Error("invalid source");

  const credentials: Record<string, unknown> = {};
  for (const field of entry.credentialFields) {
    const value = String(formData.get(`cred_${field.key}`) ?? "").trim();
    if (value) credentials[field.key] = value;
  }
  const name = String(formData.get("name") ?? "").trim() || entry.name;

  const conn = await createConnection({
    orgId,
    source,
    name,
    authType: source === "webhook" ? "secret" : "apiKey",
    credentials,
  });
  redirect(`/connections/${conn.id}`);
}

/** Rename a connection from the Integrations list (inline edit). */
export async function renameConnectionAction(id: string, name: string): Promise<{ ok: boolean }> {
  const { orgId } = await requireOrg();
  await updateConnectionName(orgId, id, name);
  revalidatePath("/integrations");
  return { ok: true };
}

/** Pull only new records since the last sync (additive). */
export async function syncNewAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const conn = await getConnection(orgId, id);
  if (!conn) throw new Error("connection not found");
  // H.2: a user action proves intent — cancel idle backoff immediately.
  await promoteToBaseCadence(getDb(), id).catch(() => {});
  await inngest.send({ name: "sync/connection.requested", data: { connectionId: id, mode: "incremental" } });
  redirect(`/connections/${id}`);
}

/** Rebuild the connection's dataset safely (versioned replacement; removes upstream-deleted records). */
export async function fullResyncAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const conn = await getConnection(orgId, id);
  if (!conn) throw new Error("connection not found");
  await promoteToBaseCadence(getDb(), id).catch(() => {});
  await inngest.send({ name: "sync/connection.requested", data: { connectionId: id, mode: "full" } });
  redirect(`/connections/${id}`);
}

/**
 * Ask for more history on every stream this connection feeds.
 *
 * User-initiated on purpose, and this is a decision rather than an omission.
 * Checklist 9a's triggers for an automatic backfill — a Records-class stream
 * shipping, or a large-history account onboarding — have not happened, and
 * starting a months-long import on everyone's behalf would spend provider
 * budget nobody asked to spend. So the lane exists, is bounded, and runs when
 * somebody wants it.
 *
 * Idempotent by construction: `requestBackfill` is keyed on
 * (stream, target depth), so pressing this twice finds the existing jobs rather
 * than starting a second set. Only asking for a DEEPER window is new work.
 */
export async function importHistoryAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const conn = await getConnection(orgId, id);
  if (!conn) throw new Error("connection not found");
  const db = getDb();
  const target = defaultTargetFloor();
  for (const stream of await activeStreams(db, id)) {
    if (stream.status === "disabled") continue;
    await requestBackfill(db, { id: stream.id, orgId, connectionId: id, configHash: stream.configHash }, conn.source, target);
  }
  redirect(`/connections/${id}`);
}

/** Re-run normalization from the stored raw events (no provider calls). */
export async function reprocessAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const conn = await getConnection(orgId, id);
  if (!conn) throw new Error("connection not found");
  await inngest.send({ name: "sync/reprocess.requested", data: { orgId, connectionId: id } });
  redirect(`/connections/${id}`);
}

/**
 * Answer the event-time question for a catch-hook connection.
 *
 * Records the answer and nothing else. The restamp of everything already stored
 * is the nightly pass's job — a reprocess of a busy connection is not something
 * to run inside a click, and while the rollout gate is shut it must not run at
 * all. The answer is stored either way, so opening the gate honours what was
 * chosen in the meantime.
 */
export async function setEventTimeAction(
  connectionId: string,
  choice: EventTimeChoice,
): Promise<{ ok: true; changed: boolean } | { ok: false; error: string }> {
  const { orgId } = await requireOrg();
  try {
    const res = await setEventTime(getDb(), orgId, connectionId, choice);
    return { ok: true, changed: res.changed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function disconnectAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  await disableConnection(orgId, id);
  redirect("/integrations");
}

/**
 * Remove a connection and everything synced from it. Irreversible.
 *
 * Deliberately a SEPARATE action from `disconnectAction` rather than a flag on
 * it. They are two different promises to the user — one is "hide this, I can put
 * it back", the other is "destroy this" — and a boolean parameter is how those
 * two end up sharing a confirm dialog and then sharing a mistake.
 *
 * The typed name is checked on the SERVER as well as in the browser. Client-side
 * confirmation is a courtesy, not a control: this endpoint is reachable without
 * the page, and the row it destroys cannot be restored from anywhere.
 */
export async function deleteConnectionAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const typed = String(formData.get("confirmName") ?? "").trim();
  // The name is checked by the delete itself, not here — it is part of that
  // contract, so no caller can skip it by forgetting to.
  await deleteConnectionPermanently(orgId, id, typed);
  redirect("/integrations");
}

/**
 * Put a disconnected integration back. Costs nothing and calls no provider: the
 * connection row survived the disconnect, so its events still match the ids its
 * connector produces and are restored in place.
 */
export async function reconnectAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  await reconnectConnection(orgId, id);
  redirect("/integrations");
}
