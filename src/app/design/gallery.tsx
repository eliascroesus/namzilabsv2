"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  Copy,
  Inbox,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Star,
  Trash2,
  User,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { Badge, StatusPill } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal, ModalTitle } from "@/components/ui/modal";
import { SectionHeading } from "@/components/ui/page";
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { SubmitButton } from "@/components/ui/submit-button";
import { Switch } from "@/components/ui/switch";
import { Table, TableShell, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { ButtonProps } from "@/components/ui/button";
import type { CardProps } from "@/components/ui/card";
import type { StatusPillProps } from "@/components/ui/badge";

/**
 * THE GALLERY — every export in src/components/ui, on one page.
 *
 * The kit page used to show nine primitives in a single flat row and call it
 * coverage. It was not: the directory holds 31 files and 138 exports, and the
 * twenty-odd that arrive through a trailing `export { … }` block — alert,
 * avatar, breadcrumb, command, progress, scroll-area, sheet, tabs — were not
 * on the page at all, which is exactly how `ui/alert.tsx` came to ship, be
 * imported by NOTHING, and get hand-rolled nineteen times instead.
 *
 * So the rule here is coverage, not curation: every export appears, every
 * variant axis is enumerated to its last value, and anything that can only be
 * seen by operating it gets a working trigger rather than a screenshot.
 *
 * WHAT CANNOT BE SHOWN FLAT, AND WHY IT IS A TRIGGER INSTEAD.
 * Dialog, Sheet, Select, DropdownMenu, Popover and Tooltip all portal to
 * document.body — they render nothing inline and are invisible until opened.
 * Modal is stranger still: it has no `open` prop, so rendering it
 * unconditionally would cover this page with a scrim on arrival. Both classes
 * get a real control, because a specimen you can operate is also the only way
 * to check the thing worth checking about them — focus, dismissal, and the
 * order they close in when nested.
 */

/** One labelled specimen. The label is the API, not a description of it. */
function Spec({ name, note, children }: { name: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-xs text-muted-foreground">{name}</p>
      {note && <p className="mt-0.5 max-w-prose text-xs text-muted-foreground/80">{note}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** A group of specimens under one component's name. */
function Family({ name, file, children }: { name: string; file: string; children: React.ReactNode }) {
  return (
    <section className="scroll-mt-24 border-t border-border pt-6" id={`c-${file}`}>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-md font-semibold text-foreground">{name}</h3>
        <span className="font-mono text-xs text-muted-foreground">ui/{file}</span>
      </div>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

const BUTTON_VARIANTS: NonNullable<ButtonProps["variant"]>[] = [
  "default",
  "yellow",
  "accent",
  "secondary",
  "soft",
  "outlineAccent",
  "ghost",
  "destructive",
  "success",
  "destructiveGhost",
  "destructiveOutline",
  "link",
];
const BUTTON_SIZES: NonNullable<ButtonProps["size"]>[] = ["sm", "default", "lg"];
const PILL_TONES: NonNullable<StatusPillProps["tone"]>[] = [
  "brand",
  "pending",
  "success",
  "warn",
  "danger",
  "yellow",
  "orange",
  "pink",
  "peri",
];
const CARD_VARIANTS: NonNullable<CardProps["variant"]>[] = ["card", "surface", "tile"];
const CARD_PADDING: NonNullable<CardProps["padding"]>[] = ["none", "dense", "compact", "default"];

export function Gallery() {
  const [checked, setChecked] = useState(true);
  const [on, setOn] = useState(true);
  const [small, setSmall] = useState(false);
  const [modal, setModal] = useState<"sm" | "md" | "lg" | null>(null);
  /**
   * OFF BY DEFAULT, and that is not a preference. Toast is `position: fixed`,
   * so rendering it inline does not put it in its gallery cell — it parks it
   * over the page and leaves it there for the whole scroll, covering whatever
   * section you happen to be reading.
   */
  const [toast, setToast] = useState(false);
  const [query, setQuery] = useState("");

  return (
    <TooltipProvider>
      <div className="space-y-8">
        {/* ── BUTTON ──────────────────────────────────────────────────── */}
        <Family name="Button" file="button.tsx">
          <Spec name="variant — 12 values" note="Black is the workhorse; violet marks the branded action; yellow is the hero and appears at most once per screen.">
            {BUTTON_VARIANTS.map((v) => (
              <Button key={v} variant={v}>
                {v}
              </Button>
            ))}
          </Spec>
          <Spec name="size — sm 36 · default 44 · lg 52" note="Plus two fixed squares: icon (44) and iconSm (36), which take an icon child and an aria-label, never text.">
            {BUTTON_SIZES.map((s) => (
              <Button key={s} size={s}>
                Save changes
              </Button>
            ))}
            <Button size="icon" aria-label="Add">
              <Plus />
            </Button>
            <Button size="iconSm" aria-label="More">
              <MoreHorizontal />
            </Button>
          </Spec>
          <Spec name="states" note="Press feedback is global — every button dips 0.5px on :active. The focus ring is declared once in globals.css, never by a component.">
            <Button disabled>Disabled</Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
            <Button>
              Continue <ArrowRight />
            </Button>
            <Button variant="secondary">
              <Copy /> With a leading icon
            </Button>
          </Spec>
          <Spec name="asChild" note="A link dressed as a button composes buttonVariants() rather than re-typing the class string.">
            <Button asChild variant="secondary">
              <a href="#c-button.tsx">An anchor, styled as a button</a>
            </Button>
          </Spec>
        </Family>

        {/* ── BADGE / STATUSPILL ──────────────────────────────────────── */}
        <Family name="Badge · StatusPill" file="badge.tsx">
          <Spec name="StatusPill tone — 9 values" note="Five are STATE (pending, success, warn, danger, brand); four are the decorative accent set, which must never be used to mean state.">
            {PILL_TONES.map((t) => (
              <StatusPill key={t} tone={t}>
                {t}
              </StatusPill>
            ))}
          </Spec>
          <Spec name="StatusPill dot">
            <StatusPill tone="success" dot>
              Live
            </StatusPill>
            <StatusPill tone="danger" dot>
              Failing
            </StatusPill>
            <StatusPill tone="pending" dot>
              Never run
            </StatusPill>
          </Spec>
          <Spec name="Badge" note="A neutral chip with an optional dismiss. ALL CAPS is the sheet's own voice for a micro label.">
            <Badge>Default</Badge>
            <Badge>
              Dismissible <Trash2 className="size-3" />
            </Badge>
          </Spec>
        </Family>

        {/* ── CARD ────────────────────────────────────────────────────── */}
        <Family name="Card" file="card.tsx">
          <Spec name="variant × padding — 3 × 4" note="card is the default object; surface is the panel; tile is the only one that hovers. Everything else in the product should be one of these three, and a fourth recipe is drift.">
            <div className="grid w-full gap-3 sm:grid-cols-3">
              {CARD_VARIANTS.map((v) => (
                <Card key={v} variant={v}>
                  <p className="text-sm font-semibold text-foreground">variant={v}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {v === "card" && "Hairline + card radius. The default."}
                    {v === "surface" && "The panel: 16px radius, no hover."}
                    {v === "tile" && "Rests at shadow-xs, lifts on hover."}
                  </p>
                </Card>
              ))}
            </div>
          </Spec>
          <Spec name="padding">
            <div className="grid w-full gap-3 sm:grid-cols-4">
              {CARD_PADDING.map((p) => (
                <Card key={p} padding={p}>
                  <p className="text-xs text-muted-foreground">padding={p}</p>
                </Card>
              ))}
            </div>
          </Spec>
        </Family>

        {/* ── CHIP ────────────────────────────────────────────────────── */}
        <Family name="Chip" file="chip.tsx">
          <Spec name="Chip" note="A selectable filter pill — the flows list and the board's source filter are built from it.">
            <Chip>All sources</Chip>
            <Chip aria-pressed>Selected</Chip>
          </Spec>
        </Family>

        {/* ── INPUT FAMILY ────────────────────────────────────────────── */}
        <Family name="Input · Textarea · NativeSelect" file="input.tsx">
          <Spec name="Input" note="Textarea is deliberately rounded-card rather than the pill every other control takes — a multi-line box read wrong as a capsule.">
            <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-2">
              <Input placeholder="Ordinary field" aria-label="Ordinary field" />
              <Input placeholder="Disabled" disabled aria-label="Disabled field" />
              <Input placeholder="Invalid" aria-invalid aria-label="Invalid field" />
              <Input type="password" placeholder="Masked — spreads NO_AUTOFILL" aria-label="Masked field" />
            </div>
          </Spec>
          <Spec name="NO_AUTOFILL" note="Four password managers stopped filling the connector API-key boxes because of it. Input spreads it automatically for type=password; spread it by hand on any other field a manager should leave alone.">
            <p className="font-mono text-xs text-muted-foreground">
              data-lpignore · data-1p-ignore · data-bwignore · data-form-type=&quot;other&quot;
            </p>
          </Spec>
          <Spec name="Textarea">
            <Textarea rows={3} className="max-w-md" placeholder="Write a message" aria-label="Message" />
          </Spec>
          <Spec name="NativeSelect" note="The platform control, kept for short one-of lists where a portalled Select would be ceremony.">
            <NativeSelect className="max-w-xs" aria-label="Range" defaultValue="30d">
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
            </NativeSelect>
          </Spec>
        </Family>

        {/* ── FIELD ───────────────────────────────────────────────────── */}
        <Family name="FieldLabel · FieldHint · FieldError" file="field.tsx">
          <Spec name="the three parts, composed">
            <div className="max-w-sm">
              <FieldLabel htmlFor="g-key">API key</FieldLabel>
              <Input id="g-key" type="password" placeholder="sk_live_…" />
              <FieldHint>Found under Settings → Developers in your provider.</FieldHint>
            </div>
            <div className="max-w-sm">
              <FieldLabel htmlFor="g-bad">Workspace</FieldLabel>
              <Input id="g-bad" aria-invalid defaultValue="" />
              <FieldError>Pick a workspace before continuing.</FieldError>
            </div>
          </Spec>
        </Family>

        {/* ── LABEL / CHECKBOX / SWITCH ───────────────────────────────── */}
        <Family name="Label · Checkbox · Switch" file="label.tsx · checkbox.tsx · switch.tsx">
          <Spec name="Checkbox" note="Radix, so it answers Space and reports its state to a screen reader — which the hand-rolled tick never did.">
            <label className="inline-flex items-center gap-2">
              <Checkbox checked={checked} onCheckedChange={(v) => setChecked(v === true)} id="g-check" />
              <Label htmlFor="g-check">Show the trend</Label>
            </label>
            <label className="inline-flex items-center gap-2">
              <Checkbox checked={false} disabled id="g-check-d" />
              <Label htmlFor="g-check-d">Disabled</Label>
            </label>
          </Spec>
          <Spec name="Switch — size default · sm" note="Controlled only: `checked` is required and the handler is a plain onClick. The sm track carries a pseudo-element that pads its hit area back to 24px for WCAG 2.5.8.">
            <Switch checked={on} onClick={() => setOn(!on)} aria-label="Flow enabled" />
            <Switch checked={small} size="sm" onClick={() => setSmall(!small)} aria-label="Compact rows" />
            <Switch checked={false} disabled aria-label="Disabled switch" />
          </Spec>
        </Family>

        {/* ── ALERT ───────────────────────────────────────────────────── */}
        <Family name="Alert" file="alert.tsx">
          <Spec
            name="variant — default · destructive"
            note="Ships, is complete, carries role=alert — and is imported by nothing in the product. Nineteen hand-rolled banners exist instead, none of which announce themselves."
          >
            <div className="grid w-full max-w-2xl gap-3">
              <Alert>
                <Check />
                <AlertTitle>Sync complete</AlertTitle>
                <AlertDescription>All 42 rows were written to the sheet.</AlertDescription>
              </Alert>
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Connection failed</AlertTitle>
                <AlertDescription>Reauthorize the Google account to continue.</AlertDescription>
              </Alert>
            </div>
          </Spec>
        </Family>

        {/* ── AVATAR ──────────────────────────────────────────────────── */}
        <Family name="Avatar" file="avatar.tsx">
          <Spec name="size — sm · default · lg, with AvatarBadge" note="AvatarBadge sizes itself off the group, so outside an <Avatar> it renders at zero pixels.">
            <Avatar size="sm">
              <AvatarFallback>AL</AvatarFallback>
            </Avatar>
            <Avatar>
              <AvatarFallback>GH</AvatarFallback>
            </Avatar>
            <Avatar size="lg">
              <AvatarFallback>EC</AvatarFallback>
              <AvatarBadge />
            </Avatar>
          </Spec>
          <Spec name="AvatarGroup · AvatarGroupCount" note="Both ship. Neither is used anywhere in the product — the members list in Settings hand-rolls its own coloured circles instead.">
            <AvatarGroup>
              <Avatar>
                <AvatarFallback>AL</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>GH</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>EC</AvatarFallback>
              </Avatar>
              <AvatarGroupCount>+3</AvatarGroupCount>
            </AvatarGroup>
          </Spec>
        </Family>

        {/* ── BREADCRUMB ──────────────────────────────────────────────── */}
        <Family name="Breadcrumb" file="breadcrumb.tsx">
          <Spec name="the whole family" note="Ships complete. Used on no route — the app navigates by sidebar and a back pill in PageHeader instead.">
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbLink href="#c-breadcrumb.tsx">Workspace</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbEllipsis />
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink href="#c-breadcrumb.tsx">Flows</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>Speed to lead</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </Spec>
        </Family>

        {/* ── TABS ────────────────────────────────────────────────────── */}
        <Family name="Tabs" file="tabs.tsx">
          <Spec
            name="variant — default (filled track) · line (underline)"
            note="The product ships THREE other tab strips — a violet tint on the board, a black filled Button on Apps, a violet underline in the builder panel — and none of them is this. This is the only one that answers arrow keys."
          >
            <div className="grid w-full max-w-2xl gap-6">
              <Tabs defaultValue="data">
                <TabsList>
                  <TabsTrigger value="data">Data</TabsTrigger>
                  <TabsTrigger value="style">Style</TabsTrigger>
                  <TabsTrigger value="advanced">Advanced</TabsTrigger>
                </TabsList>
                <TabsContent value="data" className="pt-3 text-sm text-muted-foreground">
                  Arrow keys move between these.
                </TabsContent>
                <TabsContent value="style" className="pt-3 text-sm text-muted-foreground">
                  And the panel follows the selection.
                </TabsContent>
                <TabsContent value="advanced" className="pt-3 text-sm text-muted-foreground">
                  Roving tabindex, from the primitive.
                </TabsContent>
              </Tabs>
              <Tabs defaultValue="all">
                <TabsList variant="line">
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="live">Live</TabsTrigger>
                  <TabsTrigger value="paused">Paused</TabsTrigger>
                </TabsList>
                <TabsContent value="all" className="pt-3 text-sm text-muted-foreground">
                  The line variant draws its mark below the trigger box — never clip it.
                </TabsContent>
                <TabsContent value="live" className="pt-3 text-sm text-muted-foreground">
                  Live only.
                </TabsContent>
                <TabsContent value="paused" className="pt-3 text-sm text-muted-foreground">
                  Paused only.
                </TabsContent>
              </Tabs>
            </div>
          </Spec>
        </Family>

        {/* ── OVERLAYS ────────────────────────────────────────────────── */}
        <Family name="DropdownMenu" file="dropdown-menu.tsx">
          <Spec
            name="15 exports — label, item, checkbox, radio, sub, shortcut, separator"
            note="Portals to document.body, so it renders nothing until opened. Open it: the panel is rounded-surface + shadow-surface and every row is rounded-control — the kit's two-shape menu policy, with no third option."
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary">
                  Every part <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Chart</DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem>
                    Duplicate <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem>
                    <Settings /> Settings
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked>Show the trend</DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Range</DropdownMenuLabel>
                <DropdownMenuRadioGroup value="30d">
                  <DropdownMenuRadioItem value="7d">Last 7 days</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="30d">Last 30 days</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem>Speed to lead</DropdownMenuItem>
                    <DropdownMenuItem>Booked calls</DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive">
                  <Trash2 /> Remove chart
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </Spec>
        </Family>

        <Family name="Select" file="select.tsx">
          <Spec name="size — default · sm, with group, label and separator" note="The one local deviation worth seeing: the selected row is restyled by weight and accent ink rather than shadcn's tick-only treatment.">
            <Select defaultValue="30d">
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Relative</SelectLabel>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectGroup>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Absolute</SelectLabel>
                  <SelectItem value="mtd">Month to date</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select defaultValue="all">
              <SelectTrigger size="sm" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="calendly">Calendly</SelectItem>
              </SelectContent>
            </Select>
          </Spec>
        </Family>

        <Family name="Popover · Tooltip" file="popover.tsx · tooltip.tsx">
          <Spec name="Popover, with its header parts" note="PopoverHeader, PopoverTitle and PopoverDescription all ship and none is used in the product.">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary">Popover</Button>
              </PopoverTrigger>
              <PopoverContent align="start">
                <PopoverHeader>
                  <PopoverTitle>Anchored, and portalled</PopoverTitle>
                  <PopoverDescription>
                    It escapes every scroll container it is declared in — which is the whole reason the hand-rolled one
                    grew a fixed-positioning mode.
                  </PopoverDescription>
                </PopoverHeader>
              </PopoverContent>
            </Popover>
          </Spec>
          <Spec name="Tooltip" note="Needs a TooltipProvider ancestor — this whole gallery is wrapped in one. sideOffset is 0 by default, which puts the bubble flush against the trigger.">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Options">
                  <MoreHorizontal />
                </Button>
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>Reachable by keyboard, unlike a title attribute</TooltipContent>
            </Tooltip>
          </Spec>
        </Family>

        <Family name="Dialog · Sheet · Modal" file="dialog.tsx · sheet.tsx · modal.tsx">
          <Spec
            name="Dialog (Radix)"
            note="Traps focus and hands it back to the trigger on close, by the primitive rather than by a re-query-per-keypress loop. Imported by this page and nowhere else."
          >
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Delete this step?</DialogTitle>
                  <DialogDescription>
                    Removing it also removes the two steps that read from it. This cannot be undone.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="secondary">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button variant="destructive">Delete</Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </Spec>
          <Spec name="Sheet — side: right · left · top · bottom" note="Radix Dialog under a different name. Ships complete; used on no route.">
            {(["right", "left", "top", "bottom"] as const).map((side) => (
              <Sheet key={side}>
                <SheetTrigger asChild>
                  <Button variant="secondary" size="sm">
                    {side}
                  </Button>
                </SheetTrigger>
                <SheetContent side={side}>
                  <SheetHeader>
                    <SheetTitle>Filters</SheetTitle>
                    <SheetDescription>Slides from the {side}.</SheetDescription>
                  </SheetHeader>
                  <SheetFooter>
                    <Button>Apply</Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            ))}
          </Spec>
          <Spec
            name="Modal — size: sm · md · lg"
            note="The hand-rolled one, still carrying the connect flow. It has no `open` prop and does not portal, so it must be gated behind state and kept out of any transformed ancestor."
          >
            {(["sm", "md", "lg"] as const).map((s) => (
              <Button key={s} variant="secondary" size="sm" onClick={() => setModal(s)}>
                {s}
              </Button>
            ))}
            {modal && (
              <Modal size={modal} onClose={() => setModal(null)}>
                <ModalTitle>Connect Google Sheets</ModalTitle>
                <p className="mt-2 text-sm text-muted-foreground">
                  size={modal}. Focus is trapped by a hand-written loop that re-queries the DOM on every keypress —
                  which is what Dialog above replaces.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setModal(null)}>
                    Cancel
                  </Button>
                  <Button onClick={() => setModal(null)}>Connect</Button>
                </div>
              </Modal>
            )}
          </Spec>
        </Family>

        {/* ── COMMAND ─────────────────────────────────────────────────── */}
        <Family name="Command" file="command.tsx">
          <Spec name="the palette" note="cmdk. CommandEmpty only mounts on an empty result set — type nonsense into the box to see it.">
            <div className="w-full max-w-md overflow-hidden rounded-surface border border-border">
              <Command value={query} onValueChange={setQuery}>
                <CommandInput placeholder="Search steps…" />
                <CommandList>
                  <CommandEmpty>Nothing matches.</CommandEmpty>
                  <CommandGroup heading="Steps">
                    <CommandItem>
                      <Search /> Get data
                    </CommandItem>
                    <CommandItem>
                      <Star /> Match records
                      <CommandShortcut>⌘M</CommandShortcut>
                    </CommandItem>
                  </CommandGroup>
                  <CommandSeparator />
                  <CommandGroup heading="Flows">
                    <CommandItem>Speed to lead</CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          </Spec>
        </Family>

        {/* ── FEEDBACK ────────────────────────────────────────────────── */}
        <Family name="Progress · Skeleton · Toast" file="progress.tsx · skeleton.tsx · toast.tsx">
          <Spec name="Progress">
            <div className="w-full max-w-md space-y-2">
              <Progress value={18} />
              <Progress value={64} />
              <Progress value={100} />
            </div>
          </Spec>
          <Spec name="Skeleton" note="A bare <Skeleton /> is a 0×0 div — every specimen must carry its own width and height.">
            <div className="w-full max-w-md space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </Spec>
          <Spec name="Toast" note="Presentational only — each of its four call sites owns its own state and timer. Sits at z-40, below modal surfaces.">
            <Button variant="secondary" size="sm" onClick={() => setToast(true)}>
              Show a toast
            </Button>
            {toast && <Toast action={{ label: "Undo", onClick: () => setToast(false) }}>Chart removed</Toast>}
          </Spec>
        </Family>

        {/* ── STRUCTURE ───────────────────────────────────────────────── */}
        <Family name="Table" file="table.tsx">
          <Spec name="TableShell · Table · THead · TH · TBody · TR · TD" note="The product's only real table — Activity — does not use this. It wraps a Card and hand-builds its own head strip instead, which is how two different recessed greys ended up stacked.">
            <TableShell>
              <Table>
                <THead>
                  <TR>
                    <TH>Flow</TH>
                    <TH>Source</TH>
                    <TH>Status</TH>
                  </TR>
                </THead>
                <TBody>
                  <TR>
                    <TD>Speed to lead</TD>
                    <TD>Calendly</TD>
                    <TD>
                      <StatusPill tone="success" dot>
                        Live
                      </StatusPill>
                    </TD>
                  </TR>
                  <TR>
                    <TD>Booked calls</TD>
                    <TD>Google Sheets</TD>
                    <TD>
                      <StatusPill tone="pending" dot>
                        Paused
                      </StatusPill>
                    </TD>
                  </TR>
                </TBody>
              </Table>
            </TableShell>
          </Spec>
        </Family>

        <Family name="ScrollArea · Separator" file="scroll-area.tsx · separator.tsx">
          <Spec name="ScrollArea" note="Needs an explicit height or it never overflows and no bar ever appears.">
            <ScrollArea className="h-32 w-full max-w-xs rounded-card border border-border p-3">
              <div className="space-y-2">
                {Array.from({ length: 12 }, (_, i) => (
                  <p key={i} className="text-sm text-muted-foreground">
                    Row {i + 1}
                  </p>
                ))}
              </div>
            </ScrollArea>
          </Spec>
          <Spec name="Separator — horizontal · vertical" note="The vertical case is h-full, so in a container with no intrinsic height it renders zero pixels tall.">
            <div className="w-full max-w-xs">
              <Separator />
            </div>
            <div className="flex h-9 items-center gap-3">
              <span className="text-sm text-muted-foreground">Left</span>
              <Separator orientation="vertical" />
              <span className="text-sm text-muted-foreground">Right</span>
            </div>
          </Spec>
        </Family>

        <Family name="EmptyState" file="empty-state.tsx">
          <Spec name="EmptyState" note="Four other 'nothing here' spellings ship alongside it, so the screens with the least on them are the least consistent screens in the product.">
            <EmptyState
              icon={<Inbox />}
              title="No flows yet"
              description="A flow pulls your tools together and answers one question about them."
              action={
                <Button>
                  <Plus /> New flow
                </Button>
              }
            />
          </Spec>
        </Family>

        <Family name="SectionHeading · SubmitButton" file="page.tsx · submit-button.tsx">
          <Spec name="SectionHeading" note="12px ALL CAPS, carrying its own mb-3.">
            <SectionHeading>Data and sync</SectionHeading>
          </Spec>
          <Spec
            name="SubmitButton"
            note="Reads useFormStatus(), so it must be inside a <form> — outside one it renders as a permanently idle Button and the pending state is unreachable."
          >
            <form action={async () => {}}>
              <SubmitButton>
                <User /> Send invite
              </SubmitButton>
            </form>
          </Spec>
        </Family>
      </div>
    </TooltipProvider>
  );
}
