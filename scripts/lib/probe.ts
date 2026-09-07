/**
 * The live-prober harness. A prober prints MEASUREMENTS and asserts only
 * comparisons between responses it made itself; a human reads the output and
 * decides (docs/CONNECTOR_SPEC_PROPOSAL.md §1.5). PASS/FAIL lines feed the
 * verify-providers workflow's summary table.
 */
export type Probe = {
  check(name: string, ok: boolean, observed: string): void;
  note(name: string, observed: string): void;
  skip(name: string, why: string): void;
  head(title: string): void;
  section<T>(label: string, fn: () => Promise<T>): Promise<T | null>;
  /** Print the summary and exit: 0 when nothing failed, 1 otherwise. */
  report(): never;
  /** Requests made through attemptJson. */
  count(): number;
  /** Count one request made outside attemptJson. */
  bump(): void;
};

export function createProbe(label: string): Probe {
  const failures: string[] = [];
  const findings: string[] = [];
  let requests = 0;
  const probe: Probe = {
    check(name, ok, observed) {
      console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}\n         observed: ${observed}`);
      if (!ok) failures.push(name);
    },
    note(name, observed) {
      console.log(`  [INFO] ${name}\n         observed: ${observed}`);
      findings.push(`${name}: ${observed}`);
    },
    skip(name, why) {
      console.log(`  [SKIP] ${name}\n         reason: ${why}`);
      findings.push(`${name} SKIPPED: ${why}`);
    },
    head(title) {
      console.log(`\n${"─".repeat(72)}\n${title}\n${"─".repeat(72)}`);
    },
    async section(label, fn) {
      try {
        return await fn();
      } catch (e) {
        probe.check(`${label} (could not run)`, false, e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    report() {
      console.log(`\n${"═".repeat(72)}\n${label}: ${requests} request(s), ${failures.length} failure(s), ${findings.length} finding(s)`);
      for (const f of findings) console.log(`  · ${f}`);
      if (failures.length > 0) {
        console.log(`\nFAILED: ${failures.join("; ")}`);
        process.exit(1);
      }
      process.exit(0);
    },
    count: () => requests,
    bump: () => {
      requests += 1;
    },
  };
  return probe;
}

export type Attempt = { ok: true; status: number; body: unknown } | { ok: false; status: number; body: string };

/** One request, counted, never thrown: a 4xx is a measurement, not an error. */
export async function attemptJson(probe: Probe, url: string, init?: RequestInit): Promise<Attempt> {
  probe.bump();
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, body: text };
  try {
    return { ok: true, status: res.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { ok: true, status: res.status, body: text };
  }
}

export function requireEnv(name: string, hint: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Set ${name} (${hint}) and re-run.`);
    process.exit(2);
  }
  return v;
}

export function pace(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
