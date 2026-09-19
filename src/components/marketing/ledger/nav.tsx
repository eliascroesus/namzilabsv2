"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "@/app/ledger.module.css";

const LINKS = [
  { label: "How it works", href: "#how-it-works", id: "how-it-works" },
  { label: "Receipts", href: "#receipts", id: "receipts" },
  { label: "Sources", href: "#sources", id: "sources" },
  { label: "Docs", href: "/docs", id: null },
] as const;

/**
 * S00. Stay out of the way, then be there the moment somebody is convinced.
 *
 * THE BUTTON IS HIDDEN AT SCROLL 0 ON DESKTOP, which looks like a bug until
 * you read the reason: the hero carries the identical button 200px below it,
 * and two copies of the same call to action in one viewport is a conversion
 * leak rather than a gain — the reader has to decide which one is the real
 * one. It is revealed by watching the HERO'S button leave the viewport, not by
 * a scroll threshold, so the two are never on screen together at any height.
 *
 * On mobile it is always visible, because there the hero's button leaves the
 * viewport almost immediately and the nav is the only one left.
 *
 * `Menu` is a word, not a hamburger. Three lines is an icon whose meaning
 * everybody learned by accident; the page has room for four letters.
 */
export function LedgerNav({ cta, ctaLabel }: { cta: string; ctaLabel: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [ctaShown, setCtaShown] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const heroCta = document.getElementById("hero-cta");
    if (!heroCta) {
      setCtaShown(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => setCtaShown(!entry.isIntersecting), {
      threshold: 0,
    });
    observer.observe(heroCta);
    return () => observer.disconnect();
  }, []);

  // Which section the reader is actually in. `rootMargin` pulls the detection
  // line to the middle of the viewport so the underline changes when a section
  // owns the screen, rather than the instant its top edge clears the nav.
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

  // A full-screen overlay that leaves the page scrollable underneath is a
  // menu you can accidentally scroll away from.
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <>
      <header className={`${styles.nav} ${scrolled ? styles.navScrolled : ""}`}>
        <div className={`${styles.container} ${styles.navInner}`}>
          <Link className={styles.wordmark} href="/">
            Namzilabs
          </Link>

          <nav className={styles.navLinks} aria-label="Primary">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                className={`${styles.navLink} ${link.id && active === link.id ? styles.navLinkActive : ""}`}
                href={link.href}
                aria-current={link.id && active === link.id ? "true" : undefined}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className={styles.navInner} style={{ gap: 20 }}>
            <button
              type="button"
              className={`${styles.textBtn} ${styles.menuBtn}`}
              onClick={() => setMenuOpen(true)}
              aria-expanded={menuOpen}
            >
              Menu
            </button>
            <Link
              className={`${styles.btn} ${styles.btnNav} ${styles.navCta} ${ctaShown ? styles.navCtaShown : ""}`}
              href={cta}
              tabIndex={ctaShown ? undefined : -1}
            >
              <span>{ctaLabel}</span>
            </Link>
          </div>
        </div>
      </header>

      {menuOpen ? (
        <div className={styles.menuOverlay} role="dialog" aria-modal="true" aria-label="Menu">
          <div className={styles.menuTop}>
            <span className={styles.wordmark}>Namzilabs</span>
            <button type="button" className={styles.textBtn} onClick={() => setMenuOpen(false)} autoFocus>
              Close
            </button>
          </div>
          <nav className={styles.menuLinks} aria-label="Primary">
            {LINKS.map((link) => (
              <Link key={link.href} className={styles.menuLink} href={link.href} onClick={() => setMenuOpen(false)}>
                {link.label}
              </Link>
            ))}
          </nav>
          <Link className={`${styles.btn} ${styles.menuCta}`} href={cta}>
            <span>{ctaLabel}</span>
          </Link>
        </div>
      ) : null}
    </>
  );
}
