"use client";

import { useRef, useState, useTransition } from "react";
import { Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { removeAvatarAction, updateDisplayNameAction, uploadAvatarAction } from "./actions";

/**
 * THE TWO EDITS ON THIS PAGE, EACH SAYING WHAT HAPPENED.
 *
 * Both actions return `{ ok }` rather than redirecting, so both need a client
 * boundary to read the answer — the same channel every interactive write on the
 * board uses. A profile edit that reports nothing is the specific failure this
 * project has already been bitten by twice: local state moves, the write is
 * refused, and the old value comes back on a later page with nothing having
 * said so.
 */

/** One line of feedback, in the two tones there are. */
function Note({ state }: { state: { ok: boolean; text: string } | null }) {
  if (!state) return null;
  return (
    <p className={`mt-2 text-sm ${state.ok ? "text-success-ink" : "text-danger-ink"}`}>{state.text}</p>
  );
}

export function DisplayNameForm({ initial }: { initial: string | null }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);

  return (
    <form
      action={async (fd) => {
        setState(null);
        const r = await updateDisplayNameAction(fd);
        setState(r.ok ? { ok: true, text: "Saved." } : { ok: false, text: r.error });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-foreground">
            Display name
          </label>
          <Input
            id="displayName"
            name="displayName"
            defaultValue={initial ?? ""}
            maxLength={60}
            placeholder="Your name"
            autoComplete="name"
          />
        </div>
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
      {/* WHAT CLEARING IT DOES, said before somebody wonders. An empty field is
          a real choice — "use my email" — and not a validation failure, so the
          form has to say so rather than refusing an empty submit. */}
      <p className="mt-2 text-sm text-muted-foreground">
        Shown in the workspace switcher and beside your avatar. Leave it empty to use your email address.
      </p>
      <Note state={state} />
    </form>
  );
}

export function AvatarForm({ hasAvatar }: { hasAvatar: boolean }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  /**
   * THE FILE INPUT IS HIDDEN AND A BUTTON OPENS IT, which is not decoration:
   * a bare `<input type="file">` renders as the browser's own control, and this
   * app has one button language that `check:ui` enforces everywhere else.
   *
   * IT SUBMITS ON CHANGE rather than behind a second "Upload" press. Picking a
   * file in the dialog IS the decision — the extra press exists only to give the
   * form something to do, and it is where people leave a chosen file unsaved.
   */
  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.set("avatar", file);
    setState(null);
    start(async () => {
      const r = await uploadAvatarAction(fd);
      setState(r.ok ? { ok: true, text: "Picture updated." } : { ok: false, text: r.error });
      // Cleared either way, so picking the SAME file again still fires a change.
      if (input.current) input.current.value = "";
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="sr-only"
          onChange={onPick}
        />
        <Button variant="secondary" onClick={() => input.current?.click()} disabled={pending}>
          <Upload />
          {pending ? "Uploading…" : hasAvatar ? "Change picture" : "Upload a picture"}
        </Button>
        {hasAvatar && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setState(null);
              start(async () => {
                const r = await removeAvatarAction();
                setState(r.ok ? { ok: true, text: "Picture removed." } : { ok: false, text: r.error });
              });
            }}
          >
            <Trash2 />
            Remove
          </Button>
        )}
      </div>
      <p className="mt-2 text-sm text-muted-foreground">PNG, JPEG, WebP or GIF, up to 4MB.</p>
      <Note state={state} />
    </div>
  );
}
