import Link from "next/link";
import { withAuth } from "@workos-inc/authkit-nextjs";

export default async function Home() {
  const { user } = await withAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">Namzilabs</span>
        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <Link className="rounded-md bg-neutral-900 px-4 py-2 font-medium text-white" href="/dashboard">
              Dashboard
            </Link>
          ) : (
            <>
              <a className="text-neutral-600 hover:text-neutral-900" href="/sign-in">
                Sign in
              </a>
              <a className="rounded-md bg-neutral-900 px-4 py-2 font-medium text-white" href="/sign-up">
                Get started
              </a>
            </>
          )}
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6 py-24 text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-neutral-900 sm:text-5xl">
          All your tools&rsquo; data, in one reliable place.
        </h1>
        <p className="mt-6 max-w-xl text-lg text-neutral-600">
          Namzilabs unifies Calendly, Close, Instantly, Sendblue, Google Sheets and more into one
          live dashboard &mdash; so you can see booked leads, calls, replies and SMS across every
          platform without logging into ten of them.
        </p>
        <div className="mt-10 flex items-center gap-4">
          <a
            className="rounded-md bg-neutral-900 px-6 py-3 font-medium text-white hover:bg-neutral-800"
            href={user ? "/dashboard" : "/sign-up"}
          >
            {user ? "Go to dashboard" : "Start free"}
          </a>
          {!user && (
            <a className="px-6 py-3 font-medium text-neutral-700 hover:text-neutral-900" href="/sign-in">
              Sign in
            </a>
          )}
        </div>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6 text-sm text-neutral-500">
        <span>&copy; {new Date().getFullYear()} Namzilabs</span>
        <nav className="flex gap-5">
          <Link className="hover:text-neutral-800" href="/terms">
            Terms
          </Link>
          <Link className="hover:text-neutral-800" href="/privacy">
            Privacy
          </Link>
        </nav>
      </footer>
    </div>
  );
}
