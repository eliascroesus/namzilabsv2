import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readNodeClipboard, writeNodeClipboard } from "@/components/flow/node-clipboard";

/**
 * THE STEP CLIPBOARD — one node carried between flows.
 *
 * These cover the half that is pure: what is written, what survives a round
 * trip, and what is refused. Where a pasted node LANDS is `duplicateWiring`'s
 * job and is already pinned in flow-canvas-utils.test.ts — paste calls the
 * same function rather than inventing a second placement rule, which is the
 * whole reason a pasted step wires up like a duplicated one.
 */

const KEY = "namzilabs.flow.node-clipboard";

/** A throwaway localStorage — jsdom's is not guaranteed across files. */
function installStorage(impl?: Partial<Storage>) {
  const data = new Map<string, string>();
  const store: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
    ...impl,
  } as Storage;
  vi.stubGlobal("localStorage", store);
  // `window` is what the module actually reads.
  vi.stubGlobal("window", { localStorage: store, dispatchEvent: () => true, CustomEvent: class {} } as unknown as Window);
  return data;
}

beforeEach(() => installStorage());
afterEach(() => vi.unstubAllGlobals());

const payload = {
  type: "filter",
  label: "Paid only",
  config: { filters: { combinator: "all", rules: [{ field: "status", op: "contains", value: "paid" }] } },
  title: "Filter",
  fromFlowId: "flow_a",
};

describe("the step clipboard", () => {
  it("round-trips a copied step, settings and all", () => {
    expect(writeNodeClipboard(payload)).toBe(true);
    const got = readNodeClipboard()!;
    expect(got.type).toBe("filter");
    expect(got.title).toBe("Filter");
    expect(got.label).toBe("Paid only");
    expect(got.config).toEqual(payload.config);
  });

  it("stamps a version and a time, so an old payload can be recognised later", () => {
    writeNodeClipboard(payload);
    const got = readNodeClipboard()!;
    expect(got.v).toBe(1);
    expect(typeof got.at).toBe("number");
  });

  it("returns null when nothing has been copied", () => {
    expect(readNodeClipboard()).toBeNull();
  });

  it("refuses a payload from a version it does not understand", () => {
    // The real case: a browser holding a payload written by an older build.
    // Half-reading it into a node nobody can explain is worse than no paste.
    localStorage.setItem(KEY, JSON.stringify({ v: 99, type: "filter", title: "Filter", config: {} }));
    expect(readNodeClipboard()).toBeNull();
  });

  it("refuses a payload missing the fields a paste depends on", () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, type: "filter" }));
    expect(readNodeClipboard()).toBeNull();
  });

  it("survives corrupt JSON rather than throwing into the canvas", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readNodeClipboard()).toBeNull();
  });

  it("reports failure instead of throwing when the browser blocks site data", () => {
    // Safari in private mode THROWS on setItem — a canvas that let that
    // escape would take the whole builder down on a menu click.
    installStorage({
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(writeNodeClipboard(payload)).toBe(false);
  });

  it("reads null rather than throwing when the browser blocks reads", () => {
    installStorage({
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(readNodeClipboard()).toBeNull();
  });
});
