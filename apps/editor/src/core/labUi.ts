// SPDX-License-Identifier: Apache-2.0
/**
 * The shared classes and words of the lab panel (the labs app at "/"). This file has no interface text: the texts are
 * Fluent messages of `src/i18n/en-US/lab-core.ftl`. `words()` shows a data value.
 */

/** A small button of the panel. */
export const button =
  "rounded-control border border-border-subtle bg-surface-sunken px-2 py-1 text-caption text-text-primary hover:border-border-strong";
/** A button of a segmented control (one value of a short list) and the button of the value in use. */
export const segment =
  "min-h-9 flex-1 rounded-control px-2 text-caption text-text-secondary hover:text-text-primary pointer-coarse:min-h-11";
export const segmentOn = "bg-surface-raised text-text-primary shadow-raised";
/** A button of a grid of choices (the animations, the members) and the button of the choice in use. */
export const choice =
  "flex min-h-10 flex-col items-start justify-center rounded-control border border-border-subtle bg-surface-sunken px-2.5 py-1.5 text-left text-caption text-text-primary hover:border-border-strong pointer-coarse:min-h-11";
export const choiceOn = "border-accent-brand bg-accent-brand/15";
export const select =
  "min-h-9 w-full rounded-control border border-border-subtle bg-surface-sunken px-2 text-caption text-text-primary pointer-coarse:min-h-11";

/** A value of a list as words: "endotracheal_tube" is "Endotracheal tube". */
export function words(value: string): string {
  const text = value.replaceAll("_", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A simulation time as minutes and seconds, "1:05". */
export function clockText(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, "0")}`;
}

/** True for a key press in a text field or a select of the panel: the letter goes to the field. */
export function typingInto(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select") !== null)
  );
}
