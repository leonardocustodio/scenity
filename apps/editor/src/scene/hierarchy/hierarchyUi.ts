// SPDX-License-Identifier: Apache-2.0
/**
 * The shared classes of the hierarchy panel of the scene page, in the idiom of the inspector panel
 * (`inspector/inspectorUi.ts`): the token classes of `@scenity/ui`. The texts of the panel are Fluent messages
 * of `src/i18n/en-US/hierarchy.ftl`.
 */

/**
 * The height of a row of the virtual tree in units of `--spacing` (the class `h-7`), and in pixels at the
 * default text size (the panel measures the real height).
 */
export const ROW_UNITS = 7;
export const ROW_HEIGHT = 28;

/** A row of the tree (one height: the virtual list counts the rows by it). */
export const rowClass =
  "relative flex h-7 shrink-0 cursor-default select-none items-center gap-0.5 rounded-control pr-0.5 text-caption text-text-primary outline-none focus-visible:ring-1 focus-visible:ring-accent-brand";
/** A button with one sign (expand, hide, solo, lock). */
export const iconButton =
  "inline-flex size-6 shrink-0 items-center justify-center rounded-control text-text-secondary hover:bg-surface-raised hover:text-text-primary";
/** A toggle that is on. */
export const toggleOn = "text-accent-brand hover:text-accent-brand";
/** The search field. */
export const searchField =
  "min-h-7 w-full min-w-0 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary placeholder:text-text-secondary";
/** A small button of the panel. */
export const button =
  "rounded-control border border-border-subtle bg-surface-sunken px-1.5 py-0.5 text-caption text-text-primary hover:border-border-strong disabled:opacity-50";

/** The drag type of hierarchy rows: the IDs of the dragged entities, joined with commas. */
export const ENTITY_DRAG_TYPE = "application/x-scenity-entities";
