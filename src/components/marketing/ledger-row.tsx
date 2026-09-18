import { SourceMark } from "@/components/source-mark";

/**
 * A LINE IN A STATEMENT OF ACCOUNTS.
 *
 * The problem section used to be six identical cards in a grid. It is a
 * ledger — six tools, each reporting a figure, each stopping exactly where the
 * question you actually have begins — and it should look like one: full-width
 * rows, hairline-separated, with the figures right-aligned on a shared axis so
 * they form a column you can read down.
 *
 * THE AXIS IS THE SAME ONE THE RECEIPT USES. `--num-col` is set once on the
 * list and inherited, so the ledger's figures and the receipt's working lines
 * land on the same x-coordinate. That is the page's spine made literal, and it
 * only works because the subject is arithmetic.
 *
 * ON MOBILE IT REFLOWS TO TWO LINES — tool and figure on the first, clause on
 * the second, figure still right-aligned — rather than shrinking, because the
 * clause is a full sentence and squeezing it into a third of 380px makes four
 * lines of two words.
 */
export function LedgerRow({
  source,
  name,
  metric,
  figure,
  clause,
}: {
  source: string;
  name: string;
  metric: string;
  figure: string;
  clause: string;
}) {
  return (
    <li className="ledger-row">
      <span className="ledger-tool">
        <SourceMark source={source} size={26} />
        <span className="ledger-name">{name}</span>
      </span>

      <span className="ledger-metric">{metric}</span>

      <span className="ledger-figure t-num">{figure}</span>

      {/* "but not which ones showed up" — the point of the row. It is a
          continuation of the figure beside it, so it reads as one sentence
          rather than as a caption. */}
      <span className="ledger-clause">{clause}</span>
    </li>
  );
}
