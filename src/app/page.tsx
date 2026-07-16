export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Namzilabs</h1>
      <p className="mt-4 text-neutral-600">
        One reliable place for all your tools&rsquo; data. The reliability engine is live; the
        integrations gallery, metric builder and dashboard come next.
      </p>
      <div className="mt-8 flex gap-4 text-sm">
        <a className="text-blue-600 underline" href="/admin">
          Engine admin
        </a>
        <a className="text-blue-600 underline" href="/api/health">
          Health
        </a>
      </div>
    </main>
  );
}
