// SPDX-License-Identifier: Apache-2.0
// The initials of a name for an avatar. The avatar primitive and the domain components use it.

/** Up to two initials of a name, for an avatar without a portrait. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((w) => w !== "");
  return words
    .slice(0, 2)
    .map((w) => Array.from(w)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
}
