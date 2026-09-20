# public/

Next.js serves everything in this folder from the site root, unprocessed. A
file saved here as `dashboard.png` is fetched by the browser as `/dashboard.png`.

## The landing page's hero shot

`/` looks for **`public/dashboard.png`** and puts it at the centre of the hero,
in place of the drawn summary card, with the source chips arranged around it.

- **Drop the file in with exactly that name and nothing else needs changing.**
  The page renders the image if it loads and falls back to the drawn card if it
  is missing, so neither state is ever broken.
- A wide screenshot works best — roughly 16:10 through 16:9. It is displayed at
  up to 620px wide on a 1440px screen and scales down from there, so anything
  from about 1240px wide up will stay sharp on a retina display.
- PNG for a screenshot with text in it. If you would rather use a different
  name or format, the path is the single constant `DASHBOARD_SHOT` in
  `src/components/marketing/snap/dashboard-shot.tsx`.

## Why this folder has a README rather than being empty

Git does not track empty directories, so a bare `public/` cannot be committed
or appear on GitHub — which is exactly why it was missing. This file is what
makes the folder exist for everyone who clones the repo.
