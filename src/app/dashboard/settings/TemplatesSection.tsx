"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarDays, ExternalLink, LayoutDashboard, Link2, Link2Off, RefreshCw, Trash2, Users } from "lucide-react";
import type { BoardViewKind } from "@/lib/board/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CopyField } from "@/components/copy-field";
import { FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/badge";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/utils";
import { createTemplateAction, deleteTemplateAction, setTemplateLinkAction, updateTemplateAction } from "./template-actions";

export type TemplateListItem = {
  id: string;
  name: string;
  description: string | null;
  /** The whole link, or its path when the deployment has no base URL set. */
  link: string;
  path: string;
  enabled: boolean;
  views: number;
  uses: number;
  /** Preformatted on the server — see `formatDate`. */
  updated: string;
};

/**
 * SETTINGS → TEMPLATES — every template this workspace has shared, and the
 * form that makes another.
 *
 * ONE NOUN FOR BOTH THINGS PEOPLE ASKED FOR. "Share a dashboard view as a
 * template" and "share the whole workspace as a template" are the same act
 * with a different number of boxes ticked, so they are one form: every view
 * ticked is the workspace, one ticked is a view. The view menu's "Share as
 * template" arrives here with that one view ticked.
 *
 * A LIST ROW IS THE LINK, because the link is what the author came back for —
 * to paste it into a course module or a client email. Everything else on the
 * row (preview, update, off, delete) is the management around it.
 */
export function TemplatesSection({
  templates,
  views,
  preselect,
  made,
  unavailable,
}: {
  templates: TemplateListItem[];
  views: Array<{ id: string; name: string; kind: BoardViewKind }>;
  /** A view id from `?share=` — the view menu's "Share as template". */
  preselect: string | null;
  /** The template just created, which the list marks. */
  made: string | null;
  /** The tables are not there yet — see drizzle/HAND_APPLY.md, 0034. */
  unavailable: boolean;
}) {
  if (unavailable) {
    return (
      <p className="px-4 py-4 text-sm text-muted-foreground">
        Templates are being switched on — the database update they need hasn&rsquo;t been applied yet.
      </p>
    );
  }
  return (
    <div>
      {templates.length > 0 && (
        <div className="divide-y divide-border">
          {templates.map((t) => (
            <TemplateRow key={t.id} template={t} fresh={t.id === made} />
          ))}
        </div>
      )}
      <NewTemplate views={views} preselect={preselect} open={templates.length === 0 || preselect != null} />
    </div>
  );
}

function TemplateRow({ template: t, fresh }: { template: TemplateListItem; fresh: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  return (
    <div className={cn("px-4 py-4", fresh && "bg-success-soft/40")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{t.name}</span>
        {fresh && <StatusPill tone="success">Link ready</StatusPill>}
        {!t.enabled && <StatusPill tone="pending">Link off</StatusPill>}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {`${t.views} ${t.views === 1 ? "view" : "views"} · used ${t.uses} ${t.uses === 1 ? "time" : "times"} · updated ${t.updated}`}
      </p>

      <div className="mt-3">
        <CopyField
          label={t.enabled ? "Template link — send it to anyone" : "Template link (turned off)"}
          value={t.link}
          hint={
            t.enabled
              ? "Whoever opens it sees these views and can start from them. Your data, apps and members never go with it."
              : "Anyone who opens it sees that it isn't available. Turn it back on and the same link works again."
          }
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Button variant="ghost" size="sm" asChild>
          <Link href={t.path} target="_blank" rel="noreferrer">
            <ExternalLink />
            Preview
          </Link>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
          <RefreshCw />
          Update
        </Button>
        <form action={setTemplateLinkAction}>
          <input type="hidden" name="id" value={t.id} />
          <input type="hidden" name="enabled" value={t.enabled ? "0" : "1"} />
          <Button type="submit" variant="ghost" size="sm">
            {t.enabled ? <Link2Off /> : <Link2 />}
            {t.enabled ? "Turn link off" : "Turn link on"}
          </Button>
        </form>
        {confirming ? (
          <form action={deleteTemplateAction} className="flex items-center gap-1.5">
            <input type="hidden" name="id" value={t.id} />
            <span className="text-xs text-muted-foreground">Delete it? Copies people made stay theirs.</span>
            <Button type="submit" variant="destructive" size="sm">
              Delete
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <Button variant="destructiveGhost" size="sm" onClick={() => setConfirming(true)}>
            <Trash2 />
            Delete
          </Button>
        )}
      </div>

      {editing && (
        /* UPDATE RE-READS THE VIEWS — the author changes their board, then
           comes here to publish the change. The name travels with it because
           that is the other thing people come back to fix. */
        <form action={updateTemplateAction} className="mt-3 space-y-3 rounded-control border border-border bg-muted/40 p-3">
          <input type="hidden" name="id" value={t.id} />
          <div>
            <FieldLabel htmlFor={`name-${t.id}`}>Name</FieldLabel>
            <Input id={`name-${t.id}`} name="name" defaultValue={t.name} required maxLength={80} />
          </div>
          <div>
            <FieldLabel htmlFor={`desc-${t.id}`}>Description</FieldLabel>
            <Input id={`desc-${t.id}`} name="description" defaultValue={t.description ?? ""} maxLength={300} />
          </div>
          <FieldHint>
            Saves the name, and copies the views as they are on your board right now. People who already used the
            template keep the copy they got; the next person gets this one.
          </FieldHint>
          <SubmitButton size="sm" pendingLabel="Updating…">
            Update template
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

const KIND_ICON: Record<BoardViewKind, typeof Users> = { groups: Users, custom: LayoutDashboard, calendar: CalendarDays };

function NewTemplate({
  views,
  preselect,
  open,
}: {
  views: Array<{ id: string; name: string; kind: BoardViewKind }>;
  preselect: string | null;
  open: boolean;
}) {
  const [showing, setShowing] = useState(open);
  /* Every view ticked is "share the workspace"; the view menu's link ticks
     just its own. */
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(preselect && views.some((v) => v.id === preselect) ? [preselect] : views.map((v) => v.id)),
  );
  const preselected = views.find((v) => v.id === preselect);

  if (views.length === 0) {
    return (
      <p className="border-t border-border px-4 py-4 text-sm text-muted-foreground first:border-t-0">
        Make a view on your dashboard first — a template is a copy of views.
      </p>
    );
  }
  if (!showing) {
    return (
      <div className="border-t border-border px-4 py-3 first:border-t-0">
        <Button variant="secondary" size="sm" onClick={() => setShowing(true)}>
          New template
        </Button>
      </div>
    );
  }
  const toggle = (id: string, on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <form action={createTemplateAction} className="space-y-4 border-t border-border px-4 py-4 first:border-t-0">
      <div>
        <FieldLabel htmlFor="template-name">Name</FieldLabel>
        <Input
          id="template-name"
          name="name"
          required
          maxLength={80}
          defaultValue={preselected?.name ?? ""}
          placeholder="Agency scorecard"
        />
      </div>
      <div>
        <FieldLabel htmlFor="template-description">Description (optional)</FieldLabel>
        <Input
          id="template-description"
          name="description"
          maxLength={300}
          placeholder="The numbers we track every week, and where each one comes from"
        />
      </div>
      <fieldset>
        {/* FieldLabel's own recipe, spelled on a <legend> — a fieldset's
            caption must be one, and a second style of label in the same form
            reads as a different kind of question. */}
        <legend className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground">Views to include</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {views.map((v) => {
            const Icon = KIND_ICON[v.kind];
            return (
              <label
                key={v.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 text-sm text-foreground hover:bg-foreground/5"
              >
                <Checkbox
                  name="views"
                  value={v.id}
                  checked={picked.has(v.id)}
                  onCheckedChange={(c) => toggle(v.id, c === true)}
                />
                <Icon size={14} className="shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 truncate">{v.name}</span>
              </label>
            );
          })}
        </div>
        <FieldHint>
          {picked.size === views.length ? "Every view — the whole workspace." : `${picked.size} of ${views.length} views.`}{" "}
          Each chart becomes an empty spot labelled with its note, or with the name of the metric it shows now. Add a
          note to any chart or column from its menu to say more.
        </FieldHint>
      </fieldset>
      <div className="flex items-center gap-2">
        <SubmitButton pendingLabel="Creating…" disabled={picked.size === 0}>
          Create link
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={() => setShowing(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
