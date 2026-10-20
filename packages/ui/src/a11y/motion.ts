// SPDX-License-Identifier: Apache-2.0
/**
 * Reduced motion and forced colors.
 *
 * Reduced motion comes from the operating system (`prefers-reduced-motion`) or from the in-app setting,
 * which sets `data-motion="reduced"` on the root element or on a part of the page (the gallery does that).
 */
import { useMediaQuery, useMutationObserver } from "@vueuse/core";
import { computed, ref, toValue, watchEffect, type MaybeRefOrGetter, type Ref } from "vue";

function motionAttribute(element: Element | null | undefined): boolean {
  const scope = element?.closest("[data-motion]") ?? document.documentElement;
  return scope.getAttribute("data-motion") === "reduced";
}

/**
 * True when the motion must be reduced for an element (or for the document with no element). Components that
 * animate in script (the waveform sweep) use it. CSS uses the reduce-motion variant.
 */
export function usePrefersReducedMotion(
  element?: MaybeRefOrGetter<Element | null | undefined>,
): Readonly<Ref<boolean>> {
  const media = useMediaQuery("(prefers-reduced-motion: reduce)");
  const attribute = ref(false);
  const update = (): void => {
    attribute.value = motionAttribute(toValue(element));
  };
  watchEffect(update);
  useMutationObserver(typeof document === "undefined" ? null : document.documentElement, update, {
    attributes: true,
    subtree: true,
    attributeFilter: ["data-motion"],
  });
  return computed(() => media.value || attribute.value);
}

/** True when the browser uses forced colors (Windows high contrast). */
export function useForcedColors(): Readonly<Ref<boolean>> {
  return useMediaQuery("(forced-colors: active)");
}

function systemColor(element: Element, keyword: string): string {
  const probe = document.createElement("span");
  probe.style.color = keyword;
  probe.style.display = "none";
  element.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

/**
 * The color for a canvas: the value of a token variable for the element, so the theme of
 * the element applies. With forced colors, the system color CanvasText from a probe element.
 */
export function canvasColor(element: Element, cssVar: string): string {
  if (typeof matchMedia === "function" && matchMedia("(forced-colors: active)").matches) {
    return systemColor(element, "CanvasText");
  }
  const value = getComputedStyle(element).getPropertyValue(cssVar).trim();
  return value === "" ? systemColor(element, "CanvasText") : value;
}
