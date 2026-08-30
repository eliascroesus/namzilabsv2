import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, StatusPill } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { FieldLabel } from "@/components/ui/field";

/**
 * THE BRAND SHEET, RENDERED FROM THE REAL COMPONENTS.
 *
 * Two sheets were supplied and they are one system with two halves:
 *
 *   · The first is the VOICE — deep black doing the work, a neon yellow hero,
 *     everything a full pill, micro labels in ALL CAPS, and a four-colour
 *     accent set (yellow, orange, pink, periwinkle) for chips and tabs.
 *   · The second is the FOUNDATION — #1A1A1A / #F5F5F5 / #7C4DFF, Helvetica
 *     Neue, an 8px baseline, and a button matrix of Default, Button, Hover,
 *     Preview, Pressed and Deject.
 *
 * Where they disagreed, the first won on hierarchy: its workhorse button is
 * black and colour arrives only where it means something. Treating violet as
 * the default made the product read violet-and-grey, which is neither sheet.
 *
 * Every specimen below is the SHIPPING component with its real props — not a
 * mock-up — so this page cannot drift from the product the way a picture of a
 * kit always eventually does.
 */

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

export function BrandSheet() {
  return (
    <div className="space-y-10">
      {/* ── THE THREE COLOURS ─────────────────────────────────────────── */}
      <Block title="Colour palette">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex h-32 flex-col justify-end rounded-card bg-foreground p-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-background">Deep black</p>
            <p className="font-mono text-xs text-background/70">#1A1A1A</p>
          </div>
          <div className="flex h-32 flex-col justify-end rounded-card border border-border bg-muted p-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-foreground">Off-white</p>
            <p className="font-mono text-xs text-muted-foreground">#F5F5F5</p>
          </div>
          <div className="flex h-32 flex-col justify-end rounded-card bg-primary p-4">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary-foreground">Vibrant violet</p>
            <p className="font-mono text-xs text-primary-foreground/80">#7C4DFF</p>
          </div>
        </div>
        {/* The accent four. Deliberately separate from the three above: these
            are decoration, and they are NOT states — success, warn and danger
            own that vocabulary, so a yellow chip can never read as a warning. */}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { cls: "bg-accent-yellow text-neutral-900", name: "Yellow" },
            { cls: "bg-accent-orange text-white", name: "Orange" },
            { cls: "bg-accent-pink text-neutral-900", name: "Pink" },
            { cls: "bg-accent-peri text-white", name: "Periwinkle" },
          ].map((a) => (
            <div key={a.name} className={`flex h-20 items-end rounded-card p-3 ${a.cls}`}>
              <p className="text-xs font-semibold uppercase tracking-wide">{a.name}</p>
            </div>
          ))}
        </div>
      </Block>

      {/* ── TYPE ──────────────────────────────────────────────────────── */}
      <Block title="Typography hierarchy">
        <div className="space-y-3">
          <p className="text-display-lg font-semibold uppercase leading-none tracking-tight text-foreground">
            Typography
            <br />
            hierarchy
          </p>
          <p className="text-display-sm font-semibold text-foreground">
            Heading 1 <span className="text-accent-foreground">(H1)</span>
          </p>
          <p className="text-display-xs font-semibold text-foreground">
            Heading 2 <span className="text-accent-foreground">(H2)</span>
          </p>
          <p className="text-md text-foreground">Body text</p>
          <p className="text-sm text-muted-foreground">Caption</p>
        </div>
      </Block>

      {/* ── BUTTONS: the first sheet's stack, in order ─────────────────── */}
      <Block title="Buttons">
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="flex max-w-xs flex-col items-stretch gap-3">
            <Button variant="yellow" size="lg">
              Sign in with Apple
            </Button>
            <Button size="lg">Sign in with Apple</Button>
            <Button variant="secondary" size="lg">
              Sign in with Apple
            </Button>
            {/* The sheet's composite: a quiet quantity, the ACT in the middle,
                a quiet qualifier. One button, three weights. */}
            <Button size="lg" className="justify-between gap-4">
              <span className="text-xs font-normal opacity-70">3 items</span>
              <span className="font-semibold uppercase tracking-wide">Reserve</span>
              <span className="text-xs font-normal opacity-70">for free</span>
            </Button>
            <div>
              <Button size="lg" className="w-full">
                Try again
              </Button>
              <p className="mt-1.5 text-xs text-danger-ink">Something went wrong. Please try again.</p>
            </div>
          </div>

          {/* The second sheet's matrix. */}
          <div className="grid max-w-sm grid-cols-2 gap-2 self-start">
            <Button>Default</Button>
            <Button variant="accent">Button</Button>
            <Button variant="secondary">Hover</Button>
            <Button>Hover</Button>
            <Button variant="outlineAccent">Deject</Button>
            <Button variant="soft">Pressed</Button>
            <Button variant="ghost">Quiet</Button>
            <Button disabled>Disabled</Button>
          </div>
        </div>
      </Block>

      {/* ── TABS & CHIPS ──────────────────────────────────────────────── */}
      <Block title="Tabs and chips">
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex flex-col gap-2">
            <span className="inline-flex h-9 items-center rounded-full bg-foreground px-4 text-sm font-medium text-background">
              Tab
            </span>
            <span className="inline-flex h-9 items-center rounded-full border border-border bg-card px-4 text-sm font-medium text-muted-foreground">
              Tab
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="inline-flex h-8 items-center rounded-full border border-foreground px-4 text-xs font-semibold uppercase tracking-wide text-foreground">
              Large
            </span>
            <span className="inline-flex h-8 items-center rounded-full bg-foreground px-4 text-xs font-semibold uppercase tracking-wide text-background">
              Small
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <StatusPill tone="yellow">6:03</StatusPill>
            <StatusPill tone="pink">0:59</StatusPill>
          </div>
        </div>

        {/* The dismissible row — every one ALL CAPS, which is the sheet's own
            voice for a micro label and the reason it reads as a LABEL rather
            than as a very small sentence. */}
        <div className="mt-4 flex flex-wrap gap-2">
          {["Small", "Medium", "Large", "X large", "2x large", "Clear", "Black", "Yellow", "Pink"].map((c) => (
            <Badge key={c}>
              {c}
              <X className="size-3" />
            </Badge>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <StatusPill tone="pending">4 min (430m)</StatusPill>
          <StatusPill tone="orange">4 min (430m)</StatusPill>
          <StatusPill tone="peri">4 min (430m)</StatusPill>
        </div>
      </Block>

      {/* ── CARDS: the second sheet's violet / black / outline trio ────── */}
      <Block title="Cards">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex flex-col justify-between rounded-card bg-primary p-5">
            <div>
              <p className="text-md font-semibold text-primary-foreground">Card text 1</p>
              <p className="mt-1 text-sm text-primary-foreground/80">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit.
              </p>
            </div>
            <Button variant="soft" size="sm" className="mt-4 self-start">
              Read now
            </Button>
          </div>
          <div className="flex flex-col justify-between rounded-card bg-foreground p-5">
            <div>
              <p className="text-md font-semibold text-background">Card text 2</p>
              <p className="mt-1 text-sm text-background/70">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit.
              </p>
            </div>
            <Button variant="outlineAccent" size="sm" className="mt-4 self-start">
              Read now
            </Button>
          </div>
          <Card variant="card" className="flex flex-col justify-between">
            <div>
              <p className="text-md font-semibold text-foreground">Card text 3</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed diam nonumy.
              </p>
            </div>
            <Button variant="secondary" size="sm" className="mt-4 self-start">
              Read now
            </Button>
          </Card>
        </div>
      </Block>

      {/* ── FORM ──────────────────────────────────────────────────────── */}
      <Block title="Form">
        <div className="max-w-sm space-y-4">
          <div>
            <FieldLabel htmlFor="sheet-name">Name</FieldLabel>
            <Input id="sheet-name" placeholder="Name" />
          </div>
          <div>
            <FieldLabel htmlFor="sheet-msg">Message</FieldLabel>
            <Textarea id="sheet-msg" rows={3} placeholder="Write a message" />
          </div>
          <Button className="w-full">Submit</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="soft">Yes</Button>
            <Button variant="secondary">No</Button>
          </div>
        </div>
      </Block>
    </div>
  );
}
