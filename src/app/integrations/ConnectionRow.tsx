"use client";

import { Pencil, Power, Trash2 } from "lucide-react";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CopyField } from "@/components/copy-field";
import { renameConnectionAction, disconnectAction, reconnectAction, deleteConnectionAction } from "./actions";
import { catalogEntry } from "@/connectors/catalog";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import { SourceMark } from "@/components/source-mark";
import { sourceStyle } from "@/components/flow/controls/source-style";
import { formatMetricValue } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * One row in the Apps page's connection list: links to the connection page,
 * with an inline
 * rename (pencil) so users can label accounts themselves ("Sheets — sales team"),
 * and TWO ways to get rid of it.
 *
 * They are separate on purpose, because they are separate promises.
 * *Disconnect* (power symbol) stops the syncing and hides the records, keeps
 * everything, and can be undone from this page. *Delete permanently* (trash)
 * destroys the connection and every row anywhere that belongs to it. Offering
 * only the first leaves no way to actually remove an integration; offering only
 * the second makes "I want this to stop" cost a customer their history.
 *
 * Neither fires on the first click. Rows sit directly on top of each other, so a
 * single-click removal here is a mis-click away from taking out the wrong
 * integration — and unlike rename, the user cannot see what they destroyed in
 * order to put it back. Disconnect confirms in place; delete additionally asks
 * for the connection's name to be typed, because it is the one that cannot be
 * walked back.
 *
 * Webhook-capable connections also expose their inbound URL here. It previously
 * lived only on the connection page, which left the Custom Webhook connector —
 * whose entire function IS that URL — saving successfully and then telling the
 * user nothing about what to do next. It is a disclosure rather than always-on
 * text because most rows are OAuth sources nobody needs to paste anywhere.
 */
