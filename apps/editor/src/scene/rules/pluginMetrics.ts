// SPDX-License-Identifier: Apache-2.0
/**
 * The metric faces of the plugins of a project for the rules editor: the module of the page build
 * (`virtual:scenity/project-plugins`). The editor loads this module when it opens, so a test with no page build gets
 * the built-in metrics only.
 */
import type { MetricPlugin } from "@scenity/rules";
import { loadProjectDevPlugins } from "virtual:scenity/project-plugins";

/** The metric faces of the plugins of a project. */
export function pluginMetrics(project: string): Promise<MetricPlugin[]> {
  return loadProjectDevPlugins(project);
}
