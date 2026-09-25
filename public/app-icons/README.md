# App icons

Drop an app's logo in this folder and it replaces the two-letter tile everywhere that app appears:
the Apps page, the flow builder, the landing page and template previews.

## How

1. Name the file after the app, either its name or its short name from the table below:
   `instantly.png`, `Instantly.png`, `Google Ads.svg` and `gads.svg` all work.
   Capitals, spaces and dashes don't matter.
2. Use **`.svg`** if you have one, otherwise **`.png`** or **`.webp`** at least 256×256.
   `.jpg` works but can't be transparent.
3. Use a **transparent background, just the mark**, with no coloured square or rounded tile around
   it. That matches every other logo in the product.
4. Commit and push (or use GitHub's **Add file → Upload files** on this folder). The logo appears
   after the next deploy. Locally, restart `pnpm dev`.

A file here also **replaces** a built-in logo. To use a better Calendly mark, add `calendly.svg`.

## Still missing a logo (25 Sep 2026)

| App | File name |
|---|---|
| Instantly | `instantly.png` |
| Custom Webhook | `webhook.png` |
| Cal.com | `calcom.png` |
| Typeform | `typeform.png` |
| Tally | `tally.png` |
| Smartlead | `smartlead.png` |
| lemlist | `lemlist.png` |
| OnceHub | `oncehub.png` |
| SavvyCal | `savvycal.png` |
| Thinkific | `thinkific.png` |
| ThriveCart | `thrivecart.png` |
| Retell AI | `retell.png` |
| WooCommerce | `woocommerce.png` |
| Klaviyo | `klaviyo.png` |
| Fathom | `fathom.png` |
| Meta Ads | `meta-ads.png` |
| TikTok Ads | `tiktok-ads.png` |
| Google Ads | `gads.png` |

(Any image extension works in place of `.png`.)

If a file doesn't show up, check its name against the table. A file whose name matches no app is
ignored.
