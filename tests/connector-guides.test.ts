import { describe, it, expect } from "vitest";
import { CONNECTOR_CATALOG } from "@/connectors/catalog";

/**
 * THE SETUP GUIDES, HELD TO THE FORM THEY DESCRIBE.
 *
 * A guide is prose, and prose cannot be typechecked — which is exactly how the
 * old arrangement rotted. Instructions lived inside field labels, so a renamed
 * field left its directions pointing at nothing and nobody found out, and Whop's
 * told people to fetch a value the provider had since stopped accepting under
 * that name.
 *
 * These assertions cannot check whether a step is TRUE — only a person opening
 * the provider's dashboard can do that, which is what `readOn` records. What they
 * can check is that the guide and the form still agree, which is the half that
 * drifts silently.
 */
describe("connector setup guides", () => {
  const guided = CONNECTOR_CATALOG.filter((e) => e.guide);

  it("documents at least the apps the owner actually connects", () => {
    // Sabotage: delete a guide and this names which one went missing, rather
    // than the suite passing on an empty set.
    expect(guided.map((e) => e.source).sort()).toEqual(expect.arrayContaining(["calendly", "fathom", "stripe", "whop"]));
  });

  for (const entry of guided) {
    describe(entry.name, () => {
      const guide = entry.guide!;

      it("only describes credential fields that exist on the form", () => {
        /**
         * THE ASSERTION THAT EARNS THIS FILE. A guide block names the field it
         * fills; if that key is not on `credentialFields`, the page is walking
         * somebody through finding a value there is nowhere to paste.
         */
        const formKeys = new Set(entry.credentialFields.map((f) => f.key));
        for (const field of guide.fields) {
          expect(formKeys.has(field.key), `${entry.source}: guide covers "${field.key}", which the form does not ask for`).toBe(true);
        }
      });

      it("covers every field the form requires", () => {
        /**
         * The other direction, and the one a reader feels: a required box with
         * no guidance is the box they get stuck on. Optional fields are exempt —
         * a webhook secret nobody has to supply needs no block of its own,
         * because the webhook section covers it.
         */
        const required = entry.credentialFields.filter((f) => !f.optional).map((f) => f.key);
        const covered = new Set(guide.fields.map((f) => f.key));
        for (const key of required) {
          expect(covered.has(key), `${entry.source}: the form requires "${key}" and the guide never mentions it`).toBe(true);
        }
      });

      it("carries a checkable date", () => {
        expect(guide.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // A date in the future is a typo, and a guide that claims to have been
        // checked tomorrow is worse than one with no date at all.
        expect(new Date(guide.readOn).getTime()).toBeLessThanOrEqual(Date.now());
      });

      it("gives every block real steps", () => {
        for (const field of guide.fields) {
          expect(field.steps.length, `${entry.source}/${field.key} has no steps`).toBeGreaterThan(0);
          for (const step of field.steps) expect(step.trim().length).toBeGreaterThan(0);
        }
      });

      it("does not leave the route inside a field label", () => {
        /**
         * THE REGRESSION THIS SECTION EXISTS TO PREVENT. The labels used to read
         * "Webhook signing secret (optional — Whop → Developer → Webhooks, Secret
         * column)". An arrow in a label means the instructions are creeping back
         * out of the page and into the form, where they cannot be dated or read.
         */
        for (const f of entry.credentialFields) {
          expect(f.label, `${entry.source}/${f.key}: the label carries directions`).not.toMatch(/→|->/);
          expect(f.label.toLowerCase(), `${entry.source}/${f.key}: "optional" belongs in the field, not the label`).not.toContain("optional");
        }
      });
    });
  }
});
