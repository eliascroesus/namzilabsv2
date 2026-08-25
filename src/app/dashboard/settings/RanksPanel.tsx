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
import { NODE_ACCENT } from "@/components/flow/node-accent";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Toast } from "@/components/ui/toast";
import { PERMISSIONS, type RankRow } from "@/lib/permissions";
import { assignRankAction, createRankAction, deleteRankAction, updateRankAction } from "./actions";

/**
 * The Roles editor. Every control here is a switch that saves the moment it
 * flips — optimistic flip, server call, revert plus a toast if the server
 * says no. There is deliberately NO Save button: a toggle that needs a Save
 * button is a checkbox wearing a costume, and the feature is meant to feel
 * like flipping breakers, not filling in a form.
 *
 * THE FEATURE IS SPELLED "ROLE" IN EVERY STRING AND "rank" IN EVERY
 * IDENTIFIER, and that split is deliberate rather than half-finished work.
 * "Rank" was never a word anyone outside this file used for the idea; the
 * screen it lives on already had roles on it (WorkOS's own, on the members
 * list), and two names for one concept is a support ticket per new admin. But
 * `workspace_ranks`, `rank_assignments`, `rankId`, `canManageRanks` and the
 * four server actions below are a table, two columns, a foreign key and the
 * permission model that reads them — renaming those is a migration plus a diff
 * across `lib/permissions.ts` in exchange for nothing a user can see.
 *
 * So: if you are adding a string here, it says role. If you are adding a
 * column, it says rank.
 *
 * The list is seeded from server props and then OWNED here: every edit lands
 * locally first so nothing waits on a round trip to feel done. Member counts
 * stay on props — they change through the Members list, whose action
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

// The rank marks wear the flow step accents (app green, unite blue, Summarize
// violet, time-between orange), cycled by index, so the list reads like a
// column of step cards rather than a form.
const RANK_ACCENTS = [NODE_ACCENT.app, NODE_ACCENT.unite, NODE_ACCENT.formula, NODE_ACCENT.time_between];

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
      showToast("Couldn't create the role — try again.");
    } finally {
      setCreating(false);
    }
  };

  // Deletion is the one edit that is NOT optimistic: losing a role changes
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
      showToast("Couldn't delete the role — try again.");
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
      ? "No one holds this role."
      : `${count(n, "member")} ${n === 1 ? "loses" : "lose"} this role and ${n === 1 ? "returns" : "return"} to full access.`;

  return (
    <div>
      {/* NO PREAMBLE. It explained that a role limits what its members can do
          and which metrics they see, and that members without one have full
          access — and the empty state below says the second half where it
          matters (to a workspace with no roles at all), while the first half is
          restated by the two groups inside every card, which are literally
          headed "Permissions" and "Metrics". */}
      {toast && <Toast>{toast}</Toast>}

      {/* Each role is a CARD — the builder's step-card anatomy (coloured mark,
          text-lead title, text-tiny meta), stacked with air between them like
          steps on the canvas. Expanding one grows it into a panel-chrome-style
          surface: hairline-divided groups on the one white plane. */}
      <div className="flex flex-col gap-3">
        {ranks.length === 0 && (
          <p className="py-2 text-center text-small text-muted-foreground">
            No roles yet — everyone has full access. Create one to start limiting what members see.
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
            <Card key={r.id} variant="surface" padding="none" className="overflow-hidden">
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
                  <Shield size={18} strokeWidth={2} className="text-white" />
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
                  {/* No hint: "What members holding this role can do" is the
                      definition of the word Permissions, and every row below
                      carries its own blurb saying what that one does. */}
                  <Group label="Permissions">
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

                  {/* Same: the rows ARE the dashboard tiles, listed by name
                      with a switch each. */}
                  <Group label="Metrics">
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

                  {/* This hint STAYS. "Inherit from" is the one group whose
                      label does not say what flipping a switch in it does, and
                      inheritance is the only control here that changes a role
                      by way of another one. */}
                  <Group label="Inherit from" hint="Stack another role's grants on top of this one.">
                    {others.length === 0 ? (
                      <p className="py-1.5 text-tiny text-muted-foreground">
                        Create a second role and it appears here.
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

                  {/* Stays too, and for the opposite reason to Inherit from:
                      "Danger" names a stake without naming the consequence, and
                      the consequence here is counter-intuitive — deleting a
                      role WIDENS access rather than removing it. */}
                  <Group label="Danger" hint="Deleting a role returns its members to full access.">
                    {confirmingDelete === r.id ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 py-1.5">
                        <p className="text-small text-muted-foreground">{deleteLine(holders)}</p>
                        <span className="flex shrink-0 gap-2">
                          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirmingDelete(null)}>
                            Cancel
                          </Button>
                          <Button type="button" variant="destructive" size="sm" onClick={() => destroy(r.id)}>
                            Delete role
                          </Button>
                        </span>
                      </div>
                    ) : (
                      /* destructiveGhost: the Danger label already names the
                         stakes, so the trigger stays quiet until hovered —
                         the confirm step is where the red lives. */
                      <Button type="button" variant="destructiveGhost" size="sm" onClick={() => setConfirmingDelete(r.id)}>
                        Delete role
                      </Button>
                    )}
                  </Group>
                </div>
              )}
            </Card>
          );
        })}

        {/* The list's foot: the builder's "Add next step" ghost, until it is
            clicked — then the same spot holds the name input and Create. */}
        {adding ? (
          <Card variant="surface" padding="dense">
            <form onSubmit={create} className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setAdding(false);
                  }}
                  required
                  placeholder="New role name"
                  aria-label="New role name"
                  className="max-w-sm"
                />
                <Button type="submit" disabled={creating || newName.trim() === ""}>
                  Create
                </Button>
              </div>
              {/* Whop's presets, reduced to the one that earns its place: Admin.
                  A preset is a STARTING POINT — it creates an ordinary role with
                  both masters on, fully editable after — so the chip says what it
                  does rather than hiding it behind a name. */}
              <div className="flex items-center gap-2">
                {(
                  [
                    { value: undefined, label: "Start blank", blurb: "grants nothing until you flip switches" },
                    { value: "admin" as const, label: "Admin preset", blurb: "all permissions and all metrics, on" },
                  ] as const
                ).map((o) => (
                  <Chip
                    key={o.label}
                    active={preset === o.value}
                    onClick={() => setPreset(o.value)}
                    title={o.blurb}
                  >
                    {o.label}
                  </Chip>
                ))}
                <span className="text-tiny text-muted-foreground">
                  {preset === "admin" ? "All permissions and all metrics, on — editable after." : "Grants nothing until you flip switches."}
                </span>
              </div>
            </form>
          </Card>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-2.5 rounded-surface border-2 border-dashed border-border p-3 text-left text-base font-semibold text-muted-foreground transition-colors duration-(--duration-fast) hover:border-primary hover:text-primary"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-control border-2 border-dashed border-current opacity-70">
              <Plus size={14} strokeWidth={2.25} />
            </span>
            New role
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * The per-member role picker in the Members list. "Full access" is the null
 * option because NO role means FULL access — restrictions begin when a role
 * is assigned — and naming the null state in the select teaches that rule
 * exactly where it applies. It is now the ONLY thing on the row that speaks
 * about access, since the WorkOS "Member" badge that used to sit beside it has
 * gone; see the note at its old call site in page.tsx.
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
    <>
      {error && <Toast>{error}</Toast>}
      <NativeSelect value={value} onChange={(e) => change(e.target.value)} aria-label="Role" className="w-auto">
        <option value="">Full access</option>
        {ranks.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}

