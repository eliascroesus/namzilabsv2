/**
 * THE CLOUDS.
 *
 * WHY THE HERO NEEDED SOMETHING DRAWN IN IT AT ALL. A gradient is a fill, and
 * a fill is what a page has when nobody made a picture for it — which was the
 * owner's whole complaint about the previous version. The reference
 * (themochi.app) opens on a photograph of a sky full of fat cumulus, and that
 * one decision does more for it than every card below the fold put together:
 * it establishes that a person art-directed the page.
 *
 * WHY THESE ARE SVG RATHER THAN THAT PHOTOGRAPH. A 2200px cloud PNG is ~300KB
 * of decoration that has to be re-cropped at every breakpoint and re-made for
 * the dark theme. These are about 2KB of markup, stay sharp on any display,
 * crop by moving a viewBox, and are white at low opacity — which works over the
 * noon sky and over the dusk one without a second asset.
 *
 * HOW A CLOUD IS BUILT. Three parts, and all three are needed or it reads as a
 * bubble diagram:
 *
 *   1. A BODY of overlapping circles with a flat base, filled with a vertical
 *      gradient — white at the crown falling to a cool grey underneath. Real
 *      cumulus are lit from above and shadowed beneath, and a flat white blob
 *      is the tell that nobody looked at one.
 *   2. A BLURRED COPY behind it, scaled up slightly, which is what gives the
 *      edge its softness. Cloud edges are not curves, they are gradients.
 *   3. A HIGHLIGHT arc on the upper right of each lobe, because the sky
 *      gradient puts the sun at 84% 0% and the lighting has to agree with it.
 *
 * `aria-hidden` throughout: this is weather, not information.
 */

/** One cumulus, drawn in a 200×90 box so callers can place it by width alone. */
function Cloud({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-body`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="62%" stopColor="#f4f8ff" />
          {/* The underside. Without it the shape is a sticker; with it the
              cloud has a bottom that the sky can be brighter than. */}
          <stop offset="100%" stopColor="#cfdff5" />
        </linearGradient>
        <filter id={`${id}-soft`} x="-30%" y="-40%" width="160%" height="190%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      {/* The blurred understudy — same path, no detail, pushed down a little so
          the softness gathers under the cloud where the shadow would be. */}
      <g filter={`url(#${id}-soft)`} opacity="0.85">
        <path
          d="M30 78 Q10 78 10 62 Q10 46 28 45 Q30 24 52 22 Q66 6 90 10 Q108 -2 128 10 Q152 8 158 28 Q182 30 184 50 Q186 78 162 78 Z"
          fill="#ffffff"
        />
      </g>

      <path
        d="M30 78 Q10 78 10 62 Q10 46 28 45 Q30 24 52 22 Q66 6 90 10 Q108 -2 128 10 Q152 8 158 28 Q182 30 184 50 Q186 78 162 78 Z"
        fill={`url(#${id}-body)`}
      />

      {/* THE SUN SIDE. Two arcs on the upper-right of the two tallest lobes,
          which is where the hero's own `radial-gradient(... at 84% -8%)` puts
          the light. Lighting that disagrees with its own sky is worse than no
          lighting at all. */}
      <path d="M96 12 Q116 4 128 14" stroke="#ffffff" strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.9" />
      <path d="M150 26 Q168 28 174 42" stroke="#ffffff" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.75" />
    </>
  );
}

/**
 * The field: five clouds at three depths.
 *
 * THE DEPTHS ARE THE POINT. All five at one size and one opacity is wallpaper;
 * the far ones small and washed out, the near ones large and opaque, is a sky.
 * The two nearest sit low and wide so they run under the headline rather than
 * behind it — type over the busiest part of a cloud is the one place this
 * composition can lose its contrast, and the measurement that would catch it
 * (`pnpm landing`) samples the pixel behind the glyph, not the average.
 */
const FIELD: Array<{ left: string; top: string; width: string; opacity: number; hide?: string }> = [
  { left: "-4%", top: "18%", width: "30rem", opacity: 0.95 },
  { left: "72%", top: "6%", width: "34rem", opacity: 0.92 },
  { left: "38%", top: "-6%", width: "18rem", opacity: 0.5, hide: "hidden lg:block" },
  { left: "14%", top: "56%", width: "26rem", opacity: 0.4, hide: "hidden md:block" },
  { left: "60%", top: "62%", width: "30rem", opacity: 0.35, hide: "hidden md:block" },
];

export function Clouds() {
  return (
    /* `-z-10` puts the whole field behind the hero's content while staying
       inside the section's own stacking context, which `.day-sky` opens with
       `isolation: isolate`. Without that isolation this would sit behind the
       page's background instead and vanish. */
    <div aria-hidden className="cloud-field pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {FIELD.map((c, i) => (
        <svg
          key={i}
          viewBox="0 0 194 80"
          className={`absolute ${c.hide ?? ""}`}
          style={{ left: c.left, top: c.top, width: c.width, opacity: c.opacity }}
        >
          <Cloud id={`cloud-${i}`} />
        </svg>
      ))}
    </div>
  );
}
