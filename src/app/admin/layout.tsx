import Link from "next/link";
import { requireStaff } from "@/lib/admin/access";
import { AdminTabs } from "@/components/admin/admin-tabs";

export const dynamic = "force-dynamic";

/**
 * THE ADMIN AREA'S CHROME, AND ITS OUTERMOST GATE.
 *
 * DELIBERATELY NOT `AppShell`. The product's shell needs an org context and
 * renders the customer's navigation rail, neither of which belongs here: staff
 * looking at the fleet are not inside a workspace, and a back office that
 * borrows the product's frame invites the reader to confuse the two. This is a
 * different application that happens to share a deployment.
 *
 * THE GATE IS HERE **AND** IN EVERY QUERY. A layout is a rendering
 * convenience, not a security boundary — it does not wrap route handlers, and
 * relying on it means one new page or one new fetch is all it takes to bypass.
 * Every function in `src/lib/admin/` calls `requireStaff()` for itself. This
 * call is the outer wall, the same relationship `src/proxy.ts` has with
 * `requireOrg()` everywhere else.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <Link href="/admin" className="text-sm font-semibold">
            Namzilabs admin
          </Link>
          <AdminTabs />
          {/*
            Who is looking. On a surface that reads every tenant, "which staff
            account am I signed in as" should never be a question — it is the
            one thing that makes an audit row meaningful afterwards.
          */}
          <span className="ml-auto hidden truncate text-xs text-muted-foreground md:inline">{staff.email}</span>
          <Link href="/dashboard" className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-foreground md:ml-0">
            Back to app
          </Link>
        </div>
      </header>
      {children}
    </div>
  );
}
