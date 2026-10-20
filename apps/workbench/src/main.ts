// SPDX-License-Identifier: Apache-2.0
/**
 * The workbench page of Scenity. It runs in the labs app
 * (Tauri) and in a browser. It is a developer tool: no runtime release holds it.
 */
import { markPlatform } from "@scenity/labs-platform";
import { createApp } from "vue";
import { panelOf } from "./panels/panelUrl";
import Workbench from "./Workbench.vue";
import "./styles.css";

// The indexer window of the labs app loads this page with `?indexer=1` (its own small chunk, no workbench).
// A detached window loads it with `?panel=<kind>&key=<key>` (panels/PanelApp.vue, its own chunk).
const panel = panelOf(globalThis.location.search);
if (new URLSearchParams(globalThis.location.search).get("indexer") === "1") {
  void import("./indexer/IndexerApp.vue").then(({ default: IndexerApp }) => {
    createApp(IndexerApp).mount("#app");
  });
} else if (panel !== null) {
  void import("./panels/PanelApp.vue").then(({ default: PanelApp }) => {
    createApp(PanelApp, { panel }).mount("#app");
  });
} else {
  createApp(Workbench).mount("#app");
  // The platform capabilities of the page, after the mount, on the User Timing time line (`labs:platform`).
  void markPlatform("workbench").catch(() => undefined);
}
