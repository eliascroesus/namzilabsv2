import { describe, it, expect } from "vitest";
import { brandNeedsDarkInk } from "@/components/flow/controls/source-style";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";

/**
 * WHITE INITIALS ON A YELLOW CIRCLE ARE AN EMPTY CIRCLE.
 *
 * Thirty-one connectors carry the vendor's own colour on a 24px disc holding
 * two letters. Mailchimp's #FFE01B measures 1.26:1 against white — the mark
 * renders as a blank yellow dot, which is worse than no mark at all because it
 * reads as something still loading.
 */
const contrast = (hex: string, ink: "white" | "black") => {
  const ch = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2);
  const other = ink === "white" ? 1 : 0;
  const [hi, lo] = l > other ? [l, other] : [other, l];
  return (hi + 0.05) / (lo + 0.05);
};

describe("ink on a connector's brand mark", () => {
  /**
   * THE INVARIANT, AND THE ONLY ASSERTION HERE THAT CANNOT GO STALE.
   *
   * Everything below it is a fixed list, and a fixed list is exactly what falls
   * behind when connector thirty-two arrives in a pale orange. This walks the
   * catalogue and asserts the OUTCOME: whatever ink the function picks clears
   * 4.5:1 on every mark the product actually ships.
   *
   * It is also what caught the first version. At a hand-picked threshold of
   * 0.45 this listed ten offenders — Close, Whop, Google Sheets, Aircall and
   * six more — all of them handed white ink at 2.7-3.7:1 where black would have
   * given 5.7-8.0:1.
   */
  it("picks an ink that clears 4.5:1 on every connector in the catalogue", () => {
    const short: string[] = [];
    for (const entry of CONNECTOR_CATALOG) {
      if (!entry.brand) continue;
      const ink = brandNeedsDarkInk(entry.brand.color) ? "black" : "white";
      const r = contrast(entry.brand.color, ink);
      if (r < 4.5) short.push(`${entry.name} ${entry.brand.color} → ${ink} ${r.toFixed(2)}:1`);
    }
    expect(short).toEqual([]);
  });

  /**
   * …AND WHY IT CANNOT FAIL FOR A COLOUR NOBODY HAS ADDED YET. 0.179 is the
   * luminance where white and black are exactly equally legible, so the LIGHTER
   * of the two is never worse than 4.58:1 on any colour in the sRGB cube. This
   * samples the cube rather than the catalogue, which is the difference between
   * "the connectors we have are fine" and "the rule is sound".
   */
  it("clears 4.5:1 on every colour, not only the ones we ship", () => {
    const worst = { hex: "", r: Infinity };
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
          const c = contrast(hex, brandNeedsDarkInk(hex) ? "black" : "white");
          if (c < worst.r) {
            worst.hex = hex;
            worst.r = c;
          }
        }
      }
    }
    expect(worst.r, `worst colour was ${worst.hex}`).toBeGreaterThanOrEqual(4.5);
  });

  it("calls for dark ink on the yellows", () => {
    // The four that provoked this: Mailchimp, Tally, Airtable, Retell AI.
    for (const hex of ["#FFE01B", "#FDDD35", "#FCB400", "#F5A623"]) {
      expect(brandNeedsDarkInk(hex), hex).toBe(true);
    }
  });

  it("leaves white ink on the deep blues, violets and near-blacks", () => {
    for (const hex of ["#0D0D0D", "#635BFF", "#7C3AED", "#24489F"]) {
      expect(brandNeedsDarkInk(hex), hex).toBe(false);
    }
  });

  it("is case-insensitive about the hex and tolerates a missing #", () => {
    expect(brandNeedsDarkInk("#ffe01b")).toBe(true);
    expect(brandNeedsDarkInk("FFE01B")).toBe(true);
  });

  it("falls back to white ink on anything it cannot read", () => {
    // A short hex, a CSS name or junk is not worth throwing over — the neutral
    // fallback mark in `sourceStyle` is #64748B, where white is right.
    for (const bad of ["", "#fff", "rebeccapurple", "#12345", "#gggggg"]) {
      expect(brandNeedsDarkInk(bad), bad).toBe(false);
    }
  });
});
