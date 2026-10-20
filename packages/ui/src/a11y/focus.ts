// SPDX-License-Identifier: Apache-2.0
/**
 * Focus management (WCAG 2.4.3). After a route change the shell moves the focus to the new page,
 * so a keyboard or screen-reader user starts at the page title and not at the old link.
 */

const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex], [contenteditable='true'], summary";

/**
 * Move the focus to an element. An element that cannot take the focus gets tabindex="-1" first, so the
 * focus can go there by script but the Tab key does not stop there. Return true if the element has the focus.
 */
export function focusElement(target: HTMLElement | null, options: { preventScroll?: boolean } = {}): boolean {
  if (target === null) return false;
  if (!target.matches(FOCUSABLE)) target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: options.preventScroll ?? false });
  return target.ownerDocument.activeElement === target;
}

/** The targets of the focus after a route change, in order: an explicit target, the page title, main. */
export const ROUTE_FOCUS_SELECTORS = ["[data-route-focus]", "main h1", "#main", "main"] as const;

/**
 * Move the focus to the first route-focus target that exists. Call it after the new page is in the DOM
 * (for example in `router.afterEach` after `nextTick`). Return the element that has the focus, or null.
 */
export function focusRouteTarget(
  root: ParentNode = document,
  selectors: readonly string[] = ROUTE_FOCUS_SELECTORS,
): HTMLElement | null {
  for (const selector of selectors) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element !== null && focusElement(element, { preventScroll: false })) return element;
  }
  return null;
}
