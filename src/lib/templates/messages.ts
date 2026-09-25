/**
 * WHAT SETTINGS → TEMPLATES SAYS WHEN AN ACT IS REFUSED — keyed by the code the
 * action puts in the URL, never by the sentence itself.
 *
 * `?template_error=` is a link anybody can craft and send to a workspace admin,
 * so the page prints only words from this table: an unknown code prints the
 * generic line rather than whatever text arrived. The same rule the public
 * template page follows for `?error=` (see `src/app/t/actions.ts`).
 */
export const TEMPLATE_ERRORS = {
  admin: "Only workspace admins can share templates.",
  name: "Give the template a name of up to 80 characters.",
  description: "Keep the description under 300 characters.",
  views_none: "Pick at least one view to share.",
  views_gone: "Those views aren't in this workspace any more. Reload and pick again.",
  gone: "That template isn't in this workspace any more.",
  sources_gone: "Every view this template was made from has been deleted. Share a view again to make a new one.",
  views: "A template can hold at most 30 views. Untick a few and try again.",
  size: "These views hold too much text to share as one template. Share fewer views, or shorten the longest text blocks.",
  shape: "Something on these views couldn't be turned into a template.",
  unavailable: "Templates aren't switched on yet — the database update they need is still pending.",
  failed: "Something went wrong saving that template. Try again in a moment.",
} as const;

export type TemplateErrorCode = keyof typeof TEMPLATE_ERRORS;

export function templateErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return Object.hasOwn(TEMPLATE_ERRORS, code) ? TEMPLATE_ERRORS[code as TemplateErrorCode] : TEMPLATE_ERRORS.failed;
}
