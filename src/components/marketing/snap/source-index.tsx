"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "@/app/snap.module.css";
import { Squircle } from "./marks";

type Source = { name: string; short?: string; blurb: string };

/**
 * S08 — an index, not a card grid.
 *
 * Four sections above this one have already used elevated white surfaces. A
 * flat reference table on a half-step-darker plate is the contrast, and it is
 * also what this content actually IS: a list you scan for your own tool, not
 * 33 things each deserving its own card. The previous build spent two and a
 * half screens on this and lost people in it.
 *
 * ═══ NON-MATCHES FADE, THEY DO NOT DISAPPEAR ═══
 *
 * Filtering by removal answers "is my tool here?" with a list that has
 * silently changed shape, and the reader cannot tell a short list of matches
 * from a short list of everything. Dimming in place keeps the grid's shape,
 * so the effect is the page visibly narrowing around the answer rather than
 * jumping — and matches pop their squircle, which is the small satisfying
 * confirmation that the thing you typed was found.
 *
 * It is the same argument the product makes about records it excludes from a
 * metric: what did not count is still shown, with the count beside it.
 */
export function SourceIndex({
  sources,
  cta,
  ctaLabel,
}: {
  sources: Source[];
  cta: string;
  ctaLabel: string;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const matches = useMemo(
    () => sources.filter((source) => source.name.toLowerCase().includes(needle)),
    [sources, needle],
  );

  const empty = needle !== "" && matches.length === 0;

  return (
    <>
      <div className={styles.indexHead}>
        <h2 className={`${styles.d2} ${styles.indexHeading}`}>{sources.length} sources, read directly.</h2>
        <input
          type="search"
          className={styles.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sources"
          aria-label="Search sources"
        />
      </div>

      <p className={`${styles.bodyM} ${styles.indexLead}`}>
        Every one below is a source this product reads today, in production, with its own connector. Not a logo on a
        roadmap.
      </p>

      {/* The count is announced, because the dimming that carries the answer
          visually is invisible to a screen reader. */}
      <p className={`${styles.caption} ${styles.faint}`} role="status" style={{ marginTop: 16 }}>
        {needle === ""
          ? `${sources.length} sources.`
          : `${matches.length} of ${sources.length} sources match “${query.trim()}”.`}
      </p>

      <ul className={styles.index}>
        {sources.map((source, i) => {
          const hit = needle !== "" && source.name.toLowerCase().includes(needle);
          const dim = needle !== "" && !hit;
          return (
            <li
              key={source.name}
              className={`${styles.indexCell} ${dim ? styles.indexDim : ""} ${hit ? styles.indexHit : ""}`}
              /* Staggered in grid order, so the list narrows as a wave rather
                 than snapping all at once. */
              style={{ transitionDelay: `${Math.min(i, 32) * 10}ms` }}
              aria-hidden={dim || undefined}
            >
              <div className={styles.indexTop}>
                <Squircle name={source.name} short={source.short} size={32} />
                <span className={`${styles.h4} ${styles.indexName}`}>{source.name}</span>
              </div>
              <p className={`${styles.bodyS} ${styles.indexDesc}`}>{source.blurb}</p>
            </li>
          );
        })}
      </ul>

      {/* An empty screen is an invitation, not an apology. */}
      {empty ? (
        <div className={styles.empty}>
          <p className={styles.bodyM}>Not here yet. Any tool that can POST a webhook already works.</p>
          <Link className={`${styles.btn} ${styles.emptyBtn}`} href={cta}>
            {ctaLabel}
          </Link>
        </div>
      ) : null}
    </>
  );
}
