import { describe, it, expect } from "vitest";
import { boardHref } from "@/lib/board/href";

/**
 * WHICH FILTERS RIDE ALONG WITH A LINK TO THE BOARD.
 *
 * The dashboard page spelled this rule once, inside a `qs()` closure, and the
 * rail spelled it again by hand as a template string — `/dashboard?view=${id}`,
 * carrying neither the range nor the source. So a view opened from the tab
 * strip kept the window you were looking at and the SAME view opened from the
 * rail two inches to the left threw you back to "Last 7 days". Two copies of
 * one rule is how that happened, and one function is why it cannot happen
 * again.
 */
describe("a link to the board", () => {
  it("carries the window, the source and the view", () => {
    expect(boardHref({ range: "30d", source: "conn_1", view: "v_1" })).toBe(
      "/dashboard?range=30d&source=conn_1&view=v_1",
    );
  });

  it("keeps the window on a link that only changes the view", () => {
    // The whole bug, as one assertion: switching view must not drop `range`.
    expect(boardHref({ range: "2026-08-03..2026-08-14", view: "v_2" })).toBe(
      "/dashboard?range=2026-08-03..2026-08-14&view=v_2",
    );
  });

  it("omits what it was not given rather than writing it empty", () => {
    /**
     * `?view=` with nothing after it is the DEFAULT board, and the page reads
     * it as "no view" — but it is still a param the customer sees, and an
     * empty `source=` would narrow the board to a connection with no id. Both
     * are left out entirely.
     */
    expect(boardHref({ range: "7d" })).toBe("/dashboard?range=7d");
    expect(boardHref({ range: "7d", source: "", view: "" })).toBe("/dashboard?range=7d");
    expect(boardHref({ range: "7d", source: null, view: null })).toBe("/dashboard?range=7d");
  });

  it("is the bare board when it has nothing to carry", () => {
    // The rail is on screen away from the dashboard too, where there is no
    // window in the URL to preserve. That link is just the board.
    expect(boardHref({})).toBe("/dashboard");
  });

  it("escapes a source that needs it", () => {
    // Built through URLSearchParams rather than string concatenation, so an id
    // carrying a reserved character cannot split the query.
    expect(boardHref({ range: "7d", source: "a&b=c" })).toBe("/dashboard?range=7d&source=a%26b%3Dc");
  });
});
