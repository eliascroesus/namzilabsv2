"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "@/app/snap.module.css";
import { LogoMark } from "./marks";

const LINKS = [
  { label: "How it works", href: "#how-it-works", id: "how-it-works" },
  { label: "Receipts", href: "#receipts", id: "receipts" },
  { label: "Sources", href: "#sources", id: "sources" },
  { label: "Docs", href: "/docs", id: null },
] as const;

/**
 * S00 — a floating pill, not a bar.
 *
 * The distinction is the first thing a visitor reads without noticing they
 * have read it: a full-width bar pinned to the top edge is what enterprise
 * software wears, and this page is aimed at somebody who decides in about two
 * seconds whether a product is for people like them. An object floating 20px
 * clear of the top, casting a shadow onto the page, belongs to the same world
 * as the chips below it.
 *
 * It SHRINKS on scroll and never becomes a bar. Growing to full width is the
 * default every framework ships and it throws away the one decision that made
 * the header distinctive.
 */
export function SnapNav({
  cta,
  ctaLabel,
  revealAfter,
}: {
  cta: string;
  ctaLabel: string;
  /** Selector for the element the reader must scroll past before the pill
      appears. Omit and the nav is present from the first frame. */
  revealAfter?: string;
}) {
  const [scrolled, setScrolled] = useState(false);
  const [revealed, setRevealed] = useState(!revealAfter);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  /**
   * THE PILL IS NOT THERE UNTIL THE READER HAS PASSED THE SOURCE RAIL.
   *
   * At the owner's ask, and it buys two things. The hero gets the top of the
   * screen to itself — the headline moved up by the 80px the pill was
   * reserving — and the nav stops competing with the hero's own call to
   * action, which is the same button 200px below it.
   *
   * MEASURED ON SCROLL RATHER THAN OBSERVED. An IntersectionObserver was the
   * obvious tool and the wrong one: it reports CROSSINGS, so a reader who
   * arrives at a restored scroll position, or follows a deep link, or jumps
   * the page in one gesture can land well past the rail without ever
   * triggering one — and then has no navigation at all. Reading the rail's
   * own edge answers "am I past it" at any moment, including the first.
   */
  useEffect(() => {
    if (!revealAfter) return;
    const anchor = document.querySelector(revealAfter);
    if (!anchor) {
      setRevealed(true);
      return;
    }
    let queued = false;
    const measure = () => {
      queued = false;
      setRevealed(anchor.getBoundingClientRect().bottom <= 0);
    };
    const onScroll = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [revealAfter]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Which section owns the screen. `rootMargin` pulls the detection line to
  // the middle of the viewport so the pill changes when a section is actually
  // being read, not the instant its top edge clears the nav.
  useEffect(() => {
    const sections = LINKS.map((link) => (link.id === null ? null : document.getElementById(link.id))).filter(
      (node): node is HTMLElement => node !== null,
    );
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length > 0) setActive(visible[0].target.id);
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <>
      <header className={`${styles.nav} ${scrolled ? styles.navScrolled : ""} ${revealed ? styles.navShown : styles.navHidden}`}
        // Out of the tab order entirely while it is off-screen, or the first
        // Tab from the hero lands on a control nobody can see.
        inert={!revealed || undefined}
      >
        <Link className={styles.footerBrand} href="/" aria-label="Namzilabs home">
          <LogoMark />
          <span className={styles.wordmark}>Namzilabs</span>
        </Link>

        <nav className={styles.navLinks} aria-label="Primary">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              className={`${styles.navLink} ${link.id && active === link.id ? styles.navLinkActive : ""}`}
              href={link.href}
              aria-current={link.id && active === link.id ? "true" : undefined}
            >
              <span>{link.label}</span>
            </Link>
          ))}
        </nav>

        <span className={styles.navSpacer} />

        <Link className={`${styles.textBtn} ${styles.navLogin}`} href="/login">
          <span>Log in</span>
        </Link>

        {/* A word, not a hamburger. Three lines is an icon whose meaning
            everybody learned by accident; there is room for four letters. */}
        <button type="button" className={`${styles.textBtn} ${styles.menuBtn}`} onClick={() => setMenuOpen(true)} aria-expanded={menuOpen}>
          <span>Menu</span>
        </button>

        <Link className={`${styles.btn} ${styles.btnNav}`} href={cta}>
          {ctaLabel}
        </Link>
      </header>

      {menuOpen ? (
        <div className={styles.menuOverlay} role="dialog" aria-modal="true" aria-label="Menu">
          <div className={styles.menuTop}>
            <span className={styles.footerBrand}>
              <LogoMark />
              <span className={styles.wordmark}>Namzilabs</span>
            </span>
            <button type="button" className={styles.textBtn} onClick={() => setMenuOpen(false)} autoFocus>
              <span>Close</span>
            </button>
          </div>
          <nav className={styles.menuLinks} aria-label="Primary">
            {LINKS.map((link) => (
              <Link key={link.href} className={styles.menuLink} href={link.href} onClick={() => setMenuOpen(false)}>
                {link.label}
              </Link>
            ))}
            <Link className={styles.menuLink} href="/login" onClick={() => setMenuOpen(false)}>
              Log in
            </Link>
          </nav>
          <Link className={`${styles.btn} ${styles.menuCta}`} href={cta}>
            {ctaLabel}
          </Link>
        </div>
      ) : null}
    </>
  );
}
