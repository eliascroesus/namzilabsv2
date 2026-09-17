/**
 * THE STARFIELD, AND THE CONSTELLATION IN IT.
 *
 * ── WHY STARS ARE NOT DECORATION HERE ──────────────────────────────────────
 *
 * The owner asked for stars, and they turn out to be the picture this product
 * has been missing. A constellation is scattered points that somebody joined
 * into one shape you can name — which is, exactly, what Namzilabs does to a
 * stack of tools. Calendly, Close, Stripe and a spreadsheet are the stars; the
 * metric is the figure drawn through them. The page argues this in words three
 * times below the fold; the hero can now argue it before a word is read.
 *
 * So the field is NOT random noise with a few lines over it. One group of nine
 * stars is joined into a deliberate figure, and the rest of the sky is the
 * unjoined points it was picked out of.
 *
 * ── WHY IT IS DETERMINISTIC ────────────────────────────────────────────────
 *
 * `Math.random()` in a server component is rendered once on the server and
 * again on the client, and the two disagree — React then throws a hydration
 * mismatch and, worse, the sky visibly jumps on load. The positions come from
 * a tiny seeded generator evaluated at MODULE scope, so every render of every
 * request produces the same sky. It also means the composition below could be
 * art-directed by hand later without changing anything else.
 *
 * ── WHY SVG AND NOT A PNG ──────────────────────────────────────────────────
 *
 * ~4KB of markup against ~400KB for a night-sky photograph big enough not to
 * blur on a 5K display, and this one crops by moving a viewBox rather than by
 * being re-exported at four breakpoints.
 */

/**
 * Mulberry32 — 12 lines, uniform enough for a sky, and identical on both sides
 * of the render. The seed is arbitrary and chosen by looking at the result.
 */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VIEW = { w: 1440, h: 900 };

/**
 * THE FIELD: 120 stars, weighted towards the top.
 *
 * `y = rand² × 0.62` rather than `rand × 0.62` is the whole reason this reads
 * as a sky rather than as confetti. Squaring biases the distribution upward, so
 * the stars crowd where the gradient is darkest and thin out as it lightens —
 * which is both what a real sky does near a horizon and what the contrast
 * budget needs, since the lower half of this hero is where the 14px type sits.
 */
const STARS = (() => {
  const rand = rng(20260918);
  return Array.from({ length: 120 }, () => {
    const y = rand() ** 2 * 0.62;
    return {
      x: rand() * VIEW.w,
      y: y * VIEW.h,
      /* Small. A 3px dot is a bullet point; real stars are almost subliminal
         and earn their presence by being many. */
      r: 0.5 + rand() * 1.3,
      /* Dimmer the lower they sit, so none of them fights the type below. */
      o: (0.25 + rand() * 0.6) * (1 - y * 1.1),
    };
  }).filter((s) => s.o > 0.06);
})();

/**
 * THE FIGURE — nine stars and the eight lines that make them one thing.
 *
 * Hand-placed, not generated, because a constellation is by definition the
 * shape somebody chose. It sits left of centre and high, where the sky is
 * darkest and where it will not collide with a centred headline.
 */
const FIGURE: Array<[number, number]> = [
  [148, 96],
  [252, 168],
  [214, 286],
  [330, 248],
  [452, 196],
  [428, 326],
  [548, 300],
  [366, 124],
  [470, 76],
];
const EDGES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [1, 3],
  [3, 4],
  [3, 5],
  [5, 6],
  [4, 7],
  [7, 8],
];

/** A four-pointed glint — the two or three stars bright enough to have rays. */
function Sparkle({ x, y, s, o }: { x: number; y: number; s: number; o: number }) {
  return (
    <path
      d={`M${x} ${y - s} Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y} Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s} Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y} Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s} Z`}
      fill="#ffffff"
      opacity={o}
    />
  );
}

export function NightSky() {
  return (
    /* `-z-10` keeps the field behind the hero's content while staying inside
       the section's own stacking context, which `.night-sky` opens with
       `isolation: isolate`. Without that isolation this would sit behind the
       page's background instead and vanish entirely. */
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <svg
        viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
        /* `slice` rather than the default `meet`: the sky should COVER the
           section at any shape, cropping at the sides on a narrow screen the
           way a background-size:cover image would, instead of letter-boxing
           itself into the middle and leaving bare gradient above and below. */
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 size-full"
      >
        <defs>
          {/* The halo around the constellation's own stars. Without it they are
              the same dot as the other 120 and the figure reads as an accident
              rather than as the thing that was picked out. */}
          <radialGradient id="star-glow">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="45%" stopColor="#9dbdf0" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#9dbdf0" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* ── the ordinary sky ─────────────────────────────────────────── */}
        {STARS.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#ffffff" opacity={s.o} />
        ))}

        <Sparkle x={1104} y={122} s={13} o={0.8} />
        <Sparkle x={892} y={238} s={9} o={0.55} />
        <Sparkle x={1268} y={318} s={7} o={0.4} />

        {/* ── the figure ───────────────────────────────────────────────── */}
        {/* THE LINES ARE DRAWN FIRST so the stars sit ON them rather than
            being crossed by them — a join that runs over its own star reads as
            a scratch. They are deliberately faint: the argument is that the
            points are real and the shape between them is something somebody
            decided, so the shape should look drawn rather than built. */}
        <g stroke="#8fb2ff" strokeOpacity="0.38" strokeWidth="1" strokeLinecap="round">
          {EDGES.map(([a, b], i) => (
            <line key={i} x1={FIGURE[a][0]} y1={FIGURE[a][1]} x2={FIGURE[b][0]} y2={FIGURE[b][1]} />
          ))}
        </g>

        {FIGURE.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={16} fill="url(#star-glow)" />
            <circle cx={x} cy={y} r={2.1} fill="#ffffff" />
          </g>
        ))}
      </svg>
    </div>
  );
}
