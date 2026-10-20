// SPDX-License-Identifier: Apache-2.0
/**
 * @scenity/ui: the design-system components of Scenity.
 *
 * - Primitives: Reka UI 2 with the shadcn-vue pattern (cva variants and the `cn` helper), token styles only.
 * - The shadcn-vue components (`@scenity/ui/components/<name>`).
 * - Accessibility foundations: announcer and live regions, focus helpers, skip link, reduced motion and
 *   forced colors.
 * - UI_RESOURCES: the Fluent resources of the components (namespace "ui").
 *
 * The app imports the styles once: `@import "tailwindcss"; @import "@scenity/ui/styles.css";`.
 * The domain components are in the plugins: this package imports no domain module.
 */

export { cn, type ClassValue } from "./lib/cn";
export { initials } from "./lib/initials";
export { providePortalTarget, usePortalTarget } from "./lib/portal";
export { UI_RESOURCES } from "./i18n";
export * from "./a11y";

// Primitives.
export { buttonVariants, fieldVariants, type ButtonVariants } from "./primitives/variants";
export type { ListOption } from "./primitives/options";
export { TOAST_KEY, useToast, type ToastApi, type ToastMessage } from "./primitives/toast";
export { default as Accordion } from "./primitives/Accordion.vue";
export { default as AlertDialog } from "./primitives/AlertDialog.vue";
export { default as Avatar } from "./primitives/Avatar.vue";
export { default as Button } from "./primitives/Button.vue";
export { default as Checkbox } from "./primitives/Checkbox.vue";
export { default as Combobox } from "./primitives/Combobox.vue";
export { default as Dialog } from "./primitives/Dialog.vue";
export { default as Label } from "./primitives/Label.vue";
export { default as Menu, type MenuEntry } from "./primitives/Menu.vue";
export { default as NumberField } from "./primitives/NumberField.vue";
export { default as Popover } from "./primitives/Popover.vue";
export { default as Progress } from "./primitives/Progress.vue";
export { default as RadioGroup } from "./primitives/RadioGroup.vue";
export { default as ScrollArea } from "./primitives/ScrollArea.vue";
export { default as Select } from "./primitives/Select.vue";
export { default as Slider } from "./primitives/Slider.vue";
export { default as Switch } from "./primitives/Switch.vue";
export { default as Tabs } from "./primitives/Tabs.vue";
export { default as Toaster } from "./primitives/Toaster.vue";
export { default as Toggle } from "./primitives/Toggle.vue";
export { default as Tooltip } from "./primitives/Tooltip.vue";
