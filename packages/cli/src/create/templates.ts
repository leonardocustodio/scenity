// SPDX-License-Identifier: Apache-2.0
/**
 * The templates of `scenity create`. Each template gives the files of a new project folder as text, with the paths
 * relative to the folder:
 *
 * - `empty`: the project document, one scene (a floor, a box, a key light, a fill light and a front camera), the
 *   asset folder and the rights folder;
 * - `showroom`: the documents of `samples/showroom` from the CLI package (`templates/showroom`: the scenes,
 *   the asset records, the rights record, the stills and the rules) with the ID and the name of the new project, and
 *   the CC0 source files of its models and its HDRI (showroom.ts). It has no asset build: `scenity build` writes it.
 *
 * Each template also gets a `.gitignore` and a `package.json` (package.ts). The documents are in the canonical form.
 */
import { PROJECT_FILE } from "@scenity/scene";
import { canonicalJson } from "@scenity/scene/canonical";
import {
  fetchFile,
  readSources,
  SHOWROOM_TEMPLATE_DIR,
  sourceFiles,
  templateDocuments,
  type FetchFile,
} from "./showroom";

export const TEMPLATES = ["empty", "showroom"] as const;
export type TemplateName = (typeof TEMPLATES)[number];

/** The files of a template: the path relative to the project folder → the bytes or the text. */
export type TemplateFiles = Map<string, string | Uint8Array>;

/** The path of the scene of the empty template. */
export const EMPTY_SCENE = "scenes/main.scene.json";

/** The scene document of the empty template. */
export function emptyScene(name: string): Record<string, unknown> {
  return {
    format: "scenity.scene/1",
    id: "main",
    name,
    environment: { background: "#1a2433", exposure: 1, toneMapping: "aces" },
    entities: {
      floor: {
        index: 0,
        name: "Floor",
        parent: null,
        components: {
          transform: { position: [0, 0, 0] },
          shape: { kind: "plane", size: [6, 0, 6], colour: "#b9a98f", roughness: 0.9 },
        },
      },
      box: {
        index: 1,
        name: "Box",
        parent: null,
        components: {
          transform: { position: [0, 0.5, 0] },
          shape: { kind: "box", size: [1, 1, 1], colour: "#5b8def", roughness: 0.6 },
        },
      },
      sun: {
        index: 2,
        name: "Key light",
        parent: null,
        components: {
          transform: { position: [3, 5, 4], rotation: [-0.403058, 0.272532, -0.127084, 0.864361] },
          light: { type: "directional", colour: "#fff4e5", intensity: 2.2, shadow: true },
        },
      },
      fill: {
        index: 3,
        name: "Fill light",
        parent: null,
        components: {
          transform: { position: [0, 3, 0] },
          light: { type: "hemisphere", colour: "#dfe8ff", groundColour: "#8a7a66", intensity: 0.8 },
        },
      },
      front: {
        index: 4,
        name: "Front camera",
        parent: null,
        components: {
          transform: { position: [0, 1.8, 4.5] },
          camera: { fov: 45, target: [0, 0.5, 0] },
        },
      },
    },
  };
}

/** The project document of the empty template. */
export function emptyProject(id: string, name: string): Record<string, unknown> {
  return {
    format: "scenity.project/1",
    id,
    name,
    scenes: [EMPTY_SCENE],
    assets: ["assets"],
    plugins: [],
    release: { licences: { allow: ["CC0-1.0"] } },
    // One rule, so that `scenity check` has a rule to measure in a new project.
    rules: [
      {
        id: "boxNearCentre",
        metric: "distance",
        args: { from: "entity:box", to: "entity:floor" },
        level: "block",
        max: 1,
        unit: "m",
        note: "The box stays at most 1 m from the centre of the floor.",
      },
    ],
  };
}

/** The `.gitignore` of a new project: the builds, the reports and the state folder of the tools. */
export const GITIGNORE = ["node_modules/", "dist/", "test-results/", ".scenity/", ".DS_Store", ""].join("\n");

/** The files of the empty template. */
export function emptyTemplate(id: string, name: string): TemplateFiles {
  return new Map<string, string | Uint8Array>([
    [PROJECT_FILE, canonicalJson(emptyProject(id, name))],
    [EMPTY_SCENE, canonicalJson(emptyScene(name))],
    ["assets/.gitkeep", ""],
    ["rights/.gitkeep", ""],
  ]);
}

/** How a template gets its source files. */
export interface TemplateSourceOptions {
  /** The sample of a checkout to copy the source files from, or null for a download of each file. */
  readonly sampleDir: string | null;
  readonly download?: FetchFile;
  readonly log?: (text: string) => void;
}

/** The files of the showroom template with the ID and the name of the new project in its project document. */
export async function showroomTemplate(
  id: string,
  name: string,
  options: TemplateSourceOptions,
  templateDir: string = SHOWROOM_TEMPLATE_DIR,
): Promise<TemplateFiles> {
  const documents = templateDocuments(templateDir);
  const download = options.download ?? fetchFile;
  const sources = await sourceFiles(readSources(templateDir), options.sampleDir, download, options.log);
  const project = JSON.parse(new TextDecoder().decode(documents.get(PROJECT_FILE))) as Record<string, unknown>;
  const files: TemplateFiles = new Map([...documents, ...sources.files]);
  files.set(PROJECT_FILE, canonicalJson({ ...project, id, name }));
  return files;
}
