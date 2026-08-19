"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The app's primary navigation.
 *
 * It used to be three undifferentiated grey links, so the header could not
 * answer "where am I" — on a product where Dashboard, Flows and Integrations
 * all render a white page with a heading, that is the only cue there is.
 * The active item now carries a filled pill, the way Make and Zapier both
 * mark place.
 *
 * `Flows` is matched by prefix so the builder itself (`/dashboard/flows/<id>`)
 * still highlights it — and `Dashboard` is matched EXACTLY, or it would light
 * up for every flow page too, since they all live under /dashboard.
 */
const ITEMS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/dashboard", label: "Dashboard", exact: true },
  { href: "/dashboard/flows", label: "Flows" },
  { href: "/integrations", label: "Integrations" },
  { href: "/dashboard/settings", label: "Settings" },
];

export function MainNav() {
  const pathname = usePathname() ?? "";
  const isActive = (item: (typeof ITEMS)[number]) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);

  return (
    <nav className="flex items-center gap-1 text-sm">
      {ITEMS.map((item) => {
        const active = isActive(item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
              active ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The wordmark: a small dark tile carrying the initial, then the name.
 *
 * A product whose header opened with plain 14px text read as an internal admin
 * page rather than something a company pays for. One mark, used everywhere,
 * is the cheapest possible fix and the one every comparable tool has.
 */
export function BrandMark({ href = "/dashboard" }: { href?: string }) {
  return (
    <Link href={href} className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-neutral-900 text-[13px] font-bold text-white" aria-hidden>
        N
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-neutral-900">Namzilabs</span>
    </Link>
  );
}
