/**
 * A FUNNEL OR A PIE BUILT OUT OF METRICS THE BOARD ALREADY HAS.
 *
 * The board holds every published tile in memory before any of this runs —
 * `publishedFlowTiles` selects them and `page.tsx` maps them into `flowByKey` —
 * so composing a chart from several of them costs a `Map.get` per member and
 * nothing else: no query, no flow run, no widened select, no stored bytes
 * beyond the list of keys in the tile's own config. That is the entire reason
 * this file exists instead of an engine node that materializes a grouped
 * metric into a jsonb column every viewer reads on every render.
 *
 * WHY THE REFUSALS LIVE HERE AND NOT IN THE RENDERER. Every rule below is a
 * pure function of numbers and stamps, returning a SENTENCE. Written as JSX
 * branches they would be unreachable to a test — and this repo's standing note
 * is that its checks degrade to "no match = pass" exactly when a union widens,
 * which is what adding a chart to a legality rule does. A rule that returns a
 * string can be asserted red before it is made green.
 *
 * WHAT THIS CANNOT KNOW, AND THEREFORE SAYS OUT LOUD. Two failures are
 * undetectable from anything stored:
 *
 *   A COMPOSED FUNNEL IS NOT A COHORT. Each stage is an independent metric
 *   counted over the same window — nobody is followed from one stage to the
 *   next — so a subject can appear in two stages and a later stage can exceed
 *   an earlier one. (The CLASSIC funnel has always had this property:
 *   `computeFunnel` issues one independent `count(distinct subject)` per stage
 *   with no sequencing. This does not make the board less honest; it makes an
 *   existing imprecision visible.)
 *
 *   A COMPOSED PIE ASSUMES ITS PARTS DO NOT OVERLAP. "Total Leads" with parts
 *   "Ads Leads" and "Booked Leads" is arithmetically indistinguishable from a
 *   real partition — both sum to less than the whole — and `pieSlices` closes
 *   the circle at 100% either way. Only the author knows which they built.
 *
 * Neither can be refused, so neither is left to a caveat somebody might hide:
 * both come back in `notes`, which the tile renders every time.
 */
import { funnelFromCounts, type FunnelResult } from "@/lib/metrics/funnel";
import { countsThings } from "@/lib/board/tile-config";

/**
 * WHAT A MEMBER IS MEASURED IN — deliberately looser than the renderer's
 * `ChartFormatBag`.
 *
 * This module only ever COMPARES these fields; it never formats anything. Tying
 * it to the render bag would drag a presentation type into a file of arithmetic
 * and force every caller to have already narrowed a stored jsonb string into the
 * format union before it could ask a question about honesty.
 */
export type MemberUnits = {
  format?: string;
  currency?: string;
  unit?: string;
};

/**
 * ONE MEMBER OF A COMPOSITION — the anchor at index 0, then the parts in the
 * author's stored order.
 *
 * Resolved on the server, where `flowByKey` lives, and carried on the wire per
 * part: a label, six-or-seven numbers, and the few facts the rules below ask
 * about. Deliberately NOT the whole tile — a tile carries its series, its
 * groups and its byDay, and none of that is ever drawn for a part.
 */
export type ComposeMember = {
  /** The metric's own name, as it appears on its own tile. */
  label: string;
  /** This member's figure for the ACTIVE range. Null is "cannot answer", never zero. */
  value: number | null;
  /**
   * Undefined means NOT RESTAMPED YET, and it earns a different sentence from
   * `false`. See `TileFacts.countable`.
   */
  countable?: boolean;
  additive?: boolean;
  /** False for a row written before `byRange` existed — it can only answer all-time. */
  hasPeriods: boolean;
  /** Which date field windows this metric. Members that disagree are disclosed. */
  timeField?: string | null;
  /** This member's OWN units. Never the anchor's — see `unitsAgree`. */
  format: MemberUnits;
};

