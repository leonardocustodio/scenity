// SPDX-License-Identifier: Apache-2.0
/**
 * The link of the scene page to its scene client (the worker or the core of the main thread). The selection outline and
 * the input events of the play mode go over it. In the edit mode, the Console panel takes the console lines of the
 * worker, of the page and of the dev server from the start of the page.
 */
import type { SceneLink } from "@scenity/runtime/client";
import type { DocumentCore } from "@scenity/runtime/documentCore";
import { pageConsole } from "./console/consoleStore";
import { tapPageConsole, tapServer, tapWorkerLog } from "./console/consoleTaps";
import type { PlayInputLink } from "./play/playInput";
import type { PageSelection } from "./selection";

/** Link the parts of the page to the scene client. */
export function linkPage(link: SceneLink<DocumentCore>, selection: PageSelection, input: PlayInputLink): void {
  selection.link(link);
  input.link(link);
  if (new URLSearchParams(location.search).get("edit") !== "1") return;
  tapWorkerLog(pageConsole(), link);
  tapPageConsole(pageConsole());
  tapServer(pageConsole(), import.meta.hot);
}
