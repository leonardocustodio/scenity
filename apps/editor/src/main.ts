// SPDX-License-Identifier: Apache-2.0
/**
 * The labs app: the lab page of the 3D room at "/". It never ships to learners. A runtime user (the player) imports
 * the runtime packages only.
 */
import { createAnnouncer } from "@scenity/ui";
import { createApp } from "vue";
import { labRoot } from "./core/views/labRoot";
import { installPlugins } from "./plugins";
import { markStart } from "./startMarks";
import { editorI18n } from "./texts";
import "./styles.css";

// Put the start marks on the User Timing time line, then the platform capabilities.
markStart();
// `view=graph` and `view=compare` show a separate view alone in the window.
const app = createApp(labRoot(globalThis.location.search));
app.use(editorI18n().plugin);
app.use(createAnnouncer());
// The plugins start their data sources (for example, the mock engine source with the CodeBlue SDK).
installPlugins(app);
app.mount("#app");
