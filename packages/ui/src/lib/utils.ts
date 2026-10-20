// SPDX-License-Identifier: Apache-2.0
/**
 * The helpers at the path of the shadcn-vue components (components.json, alias "utils").
 *
 * - `cn`: the `cn` of lib/cn.ts, so the token text sizes stay font sizes for tailwind-merge.
 * - `forwardable`: the props of a component for v-bind on its Reka UI part.
 */
export { cn } from "./cn";

/** The props of `T` without undefined in the type of each value. Optional props stay optional. */
export type Forwardable<T> = { [K in keyof T]: Exclude<T[K], undefined> };

/**
 * Give the props of a shadcn-vue component to its Reka UI part. An optional prop without a value is undefined.
 * With exactOptionalPropertyTypes the Reka UI part refuses undefined at the type level. At run time Vue uses
 * the default of the prop for undefined, so the value is correct. The function returns the same object, so
 * the props stay reactive.
 */
export function forwardable<T extends object>(props: T): Forwardable<T> {
  return props as Forwardable<T>;
}