export type Refusal = { refusal: string };
export type ComposedFunnel = { result: FunnelResult; notes: string[] };
export type ComposedPie = {
  groups: Array<{ label: string; value: number }>;
  notes: string[];
  /**
   * THE CIRCLE'S OWN TOTAL, AND THE CARD'S HEADLINE MUST BE IT.
   *
   * Reported since 12 Sep 2026, when the whole stopped being the anchor and
   * became the sum of the slices. Without it the tile headlined its own metric —
   * 420 — above a circle that adds up to 800, which is the "two different totals
   * on one card" the residual arithmetic used to exist to prevent. The old model
   * got this for free: the anchor WAS the whole.
   */
  whole: number;
};

const isRefusal = (v: unknown): v is Refusal => typeof v === "object" && v != null && "refusal" in v;
export { isRefusal };

/** "Ads Leads, Organic Leads and Booked Leads" — a list a sentence can hold. */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * WHAT A MEMBER IS MEASURED IN — the check that stops the currency lie.
 *
 * `custom-tile.tsx` builds ONE format bag, from the anchor, and hands it to the
 * mark. Left alone, a composed pie whose whole is "Revenue" (USD) and whose
 * part is "Deals Closed" (37) prints that slice as **$37** — in the legend, in
 * the tooltip and in the screen-reader line. `tile-config.ts` refuses a
 * `currency` config key for exactly this reason, in as many words: "a $12,400
 * metric restyled EUR would print €12,400 — a confidently wrong number of
 * exactly the kind this feature exists to eliminate." Composition would have
 * reintroduced it through the back door.
 *
 * `durationDisplay` is not compared: it is a display choice, and a duration
 * cannot be a member anyway (it is not `countable`).
 */
/**
 * THE ONE STRING THAT SAYS WHETHER TWO METRICS ARE MEASURED ALIKE.
 *
 * Exported because the PICKER needs the same answer the renderer reaches: a
 * parts list that offers dollars beside counts is a list whose next press is a
 * refusal, and the fix is for both to key on the same three fields rather than
 * for the list to approximate this in its own words.
 *
 * `format` falls back to "number" because `custom-tile.tsx` does — a legacy
 * tile with no stored format draws as a plain number, and a picker that read it
 * as a fourth kind would bar it from a chart it renders perfectly well.
 */
export function unitsKey(format: MemberUnits): string {
  return `${format.format ?? "number"}|${format.currency ?? ""}|${format.unit ?? ""}`;
}

function unitsAgree(members: ComposeMember[]): boolean {
  return new Set(members.map((m) => unitsKey(m.format))).size === 1;
}

/**
 * THE RULES BOTH CHARTS SHARE, in the order a reader can act on.
 *
 * Ordering is a UX decision, not an implementation detail. "Press Refresh all"
 * comes before "this metric is the wrong kind", because a stale stamp is a
 * temporary state with a button attached and being told the wrong thing about
 * your metric while it heals is worse than waiting. Structural complaints come
 * before per-period ones, because "a stage has no number in this period" reads
 * as a data problem and must not be printed over what is really a setup problem.
 */
