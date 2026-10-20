// SPDX-License-Identifier: Apache-2.0
/**
 * "Open in a window" of the parts of the lab page: the content browser, the metrics graph and a pane of the split
 * screen.
 *
 * - In a frame of the workbench, the lab sends the bridge event `detach`. The workbench page opens the window (a native
 *   window of the labs app, or a browser window of the workbench page). The window has a lab frame that follows this
 *   clock through the host. Then the workbench page tells this lab to remove the part (`dropPane`, `dock("hidden")`).
 * - A lab page without the workbench opens a browser window of the same lab URL with `follow=1` (the clock link of the
 *   `BroadcastChannel`). Then it removes the part itself. For a pane, the page first asks one time about the memory
 *   cost.
 *
 * The texts are Fluent messages of `src/i18n/en-US/lab-core.ftl`.
 */
import { t } from "../../texts";

/*
 * The message `lab-detach-confirm` tells the memory cost of a detached pane. The app shows it before the first detach.
 * A detached pane is a second web view with its own 3D context and its own copy of the room assets. A measurement in
 * the labs app gave 0.76 to 0.79 GB for the new web content process. The GPU process used 0.11 to 0.33 GB more (a
 * Runs window: 0.04 GB).
 */

/** The storage key of "the owner saw the cost" for a lab page without the workbench. */
const COST_KEY = "room3d-lab.paneCost";

/** True when the page is a lab frame of the workbench with its bridge (the page opens the windows). */
export function inWorkbench(): boolean {
  return globalThis.__workbench !== undefined;
}

/**
 * The URL of a follower lab: this URL without the bridge, the split screen, the selection and the graph card, with
 * `follow=1` and the changes (`null` removes a parameter).
 */
export function followUrl(href: string, changes: Readonly<Record<string, string | null>>): string {
  const url = new URL(href);
  for (const name of ["workbench", "panes", "cams", "sel", "graph", "freeze"]) url.searchParams.delete(name);
  url.searchParams.set("follow", "1");
  url.searchParams.set("panel", "0");
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  url.hash = "";
  return url.toString();
}

/** The camera parameters of the camera text of a pane (`chest` or `view:x,y,z,tx,ty,tz,fov`). */
export function cameraParams(cam: string): Record<string, string | null> {
  return cam.startsWith("view:") ? { camera: null, view: cam.slice("view:".length) } : { camera: cam, view: null };
}

function sawCost(): boolean {
  try {
    return globalThis.localStorage.getItem(COST_KEY) === "1";
  } catch {
    return false;
  }
}

function keepSawCost(): void {
  try {
    globalThis.localStorage.setItem(COST_KEY, "1");
  } catch {
    // A private window asks again at the next detach.
  }
}

/** The parts of a detach of a lab page without the workbench (a test gives fakes). */
export interface DetachHost {
  open(url: string, target: string, features: string): unknown;
  confirm(text: string): boolean;
  readonly location: { readonly href: string };
}

/** Detach a pane: the bridge event in the workbench, else a confirmation (one time), a removal and a browser window. */
export function detachPane(
  pane: number,
  cam: string,
  drop: (pane: number) => string | null,
  host: DetachHost = globalThis,
): boolean {
  if (inWorkbench()) {
    globalThis.__workbench?.emit({ event: "detach", panel: "pane", query: { pane: String(pane), cam } });
    return true;
  }
  if (!sawCost()) {
    if (!host.confirm(t("lab-detach-confirm"))) return false;
    keepSawCost();
  }
  const dropped = drop(pane) ?? cam;
  const url = followUrl(host.location.href, { ...cameraParams(dropped), dock: "0" });
  host.open(url, `scenity-lab-pane-${dropped.replace(/[^a-z0-9]/gi, "")}`, "popup,width=960,height=600");
  return true;
}

/** Detach the content browser: the bridge event in the workbench, else a browser window and a hidden dock here. */
export function detachDock(hide: () => void, host: DetachHost = globalThis): void {
  if (inWorkbench()) {
    globalThis.__workbench?.emit({ event: "detach", panel: "dock", query: {} });
    return;
  }
  const url = followUrl(host.location.href, { only: "dock", dock: "tall" });
  host.open(url, "scenity-lab-dock", "popup,width=1280,height=560");
  hide();
}
