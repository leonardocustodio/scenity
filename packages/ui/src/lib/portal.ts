// SPDX-License-Identifier: Apache-2.0
/**
 * The target of the overlays (dialogs, menus, popovers, tooltips, toasts). By default they go to the end of
 * <body>. A part of the page with its own theme attributes (the component gallery, a device inset) gives
 * its own element, so the overlays keep the theme tokens of that part.
 */
import { computed, inject, provide, unref, type ComputedRef, type InjectionKey, type Ref } from "vue";

type Target = Ref<HTMLElement | null> | HTMLElement | string;

const PORTAL_TARGET: InjectionKey<Target> = Symbol("scenity.portal-target");

export function providePortalTarget(target: Target): void {
  provide(PORTAL_TARGET, target);
}

/** The element or selector for the `to` prop of a Reka UI portal. */
export function usePortalTarget(): ComputedRef<HTMLElement | string> {
  const target = inject(PORTAL_TARGET, "body");
  return computed(() => {
    const value = typeof target === "string" || target instanceof HTMLElement ? target : unref(target);
    return value ?? "body";
  });
}