export function ConnectionRow({
  id,
  name,
  source,
  status,
  webhookUrl,
  webhookSetup,
  eventTimeNote,
  records,
  pausedNote,
  lastError,
  importNote,
}: {
  id: string;
  name: string;
  source: string;
  status: string;
  webhookUrl?: string;
  webhookSetup?: string;
  /**
   * Set while the connection is deferred (breaker window or exhausted rate
   * budget): why, and roughly when it retries by itself. Preformatted by the
   * server. Without this, a paused source is indistinguishable on this list
   * from a healthy one — the pause was only visible one click deeper, on a
   * page nothing pointed at.
   */
  pausedNote?: string;
  /** The stored failure, shown only when the row is in `error` and NOT merely paused. */
  lastError?: string;
  /**
   * Set only while this source is still pulling history — so a customer can
   * tell "that's all of it" from "that's all of it SO FAR" before building a
   * metric on it. Absent means either finished or no evidence either way;
   * neither claims completion.
   */
  importNote?: string;
  /**
   * Live records synced from this connection, for the delete warning.
   *
   * "This deletes your data" is a sentence people skim. A number is not — it is
   * the difference between agreeing to an abstraction and agreeing to losing
   * 12,480 rows.
   */
  records?: number;
  /**
   * What this connection is dating its events FROM — the payload key it found,
   * or delivery time, said out loud.
   *
   * Delivery time is a defensible answer for a payload that carries no
   * timestamp; delivery time presented AS the event time is not, and it was
   * presented as nothing at all. This is the surface that makes the difference
   * visible, and without it the detection is the silent half of a fix.
   */
  eventTimeNote?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Separate from `confirming`, not a mode of it. Disconnect and delete are two
  // different promises, and a shared piece of state is how they end up sharing
  // a mistake.
  const [deleting, setDeleting] = useState(false);
  const [typed, setTyped] = useState("");
  const [showHook, setShowHook] = useState(false);

  const save = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === name) {
      setDraft(name);
      return;
    }
    setSaving(true);
    await renameConnectionAction(id, next);
    setSaving(false);
    router.refresh();
  };

  /**
   * PERMANENT DELETE. Its own panel, its own copy, and a typed confirmation.
   *
   * FIRST, ahead of the disconnected-row branch, and that ordering is load-
   * bearing: this panel is reachable from an ACTIVE row and a DISCONNECTED one,
   * and if the `status === "disabled"` early return came first, clicking Delete
   * on a disconnected integration would set the state and then render the
   * ordinary row anyway. A button that silently does nothing on half the rows it
   * appears on is worse than one that is not there.
   *
   * Type-to-confirm rather than a second click, because the rows of this list
   * sit directly on top of each other and the two destructive actions are
   * adjacent: a click is a mis-click away from the wrong integration, and this
   * is the one that cannot be undone. Typing the name cannot be done by
   * accident, and it forces a look at WHICH connection this is.
   *
   * The copy leads with what is destroyed and how much of it, then says what a
   * later reconnect would and would not recover — because "delete" reads as
   * "remove from the list" to plenty of people, and the thing they will discover
   * otherwise is that their history is gone.
   */
  if (deleting) {
    const armed = typed.trim() === name.trim();
    return (
      <div className="border-l-2 border-danger bg-danger-soft/40 px-4 py-3">
        <p className="text-base font-semibold text-foreground">Permanently delete {name}?</p>
        <p className="mt-1 text-base text-muted-foreground">
          This removes the connection and{" "}
          <span className="font-semibold text-foreground">
            {records == null ? (
              "everything synced from it"
            ) : (
              <>
                all <span className="tnum">{formatMetricValue(records, { format: "number" })}</span> records synced from
                it
              </>
            )}
          </span>
          , along with their original payloads and this connection&rsquo;s entire sync history. Flows reading it will
          show no data.
        </p>
        <p className="mt-1 text-base text-muted-foreground">
          <span className="font-semibold text-foreground">This cannot be undone.</span> Connecting the same account
          again starts from nothing and re-imports only as much history as the provider still offers — which is usually
          far less than you have now.{" "}
          {status !== "disabled" && (
            <>Disconnect instead if you only want it to stop syncing; that keeps everything and can be reversed.</>
          )}
        </p>
        <FieldLabel className="mt-3" htmlFor={`confirm-${id}`}>
          {/* The name carries no weight of its own: the label is already
              semibold, so any inner weight could only be LIGHTER, thinning
              out the one string the user has to type exactly. */}
          Type {name} to confirm
        </FieldLabel>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={`confirm-${id}`}
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={name}
            className="h-8 min-w-0 flex-1 text-small"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setTyped("");
              setDeleting(false);
            }}
          >
            Cancel
          </Button>
          <form action={deleteConnectionAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="confirmName" value={typed} />
            <Button type="submit" variant="destructive" size="sm" disabled={!armed}>
              Delete everything
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // A disconnected connection is not gone — its row, its streams and its
  // (tombstoned) events all survive. Showing it with a Reconnect button is what
  // stops someone re-adding the account instead, which imports a second copy of
  // the whole dataset rather than restoring this one.
  if (status === "disabled") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        {/* Same anatomy as a live row — mark, name, one muted line — at half
            strength on the mark. A disconnected integration that loses its
            colour block entirely stops looking like the same object, and this
            row's whole job is to say "it is still here, and you can have it
            back". */}
        <span className="flex min-w-0 items-center gap-3">
          <ConnectorChip source={source} className="opacity-50" />
          <span className="min-w-0">
            <span className="block truncate text-md font-semibold text-foreground">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              Not syncing — its records are hidden from dashboards and flows.
            </span>
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <StatusPill tone="pending">Disconnected</StatusPill>
          <form action={reconnectAction}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="secondary" size="sm">
              Reconnect
            </Button>
          </form>
          {/* Reachable here too, and deliberately: a disconnected integration is
              exactly where someone goes to get rid of one for good, and without
              this the only way to finish the job is to reconnect it first. */}
          <DeleteButton name={name} onClick={() => setDeleting(true)} />
        </span>
      </div>
    );
  }

  if (confirming) {
    return (
      // The same left rule the delete panel carries, so the two confirmations
      // read as one kind of object interrupting the list rather than as two
      // different treatments of the same moment.
      <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-danger bg-danger-soft/40 px-4 py-3">
        <p className="min-w-0 text-base text-muted-foreground">
          Disconnect <span className="font-semibold text-foreground">{name}</span>? Its synced records stop appearing in
          dashboards and flows, and it stops syncing. Any flow reading from it will have no data.
          {/* The disconnect is reversible and the user has to be told so, or
              they will do the destructive thing instead: add the account again,
              which imports a second copy of everything rather than restoring
              this one. */}{" "}
          <span className="font-semibold text-foreground">You can reconnect it later and your data comes back.</span>
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <form action={disconnectAction}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="destructive" size="sm">
              Disconnect
            </Button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="group">
      <div className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-foreground/5">
        {/* THE CONNECTOR IS THE ROW'S IDENTITY, and it is the only thing that
            legitimately varies row to row — so it leads, in a block of its own
            colour, exactly as it does on the flows board and in the catalogue
            below. The app's name moves out of the right-hand cluster (where it
            sat as grey text between a button and a dot) and becomes the row's
            meta line, which is where every other list in this product puts it. */}
        <ConnectorChip source={source} />
        {editing ? (
          <Input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") {
                setDraft(name);
                setEditing(false);
              }
            }}
            className="h-9 min-w-0 flex-1 text-md font-semibold"
          />
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-1">
            <span className="min-w-0">
              {/* The violet arrives on HOVER, which is the accent's own job on
                  this sheet (selection), and it replaces an underline that made
                  a row of connection names read as a page of links. */}
              <Link
                href={`/connections/${id}`}
                className="block truncate rounded-control text-md font-semibold text-foreground transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:text-accent-foreground"
              >
                {saving ? draft : name}
              </Link>
              <span className="block truncate text-xs text-muted-foreground">
                {catalogEntry(source)?.name ?? source}
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              onClick={() => {
                setDraft(name);
                setEditing(true);
              }}
              title="Rename this connection"
              aria-label="Rename this connection"
            >
              <Pencil size={14} strokeWidth={2.25} />
            </Button>
          </span>
        )}
        <span className="flex shrink-0 items-center gap-2 text-base text-muted-foreground">
          {webhookUrl && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setShowHook((v) => !v)}
              aria-expanded={showHook}
            >
              {showHook ? "Hide webhook URL" : "Webhook URL"}
            </Button>
          )}
          {/* A 8px dot with an aria-label was the whole of this row's status:
              legible to a screen reader and to nobody else. The pill is the
              kit's one state vocabulary, and it says the word. */}
          <RowStatusPill status={status} />
          {/* TWO destructive actions, and the icons have to carry the difference.
              Disconnect is a POWER symbol — stop it, reversibly. Delete is the
              trash, which is what people already read as "gone for good"; leaving
              the trash on the reversible one and inventing a symbol for the
              permanent one would put the familiar icon on the wrong promise. The
              mis-click risk that swap creates is answered by the typed
              confirmation, which a slip cannot complete. */}
          <Button
            type="button"
            variant="ghost"
            size="iconSm"
            onClick={() => setConfirming(true)}
            className="opacity-0 transition-opacity hover:bg-warn-soft hover:text-warn-ink focus-visible:opacity-100 group-hover:opacity-100"
            title={`Disconnect ${name} — stops syncing, keeps your data, reversible`}
            aria-label={`Disconnect ${name}`}
          >
            <Power size={14} strokeWidth={2.25} />
          </Button>
          <DeleteButton name={name} onClick={() => setDeleting(true)} />
        </span>
      </div>
      {/* Same promise as the connection page's amber banner (F.3/F.6): a pause
          is never a dead end, so the list says when it resolves itself.

          A BAND, NOT A DANGLING LINE. These were 12px sentences hung off the
          bottom of the row on a negative margin, in a colour and nothing else —
          which on a white list reads as text that fell out of its container.
          The state's own soft wash, edge to edge under the row it belongs to,
          says the same thing as a piece of the row rather than as debris. */}
      {importNote && !pausedNote && !lastError && (
        <p className="border-t border-border bg-warn-soft/40 px-4 py-2 text-xs text-warn-ink">{importNote}</p>
      )}
      {(pausedNote || lastError) && (
        <p
          className={cn(
            "border-t border-border px-4 py-2 text-xs",
            pausedNote ? "bg-warn-soft/40 text-warn-ink" : "bg-danger-soft/40 text-danger-ink",
          )}
        >
          {pausedNote ? <>Paused, retrying automatically. {pausedNote}</> : lastError}
        </p>
      )}
      {showHook && webhookUrl && (
        // The disclosure is a TRAY — an alpha of the foreground, which reads as
        // one step recessed on a white card and on a dark one alike, where
        // `bg-muted/40` composited to #fbfbfb and gave the panel no surface of
        // its own at all.
        <div className="border-t border-border bg-foreground/5 px-4 py-4">
          {webhookSetup && <p className="mb-2 text-xs text-muted-foreground">{webhookSetup}</p>}
          {eventTimeNote && <p className="mb-2 text-xs text-muted-foreground">{eventTimeNote}</p>}
          <CopyField
            label="POST events to this URL"
            value={webhookUrl}
            isUrl
            hint="Anything this URL receives is stored and available to flows straight away."
          />
          <Link
            href={`/connections/${id}`}
            className="rounded-control text-xs font-medium text-accent-foreground hover:underline"
          >
            Signing secret and delivery status
          </Link>
        </div>
      )}
    </div>
  );
}

