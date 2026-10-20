// SPDX-License-Identifier: Apache-2.0
// The adapter of the shadcn-vue CLI output (scripts/adapt-shadcn.ts).
import { describe, expect, test } from "bun:test";
import { adapt } from "../scripts/adapt-shadcn";

const CLI_OUTPUT = `<script setup lang="ts">
import type { DialogContentProps } from "reka-ui"
import { X } from "@lucide/vue"
import { DialogContent, DialogPortal, useForwardPropsEmits } from "reka-ui"
import { cn } from '@scenity/ui/lib/utils'
import { Button } from '@scenity/ui/components/ui/button'

const props = defineProps<DialogContentProps>()
const forwarded = useForwardPropsEmits(props, emits)
</script>

<template>
  <DialogPortal>
    <DialogContent
      v-bind="forwarded"
      :class="cn('bg-background line-clamp-2 dark:bg-input/30 outline-none focus-visible:ring-[3px] text-white', props.class)"
    >
      <slot v-bind="forwarded" />
    </DialogContent>
  </DialogPortal>
</template>
`;

describe("adapt", () => {
  const out = adapt("DialogContent.vue", CLI_OUTPUT);

  test("makes the imports relative and uses lucide-vue-next", () => {
    expect(out).toContain('import { X } from "lucide-vue-next"');
    expect(out).toContain('from "../button"');
    expect(out).toContain('import { cn, forwardable } from "../../../lib/utils";');
    expect(out).not.toContain("@scenity/ui/");
  });

  test("removes the dark, focus ring and line clamp classes and maps raw colors", () => {
    expect(out).not.toMatch(/dark:|outline-none|focus-visible:ring|line-clamp/);
    expect(out).toContain("text-text-on-accent");
  });

  test("forwards the props through forwardable, but not the slot props", () => {
    expect(out).toContain('v-bind="forwardable(forwarded)"');
    expect(out).toContain('<slot v-bind="forwarded" />');
  });

  test("gives the portal the target of the package", () => {
    expect(out).toContain('<DialogPortal :to="portal">');
    expect(out).toContain('import { usePortalTarget } from "../../../lib/portal";');
    expect(out).toContain("const portal = usePortalTarget();");
  });

  test("changes nothing at a second run", () => {
    expect(adapt("DialogContent.vue", out)).toBe(out);
  });

  test("keeps the outline of a menu item: its highlight shows the focus", () => {
    const item = `<template><div :class="'outline-hidden focus:bg-accent'" /></template>`;
    expect(adapt("DropdownMenuItem.vue", item)).toBe(item);
  });
});
