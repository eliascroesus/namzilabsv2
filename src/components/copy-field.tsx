"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * A value the user has to move into ANOTHER application — a webhook URL, a
 * signing secret. Those are exactly the values that must not be retyped: a
 * webhook URL ends in an opaque connection id, and a mistyped character produces
 * a subscription that silently delivers nowhere.
 *
 * `isUrl` opts a field into the origin check, and only a URL may opt in. An
 * unset APP_BASE_URL yields a path with no origin, which still looks like a URL
 * and pastes cleanly but can never receive anything — worth refusing to hand
 * over. Applying that check to every field was a real bug: it fired on the
 * signing secret, which has no reason to begin with https://, and disabled the
 * button for the one value on the page that cannot be reconstructed from
 * anywhere else.
 */
export function CopyField({
  label,
  value,
  hint,
  isUrl = false,
}: {
  label: string;
  value: string;
  hint?: string;
  /** True only for values another service must POST to. */
  isUrl?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const usable = !isUrl || /^https?:\/\//i.test(value);

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
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="mt-0.5 flex items-center gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-control border border-border bg-muted/50 px-3 py-2 font-mono text-xs">
          {value}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0"
          onClick={() => void copy()}
          disabled={!usable}
          aria-label={`Copy ${label}`}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {!usable && (
        <p className="mt-1 text-xs text-warn-ink">
          This is missing its https://… prefix, so nothing can post to it. Set{" "}
          <code>APP_BASE_URL</code> to the app&rsquo;s public URL and reload.
        </p>
      )}
      {usable && hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
