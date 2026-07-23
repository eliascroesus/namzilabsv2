import type { Connector } from "./types";
import { catchHookConnector } from "./catch-hook";
import { calendlyConnector } from "./calendly";
import { closeConnector } from "./close";
import { instantlyConnector } from "./instantly";
import { sendblueConnector } from "./sendblue";
import { googleSheetsConnector } from "./google-sheets";
import { googleCalendarConnector } from "./google-calendar";

const registry = new Map<string, Connector>();

export function registerConnector(connector: Connector): void {
  registry.set(connector.source, connector);
}

export function getConnector(source: string): Connector | undefined {
  return registry.get(source);
}

// Built-in connectors.
for (const connector of [
  catchHookConnector,
  calendlyConnector,
  closeConnector,
  instantlyConnector,
  sendblueConnector,
  googleSheetsConnector,
  googleCalendarConnector,
]) {
  registerConnector(connector);
}
