# `public/` — the landing page's image assets

Everything in here is served at the site root: a file saved as
`public/sky.jpg` is fetched by the browser as `/sky.jpg`.

**Every one of these is optional.** The landing page is wired so that a missing
file degrades to a drawn CSS version instead of breaking — the images are
referenced through `background-image`, not `next/image`, because a missing file
in `next/image` is a build failure and a missing background simply does not
paint. So you can upload them one at a time, in any order, and the site stays
up throughout.

The names below are exact. Lower case, exact spelling, exact extension.

## The extension has to match the actual file

The first upload arrived with every file mislabelled: `sky.jpg` and both
`pipe-*.png` were **AVIF**, and `dashboard.png` was a **JPEG**. Browsers sniff
image bytes and mostly render them anyway, which is why it half-worked — but
the server sends a `Content-Type` based on the extension, so a stricter client
or a CDN that trusts the header can refuse them.

macOS does this quietly: renaming `IMG_1234.HEIC` to `sky.jpg` in Finder
changes the name and not the bytes. To convert properly, open the file in
Preview and use **File → Export**, choosing JPEG or PNG in the Format dropdown.

The committed files have been re-encoded to match their names, and resized —
the pipe art arrived at 1870x2048 and 3.9MB each for something drawn 250px
wide on screen.

| File | What it is | Format | Target size |
|---|---|---|---|
| `sky.jpg` | The cloud background behind the hero | JPEG | ~2400px wide, under 500KB |
| `dashboard.png` | A real screenshot of the Namzilabs board | PNG | ~2200px wide |
| `pipe-front.png` | The chute **with the open mouth** — the dark ellipse you look into | PNG, transparent | ~760px wide |
| `pipe-back.png` | The same cylinder **without** a mouth — a plain body section | PNG, transparent | ~760px wide |

## How the chute is actually composed

The earlier note here guessed wrong, and the art settled it. `pipe-front.png`
has an open mouth; `pipe-back.png` does not. They are not a front and a back
sandwiching the icons — the icons never go inside the tube at all.

What the page draws is one chute per side, mouth turned inward, with the
connector logos pouring **out of the mouth through open sky** toward the
dashboard, where the card covers them. That is what the reference does and
what the layout sketch shows: pipes outside, icons in the gap, board in the
middle.

So only `pipe-front.png` is drawn today. `pipe-back.png` is kept for a longer
run — a body section that could be tiled outward from the mouth to make the
chute look like it comes from further away.

Both are drawn as **upright** cylinders and the page rotates them, so export
them upright exactly as they are.

## `dashboard.png` — read this before uploading

The screenshot you sent is of a live workspace: a named client, real revenue,
real lead counts. That would be on the public internet the moment it is
committed, and a commit is permanent even if the file is deleted afterwards.

**Crop or blur the workspace name and the figures first.**

Until that file exists the page draws the board instead
(`src/components/marketing/app-window.tsx`), with invented numbers that
reconcile.
