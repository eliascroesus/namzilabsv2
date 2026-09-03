import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/page";
import { CopyField } from "@/components/copy-field";
import { formatDateTime } from "@/lib/format";
import { mcpEnabled, mcpResourceUrl } from "@/lib/mcp/env";
import type { GrantRow } from "@/lib/mcp/workspace";
import { setAiAssistantsEnabledAction, disconnectAssistantAction } from "./ai-actions";

/**
 * Settings → AI assistants. The one place a workspace's connection to Claude
 * or ChatGPT is explained, switched off, and audited row by row.
 *
 * Deliberately its own file rather than another block inside page.tsx: it is
 * the one section with real branching (disabled deployment, non-admin,
 * empty grant list) and its own two actions, and page.tsx is long enough
 * already.
 *
 * WHY THE SWITCH IS A PLAIN FORM, NOT A KIT SWITCH: this section reuses only
 * the primitives page.tsx itself already renders with — Card, SectionHeading,
 * CopyField, Button — the same discipline as every other section on this
 * page. A toggle rendered as two Buttons (Turn on / Turn off) needs nothing
 * this page has not already imported.
 *
 * ERRORS FOLLOW page.tsx's OWN `?invite_error=` CONVENTION (fix round 1):
 * `setAiAssistantsEnabledAction`/`disconnectAssistantAction` stay plain
 * `{ ok, error? }`-returning actions (tests/settings-ai-actions.test.ts calls
 * them directly and asserts on that return value), so the redirect-on-refusal
 * lives in the inline `"use server"` closure that calls each one from its
 * form — the same shape `inviteMemberAction` uses, just one level further
 * out. A `?ai_error=` on the refusal path, and a bare redirect back to the
 * plain URL on success so a stale error from an earlier attempt cannot
 * outlive it.
 */
export function AiAssistantsSection({
  isAdmin,
  currentUserId,
  aiAssistantsEnabled,
  grants,
  emailByUser,
  error,
}: {
  isAdmin: boolean;
  currentUserId: string;
  aiAssistantsEnabled: boolean;
  grants: GrantRow[];
  /** WorkOS user id → email, the same map page.tsx builds for the Members list. */
  emailByUser: Map<string, string>;
  error?: string;
}) {
  if (!mcpEnabled()) {
    return (
      <section>
        <Card variant="surface" padding="none" className="overflow-hidden">
          <header className="px-5 py-4">
            <SectionHeading className="mb-0 text-foreground">AI assistants</SectionHeading>
          </header>
          <div className="border-t border-border px-5 py-4 text-sm text-muted-foreground">
            AI assistants are not enabled on this deployment yet.
          </div>
        </Card>
      </section>
    );
  }

  // `mcpResourceUrl()` throws when neither MCP_RESOURCE_URL nor APP_BASE_URL
  // is set (src/lib/mcp/env.ts) — a real state on a fresh deployment that has
  // flipped MCP_ENABLED on before finishing its env setup. The section must
  // still render, with a placeholder telling the admin what to set.
  let resourceUrl: string;
  try {
    resourceUrl = mcpResourceUrl();
  } catch {
    resourceUrl = "Set MCP_RESOURCE_URL to get this workspace's connection URL.";
  }

  return (
    <section>
      <Card variant="surface" padding="none" className="overflow-hidden">
        <header className="px-5 py-4">
          <SectionHeading className="mb-0 text-foreground">AI assistants</SectionHeading>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
            Connect Claude or ChatGPT to this workspace's dashboard. It is read-only.
          </p>
        </header>

        <div className="border-t border-border px-5 py-4">
          {error && <p className="mb-4 text-sm text-danger-ink">{error}</p>}

          <CopyField
            label="Connection URL"
            value={resourceUrl}
            isUrl
            hint="Paste this into the assistant's connector settings — see below."
          />

          <div className="mt-4 grid gap-4 text-sm text-muted-foreground sm:grid-cols-2">
            <div>
              <p className="font-semibold text-foreground">Claude</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>Customize</li>
                <li>Connectors</li>
                <li>Add custom connector</li>
                <li>Paste the URL above</li>
              </ol>
            </div>
            <div>
              <p className="font-semibold text-foreground">ChatGPT</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                <li>Settings</li>
                <li>Apps</li>
                <li>Advanced</li>
                <li>Developer mode</li>
                <li>Create</li>
                <li>Paste the URL above</li>
              </ol>
            </div>
          </div>

          <p className="mt-4 text-sm text-muted-foreground">
            A connected assistant can see the metrics your role can see, and sources if your role can view
            integrations; never credentials.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Removing a member from the workspace cuts off their assistant within a minute.
          </p>

          {/* The state sentence is for EVERYONE — a member walked through the
              connect steps above needs to know whether the switch is even on
              before they try. Only the control that flips it is admin-only. */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-sm text-foreground">
              AI assistants are currently <b>{aiAssistantsEnabled ? "on" : "off"}</b> for this workspace.
            </p>
            {isAdmin && (
              <form
                action={async () => {
                  "use server";
                  const r = await setAiAssistantsEnabledAction(!aiAssistantsEnabled);
                  if (!r.ok) redirect(`/dashboard/settings?ai_error=${encodeURIComponent(r.error)}`);
                  redirect("/dashboard/settings");
                }}
              >
                <Button type="submit" variant={aiAssistantsEnabled ? "destructiveGhost" : "accent"} size="sm">
                  {aiAssistantsEnabled ? "Turn off" : "Turn on"}
                </Button>
              </form>
            )}
          </div>

          <div className="mt-4 divide-y divide-border border-t border-border">
            {grants.length === 0 && (
              <p className="py-3 text-sm text-muted-foreground">No assistant has connected to this workspace yet.</p>
            )}
            {grants.map((g) => {
              const isSelf = g.userId === currentUserId;
              const revoked = g.revokedAt !== null;
              const clientsLabel = g.clients === 0 ? "no clients connected" : `${g.clients} client${g.clients === 1 ? "" : "s"}`;
              const label = isSelf ? "You" : (emailByUser.get(g.userId) ?? g.userId);
              return (
                <div key={g.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {g.lastUsedAt ? `Last used ${formatDateTime(g.lastUsedAt)}` : "Never used"}
                      {" · "}
                      {clientsLabel}
                      {revoked && " · disconnected"}
                    </p>
                  </div>
                  {!revoked && (isSelf || isAdmin) && (
                    <form
                      action={async () => {
                        "use server";
                        const r = await disconnectAssistantAction(g.userId);
                        if (!r.ok) redirect(`/dashboard/settings?ai_error=${encodeURIComponent(r.error)}`);
                        redirect("/dashboard/settings");
                      }}
                    >
                      <Button type="submit" variant="destructiveGhost" size="sm">
                        Disconnect
                      </Button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </section>
  );
}
