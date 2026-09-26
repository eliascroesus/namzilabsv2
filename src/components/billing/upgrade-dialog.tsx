"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Modal, ModalTitle } from "@/components/ui/modal";

/**
 * "PLEASE UPGRADE" — what a locked metric, or a refused publish, opens.
 *
 * It sells nothing itself: it says what happened in one sentence, promises
 * nothing was deleted, and sends them to the plan picker, which knows whether
 * to offer a trial, Checkout or Stripe's portal. The parent mounts it while
 * open, the way every `Modal` in the app is used.
 */
export function UpgradeDialog({
  title,
  message,
  href = "/dashboard/settings/billing",
  onClose,
}: {
  title: string;
  message: string;
  href?: string;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} size="sm">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-marker">
          <Lock size={16} aria-hidden />
        </span>
        <div className="min-w-0">
          <ModalTitle>{title}</ModalTitle>
          <p className="mt-1.5 text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Not now
        </Button>
        <Link href={href} className={buttonVariants({ variant: "accent" })}>
          See plans
        </Link>
      </div>
    </Modal>
  );
}
