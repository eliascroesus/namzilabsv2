import { CONNECTOR_CATALOG } from "./catalog";

/**
 * AN APP'S UPLOADED ICON — a file dropped into `public/app-icons/`, if there
 * is one for it.
 *
 * Eighteen of the catalogue's apps have no redistributable mark in
 * `logos.ts` and draw a two-letter tile instead. The owner asked for a folder
 * to fix that by hand: put `instantly.png` in it and every surface that shows
 * an app — the Apps page, the flow builder, the landing page, a template's
 * slots — shows Instantly's logo. An upload also WINS over a built-in mark, so
 * a better file can replace one.
 *
 * ═══ A FILE FINDS ITS APP BY NAME, FORGIVINGLY ═══
 *
 * Lower-cased, with everything but letters and digits dropped, the file name
 * is compared to the app's slug and to its display name. So `instantly.png`,
 * `Instantly.png`, `Google Ads.svg`, `google-ads.svg` and `gads.svg` all land
 * where they obviously should — nobody has to know that Google Ads is `gads`
 * inside the catalogue.
 *
 * The list is baked in at BUILD time (`next.config.mjs` → `env.APP_ICONS`),
 * which is why a new file needs a build — a deploy, or a dev-server restart —
 * before it shows. The raw string is read through `process.env.APP_ICONS`
 * spelled out in full, because that literal is what the bundler replaces.
 */

type Entry = { key: string; src: string };

const normalise = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");

let builtFor: string | null = null;
let bySource = new Map<string, string>();

function build(raw: string): Map<string, string> {
  let entries: Entry[] = [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      entries = parsed.filter(
        (e): e is Entry =>
          typeof e === "object" && e != null && typeof (e as Entry).key === "string" && typeof (e as Entry).src === "string" && (e as Entry).src.startsWith("/app-icons/"),
      );
    }
  } catch {
    entries = [];
  }
  const byKey = new Map(entries.map((e) => [normalise(e.key), e.src]));
  const out = new Map<string, string>();
  for (const app of CONNECTOR_CATALOG) {
    const src =
      byKey.get(normalise(app.source)) ??
      byKey.get(normalise(app.name)) ??
      (app.brand?.label ? byKey.get(normalise(app.brand.label)) : undefined);
    if (src) out.set(app.source, src);
  }
  return out;
}

/** The uploaded icon's URL for this app, or undefined when nobody has added one. */
export function uploadedIcon(source: string | null | undefined): string | undefined {
  if (!source) return undefined;
  const raw = process.env.APP_ICONS ?? "[]";
  if (raw !== builtFor) {
    bySource = build(raw);
    builtFor = raw;
  }
  return bySource.get(source);
}
