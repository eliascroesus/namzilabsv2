"use client";

import { Pencil, Plug, Power, Search, Trash2, X } from "lucide-react";

import { Fragment, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CopyField } from "@/components/copy-field";
import { renameConnectionAction, disconnectAction, reconnectAction, deleteConnectionAction } from "./actions";
import { catalogEntry } from "@/connectors/catalog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal, ModalTitle } from "@/components/ui/modal";
import { Input, NativeSelect } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";
import { BOARD_GRID, SectionHeading } from "@/components/ui/page";
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
        <p className="text-sm font-semibold text-foreground">Permanently delete {name}?</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This removes the connection and{" "}
          <span className="font-semibold text-foreground">
            {records == null ? (
              "everything synced from it"
            ) : (
              <>
                all <span className="tnum">{formatMetricValue(records, { format: "number" })}</span>{" "}records synced from
                it
              </>
            )}
          </span>
          , along with their original payloads and this connection&rsquo;s entire sync history. Flows reading it will
          show no data.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">This cannot be undone.</span>{" "}Connecting the same account
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
            className="h-8 min-w-0 flex-1 text-sm"
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
        <p className="min-w-0 text-sm text-muted-foreground">
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
              <Pencil size={14} />
            </Button>
          </span>
        )}
        <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
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
            <Power size={14} />
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
function ConnectorChip({ source, size = 40, className }: { source: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex shrink-0 items-center justify-center rounded-card", className)}
      // Sized by style rather than by a `size-10` class because the chip now
      // appears at three scales — 40 in a row, 44 on a catalogue card, 44 in the
      // connect dialog — and the mark inside has to step WITH the block. One
      // ratio (0.6) keeps the stamp centred in the same amount of colour at every
      // size; two hand-picked pairs would drift the first time one of them moved.
      style={{
        width: size,
        height: size,
        backgroundColor: `color-mix(in srgb, ${sourceStyle(source).color} 14%, transparent)`,
      }}
    >
      <SourceMark source={source} size={Math.round(size * 0.6)} />
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
      <Trash2 size={14} />
    </Button>
  );
}

/* ===========================================================================
 * THE DIRECTORY — the client half of the Apps page.
 *
 * It lives beside the row rather than in a file of its own because the two are
 * the same screen: the row IS what Manage renders, and the directory is what
 * decides whether Manage is on screen at all. Splitting them would put one
 * component's state in one file and the list it governs in another.
 *
 * WHAT IS SERVER AND WHAT IS CLIENT, and why it is drawn here. Everything with
 * a secret in it — the connect form, the server action it posts to — is
 * authored on the page (a server component) and arrives here as a `ReactNode`
 * slot. This side owns only the three things that have to answer a keystroke:
 * the search, the filter, and which dialog is open. That division is what lets
 * the search filter INSTANTLY (no round trip per character) without the
 * credential form ever being written in a client file.
 *
 * It is also what fixed the old form's worst property: the seven connect forms
 * used to be `<details>` elements, so all seven were in the DOM the moment the
 * tab loaded and every password manager in the world had seven masked fields to
 * fill. A dialog renders its fields when it opens and removes them when it
 * closes, so there is nothing there to fill until somebody asks for it.
 * ========================================================================= */

/** One entry in the catalogue, flattened for the grid. */
export type DirectoryApp = {
  source: string;
  name: string;
  description: string;
  /** Capability, not state — what this connector CAN do (see the card's chips). */
  instant: boolean;
  poll: boolean;
  /** Live connections on this source in this workspace; 0 means "not connected". */
  connectedCount: number;
  /** OAuth sources leave the app to connect, so they have no dialog and no form. */
  oauthHref?: string;
  /**
   * The credential form, rendered on the server and shown inside the dialog.
   *
   * A node rather than a field description, because the fields are the one part
   * of this page that is pinned by a test (tests/no-autofill.test.ts reads
   * page.tsx) and the one part that must not drift into a client file.
   */
  form?: ReactNode;
};

