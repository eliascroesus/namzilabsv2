"use client";

import { useMemo, useState } from "react";
import styles from "@/app/ledger.module.css";
import { SourceTile } from "./marks";

/**
 * S08. Typing strikes the non-matches OFF the list rather than hiding them.
 *
 * This is not a flourish. Filtering by removal answers "is my tool here?" with
 * a list that has silently changed shape, and the reader has no way to tell a
 * short list of matches from a short list of everything. Crossing items out
 * keeps the whole catalogue in view while the answer resolves — which is the
 * same argument the product makes about records it excludes from a metric: the
 * ones that did not count are still shown, struck, with the count beside them.
 *
 * A page whose interactions contradict its copy is a page nobody believes.
 */
export function SourceSearch({ sources }: { sources: Array<{ name: string; short?: string; blurb: string }> }) {
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => sources.filter((source) => source.name.toLowerCase().includes(needle)),
    [sources, needle],
  );

  return (
    <>
      <input
        type="search"
        className={styles.search}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search the sources"
        aria-label="Search the sources"
      />
      {/* The count is announced rather than left to the strike-throughs, which
          a screen reader has no way to perceive — the visual and the spoken
          answer have to be the same answer. */}
      <p className={`${styles.caption} ${styles.sourceCount}`} role="status">
        {needle === ""
          ? `${sources.length} sources, read directly.`
          : `${matches.length} of ${sources.length} sources match “${query.trim()}”.`}
      </p>

      <ul className={styles.sourceGrid}>
        {sources.map((source) => {
          const struck = needle !== "" && !source.name.toLowerCase().includes(needle);
          return (
            <li
              key={source.name}
              className={`${styles.sourceRow} ${struck ? styles.sourceStruck : ""}`}
              aria-hidden={struck || undefined}
            >
              <SourceTile name={source.name} short={source.short} />
              <span className={styles.sourceName}>{source.name}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}
