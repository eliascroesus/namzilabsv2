"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Copy, Gift } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal, ModalTitle } from "@/components/ui/modal";
import { cn } from "@/lib/utils";

/**
 * TWO KINDS OF INVITE, AND THEY ARE NOT THE SAME ACT.
 *
 * "Invite" was one word doing two jobs, and the two have opposite meanings:
 *
 *   - BRING SOMEBODY INTO YOUR WORKSPACE. They see your numbers. They cost you
 *     a seat. You already trust them.
 *   - SEND SOMEBODY TO NAMZILABS. They get their own workspace, you get credit
 *     for bringing them, and they see nothing of yours.
 *
 * Shipping one button that guesses is how somebody ends up handing a
 * competitor's analyst a login, or sending their own accountant a referral
 * link. So the choice is asked out loud, once, in the shape this product
 * already uses for "which kind of thing do you want" — `view-template-picker`'s
 * two-up modal of large picture-cards, whole card is the control.
 *
 * THE PICTURES ARE DRAWN, NOT ICONS. Same argument as the template picker: a
 * 44px glyph plus a sentence asks somebody to choose between two abstractions,
 * and the fastest way to say what a thing is is to show a small one. These draw
 * the actual consequence — a shared workspace with two avatars in it, versus a
 * separate workspace with a progress bar filling.
 */

function WorkspacePreview() {
  return (
    <div className="flex h-full items-center justify-center gap-3 p-4">
      {/* One board, two people on it. The overlap is the whole picture. */}
      <div className="flex w-full max-w-[190px] flex-col gap-2 rounded-card border border-border bg-card p-3">
        <div className="flex items-center gap-1.5">
          <span className="size-5 rounded-full border-2 border-card bg-brand-400" />
          <span className="-ml-3 size-5 rounded-full border-2 border-card bg-accent-peri" />
          <span className="-ml-3 size-5 rounded-full border-2 border-card bg-accent-pink" />
          <span className="ml-1 h-1.5 w-10 rounded-full bg-muted-foreground/30" />
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="flex h-8 flex-col justify-center gap-1 rounded-control bg-muted px-1.5">
              <span className="h-1 w-8 rounded-full bg-muted-foreground/30" />
              <span className="h-1.5 w-5 rounded-full bg-foreground/50" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReferralPreview() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
      {/* Two separate boards — theirs and yours — and a bar that moves. */}
      <div className="flex w-full max-w-[190px] items-end gap-2">
        <span className="flex h-12 flex-1 flex-col justify-end gap-1 rounded-card border border-border bg-card p-1.5">
          <span className="h-1 w-6 rounded-full bg-muted-foreground/30" />
          <span className="h-1.5 w-4 rounded-full bg-foreground/50" />
        </span>
        <ArrowRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="flex h-16 flex-1 flex-col justify-end gap-1 rounded-card border border-brand-soft-line bg-brand-soft p-1.5">
          <span className="h-1 w-6 rounded-full bg-marker/40" />
          <span className="h-1.5 w-5 rounded-full bg-marker" />
        </span>
      </div>
      <span className="h-1.5 w-full max-w-[190px] overflow-hidden rounded-full bg-muted">
        <span className="block h-full w-2/3 rounded-full bg-primary" />
      </span>
    </div>
  );
}

/** The card shape both options wear, so neither can drift into its own design. */
function Choice({
  title,
  body,
  preview,
  onClick,
  href,
  cta,
  loud,
}: {
  title: string;
  body: string;
  preview: React.ReactNode;
  onClick?: () => void;
  href?: string;
  cta: string;
  loud?: boolean;
}) {
  const inner = (
    <>
      <span
        className={cn(
          "block h-32 w-full overflow-hidden rounded-card border",
          loud ? "border-brand-soft-line bg-brand-soft" : "border-border bg-muted/40",
        )}
      >
        {preview}
      </span>
      <span className="mt-4 block text-md font-semibold text-foreground">{title}</span>
      <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{body}</span>
      <span className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-marker">
        {cta}
        <ArrowRight aria-hidden className="size-4" />
      </span>
    </>
  );

  /* THE WHOLE CARD IS THE CONTROL, which the connector catalogue's rule allows
     for exactly this shape: one act per card. Same call `view-template-picker`
     makes, and for the same reason — making somebody aim at a small button
     under a large picture of the thing they are choosing is the worse
     interface. `rounded-[var(--radius-surface)]` because the arbitrary
     spelling is the one that beats `buttonVariants`' pill in `cn()`. */
  const shell = cn(
    buttonVariants({ variant: "secondary" }),
    "h-auto w-full flex-col items-start justify-start whitespace-normal rounded-[var(--radius-surface)] p-4 text-left hover:border-marker",
  );

  return href ? (
    <Link href={href} className={shell} onClick={onClick}>
      {inner}
    </Link>
  ) : (
    <Button type="button" variant="secondary" className={shell} onClick={onClick}>
      {inner}
    </Button>
  );
}

export function InvitePicker({
  link,
  count,
  onClose,
}: {
  /** The person's own referral link, already resolved on the server. */
  link: string;
  /** How many they have brought — used to make the second card specific. */
  count: number;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      // Long enough to read, short enough that the button is ready again by the
      // time somebody wants to paste it into a second place.
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A denied clipboard permission is not worth a dialog; the link is
      // selectable in the field on the page behind this.
      setCopied(false);
    }
  };

  return (
    <Modal onClose={onClose} size="lg">
      <ModalTitle>Who are you inviting?</ModalTitle>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Two different things, and it is worth getting right: one shares your numbers, the other sends somebody to build
        their own.
      </p>

      <div className="mt-5 grid items-start gap-4 sm:grid-cols-2">
        <Choice
          loud
          title="A friend, to start using Namzilabs"
          body={
            count > 0
              ? `They get their own workspace. You get credit — that is ${count + 1} toward your next reward.`
              : "They get their own workspace. You get credit toward free months of Namzilabs."
          }
          preview={<ReferralPreview />}
          cta={copied ? "Link copied" : "Copy my link"}
          onClick={copy}
        />
        <Choice
          title="Someone into this workspace"
          body="They see these metrics, this board and these connections. For people you already work with."
          preview={<WorkspacePreview />}
          cta="Open members"
          href="/dashboard/settings"
          onClick={onClose}
        />
      </div>

      {/* The link itself, under both cards, because somebody who came here to
          copy it should not have to guess that the left card does that. */}
      <div className="mt-5 flex items-center gap-2 rounded-card border border-border bg-muted/40 p-2 pl-3.5">
        <span className="stat-numeral min-w-0 flex-1 truncate text-sm text-muted-foreground">{link}</span>
        <Button type="button" variant="secondary" size="sm" onClick={copy} className="shrink-0 gap-1.5">
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </Modal>
  );
}

/** The button that opens it — used by the refer page and the rail's card. */
export function InviteButton({ link, count, className }: { link: string; count: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="accent" size="lg" className={cn("gap-2", className)} onClick={() => setOpen(true)}>
        <Gift className="size-4" />
        Invite someone
      </Button>
      {open && <InvitePicker link={link} count={count} onClose={() => setOpen(false)} />}
    </>
  );
}
