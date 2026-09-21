"use client";

import { useMemo, useState } from "react";
import styles from "@/app/snap.module.css";
import { Mark } from "./marks";
import { CATEGORY_COUNTS, type IndexSource } from "./source-taxonomy";

/**
 * S08 — an index that answers the question the visitor actually has.
 *
 * "Is my tool listed?" is the question this section used to answer. The real
 * one is "will it give me the thing I need?", and the field tags are what
 * answer it without anybody having to open anything: a buyer scans for
 * `No-show` or `Refunds`, not for a logo they already knew was coming.
 *
 * ═══ NOTHING IS EVER HIDDEN ═══
 *
 * Filtering by removal answers with a list that has silently changed shape,
 * and the reader cannot tell a short list of matches from a short list of
 * everything. Non-matches fade in place, so the grid keeps its shape and
 * visibly narrows around the answer. Category and search COMPOSE — picking
 * Scheduling and typing "cal" narrows to the intersection.
 *
 * ═══ THE REQUEST CELL IS THE EMPTY STATE ═══
 *
 * It is always last and always at full opacity, so a search that matches
 * nothing leaves exactly one cell lit — the one that answers the question —
 * with the other 33 faded behind it. That is a better empty state than a
 * message, and it needs no second component.
 */
export function SourceIndex({ sources, cta }: { sources: IndexSource[]; cta: string }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  const needle = query.trim().toLowerCase();

  const matches = useMemo(
    () =>
      sources.filter(
        (s) =>
          (category === null || s.category === category) &&
          (needle === "" || s.name.toLowerCase().includes(needle) || s.tags.some((t) => t.toLowerCase().includes(needle))),
      ),
    [sources, needle, category],
  );

  const hit = (s: IndexSource) => matches.includes(s);
  const filtering = needle !== "" || category !== null;

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
        Every one below is live in production with its own connector, reading that tool&rsquo;s own API. Not a logo on a
        roadmap.
      </p>

      <div className={styles.filters} role="group" aria-label="Filter sources by category">
        {CATEGORY_COUNTS.map((c, i) => {
          const value = i === 0 ? null : c.label;
          const on = category === value;
          return (
            <button
              key={c.label}
              type="button"
              className={`${styles.filter} ${on ? styles.filterOn : ""}`}
              aria-pressed={on}
              onClick={() => setCategory(value)}
            >
              {i === 0 ? c.label : c.label}
              {i === 0 ? null : <span className={styles.filterCount}>{c.count}</span>}
            </button>
          );
        })}
      </div>

      {/* The count is announced, because the fade that carries the answer
          visually says nothing to a screen reader. */}
      <p className={`${styles.caption} ${styles.faint} ${styles.filterStatus}`} role="status">
        {filtering ? `${matches.length} of ${sources.length} sources match.` : ` `}
      </p>

      <ul className={styles.index}>
        {sources.map((source, i) => {
          const dim = filtering && !hit(source);
          return (
            <li
              key={source.source}
              className={`${styles.indexCell} ${dim ? styles.indexDim : ""}`}
              /* A custom property, not `transition-delay`: the stagger must reach
                 the filter's opacity and scale WITHOUT delaying the hover lift. */
              style={{ "--stagger": `${Math.min(i, 33) * 10}ms` } as React.CSSProperties}
              aria-hidden={dim || undefined}
            >
              <div className={styles.indexTop}>
                <Mark source={source.source} size={28} className={styles.mark} />
                <span className={`${styles.h4} ${styles.indexName}`}>{source.name}</span>
              </div>
              <p className={`${styles.bodyS} ${styles.indexDesc}`}>{source.blurb}</p>
              <div className={styles.tags}>
                {source.tags.map((tag) => (
                  <span className={styles.tag} key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </li>
          );
        })}

        {/* Always last, always lit — so a search that matches nothing still
            leaves the one cell that answers the question. */}
        <li className={`${styles.indexCell} ${styles.requestCell}`}>
          <p className={styles.h4}>Don&rsquo;t see yours?</p>
          <p className={`${styles.bodyS} ${styles.indexDesc} ${styles.requestBlurb}`}>
            Any tool that can POST a webhook already works today.
          </p>
          <a className={`${styles.ghostPill} ${styles.requestPill}`} href={cta}>
            Request a source
          </a>
        </li>
      </ul>
    </>
  );
}
