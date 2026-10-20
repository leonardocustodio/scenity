// SPDX-License-Identifier: Apache-2.0
/**
 * The fixes of the import queue: a failed import whose reason the editor knows gets a fix.
 * The fix is the fix of the doctor of the Hub (`packages/studio-host/src/doctor.ts`): a text and a page of the docs.
 * Pure functions, no DOM.
 */

/** The fix of a failed import: the Fluent ID of its text, the Fluent ID of its link and the URL of the link. */
export interface ImportFix {
  readonly id: string;
  readonly text: string;
  readonly link: string;
  readonly url: string;
}

/** The fixes, in the order of the check: the first fix whose test finds the reason applies. */
const FIXES: readonly (ImportFix & { readonly test: RegExp })[] = [
  {
    id: "blender",
    test: /no Blender|Blender.*not found|Executable not found.*(blender|docker)/iu,
    text: "assets-import-fix-blender",
    link: "assets-import-fix-blender-link",
    url: "https://www.blender.org/download/",
  },
];

/** The fix of the reason of a failed import, or null when the editor knows no fix. */
export function importFix(reason: string | undefined): ImportFix | null {
  if (reason === undefined) return null;
  const found = FIXES.find((fix) => fix.test.test(reason));
  return found === undefined ? null : { id: found.id, text: found.text, link: found.link, url: found.url };
}
