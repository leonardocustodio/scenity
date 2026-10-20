// SPDX-License-Identifier: Apache-2.0
/**
 * The key map of the person in the user state of the studio host: the file `keymap.json` of the host
 * (`/api/user/keymap`). At the start, a key map of the host has priority over the copy of the browser. If the browser
 * has keys and the host has none, the browser gives its keys to the host. Each change of the key map goes to the host.
 * Thus a second browser on the machine has the same keys. A page with no studio host keeps only the copy of the
 * browser.
 */
import { keymapDocumentSchema, type KeymapDocument } from "@scenity/scene/schema/editor";
import { csrfValue } from "../../hub/studioApi";
import type { PageSettings } from "./pageSettings";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const same = (a: KeymapDocument | null, b: KeymapDocument | null): boolean =>
  JSON.stringify(a?.keys ?? {}) === JSON.stringify(b?.keys ?? {});

/** Take the key map of the host and update the host after each change. The result stops the writes. */
export async function syncKeymapWithHost(
  settings: Pick<PageSettings, "keymap" | "setKeymap" | "listen">,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<() => void> {
  const answer = await fetcher("/api/user/keymap").catch(() => null);
  if (answer?.ok !== true) return () => undefined;
  const parsed = keymapDocumentSchema.safeParse(await answer.json().catch(() => null));
  let written: KeymapDocument | null = parsed.success ? parsed.data : null;
  const write = async (keymap: KeymapDocument): Promise<void> => {
    written = keymap;
    await fetcher("/api/user/keymap", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-studio-csrf": csrfValue() },
      body: JSON.stringify(keymap),
    }).catch(() => null);
  };
  const local = settings.keymap;
  if (written !== null && Object.keys(written.keys).length > 0) {
    if (!same(written, local)) settings.setKeymap(written);
  } else if (local !== null && Object.keys(local.keys).length > 0) await write(local);
  return settings.listen(() => {
    const now = settings.keymap;
    if (now !== null && !same(now, written)) void write(now);
  });
}
