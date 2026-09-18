/**
 * THE PROOF STRIP — three facts under the hero, divided by hairlines.
 *
 * Proof appears early and is specific, which is the one thing every reference
 * page in the brief does and the old page did not: its checkable facts were
 * four hundred pixels down, in grey, beside a heading.
 *
 * THE FIGURE IS NOT MONO HERE, and that is the semantic rule doing its job:
 * "32 tools" and "Every 10 minutes" are claims a person wrote, not values a
 * machine computed. Only the latter get the mono face. If mono creeps onto
 * anything a human typed, it stops meaning anything.
 */
export function StatDivider({ facts }: { facts: Array<{ head: string; body: string }> }) {
  return (
    <div className="stat-strip">
      {facts.map((f) => (
        <div key={f.head} className="stat-cell">
          <p className="stat-head">{f.head}</p>
          <p className="stat-body">{f.body}</p>
        </div>
      ))}
    </div>
  );
}
