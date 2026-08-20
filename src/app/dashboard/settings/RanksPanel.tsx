"use client";

import { useRef, useState } from "react";
import {
  ChevronDown,
  Eye,
  GitBranch,
  LineChart,
  Plug,
  Plus,
  Shield,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PERMISSIONS, type RankRow } from "@/lib/permissions";
import { assignRankAction, createRankAction, deleteRankAction, updateRankAction } from "./actions";

/**
 * The Ranks editor. Every control here is a switch that saves the moment it
 * flips — optimistic flip, server call, revert plus one red line if the server
 * says no. There is deliberately NO Save button: a toggle that needs a Save
 * button is a checkbox wearing a costume, and the feature is meant to feel
 * like flipping breakers, not filling in a form.
 *
 * The rank list is seeded from server props and then OWNED here: every edit
 * lands locally first so nothing waits on a round trip to feel done. Member
 * counts stay on props — they change through the Members list, whose action
 * revalidates this page, and keeping them off local state means they can never
 * go stale against an edit the panel didn't make.
 */

type CatalogueEntry = { key: string; name: string };
type UpdatePatch = Partial<
  Pick<RankRow, "name" | "allPermissions" | "permissions" | "allMetrics" | "metricKeys" | "inherits">
>;

const toggled = (list: string[], key: string) =>
  list.includes(key) ? list.filter((k) => k !== key) : [...list, key];

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The rank marks wear the flow step accents (src/components/flow/node-accent.ts:
// app green, unite blue, Summarize violet, time-between orange), cycled by
// index, so the list reads like a column of step cards rather than a form.
const RANK_ACCENTS = ["#0EAB0E", "#009ED3", "#D95FF2", "#F66700"];

// One glyph per permission, so each row reads like a library row (icon +
// title + blurb) instead of a line of prose.
const PERMISSION_ICONS: Record<string, LucideIcon> = {
  create_flows: Wrench,
  view_integrations: Eye,
  connect_integrations: Plug,
  manage_workspace: ShieldCheck,
};

export function RanksPanel({
  ranks: initialRanks,
  memberCounts,
  catalogue,
}: {
  ranks: RankRow[];
  memberCounts: Record<string, number>;
  catalogue: CatalogueEntry[];
}) {
  const [ranks, setRanks] = useState(initialRanks);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [preset, setPreset] = useState<"admin" | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (line: string) => {
    setToast(line);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  /**
   * Optimistic write. On failure only the keys this patch touched are put
   * back — reverting the whole snapshot could clobber a neighbouring toggle
   * the user flipped while this one was in flight.
   */
  const save = (id: string, patch: UpdatePatch) => {
    const prev = ranks.find((r) => r.id === id);
    if (!prev) return;
    const undo = Object.fromEntries(
      (Object.keys(patch) as (keyof UpdatePatch)[]).map((k) => [k, prev[k]]),
    ) as UpdatePatch;
    const revert = () => setRanks((rs) => rs.map((r) => (r.id === id ? { ...r, ...undo } : r)));
    setRanks((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    updateRankAction(id, patch)
      .then((res) => {
        if (!res.ok) {
          revert();
          showToast(res.error);
        }
      })
      .catch(() => {
        revert();
        showToast("Couldn't save that change — try again.");
      });
  };

  const create = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const res = await createRankAction(name, preset);
      if (res.ok) {
        // Blank grants NOTHING until switches flip — restrictive by default,
        // so creating one can never silently widen anyone's access. The Admin
        // preset is the one deliberate exception: both masters on, stated on
        // the chip before you press Create.
        const all = preset === "admin";
        setRanks((rs) => [
          ...rs,
          { id: res.id, name, allPermissions: all, permissions: [], allMetrics: all, metricKeys: [], inherits: [] },
        ]);
        setExpandedId(res.id);
        setNewName("");
        setAdding(false);
      } else {
        showToast(res.error);
      }
    } catch {
      showToast("Couldn't create the rank — try again.");
    } finally {
      setCreating(false);
    }
  };

  // Deletion is the one edit that is NOT optimistic: losing a rank changes
  // real people's access, so the row only disappears once the server agrees.
  const destroy = async (id: string) => {
    setConfirmingDelete(null);
    try {
      const res = await deleteRankAction(id);
      if (res.ok) {
        setRanks((rs) => rs.filter((r) => r.id !== id));
        if (expandedId === id) setExpandedId(null);
      } else {
        showToast(res.error);
      }
    } catch {
      showToast("Couldn't delete the rank — try again.");
    }
  };

  const summary = (r: RankRow) => {
    if (r.allPermissions && r.allMetrics) return "Everything";
    const p = r.allPermissions ? "All permissions" : count(r.permissions.length, "permission");
    const m = r.allMetrics ? "all metrics" : count(r.metricKeys.length, "metric");
    return `${p} · ${m}`;
  };

  const deleteLine = (n: number) =>
    n === 0
      ? "No one holds this rank."
      : `${count(n, "member")} ${n === 1 ? "loses" : "lose"} this rank and ${n === 1 ? "returns" : "return"} to full access.`;

  return (
    <div>
      <p className="mb-3 text-tiny text-muted-foreground">
        A rank limits what its members can do and which metrics they see. Members without a rank have
        full access — restrictions begin when you assign one.
      </p>

      {toast && (
        <p role="status" className="mb-2 text-tiny font-medium text-destructive">
          {toast}
        </p>
      )}

      {/* Each rank is a CARD — the builder's step-card anatomy (coloured mark,
          text-lead title, text-tiny meta), stacked with air between them like
          steps on the canvas. Expanding one grows it into a panel-chrome-style
          surface: hairline-divided groups on the one white plane. */}
      <div className="flex flex-col gap-3">
        {ranks.length === 0 && (
          <p className="py-2 text-center text-small text-muted-foreground">
            No ranks yet — everyone has full access. Create one to start limiting what members see.
          </p>
        )}

        {ranks.map((r, i) => {
          const open = expandedId === r.id;
          const holders = memberCounts[r.id] ?? 0;
          const others = ranks.filter((o) => o.id !== r.id);
          return (
            /* overflow-hidden is safe here (nothing inside pops over the edge —
               the delete confirm is inline) and keeps the header's hover tint
               within the 16px corners. */
            <div key={r.id} className="overflow-hidden rounded-surface border border-border bg-card shadow-card">
              <button
                type="button"
                onClick={() => {
                  setExpandedId(open ? null : r.id);
                  setConfirmingDelete(null);
                }}
                className="flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:bg-muted"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control"
                  style={{ backgroundColor: RANK_ACCENTS[i % RANK_ACCENTS.length] }}
                  aria-hidden
                >
                  <Shield size={18} strokeWidth={2.25} className="text-white" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-lead font-semibold text-foreground">{r.name}</span>
                  <span className="block text-tiny text-muted-foreground">
                    {count(holders, "member")} · {summary(r)}
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  className={`shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>

              {open && (
                <div className="divide-y divide-border border-t border-border">
                  <Group label="Permissions" hint="What members holding this rank can do.">
                    {/* The master carries its own hairline: "everything" is a
                        different kind of statement from any one grant. */}
                    <div className="mb-1 border-b border-border pb-1">
                      <ToggleRow
                        bold
                        label="All permissions"
                        on={r.allPermissions}
                        onChange={() => save(r.id, { allPermissions: !r.allPermissions })}
                      />
                    </div>
                    {/* While the master is on, the rows below are IMPLIED —
                        shown on but disabled — and the underlying array is
                        left alone, so flipping the master off restores the
                        exact selection it covered. */}
                    {PERMISSIONS.map((p) => (
                      <ToggleRow
                        key={p.key}
                        icon={PERMISSION_ICONS[p.key]}
                        label={p.label}
                        blurb={p.blurb}
                        on={r.permissions.includes(p.key)}
                        implied={r.allPermissions}
                        onChange={() => save(r.id, { permissions: toggled(r.permissions, p.key) })}
                      />
                    ))}
                  </Group>

                  <Group label="Metrics" hint="Which dashboard tiles this rank can see.">
                    {/* The master stays even with an empty catalogue: the
                        blanket grant exists so "everything" doesn't go stale
                        as flows get published later. */}
                    <div className="mb-1 border-b border-border pb-1">
                      <ToggleRow
                        bold
                        label="All metrics"
                        on={r.allMetrics}
                        onChange={() => save(r.id, { allMetrics: !r.allMetrics })}
                      />
                    </div>
                    {catalogue.length === 0 ? (
                      <p className="py-1.5 text-tiny text-muted-foreground">
                        Publish a flow and its metrics appear here.
                      </p>
                    ) : (
                      catalogue.map((c) => (
                        <ToggleRow
                          key={c.key}
                          icon={LineChart}
                          label={c.name}
                          on={r.metricKeys.includes(c.key)}
                          implied={r.allMetrics}
                          onChange={() => save(r.id, { metricKeys: toggled(r.metricKeys, c.key) })}
                        />
                      ))
                    )}
                  </Group>

                  <Group label="Inherit from" hint="Stack another rank's grants on top of this one.">
                    {others.length === 0 ? (
                      <p className="py-1.5 text-tiny text-muted-foreground">
                        Create a second rank and it appears here.
                      </p>
                    ) : (
                      others.map((o) => (
                        <ToggleRow
                          key={o.id}
                          icon={GitBranch}
                          label={o.name}
                          blurb={`Gets everything ${o.name} can see and do, and follows when ${o.name} changes`}
                          on={r.inherits.includes(o.id)}
                          onChange={() => save(r.id, { inherits: toggled(r.inherits, o.id) })}
                        />
                      ))
                    )}
                  </Group>

                  <Group label="Danger" hint="Deleting a rank returns its members to full access.">
                    {confirmingDelete === r.id ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 py-1.5">
                        <p className="text-small text-muted-foreground">{deleteLine(holders)}</p>
                        <span className="flex shrink-0 gap-2">
                          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingDelete(null)}>
                            Cancel
                          </Button>
                          <Button type="button" variant="destructive" size="sm" onClick={() => destroy(r.id)}>
                            Delete rank
                          </Button>
                        </span>
                      </div>
                    ) : (
                      /* destructiveGhost: the Danger label already names the
                         stakes, so the trigger stays quiet until hovered —
                         the confirm step is where the red lives. */
                      <Button type="button" variant="destructiveGhost" size="sm" onClick={() => setConfirmingDelete(r.id)}>
                        Delete rank
                      </Button>
                    )}
                  </Group>
                </div>
              )}
            </div>
          );
        })}

        {/* The list's foot: the builder's "Add next step" ghost, until it is
            clicked — then the same spot holds the name input and Create. */}
        {adding ? (
          <form
            onSubmit={create}
            className="space-y-3 rounded-surface border border-border bg-card p-3 shadow-card"
          >
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setAdding(false);
                }}
                required
                placeholder="New rank name"
                aria-label="New rank name"
                className="w-full max-w-sm rounded-control border border-input bg-card px-3 py-2 text-base text-foreground focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
              />
              <Button type="submit" disabled={creating || newName.trim() === ""}>
                Create
              </Button>
            </div>
            {/* Whop's presets, reduced to the one that earns its place: Admin.
                A preset is a STARTING POINT — it creates an ordinary rank with
                both masters on, fully editable after — so the chip says what it
                does rather than hiding it behind a name. */}
            <div className="flex items-center gap-2">
              {(
                [
                  { value: undefined, label: "Start blank", blurb: "grants nothing until you flip switches" },
                  { value: "admin" as const, label: "Admin preset", blurb: "all permissions and all metrics, on" },
                ] as const
              ).map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setPreset(o.value)}
                  aria-pressed={preset === o.value}
                  className={`rounded-full px-3 py-1.5 text-small font-medium transition-colors ${
                    preset === o.value
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-foreground hover:bg-muted"
                  }`}
                  title={o.blurb}
                >
                  {o.label}
                </button>
              ))}
              <span className="text-tiny text-muted-foreground">
                {preset === "admin" ? "All permissions and all metrics, on — editable after." : "Grants nothing until you flip switches."}
              </span>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2.5 rounded-surface border-2 border-dashed border-border p-3 text-left text-base font-semibold text-muted-foreground transition-all hover:border-primary hover:text-primary"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-control border-2 border-dashed border-current opacity-70">
              <Plus size={15} strokeWidth={2.5} />
            </span>
            New rank
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The per-member rank picker in the Members list. "Full access" is the null
 * option because NO rank means FULL access — restrictions begin when a rank
 * is assigned — and naming the null state in the select teaches that rule
 * exactly where it applies.
 */
export function MemberRankSelect({
  memberUserId,
  rankId,
  ranks,
}: {
  memberUserId: string;
  rankId: string | null;
  ranks: { id: string; name: string }[];
}) {
  const [value, setValue] = useState(rankId ?? "");
  const [error, setError] = useState<string | null>(null);
  const errTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const change = (next: string) => {
    const prev = value;
    setValue(next); // optimistic — the select must never lag the click
    assignRankAction(memberUserId, next === "" ? null : next)
      .then((res) => {
        if (!res.ok) fail(prev, res.error);
      })
      .catch(() => fail(prev, "Couldn't save — try again."));
  };
  const fail = (prev: string, line: string) => {
    setValue(prev);
    setError(line);
    if (errTimer.current) clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setError(null), 5000);
  };

  return (
    <span className="flex items-center gap-2">
      {error && (
        <span role="status" className="text-tiny font-medium text-destructive">
          {error}
        </span>
      )}
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        aria-label="Rank"
        className="h-8 rounded-control border border-input bg-card px-2.5 text-small text-foreground focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
      >
        <option value="">Full access</option>
        {ranks.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </span>
  );
}

/**
 * One hairline-divided group of the expanded editor, shaped like the config
 * panel's fields: a bold black label that IS the question, one muted line of
 * explainer under it, then the rows.
 */
function Group({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-4">
      <p className="text-base font-semibold text-foreground">{label}</p>
      <p className="mt-0.5 text-tiny text-muted-foreground">{hint}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function ToggleRow({
  icon: Icon,
  label,
  blurb,
  on,
  implied = false,
  bold = false,
  onChange,
}: {
  /** The row's glyph, in a 28px muted tile. Master rows go without. */
  icon?: LucideIcon;
  label: string;
  blurb?: string;
  on: boolean;
  /** Covered by an "All …" master: shown on but disabled, selection kept. */
  implied?: boolean;
  bold?: boolean;
  onChange: () => void;
}) {
  return (
    <div className={`flex items-center gap-3 py-2 ${implied ? "opacity-45" : ""}`}>
      {Icon && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground" aria-hidden>
          <Icon size={15} strokeWidth={2} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-base ${bold ? "font-semibold" : "font-medium"} text-foreground`}>
          {label}
        </span>
        {blurb && <span className="block text-tiny text-muted-foreground">{blurb}</span>}
      </span>
      <Switch on={implied || on} disabled={implied} onChange={onChange} label={label} />
    </div>
  );
}

/**
 * FlowSwitch's geometry (src/components/flow/FlowToolbar.tsx), exactly —
 * settings must feel like the same product as the builder, so the knob rides
 * the same spring in the same track: 20px knob in a 40px track, 18px = 40 −
 * 20 − the 2px inset it rests in when off. No opacity here when disabled —
 * the implied row dims as a whole, and dimming twice reads as broken rather
 * than covered.
 */
function Switch({
  on,
  disabled,
  onChange,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onChange}
      aria-label={label}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-neutral-200"} ${
        disabled ? "cursor-not-allowed" : "hover:brightness-105"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm ${on ? "left-[18px]" : "left-0.5"}`}
        style={{ transition: "left .22s cubic-bezier(.34,1.56,.64,1)" }}
        aria-hidden
      />
    </button>
  );
}
