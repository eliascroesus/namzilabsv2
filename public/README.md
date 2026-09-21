# public/

Next.js serves everything in this folder from the site root, unprocessed. A
file saved here as `dashboard.png` is fetched by the browser as `/dashboard.png`.

## `dashboard.png` is currently unused

It was the hero's centrepiece until the v3.2 design patch, which removed it:
a dark screenshot inside a light composition, with green chart bars outside the
palette, clipped on three sides and competing with the floating chips for the
same attention. The hero now uses a drawn "join" card instead, and the metric
canvas in S04 is drawn rather than photographed for the same reason it always
was — a stale screenshot of a builder that has since been rebuilt is a lie with
a long shelf life.

**The file is kept, not deleted.** It is a good asset and putting it back is a
component and a few lines of CSS, not a re-shoot. If you want it somewhere,
say where and it goes there.

## Git does not track empty directories

Which is why this folder was missing entirely until it had a file in it. This
README is what keeps it in the repository.
