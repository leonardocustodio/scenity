// SPDX-License-Identifier: Apache-2.0
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

export { default as Toggle } from "./Toggle.vue";

/**
 * The toggle of shadcn-vue. "On" has a tint of the accent and the accent text color, so it differs from the
 * hover color. On a touch screen, each size is at least the touch target.
 */
export const toggleVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary/10 data-[state=on]:text-accent-text [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 transition-[color,box-shadow] aria-invalid:ring-destructive/20 aria-invalid:border-destructive whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-2 min-w-9 pointer-coarse:min-h-target-touch",
        sm: "h-8 px-1.5 min-w-8 pointer-coarse:min-h-target-touch",
        lg: "h-10 px-2.5 min-w-10 pointer-coarse:min-h-target-touch",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ToggleVariants = VariantProps<typeof toggleVariants>;
