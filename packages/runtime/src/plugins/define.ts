// SPDX-License-Identifier: Apache-2.0
/**
 * `defineRuntimePlugin`: make the runtime face of a plugin with the defaults of each part. The parts with no default
 * (`input`, `simulation`, `inputMap`) stay as the spec gives them.
 */
import type { RuntimePlugin, RuntimePluginSpec } from "./types";

/** The pattern of a plugin ID: the first part of a component ID (`doors` in `doors.panel`). */
export const PLUGIN_ID_PATTERN = /^[a-z][A-Za-z0-9]*$/;

/** Make the runtime face of a plugin. The plugin host checks the IDs of the parts (`PluginHost`). */
export function defineRuntimePlugin<I = unknown>(spec: RuntimePluginSpec<I>): RuntimePlugin<I> {
  if (!PLUGIN_ID_PATTERN.test(spec.id)) throw new Error(`"${spec.id}" is not a plugin ID`);
  return { ...spec, components: spec.components ?? [], systems: spec.systems ?? [], presenters: spec.presenters ?? {} };
}