/**
 * THE CONNECTOR'S MARK ON A CHIP OF ITS OWN COLOUR — the flows board's pattern
 * (FlowRow), so a Close row looks like the same object on every screen that
 * lists one.
 *
 * The wash is `color-mix`ed from the vendor's own hex at 14% against
 * TRANSPARENT rather than white, so it composites onto whatever surface is
 * behind it — a dark card in the dark theme, the danger wash on a row being
 * deleted. A hex here would fail the kit gate, and rightly: the value belongs
 * to the vendor's map.
 */
function ConnectorChip({ source, className }: { source: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex size-10 shrink-0 items-center justify-center rounded-card", className)}
      style={{ backgroundColor: `color-mix(in srgb, ${sourceStyle(source).color} 14%, transparent)` }}
    >
      <SourceMark source={source} size={24} />
    </span>
  );
}

/**
 * The row's state, in the kit's one state vocabulary. The words are the ones
 * the old dot carried in its `aria-label`, promoted to something a sighted
 * user can also read.
 */
function RowStatusPill({ status }: { status: string }) {
  if (status === "active") {
    return (
      <StatusPill tone="success" dot>
        Connected
      </StatusPill>
    );
  }
  if (status === "error") return <StatusPill tone="danger">Needs attention</StatusPill>;
  return <StatusPill tone="pending">Not syncing</StatusPill>;
}

/**
 * The permanent-delete affordance, defined once because it appears on an active
 * row and on a disconnected one and the two must not drift apart.
 *
 * A trash can, deliberately: it is the symbol people already read as "gone for
 * good", and this is the only action here that is. Its title says what it
 * destroys — an icon button whose tooltip is just "Delete" tells you nothing you
 * could not guess and nothing you need to know.
 */
function DeleteButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="destructiveGhost"
      size="iconSm"
      onClick={onClick}
      title={`Delete ${name} permanently — removes the connection and all its data`}
      aria-label={`Delete ${name} permanently`}
    >
      <Trash2 size={14} strokeWidth={2.25} />
    </Button>
  );
}
