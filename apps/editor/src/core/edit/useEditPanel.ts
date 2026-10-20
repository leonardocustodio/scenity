// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the selection card and the scene edit methods of the script API (`globalThis.__room3dLab`): the pick,
 * the selection, the picked item, undo and redo, the "Ask Claude" request, "Save placement" and the marks. In the
 * workbench, the ask and the placement go to the host as bridge events (`ask`, `placement`). The host answers through
 * the API (`askResult`, `placementResult`). A lab page without the workbench copies the request with the picked block,
 * and shows the tune-apply commands.
 *
 * With the layout checks of the editor, "Save placement" stops while a layout check fails, and the card shows the
 * numbers. With a reason of the owner, the save continues, and the `placement` event holds the reason (`override`).
 * Thus the host can put it into the run and the proposal of the commit message.
 *
 * The status lines of an ask are Fluent messages of `src/i18n/en-US/card.ftl`.
 */
import type { Vec3 } from "@scenity/character";
import { parseSelect, projectPoint, tuneText, type PickResult, type SelectTarget } from "@scenity/runtime-dev";
import { computed, onBeforeUnmount, ref, type ComputedRef, type Ref, type ShallowRef } from "vue";
import type { LayoutChecks } from "../editor/layout";
import { editorRoom } from "../sceneSource";
import { t } from "../../texts";
import type { ViewHandle } from "../useLabStats";
import { marksPicture, type Mark, type MarksPicture } from "./marks";
import { askPrompt, pickedItem, type PickedItem, type PickedScratch } from "./pickedItem";
import type { PropPlace } from "./placeDrag";
import { placementAnswer, placementCommand, placementValues, withoutApplied, type PlacementView } from "./placement";
import type { SceneEdit } from "./useSceneEdit";

/** The destination of an ask: the workbench (its host gives the terminal or the chat), or the clipboard of the page. */
export type AskOutcome = "workbench" | "clipboard" | "none";

export interface EditPanel {
  readonly item: ComputedRef<PickedItem | null>;
  /** The status line of the last ask, or null. */
  readonly askStatus: Ref<string | null>;
  readonly placement: Ref<PlacementView | null>;
  /** True while the owner draws marks (the clock is stopped). */
  readonly marking: Ref<boolean>;
  readonly marks: Ref<Mark[]>;
  setMarking(on: boolean): void;
  setMarks(marks: readonly Mark[]): void;
  /** True when the lab is in a frame of the workbench (the bridge is active). */
  inWorkbench(): boolean;
  ask(text: string): Promise<AskOutcome>;
  /**
   * "Save placement": the dry run (or the real apply) of the place values. It stops while a layout check fails, unless
   * the owner gives a reason (`override`, else the reason that the command gave to the gate).
   */
  savePlacement(dry: boolean, override?: string): void;
  /** The layout checks of the editor, or null (a page without the editor). */
  readonly layout: LayoutChecks | null;
  /** The answer of the host to a placement. A real apply that passed removes its values from the tune values. */
  placementDone(value: unknown): void;
  /** The tune-apply commands of the current place values (a lab page without the workbench). */
  commands(): { readonly dry: string; readonly apply: string } | null;
  /** The place values that a placement writes at this time (the checks of the save read them). */
  values(): Record<string, number>;
}

/** The scene edit methods of the script API. */
export interface LabEditApi {
  pick(x: number, y: number, pane?: number): Promise<PickResult | null>;
  /**
   * The point of the canvas (CSS pixels) of a point of the room with the camera of the last frame, or null (behind the
   * camera, or no pick). A test or an agent uses it to find the pixel of a joint or a prop.
   */
  screenOf(point: Vec3): Promise<{ x: number; y: number } | null>;
  /** Select an item (`"prop:cart"` or `{ kind, id }`), or nothing (null). */
  select(target: string | SelectTarget | null): void;
  selection(): SelectTarget | null;
  /** The picked item of the selection (the "picked" block of the context packet), or null. */
  picked(): PickedItem | null;
  undo(): void;
  redo(): void;
  turnSelected(degrees: number): void;
  ask(text: string): Promise<AskOutcome>;
  /** `override` is the reason to save while a layout check fails. */
  savePlacement(
    dry?: boolean,
    override?: string,
  ): { values: Record<string, number>; dry: string; apply: string } | null;
  /** The host gives the answer of a placement. */
  placementResult(value: unknown): void;
  /** The host tells the destination of an ask. */
  askResult(value: unknown): void;
  /** Set the marks (fractions 0 to 1 of the scene). */
  setMarks(marks: Mark[]): void;
  /** The picture of the frame with the marks, the mask and the description (`lab_marks`). */
  marks(width?: number): Promise<MarksPicture | null>;
}

interface PanelParts {
  readonly edit: SceneEdit;
  readonly tunes: Ref<Record<string, number>>;
  readonly view: ShallowRef<ViewHandle | null>;
  readonly scene: Ref<HTMLElement | null>;
  readonly pause: () => void;
  /** The place and the import facts of a scratch prop, or null. */
  readonly scratch?: (id: string) => { readonly place: PropPlace | null; readonly facts: PickedScratch | null } | null;
  /** The layout checks of the editor (editor/useEditor.ts). When absent, there is no save gate. */
  readonly layout?: LayoutChecks;
}

/** The text of the answer of the host to an ask (`askResult`). */
function askWords(value: unknown): string {
  const to = (value as { to?: unknown } | null)?.to;
  if (to === "terminal") return t("card-ask-terminal");
  if (to === "chat") return t("card-ask-chat");
  return t("card-ask-no-session");
}

