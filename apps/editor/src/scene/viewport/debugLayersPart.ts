// SPDX-License-Identifier: Apache-2.0
/**
 * The debug layers in the View options overlay. The part has a box for each layer that the core can draw, from the
 * inspect report of the page. The layers are the generic layers and the layers of the dev faces of the plugins. A box
 * enables or disables its layer with `__scenity.debug`, and the URL parameter `debug` follows. The part reads the
 * layers when it opens, so a closed part does no work.
 */
import { t } from "../../texts";

/** What the part reads of the page: the script API of the dev tools. */
export interface DebugLayersPort {
  /** The layers that the core can draw, and the enabled layers (the inspect report). */
  layers(): Promise<{ readonly names: readonly string[]; readonly on: readonly string[] } | null>;
  set(names: readonly string[]): Promise<void>;
}

/** The port over the script API of the page. */
export function pageDebugLayers(): DebugLayersPort {
  return {
    layers: async () => (await globalThis.__scenity?.inspect?.())?.layers ?? null,
    set: async (names) => {
      await globalThis.__scenity?.debug?.(names);
    },
  };
}

/** The part: a details element with a box for each layer. */
export function debugLayersPart(port: DebugLayersPort = pageDebugLayers()): HTMLElement {
  const part = document.createElement("details");
  part.className = "scene-debug-layers";
  part.dataset.testid = "scene-debug-layers";
  const summary = document.createElement("summary");
  summary.textContent = t("viewport-debug-layers");
  const list = document.createElement("div");
  list.className = "scene-overlay-row";
  part.append(summary, list);
  const show = async (): Promise<void> => {
    const layers = await port.layers();
    if (layers === null) return;
    let on = [...layers.on];
    list.replaceChildren(
      ...layers.names.map((name) => {
        const label = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = on.includes(name);
        box.dataset.testid = `scene-debug-${name}`;
        box.dataset.layer = name;
        box.addEventListener("change", () => {
          on = box.checked ? [...on, name] : on.filter((each) => each !== name);
          void port.set(on);
        });
        // A layer name is a data value of the core: it stays as it is.
        const text = document.createElement("span");
        text.textContent = name;
        text.translate = false;
        label.append(box, " ", text);
        return label;
      }),
    );
    part.dataset.layers = String(layers.names.length);
  };
  part.addEventListener("toggle", () => {
    if (part.open) void show();
  });
  return part;
}
