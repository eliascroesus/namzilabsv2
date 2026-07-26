"use client";

import { useState } from "react";

/**
 * A value the user has to move into ANOTHER application — a webhook URL, a
 * signing secret. Those are exactly the values that must not be retyped: a
 * webhook URL ends in an opaque connection id, and a mistyped character produces
 * a subscription that silently delivers nowhere.
 *
 * So the copy button is the point, not decoration. It also explains what happens
 * when there is nothing to copy: an unset APP_BASE_URL yields a path with no
 * origin, which looks like a URL, pastes cleanly, and never receives anything.
 */
export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  // Without an origin this is not something another service can POST to.
  const usable = /^https?:\/\//i.test(value);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard denied (insecure origin, permissions): the value stays
      // selectable in the field, so the user is never stuck.
    }
  };

  return (
    <div className="mb-2">
      <span className="text-xs text-neutral-500">{label}</span>
      <div className="mt-0.5 flex items-stretch gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs leading-5">
          {value}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          disabled={!usable}
          className="shrink-0 rounded border border-neutral-300 px-3 py-2 text-xs font-medium hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={`Copy ${label}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {!usable && (
        <p className="mt-1 text-xs text-amber-700">
          This is missing its https://… prefix, so nothing can post to it. Set <code>APP_BASE_URL</code> to
          the app&rsquo;s public URL and reload.
        </p>
      )}
      {usable && hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
