// SPDX-License-Identifier: Apache-2.0
/**
 * The importers of a project on the dev server: the built-in importers and the `importers` of the host faces of its
 * plugins (hostFaces.ts; a restricted project gives none). The Project panel imports a file of a plugin file type
 * with them. A new import of an asset uses them, and the import dialog shows the forms of their settings. A value
 * that is not an importer, or that has the name or an extension of another importer, gives a warning.
 */
import type * as ImportIndex from "@scenity/assets/import";
import { assetsModule } from "./assetsModule.ts";
import { projectHostFaces } from "./hostFaces.ts";

/** The importer registry of a project: the name of the project and its folder. */
export async function projectImporters(name: string, dir: string): Promise<ImportIndex.ImporterRegistry> {
  const { importerRegistryWith } = await assetsModule<typeof ImportIndex>("import");
  const faces = await projectHostFaces(name, dir);
  return importerRegistryWith(
    faces.flatMap((face) => face.importers ?? []),
    (text) => console.warn(`[scenity] ${name}: ${text}`),
  );
}
