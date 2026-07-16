import type { Connector } from "./types";
import { catchHookConnector } from "./catch-hook";

const registry = new Map<string, Connector>();

export function registerConnector(connector: Connector): void {
  registry.set(connector.source, connector);
}

export function getConnector(source: string): Connector | undefined {
  return registry.get(source);
}

export function listConnectors(): Connector[] {
  return [...registry.values()];
}

// Built-in connectors. Prompt 2 registers Calendly / Close / Instantly /
// Sendblue / Google here — each is purely additive.
registerConnector(catchHookConnector);