/** One live connection, with its server-rendered row. */
export type ManagedConnection = { id: string; name: string; source: string; row: ReactNode };

/** The filter's five answers. `available` is "everything I have not connected". */
type AppFilter = "all" | "connected" | "available" | "instant" | "scheduled";

const FILTER_LABELS: Array<[AppFilter, string]> = [
  ["all", "All apps"],
  ["connected", "Connected"],
  ["available", "Not connected"],
  ["instant", "Instant sync"],
  ["scheduled", "Scheduled sync"],
];

export function AppDirectory({
  apps,
  connected,
  connectionsUnavailable,
  tally,
}: {
  apps: DirectoryApp[];
  connected: ManagedConnection[];
  /** The connection read FAILED — distinct from "there are none". */
  connectionsUnavailable: boolean;
  /** "3 syncing · 1 disconnected", preformatted by the server. */
  tally: string;
}) {
  const [view, setView] = useState<"discover" | "manage">("discover");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AppFilter>("all");
  // The dialog is identified by SOURCE, not by the object: the apps array is a
  // fresh set of props on every server render, and holding the entry itself
  // would pin a stale form node open across one.
  const [connecting, setConnecting] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();
  const matches = (...fields: string[]) => !needle || fields.some((f) => f.toLowerCase().includes(needle));

  const visibleApps = apps.filter(
    (a) =>
      matches(a.name, a.description, a.source) &&
      (filter === "all" ||
        (filter === "connected" && a.connectedCount > 0) ||
        (filter === "available" && a.connectedCount === 0) ||
        (filter === "instant" && a.instant) ||
        (filter === "scheduled" && a.poll)),
  );
  // Connections are searched by the name the USER gave them and by the app they
  // belong to — "sheets" has to find "Sales sheet" and "Ops rollup" alike.
  const visibleConnections = connected.filter((c) => matches(c.name, catalogEntry(c.source)?.name ?? c.source));
  const openApp = apps.find((a) => a.source === connecting) ?? null;
  const narrowed = needle.length > 0 || filter !== "all";

  return (
    <>
      {/* THE TOOLBAR: which list, then how to cut it down. One row, wrapping —
          the segment and the search are the same decision at two grains and a
          user reads them left to right. */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {/* The track is `bg-foreground/5`, NOT `bg-muted`: `--muted` and `--card`
            are the same token in the dark theme, and the page is a card, so a
            muted track would be no track at all there. An alpha of the
            foreground reads as one step recessed on both surfaces — the same
            argument the flows board's footer tray makes. */}
        <div
          role="group"
          aria-label="Apps view"
          className="flex shrink-0 items-center gap-1 rounded-full bg-foreground/5 p-1"
        >
          {/* BLACK MARKS THE ACTIVE ONE, which is the kit's own division of
              labour: black does the work (default buttons, the active tab), the
              brand's yellow fills the single act a screen exists for, and a
              two-state view toggle is navigation rather than an act. Violet
              draws lines and coloured glyphs, so it has nothing to fill here
              either. */}
          <ViewTab active={view === "discover"} onClick={() => setView("discover")}>
            Discover
          </ViewTab>
          <ViewTab active={view === "manage"} onClick={() => setView("manage")} count={connected.length}>
            Manage
          </ViewTab>
        </div>
        <div className="relative min-w-56 flex-1">
          {/* `left-4` mirrors the field's own px-4, and `pl-10` is that inset
              plus the glyph — so the placeholder starts where the icon ends
              rather than under it. */}
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find apps and integrations"
            aria-label="Find apps and integrations"
            className="pl-10"
          />
        </div>
        {/* The filter narrows the CATALOGUE, so it is only offered while the
            catalogue is on screen. A control that stays visible and stops
            applying is worse than one that leaves: it goes on claiming to
            govern a list it no longer touches. The search applies to both. */}
        {view === "discover" && (
          <NativeSelect
            className="w-full shrink-0 sm:w-52"
            aria-label="Filter apps"
            value={filter}
            onChange={(e) => setFilter(e.target.value as AppFilter)}
          >
            {FILTER_LABELS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        )}
      </div>

      {/* THE SHELF — the band the catalogue sits in.
          It was the page's one recessed section back when the page itself was
          painted `bg-card`; that is gone (see page.tsx for why it only ever
          worked in light theme), so this is now the app's own surface and the
          band is defined by its BORDER and its padding rather than by a change
          of colour. That is the honest version: the cards are the figures, and
          they read against this surface in both themes without the page having
          to become a third one.
          `bg-background` by name so it stays the canvas colour if anything ever
          places this shelf on something else. Both views share it, so switching
          Discover for Manage changes what is on the shelf rather than swapping
          one kind of surface for another. */}
      <section className="mt-5 rounded-surface border border-border bg-background p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <SectionHeading className="mb-0">{view === "discover" ? "All apps" : "Connected apps"}</SectionHeading>
          <span className="text-xs text-muted-foreground">
            {view === "discover"
              ? narrowed
                ? `${visibleApps.length} of ${apps.length} apps`
                : `${apps.length} apps`
              : tally}
          </span>
        </div>

        {view === "discover" ? (
          visibleApps.length === 0 ? (
            <EmptyState
              icon={<Search />}
              // Both controls can be the reason a catalogue is empty, and an
              // empty state that names only one of them sends someone hunting
              // for a search term while a filter is what is hiding everything.
              title="Nothing in the catalogue matches"
              description="No app answers to that search and that filter together. Clearing both shows everything we connect to."
              action={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  Clear search and filter
                </Button>
              }
            />
          ) : (
            // The shared board grid, so this catalogue steps its columns exactly
            // as the dashboard's tiles and the flows board do — one rhythm for
            // the whole product, spelled in one place.
            //
            // NO `items-start`: the cards stretch, which is what puts every
            // Connect button in a row on the same line. A grid of cards whose
            // actions sit at four different heights is the single thing that
            // made this catalogue read as unfinished.
            <div className={BOARD_GRID}>
              {visibleApps.map((app) => (
                <AppCard key={app.source} app={app} onConnect={() => setConnecting(app.source)} />
              ))}
            </div>
          )
        ) : connectionsUnavailable ? (
          <EmptyState
            icon={<Plug />}
            title="Your connections couldn’t be loaded"
            description="This is a problem on our side — nothing has been disconnected and no data has been lost. Refresh to try again."
          />
        ) : connected.length === 0 ? (
          <EmptyState
            icon={<Plug />}
            title="No connections yet"
            description="Connect an app and its records start arriving here."
            action={
              <Button type="button" onClick={() => setView("discover")}>
                Browse apps
              </Button>
            }
          />
        ) : visibleConnections.length === 0 ? (
          <EmptyState
            icon={<Search />}
            title="No connections match that search"
            description="Connections are searched by the name you gave them and by the app they belong to."
            action={
              <Button type="button" variant="secondary" onClick={() => setQuery("")}>
                Clear search
              </Button>
            }
          />
        ) : (
          // The hairlines live on this wrapper rather than on the Card, so the
          // first row does not draw one against the card's own edge.
          <Card variant="surface" padding="none" className="overflow-hidden">
            <div className="divide-y divide-border">
              {visibleConnections.map((c) => (
                <Fragment key={c.id}>{c.row}</Fragment>
              ))}
            </div>
          </Card>
        )}
      </section>

      {/* THE CONNECT DIALOG. A form that asks for a token is not a disclosure on
          a card: it is one thing to do, and it deserves the whole screen's
          attention while it is being done. `Modal` traps focus and locks the
          page behind it, which is exactly what the old inline `<details>` could
          not do — you could tab straight out of a half-typed API key. */}
      {openApp && (
        <Modal onClose={() => setConnecting(null)} size="md">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <ConnectorChip source={openApp.source} size={44} />
              <div className="min-w-0">
                <ModalTitle>Connect {openApp.name}</ModalTitle>
                <p className="mt-1 text-sm text-muted-foreground">{openApp.description}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="iconSm"
              onClick={() => setConnecting(null)}
              aria-label="Close"
              className="-mr-2 -mt-2"
            >
              <X size={16} />
            </Button>
          </div>
          {openApp.form}
        </Modal>
      )}
    </>
  );
}

/**
 * One segment of the view switch. `aria-pressed` rather than `role="tab"`: a
 * real tab list owes a keyboard user arrow-key navigation, and a half-built one
 * is a promise to a screen reader that the widget does not keep. Two toggle
 * buttons are what these actually are.
 */
function ViewTab({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "ghost"}
      size="sm"
      aria-pressed={active}
      onClick={onClick}
      // The inactive segment hovers to the CARD colour rather than to the
      // ghost's own `bg-muted`: it is sitting on a recessed track, so the
      // hover has to come FORWARD to the page's own surface. Hovering to
      // muted on this track is a hover with nothing to say — and in the dark
      // theme it is the same colour twice.
      className={cn(!active && "hover:bg-card")}
    >
      {children}
      {count != null && count > 0 && <span className="tnum opacity-70">{count}</span>}
    </Button>
  );
}

/**
 * ONE APP IN THE CATALOGUE: mark, name, one line, what it can do, and the one
 * thing you can do to it.
 *
 * The card is not itself a button. Everything on it that does something is a
 * real control, because a clickable card with a button inside it is either two
 * nested interactive elements or a card that swallows its own action.
 */
function AppCard({ app, onConnect }: { app: DirectoryApp; onConnect: () => void }) {
  const connected = app.connectedCount > 0;
  return (
    <Card variant="surface" padding="compact" className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3">
        {/* The connector's own colour is the only thing that legitimately varies
            card to card, so it leads — a 44px block of it is what gives a card
            in a grid of seven a corner to be recognised by, and it is where all
            the colour on this page comes from. */}
        <ConnectorChip source={app.source} size={44} />
        {/* A connected count is STATE — this app is live in this workspace — so
            it speaks in the success trio with the live dot, the same pill the
            connection rows use. */}
        {connected && (
          <StatusPill tone="success" dot className="tnum">
            {app.connectedCount > 1 ? `${app.connectedCount} connected` : "Connected"}
          </StatusPill>
        )}
      </div>
      <h3 className="mt-3 text-md font-semibold text-foreground">{app.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{app.description}</p>
      {/* Capabilities, not states: what this connector CAN do, which is the
          quiet Badge's whole job. Colouring these would put a decorative chip
          and a status pill on the same card wearing the same shape. */}
      <div className="mt-3 flex flex-wrap gap-2">
        {app.instant && <Badge>Instant</Badge>}
        {app.poll && <Badge>Scheduled</Badge>}
      </div>
      {/* `mt-auto` is what the stretched card is for: the action sits on the
          card's floor, so a row of cards has one line of buttons. Full width in
          both branches — a 96px pill at the left edge of a 370px card is the
          shape that read as unfinished. Black, not the brand's yellow: seven of
          these are on screen at once, and the yellow fill means "the one act
          here" — seven of them is a catalogue with no act in it at all. */}
      <div className="mt-auto pt-4">
        {app.oauthHref ? (
          <a href={app.oauthHref} className={cn(buttonVariants({ variant: "accent" }), "w-full")}>
            Connect with Google
          </a>
        ) : (
          <Button type="button" className="w-full" onClick={onConnect}>
            {connected ? "Connect another" : "Connect"}
          </Button>
        )}
      </div>
    </Card>
  );
}
