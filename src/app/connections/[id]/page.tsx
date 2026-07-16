import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { getConnection, getSigningSecret, previewLatest, webhookUrlFor } from "@/lib/connections";
import { catalogEntry } from "@/connectors/catalog";
import { resyncAction, disconnectAction, updateConfigAction } from "@/app/integrations/actions";
import type { CanonicalEvent } from "@/connectors/types";

export const dynamic = "force-dynamic";

export default async function ConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview?: string }>;
}) {
  const { id } = await params;
  const { preview } = await searchParams;
  const { orgId, userId, auth } = await requireOrg();

  const conn = await getConnection(orgId, id);
  if (!conn) notFound();

  const entry = catalogEntry(conn.source);
  const config = (conn.config ?? {}) as Record<string, unknown>;
  const signingSecret = getSigningSecret(conn);
  const webhookUrl = webhookUrlFor(conn.id);

  // "Preview latest records" — the connect-time trust builder.
  let previewRows: CanonicalEvent[] | null = null;
  let previewError: string | null = null;
  if (preview === "1") {
    try {
      previewRows = await previewLatest(orgId, conn.id, 3);
    } catch (err) {
      previewError = err instanceof Error ? err.message : String(err);
    }
  }

  return (
    <>
      <AppHeader userId={userId} orgId={orgId} userEmail={auth.user.email} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/integrations" className="text-sm text-neutral-500 hover:text-neutral-800">
          &larr; Integrations
        </Link>
        <div className="mt-3 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{conn.name}</h1>
            <p className="text-sm text-neutral-500">{entry?.name ?? conn.source}</p>
          </div>
          <StatusBadge status={conn.status} />
        </div>

        {conn.lastError && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {conn.lastError}
          </div>
        )}

        <dl className="mt-6 grid grid-cols-2 gap-4 rounded-md border border-neutral-200 p-4 text-sm">
          <Field label="Last event" value={conn.lastEventAt ? new Date(conn.lastEventAt).toLocaleString() : "—"} />
          <Field label="Created" value={new Date(conn.createdAt).toLocaleString()} />
          <Field label="Instant webhook" value={entry?.instant ? "Yes" : "No"} />
          <Field label="Polling / backfill" value={entry?.poll ? "Yes" : "No"} />
        </dl>

        {/* Config (e.g. Google Sheets spreadsheet id / range) */}
        {entry?.configFields && entry.configFields.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Configuration</h2>
            <form action={updateConfigAction} className="space-y-2">
              <input type="hidden" name="id" value={conn.id} />
              {entry.configFields.map((f) => (
                <div key={f.key}>
                  <label className="block text-sm text-neutral-600">{f.label}</label>
                  <input
                    name={`cfg_${f.key}`}
                    defaultValue={typeof config[f.key] === "string" ? (config[f.key] as string) : ""}
                    placeholder={f.placeholder}
                    className="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
                  />
                </div>
              ))}
              <button className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
                Save &amp; preview
              </button>
            </form>
          </section>
        )}

        {/* Inbound webhook URL + secret (manual providers / custom webhook) */}
        {entry?.instant && (
          <section className="mt-8">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Inbound webhook</h2>
            {entry.webhookSetup && <p className="mb-2 text-sm text-neutral-600">{entry.webhookSetup}</p>}
            <CopyRow label="URL" value={webhookUrl} />
            {signingSecret && <CopyRow label="Signing secret" value={signingSecret} />}
          </section>
        )}

        {/* Preview latest records */}
        <section className="mt-8">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Latest records</h2>
            <Link href={`/connections/${conn.id}?preview=1`} className="text-sm text-blue-600 hover:underline">
              Preview latest
            </Link>
          </div>
          {preview !== "1" && (
            <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
              Click &ldquo;Preview latest&rdquo; to pull the most recent records from this source.
            </p>
          )}
          {previewError && (
            <p className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{previewError}</p>
          )}
          {previewRows && <PreviewTable rows={previewRows} />}
        </section>

        <div className="mt-10 flex gap-3">
          <form action={resyncAction}>
            <input type="hidden" name="id" value={conn.id} />
            <button className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50">
              Re-sync now
            </button>
          </form>
          <form action={disconnectAction}>
            <input type="hidden" name="id" value={conn.id} />
            <button className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50">
              Disconnect
            </button>
          </form>
        </div>
      </main>
    </>
  );
}

function PreviewTable({ rows }: { rows: CanonicalEvent[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">
        No records found yet.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Subject</th>
            <th className="px-3 py-2 font-medium">Occurred</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.eventId} className="border-t border-neutral-100">
              <td className="px-3 py-2">{r.eventType}</td>
              <td className="px-3 py-2 text-neutral-700">{r.subject ?? "—"}</td>
              <td className="px-3 py-2 text-neutral-700">{new Date(r.occurredAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-neutral-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-neutral-800">{value}</dd>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-2">
      <span className="text-xs text-neutral-500">{label}</span>
      <code className="mt-0.5 block overflow-x-auto rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
        {value}
      </code>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === "active"
      ? "bg-green-100 text-green-800"
      : status === "error"
        ? "bg-red-100 text-red-800"
        : "bg-neutral-100 text-neutral-700";
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}
