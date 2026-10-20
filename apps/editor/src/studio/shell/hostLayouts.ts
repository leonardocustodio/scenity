// SPDX-License-Identifier: Apache-2.0
/**
 * The workspace state of the person in the user state of the studio host: the layouts file of the host
 * (`/api/user/layouts`, the scope `*` for all projects). At the start, the copy of the host has priority over the copy
 * of the browser. Each change goes to the host a short time later. A change that waits when the page closes (a
 * reload, a close) goes immediately, with a request that continues after the page closes. Else the copy of the host
 * does not have the change at the next start. A page with no studio host (the page of `scenity dev`) keeps only the
 * copy of the browser.
 */
import { csrfValue } from "../../hub/studioApi";
import { workspacesDoc, type Workspaces } from "./workspaceState";

/** The scope of the workspace state in the layouts file: the same for every project. */
export const LAYOUT_SCOPE = "*";
/** The wait after a change before the write to the host (ms). */
const WRITE_WAIT_MS = 400;

interface LayoutsFile {
  readonly format: "scenity.studio-layouts/1";
  readonly scopes: Readonly<Record<string, unknown>>;
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function readFile(fetcher: Fetcher): Promise<LayoutsFile | null> {
  const answer = await fetcher("/api/user/layouts").catch(() => null);
  if (!answer?.ok) return null;
  return (await answer.json()) as LayoutsFile;
}

/**
 * Take the copy of the host (when it is different) and update the host after each change. `shown` shows the new state
 * in the dock. The result stops the writes.
 */
export async function syncWithHost(
  workspaces: Workspaces,
  shown: () => void,
  fetcher: Fetcher = (input, init) => fetch(input, init),
): Promise<() => void> {
  const file = await readFile(fetcher);
  if (file === null) return () => undefined;
  let scopes = file.scopes;
  const write = async (keepalive = false): Promise<void> => {
    scopes = { ...scopes, [LAYOUT_SCOPE]: workspaces.doc };
    await fetcher("/api/user/layouts", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-studio-csrf": csrfValue() },
      body: JSON.stringify({ format: file.format, scopes }),
      keepalive,
    }).catch(() => null);
  };
  const remote = scopes[LAYOUT_SCOPE];
  if (remote === undefined) await write();
  else if (JSON.stringify(workspacesDoc(remote)) !== JSON.stringify(workspaces.doc)) {
    workspaces.replace(remote);
    shown();
  }
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = workspaces.listen(() => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void write();
    }, WRITE_WAIT_MS);
  });
  const flush = (): void => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    void write(true);
  };
  globalThis.addEventListener("pagehide", flush);
  return () => {
    stop();
    globalThis.removeEventListener("pagehide", flush);
    if (timer !== null) clearTimeout(timer);
  };
}
