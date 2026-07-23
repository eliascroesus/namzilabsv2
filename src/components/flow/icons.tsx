"use client";

/**
 * A consistent monochrome glyph family for internal operations. Everything is drawn
 * with `currentColor` so the surrounding element controls the colour — colour is
 * reserved for state, never the icon itself. Data-source nodes use SourceBadge
 * (brand colour) instead of these glyphs.
 */
const PATHS: Record<string, React.ReactNode> = {
  app: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </>
  ),
  filter: <path d="M4 5h16l-6 8v5l-4 2v-7z" />,
  time: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  paths: (
    <>
      <circle cx="6" cy="12" r="2" />
      <path d="M8 12h3l5-4" />
      <path d="M11 12l5 4" />
      <circle cx="18" cy="7" r="1.6" />
      <circle cx="18" cy="17" r="1.6" />
    </>
  ),
  // Unite: the mirror of paths — two lanes flowing back into one line.
  unite: (
    <>
      <circle cx="6" cy="7" r="1.6" />
      <circle cx="6" cy="17" r="1.6" />
      <path d="M8 7l5 4h3" />
      <path d="M8 17l5-4" />
      <circle cx="18" cy="12" r="2" />
    </>
  ),
  group: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  formula: (
    <>
      <circle cx="7" cy="8" r="1.4" />
      <circle cx="7" cy="16" r="1.4" />
      <path d="M11 12h9" />
      <path d="M15 7.5l4 9" />
    </>
  ),
  output: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7.5 15l3-3 2.2 2.2L17 9" />
    </>
  ),
};

export function NodeGlyph({ type, className = "h-4 w-4" }: { type: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {PATHS[type] ?? PATHS.app}
    </svg>
  );
}

/** The little database glyph on inputs that can insert data from an earlier step. */
export function DataIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
      <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </svg>
  );
}
