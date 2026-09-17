import { Plus } from "lucide-react";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";

/**
 * THE QUESTIONS SOMEBODY ACTUALLY HAS BEFORE CONNECTING A CRM TO A STRANGER.
 *
 * EVERY ANSWER IS CHECKABLE FROM THIS REPOSITORY, which is the only rule this
 * section has: the connector count is computed from the catalogue, ten minutes
 * is the real sweep cadence (`materialize-stale`), the MCP tool list is what
 * `src/lib/mcp/tools` exports, and read-only is enforced rather than promised —
 * no connector in `src/connectors` implements a write. An FAQ is where a
 * landing page's claims stop being atmosphere and start being commitments.
 *
 * `<details>` RATHER THAN STATE. This is a server component on a page with no
 * other interactivity below the nav, and the browser already ships an
 * accordion that is keyboard-operable, findable by ctrl-F, and open by default
 * when JavaScript never arrives. Re-implementing it with `useState` would cost
 * a client bundle and take those three things away.
 */
const QA: Array<{ q: string; a: string }> = [
  {
    q: "What does it connect to?",
    a: `${CONNECTOR_CATALOG.length} tools today — calendars, CRMs, outreach platforms, payment processors, spreadsheets and analytics — each through that tool's own API. If something you use is missing, a custom webhook will take events from anything that can POST.`,
  },
  {
    q: "Can it change anything in my tools?",
    a: "No. Every connector reads and none of them write: there is no code in this product that creates, edits or deletes a record in a tool you connect. The access it asks for at sign-in reflects that, and disconnecting a tool leaves the records it already sent in place.",
  },
  {
    q: "Do I need SQL, or a warehouse?",
    a: "Neither. Metrics are built by dragging steps onto a canvas — pull records, keep the ones that count, match the same person across two sources, total what is left — and you can test one against real rows before publishing it. There is nothing in between your tools and the board.",
  },
  {
    q: "How current are the numbers?",
    a: "A published metric recomputes on its own roughly every ten minutes, and each one shows when it last ran. Connect a tool and new records start arriving within minutes while your history backfills behind you — you do not wait for the backfill to finish before building anything.",
  },
  {
    q: "Why does it disagree with my CRM?",
    a: "Usually because the two are counting different things, and the point is that you can see which. Every figure carries its working: which sources it read, how many records it matched as the same person, and what it left out and why.",
  },
  {
    q: "Can I point Claude or ChatGPT at it?",
    a: "Yes, over MCP. An assistant connected to your workspace can read your published metrics directly — list them, fetch one, fetch its daily series, list your sources. It is read-only, scoped to a single workspace, and switched on per person, so an assistant can analyse everything it is shown and change nothing.",
  },
];

export function Faq() {
  return (
    <ul className="flex flex-col gap-3">
      {QA.map(({ q, a }) => (
        <li key={q}>
          <details className="group rounded-card border border-border bg-card open:bg-background">
            {/* `list-none` plus the webkit pseudo-element: Safari draws its own
                triangle from a shadow-DOM marker that `list-style` alone does
                not reach, which left a stray disclosure arrow beside the plus
                on every row. */}
            <summary
              className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-card px-5 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"
            >
              <span className="min-w-0 text-md font-semibold text-foreground">{q}</span>
              {/* ONE GLYPH, ROTATED — a plus that becomes a minus when the row
                  opens. Two swapped icons would be two elements to keep in
                  sync and a flash between them; 45 degrees is the same shape
                  telling you what it will do next. */}
              <Plus
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) ease-(--ease-standard) group-open:rotate-45 motion-reduce:transition-none"
              />
            </summary>
            <p className="px-5 pb-5 text-md leading-relaxed text-muted-foreground">{a}</p>
          </details>
        </li>
      ))}
    </ul>
  );
}
