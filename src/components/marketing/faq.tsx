"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";

/**
 * THE QUESTIONS SOMEBODY ACTUALLY HAS BEFORE CONNECTING A CRM TO A STRANGER.
 *
 * Every answer is checkable from this repository: the connector count is
 * computed, ten minutes is the real sweep cadence (`materialize-stale`), the
 * MCP tool list is what `src/lib/mcp/tools` exports, and read-only is enforced
 * rather than promised.
 *
 * ── WHY THIS IS A CLIENT COMPONENT NOW ─────────────────────────────────────
 *
 * It was `<details>`/`<summary>`, which is keyboard-operable and needs no
 * JavaScript — genuinely the better default. It is a real `<button>` here
 * because the brief asks for `aria-expanded`, which `<summary>` cannot carry
 * meaningfully (it exposes `expanded` through the details element's own state
 * and screen-reader support for that is still uneven), and because THE FIRST
 * ITEM HAS TO BE OPEN: all the trust copy on this page was hidden behind closed
 * rows, which is the wrong default for the section a nervous buyer reads.
 *
 * The cost is honest: with no JavaScript the answers are collapsed. They are
 * still in the DOM and still findable, and this is a marketing page rather than
 * a document, so that is the trade I would make again.
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
  /* THE FIRST ONE IS OPEN. Not a flourish: every reassurance this section
     exists to give was behind a closed row. */
  const [open, setOpen] = useState(0);

  return (
    <ul className="faq">
      {QA.map(({ q, a }, i) => {
        const isOpen = open === i;
        return (
          <li key={q} className="faq-item">
            <h3>
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`faq-panel-${i}`}
                id={`faq-trigger-${i}`}
                /* Toggling rather than always-opening: a reader who has read
                   the answer should be able to put it away. */
                onClick={() => setOpen(isOpen ? -1 : i)}
                className="faq-trigger"
              >
                <span>{q}</span>
                {/* ONE GLYPH, ROTATED — a plus that becomes a minus. Two
                    swapped icons are two things to keep in sync and a flash
                    between them. */}
                <Plus aria-hidden className="faq-icon" data-open={isOpen || undefined} />
              </button>
            </h3>
            <div id={`faq-panel-${i}`} role="region" aria-labelledby={`faq-trigger-${i}`} hidden={!isOpen}>
              <p className="faq-answer">{a}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
