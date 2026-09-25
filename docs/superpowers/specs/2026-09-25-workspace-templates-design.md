# Workspace templates — design

**Date:** 25 Sep 2026 · **Status:** built and shipped behind migration 0034 · **Owner:** Elias

## The ask

A coach, agency or course creator builds their dashboard once, then sends one link to every
student or client. Whoever opens it signs up and starts with the same views, with the charts in
the same places and a note on every empty spot saying which metric goes there. None of the
author's data comes with it. It must work for sharing a whole workspace or a single view. And it
must stay simple.

## Decisions (made with Elias, 25 Sep 2026)

| Question | Decision | Why |
|---|---|---|
| How much of the setup travels? | **A: layout plus notes.** Metric definitions (flows) do **not** travel | Smallest safe scope. Each slot records which app its metric came from, so "Connect Stripe" works today and carrying metric recipes can be added later without redoing anything |
| Is the template link also a referral link? | **Yes, automatically** | One link to share. A coach sending 30 students a template is exactly the referral the "Invite & earn" offer rewards |
| Live link or frozen copy? | **Frozen copy (snapshot)** | The public page never reads the author's live workspace. Students never receive a half-finished edit. Every competitor that pushes updates into copies overwrites the recipient's edits and can't undo it |
| Where are notes written? | **On the author's own board**, in each tile's and column's menu, and **derived automatically** when absent | Sharing a dashboard that already works needs no extra typing: each filled chart becomes an empty slot labelled with its metric's name and app |
| Grouped views | Columns carry a note (their members' names), not empty slots | A groups view is "all your metrics, sorted into columns", so it has no slots |
| Who may share? | Workspace admins (`canManageRanks`) | A template publishes metric names to anyone holding the link, so it's the same governance tier as inviting people |

## Competitor research that shaped it

- **Notion** loses people between clicking the link and signing up (the Duplicate button can be
  hidden when logged out, on mobile, or in another app's built-in browser). → Remember the template
  on our side, through signup.
- **Databox, Klipfolio and AgencyAnalytics** push template updates into existing copies, and each
  warns that this overwrites the recipient's edits and cannot be undone. → Copies are independent;
  "Update" only affects future uses.
- **Klipfolio** copies keep refreshing with the parent account's OAuth token. → Nothing of the
  author's (connections, ids, numbers) may ever cross.
- **Dashboard tools fill previews with demo numbers**, which students mistake for their own. →
  Previews show the real layout with notes and no numbers at all.
- **Nobody** attaches guidance to individual "pick a metric" slots. That gap is this feature's
  point.

## How it works

1. **Share.** Settings → Templates → New template, or a view tab's menu → "Share as template"
   (which opens the same form with that view ticked; ticking every view shares the whole
   workspace). `snapshotViews` reads the chosen views and `buildSnapshot` turns them into a
   whitelisted snapshot. The result is stored in `workspace_templates` with a random 10-character
   code.
2. **The link.** `/t/<code>` is public, not indexed, and aware of who's signed in. It draws the
   snapshot with `TemplatePreview`, and its call to action depends on the visitor:
   - **Signed out:** "Use this template" sets `nz_tpl` (the choice) and `nz_ref` (the author's
     referral code), then goes to `/signup?next=/t/<code>`.
   - **Signed in, no workspace:** name one and create it from the template.
   - **Signed in, in a workspace:** "Add to <workspace>" (appended after their own views), or
     create a new workspace from it.
3. **Sign-up.** `next` brings the new account back to `/t/<code>`. If a path drops `next`, the
   `nz_tpl` cookie makes `/onboarding` offer the template, ticked. `createOrganizationAction`
   applies the template (`takeTemplate`), and also records the referral from `nz_ref`. That closes
   an existing gap: email/password signups never reach `/callback`, so they were never credited.
4. **The copy.** `applySnapshot` writes every view, tile, column and note in **one statement**
   (the neon-http driver has no transactions). Custom-view slots are `UNSET_TILE_KEY` tiles
   carrying `config.note` and `config.noteApps`. Column and calendar notes go to
   `dashboard_notes`.
5. **Filling it in.** An empty slot with a note shows the note, the apps' marks, a "Connect"
   link if one of those apps isn't connected (to `/integrations?connect=<app>`, which opens that
   app's dialog), and "Pick a metric". Empty columns show their note and apps the same way.

## What never leaves a workspace (enforced by tests)

Tile keys, flow and metric ids, goals (`target`), custom titles (they become the note), composed
parts and exits, placements, members, connections, and any metric the author's own role hides.
`tests/templates-snapshot.test.ts` searches the whole serialized snapshot for each of these, and
the whitelist was deliberately broken once to prove the test fails.

## Robustness

- **Migration 0034 is pasted by hand.** Until it is, templates say "being switched on", boards
  read no notes, and workspace deletion skips the three tables (`isUndefinedTableError`). No
  existing table gained a column, so no existing query can break.
- **Caps.** Adding a template refuses to push a workspace past its view cap (30) or group cap
  (100), and writes nothing when it refuses.
- **A disabled link** refuses on the page and again inside `takeTemplate`.
- **Errors on `/t/<code>` arrive as codes**, never as text, so a crafted link can't print
  arbitrary words under our domain.

## Not built (later, if wanted)

- **Metric recipes (option B).** Carry flow definitions minus their connections, so that
  connecting Stripe fills the tiles automatically. `noteApps` is already the hook for binding a
  slot to an app.
- **"Update available"** for existing copies (opt-in only, never an overwrite).
- A public gallery of templates.
