// SPDX-License-Identifier: Apache-2.0
/**
 * The studio faces of the plugins of a project: the module of the page build (`virtual:scenity/project-studio`). The
 * editor window loads this module after its start, so a test with no page build gets no studio faces. In dev, this
 * module takes the hot updates of the studio faces. An edit of a face calls the listeners, and the window installs the
 * faces again (dispose, then activate) with no reload.
 */
import { loadProjectStudioPlugins } from "virtual:scenity/project-studio";

let load = loadProjectStudioPlugins;
const listeners = new Set<() => void>();

/** The studio faces of the plugins of a project (the default export of each face module). */
export function studioFaces(project: string): Promise<unknown[]> {
  return load(project);
}

/** Call `listener` after a hot update of the studio faces; the result stops it. */
export function onStudioFacesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

if (import.meta.hot) {
  import.meta.hot.accept("virtual:scenity/project-studio", (module) => {
    if (module === undefined) return;
    load = (module as unknown as { loadProjectStudioPlugins: typeof loadProjectStudioPlugins })
      .loadProjectStudioPlugins;
    for (const listener of listeners) listener();
  });
}
