// SPDX-License-Identifier: Apache-2.0
/**
 * The registries of the scene page for the contribution points of the studio faces: the component icons and the widgets
 * of the inspector, the create presets (scene commands and the + menu of the hierarchy), the overlays of the Scene
 * view, the status bar, Problems, the page tools and the context lines of the agents, and the docs links.
 */
import {
  defineCommands,
  presetCommand,
  type CommandHost,
  type HierarchyState,
  type SceneEditOp,
} from "@scenity/editor-core";
import { defineComponent, h, markRaw, type PropType } from "vue";
import type { LazyComponent, StudioContext } from "../../studio/extensions/api";
import ContributionBoundary from "../../studio/extensions/ContributionBoundary.vue";
import type { StudioPointHost } from "../../studio/extensions/contributionPoints";
import type { StudioShell } from "../../studio/shell/shell";
import type { SceneCommands } from "../hierarchy/sceneCommands";
import { addComponentIcon } from "../inspector/componentIcons";
import { addCustomWidget } from "../inspector/customWidgets";
import { useInspector, type FieldPath } from "../inspector/inspectorState";
import { pageProblems } from "../problems/problemList";
import type { ScenePageEditor } from "../sceneEditor";
import { pageKeys } from "../settings/pageKeys";
import { whenOverlays } from "../viewport/viewOverlays";
import { addDocsLink, type DocsKey } from "./docsLinks";
import { addContextLines, addPageTool } from "./pageAgentParts";
import { pageViewPoints } from "./pageViewPoints";
import { addPluginPreset, sceneCommandsOf } from "./pluginPresets";
import { viewportView } from "./toolHandles";

/** The widget of a plugin in the inspector: the boundary with the value, the label and the set of the field. */
function pluginWidget(name: string, load: LazyComponent, ctx: StudioContext, failed: (error: unknown) => void) {
  return markRaw(
    defineComponent({
      name: "PluginWidget",
      props: {
        definition: { type: Object as PropType<Parameters<ReturnType<typeof useInspector>["set"]>[0]>, required: true },
        path: { type: Array as PropType<FieldPath>, required: true },
        value: { type: null as unknown as PropType<unknown>, default: undefined },
        label: { type: String, default: "" },
      },
      setup(props) {
        const inspector = useInspector();
        return () =>
          h(ContributionBoundary, {
            load,
            ctx,
            name,
            failed: (_name: string, error: unknown) => failed(error),
            extra: {
              value: props.value,
              label: props.label,
              set: (value: unknown) => inspector.set(props.definition, props.path, value),
            },
          });
      },
    }),
  );
}

const DOCS_KEY = /^(panel|component|command):.+$/;

/** The registries of the page. */
export function pagePoints(
  shell: Pick<StudioShell, "status">,
  editor: ScenePageEditor,
  canvas: HTMLCanvasElement | null = null,
): StudioPointHost {
  shell.status.runCommand = (id) => void pageKeys().run(id);
  return {
    ...pageViewPoints(canvas, () => viewportView(editor.posed())),
    addComponentIcon,
    addWidget: (name, load, ctx, failed) => addCustomWidget(name, pluginWidget(name, load, ctx, failed)),
    addPreset: (preset) => {
      const commands: SceneCommands | undefined = sceneCommandsOf(editor);
      const command = {
        ...presetCommand({
          id: preset.id,
          name: preset.name,
          icon: preset.icon ?? "box",
          components: preset.components,
        }),
        title: preset.title,
      };
      const stops = [
        commands?.extend(defineCommands<HierarchyState, CommandHost, SceneEditOp>([command])) ?? (() => undefined),
        addPluginPreset({ id: preset.id, label: preset.title }),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
    addOverlay: (spec) => {
      let remove: (() => void) | null = null;
      let gone = false;
      whenOverlays((dock) => {
        if (!gone) remove = dock.add(spec);
      });
      return () => {
        gone = true;
        remove?.();
      };
    },
    addStatusItem: (item) => shell.status.addCustom(item),
    addProblems: (id, source) =>
      pageProblems().add(`plugin:${id}`, async () =>
        (await source()).map((problem) => ({
          key: `plugin:${id}:${problem.key}`,
          kind: "plugin" as const,
          level: problem.level,
          title: problem.title,
          detail: problem.detail ?? null,
          entities: problem.entities ?? [],
          time: null,
          file: null,
          fixes: problem.fixes ?? [],
        })),
      ),
    refreshProblems: () => void pageProblems().refresh(),
    addPageTool,
    addContextLines,
    addDocsLink: (key, url) => (DOCS_KEY.test(key) ? addDocsLink(key as DocsKey, url) : () => undefined),
  };
}
