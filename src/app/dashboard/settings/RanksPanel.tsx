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
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Toast } from "@/components/ui/toast";
import { PERMISSIONS, type RankRow } from "@/lib/permissions";
import { cn } from "@/lib/utils";
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

/**
 * THE ROLE MARKS, MOVED OFF THE FLOW PALETTE AND ONTO THE SHEET'S OWN.
 *
 * They used to be `NODE_ACCENT` — the builder's step colours (app green, unite
 * blue, Summarize violet) — carried in through an inline `style`. Two problems,
 * one of them the whole reason this pass exists: a role has nothing to do with
 * a flow step, so a green one implied a relationship that does not exist; and
 * this page now spends the sheet's decorative three on the member avatars, so
 * a second, unrelated palette on the same screen read as noise rather than as
 * identity.
 *
 * Same three colours as the avatars, in the OTHER shape: a circle is a person,
 * a rounded square is a thing. Black ink, for the reason spelled out beside
 * AVATAR_TONES in page.tsx. Cycled by index — a role's colour is a place in a
 * list, not a fact about it.
 */
const RANK_ACCENTS = ["bg-accent-peri", "bg-accent-pink", "bg-accent-orange"];

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
          access — the section header this panel now sits under says exactly
          that, once, in the one line every section on the page gets. */}
      {toast && <Toast>{toast}</Toast>}

      {/* THE PANEL IS THE CONTENTS OF A TRAY, NOT A PAGE SECTION. Its call site
          fills the card body with the off-white and hands it the padding, so
          everything here is a white card sitting IN the recess — which is the
          arrangement that makes a role read as an item in a container rather
          than as another band of the page. Nothing in this file paints a
          background; that decision belongs to the one place it is made. */}
      <div className="flex flex-col gap-3">
        {ranks.length === 0 && (
          <p className="px-1 py-2 text-center text-sm text-muted-foreground">
            No roles yet — everyone has full access. Create one to start limiting what members see.
          </p>
        )}

        {ranks.map((r, i) => {
          const open = expandedId === r.id;
          const holders = memberCounts[r.id] ?? 0;
          const others = ranks.filter((o) => o.id !== r.id);
          return (
            /* `card` (10px), not `surface` (16px): on the tray these are ITEMS,
               and the 16px corner is the radius the tray's own card is drawn
               at — two nested surfaces at the same radius read as one thing
               that has gone wrong rather than as two.
               overflow-hidden is safe here (nothing inside pops over the edge —
               the delete confirm is inline) and keeps the header's hover tint
               within those corners. */
            <Card key={r.id} variant="card" padding="none" className="overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  setExpandedId(open ? null : r.id);
                  setConfirmingDelete(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-(--duration-fast) hover:bg-foreground/5"
              >
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-control text-neutral-900",
                    RANK_ACCENTS[i % RANK_ACCENTS.length],
                  )}
                  aria-hidden
                >
                  <Shield size={18} strokeWidth={2} />
                </span>
                <span className="min-w-0 flex-1">
                  {/* 16px, down from 18. The role's name is the biggest string
                      in the tray either way, and at 18 it was a step ABOVE the
                      page's own section headings — an item inside a section
                      shouting louder than the section. */}
                  <span className="block truncate text-md font-semibold text-foreground">{r.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
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
                      <p className="py-1.5 text-xs text-muted-foreground">
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
                      <p className="py-1.5 text-xs text-muted-foreground">
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
                  <Group label="Danger" tone="danger" hint="Deleting a role returns its members to full access.">
                    {confirmingDelete === r.id ? (
                      <div className="flex flex-wrap items-center justify-between gap-3 py-1.5">
                        <p className="text-sm text-muted-foreground">{deleteLine(holders)}</p>
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
            clicked — then the same spot holds the name input and Create. Both
            states are the same shape as a role card, because that is what the
            slot is going to become. */}
        {adding ? (
          <Card variant="card" padding="dense">
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
                <span className="text-xs text-muted-foreground">
                  {preset === "admin" ? "All permissions and all metrics, on — editable after." : "Grants nothing until you flip switches."}
                </span>
              </div>
            </form>
          </Card>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            /* `rounded-card` to match the role cards it sits under, and no fill:
               a dashed outline over the tray is what says "a card goes here",
               where a white one would say a card already does. */
            className="flex w-full items-center gap-2.5 rounded-card border-2 border-dashed border-border p-3 text-left text-md font-semibold text-muted-foreground transition-colors duration-(--duration-fast) hover:border-primary hover:text-accent-foreground"
          >
            <span className="flex size-7 items-center justify-center rounded-control border-2 border-dashed border-current opacity-70">
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
 *
 * `w-full`, not `w-auto`. The member list is a grid now and this control has a
 * track of its own; sized to its content it drew a different width per row —
 * "Full access" and "Setter & Closer" are 60px apart — which is the exact
 * ragged edge the grid was introduced to remove. The track decides the width.
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
      <NativeSelect value={value} onChange={(e) => change(e.target.value)} aria-label="Role" className="w-full">
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
function Group({
  label,
  hint,
  tone,
  children,
}: {
  label: string;
  hint?: string;
  /** `danger` tints the label alone — the group's rows keep their own voices. */
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <div className="px-4 py-4">
      {/* THE SHEET'S MICRO VOICE: 12px, semibold, ALL CAPS, `tracking-wide` —
          the same spelling `SectionHeading`, `FieldLabel` and the table head
          are set in. It was 16px sentence case, i.e. the same typographic
          object as the row labels underneath it, so an expanded role read as
          one long column of medium-weight lines with no structure in it. Caps
          is what makes a label a LABEL without spending a size or a colour. */}
      <p
        className={cn(
          "text-xs font-semibold uppercase tracking-wide",
          tone === "danger" ? "text-danger-ink" : "text-foreground",
        )}
      >
        {label}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
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
        // THE CHIP IS TINTED, not grey. A grey glyph on a grey wash beside grey
        // body text is three neutrals in 28px, which is the flatness this pass
        // is for; `accent` / `accent-foreground` is the kit's own tint pair —
        // the violet wash carrying the violet ink — and the same chip the empty
        // state and the sync tiles wear. The 500 fills, the 700 speaks, and a
        // stroked glyph is speaking.
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-control bg-accent text-accent-foreground",
            implied && "opacity-45",
          )}
          aria-hidden
        >
          <Icon size={14} strokeWidth={2} />
        </span>
      )}
      <span className={cn("min-w-0 flex-1", implied && "opacity-45")}>
        <span className={cn("block truncate text-sm text-foreground", bold ? "font-semibold" : "font-medium")}>
          {label}
        </span>
        {blurb && <span className="block text-xs text-muted-foreground">{blurb}</span>}
      </span>
      <Switch checked={implied || on} disabled={implied} onClick={onChange} aria-label={label} />
    </div>
  );
}
