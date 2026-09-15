import { Check, Sparkles } from "lucide-react";

/**
 * WHAT CONNECTING AN AI TO THIS ACTUALLY LOOKS LIKE.
 *
 * Namzilabs ships an MCP server at `/api/mcp` with six tools —
 * `list_workspaces`, `select_workspace`, `list_sources`, `list_metrics`,
 * `get_metric`, `get_metric_days` — and a `use_ai_assistants` permission
 * gating who in a workspace may connect one. So this section describes
 * something the product does today, not a roadmap, and the drawing shows the
 * only thing that matters about it: the assistant's answer carries FIGURES,
 * and the figures are the same ones on the board.
 *
 * THE ANSWER IS WRITTEN THE WAY A GOOD ONE READS, which is the argument the
 * section is making. It names the metric, gives the number, gives the
 * comparison, and says where the number came from. An assistant with access to
 * none of that answers the same question with "it might be seasonality or a
 * drop in lead quality" — a sentence that is impossible to act on and
 * impossible to check, which is exactly the difference being claimed.
 *
 * `aria-hidden`, and the section around it carries its own prose: read aloud, a
 * two-turn chat transcript about a company that does not exist is forty words
 * of furniture between two real paragraphs.
 */

const CITED: Array<{ metric: string; value: string; note: string }> = [
  { metric: "Close rate", value: "20.0%", note: "was 27.4%" },
  { metric: "Show-up rate", value: "69%", note: "unchanged" },
  { metric: "Speed to lead", value: "31m 12s", note: "was 8m 39s" },
];

export function AiPanel() {
  return (
    <div aria-hidden className="flex flex-col gap-3 rounded-frame border border-border bg-background p-4 sm:p-5">
      {/* The question as a person actually types it — vague, and about a CAUSE
          rather than a number. That is the shape of the real question, and the
          reason having the data underneath matters. */}
      <p className="max-w-[85%] self-end rounded-card rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        Why did our close rate drop last week?
      </p>

      <div className="flex flex-col gap-3 rounded-card rounded-bl-sm border border-border bg-card px-4 py-3.5">
        <span className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <Sparkles className="size-3.5 shrink-0 text-marker" />
          Reading 3 metrics from Namzilabs
        </span>

        <ul className="flex flex-col gap-2">
          {CITED.map((c) => (
            <li
              key={c.metric}
              className="flex items-baseline justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0"
            >
              <span className="min-w-0 truncate text-sm text-foreground">{c.metric}</span>
              <span className="flex shrink-0 items-baseline gap-2">
                <span className="text-xs text-muted-foreground">{c.note}</span>
                <span className="stat-numeral text-sm text-foreground">{c.value}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="text-sm leading-relaxed text-foreground">
          Show-up rate held, so it isn&rsquo;t the calls. Speed to lead went from 8m 39s to 31m 12s on Tuesday — the
          same day two reps were out. Close rate tracks that, not lead quality.
        </p>

        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="size-3.5 shrink-0 text-success" />
          Read-only, and every figure is a metric you published
        </span>
      </div>
    </div>
  );
}
