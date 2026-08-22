"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEventTimeAction } from "@/app/integrations/actions";
import type { EventTimeChoice } from "@/lib/webhooks/event-time";
import { FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/input";

/**
 * Which key of an incoming payload holds the event time.
 *
 * The twin of the sheet's date-column picker, on the other door, and built to
 * the same four concepts: the key, whether a human has answered, what the last
 * scan observed, and a marker saying a restamp is owed. Same copy discipline
 * too — delivery time is a defensible answer for a payload that carries no
 * timestamp, and delivery time presented AS the event time is not, so the note
 * says which one is in force in every state.
 *
 * It exists because the alternative was editing the database. A detector that
 * can be wrong needs a fix a person can reach, or the honesty of the note is
 * just a better-worded dead end.
 *
 * THREE ANSWERS, not two. "Detect automatically" and "Use delivery time" both
 * store no key and mean opposite things — find one for me, versus stop looking —
 * and collapsing them is what made the sheet broken by default. Auto stays
 * selectable, because an override with no way back is a one-way door.
 *
 * The options are the keys the last scan found to hold REAL dates, ranked. Wider
 * than what the detector chose: the ranking exists so nobody has to think about
 * `updated_at`, and the list exists so somebody who has thought about it can
 * still say yes. Choosing it is a decision; the detector doing it quietly is not.
 */
export function EventTimePicker({
  connectionId,
  choice,
  note,
  options,
  pending,
}: {
  connectionId: string;
  choice: EventTimeChoice;
  note: string;
  options: string[];
  /** A change is recorded and waiting for the sweep that will act on it. */
  pending: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const value = choice.kind === "key" ? choice.key : choice.kind === "none" ? "__none" : "__auto";
  // A key a human chose that no longer holds dates still has to be selectable,
  // or the control would silently show something other than the stored answer.
  const list = choice.kind === "key" && !options.includes(choice.key) ? [choice.key, ...options] : options;

  const pick = (next: string) => {
    setError(null);
    const answer: EventTimeChoice =
      next === "__auto" ? { kind: "auto" } : next === "__none" ? { kind: "none" } : { kind: "key", key: next };
    startTransition(async () => {
      const res = await setEventTimeAction(connectionId, answer);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="mt-4">
      <FieldLabel htmlFor="event-time-key">Event time</FieldLabel>
      <NativeSelect
        id="event-time-key"
        value={value}
        disabled={busy}
        onChange={(e) => pick(e.target.value)}
        className="max-w-sm"
      >
        <option value="__auto">Detect automatically</option>
        <option value="__none">Use delivery time (no timestamp field)</option>
        {list.map((k) => (
          <option key={k} value={k}>
            {k}
          </option>
        ))}
      </NativeSelect>
      <FieldHint>{note}</FieldHint>
      {pending && (
        <FieldHint>
          Saved. Events already stored keep their current time until the next nightly pass re-derives them.
        </FieldHint>
      )}
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
