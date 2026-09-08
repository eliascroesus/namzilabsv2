import { describe, expect, it } from "vitest";
import { GROUP_ACCENT, GROUP_COLOR_KEYS } from "@/components/flow/node-accent";
import { randomTileColour } from "@/lib/board/tile-config";
import { contrast } from "./helpers/contrast";

/**
 * THE BOARD PALETTE, RE-SOLVED FOR A GROUND THAT INVERTED.
 *
 * Every one of these hues was solved to 3.05:1 against WHITE, because a group
 * dot and a tile accent used to sit on a white card. They now sit on #191919,
 * and a solve is only ever valid against the surface it was solved for: on
 * near-black the same twelve values are the DARKEST of their hue rather than
 * the most vivid, and several read as mud.
 *
 * The keys do not move. That is the whole return on storing a palette KEY in
 * `dashboard_groups.color` instead of a hex — re-solving the ramp restyles
 * every board at once with no backfill and no migration — and this is the
 * first pass to actually spend it.
 */
const CARD = "#191919";

describe("the board palette is solved for the dark card", () => {
  it("keeps every key, in order — a dropped key silently resets a stored board", () => {
    expect(GROUP_COLOR_KEYS).toEqual([
      "grey",
      "red",
      "orange",
      "amber",
      "olive",
      "green",
      "teal",
      "cyan",
      "blue",
      "indigo",
      "violet",
      "pink",
    ]);
  });

  it("every hue clears 3:1 on the card it is drawn on", () => {
    for (const key of GROUP_COLOR_KEYS) {
      expect(contrast(GROUP_ACCENT[key], CARD), `${key} on the card`).toBeGreaterThanOrEqual(3);
    }
  });

  it("clears the bar with MARGIN, because a mark at 3:1 on near-black is one you squint at", () => {
    // The ground inverting inverts the solve. On white the bar capped how
    // LIGHT a hue could be; here it caps how DARK. A value sitting exactly on
    // 3:1 would be the darkest legal version of itself — the opposite of what
    // the white-ground rule produced.
    for (const key of GROUP_COLOR_KEYS) {
      expect(contrast(GROUP_ACCENT[key], CARD), `${key} on the card`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("is no longer the ramp that was cut for white", () => {
    expect(GROUP_ACCENT.green).not.toBe("#00AB17");
    expect(GROUP_ACCENT.blue).not.toBe("#2B95FF");
  });

  it("still spans the wheel rather than clustering", () => {
    // Eleven hues plus a neutral, spaced round the circle. If a re-solve ever
    // collapses two of them onto the same value the picker stops reading as a
    // spectrum and two columns become indistinguishable.
    const hues = GROUP_COLOR_KEYS.map((k) => GROUP_ACCENT[k].toLowerCase());
    expect(new Set(hues).size).toBe(hues.length);
  });
});

/**
 * A NEW TILE ARRIVES WEARING A COLOUR.
 *
 * Every tile used to land on the column default, `grey`, so a fresh board was
 * twelve identical grey cards and the customer had to colour each one by hand
 * before the board could be read at a glance.
 */
describe("randomTileColour", () => {
  it("never returns grey — grey is the degrade path, not a choice", () => {
    // Handing out `grey` as a CHOICE would make "unset" and "deliberately
    // grey" indistinguishable, and `grey` is what an unknown key degrades to.
    for (let i = 0; i < 200; i++) expect(randomTileColour()).not.toBe("grey");
  });

  it("only ever returns a key the palette knows", () => {
    // A key outside the map would resolve through `accentOf` to the brand
    // default and silently lose the colour it was supposed to have.
    for (let i = 0; i < 200; i++) expect(GROUP_COLOR_KEYS).toContain(randomTileColour());
  });

  it("actually varies, and reaches the whole wheel given enough draws", () => {
    const seen = new Set(Array.from({ length: 400 }, randomTileColour));
    expect(seen.size).toBe(GROUP_COLOR_KEYS.length - 1); // all but grey
  });
});
