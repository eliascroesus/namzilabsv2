import { cn } from "@/lib/utils";

/**
 * THE SPINE.
 *
 * Every section on this page sits on one 12-column grid: the claim on columns
 * 1–5, the evidence on 6–12. Not 6/6 — equal halves read as a comparison
 * table, and this page is making an argument, not drawing a spec sheet.
 *
 * THE PADDING RHYTHM LIVES HERE AND NOWHERE ELSE. The old page set its own
 * `py-*` on every section, which is how a page ends up with four different
 * section heights nobody chose. One component owns it, so spacing cannot
 * drift.
 *
 * ONLY THE HERO AND THE CLOSING BLOCK ARE CENTRED. Everything else is
 * asymmetric, because the previous page was centred everywhere and that is the
 * single biggest reason it read as templated.
 */
export function SectionShell({
  id,
  label,
  title,
  standfirst,
  tone = "paper",
  children,
  className,
}: {
  id?: string;
  label: string;
  title: React.ReactNode;
  standfirst?: string;
  /** `ink` is the full-bleed break in the paper rhythm. */
  tone?: "paper" | "sunk" | "ink";
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-24 px-5 py-24 sm:px-8 lg:py-40",
        tone === "ink" && "ink-block",
        tone === "sunk" && "bg-[var(--paper-sunk)]",
        className,
      )}
    >
      <div className="mx-auto w-full max-w-[72rem]">
        {/* The head is the spine's first row: claim left, standfirst right. */}
        <div className="grid gap-x-8 gap-y-5 lg:grid-cols-12">
          <div className="lg:col-span-5">
            {/* SENTENCE CASE, NOT A TRACKED-OUT CAPITALISED EYEBROW — the
                convention the page already had, and the one the brief keeps. */}
            <p className="t-label">{label}</p>
            {/* NO `text-balance`. Every H2 on this page carries its own line
                breaks from the copy, and the balancer re-breaks them — it
                turned a deliberate two-line heading into three ragged ones. A
                manual break and an automatic balancer are two answers to the
                same question. */}
            <h2 className="t-display-md mt-3" style={{ color: "var(--ink)" }}>
              {title}
            </h2>
          </div>
          {standfirst && (
            <p className="t-body-lg lg:col-span-6 lg:col-start-7 lg:self-end" style={{ color: "var(--ink-muted)" }}>
              {standfirst}
            </p>
          )}
        </div>

        {children && <div className="mt-14 lg:mt-20">{children}</div>}
      </div>
    </section>
  );
}
