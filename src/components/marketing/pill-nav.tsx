"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";

/**
 * THE NAV.
 *
 * Sticky, transparent over the hero, and opaque with a hairline bottom border
 * once the hero is behind you. No shadow at any point — the rule does the
 * separating, which is the convention the whole page follows.
 *
 * ── WHY IT WATCHES A SENTINEL AND NOT `scrollY` ────────────────────────────
 *
 * A scroll listener runs on every frame of every scroll for the life of the
 * page and then has to be throttled, and the number it compares against is a
 * guess at the hero's height that goes wrong the moment the headline wraps to
 * a different number of lines. An IntersectionObserver on a one-pixel sentinel
 * placed at the hero's foot fires twice in total and is correct by
 * construction.
 *
 * DEFAULT IS TRANSPARENT, so a page with no JavaScript gets the hero's own
 * ground behind the bar rather than an opaque strip floating over it.
 */
const LINKS: Array<{ href: string; label: string }> = [
  { href: "#how", label: "How it works" },
  { href: "#ai", label: "Ask your AI" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
  { href: "/docs", label: "Docs" },
];

export function PillNav({ signedIn }: { signedIn: boolean }) {
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    const el = document.getElementById("nav-sentinel");
    if (!el || typeof IntersectionObserver === "undefined") return;
    /* SOLID ONLY WHEN THE SENTINEL HAS GONE ABOVE THE VIEWPORT, not merely
       when it is out of view. At the top of the page the sentinel sits below
       the fold and is equally "not intersecting", so the bare check painted
       the bar opaque before anybody had scrolled a pixel. */
    const io = new IntersectionObserver(
      ([e]) => setSolid(!e.isIntersecting && e.boundingClientRect.top < 0),
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <header className="site-nav" data-solid={solid || undefined}>
      <nav aria-label="Main" className="site-nav-inner">
        <Link href="/" className="site-wordmark">
          Namzilabs
        </Link>

        <ul className="site-links">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="site-link">
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* THE SAME LINKS, REACHABLE UNDER 900px. The capsule hides them and
            without this they were simply gone on a phone — the footer carries
            the same anchors, but a nav that silently loses its nav is a
            regression, not a responsive decision.

            `<details>` rather than a button and state: it is keyboard-operable
            and closes on Escape with no JavaScript, which is the right default
            for a disclosure whose contents are already in the DOM. */}
        <details className="site-menu">
          <summary aria-label="Open the menu">
            <Menu aria-hidden className="size-5" />
          </summary>
          <ul className="site-menu-sheet">
            {LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="site-menu-link">
                  {l.label}
                </Link>
              </li>
            ))}
            {!signedIn && (
              <li>
                <a href="/sign-in" className="site-menu-link">
                  Sign in
                </a>
              </li>
            )}
          </ul>
        </details>

        <div className="site-actions">
          {signedIn ? (
            <a href="/dashboard" className="btn-solid btn-sm">
              Dashboard
            </a>
          ) : (
            <>
              <a href="/sign-in" className="site-link site-link-signin">
                Sign in
              </a>
              <a href="/sign-up" className="btn-solid btn-sm">
                Start free
              </a>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
