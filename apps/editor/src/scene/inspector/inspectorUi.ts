// SPDX-License-Identifier: Apache-2.0
/**
 * The shared classes and words of the inspector panel of the scene page, in the idiom of the lab panel
 * (`core/labUi.ts`): the token classes of `@scenity/ui`. The texts of the panel are Fluent messages of
 * `src/i18n/en-US/inspector.ftl`.
 */

/** A text or number field. */
export const field =
  "min-h-7 w-full min-w-0 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary placeholder:text-text-secondary";
/** A select of the panel. */
export const selectField =
  "min-h-7 w-full min-w-0 rounded-control border border-border-subtle bg-surface-sunken px-1 text-caption text-text-primary";
/** A small button of the panel. */
export const button =
  "rounded-control border border-border-subtle bg-surface-sunken px-1.5 py-0.5 text-caption text-text-primary hover:border-border-strong disabled:opacity-50";
/** A button with one sign (remove, reset). */
export const iconButton =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-control text-text-secondary hover:bg-surface-raised hover:text-text-primary";

/** The placeholder of a field whose subjects have different values. */
export const MIXED = "—";

/** The test ID of a field: "field", the component ID and the path tokens, with "-" between them. */
export function fieldTestId(component: string, path: readonly string[]): string {
  return ["field", component, ...path].join("-");
}
