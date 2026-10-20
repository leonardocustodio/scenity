// SPDX-License-Identifier: Apache-2.0
/**
 * While a modal list is open, Reka UI hides the rest of the page from assistive technology with
 * aria-hidden. This helper also makes that content inert, so it cannot take the keyboard focus while it is
 * hidden (WCAG 4.1.2, axe rule aria-hidden-focus). It removes the attribute when the list closes.
 */
import { onBeforeUnmount, watch, type Ref } from "vue";

export function useInertWhileOpen(open: Ref<boolean>): void {
  let marked: Element[] = [];
  const release = (): void => {
    for (const element of marked) element.removeAttribute("inert");
    marked = [];
  };
  watch(
    open,
    (value) => {
      release();
      if (!value || typeof requestAnimationFrame !== "function") return;
      // Reka UI sets aria-hidden after the list renders: wait two frames.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!open.value) return;
          for (const element of document.querySelectorAll('[data-aria-hidden="true"]')) {
            if (element.hasAttribute("inert")) continue;
            element.setAttribute("inert", "");
            marked.push(element);
          }
        });
      });
    },
    { immediate: true },
  );
  onBeforeUnmount(release);
}
