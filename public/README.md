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

| File | What it is | Format | Target size |
|---|---|---|---|
| `sky.jpg` | The cloud background behind the hero | JPEG | ~2400px wide, under 500KB |
| `dashboard.png` | A real screenshot of the Namzilabs board | PNG | ~2400px wide |
| `pipe-back.png` | The BACK half of the pipe — the inside surface the icons pass in front of | PNG, transparent | as exported |
| `pipe-front.png` | The FRONT half of the pipe — the lip that covers the icons | PNG, transparent | as exported |

## Why the pipe is two files

The icons have to travel *inside* the tube, which means they need something
behind them and something in front of them. The page stacks it in this order:

```
pipe-back.png      ← the far wall of the trough
  connector logos  ← travelling along the pipe
pipe-front.png     ← the near lip, drawn over the logos
```

With only one image the logos sit on top of a picture of a pipe and the
illusion collapses — they read as stickers on a tube rather than as objects
inside one. This is exactly how the reference builds it (it calls the two
halves "Bamboo Top" and "Bamboo Bottom").

Both are drawn as **vertical** cylinders and the page rotates them to lie
horizontally, so export them upright exactly as they are.

## `dashboard.png` — read this before uploading

The screenshot you sent is of a live workspace: a named client, real revenue,
real lead counts. That would be on the public internet the moment it is
committed, and a commit is permanent even if the file is deleted afterwards.

**Crop or blur the workspace name and the figures first.**

Until that file exists the page draws the board instead
(`src/components/marketing/app-window.tsx`), with invented numbers that
reconcile.