/**
 * One hairline-divided group of the expanded editor, shaped like the config
 * panel's fields: a bold black label that IS the question, optionally one muted
 * line of explainer under it, then the rows.
 *
 * `hint` IS OPTIONAL, and the two groups that dropped theirs are the reason.
 * A hint earns its line when the label alone does not say what flipping a
 * switch in the group does — true of "Inherit from" and of "Danger", false of
 * "Permissions" and "Metrics", whose hints were restatements of the noun above
 * them sitting on top of rows that each carry their own blurb. When it is
 * absent the label sits directly on the rows rather than leaving a gap where a
 * sentence used to be.
 */
function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-4">
      <p className="text-base font-semibold text-foreground">{label}</p>
      {hint && <p className="mt-0.5 text-tiny text-muted-foreground">{hint}</p>}
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
    <div className="flex items-center gap-3 py-2">
      {Icon && (
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-muted text-muted-foreground ${
            implied ? "opacity-45" : ""
          }`}
          aria-hidden
        >
          <Icon size={14} strokeWidth={2} />
        </span>
      )}
      <span className={`min-w-0 flex-1 ${implied ? "opacity-45" : ""}`}>
        <span className={`block truncate text-base ${bold ? "font-semibold" : "font-medium"} text-foreground`}>
          {label}
        </span>
        {blurb && <span className="block text-tiny text-muted-foreground">{blurb}</span>}
      </span>
      <Switch checked={implied || on} disabled={implied} onClick={onChange} aria-label={label} />
    </div>
  );
}
