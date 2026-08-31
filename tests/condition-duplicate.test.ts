import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * DUPLICATING A FILTER CONDITION.
 *
 * The case that produced it: three conditions on the SAME field with the same
 * operator and only the value differing — `willing_to_invest starts with
 * $1,000 / $2,500 / $5,000`. Built from "Add condition" that is the field and
 * the operator chosen three times out of a list that can run to forty entries,
 * when the only thing that differs is the last box.
 *
 * The insert is one expression, so it is tested as one: the same splice the
 * component runs, against the properties that matter — the copy is adjacent,
 * it is a real copy, and it shares nothing with its original.
 */
type Rule = { field: string; op: string; value: string; value2?: string; valueKind?: string; valueField?: string };

/** Exactly the expression in `ConditionEditor.duplicateRule`. */
const duplicate = (rules: Rule[], i: number): Rule[] => [...rules.slice(0, i + 1), { ...rules[i] }, ...rules.slice(i + 1)];

const rule = (over: Partial<Rule> = {}): Rule => ({
  field: "properties.willing_to_invest",
  op: "starts_with",
  value: "$1,000",
  valueKind: "fixed",
  ...over,
});

describe("where the copy lands", () => {
  it("sits directly after the condition it came from", () => {
    // A copy that appears at the bottom of a list of six is a copy you then
    // have to go and find.
    const out = duplicate([rule({ value: "a" }), rule({ value: "b" }), rule({ value: "c" })], 0);
    expect(out.map((r) => r.value)).toEqual(["a", "a", "b", "c"]);
  });

  it("works on the last condition, which is the common case", () => {
    // Building a chain of alternatives means duplicating the one just finished.
    const out = duplicate([rule({ value: "a" }), rule({ value: "b" })], 1);
    expect(out.map((r) => r.value)).toEqual(["a", "b", "b"]);
  });

  it("works on a list of one", () => {
    expect(duplicate([rule()], 0)).toHaveLength(2);
  });

  it("adds exactly one, and disturbs nothing else", () => {
    const before = [rule({ value: "a" }), rule({ value: "b" }), rule({ value: "c" })];
    const out = duplicate(before, 1);
    expect(out).toHaveLength(before.length + 1);
    // Every original object is still present, untouched and in order.
    expect(out.filter((_, i) => i !== 2)).toEqual(before);
  });
});

describe("what gets copied", () => {
  it("carries the field, the operator AND the value", () => {
    // All three, because re-entering any of them is the work this removes.
    const [, copy] = duplicate([rule()], 0);
    expect(copy).toEqual(rule());
  });

  it("carries a field-to-field comparison intact", () => {
    // `valueKind: "field"` rules compare two columns; a copy that dropped
    // `valueField` would silently become an empty fixed-value rule.
    const r = rule({ valueKind: "field", valueField: "properties.other", value: "" });
    const [, copy] = duplicate([r], 0);
    expect(copy.valueKind).toBe("field");
    expect(copy.valueField).toBe("properties.other");
  });

  it("carries the second value of a between", () => {
    const r = rule({ op: "between", value: "2026-01-01", value2: "2026-02-01" });
    expect(duplicate([r], 0)[1].value2).toBe("2026-02-01");
  });

  it("SHARES NO REFERENCE with its original", () => {
    /**
     * The bug this rules out: `[...rules, rules[i]]` — no spread — puts the
     * SAME object in twice, so editing the copy edits the original and the two
     * rows move together. It reads correctly on screen right up until somebody
     * changes one of them.
     */
    const before = [rule()];
    const out = duplicate(before, 0);
    expect(out[1]).not.toBe(out[0]);
    out[1].value = "$5,000";
    expect(out[0].value).toBe("$1,000");
    expect(before[0].value).toBe("$1,000");
  });
});

describe("the control itself", () => {
  const src = readFileSync(join(process.cwd(), "src/components/flow/controls/ConditionEditor.tsx"), "utf8");

  it("sits beside Remove, in the row that already existed", () => {
    // The two things you can do to a condition; a reader should find them in
    // one place rather than hunting a floating icon in a corner.
    const row = src.slice(src.indexOf("duplicateRule(i)") - 400, src.indexOf("Remove\n") + 20);
    expect(row).toContain("Duplicate");
    expect(row).toContain("Remove");
  });

  it("carries a word as well as a glyph", () => {
    // A bare icon beside a text link reads as a different kind of control, and
    // "copy" and "remove" are close enough in consequence that guessing between
    // them from a 12px picture is a bad trade for the space saved.
    expect(src).toMatch(/<Copy size=\{12\}/);
    expect(src).toMatch(/aria-hidden \/>\s*Duplicate/);
  });

  it("stays neutral, leaving the danger colour to Remove", () => {
    // Copying costs nothing and is trivially undone; deleting is the one act
    // on this row worth colouring.
    expect(src).toMatch(/duplicateRule\(i\)[\s\S]{0,300}hover:text-foreground/);
    expect(src).toMatch(/removeRule\(i\)[\s\S]{0,300}hover:text-danger-ink/);
  });
});