function refuseShared(
  members: ComposeMember[],
  noun: string,
  /**
   * DOES THIS CHART COUNT THINGS, or does it only put them side by side?
   *
   * A funnel and a pie both do arithmetic ACROSS their members — a conversion
   * divides one by the next, a share divides one by the sum — so a duration or a
   * ratio among them is nonsense and is refused below. RANKED BARS do no
   * arithmetic at all: each bar is one metric's own figure drawn at its own
   * length, so "Speed to Lead (Felix)" beside "Speed to Lead (Rasmus)" is a
   * perfectly good chart and refusing it would be this rule fired out of habit.
   *
   * Everything else in here still applies to all three, because it is about the
   * members being COMPARABLE rather than about them being summable: a unit they
   * share, a period they were all computed for, and names that tell them apart.
   */
  { tally = true }: { tally?: boolean } = {},
): Refusal | null {
  const unstamped = members.filter((m) => m.countable === undefined);
  if (unstamped.length > 0) {
    return {
      refusal: `${nameList(unstamped.map((m) => m.label))} ${unstamped.length === 1 ? "hasn’t" : "haven’t"} been recomputed since this became possible — press Refresh all above.`,
    };
  }

  /**
   * A FUNNEL COUNTS THINGS. Both renderers hardcode `{format:"number"}` —
   * `funnel-view.tsx` and `pipeline.tsx` each call `formatMetricValue(count,
   * {format:"number"})` — so a duration member does not merely mismatch, its
   * UNIT IS DISCARDED: 252 minutes prints as "252" beside "420" leads and reads
   * as a count of people, with `conversionFromPrev` dividing one by the other
   * and a red drop-off pill over the pair. This board's own metrics include a
   * duration ("Speed to Lead") and a ratio ("Booked/Total Leads"), so it is the
   * first composition somebody will try.
   */
  const wrongKind = tally ? members.filter((m) => m.countable === false) : [];
  if (wrongKind.length > 0) {
    const m = wrongKind[0];
    const what = m.format.format === "duration" ? "a length of time" : "not a tally of things";
    return { refusal: `${noun} counts things; ${m.label} is ${what}.` };
  }

  /**
   * A ROW WITH NO `byRange` AT ALL answers every period with its all-time
   * figure — `custom-tile.tsx` and `tileValueForRange` both fall back that way,
   * deliberately, so a single legacy tile keeps working. That fallback is safe
   * for ONE tile answering for itself and unsafe the moment it is mixed: a
   * funnel whose stage 1 is all-time and whose stage 2 is last-7-days is
   * internally inconsistent with nothing on screen to say so, because both
   * answers are perfectly good numbers.
   */
  const legacy = members.filter((m) => !m.hasPeriods);
  if (legacy.length > 0) {
    return { refusal: `${nameList(legacy.map((m) => m.label))} has never been computed for a period — press Refresh all above.` };
  }

  if (!unitsAgree(members)) {
    return { refusal: "These metrics are measured in different units, so they can’t be drawn together." };
  }

  const labels = members.map((m) => m.label);
  if (new Set(labels).size !== labels.length) {
    return { refusal: "Two of these metrics have the same name — rename one so they can be told apart." };
  }

  return null;
}

/**
 * Disclosures that apply however the numbers come out. Always rendered; never
 * suppressed by a setting, because the thing each one discloses cannot be
 * detected and so cannot be refused.
 */
function sharedNotes(members: ComposeMember[]): string[] {
  const notes: string[] = [];
  /**
   * EACH METRIC PICKS ITS OWN DATE FIELD. `resolveTimeField` returns the
   * metric's `timeField` when any record in the lane can be dated by it, so
   * "Last 30 days" can mean created_at on one stage and booked_at on the next —
   * and part of the drop between them is then a calendar artifact rather than
   * anything that happened. The fields are stored on the tiles, so this is
   * knowable; it is just not fixable.
   */
  const fields = [...new Set(members.map((m) => m.timeField).filter((f): f is string => !!f))];
  if (fields.length > 1) notes.push(`These metrics are dated by different fields (${fields.join(", ")}).`);
  return notes;
}

/**
 * A FUNNEL FROM THE ANCHOR AND ITS PARTS. `members[0]` is stage 1.
 *
 * `slot` is the chart's `PARTS_SLOT` row. The maximum is re-checked HERE and
 * not only in the panel, because switching a composed funnel to a pie changes
 * the chart column and nothing else: `honoured()` keeps `parts` (the pie's row
 * lists it) and a 7-part array walks straight past a cap that was only ever
 * enforced while adding.
 */
