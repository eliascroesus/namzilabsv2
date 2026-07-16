import { desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { connections, deliveryLog, deadLetter, events } from "@/db/schema";

export const dynamic = "force-dynamic";

async function loadData() {
  const db = getDb();
  const [conns, recentDeliveries, dlq, recentEvents] = await Promise.all([
    db.select().from(connections).orderBy(desc(connections.createdAt)).limit(50),
    db.select().from(deliveryLog).orderBy(desc(deliveryLog.createdAt)).limit(25),
    db.select().from(deadLetter).where(isNull(deadLetter.resolvedAt)).orderBy(desc(deadLetter.createdAt)).limit(25),
    db.select().from(events).orderBy(desc(events.receivedAt)).limit(10),
  ]);
  return { conns, recentDeliveries, dlq, recentEvents };
}

export default async function AdminPage() {
  let data: Awaited<ReturnType<typeof loadData>> | null = null;
  let error: string | null = null;
  try {
    data = await loadData();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Engine Admin</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Internal observability for the ingestion engine: connections, deliveries and the dead-letter queue.
      </p>

      {error && (
        <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          Database not reachable ({error}). Set <code>DATABASE_URL</code> to view live data.
        </div>
      )}

      {data && (
        <div className="mt-8 space-y-10">
          <Section title={`Connections (${data.conns.length})`}>
            <Table
              head={["Source", "Name", "Status", "Last event", "Last error"]}
              rows={data.conns.map((c) => [
                c.source,
                c.name,
                <Badge key={c.id} status={c.status} />,
                c.lastEventAt ? new Date(c.lastEventAt).toLocaleString() : "—",
                c.lastError ?? "—",
              ])}
              empty="No connections yet."
            />
          </Section>

          <Section title={`Dead-letter queue (${data.dlq.length} unresolved)`}>
            <Table
              head={["Raw event", "Attempts", "Error", "When"]}
              rows={data.dlq.map((d) => [
                d.rawEventId ?? "—",
                String(d.attempts),
                d.error,
                new Date(d.createdAt).toLocaleString(),
              ])}
              empty="Dead-letter queue is empty. 🎉"
            />
          </Section>

          <Section title="Recent deliveries">
            <Table
              head={["Status", "Attempt", "Raw event", "Error", "When"]}
              rows={data.recentDeliveries.map((d) => [
                <Badge key={d.id} status={d.status} />,
                String(d.attempt),
                d.rawEventId ?? "—",
                d.error ?? "—",
                new Date(d.createdAt).toLocaleString(),
              ])}
              empty="No deliveries yet."
            />
          </Section>

          <Section title="Latest canonical events">
            <Table
              head={["Source", "Type", "Subject", "Occurred", "Event id"]}
              rows={data.recentEvents.map((e) => [
                e.source,
                e.eventType,
                e.subject ?? "—",
                new Date(e.occurredAt).toLocaleString(),
                e.eventId,
              ])}
              empty="No events ingested yet."
            />
          </Section>
        </div>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) {
    return <p className="rounded-md border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-500">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-neutral-100">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top text-neutral-700">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Badge({ status }: { status: string }) {
  const color =
    status === "success" || status === "active"
      ? "bg-green-100 text-green-800"
      : status === "failed" || status === "error"
        ? "bg-red-100 text-red-800"
        : status === "retry"
          ? "bg-amber-100 text-amber-800"
          : "bg-neutral-100 text-neutral-700";
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}
