// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of the workbench that the page can hide. The code of each part stays. A change here shows the part
 * again.
 *
 * Only a page of a host behind the Scenity gateway (`?host=<server>/host`, host/endpoint.ts) hides them: the container
 * has only the lab surface. The page of the labs app and of a local host shows every part. The tests open the page
 * without a gateway host, so they show every part.
 */
import { isGatewayHost } from "../host/endpoint";

/** True when the URL of the page names a host behind the Scenity gateway. */
function scenityPage(): boolean {
  try {
    const host = new URL(globalThis.location.href).searchParams.get("host");
    return isGatewayHost(host?.trim().replace(/\/$/, ""));
  } catch {
    return false;
  }
}

const SCENITY = scenityPage();

/** Show the row of surface tabs when only one surface shows. */
// export const SHOW_SINGLE_TAB = false as boolean;
export const SHOW_SINGLE_TAB = !SCENITY;
/** Show the state dots of the host and of the dev server ("host", "vite") in the top bar. */
// export const SHOW_STATE_DOTS = false as boolean;
export const SHOW_STATE_DOTS = !SCENITY;
/** Show "<surface> dev server ready on port <n>" in the status line (the other states always show). */
// export const SHOW_SERVER_READY = false as boolean;
export const SHOW_SERVER_READY = !SCENITY;
/** The modes of the Claude column that hide: the login shell and the chat. "Claude" (the terminal) stays. */
// export const HIDDEN_CLAUDE_TABS: readonly string[] = ["shell", "chat"];
export const HIDDEN_CLAUDE_TABS: readonly string[] = SCENITY ? ["shell", "chat"] : [];