export function composeFunnel(members: ComposeMember[], slot: { min: number; max: number }): Refusal | ComposedFunnel {
  const parts = members.length - 1;
  if (parts < slot.min) {
    return { refusal: `Add at least ${slot.min === 1 ? "one more stage" : `${slot.min} stages`} in the tile’s settings.` };
  }
  if (parts > slot.max) {
    return { refusal: `A funnel shows at most ${slot.max + 1} stages — remove some in the tile’s settings.` };
  }

  const shared = refuseShared(members, "A funnel");
  if (shared) return shared;

  /**
   * ZERO AND MISSING MUST NEVER RENDER IDENTICALLY. A count metric on a quiet
   * day is 0 — measured. A null is "this tile cannot answer for this period",
   * which is a different fact and would otherwise draw as an honest-looking
   * empty stage.
   */
  const blank = members.filter((m) => m.value == null);
  if (blank.length > 0) {
    return { refusal: `${nameList(blank.map((m) => m.label))} has no number in this period.` };
  }

  const counts = members.map((m) => ({ label: m.label, count: m.value as number }));

  /**
   * A ZERO FIRST STAGE DRAWS A FUNNEL THAT CONTRADICTS ITS OWN LABELS. Every
   * conversion guard yields 0, `stageWidths` returns its 4% floor for every
   * stage and `FunnelView`'s own width falls to the 2% minimum — so 0 -> 37 -> 12
   * draws three identical stubs, each captioned "0% from prev", while the
   * numbers printed beside them say otherwise. Not exotic: any count metric is
   * zero under the "Today" pill before the day's first record lands.
   */
  if (counts[0].count <= 0) {
    return { refusal: "The first stage is zero in this period, so there’s nothing for the later stages to be a share of." };
  }

  const result = funnelFromCounts(counts);
  /**
   * SHORT BECAUSE IT IS ALWAYS ON. These sentences are never suppressible, so
   * every word costs a line of the mark's own height on a narrow tile — a
   * three-stage funnel carrying two notes was squeezing its bars into a
   * scroller. The claim is unchanged; the clauses that could be inferred are
   * gone.
   */
  const notes = ["Stages are counted separately over this period, not followed as a cohort.", ...sharedNotes(members)];
  /**
   * THE "…IS LARGER THAN THE FIRST STAGE, SO ITS BAR IS CAPPED" NOTE IS GONE,
   * because the thing it apologised for is gone.
   *
   * Stage widths were a share of the FIRST stage, clamped at 100, so a bigger
   * stage drew pixel-identical to one at exactly 100% and the sentence was the
   * only thing telling the reader otherwise. `stageWidths` now measures against
   * the LARGEST stage, which is self-clamping: a stage that rose is simply the
   * longest bar, with a hairline marking where the stage above it ended. A
   * caveat that retracts the encoding was always a bug report about the mark,
   * and the mark has been fixed.
   */
  return { result, notes };
}

/**
 * A PIE WHERE THE ANCHOR IS THE WHOLE AND THE PARTS ARE NAMED SLICES.
 *
 * THE ANCHOR IS NOT A SLICE. That is the difference from the funnel and it is
 * deliberate: the sixth slice is the arithmetic RESIDUAL, `whole - sum(parts)`,
 * labelled so. This is the UK Government Statistical Service's rule taken
 * literally — you may combine categories, never remove one from the whole — and
 * it means the slices tile the whole by construction rather than by trust. The
 * board's own metrics already have this shape: Ads Leads + Organic Leads
 * against Total Leads.
 */
