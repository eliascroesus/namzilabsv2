import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * THE TWO REMOVE BUTTONS, AND THE ROW THEY BOTH LIVE ON.
 *
 * Disconnect and Delete sit next to each other on a list whose rows are stacked
 * directly on top of one another. One is reversible and one destroys everything
 * the connection ever synced, so the ways they can be confused are the thing
 * worth testing — not the styling.
 */

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("next/link", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  default: (props: any) => createElement("a", { href: props.href, className: props.className }, props.children),
}));
// The row imports server actions, which reach for the database and `server-only`
// the moment they are loaded. Nothing here submits a form; what is under test is
// what the row OFFERS.
vi.mock("@/app/integrations/actions", () => ({
  renameConnectionAction: async () => ({ ok: true }),
  disconnectAction: async () => {},
  reconnectAction: async () => {},
  deleteConnectionAction: async () => {},
}));

import { ConnectionRow } from "@/app/integrations/ConnectionRow";

const row = (over: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(ConnectionRow, { id: "c1", name: "Sales sheet", source: "gsheets", status: "active", ...over } as never),
  );

describe("both ways to remove an integration are offered", () => {
  it("an active row offers disconnect AND permanent delete, and says which is which", () => {
    const html = row();
    // Not "there are two buttons" — that passes with two identical ones. What
    // matters is that each says what it does before it is pressed, because the
    // icons alone cannot carry "reversible" versus "gone".
    expect(html).toContain("Disconnect Sales sheet");
    expect(html).toContain("stops syncing, keeps your data, reversible");
    expect(html).toContain("Delete Sales sheet permanently");
    expect(html).toContain("removes the connection and all its data");
  });

  /**
   * A disconnected row is exactly where somebody goes to finish getting rid of
   * an integration. Without the delete here the only route to it is to reconnect
   * first — turning the data back on in order to destroy it.
   */
  it("a disconnected row still offers permanent delete, alongside reconnect", () => {
    const html = row({ status: "disabled" });
    expect(html).toContain("Reconnect");
    expect(html).toContain("Delete Sales sheet permanently");
  });
});

describe("the delete panel is reachable from every row that shows the button", () => {
  /**
   * THE BUG THIS PINS. The confirmation panel and the disconnected-row layout are
   * both early returns from one component, and the delete button appears on both
   * kinds of row. Order them the other way round and clicking Delete on a
   * DISCONNECTED integration sets the state and then renders the ordinary row
   * anyway: the button does nothing, on half the rows it appears on, with no
   * error. That is the silent-nothing-happened class, and it is invisible to a
   * render test because the initial render cannot reach the panel.
   *
   * So it is asserted structurally. Brittle to a rewrite of the component, which
   * is the point — a rewrite is precisely when this gets reintroduced.
   */
  it("the deleting branch returns before the disconnected-row branch", () => {
    const src = readFileSync("src/app/integrations/ConnectionRow.tsx", "utf8");
    const deleting = src.indexOf("if (deleting) {");
    const disabled = src.indexOf('if (status === "disabled") {');
    expect(deleting, "the `if (deleting)` branch has been renamed or removed").toBeGreaterThan(-1);
    expect(disabled, "the disconnected-row branch has been renamed or removed").toBeGreaterThan(-1);
    expect(
      deleting,
      "the disconnected-row branch returns first, so Delete on a disconnected row renders nothing",
    ).toBeLessThan(disabled);
  });
});
