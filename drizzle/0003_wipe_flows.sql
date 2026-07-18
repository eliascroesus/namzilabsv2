-- Canvas v2: reset all visual flows. The new Formula named-handle model is not
-- backward compatible with graphs built under the old edge-order model, so every
-- flow is rebuilt clean. Child tables cascade from `flows`, but we delete them
-- explicitly for clarity and to be independent of FK settings.
DELETE FROM "flow_results";--> statement-breakpoint
DELETE FROM "flow_versions";--> statement-breakpoint
DELETE FROM "flows";
