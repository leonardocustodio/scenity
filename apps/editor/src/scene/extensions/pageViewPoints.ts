// SPDX-License-Identifier: Apache-2.0
/**
 * The registries of the scene page for the view points of the studio faces: the toolbar buttons and the scene tools of
 * the plugins (in the tools place of the toolbar), the previews of asset kinds, the recipes of the agents and the
 * sections of Preferences. Only one scene tool is active at a time, and Escape stops it.
 */
import { PLUGIN_MENU_ITEMS } from "../hierarchy/hierarchyState";
import { defineComponent, h, markRaw, type PropType } from "vue";
import { addPluginPreview } from "../../assetBrowser/preview/previewKinds";
import type { AssetListEntry } from "../../assetBrowser/assetTypes";
import type { LazyComponent, StudioContext } from "../../studio/extensions/api";
import ContributionBoundary from "../../studio/extensions/ContributionBoundary.vue";
import type { StudioPointHost } from "../../studio/extensions/contributionPoints";
import { addSettingsSection } from "../../studio/extensions/pluginSettings";
import { addPluginRecipes } from "../agent/recipes";
import { placePart } from "../pageParts";
import type { CameraView } from "../dragMath";
import { startToolHandles } from "./toolHandles";

/** A button of the toolbar with the icon of a plugin. */
function iconButton(id: string, title: string, icon: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.title = title;
  element.setAttribute("aria-label", title);
  element.dataset.testid = `toolbar-${id}`;
  element.className = "scene-plugin-tool";
  const image = document.createElement("img");
  image.src = icon;
  image.alt = "";
  image.width = 16;
  image.height = 16;
  element.append(image);
  return element;
}

/** The active scene tool: its ID, the function that stops it, and its toolbar button. */
let active: { id: string; stop(): void; button: HTMLButtonElement } | null = null;

function turnOff(): void {
  if (active === null) return;
  active.button.setAttribute("aria-pressed", "false");
  active.stop();
  active = null;
}

/** The preview of a plugin in the asset inspector: the boundary with the asset and the URL of its source. */
function pluginPreview(kind: string, load: LazyComponent, ctx: StudioContext, failed: (error: unknown) => void) {
  return markRaw(
    defineComponent({
      name: "PluginPreview",
      props: {
        asset: { type: Object as PropType<AssetListEntry>, required: true },
        url: { type: String as PropType<string | null>, default: null },
      },
      setup: (props) => () =>
        h(ContributionBoundary, {
          load,
          ctx,
          name: `preview:${kind}`,
          failed: (_name: string, error: unknown) => failed(error),
          extra: { asset: props.asset, url: props.url },
        }),
    }),
  );
}

/**
 * The view registries of the page. `canvas` is the canvas of the Scene view, and `view` gives its view now (for the
 * handles of a scene tool).
 */
export function pageViewPoints(
  canvas: HTMLCanvasElement | null,
  view: () => CameraView | null = () => null,
): Pick<
  StudioPointHost,
  "addToolbarButton" | "addSceneTool" | "addPreview" | "addRecipes" | "addSettings" | "addMenuItem"
> {
  if (typeof window !== "undefined")
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && active !== null) turnOff();
    });

  return {
    addToolbarButton: (button) => {
      const element = iconButton(button.id, button.title, button.icon);
      element.addEventListener("click", () => button.run());
      placePart(element, "tools");
      return () => element.remove();
    },
    addSceneTool: (tool) => {
      const element = iconButton(tool.id, tool.title, tool.icon);
      element.setAttribute("aria-pressed", "false");
      element.addEventListener("click", () => {
        const again = active?.id === tool.id;
        turnOff();
        if (again || canvas === null) return;
        const stop = tool.activate(canvas);
        const { handles, moveHandle } = tool;
        // The handles of the tool over the view while the tool is active.
        const hide =
          handles === undefined
            ? () => undefined
            : startToolHandles(canvas, { handles, move: (id, point, done) => moveHandle?.(id, point, done), view });
        active = {
          id: tool.id,
          stop: () => {
            hide();
            stop();
          },
          button: element,
        };
        element.setAttribute("aria-pressed", "true");
      });
      placePart(element, "tools");
      return () => {
        if (active?.id === tool.id) turnOff();
        element.remove();
      };
    },
    addPreview: (kind, load, ctx, failed) => addPluginPreview(kind, pluginPreview(kind, load, ctx, failed)),
    addRecipes: (recipes) => addPluginRecipes(recipes),
    addSettings: (section) => addSettingsSection(section),
    addMenuItem: (item) => {
      PLUGIN_MENU_ITEMS.push(item);
      return () => {
        const at = PLUGIN_MENU_ITEMS.indexOf(item);
        if (at >= 0) PLUGIN_MENU_ITEMS.splice(at, 1);
      };
    },
  };
}
