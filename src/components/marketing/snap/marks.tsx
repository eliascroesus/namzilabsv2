import styles from "@/app/snap.module.css";

/**
 * COLOUR MEANS SOURCE. INK MEANS ANSWER.
 *
 * Five named sources own a colour each and keep it in every section they
 * appear in — hero chip, disagreement row, rail pill, source index — so the
 * reader learns the mapping without being taught it. Everything else is
 * slate. That is the whole point of the palette: colour is the PROBLEM (five
 * tools, five partial answers) and ink is the ANSWER, which is why a source
 * colour may never fill a button and a resolved figure may never be anything
 * but ink.
 *
 * `onLight` is not a style preference. Lemon and mint are bright enough that
 * white on them fails contrast outright, so §6.1 assigns ink to exactly those
 * two — and getting it wrong produces an initials tile that reads as a blank
 * coloured dot, which is precisely the bug this product had in its own
 * connector list.
 */
const SOURCE_COLOURS: Record<string, { token: string; onLight: boolean }> = {
  Calendly: { token: "--src-coral", onLight: false },
  "Google Sheets": { token: "--src-lemon", onLight: true },
  Stripe: { token: "--src-mint", onLight: true },
  "Close CRM": { token: "--src-sky", onLight: false },
  Instantly: { token: "--src-lilac", onLight: false },
};

export function sourceColour(name: string) {
  return SOURCE_COLOURS[name] ?? { token: "--src-slate", onLight: false };
}

/** The initials a squircle carries, from the catalogue's own short code. */
function initials(name: string, short?: string) {
  if (short) return short.toUpperCase();
  const words = name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
}

/**
 * The source squircle — a rounded square in the source's colour holding two
 * letters. Deliberately NOT the product's own `SourceMark`, which paints each
 * connector in its real brand colour: that is right inside the app, where a
 * row is recognised by shape before it is read, and wrong here, where the
 * five colours have been reassigned to carry an argument.
 */
export function Squircle({
  name,
  short,
  size = 40,
  className,
}: {
  name: string;
  short?: string;
  size?: number;
  className?: string;
}) {
  const { token, onLight } = sourceColour(name);
  return (
    <span
      aria-hidden
      className={`${styles.squircle} ${onLight ? styles.onLight : ""} ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.35),
        background: `var(${token})`,
        fontSize: Math.round(size * 0.34),
      }}
    >
      {initials(name, short)}
    </span>
  );
}

/**
 * The tick. Drawn rather than imported, at 2.5px with round caps — one of the
 * page's two marks, and the only icon set it has.
 *
 * It is never the sole carrier of a meaning: every matched state pairs it with
 * a word, so the state survives for a reader who cannot separate the green
 * from the ink. §10 lists that as a requirement, not a preference.
 */
export function Tick({ size = 16, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <svg
      aria-hidden
      className={`${styles.tick} ${onDark ? styles.tickOnDark : ""}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
    >
      <path d="M3.2 8.6 L6.4 11.8 L12.8 4.6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * The logo mark: two white dots on an ink squircle that merge into one when
 * the nav is hovered. Two become one — the product, stated in a logo. §3 caps
 * the page's wit here and nowhere else.
 */
export function LogoMark() {
  return (
    <span aria-hidden className={styles.navMark}>
      <span className={`${styles.navDot} ${styles.navDotA}`} />
      <span className={`${styles.navDot} ${styles.navDotB}`} />
    </span>
  );
}
