// SPDX-License-Identifier: Apache-2.0
/**
 * The root component of the labs app: the lab page, or a separate view alone in its window. The separate views are
 * `view=graph` (the metrics graph) and `view=compare` (the compare view). A separate view loads in its own chunk. Any
 * other `view` value is the free camera of the lab page (`view=x,y,z,tx,ty,tz,fov`).
 */
import { defineAsyncComponent, type Component } from "vue";
import NoPluginPage from "../NoPluginPage.vue";
import { registeredPlugin } from "../plugin";
import Room3DLab from "../Room3DLab.vue";

export type SeparateView = "graph" | "compare";

/** The separate view of a URL query, or null for the lab page. */
export function separateView(search: string): SeparateView | null {
  const view = new URLSearchParams(search).get("view");
  return view === "graph" || view === "compare" ? view : null;
}

/** The root component for a URL query. A project with no editor plugin gets the page that tells this. */
export function labRoot(search: string): Component {
  if (registeredPlugin() === null) return NoPluginPage;
  const view = separateView(search);
  if (view === "graph") return defineAsyncComponent(() => import("../graph/GraphPage.vue"));
  if (view === "compare") return defineAsyncComponent(() => import("../compare/ComparePage.vue"));
  return Room3DLab;
}
