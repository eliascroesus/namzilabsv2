"use client";

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
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
      const res = await createRankAction(name);
      if (res.ok) {
        // A new rank grants NOTHING until switches flip — restrictive by
        // default so creating one can never silently widen anyone's access.
        setRanks((rs) => [
          ...rs,
          { id: res.id, name, allPermissions: false, permissions: [], allMetrics: false, metricKeys: [], inherits: [] },
        ]);
        setExpandedId(res.id);
        setNewName("");
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
      <p className="mb-3 text-tiny text-neutral-500">
        A rank limits what its members can do and which metrics they see. Members without a rank have
        full access — restrictions begin when you assign one.
      </p>

      {toast && (
        <p role="status" className="mb-2 text-tiny font-medium text-red-600">
          {toast}
        </p>
      )}

      {ranks.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-200 px-4 py-6 text-center text-small text-neutral-500">
          No ranks yet — everyone has full access. Create one to start limiting what members see.
        </p>
      ) : (
        <div className="divide-y divide-neutral-100 rounded-md border border-neutral-200">
          {ranks.map((r) => {
            const open = expandedId === r.id;
            const holders = memberCounts[r.id] ?? 0;
            const others = ranks.filter((o) => o.id !== r.id);
            return (
              <div key={r.id}>
                <button
                  type="button"
                  onClick={() => {
                    setExpandedId(open ? null : r.id);
                    setConfirmingDelete(null);
                  }}
                  className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold text-foreground">{r.name}</span>
                    <span className="text-tiny text-neutral-500">
                      {count(holders, "member")} · {summary(r)}
                    </span>
                  </span>
                  <ChevronDown
                    size={16}
                    className={`shrink-0 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </button>

                {open && (
                  <div className="border-t border-neutral-100 px-4 pb-4 pt-3">
                    <Group label="Permissions">
                      <ToggleRow
                        bold
                        label="All permissions"
                        on={r.allPermissions}
                        onChange={() => save(r.id, { allPermissions: !r.allPermissions })}
                      />
                      {/* While the master is on, the rows below are IMPLIED —
                          shown on but disabled — and the underlying array is
                          left alone, so flipping the master off restores the
                          exact selection it covered. */}
                      {PERMISSIONS.map((p) => (
                        <ToggleRow
                          key={p.key}
                          label={p.label}
                          blurb={p.blurb}
                          on={r.permissions.includes(p.key)}
                          implied={r.allPermissions}
                          onChange={() => save(r.id, { permissions: toggled(r.permissions, p.key) })}
                        />
                      ))}
                    </Group>

                    <Group label="Metrics">
                      {/* The master stays even with an empty catalogue: the
                          blanket grant exists so "everything" doesn't go stale
                          as flows get published later. */}
                      <ToggleRow
                        bold
                        label="All metrics"
                        on={r.allMetrics}
                        onChange={() => save(r.id, { allMetrics: !r.allMetrics })}
                      />
                      {catalogue.length === 0 ? (
                        <p className="py-1.5 text-tiny text-neutral-500">
                          Publish a flow and its metrics appear here.
                        </p>
                      ) : (
                        catalogue.map((c) => (
                          <ToggleRow
                            key={c.key}
                            label={c.name}
                            on={r.metricKeys.includes(c.key)}
                            implied={r.allMetrics}
                            onChange={() => save(r.id, { metricKeys: toggled(r.metricKeys, c.key) })}
                          />
                        ))
                      )}
                    </Group>

                    <Group label="Inherit from">
                      {others.length === 0 ? (
                        <p className="py-1.5 text-tiny text-neutral-500">
                          Create a second rank and it appears here.
                        </p>
                      ) : (
                        others.map((o) => (
                          <ToggleRow
                            key={o.id}
                            label={o.name}
                            blurb={`Gets everything ${o.name} can see and do, and follows when ${o.name} changes`}
                            on={r.inherits.includes(o.id)}
                            onChange={() => save(r.id, { inherits: toggled(r.inherits, o.id) })}
                          />
                        ))
                      )}
                    </Group>

                    <Group label="Danger">
                      {confirmingDelete === r.id ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 py-1.5">
                          <p className="text-small text-neutral-600">{deleteLine(holders)}</p>
                          <span className="flex shrink-0 gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmingDelete(null)}
                              className="rounded-md border border-neutral-300 px-3 py-1.5 text-small font-medium text-foreground hover:bg-neutral-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => destroy(r.id)}
                              className="rounded-md bg-red-600 px-3 py-1.5 text-small font-medium text-white hover:bg-red-700"
                            >
                              Delete rank
                            </button>
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(r.id)}
                          className="py-1.5 text-base font-medium text-red-600 hover:underline"
                        >
                          Delete rank
                        </button>
                      )}
                    </Group>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <form onSubmit={create} className="mt-3 flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          required
          placeholder="New rank name"
          aria-label="New rank name"
          className="w-full max-w-sm rounded-md border border-neutral-300 px-3 py-2 text-base focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={creating || newName.trim() === ""}
          className="rounded-md bg-neutral-900 px-4 py-2 text-base font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          Create
        </button>
      </form>
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
        <span role="status" className="text-tiny font-medium text-red-600">
          {error}
        </span>
      )}
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        aria-label="Rank"
        className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-tiny text-foreground focus:border-neutral-500 focus:outline-none"
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

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <p className="mb-1 text-tiny font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  blurb,
  on,
  implied = false,
  bold = false,
  onChange,
}: {
  label: string;
  blurb?: string;
  on: boolean;
  /** Covered by an "All …" master: shown on but disabled, selection kept. */
  implied?: boolean;
  bold?: boolean;
  onChange: () => void;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 py-1.5 ${implied ? "opacity-45" : ""}`}>
      <span className="min-w-0">
        <span className={`block truncate text-base ${bold ? "font-semibold" : ""} text-foreground`}>{label}</span>
        {blurb && <span className="block text-tiny text-neutral-500">{blurb}</span>}
      </span>
      <Switch on={implied || on} disabled={implied} onChange={onChange} label={label} />
    </div>
  );
}

/**
 * FlowSwitch's geometry (src/components/flow/FlowToolbar.tsx), one size down —
 * settings must feel like the same product as the builder, so the knob rides
 * the same spring. 16px knob in a 36px track: 18px = 36 − 16 − the 2px inset
 * it rests in when off. No opacity here when disabled — the implied row dims
 * as a whole, and dimming twice reads as broken rather than covered.
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
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-neutral-200"} ${
        disabled ? "cursor-not-allowed" : "hover:brightness-105"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm ${on ? "left-[18px]" : "left-0.5"}`}
        style={{ transition: "left .22s cubic-bezier(.34,1.56,.64,1)" }}
        aria-hidden
      />
    </button>
  );
}