export function composePie(
  members: ComposeMember[],
  slot: { min: number; max: number },
): Refusal | ComposedPie {
  const parts = members.length - 1;
  if (parts < slot.min) {
    /* Pluralised, because the floor dropped to 1 on 12 Sep 2026 and "at least 1
       parts" is the kind of copy that makes a product look unfinished. */
    return {
      refusal:
        slot.min === 1
          ? "A pie needs at least one other metric to divide the circle with — add one in the tile’s settings."
          : `A pie needs at least ${slot.min} parts — add them in the tile’s settings.`,
    };
  }
  if (parts > slot.max) {
    return { refusal: `A pie shows at most ${slot.max} parts — remove some in the tile’s settings.` };
  }

  const shared = refuseShared(members, "A pie");
  if (shared) return shared;

  /**
   * SHARES HAVE TO ADD UP, AND `facts.kind` CANNOT SAY WHETHER THEY DO.
   * `engine.ts` spells it out: kind is "count" for sum, avg, median, min, max
   * and count_distinct alike. So without this stamp a pie whose whole is "Avg
   * Deal Size" ($8,400) and whose part is "Avg Deal Size, SMB" ($2,200) passes
   * every other rule here and draws a confident 74% "Other" slice of an
   * average. `count_distinct` fails too, and less obviously: it is a perfectly
   * good funnel stage but a subject appearing in two slices is counted twice,
   * so the parts overrun the whole by exactly the overlap.
   */
  const notAdditive = members.filter((m) => m.additive === false);
  if (notAdditive.length > 0) {
    return { refusal: `Shares have to add up, and ${nameList(notAdditive.map((m) => m.label))} can’t be added.` };
  }

  const blank = members.filter((m) => m.value == null);
  if (blank.length > 0) {
    return { refusal: `${nameList(blank.map((m) => m.label))} has no number in this period.` };
  }

  /**
   * THE WHOLE IS THE SUM OF WHAT IS DRAWN — the owner's ruling of 12 Sep 2026:
   * "it should just calculate all the steps together as the whole and then just
   * divide evenly".
   *
   * IT USED TO BE THE ANCHOR. The tile's own metric was "the whole" and the
   * parts were shares OF it, with the leftover appended as a grey "Other" and a
   * refusal when the parts overran. That is a legitimate pie and it is not the
   * one people were building: it needs a metric that genuinely contains the
   * others, and every time it was handed three sibling counts instead — "Total
   * Leads", "Booked Leads", "Organic Leads" — it either drew a fictional
   * remainder or refused outright. Asking for a breakdown and being told the
   * parts add up to more than the whole is the tool arguing with a question it
   * was not asked.
   *
   * SO EVERY MEMBER IS A SLICE, the anchor included, and the circle is their
   * total. There is no remainder to invent and no overrun to refuse, because a
   * sum cannot exceed itself.
   *
   * WHAT THIS GIVES UP, SAID PLAINLY. A share is now a share of the parts NAMED,
   * not of any independently-known total — so leaving one out silently inflates
   * every other slice, where the old shape would have shown the gap as "Other".
   * The disclosure below replaces that guarantee with a sentence, which is the
   * honest trade rather than a free one.
   */
  const slices = members.map((m) => ({ label: m.label, value: m.value as number }));

  const negative = slices.filter((s) => s.value < 0);
  if (negative.length > 0) {
    return { refusal: `${nameList(negative.map((s) => s.label))} is below zero, which isn’t a share of anything.` };
  }

  const whole = slices.reduce((a, s) => a + s.value, 0);
  if (whole <= 0) return { refusal: "Everything here is zero in this period, so there are no shares to draw." };

  /**
   * Short for the same reason the funnel's is — see its note.
   *
   * THE SENTENCE CHANGED WITH THE ARITHMETIC. It used to explain what "Other"
   * was; there is no "Other" now, and the thing a reader can no longer verify
   * for themselves is that these slices are the WHOLE story and do not double
   * count. Both halves matter: a metric left out is invisible (every drawn share
   * is inflated to fill the circle), and two slices counting the same subject
   * inflate the total the same way. The old shape could at least show a gap.
   */
  const notes = [`Shares are of these ${slices.length} metrics added together, which are assumed not to overlap.`, ...sharedNotes(members)];

  /**
   * A PART THAT IS LEGITIMATELY ZERO VANISHES FROM THE DRAWING — `pieSlices`
   * keeps only `value > 0`, so the author's named category disappears from the
   * circle AND from the legend with no trace. The same doctrine the funnel
   * applies to a missing stage applies here: say it rather than let a named
   * thing go quietly missing.
   */
  const zeroed = slices.filter((s) => s.value === 0);
  if (zeroed.length > 0) {
    notes.push(`${nameList(zeroed.map((s) => s.label))} is zero in this period, so it isn’t drawn.`);
  }

  /**
   * NO RESIDUAL TO APPEND. `pieSlices` computes every share against the sum of
   * what it is handed, and that sum is now exactly the whole this function
   * reported — so the circle closes at 100% by construction rather than by a
   * remainder made to fit. The "Other"/"Unaccounted" slice and the arithmetic
   * that produced it are gone with the anchor-as-whole rule above.
   */
  return { groups: slices, notes, whole };
}

