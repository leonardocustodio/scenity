// SPDX-License-Identifier: Apache-2.0
/**
 * Join class names and resolve Tailwind conflicts (the shadcn-vue `cn` helper). A later class wins over
 * an earlier class of the same utility group, so a caller can change one detail of a component.
 */
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The token theme adds text sizes (type roles) that tailwind-merge must know as font sizes, not colors.
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "vital-primary",
            "vital-secondary",
            "vital-label",
            "clock",
            "display",
            "title",
            "body",
            "label",
            "caption",
            "subtitle",
          ],
        },
      ],
    },
  },
});

export type { ClassValue };

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
