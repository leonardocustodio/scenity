// SPDX-License-Identifier: Apache-2.0
/**
 * Shared class variants of the primitives (shadcn-vue pattern with class-variance-authority). Every value
 * is a token utility: colors, radii, spacing and type roles come from @scenity/tokens.
 */
import { cva, type VariantProps } from "class-variance-authority";

/** Focus ring of controls that draw their own ring (the base style covers :focus-visible). */
export const focusRing =
  "focus-visible:outline-(length:--sc-focus-width) focus-visible:outline-offset-(length:--sc-focus-offset)";

/**
 * Target sizes (WCAG 2.5.8): at least 24 x 24 CSS px everywhere and 44 x 44 for primary targets on touch
 * screens. A label that is wider than the container wraps (text expansion), so the button is never wider than
 * its container.
 */
export const buttonVariants = cva(
  [
    "inline-flex max-w-full shrink-0 items-center justify-center gap-2 rounded-button border text-center font-medium select-none",
    "transition-colors duration-fast ease-standard",
    "disabled:cursor-not-allowed disabled:opacity-(--sc-opacity-disabled)",
    "aria-[invalid=true]:border-status-attention",
  ],
  {
    variants: {
      variant: {
        primary: "border-transparent bg-accent-brand text-text-on-accent hover:bg-accent-brand-hover sc-forced-border",
        secondary: "border-border-strong bg-surface-raised text-text-primary hover:bg-surface-overlay",
        ghost: "border-transparent bg-transparent text-accent-text hover:bg-surface-overlay",
      },
      size: {
        sm: "min-h-target-min min-w-target-min px-2 text-caption",
        md: "min-h-10 min-w-10 px-4 text-label pointer-coarse:min-h-target-touch",
        lg: "min-h-target-touch min-w-target-touch px-6 text-body",
        icon: "size-10 pointer-coarse:size-target-touch",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

/** Fields: text inputs, select triggers and combobox inputs. */
export const fieldVariants = cva([
  "flex min-h-10 w-full items-center gap-2 rounded-control border border-border-strong bg-surface-raised px-3 text-body text-text-primary",
  "pointer-coarse:min-h-target-touch placeholder:text-text-secondary",
  "disabled:cursor-not-allowed disabled:opacity-(--sc-opacity-disabled) data-[disabled]:cursor-not-allowed data-[disabled]:opacity-(--sc-opacity-disabled)",
  "aria-[invalid=true]:border-2 aria-[invalid=true]:border-status-attention",
]);

/** Floating panels: menus, popovers, select and combobox lists. */
export const panelClass =
  "z-50 min-w-48 rounded-card border border-border-subtle bg-surface-overlay p-1 text-text-primary shadow-overlay";

/** One item of a menu or a list. */
export const itemClass = [
  "relative flex min-h-target-min cursor-default items-center gap-2 rounded-control px-2 py-1.5 text-label outline-none select-none",
  "pointer-coarse:min-h-target-touch",
  "data-[highlighted]:bg-surface-sunken data-[disabled]:pointer-events-none data-[disabled]:opacity-(--sc-opacity-disabled)",
].join(" ");
