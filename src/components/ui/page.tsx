import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE PAGE SHAPE. Six container widths and three gutters existed for the
 * same kind of page; every route now states only whether it is reading
 * (default) or filling a form (narrow).
 */
export function PageContainer({
  className,
  width = "default",
  ...props
}: React.ComponentProps<"main"> & { width?: "default" | "narrow" }) {
  return (
    <main
      className={cn("mx-auto w-full px-6 py-10", width === "narrow" ? "max-w-3xl" : "max-w-5xl", className)}
      {...props}
    />
  );
}

/**
 * Title row: optional back link, one h1 recipe, optional lede, actions on
 * the right. The h1 is the ONLY page-title spelling in the product.
 */
export type PageHeaderProps = {
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
  className?: string;
};

export function PageHeader({ title, lede, actions, back, className }: PageHeaderProps) {
  return (
    <header className={cn(className)}>
      {back && (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 rounded-control text-base text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-4 focus-visible:ring-ring/40"
        >
          <ArrowLeft size={14} />
          {back.label}
        </Link>
      )}
      <div className={cn("flex flex-wrap items-center justify-between gap-3", back && "mt-3")}>
        <div className="min-w-0">
          <h1 className="text-display font-semibold tracking-tight text-foreground">{title}</h1>
          {lede && <p className="mt-1 text-base text-muted-foreground">{lede}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

/**
 * The section eyebrow — the app's ONE h2. It was 14px uppercase in five
 * files, 11px uppercase in two, 17px sentence case on the kit page and
 * stock 18px on the legal pages. This is the survivor.
 */
export function SectionHeading({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      className={cn("mb-3 text-micro font-semibold uppercase tracking-wide text-muted-foreground", className)}
      {...props}
    />
  );
}