/** The scene edit methods of the script API on the panel state. */
function editApi(panel: EditPanel, parts: PanelParts): LabEditApi {
  const { edit } = parts;
  return {
    pick: (x, y, pane) => edit.pick(x, y, pane),
    screenOf: async (point) => {
      const box = parts.scene.value?.getBoundingClientRect();
      const probe = box === undefined ? null : await edit.pick(box.width / 2, box.height / 2);
      return probe === null ? null : projectPoint(probe.camera, point);
    },
    select: (target) => {
      edit.select(typeof target === "string" ? parseSelect(target) : target);
    },
    selection: () => edit.selection.value,
    picked: () => panel.item.value,
    undo: () => {
      edit.history.undo();
    },
    redo: () => {
      edit.history.redo();
    },
    turnSelected: (degrees) => {
      edit.turn(degrees);
    },
    ask: (text) => panel.ask(text),
    savePlacement: (dry = true, override) => {
      const made = panel.commands();
      if (made === null) return null;
      panel.savePlacement(dry, override);
      return { values: placementValues(parts.tunes.value), ...made };
    },
    placementResult: (value) => {
      panel.placementDone(value);
    },
    askResult: (value) => {
      panel.askStatus.value = askWords(value);
    },
    setMarks: (next) => {
      panel.setMarks(next);
    },
    marks: async (width = 1280) => {
      const box = parts.scene.value?.getBoundingClientRect();
      if (panel.marks.value.length === 0 || box === undefined) return null;
      return marksPicture(parts.view.value, panel.marks.value, { width: box.width, height: box.height }, width);
    },
  };
}

/**
 * Add the scene edit methods to the script API of the page, and remove them when the page unmounts. The scene editor
 * (editor/useEditor.ts) adds its methods the same way.
 */
export function installApi(api: object): void {
  const lab = globalThis.__room3dLab;
  if (lab !== undefined) Object.assign(lab, api);
  onBeforeUnmount(() => {
    const current = globalThis.__room3dLab as Record<string, unknown> | undefined;
    if (current !== undefined) for (const key of Object.keys(api)) Reflect.deleteProperty(current, key);
  });
}

/**
 * The gate of the layout checks for a placement. The reason is the reason of the card, else the reason that the
 * command gave to the gate (useEditor.ts). `blocked` holds the text of the failed checks, or null.
 */
function placementGate(
  layout: LayoutChecks | undefined,
  override: string | undefined,
): { readonly blocked: string | null; readonly override: { readonly override?: string } } {
  const given = override?.trim() ?? "";
  const reason = given === "" ? (layout?.takeOverride() ?? "") : given;
  return { blocked: layout?.gate(reason) ?? null, override: reason === "" ? {} : { override: reason } };
}

/** The tune-apply commands of the place values of the tune values, or null without place values. */
function placementCommands(tunes: Readonly<Record<string, number>>): { dry: string; apply: string } | null {
  const values = placementValues(tunes);
  if (Object.keys(values).length === 0) return null;
  return { dry: placementCommand(values, true), apply: placementCommand(values, false) };
}

export function useEditPanel(parts: PanelParts): EditPanel {
  const { edit, tunes } = parts;
  const manifest = editorRoom().manifest();
  const askStatus = ref<string | null>(null);
  const marking = ref(false);
  const marks = ref<Mark[]>([]);
  const item = computed(() => {
    const selection = edit.selection.value;
    if (selection === null) return null;
    const facts = { picked: edit.picked.value, tunes: tunes.value, defaults: edit.defaults, manifest };
    const scratch = selection.kind === "scratch" ? (parts.scratch?.(selection.id) ?? null) : null;
    return pickedItem({ selection, ...facts, warnings: edit.warnings.value, scratch });
  });
  const commands = (): { dry: string; apply: string } | null => placementCommands(tunes.value);
  // The place values of the last real apply, until the host answers.
  let applying: Record<string, number> | null = null;
  const panel: EditPanel = {
    item,
    askStatus,
    placement: ref<PlacementView | null>(null),
    marking,
    marks,
    setMarking: (on) => {
      marking.value = on;
      // The marks need a stopped clock, so the picture and the marks are of one time.
      if (on) parts.pause();
    },
    setMarks: (next) => {
      marks.value = [...next];
    },
    inWorkbench: () => globalThis.__workbench !== undefined,
    ask: async (text) => {
      if (text.trim() === "") return "none";
      const bridge = globalThis.__workbench;
      if (bridge !== undefined) {
        askStatus.value = t("card-ask-sent");
        bridge.emit({ event: "ask", text: text.trim() });
        return "workbench";
      }
      try {
        await navigator.clipboard.writeText(askPrompt(text, item.value));
        askStatus.value = t("card-ask-clipboard");
        return "clipboard";
      } catch {
        askStatus.value = t("card-ask-no-clipboard");
        return "none";
      }
    },
    savePlacement: (dry, override) => {
      const values = placementValues(tunes.value);
      const bridge = globalThis.__workbench;
      if (bridge === undefined || Object.keys(values).length === 0) return;
      const gate = placementGate(parts.layout, override);
      if (gate.blocked !== null) {
        panel.placement.value = { run: null, dry, status: "blocked", output: gate.blocked };
        return;
      }
      panel.placement.value = { run: null, dry, status: "running", output: "" };
      applying = dry ? null : values;
      bridge.emit({ event: "placement", values: tuneText(values), dry, ...gate.override });
    },
    layout: parts.layout ?? null,
    placementDone: (value) => {
      const answer = placementAnswer(value);
      panel.placement.value = answer;
      if (answer === null || answer.dry) return;
      // The code holds the applied places. Remove their tune values, so the URL and a new page agree.
      if (answer.status === "passed" && applying !== null) tunes.value = withoutApplied(tunes.value, applying);
      applying = null;
    },
    commands,
    values: () => placementValues(tunes.value),
  };
  installApi(editApi(panel, parts));
  return panel;
}
