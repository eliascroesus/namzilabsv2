/**
 * THE CONNECTOR MARKS — curated, committed, and drawn as their owners draw them.
 *
 * ═══ TWO KINDS OF MARK, AND THE DIFFERENCE IS LOAD-BEARING ═══
 *
 * A PAINTED mark is a silhouette with no colour of its own. Its paths carry
 * `currentColor`, and `BrandLogo` paints them with the brand colour from the
 * catalogue — darkened by `logoColor` only as far as it takes to stay visible
 * on a light card, which is why Mailchimp's yellow is still recognisably
 * Mailchimp's. Most of these are Simple Icons, a monochrome set by design.
 *
 * An OFFICIAL mark is not paintable. Google Calendar is a white sheet inside a
 * blue, green, yellow and red frame; its colours ARE the logo. Those paths
 * carry the fills they shipped with and nothing may touch them. Rendering one
 * through a single `fill` is what made the owner say "the google calendar
 * thing is not correct colors ... keep the logos 1:1 to what they are
 * normally", and the shape of this file is the answer: a mark is a viewBox and
 * a LIST of paths, each with its own fill.
 *
 * ═══ WHAT WAS DELIBERATELY NOT TAKEN ═══
 *
 * Official files were fetched for Stripe, Paddle, Calendly and Aircall too, and
 * all four were REFUSED: each is an app-icon tile, not a mark — Stripe's is a
 * full-bleed `#533AFD` rectangle, Paddle's a `#1C1A15` rounded square, Calendly
 * and Aircall gradient squircles. The owner's instruction was the opposite of
 * that ("not any like background color or square around them and shit"), and a
 * row of coloured tiles is the look the tinted chip was just removed for. They
 * keep their silhouettes, painted in their own brand colour — which is the
 * treatment he pointed at Calendly and called right in the first place.
 *
 * GOOGLE'S 2026 REDESIGN IS ALSO NOT HERE, on purpose. Google began replacing
 * these marks in May 2026: the current Calendar is a flat blue sheet with a
 * white "31" and a gradient wash. That is almost exactly the thing the owner
 * was complaining about the day this was written, it needs gradients, masks and
 * a Gaussian blur that smears at 20px, and its files ship colliding element ids
 * and no viewBox. The four-colour marks below are the ones he described
 * wanting. If that judgement is ever revisited, the current files are at
 * `gstatic.com/images/branding/productlogos/calendar_2026/` — and they are
 * rawSvg, not a path list.
 *
 * ═══ THE viewBox IS PER MARK ═══
 *
 * Not every logo is square. Sheets is 64×88 portrait; Whop's is 383.2×196.4,
 * twice as wide as tall. The old model hard-coded 24×24 in two components;
 * `BrandLogo` fits the real box into whatever square the caller asked for.
 *
 * ═══ PROVENANCE AND LICENSING ═══
 *
 * Simple Icons publishes its icon FILES under CC0-1.0, so redistributing those
 * is unencumbered. Official vendor art is NOT CC0: those marks are their
 * owners' trademarks, included to identify which integration a row is about.
 * That is nominative use, which is the one thing trademark law is clearest
 * about — and it is also why nothing here recolours, redraws or simplifies a
 * mark. Each official entry names the file it came from, so a brand that
 * redraws theirs is a diff somebody reads rather than a silent swap.
 *
 * ═══ ADDING ONE ═══
 *
 *   node scripts/svg-to-logo.mjs <source-key> <file.svg>
 *
 * which resolves Illustrator's class-based fills, collapses the line wrapping
 * exporters put inside `d`, and refuses a file whose paint comes from a
 * gradient or a mask. Then RENDER IT AND LOOK: path data that parses is not
 * path data that is correct.
 */

/** One brand's mark: the file's own viewBox, and its paths in paint order. */
export type SourceLogo = {
  viewBox: string;
  paths: ReadonlyArray<{ d: string; fill: string }>;
};

