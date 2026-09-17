import { Check, Loader2, Plus } from "lucide-react";
import { SourceMark } from "@/components/source-mark";
import { cn } from "@/lib/utils";

/**
 * STEP ONE, DRAWN: the moment you connect a tool.
 *
 * The three states in here are the three states the real integrations page has
 * — connected and swept, connected and still backfilling, and not connected
 * yet — because the claim this picture supports is "records start arriving
 * within minutes and your history backfills BEHIND you". A drawing where
 * everything is already green would illustrate the opposite: a wait.
 *
 * `aria-hidden`, like every drawing on this page. The sentence beside it
 * carries the meaning; a screen reader does not need six tool names read out
 * with a spinner in the middle of them.
 */
const ROWS: Array<{ source: string; name: string; state: "done" | "syncing" | "open"; note: string }> = [
  { source: "calendly", name: "Calendly", state: "done", note: "Swept 2 minutes ago" },
  { source: "close", name: "Close CRM", state: "done", note: "Swept 2 minutes ago" },
  { source: "stripe", name: "Stripe", state: "syncing", note: "Backfilling 2023 →" },
  { source: "gsheets", name: "Google Sheets", state: "open", note: "Sign in with Google" },
  { source: "instantly", name: "Instantly", state: "open", note: "Paste an API key" },
];

export function ConnectShot() {
  return (
    <div aria-hidden className="flex h-full flex-col gap-2.5 rounded-card bg-card p-4 sm:p-5">
      <p className="text-sm font-semibold text-foreground">Your tools</p>

      <ul className="flex flex-col gap-2">
        {ROWS.map((row) => (
          <li
            key={row.source}
            className="flex min-w-0 items-center gap-3 rounded-card border border-border bg-background px-3 py-2.5"
          >
            <SourceMark source={row.source} size={28} className="stat-numeral shrink-0" />

            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-foreground">{row.name}</span>
              {/* The note is what makes each row a different MOMENT rather
                  than a different logo — "swept 2 minutes ago" and "paste an
                  API key" are two ends of the same minute. */}
              <span className="truncate text-xs text-muted-foreground">{row.note}</span>
            </span>

            {row.state === "done" ? (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-soft">
                <Check className="size-3.5 text-success" />
              </span>
            ) : row.state === "syncing" ? (
              /* The one moving thing in the picture, and it is moving because
                 the sentence it illustrates is about not having to wait for
                 it. `motion-reduce` stops it for anyone who asked. */
              <Loader2 className="size-4 shrink-0 animate-spin text-brand-400 motion-reduce:animate-none" />
            ) : (
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1",
                  "text-xs font-medium text-muted-foreground",
                )}
              >
                <Plus className="size-3" />
                Connect
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