export type ComposedRanked = { groups: Array<{ label: string; value: number }>; notes: string[] };

/**
 * SEVERAL METRICS SIDE BY SIDE — the composition that does no arithmetic across
 * its members at all.
 *
 * A funnel says these are stages of one journey; a pie says these are parts of
 * one whole. Both are CLAIMS, and most of this file exists to stop a drawing
 * making one it cannot support. This chart claims nothing beyond "here are these
 * numbers, drawn to one scale" — so it has the fewest ways to lie, and
 * correspondingly the fewest refusals.
 *
 * WHICH IS WHY IT TAKES DURATIONS AND RATIOS. `refuseShared`'s tally rule is
 * skipped (see its own note): nothing here is divided by anything, so "Speed to
 * Lead" per rep is exactly the chart somebody wants, and the funnel's refusal
 * would be a rule applied past its reason. What it still insists on is ONE UNIT
 * — bars share an axis, and a chart mixing dollars with counts draws two scales
 * as one and invites the comparison it cannot support.
 *
 * NO ORDER IMPOSED HERE. `BarsHorizontal` ranks by value and the tile's own
 * `sort` overrides it; this returns the author's stored order and lets
 * presentation be presentation.
 */
export function composeRanked(
  members: ComposeMember[],
  slot: { min: number; max: number },
): Refusal | ComposedRanked {
  const parts = members.length - 1;
  if (parts < slot.min) {
    return { refusal: "Add another metric to rank this one against, in the tile’s settings." };
  }
  if (parts > slot.max) {
    return { refusal: `Ranked bars show at most ${slot.max + 1} metrics — remove some in the tile’s settings.` };
  }

  // `countsThings` rather than a literal `false`: the picker reads the same
  // fact to decide what to OFFER, and the two spent a release disagreeing.
  const shared = refuseShared(members, "Ranked bars", { tally: countsThings("ranked") });
  if (shared) return shared;

  const blank = members.filter((m) => m.value == null);
  if (blank.length > 0) {
    return { refusal: `${nameList(blank.map((m) => m.label))} has no number in this period.` };
  }

  const groups = members.map((m) => ({ label: m.label, value: m.value as number }));

  /**
   * A NEGATIVE BAR NEEDS AN AXIS THAT CROSSES ZERO, and `BarsHorizontal` draws
   * from a zero baseline rightward. Handed one it clamps the width to nothing —
   * so the metric would be in the list, in the tooltip and in the screen-reader
   * line, and simply absent from the drawing. Refusing says the true thing;
   * a zero-length bar for -40 is the silent kind of wrong this file exists to
   * prevent.
   */
  const negative = groups.filter((g) => g.value < 0);
  if (negative.length > 0) {
    return { refusal: `${nameList(negative.map((g) => g.label))} is below zero, which these bars can’t draw.` };
  }

  /**
   * NO COHORT NOTE AND NO OVERLAP NOTE, because neither failure is available
   * here. Members that double-count each other break a sum and a sequence; two
   * bars counting the same subject are just two true figures. Only the shared
   * disclosures apply — the ones about the members being comparable at all.
   */
  return { groups, notes: sharedNotes(members) };
}
