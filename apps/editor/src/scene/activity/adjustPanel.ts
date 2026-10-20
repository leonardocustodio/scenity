// SPDX-License-Identifier: Apache-2.0
/**
 * Adjust the last action: a small panel over the Scene view with the number arguments of the last action of the
 * person (for example, the offset of a duplicate). A change runs the action again with the new value as the same step
 * of the history. The panel closes when another step occurs or when the person closes it. The panel uses DOM nodes
 * only, as the other parts over the canvas do.
 */
import type { ArgSpec } from "@scenity/editor-core";
import { t } from "../../texts";
import type { SceneCommands } from "../hierarchy/sceneCommands";
import { placePart } from "../pageParts";

/** The part of the editor that the panel reads: the current step of the history, and its changes. */
export interface AdjustEditor {
  stepIndex(): number;
  listen(listener: () => void): () => void;
}

/** The number arguments of a command: the fields of the panel. */
function numberArgs(commands: SceneCommands, id: string): [string, Extract<ArgSpec, { type: "number" }>][] {
  const listing = commands.listings().find((item) => item.id === id);
  return Object.entries(listing?.args ?? {}).filter(
    (entry): entry is [string, Extract<ArgSpec, { type: "number" }>] => entry[1].type === "number",
  );
}

/** Start the panel. The returned function removes it. */
export function startAdjustPanel(commands: SceneCommands, editor: AdjustEditor): () => void {
  const panel = document.createElement("section");
  panel.id = "scene-adjust";
  panel.dataset.testid = "scene-adjust";
  panel.setAttribute("aria-label", t("adjust-label"));
  panel.hidden = true;
  placePart(panel, "view");
  let closed: number | null = null;
  const draw = (): void => {
    const last = commands.lastAction();
    const fields = last === null ? [] : numberArgs(commands, last.command);
    panel.hidden = last === null || fields.length === 0 || last.index !== editor.stepIndex() || closed === last.line;
    if (panel.hidden || last === null) return;
    const title = document.createElement("h2");
    title.textContent = t("adjust-title", { title: last.title });
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", t("adjust-close"));
    close.dataset.testid = "scene-adjust-close";
    close.addEventListener("click", () => {
      closed = last.line;
      draw();
    });
    const reason = document.createElement("p");
    reason.dataset.testid = "scene-adjust-reason";
    const inputs = fields.map(([name, spec]) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      const given = last.args[name];
      input.value = String(typeof given === "number" ? given : (spec.default ?? 0));
      input.dataset.testid = `scene-adjust-${name}`;
      input.addEventListener("change", () => {
        commands.adjust({ [name]: Number(input.value) }).catch((error: unknown) => {
          reason.textContent = error instanceof Error ? error.message : String(error);
        });
      });
      label.append(name, input);
      return label;
    });
    panel.replaceChildren(title, close, ...inputs, reason);
  };
  const stops = [commands.listenLast(draw), editor.listen(draw)];
  draw();
  return () => {
    for (const stop of stops) stop();
    panel.remove();
  };
}
