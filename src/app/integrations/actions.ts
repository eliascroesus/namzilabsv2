"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/auth";
import { createConnection, deleteConnection, updateConnectionName, getConnection } from "@/lib/connections";
import { catalogEntry } from "@/connectors/catalog";
import { inngest } from "@/inngest/client";

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

export async function resyncAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const conn = await getConnection(orgId, id);
  if (!conn) throw new Error("connection not found");
  await inngest.send({ name: "ingest/reconcile.requested", data: { connectionId: id } });
  redirect(`/connections/${id}`);
}

/** Pull only new records since the last sync (additive). */
export async function syncNewAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const conn = await getConnection(orgId, id);
  if (!conn) throw new Error("connection not found");
  await inngest.send({ name: "sync/connection.requested", data: { connectionId: id, mode: "incremental" } });
  redirect(`/connections/${id}`);
}

/** Rebuild the connection's dataset safely (versioned replacement; removes upstream-deleted records). */
export async function fullResyncAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  const conn = await getConnection(orgId, id);
  if (!conn) throw new Error("connection not found");
  await inngest.send({ name: "sync/connection.requested", data: { connectionId: id, mode: "full" } });
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

export async function disconnectAction(formData: FormData): Promise<void> {
  const { orgId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  await deleteConnection(orgId, id);
  redirect("/integrations");
}
