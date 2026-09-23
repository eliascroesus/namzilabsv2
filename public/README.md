# public/

Next.js serves everything in this folder from the site root, unprocessed. A
file saved here as `dashboard.png` is fetched by the browser as `/dashboard.png`.

## `dashboard.png` is the fold

It is the hero's centrepiece: a real capture of the Overview board, workspace
name blurred, rendered through `next/image` by
`src/components/marketing/snap/board-shot.tsx`. The composition crops it from
the LEFT and lets it run off the right-hand edge of the screen, so the board's
navigation rail is the one part that is never cropped away — four source marks
straddle the frame's left edge and their wires land on that rail.

**Two consequences of using a photograph rather than a drawing.**

It dates. The v3.2 patch pulled this file out of the hero for exactly that
reason, among others, and the reason has not gone away: when the board's
chrome changes, re-shoot it. `pnpm landing` asserts that the page requests it
and that it loads, so a deleted file fails loudly — but nothing can tell you
the picture is six months old except looking at it.

And the crop depends on the rail's width. The rail is about 13% of the
capture; the wires' port is placed at 134 in the rig's coordinate space on
that basis. A re-shoot at a very different window width moves the rail's edge
and the port has to move with it. `BoardShot` says so where the number is.

## Git does not track empty directories

Which is why this folder was missing entirely until it had a file in it. This
README is what keeps it in the repository.
