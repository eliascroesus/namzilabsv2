import type { Connector } from "./types";
import { catchHookConnector } from "./catch-hook";
import { calendlyConnector } from "./calendly";
import { closeConnector } from "./close";
import { instantlyConnector } from "./instantly";
import { whopConnector } from "./whop";
import { googleSheetsConnector } from "./google-sheets";
import { googleAnalyticsConnector } from "./google-analytics";
import { googleCalendarConnector } from "./google-calendar";
import { stripeConnector } from "./stripe";
import { calcomConnector } from "./calcom";
import { aircallConnector } from "./aircall";
import { pipedriveConnector } from "./pipedrive";
import { typeformConnector } from "./typeform";
import { tallyConnector } from "./tally";
import { smartleadConnector } from "./smartlead";
import { helpscoutConnector } from "./helpscout";
import { attioConnector } from "./attio";
import { lemlistConnector } from "./lemlist";
import { paddleConnector } from "./paddle";
import { justcallConnector } from "./justcall";
import { oncehubConnector } from "./oncehub";
import { savvycalConnector } from "./savvycal";
import { thinkificConnector } from "./thinkific";
import { thrivecartConnector } from "./thrivecart";
import { retellConnector } from "./retell";
import { customerioConnector } from "./customerio";
import { airtableConnector } from "./airtable";
import { notionConnector } from "./notion";

import { mailchimpConnector } from "./mailchimp";

import { woocommerceConnector } from "./woocommerce";

import { shopifyConnector } from "./shopify";

import { klaviyoConnector } from "./klaviyo";
import { fathomConnector } from "./fathom";
import { metaAdsConnector } from "./meta-ads";
import { tiktokAdsConnector } from "./tiktok-ads";
import { googleAdsConnector } from "./google-ads";

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
  whopConnector,
  googleSheetsConnector,
  googleAnalyticsConnector,
  googleCalendarConnector,
  stripeConnector,
  calcomConnector,
  aircallConnector,
  pipedriveConnector,
  typeformConnector,
  tallyConnector,
  smartleadConnector,
  helpscoutConnector,
  attioConnector,
  lemlistConnector,
  paddleConnector,
  justcallConnector,
  oncehubConnector,
  savvycalConnector,
  thinkificConnector,
  thrivecartConnector,
  retellConnector,
  customerioConnector,
  airtableConnector,
  notionConnector,
  mailchimpConnector,
  woocommerceConnector,
  shopifyConnector,
  klaviyoConnector,
  fathomConnector,
  metaAdsConnector,
  tiktokAdsConnector,
  googleAdsConnector,
]) {
  registerConnector(connector);
}
