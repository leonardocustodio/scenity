// SPDX-License-Identifier: Apache-2.0
/**
 * The type of the virtual module of the project plugins of the scene page (scripts/sceneProjectPlugins.ts).
 */
declare module "virtual:scenity/project-plugins" {
  import type { MetricPlugin } from "@scenity/rules";
  import type { RuntimePlugin } from "@scenity/runtime/plugins";

  /** The runtime faces of the plugins of a project of the page, in the order of the project document. */
  export function loadProjectPlugins(project: string): Promise<RuntimePlugin[]>;

  /** The metric faces of the plugins of a project (`scenity.dev`): their metric libraries. */
  export function loadProjectDevPlugins(project: string): Promise<MetricPlugin[]>;
}

declare module "virtual:scenity/project-studio" {
  /** The studio faces of the plugins of a project: the default export of each module. */
  export function loadProjectStudioPlugins(project: string): Promise<unknown[]>;
}
