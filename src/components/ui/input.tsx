import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * THE FIELD RECIPE. One box, one border, one focus behaviour — the app had
 * twelve input class strings, eight of which had no focus state at all.
 *
 * `focus-visible` (not `focus:`) on purpose: text inputs match
 * `:focus-visible` whenever they hold focus — clicked or tabbed — because
 * they accept keyboard input, so fields always show the ring and buttons
 * only show it to keyboard users. One rule, both behaviours.
 */
// A TEXT FIELD KEEPS ITS OWN TREATMENT, and is the one control excluded from
// the shared outline rule in globals.css. The reason is that a field is a place
// you are IN rather than a thing you pressed: the border itself going violet
// plus a soft halo says "typing lands here", where a detached outline ring says
// "this is selected". Buttons want the second, fields the first.
// `hover:border-neutral-500` gives a field the pointer feedback every other
// control in the kit already had.
//
// `aria-invalid:border-destructive` because the message under a bad field was
// carrying the whole state on its own: the box it refers to looked exactly like
// the four correct ones above it. The border is the second signal, not the only
// one — FieldError is still the thing that says what is wrong.
//
// EVERYTHING EXCEPT THE RADIUS lives here, because the radius is the one part
// of the recipe a multi-line box disagrees with (see Textarea). Composing off a
// base is not the same as overriding it: `cn()` cannot resolve `rounded-card`
// against `rounded-control` — tailwind-merge knows Tailwind's radius names, not
// the kit's, so an override emits BOTH classes and lets stylesheet order pick
// the winner. Verified, not assumed.
const FIELD_BASE =
  "w-full border border-input bg-control text-sm text-foreground transition-colors duration-(--duration-fast) placeholder:text-muted-foreground hover:border-neutral-500 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive disabled:pointer-events-none disabled:opacity-50 disabled:bg-muted";

/**
 * THE SHEET IS PILL-FIRST, so a single-line field is fully round — the same
 * `rounded-control` (9999px) the button beside it takes. That is also why the
 * padding below is px-4 where a rounded rectangle wanted px-3: a pill's corner
 * curve reaches much further into the box, and text set tight against it reads
 * as though it is sliding out of one end.
 */
const FIELD = `${FIELD_BASE} rounded-control`;

/**
 * AUTOFILL IS OFF BY DEFAULT, AND SO IS SPELLCHECK.
 *
 * Twenty-two of this app's twenty-three fields ask for something no browser has
 * ever stored: a metric name, a JSON field path (`properties.plan`), a funnel
 * stage label, an API key, a search string. Left at the browser default, those
 * fields all advertise themselves for autofill — so typing in "Connection name"
 * drops a saved-address dropdown over the form, and every password manager in
 * the world offers to fill an API-key box with somebody's email.
 *
 * Spellcheck is wrong on the same fields for the same reason: red squiggles
 * under `properties.plan` and `gsheets` say the value is a mistake when it is
 * the whole point.
 *
 * Both are DEFAULTS, not locks — the one field that genuinely wants autofill
 * (the teammate-invite email) passes `autoComplete="email"` and gets it. Doing
 * it here rather than at each call site is the difference between a rule and a
 * thing twenty-three files have to remember.
 *
 * Textarea deliberately does NOT inherit the spellcheck default: the only
 * multi-line fields in the app take prose, where squiggles are a feature.
 */

/**
 * THE OPT-OUT EVERY PASSWORD MANAGER ACTUALLY READS.
 *
 * `autocomplete="off"` does not work on a password field and has not for years:
 * Chrome, Safari and Firefox all ignore it there on purpose, because sites
 * abused it to break legitimate password managers. So a field that says "off"
 * and means it has to say so in each vendor's own dialect. These four are the
 * documented attributes, one per manager, and they are cheap: an attribute a
 * manager does not know is an attribute it skips.
 *
 * The `<meta>`-style presence attribute for 1Password is empty-valued by its
 * own spec — React renders `data-1p-ignore=""`, which is what it looks for.
 */
export const NO_AUTOFILL = {
  "data-lpignore": "true", // LastPass
  "data-1p-ignore": "", // 1Password
  "data-bwignore": "true", // Bitwarden
  "data-form-type": "other", // Dashlane
} as const;

export function Input({ className, autoComplete, spellCheck, type, ...props }: React.ComponentProps<"input">) {
  /**
   * A SECRET FIELD IS NOT A PASSWORD FIELD, AND THE BROWSER CANNOT TELL.
   *
   * Every masked field in this product holds an API key or a personal access
   * token — a value the user pastes once from another tab and never types
   * again. No password manager has it saved, so anything it fills in here is
   * wrong by construction: the credentials for some unrelated site, dropped
   * into a box that will be encrypted and sent to Close or Calendly.
   *
   * That is what was happening. The field carried `autoComplete="off"`, which
   * a password field is the one place browsers deliberately IGNORE, so simply
   * opening the Apps tab was enough for a manager to fill seven collapsed
   * connect forms at once — every connector's form is in the DOM whether its
   * `<details>` is open or not.
   *
   * `new-password` is the documented way to say "this is not the saved one",
   * and it is the only value Chrome honours on a masked field. The vendor
   * attributes above cover the extensions, which honour nothing else.
   */
  const secret = type === "password";
  // h-8 px-3 — the default Button's geometry EXACTLY, because the two are almost
  // always stacked (a field, then the submit under it) and two controls four
  // pixels apart read as a rendering fault rather than as a hierarchy.
  //
  // This has now followed the button down twice: h-9 when the button was h-9,
  // h-10 when it was h-10, and h-8 now that the console's control height is 32.
  // The note is kept as the record of WHY it follows rather than leads — a form
  // is the one place the mismatch is unmissable.
  return (
    <input
      type={type}
      className={cn(FIELD, "h-8 px-3", className)}
      autoComplete={autoComplete ?? (secret ? "new-password" : "off")}
      spellCheck={spellCheck ?? false}
      {...(secret ? NO_AUTOFILL : {})}
      {...props}
    />
  );
}

/**
 * THE MULTI-LINE FIELD, AND THE ONE PLACE THE PILL STOPS.
 *
 * `rounded-control` is 9999px, which on an 80px-tall box is not a pill but a
 * stadium — the corner curve arcs across the first and last line of whatever
 * was typed. The sheet draws BUTTONS, INPUTS AND MENU ROWS round, and a
 * paragraph box is none of the three, so it takes the card radius instead.
 * It keeps the field's px-4 so that a form of stacked fields still has one
 * left edge down the whole column.
 */
export function Textarea({ className, autoComplete, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(FIELD_BASE, "min-h-20 rounded-control px-3 py-2", className)}
      autoComplete={autoComplete ?? "off"}
      {...props}
    />
  );
}

/**
 * The native <select>, dressed as an Input. Native on purpose: the OS picker
 * is better than anything we would hand-roll for plain option lists — the
 * builder's searchable combobox is a different component for a different job.
 */
export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <span className={cn("relative inline-flex w-full", className)}>
      {/* The chevron sits at `right-4`, mirroring the `pl-4` on the other end,
          so the pill is inset by the same 16px on both sides. `pr-10` is that
          inset plus the icon: without it the longest option runs underneath
          the chevron instead of stopping short of it. */}
      <select className={cn(FIELD, "h-8 appearance-none pl-3 pr-8")} {...props}>
        {children}
      </select>
      <ChevronDown
        size={16}
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

export { FIELD as fieldClasses };
