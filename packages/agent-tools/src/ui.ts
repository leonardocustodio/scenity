// SPDX-License-Identifier: Apache-2.0
/**
 * The UI tools: an agent reads the state of the editor window and shows a person a part of it. `ui_state` gives the
 * workspace, the panels, the selection, the open scene and the time. `ui_reveal` selects and frames entities, opens a
 * panel and shows a field of the inspector with a callout. For example, one call shows a person the exposure field.
 * `ui_highlight` puts a callout on a part of the window. `ui_notify` shows a short message. The tools call the visible
 * frame, so the person sees the result there.
 */
import { z } from "zod";
import {
  STUDIO_STATE_CALL,
  UI_HIGHLIGHT_CALL,
  UI_NOTIFY_CALL,
  UI_REVEAL_CALL,
  UI_STATE_CALL,
  type UiReveal,
} from "@scenity/bridge";
import { callTyped, defineTool, textResult } from "./kit";

const TEXT = z.string().min(1).max(400);

export const uiState = defineTool({
  name: "ui_state",
  description:
    "The state of the editor window that the person sees: the workspace, the open panels and the active one, the " +
    "selected entities, the open scene file, the time of the clock and the theme.",
  input: z.object({}),
  alwaysLoad: false,
  async handler(_input, ctx) {
    const state = await callTyped(ctx.surface("visible"), UI_STATE_CALL, []);
    return textResult([
      `Workspace: ${state.workspace}; panels: ${state.panels.join(", ")}; active: ${state.activePanel ?? "none"}.`,
      `Selection: ${state.selection.length === 0 ? "none" : state.selection.join(", ")}.`,
      `Scene: ${state.scene}; time: ${state.time === null ? "no clock" : `${String(state.time)} ms`}; theme: ${state.theme}.`,
    ]);
  },
});

export const uiReveal = defineTool({
  name: "ui_reveal",
  description:
    "Show the person a part of the editor window in one call: select entities, frame them, open a panel, and show " +
    "a field of the inspector with a callout (for example field 'environment.exposure' with a text). A field of a " +
    "scene component shows with no selection; a field of an entity component shows for the selected entities.",
  input: z.object({
    entities: z.array(z.string().min(1)).max(100).optional().describe("Select these entity IDs ([] clears it)."),
    frame: z.boolean().optional().describe("Frame the selection in the Scene view."),
    panel: z.string().min(1).optional().describe("Open this panel, for example 'inspector' or 'rules'."),
    field: z.string().min(1).optional().describe("The field 'component.field', for example 'light.intensity'."),
    text: TEXT.optional().describe("The text of the callout next to the field or the panel."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    // The request has only the parts with a value. The page reads the parts that it gets.
    const request = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as UiReveal;
    const answer = await callTyped(ctx.surface("visible"), UI_REVEAL_CALL, [request]);
    return textResult([
      answer.done.length === 0 ? "Nothing changed." : `Done: ${answer.done.join(", ")}.`,
      ...(answer.missing.length === 0
        ? []
        : [`Not done (not in the window, or not now): ${answer.missing.join(", ")}.`]),
    ]);
  },
});

export const uiHighlight = defineTool({
  name: "ui_highlight",
  description:
    "Put a callout with a text on a part of the editor window: a field 'component.field', a panel ID, or the test " +
    "ID or command ID of a control (for example 'scene-save' or 'play.start').",
  input: z.object({ target: z.string().min(1).describe("The part of the window."), text: TEXT.optional() }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const shown = await callTyped(ctx.surface("visible"), UI_HIGHLIGHT_CALL, [input]);
    if (!shown) throw new Error(`no part "${input.target}" in the window now.`);
    return textResult([`Callout on ${input.target}.`]);
  },
});

export const uiNotify = defineTool({
  name: "ui_notify",
  description: "Show the person a short message in the editor window (a toast).",
  input: z.object({ text: TEXT, tone: z.enum(["status", "alert"]).optional() }),
  alwaysLoad: false,
  async handler(input, ctx) {
    await callTyped(ctx.surface("visible"), UI_NOTIFY_CALL, [input]);
    return textResult(["Shown."]);
  },
});

/** The one state call of an agent: the first call of a session. */
export const studioStateTool = defineTool({
  name: "studio_state",
  description:
    "Call it first in a session: one small answer with the project, the open scene (its path, entity count and " +
    "whether it is saved), the selection, the entities at the root of the scene with their components, the prefabs, " +
    "the open sequence, the problems of the last rule check and the agent mode (propose or apply).",
  input: z.object({}),
  alwaysLoad: true,
  async handler(_input, ctx) {
    const state = await callTyped(ctx.surface("visible"), STUDIO_STATE_CALL, []);
    return textResult([JSON.stringify(state)]);
  },
});