export const SOURCE_LOGOS: Readonly<Record<string, SourceLogo>> = Object.freeze({
  // Calendly — Simple Icons (CC0-1.0), painted with the brand's own colour.
  calendly: {
    viewBox: "0 0 24 24",
    paths: [{ d: "M19.655 14.262c.281 0 .557.023.828.064 0 .005-.005.01-.005.014-.105.267-.234.534-.381.786l-1.219 2.106c-1.112 1.936-3.177 3.127-5.411 3.127h-2.432c-2.23 0-4.294-1.191-5.412-3.127l-1.218-2.106a6.251 6.251 0 0 1 0-6.252l1.218-2.106C6.736 4.832 8.8 3.641 11.035 3.641h2.432c2.23 0 4.294 1.191 5.411 3.127l1.219 2.106c.147.252.271.519.381.786 0 .004.005.009.005.014-.267.041-.543.064-.828.064-1.816 0-2.501-.607-3.291-1.306-.764-.676-1.711-1.517-3.44-1.517h-1.029c-1.251 0-2.387.455-3.2 1.278-.796.805-1.233 1.904-1.233 3.099v1.411c0 1.196.437 2.295 1.233 3.099.813.823 1.949 1.278 3.2 1.278h1.034c1.729 0 2.676-.841 3.439-1.517.791-.703 1.471-1.306 3.287-1.301Zm.005-3.237c.399 0 .794-.036 1.179-.11-.002-.004-.002-.01-.002-.014-.073-.414-.193-.823-.349-1.218.731-.12 1.407-.396 1.986-.819 0-.004-.005-.013-.005-.018-.331-1.085-.832-2.101-1.489-3.03-.649-.915-1.435-1.719-2.331-2.395-1.867-1.398-4.088-2.138-6.428-2.138-1.448 0-2.855.28-4.175.841-1.273.543-2.423 1.315-3.407 2.299S2.878 6.552 2.341 7.83c-.557 1.324-.842 2.726-.842 4.175 0 1.448.281 2.855.842 4.174.542 1.274 1.314 2.423 2.298 3.407s2.129 1.761 3.407 2.299c1.324.556 2.727.841 4.175.841 2.34 0 4.561-.74 6.428-2.137a10.815 10.815 0 0 0 2.331-2.396c.652-.929 1.158-1.949 1.489-3.03 0-.004.005-.014.005-.018-.579-.423-1.255-.699-1.986-.819.161-.395.276-.804.349-1.218.005-.009.005-.014.005-.023.869.166 1.692.506 2.404 1.035.685.505.552 1.075.446 1.416C22.184 20.437 17.619 24 12.221 24c-6.625 0-12-5.375-12-12s5.37-12 12-12c5.398 0 9.963 3.563 11.471 8.464.106.341.239.915-.446 1.421-.717.529-1.535.873-2.404 1.034.128.716.128 1.45 0 2.166-.387-.074-.782-.11-1.182-.11-4.184 0-3.968 2.823-6.736 2.823h-1.029c-1.899 0-3.15-1.357-3.15-3.095v-1.411c0-1.738 1.251-3.094 3.15-3.094h1.034c2.768 0 2.552 2.823 6.731 2.827Z", fill: "currentColor" }],
  },
  /**
   * Google Sheets — the green page with the white grid.
   *
   * PORTRAIT, 64×88, tight to the page with no padding. It is the one mark
   * here that is taller than it is wide, so in a square box it fits to the
   * height and sits narrower than its neighbours — which is what the real
   * logo does, and the reason `BrandLogo` never forces a square.
   *
   * Official art: https://upload.wikimedia.org/wikipedia/commons/a/ae/Google_Sheets_2020_Logo.svg
   */
  gsheets: {
    viewBox: "0 0 64 88",
    paths: [
      { d: "M 42,0 64,22 53,24 42,22 40,11 Z", fill: "#188038" },
      { d: "M 42,22 V 0 H 6 C 2.685,0 0,2.685 0,6 v 76 c 0,3.315 2.685,6 6,6 h 52 c 3.315,0 6,-2.685 6,-6 V 22 Z", fill: "#34A853" },
      { d: "M 12,34 V 63 H 52 V 34 Z M 29.5,58 H 17 v -7 h 12.5 z m 0,-12 H 17 V 39 H 29.5 Z M 47,58 H 34.5 V 51 H 47 Z M 47,46 H 34.5 V 39 H 47 Z", fill: "#FFFFFF" },
    ],
  },
  /**
   * Google Calendar — the four-colour mark, from Google's published art.
   *
   * THE viewBox ORIGIN IS NEGATIVE ON PURPOSE. The source file wraps all nine
   * paths in `<g transform="translate(3.75 3.75)">` and their raw coordinates
   * run -3.75 to 196.25. Shifting the box by -3.75 is the exact algebraic
   * equivalent of that group, which is what lets the paths be dropped in with
   * no wrapper. Doing neither would offset the mark by 1.9% — invisible at
   * 24px, and wrong.
   *
   * Official art: https://upload.wikimedia.org/wikipedia/commons/a/a5/Google_Calendar_icon_%282020%29.svg
   */
  gcal: {
    viewBox: "-3.75 -3.75 200 200",
    paths: [
      { d: "M148.882,43.618l-47.368-5.263l-57.895,5.263L38.355,96.25l5.263,52.632l52.632,6.579l52.632-6.579 l5.263-53.947L148.882,43.618z", fill: "#FFFFFF" },
      { d: "M65.211,125.276c-3.934-2.658-6.658-6.539-8.145-11.671l9.132-3.763c0.829,3.158,2.276,5.605,4.342,7.342 c2.053,1.737,4.553,2.592,7.474,2.592c2.987,0,5.553-0.908,7.697-2.724s3.224-4.132,3.224-6.934c0-2.868-1.132-5.211-3.395-7.026 s-5.105-2.724-8.5-2.724h-5.276v-9.039H76.5c2.921,0,5.382-0.789,7.382-2.368c2-1.579,3-3.737,3-6.487 c0-2.447-0.895-4.395-2.684-5.855s-4.053-2.197-6.803-2.197c-2.684,0-4.816,0.711-6.395,2.145s-2.724,3.197-3.447,5.276 l-9.039-3.763c1.197-3.395,3.395-6.395,6.618-8.987c3.224-2.592,7.342-3.895,12.342-3.895c3.697,0,7.026,0.711,9.974,2.145 c2.947,1.434,5.263,3.421,6.934,5.947c1.671,2.539,2.5,5.382,2.5,8.539c0,3.224-0.776,5.947-2.329,8.184 c-1.553,2.237-3.461,3.947-5.724,5.145v0.539c2.987,1.25,5.421,3.158,7.342,5.724c1.908,2.566,2.868,5.632,2.868,9.211 s-0.908,6.776-2.724,9.579c-1.816,2.803-4.329,5.013-7.513,6.618c-3.197,1.605-6.789,2.421-10.776,2.421 C73.408,129.263,69.145,127.934,65.211,125.276z", fill: "#1A73E8" },
      { d: "M121.25,79.961l-9.974,7.25l-5.013-7.605l17.987-12.974h6.895v61.197h-9.895L121.25,79.961z", fill: "#1A73E8" },
      { d: "M148.882,196.25l47.368-47.368l-23.684-10.526l-23.684,10.526l-10.526,23.684L148.882,196.25z", fill: "#EA4335" },
      { d: "M33.092,172.566l10.526,23.684h105.263v-47.368H43.618L33.092,172.566z", fill: "#34A853" },
      { d: "M12.039-3.75C3.316-3.75-3.75,3.316-3.75,12.039v136.842l23.684,10.526l23.684-10.526V43.618h105.263 l10.526-23.684L148.882-3.75H12.039z", fill: "#4285F4" },
      { d: "M-3.75,148.882v31.579c0,8.724,7.066,15.789,15.789,15.789h31.579v-47.368H-3.75z", fill: "#188038" },
      { d: "M148.882,43.618v105.263h47.368V43.618l-23.684-10.526L148.882,43.618z", fill: "#FBBC04" },
      { d: "M196.25,43.618V12.039c0-8.724-7.066-15.789-15.789-15.789h-31.579v47.368H196.25z", fill: "#1967D2" },
    ],
  },
  /**
   * Google Analytics — the three amber bars on a transparent ground.
   *
   * The third shape is a `<circle>` in the source file, converted to the two
   * arcs that describe it exactly (cx=41 cy=163 r=21 through (20,163) and
   * (62,163)). A circle is expressible as a path with no loss; this is not an
   * approximation.
   *
   * Official art: https://www.gstatic.com/analytics-suite/header/suite/v2/ic_analytics.svg
   */
  ganalytics: {
    viewBox: "0 0 192 192",
    paths: [
      { d: "M130,29v132c0,14.77,10.19,23,21,23c10,0,21-7,21-23V30c0-13.54-10-22-21-22S130,17.33,130,29z", fill: "#F9AB00" },
      { d: "M75,96v65c0,14.77,10.19,23,21,23c10,0,21-7,21-23V97c0-13.54-10-22-21-22S75,84.33,75,96z", fill: "#E37400" },
      { d: "M20,163A21,21 0 1 0 62,163A21,21 0 1 0 20,163Z", fill: "#E37400" },
    ],
  },
  // Stripe — Simple Icons (CC0-1.0), painted with the brand's own colour.
  stripe: {
    viewBox: "0 0 24 24",
    paths: [{ d: "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z", fill: "currentColor" }],
  },
  // Aircall — Simple Icons (CC0-1.0), painted with the brand's own colour.
  aircall: {
    viewBox: "0 0 24 24",
    paths: [{ d: "M23.451 5.906a6.978 6.978 0 0 0-5.375-5.39C16.727.204 14.508 0 12 0S7.273.204 5.924.516a6.978 6.978 0 0 0-5.375 5.39C.237 7.26.034 9.485.034 12s.203 4.74.515 6.094a6.978 6.978 0 0 0 5.375 5.39C7.273 23.796 9.492 24 12 24s4.727-.204 6.076-.516a6.978 6.978 0 0 0 5.375-5.39c.311-1.354.515-3.578.515-6.094 0-2.515-.203-4.74-.515-6.094zm-5.873 12.396l-.003.001c-.428.152-1.165.283-2.102.377l-.147.014a.444.444 0 0 1-.45-.271 1.816 1.816 0 0 0-1.296-1.074c-.351-.081-.928-.134-1.58-.134s-1.229.053-1.58.134a1.817 1.817 0 0 0-1.291 1.062.466.466 0 0 1-.471.281 8 8 0 0 0-.129-.012c-.938-.094-1.676-.224-2.105-.377l-.003-.001a.76.76 0 0 1-.492-.713c0-.032.003-.066.005-.098.073-.979.666-3.272 1.552-5.89C8.5 8.609 9.559 6.187 10.037 5.714a1.029 1.029 0 0 1 .404-.26l.004-.002c.314-.106.892-.178 1.554-.178.663 0 1.241.071 1.554.178l.005.002a1.025 1.025 0 0 1 .405.26c.478.472 1.537 2.895 2.549 5.887.886 2.617 1.479 4.91 1.552 5.89.002.032.005.066.005.098a.76.76 0 0 1-.491.713z", fill: "currentColor" }],
  },
  // Help Scout — Simple Icons (CC0-1.0), painted with the brand's own colour.
  helpscout: {
    viewBox: "0 0 24 24",
    paths: [{ d: "m3.497 14.044 7.022-7.021a4.946 4.946 0 0 0 1.474-3.526A4.99 4.99 0 0 0 10.563 0L3.54 7.024a4.945 4.945 0 0 0-1.473 3.525c0 1.373.55 2.6 1.43 3.496zm17.007-4.103-7.023 7.022a4.946 4.946 0 0 0-1.473 3.525c0 1.36.55 2.601 1.43 3.497l7.022-7.022a4.943 4.943 0 0 0 1.474-3.526c0-1.373-.55-2.6-1.43-3.496zm-.044-2.904a4.944 4.944 0 0 0 1.474-3.525c0-1.36-.55-2.6-1.43-3.497L3.54 16.965A4.986 4.986 0 0 0 3.497 24Z", fill: "currentColor" }],
  },
  // Paddle — Simple Icons (CC0-1.0), painted with the brand's own colour.
  paddle: {
    viewBox: "0 0 24 24",
    paths: [{ d: "M2.363 7.904v.849a3.95 3.95 0 0 1 3.65 2.425c.198.476.3.987.299 1.502h.791c0-1.04.416-2.037 1.157-2.772a3.962 3.962 0 0 1 2.792-1.149V7.91a3.959 3.959 0 0 1-3.65-2.425 3.893 3.893 0 0 1-.299-1.502h-.791c0 1.04-.416 2.037-1.157 2.772a3.96 3.96 0 0 1-2.792 1.149M13.105 2.51H6.312V0h6.793c4.772 0 8.532 3.735 8.532 8.314 0 4.58-3.76 8.314-8.532 8.314H9.156V24H6.312v-9.882h6.793c3.319 0 5.688-2.352 5.688-5.804 0-3.451-2.37-5.804-5.688-5.804", fill: "currentColor" }],
  },
  /**
   * Airtable — the three isometric slabs, no container, no wordmark.
   *
   * The fourth path is the shadow the mark ships with, `rgba(0,0,0,0.25)`.
   * It is kept because dropping it is not 1:1: the slabs read as flat
   * without it.
   *
   * Official art: https://support.airtable.com/ (official standalone symbol, inline <svg viewBox="0 0 200 170"> in
   */
  airtable: {
    viewBox: "0 0 200 170",
    paths: [
      { d: "M90.039 12.367L24.079 39.66c-3.667 1.519-3.63 6.729.062 8.192l66.235 26.266a24.575 24.575 0 0018.12 0l66.236-26.266c3.69-1.463 3.729-6.673.06-8.191l-65.958-27.294a24.578 24.578 0 00-18.795 0", fill: "#FCB400" },
      { d: "M105.312 88.46v65.617c0 3.12 3.147 5.258 6.048 4.108l73.806-28.648a4.418 4.418 0 002.79-4.108V59.813c0-3.121-3.147-5.258-6.048-4.108l-73.806 28.648a4.42 4.42 0 00-2.79 4.108", fill: "#18BFFF" },
      { d: "M88.078 91.846l-21.904 10.576-2.224 1.075-46.238 22.155c-2.93 1.414-6.672-.722-6.672-3.978V60.088c0-1.178.604-2.195 1.414-2.96a5.024 5.024 0 011.12-.84c1.104-.663 2.68-.84 4.02-.31L87.71 83.76c3.564 1.414 3.844 6.408.368 8.087", fill: "#F82B60" },
      { d: "M88.078 91.846l-21.904 10.576-53.72-45.295a5.024 5.024 0 011.12-.839c1.104-.663 2.68-.84 4.02-.31L87.71 83.76c3.564 1.414 3.844 6.408.368 8.087", fill: "rgba(0, 0, 0, 0.25)" },
    ],
  },
  // MailChimp — Simple Icons (CC0-1.0), painted with the brand's own colour.
  mailchimp: {
    viewBox: "0 0 24 24",
    paths: [{ d: "M11.267 0C6.791-.015-1.82 10.246 1.397 12.964l.79.669a3.88 3.88 0 0 0-.22 1.792c.084.84.518 1.644 1.22 2.266.666.59 1.542.964 2.392.964 1.406 3.24 4.62 5.228 8.386 5.34 4.04.12 7.433-1.776 8.854-5.182.093-.24.488-1.316.488-2.267 0-.956-.54-1.352-.885-1.352-.01-.037-.078-.286-.172-.586-.093-.3-.19-.51-.19-.51.375-.563.382-1.065.332-1.35-.053-.353-.2-.653-.496-.964-.296-.311-.902-.63-1.753-.868l-.446-.124c-.002-.019-.024-1.053-.043-1.497-.014-.32-.042-.822-.197-1.315-.186-.668-.508-1.253-.911-1.627 1.112-1.152 1.806-2.422 1.804-3.511-.003-2.095-2.576-2.729-5.746-1.416l-.672.285A678.22 678.22 0 0 0 12.7.504C12.304.159 11.817.002 11.267 0zm.073.873c.166 0 .322.019.465.058.297.084 1.28 1.224 1.28 1.224s-1.826 1.013-3.52 2.426c-2.28 1.757-4.005 4.311-5.037 7.082-.811.158-1.526.618-1.963 1.253-.261-.218-.748-.64-.834-.804-.698-1.326.761-3.902 1.781-5.357C5.834 3.44 9.37.867 11.34.873zm3.286 3.273c.04-.002.06.05.028.074-.143.11-.299.26-.413.414a.04.04 0 0 0 .031.064c.659.004 1.587.235 2.192.574.041.023.012.103-.034.092-.915-.21-2.414-.369-3.97.01-1.39.34-2.45.863-3.224 1.426-.04.028-.086-.023-.055-.06.896-1.035 1.999-1.935 2.987-2.44.034-.018.07.019.052.052-.079.143-.23.447-.278.678-.007.035.032.063.062.042.615-.42 1.684-.868 2.622-.926zm3.023 3.205l.056.001a.896.896 0 0 1 .456.146c.534.355.61 1.216.638 1.845.015.36.059 1.229.074 1.478.034.571.184.651.487.751.17.057.33.098.563.164.706.198 1.125.4 1.39.658.157.162.23.333.253.497.083.608-.472 1.36-1.942 2.041-1.607.746-3.557.935-4.904.785l-.471-.053c-1.078-.145-1.693 1.247-1.046 2.201.417.615 1.552 1.015 2.688 1.015 2.604 0 4.605-1.111 5.35-2.072a.987.987 0 0 0 .06-.085c.036-.055.006-.085-.04-.054-.608.416-3.31 2.069-6.2 1.571 0 0-.351-.057-.672-.182-.255-.1-.788-.344-.853-.891 2.333.72 3.801.039 3.801.039a.072.072 0 0 0 .042-.072.067.067 0 0 0-.074-.06s-1.911.283-3.718-.378c.197-.64.72-.408 1.51-.345a11.045 11.045 0 0 0 3.647-.394c.818-.234 1.892-.697 2.727-1.356.281.618.38 1.299.38 1.299s.219-.04.4.073c.173.106.299.326.213.895-.176 1.063-.628 1.926-1.387 2.72a5.714 5.714 0 0 1-1.666 1.244c-.34.18-.704.334-1.087.46-2.863.935-5.794-.093-6.739-2.3a3.545 3.545 0 0 1-.189-.522c-.403-1.455-.06-3.2 1.008-4.299.065-.07.132-.153.132-.256 0-.087-.055-.179-.102-.243-.374-.543-1.669-1.466-1.409-3.254.187-1.284 1.31-2.189 2.357-2.135.089.004.177.01.266.015.453.027.85.085 1.223.1.625.028 1.187-.063 1.853-.618.225-.187.405-.35.71-.401.028-.005.092-.028.215-.028zm.022 2.18a.42.42 0 0 0-.06.005c-.335.054-.347.468-.228 1.04.068.32.187.595.32.765.175-.02.343-.022.498 0 .089-.205.104-.557.024-.942-.112-.535-.261-.872-.554-.868zm-3.66 1.546a1.724 1.724 0 0 0-1.016.326c-.16.117-.311.28-.29.378.008.032.031.056.088.063.131.015.592-.217 1.122-.25.374-.023.684.094.923.2.239.104.386.173.443.113.037-.038.026-.11-.031-.204-.118-.192-.36-.387-.618-.497a1.601 1.601 0 0 0-.621-.129zm4.082.81c-.171-.003-.313.186-.317.42-.004.236.131.43.303.432.172.003.314-.185.318-.42.004-.236-.132-.429-.304-.432zm-3.58.172c-.05 0-.102.002-.155.008-.311.05-.483.152-.593.247-.094.082-.152.173-.152.237a.075.075 0 0 0 .075.076c.07 0 .228-.063.228-.063a1.98 1.98 0 0 1 1.001-.104c.157.018.23.027.265-.026.01-.016.022-.049-.01-.1-.063-.103-.311-.269-.66-.275zm2.26.4c-.127 0-.235.051-.283.148-.075.154.035.363.246.466.21.104.443.063.52-.09.075-.155-.035-.364-.246-.467a.542.542 0 0 0-.237-.058zm-11.635.024c.048 0 .098 0 .149.003.73.04 1.806.6 2.052 2.19.217 1.41-.128 2.843-1.449 3.069-.123.02-.248.029-.374.026-1.22-.033-2.539-1.132-2.67-2.435-.145-1.44.591-2.548 1.894-2.811.117-.024.252-.04.398-.042zm-.07.927a1.144 1.144 0 0 0-.847.364c-.38.418-.439.988-.366 1.19.027.073.07.094.1.098.064.008.16-.039.22-.2a1.2 1.2 0 0 0 .017-.052 1.58 1.58 0 0 1 .157-.37.689.689 0 0 1 .955-.199c.266.174.369.5.255.81-.058.161-.154.469-.133.721.043.511.357.717.64.738.274.01.466-.143.515-.256.029-.067.005-.107-.011-.125-.043-.053-.113-.037-.18-.021a.638.638 0 0 1-.16.022.347.347 0 0 1-.294-.148c-.078-.12-.073-.3.013-.504.011-.028.025-.058.04-.092.138-.308.368-.825.11-1.317-.195-.37-.513-.602-.894-.65a1.135 1.135 0 0 0-.138-.01z", fill: "currentColor" }],
  },
  /**
   * Shopify — the green shopping bag with the white S.
   *
   * Official art: https://cdn.shopify.com/shopifycloud/brochure/assets/brand-assets/shopify-logo-shopping-bag-full
   */
  shopify: {
    viewBox: "0 0 89 101",
    paths: [
      { d: "M77.667 19.756c-.07-.505-.51-.785-.877-.816-.363-.03-7.482-.139-7.482-.139s-5.954-5.781-6.542-6.37c-.588-.588-1.736-.41-2.183-.277-.006.003-1.118.347-2.99.927a20.969 20.969 0 00-1.433-3.518c-2.12-4.045-5.224-6.184-8.974-6.19h-.014c-.261 0-.52.025-.78.047a11.451 11.451 0 00-.338-.39c-1.635-1.749-3.73-2.6-6.24-2.525-4.844.138-9.668 3.637-13.58 9.851-2.752 4.373-4.847 9.866-5.44 14.119l-9.539 2.954c-2.808.883-2.896.969-3.263 3.616-.271 2-7.618 58.807-7.618 58.807L61.94 100.5l26.683-6.633S77.737 20.26 77.667 19.756zM54.51 14.035l-4.778 1.479c-.036-2.453-.327-5.865-1.47-8.814 3.676.696 5.485 4.855 6.248 7.335zm-7.999 2.477l-10.279 3.183c.994-3.804 2.877-7.591 5.191-10.074.86-.924 2.064-1.953 3.49-2.541 1.34 2.796 1.632 6.755 1.598 9.432zm-6.6-12.784c1.138-.025 2.095.225 2.913.763-1.31.68-2.574 1.657-3.762 2.93-3.076 3.301-5.435 8.426-6.375 13.37-2.933.907-5.801 1.797-8.442 2.613 1.667-7.782 8.19-19.46 15.666-19.676z", fill: "#95BF47" },
      { d: "M76.793 18.943c-.363-.03-7.482-.139-7.482-.139s-5.954-5.782-6.542-6.37c-.22-.219-.516-.333-.827-.38l.003 88.443 26.68-6.63S77.74 20.263 77.67 19.758c-.07-.504-.513-.785-.877-.815z", fill: "#5E8E3E" },
      { d: "M47.152 32.662l-3.099 11.594s-3.456-1.573-7.554-1.315c-6.01.38-6.073 4.17-6.012 5.121.327 5.186 13.969 6.318 14.734 18.463.602 9.555-5.068 16.092-13.239 16.608-9.807.618-15.206-5.166-15.206-5.166l2.078-8.84s5.435 4.101 9.785 3.827c2.841-.18 3.856-2.492 3.754-4.126-.428-6.764-11.536-6.364-12.238-17.478-.59-9.352 5.552-18.83 19.104-19.684 5.221-.336 7.893.996 7.893.996z", fill: "#fff" },
    ],
  },
  /**
   * Whop — from Whop's own press SVG, supplied by the owner 16 Sep 2026.
   *
   * The file he sent is the ON-DARK variant: every path is `#FFFFFF`, which
   * is invisible on this product's light cards. It is a single-colour mark,
   * so it is PAINTED with Whop's own `#FF6243` from the catalogue — the same
   * mark, on the ground it actually stands on.
   */
  whop: {
    viewBox: "0 0 383.2 196.4",
    paths: [
      { d: "M60.9,0C35.7,0,18.4,11.1,5.2,23.5c0,0-5.3,5-5.2,5.2l55.2,55.2l55.2-55.2C99.9,14.3,80.2,0,60.9,0z", fill: "currentColor" },
      { d: "M197.2,0c-25.2,0-42.5,11.1-55.7,23.5c0,0-4.8,4.9-5.1,5.2L68.2,96.9l55.1,55.1L246.6,28.7 C236.1,14.3,216.5,0,197.2,0z", fill: "currentColor" },
      { d: "M333.8,0c-25.2,0-42.5,11.1-55.7,23.5c0,0-5,4.9-5.2,5.2L136.4,165.2l14.4,14.4c22.3,22.3,58.9,22.3,81.3,0 L383,28.7h0.2C372.8,14.3,353.1,0,333.8,0z", fill: "currentColor" },
    ],
  },
});
