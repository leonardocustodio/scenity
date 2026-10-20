// SPDX-License-Identifier: Apache-2.0
import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

export { default as Badge } from "./Badge.vue";

// No color transition: a badge changes with a state, and the new state shows at once. An axe check in a transition
// measures a mixed color.
export const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none aria-invalid:ring-destructive/20 aria-invalid:border-destructive overflow-hidden",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-accent-brand-hover",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        destructive: "border-transparent bg-destructive text-text-on-accent [a&]:hover:bg-destructive/90 ",
        outline: "text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        // Status badges: a subtle tint, a status border and the primary text, so the text keeps its contrast.
        success: "border-status-positive bg-status-positive-subtle text-text-primary",
        warning: "border-status-caution bg-status-caution-subtle text-text-primary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
export type BadgeVariants = VariantProps<typeof badgeVariants>;
