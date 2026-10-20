// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of the lab page that the command runner and the tools of a plugin use. They are the view host of the page
 * (the scene edit, the edit panel, the camera, the scratch props) and the key relay of the scene edit. The page gives
 * the parts to the plugin (`EditorPlugin.overlays.start`). The plugin starts the runner (useCommands.ts) with its tools
 * over the scene.
 */
import type { InspectReport, SceneInput } from "../../plugins";
import type { Component, Ref } from "vue";
import type { EditPanel } from "../edit/useEditPanel";
import type { KeyRun, SceneEdit } from "../edit/useSceneEdit";
import type { LabPanes } from "../panes/usePanes";
import type { Scratch } from "../scratch/useScratch";
import type { LabCamera } from "../useLabCamera";
import type { LabClock } from "../useLabClock";
import type { LabTake } from "../useLabTake";
import type { CommandRunner, ViewHost } from "./useCommands";
import type { Editor } from "./useEditor";
import type { GhostViewHandle } from "./useGhosts";
import type { HideView } from "./useHide";
import type { OnionViewHandle } from "./useOnion";

/** The view host of the lab page: the scene edit, the edit panel, the camera and the scratch props. */
export function labCommandHost(parts: {
  readonly edit: SceneEdit;
  readonly panel: EditPanel;
  readonly camera: LabCamera;
  readonly scratch: Scratch;
}): ViewHost {
  const { edit, panel, camera, scratch } = parts;
  return {
    select: (target) => {
      edit.select(target);
    },
    undo: () => {
      edit.history.undo();
    },
    redo: () => {
      edit.history.redo();
    },
    openCamera: (name) => {
      camera.openCamera(name);
    },
    setMarking: (on) => {
      panel.setMarking(on);
    },
    clearMarks: () => {
      panel.setMarks([]);
    },
    ask: (text) => panel.ask(text),
    scratchPlace: (id) => scratch.placeOf(id),
    moveScratch: (id, place) => {
      scratch.move(id, place);
    },
    duplicateScratch: (id) => {
      const copy = scratch.api.duplicate(id);
      if (copy !== null) edit.select({ kind: "scratch", id: copy });
      return copy;
    },
    removeScratch: (id) => {
      edit.select(null);
      scratch.api.remove(id);
    },
    // A list of items. The first item is the item of the card.
    selectAll: (targets) => {
      edit.selectAll(targets);
    },
    promoteScratch: (id, dry) => scratch.api.promote(id, dry),
  };
}

/** The key relay of the scene edit before the runner exists. The runner takes the keys when it starts. */
export interface KeyRelay {
  readonly run: KeyRun;
  runner: CommandRunner | null;
}

export function keyRelay(): KeyRelay {
  const relay: KeyRelay = {
    runner: null,
    run: (command, args, propose) => {
      relay.runner?.key(command, args, propose === true ? "propose" : undefined);
    },
  };
  return relay;
}

/** The tools of a plugin over the scene (`EditorPlugin.overlays`). */
export interface EditorOverlays {
  /**
   * Start the command runner of the page with the tools of the plugin over the scene: its handles, readouts and
   * markers, and the tools that its tabs and cards get. The runner takes the keys of the scene edit.
   */
  start(parts: LabParts): CommandRunner;
  /** A part of the card of a selected prop (for example a box that places the prop from words), or null. */
  readonly propCard: Component | null;
}

/** The parts of the lab page that the runner uses. */
export interface LabParts {
  readonly editor: Editor;
  readonly tunes: Ref<Record<string, number>>;
  readonly edit: SceneEdit;
  readonly panel: EditPanel;
  readonly camera: LabCamera;
  readonly scratch: Scratch;
  readonly keys: KeyRelay;
  /**
   * The room view. It draws the ghosts of the proposals and the onion skin. It also gives the inspect report of the
   * last frame (the hand targets).
   */
  readonly view: {
    readonly value:
      (GhostViewHandle & OnionViewHandle & HideView & { inspect?(): Promise<InspectReport | null> }) | null;
  };
  /** The live take (the place markers and the time of `member.place`) and its clock. */
  readonly take: LabTake;
  readonly clock: Pick<LabClock, "simNow" | "running" | "displayMs" | "epoch">;
  /** The scene input at a time (the onion skin), or null (a live session). */
  readonly inputAt?: ((at: number) => SceneInput) | null;
  /** The split screen (a compare of two layouts shows in pane 0 and pane 1). If absent, no layout variants. */
  readonly panes?: LabPanes;
}
