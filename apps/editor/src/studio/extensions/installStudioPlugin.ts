// SPDX-License-Identifier: Apache-2.0
/**
 * The install of the studio face of a plugin in the editor window. It checks the definition and its API version. Then
 * it installs the texts of the plugin, its panels (each in an error boundary) and its commands, and calls `activate`.
 * The previous API version gives a warning. A different version refuses the plugin, and the editor continues to work.
 */
import { collectResources } from "@scenity/i18n";
import { markRaw } from "vue";
import type { PageKeyCommandSpec } from "../../scene/settings/pageKeys";
import { editorI18n, t } from "../../texts";
import type { PanelArea, PanelSpec } from "../shell/panels";
import { UNKNOWN_PANEL_ICON } from "../shell/panels";
import { STUDIO_API_VERSION, type StudioContext, type StudioPluginDefinition } from "./api";
import ContributionBoundary from "./ContributionBoundary.vue";
import { installPoints, type StudioPointHost } from "./contributionPoints";
import { pluginSettingsStore, type PluginSettingsStore } from "./pluginSettings";
import { pluginIcon } from "./PluginIcon";

/** The context of the page: the parts of the context that are the same for each plugin. */
export type StudioPageContext = Omit<StudioContext, "plugin" | "t" | "settings">;

/** The parts of the editor window that the install uses. */
export interface StudioPluginHost {
  /** The context of the page without the parts of one plugin. */
  readonly context: StudioPageContext;
  registerPanel(spec: PanelSpec): () => void;
  setPanel(id: string, content: { component: unknown; props: Readonly<Record<string, unknown>> }): void;
  registerCommands(specs: readonly PageKeyCommandSpec[]): () => void;
  /** An error of a contribution (the Console and Problems show it). */
  failed(plugin: string, name: string, error: unknown): void;
  /** The registries of the other contribution points. */
  readonly points: StudioPointHost;
  /** The store of the project settings of a plugin (if absent, only the values of the person). */
  projectSettings?(plugin: string): PluginSettingsStore;
}

/** The result of an install: the warnings, the error that refused the plugin, and the dispose function. */
export interface InstallResult {
  readonly id: string | null;
  readonly warnings: readonly string[];
  readonly error: string | null;
  dispose(): void;
}

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;
const AREAS: Readonly<Record<string, PanelArea>> = {
  left: "left",
  right: "right",
  bottom: "bottom",
  floating: "floating",
};

/** The reason why a value is not a studio face, or null. */
export function definitionProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return t("plugin-not-face");
  const def = value as Partial<StudioPluginDefinition>;
  if (typeof def.id !== "string" || !PLUGIN_ID.test(def.id)) return t("plugin-bad-id");
  if (typeof def.apiVersion !== "number" || !Number.isInteger(def.apiVersion))
    return t("plugin-no-version", { id: def.id });
  if (def.apiVersion > STUDIO_API_VERSION || def.apiVersion < STUDIO_API_VERSION - 1)
    return t("plugin-version-unknown", { id: def.id, version: def.apiVersion, current: STUDIO_API_VERSION });
  return null;
}

/** Install the studio face `value` of a plugin. */
export function installStudioPlugin(value: unknown, host: StudioPluginHost): InstallResult {
  const problem = definitionProblem(value);
  if (problem !== null) return { id: null, warnings: [], error: problem, dispose: () => undefined };
  const def = value as StudioPluginDefinition;
  const warnings =
    def.apiVersion < STUDIO_API_VERSION
      ? [t("plugin-version-old", { id: def.id, version: def.apiVersion, current: STUDIO_API_VERSION })]
      : [];
  if (def.texts !== undefined) editorI18n().addResources(collectResources(def.texts));
  const project = def.contributes?.settings?.scope === "project" ? host.projectSettings?.(def.id) : undefined;
  const settings = project ?? pluginSettingsStore(def.id);
  const ctx: StudioContext = { ...host.context, plugin: def.id, t: (id, args) => t(id, args), settings };
  const stops: (() => void)[] = [];
  const own = (id: string): boolean => id.startsWith(`${def.id}.`);
  for (const panel of def.contributes?.panels ?? []) {
    if (!own(panel.id)) {
      warnings.push(t("plugin-not-prefixed", { id: def.id, name: panel.id, prefix: `${def.id}.` }));
      continue;
    }
    stops.push(
      host.registerPanel({
        id: panel.id,
        title: panel.title,
        icon: panel.icon === undefined ? UNKNOWN_PANEL_ICON : pluginIcon(panel.icon),
        area: AREAS[panel.area ?? "right"] ?? "right",
        keyContext: "dock",
      }),
    );
    host.setPanel(panel.id, {
      component: markRaw(ContributionBoundary),
      props: {
        load: panel.component,
        ctx,
        name: panel.id,
        failed: (name: string, error: unknown) => host.failed(def.id, name, error),
      },
    });
  }
  const commands = (def.contributes?.commands ?? []).filter((command) => {
    if (own(command.id)) return true;
    warnings.push(t("plugin-not-prefixed", { id: def.id, name: command.id, prefix: `${def.id}.` }));
    return false;
  });
  stops.push(
    host.registerCommands(
      commands.map((command) => ({
        id: command.id,
        title: t(command.title),
        ...(command.keys === undefined ? {} : { keys: command.keys }),
        ...(command.args === undefined ? {} : { args: command.args }),
        ...(command.agents === undefined ? {} : { agents: command.agents }),
        ...(command.menu === undefined ? {} : { menu: command.menu }),
        category: def.id,
        when: () => command.when?.(ctx) ?? null,
        run: (args) => command.run(ctx, args),
      })),
    ),
  );
  const failed = (name: string, error: unknown): void => host.failed(def.id, name, error);
  stops.push(...installPoints({ def, ctx, warnings, failed }, host.points));
  try {
    const stop = def.activate?.(ctx);
    if (stop !== undefined) stops.push(stop);
  } catch (error) {
    host.failed(def.id, "activate", error);
  }
  return {
    id: def.id,
    warnings,
    error: null,
    dispose: () => {
      for (const stop of stops.splice(0).reverse()) stop();
    },
  };
}
