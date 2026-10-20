// SPDX-License-Identifier: Apache-2.0
// The build of the lab page of the editor for the end-to-end tests. global-setup.ts writes it. The specs serve it with
// the static server scripts/static/serve-static.ts, which has the nginx headers and the CSP of the app.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const LABS_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The build folder. It is outside dist, so a parallel build of the app does not empty it. A project outside this
 * checkout (`SCENITY_PROJECT`, for example a project of another repository) gets a build folder of its own. Thus the
 * build of this checkout for its own tests does not replace the build with the plugin of that project.
 */
const PROJECT = process.env.SCENITY_PROJECT ?? "";
export const LABS_DIST =
  PROJECT === ""
    ? fileURLToPath(new URL("../../node_modules/.cache/scenity-editor-e2e/dist/", import.meta.url))
    : `${join(PROJECT, ".scenity", "editor-e2e", "dist")}/`;
